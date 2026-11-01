'use strict';
// Lyrics provider race, ported from BitChord's lyrics layer (web/app/src/lyrics).
// Every provider answers with { kind: 'word' | 'line' | 'plain', lines } or null.
// Word-timed answers win; line-synced is the fallback; plain text is the last resort.
// The winner is serialised as enhanced LRC ("[mm:ss.xx]<mm:ss.xx>word <mm:ss.xx>word <mm:ss.xx>")
// so the renderer (and the on-disk cache) only deal with one text format.

const UA = 'Gaane/1.2 (https://www.abhishekkroy.me)';
const HTTP_TIMEOUT_MS = 5000;
const RACE_TIMEOUT_MS = 9000;
const LINE_GRACE_MS = 1800; // after a line-synced hit, how long to wait for a word-timed one

async function httpGet(url, { timeout = HTTP_TIMEOUT_MS, headers } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: '*/*', ...headers } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function urlWith(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && String(v) !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function json(body) {
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

const seconds = (ms) => (ms > 0 ? Math.floor(ms / 1000) : null);

// ---- text helpers ------------------------------------------------------------------------------

const VERSION_WORDS = new Set([
  'live', 'remix', 'remixed', 'mix', 'acoustic', 'unplugged', 'instrumental', 'karaoke', 'cappella', 'acapella',
  'demo', 'edit', 'version', 'cover', 'sped', 'slowed', 'reverb', 'nightcore', 'lofi', 'orchestral', 'extended',
]);
const BRACKETED = /[([][^)\]]*[)\]]/g;
const ARTIST_SEPARATORS = /\s*(?:,|&|;|\/|\s+and\s+|\s+x\s+|\s+with\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i;

const normalized = (value) => String(value || '')
  .normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, ' ').replace(/\s+/g, ' ').trim();
const coreOf = (title) => normalized(String(title).replace(BRACKETED, ' ').split(' - ')[0]) || normalized(title);
const versionOf = (title) => {
  const t = String(title);
  const tail = t.includes(' - ') ? t.slice(t.indexOf(' - ') + 3) : '';
  return new Set(normalized(`${(t.match(BRACKETED) || []).join(' ')} ${tail}`).split(' ').filter((w) => VERSION_WORDS.has(w)));
};
const artistsOf = (artist) => new Set(String(artist || '').split(ARTIST_SEPARATORS).map(normalized).filter(Boolean));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Same recording test used for lrc.red search hits (BitChord bestLrcRedHit). */
function bestLrcRedHit(hits, title, artist, durationMs) {
  const wantedTitle = coreOf(title);
  const wantedVersion = versionOf(title);
  const wantedArtists = artistsOf(artist);
  const secs = durationMs / 1000;
  const distance = (h) => (durationMs > 0 && h.duration != null ? Math.abs(h.duration - secs) : 0);
  const passing = (hits || []).filter((h) =>
    !!h.title && !!lrcRedDocument(h.isrc) &&
    coreOf(h.title) === wantedTitle &&
    sameSet(versionOf(h.title), wantedVersion) &&
    (!wantedArtists.size || [...artistsOf(h.artist)].some((a) => wantedArtists.has(a))) &&
    distance(h) <= 3);
  return passing.sort((a, b) => distance(a) - distance(b))[0] || null;
}

function lrcRedDocument(isrc) {
  const code = String(isrc || '').trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? `https://lrc.red/s/${code}.ttml` : null;
}

// ---- parsing -----------------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** "12.5", "1:02.500", "00:01:02.500", "1.5s", "1500ms" → ms. */
function parseClock(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^[\d.]+ms$/.test(s)) return parseFloat(s);
  if (/^[\d.]+s$/.test(s)) return Math.round(parseFloat(s) * 1000);
  const parts = s.split(':');
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + Number(p);
  return Math.round(sec * 1000);
}

function attr(tag, name) {
  const m = new RegExp(`(?:^|[\\s:])${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

function makeWords(runs) {
  // runs: {s, e, text, spaceBefore}. Syllables without whitespace between merge into one word.
  const words = [];
  for (const r of runs) {
    const text = r.text;
    if (!text.trim()) continue;
    const last = words[words.length - 1];
    if (last && !r.spaceBefore && !/\s$/.test(last.t) && !/^\s/.test(text)) {
      last.t += text.trim();
      last.e = Math.max(last.e, r.e);
    } else {
      words.push({ s: r.s, e: r.e, t: text.trim() });
    }
  }
  return words;
}

/** Apple-style TTML (lrc.red, BiniLyrics, Unison) → lines, word-timed when spans carry times. */
function parseTtml(ttml) {
  const lines = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRe.exec(ttml))) {
    const begin = parseClock(attr(pm[1], 'begin'));
    const end = parseClock(attr(pm[1], 'end'));
    const inner = pm[2];
    const runs = [];
    const spanRe = /<span\b([^>]*)>([^<]*)<\/span>/g;
    let sm; let prevEnd = 0;
    while ((sm = spanRe.exec(inner))) {
      const gap = inner.slice(prevEnd, sm.index).replace(/<[^>]+>/g, '');
      prevEnd = sm.index + sm[0].length;
      const s = parseClock(attr(sm[1], 'begin'));
      const e = parseClock(attr(sm[1], 'end'));
      const text = decodeEntities(sm[2]);
      if (s == null) continue;
      runs.push({ s, e: e == null ? s : e, text, spaceBefore: /\s/.test(gap) || /^\s/.test(text) });
    }
    const words = makeWords(runs);
    const plain = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!plain) continue;
    if (words.length >= 1 && words.some((w) => w.e > w.s)) {
      lines.push({ time: Math.min(begin ?? words[0].s, words[0].s), end: end ?? words[words.length - 1].e, text: words.map((w) => w.t).join(' '), words });
    } else if (begin != null) {
      lines.push({ time: begin, end: end ?? null, text: plain, words: null });
    } else {
      lines.push({ time: -1, end: null, text: plain, words: null });
    }
  }
  return lines;
}

const LRC_LINE = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/;
const ENH_TAG = /<(\d+):(\d+(?:[.:]\d+)?)>/g;

function stampMs(min, sec) {
  return Math.round((parseInt(min, 10) * 60 + parseFloat(String(sec).replace(':', '.'))) * 1000);
}

/** Plain / line-synced / enhanced LRC → lines. */
function parseLrc(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = LRC_LINE.exec(raw.trim());
    if (!m) {
      const t = raw.trim();
      if (t && !/^\[[a-z]+:/i.test(t)) lines.push({ time: -1, end: null, text: t, words: null });
      continue;
    }
    const stamps = [...m[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)].map((x) => stampMs(x[1], x[2]));
    const body = m[2];
    let words = null; let cleaned = body.replace(/<[^>]+>/g, '').trim();
    if (ENH_TAG.test(body)) {
      ENH_TAG.lastIndex = 0;
      const toks = [...body.matchAll(/<(\d+):(\d+(?:[.:]\d+)?)>([^<]*)/g)];
      const runs = toks.map((x, i) => {
        const s = stampMs(x[1], x[2]);
        const nx = toks[i + 1];
        return { s, e: nx ? stampMs(nx[1], nx[2]) : s + 600, text: x[3], spaceBefore: /^\s/.test(x[3]) || /\s$/.test(toks[i - 1]?.[3] || 'x') };
      });
      const w = makeWords(runs);
      if (w.length) { words = w; cleaned = w.map((x) => x.t).join(' '); }
    }
    ENH_TAG.lastIndex = 0;
    if (!cleaned) { for (const t of stamps) lines.push({ time: t, end: null, text: '', words: null, gap: true }); continue; }   // a blank stamped line marks an instrumental stretch
    for (const t of stamps) lines.push({ time: t, end: null, text: cleaned, words });
  }
  const timed = lines.some((l) => l.time >= 0);
  if (timed) lines.sort((a, b) => (a.time < 0 ? 1 : b.time < 0 ? -1 : a.time - b.time));
  return lines;
}

function fmt(ms) {
  const t = Math.max(0, Math.round(ms / 10));
  const m = Math.floor(t / 6000);
  const s = ((t % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

function kindOf(lines) {
  if (!lines || !lines.some((l) => l.text && l.text.trim())) return null;
  lines = lines.filter((l) => !l.gap);
  if (lines.some((l) => l.words && l.words.length > 1)) return 'word';
  if (lines.some((l) => l.time >= 0)) return 'line';
  return 'plain';
}

// Breaks in the singing (BitChord's LyricGaps): where a line's own end is known and the next line starts 4 s or more
// later, a blank stamped line marks the break, so the screen shows "..." instead of keeping the last line lit.
const MIN_GAP_MS = 4000;
function withGaps(lines) {
  const out = [];
  const real = lines.filter((l) => !l.gap && l.time >= 0);
  if (!real.length) return lines;
  const firstTimed = lines.find((l) => l.time >= 0);
  if (firstTimed && !firstTimed.gap && firstTimed.time >= MIN_GAP_MS) out.push({ time: 0, end: null, text: '', words: null, gap: true });
  lines.forEach((l, i) => {
    out.push(l);
    if (l.gap || l.time < 0) return;
    const next = lines.slice(i + 1).find((x) => x.time >= 0);
    if (!next || next.gap) return;
    const known = (l.words && l.words.length) ? l.words[l.words.length - 1].e : (l.end != null ? l.end : null);
    if (known == null) return;
    if (next.time - known >= MIN_GAP_MS && known > l.time) out.push({ time: known, end: null, text: '', words: null, gap: true });
  });
  return out;
}

/** Serialise lines as enhanced LRC. */
function toLrc(input) {
  const lines = withGaps(input);
  return lines.map((l) => {
    if (l.gap) return `[${fmt(l.time)}]`;
    if (l.time < 0) return l.text;
    if (l.words && l.words.length) {
      const body = l.words.map((w) => `<${fmt(w.s)}>${w.t}`).join(' ');
      const tail = l.words[l.words.length - 1].e;
      return `[${fmt(l.time)}]${body} <${fmt(tail)}>`;
    }
    return `[${fmt(l.time)}]${l.text}`;
  }).join('\n');
}

// Some sources send unsynced text with every line stamped 0:00; that is plain text, not synced lyrics.
function untimeIfStamped(lines) {
  if (!lines || lines.length < 2) return lines;
  const stamps = new Set(lines.filter((l) => l.time >= 0 && !(l.words && l.words.length)).map((l) => l.time));
  const hasWords = lines.some((l) => l.words && l.words.length > 1);
  if (!hasWords && stamps.size <= 1) return lines.map((l) => ({ ...l, time: -1, end: null }));
  return lines;
}

const answer = (input) => {
  const lines = untimeIfStamped(input);
  const kind = kindOf(lines);
  return kind ? { kind, lines } : null;
};

// ---- providers ---------------------------------------------------------------------------------

function sharedGetter() {
  const memo = new Map();
  return (url) => {
    if (!memo.has(url)) memo.set(url, httpGet(url));
    return memo.get(url);
  };
}

async function biniIdentify(q) {
  const url = q.isrc
    ? urlWith('https://lyrics-api.binimum.org/', { isrc: q.isrc })
    : urlWith('https://lyrics-api.binimum.org/', { track: q.title, artist: q.artist, album: q.album, duration: seconds(q.durationMs) });
  const body = json(await httpGet(url));
  return body && body.results && body.results[0] || null;
}

async function lrcRed(q, get, bini) {
  const known = lrcRedDocument(q.isrc);
  if (known) {
    const lines = parseTtml((await get(known)) || '');
    if (lines.length) return answer(lines);
  }
  const body = json(await httpGet(urlWith('https://lrc.red/search.json', { q: `${q.title} ${q.artist}`.trim() })));
  const hit = bestLrcRedHit(body && body.hits, q.title, q.artist, q.durationMs);
  let url = lrcRedDocument(hit && hit.isrc);
  if (!url && bini) {
    const b = await bini();
    url = lrcRedDocument(b && b.isrc);
  }
  if (!url || url === known) return null;
  return answer(parseTtml((await get(url)) || ''));
}

async function biniLyrics(q, get, bini) {
  const hit = await bini();
  if (!hit || !hit.lyricsUrl) return null;
  return answer(parseTtml((await get(hit.lyricsUrl)) || ''));
}

const LP_MIRRORS = ['https://lyricsplus.prjktla.my.id', 'https://lyricsplus.binimum.org'];
let lpLastGood = null;

function parseLyricsPlus(res) {
  const out = [];
  for (const l of (res && res.lyrics) || []) {
    if (typeof l.time !== 'number') continue;
    const runs = (l.syllabus || [])
      .filter((s) => typeof s.text === 'string' && typeof s.time === 'number')
      .map((s) => ({ s: s.time, e: s.time + (s.duration || 0), text: s.text, spaceBefore: /^\s/.test(s.text) }));
    // LyricsPlus syllables carry their own trailing spaces; keep that boundary.
    const words = [];
    let carry = true;
    for (const r of runs) {
      const t = r.text;
      if (!t.trim()) { carry = true; continue; }
      if (!carry && words.length) { words[words.length - 1].t += t.trim(); words[words.length - 1].e = Math.max(words[words.length - 1].e, r.e); }
      else words.push({ s: r.s, e: r.e, t: t.trim() });
      carry = /\s$/.test(t);
    }
    if (words.length) out.push({ time: Math.min(l.time, words[0].s), end: l.time + (l.duration || 0), text: words.map((w) => w.t).join(' '), words });
    else if (l.text && l.text.trim()) out.push({ time: l.time, end: l.duration ? l.time + l.duration : null, text: l.text.trim(), words: null });
  }
  return out.sort((a, b) => a.time - b.time);
}

function lyricsPlus(q) {
  const hosts = lpLastGood ? [lpLastGood, ...LP_MIRRORS.filter((m) => m !== lpLastGood)] : LP_MIRRORS;
  return new Promise((resolve) => {
    let pending = hosts.length; let done = false;
    for (const host of hosts) {
      (async () => {
        const body = json(await httpGet(urlWith(`${host}/v2/lyrics/get`, {
          title: q.title, artist: q.artist, duration: seconds(q.durationMs), album: q.album, isrc: q.isrc,
        })));
        const lines = body ? parseLyricsPlus(body) : [];
        if (!done && lines.length) { done = true; lpLastGood = host; resolve(answer(lines)); }
        if (--pending === 0 && !done) resolve(null);
      })();
    }
  });
}

async function betterLyricsAt(endpoint, q) {
  const body = await httpGet(urlWith(endpoint, { s: q.title, a: q.artist, d: seconds(q.durationMs), al: q.album }));
  if (!body) return null;
  const j = json(body);
  const ttml = j && (j.ttml || j.lyrics || j.data);
  if (typeof ttml === 'string' && ttml.includes('<')) return answer(parseTtml(ttml));
  if (typeof ttml === 'string') return answer(parseLrc(ttml));
  return body.includes('<tt') ? answer(parseTtml(body)) : null;
}
const betterLyrics = (q) => betterLyricsAt('https://lyrics-api.boidu.dev/getLyrics', q);

async function unison(q) {
  const body = json(await httpGet(urlWith('https://unison.boidu.dev/lyrics', { song: q.title, artist: q.artist, album: q.album, duration: seconds(q.durationMs) })));
  const data = body && body.success ? body.data : null;
  const text = data && data.lyrics && String(data.lyrics).trim();
  if (!text) return null;
  if (String(data.format || '').toLowerCase() === 'ttml') return answer(parseTtml(text));
  if (String(data.syncType || '').toLowerCase() === 'plain') return answer(parseLrc(text).map((l) => ({ ...l, time: -1 })));
  return answer(parseLrc(text));
}

async function lrclib(q) {
  const headers = { 'User-Agent': 'Gaane/1.2 (https://www.abhishekkroy.me)' };
  const get = json(await httpGet(urlWith('https://lrclib.net/api/get', {
    track_name: q.title, artist_name: q.artist, album_name: q.album, duration: seconds(q.durationMs),
  }), { headers }));
  const pick = (x) => (x && (x.syncedLyrics || x.plainLyrics)) ? answer(parseLrc(x.syncedLyrics || x.plainLyrics)) : null;
  const direct = pick(get);
  if (direct && direct.kind !== 'plain') return direct;
  const list = json(await httpGet(urlWith('https://lrclib.net/api/search', { q: `${q.artist} ${q.title}`.trim() }), { headers }));
  if (Array.isArray(list) && list.length) {
    const secs = q.durationMs / 1000;
    const near = list.filter((x) => !secs || !x.duration || Math.abs(x.duration - secs) <= 6);
    const pool = near.length ? near : list;
    const withSynced = pool.find((x) => x.syncedLyrics);
    const found = pick(withSynced || pool[0]);
    if (found) return found;
  }
  return direct;
}

const PROVIDERS = [
  { name: 'lrc.red', run: (q, ctx) => lrcRed(q, ctx.get, ctx.bini) },
  { name: 'BiniLyrics', run: (q, ctx) => biniLyrics(q, ctx.get, ctx.bini) },
  { name: 'LyricsPlus', run: (q) => lyricsPlus(q) },
  { name: 'BetterLyrics', run: (q) => betterLyrics(q) },
  { name: 'Unison', run: (q) => unison(q) },
  { name: 'LRCLIB', run: (q) => lrclib(q) },
];

/**
 * Race every provider. Returns { lrc, kind, source } or null.
 * Resolves immediately on a word-timed answer, ~1.8 s after the first line-synced one, or when all finish.
 */
function fetchLyrics(query, { providers = PROVIDERS, timeout = RACE_TIMEOUT_MS, grace = LINE_GRACE_MS } = {}) {
  const q = {
    title: query.title || '', artist: query.artist || '',
    durationMs: Number(query.durationMs) > 0 ? Number(query.durationMs) : 0,
    album: query.album || null, isrc: query.isrc || null,
  };
  const ctx = { get: sharedGetter() };
  let biniPromise = null;
  ctx.bini = () => (biniPromise ||= biniIdentify(q).catch(() => null));
  return new Promise((resolve) => {
    let pending = providers.length; let settled = false;
    let line = null; let plain = null; let graceTimer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true; clearTimeout(graceTimer); clearTimeout(hard);
      resolve(r ? { lrc: toLrc(r.lines), kind: r.kind, source: r.source } : null);
    };
    const best = () => line || plain;
    const hard = setTimeout(() => finish(best()), timeout);
    for (const p of providers) {
      Promise.resolve().then(() => p.run(q, ctx)).catch(() => null).then((a) => {
        pending--;
        if (a && !settled) {
          const r = { ...a, source: p.name };
          if (a.kind === 'word') return finish(r);
          if (a.kind === 'line' && !line) {
            line = r;
            if (!graceTimer) graceTimer = setTimeout(() => finish(best()), grace);
          } else if (a.kind === 'plain' && !plain) plain = r;
        }
        if (pending === 0) finish(best());
      });
    }
    if (!providers.length) finish(null);
  });
}

module.exports = {
  _answer: answer, withGaps, fetchLyrics, parseTtml, parseLrc, toLrc, parseClock, parseLyricsPlus, bestLrcRedHit, lrcRedDocument, kindOf, PROVIDERS,
};
