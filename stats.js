// Listening statistics: how long and how much of what has been played.
//
// Modelled on BitChord's listening stats. The renderer samples playback and sends small deltas here; they are
// merged into one JSON file per day under <data dir>/stats, and summaries are built by merging the day files
// that fall inside the chosen period.
const fs = require('fs');
const path = require('path');

const PERIODS = ['week', 'month', 'year', 'all'];
const MAX_TOP = { songs: 25, artists: 12, albums: 12 };

function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "Arijit Singh, Pritam & Amitabh" -> "Arijit Singh": the credit that should own the listening.
function primaryArtist(credit) {
  const s = String(credit || '').trim();
  if (!s) return '';
  const first = s.split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bx\b|;)\s*/i)[0].trim();
  return (first || s).replace(/\s*-\s*Topic$/i, '');
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function emptyDay(key) {
  return { day: key, tracks: {}, artists: {}, albums: {}, hours: new Array(24).fill(0), ms: 0, plays: 0 };
}

function createStats(dir) {
  const cache = new Map();         // dayKey -> day object
  const dirty = new Set();
  let timer = null;

  const fileFor = (key) => path.join(dir, `${key}.json`);

  function load(key) {
    if (cache.has(key)) return cache.get(key);
    let day = null;
    try { day = JSON.parse(fs.readFileSync(fileFor(key), 'utf8')); } catch (e) { /* new day */ }
    if (!day || typeof day !== 'object' || !day.tracks) day = emptyDay(key);
    if (!Array.isArray(day.hours) || day.hours.length !== 24) day.hours = new Array(24).fill(0);
    cache.set(key, day);
    return day;
  }

  function scheduleSave() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, 2000);
    if (timer.unref) timer.unref();
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty.size) return;
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    for (const key of dirty) {
      try { fs.writeFileSync(fileFor(key), JSON.stringify(cache.get(key))); } catch (e) { /* ignore */ }
    }
    dirty.clear();
  }

  // One batch of listening: [{ track: {id,title,artist,album,thumbnail,duration,url,platform}, ms, plays, ts }]
  function record(events) {
    let accepted = 0;
    for (const ev of Array.isArray(events) ? events : []) {
      const t = ev && ev.track;
      const ms = Math.round(Number(ev && ev.ms) || 0);
      const plays = Math.max(0, Math.round(Number(ev && ev.plays) || 0));
      if (!t || !t.id || (ms <= 0 && plays <= 0) || ms > 6 * 3600 * 1000) continue;
      const ts = Number(ev.ts) || Date.now();
      const day = load(dayKey(ts));
      const id = String(t.id).slice(0, 80);
      const entry = day.tracks[id] || (day.tracks[id] = { id, ms: 0, plays: 0 });
      entry.ms += ms; entry.plays += plays;
      entry.track = {
        id, title: String(t.title || '').slice(0, 200), artist: String(t.artist || '').slice(0, 200), album: String(t.album || '').slice(0, 200),
        thumbnail: String(t.thumbnail || '').slice(0, 500), duration: Number(t.duration) || 0, url: String(t.url || '').slice(0, 300), platform: String(t.platform || '').slice(0, 20)
      };
      const artist = primaryArtist(t.artist);
      if (artist) {
        const k = norm(artist);
        const a = day.artists[k] || (day.artists[k] = { name: artist, ms: 0, plays: 0, thumbnail: '' });
        a.ms += ms; a.plays += plays; if (!a.thumbnail && t.thumbnail) a.thumbnail = String(t.thumbnail).slice(0, 500);
      }
      const albumName = String(t.album || '').trim();
      if (albumName) {
        const k = `${norm(albumName)}::${norm(artist)}`;
        const al = day.albums[k] || (day.albums[k] = { name: albumName, artist, ms: 0, plays: 0, thumbnail: '' });
        al.ms += ms; al.plays += plays; if (!al.thumbnail && t.thumbnail) al.thumbnail = String(t.thumbnail).slice(0, 500);
      }
      day.hours[new Date(ts).getHours()] += ms;
      day.ms += ms; day.plays += plays;
      dirty.add(day.day);
      accepted++;
    }
    if (accepted) scheduleSave();
    return accepted;
  }

  function allDayKeys() {
    const keys = new Set(dirty);
    for (const k of cache.keys()) keys.add(k);
    try { for (const f of fs.readdirSync(dir)) { const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (m) keys.add(m[1]); } } catch (e) { /* no stats yet */ }
    return [...keys].sort();
  }

  function inPeriod(key, period, now) {
    if (period === 'all') return true;
    const d = new Date(`${key}T12:00:00`);
    if (period === 'year') return d.getFullYear() === now.getFullYear();
    if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
    return d >= start && d <= new Date(now.getTime() + 86400000);
  }

  function summary(period = 'month', now = new Date()) {
    if (!PERIODS.includes(period)) period = 'month';
    const keys = allDayKeys();
    const tracks = {}, artists = {}, albums = {}, hours = new Array(24).fill(0), perDay = {};
    let totalMs = 0, totalPlays = 0;
    for (const key of keys) {
      if (!inPeriod(key, period, now)) continue;
      const day = load(key);
      totalMs += day.ms; totalPlays += day.plays;
      perDay[key] = day.ms;
      day.hours.forEach((v, i) => { hours[i] += v; });
      for (const [id, e] of Object.entries(day.tracks)) {
        const t = tracks[id] || (tracks[id] = { ...e.track, id, ms: 0, plays: 0 });
        t.ms += e.ms; t.plays += e.plays; if (e.track && e.track.thumbnail) t.thumbnail = e.track.thumbnail;
      }
      for (const [k, e] of Object.entries(day.artists)) { const a = artists[k] || (artists[k] = { name: e.name, ms: 0, plays: 0, thumbnail: e.thumbnail }); a.ms += e.ms; a.plays += e.plays; if (!a.thumbnail) a.thumbnail = e.thumbnail; }
      for (const [k, e] of Object.entries(day.albums)) { const a = albums[k] || (albums[k] = { name: e.name, artist: e.artist, ms: 0, plays: 0, thumbnail: e.thumbnail }); a.ms += e.ms; a.plays += e.plays; if (!a.thumbnail) a.thumbnail = e.thumbnail; }
    }
    const rank = (obj, n) => Object.values(obj).sort((a, b) => b.ms - a.ms || b.plays - a.plays).slice(0, n);
    const days = Object.entries(perDay).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]);
    const peakHour = hours.some((v) => v > 0) ? hours.indexOf(Math.max(...hours)) : null;
    // consecutive days with listening, counting back from today (or yesterday if today is still empty)
    let streak = 0;
    const cursor = new Date(now); cursor.setHours(12, 0, 0, 0);
    const played = new Set(keys.filter((k) => (cache.get(k) || load(k)).ms > 0));
    if (!played.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (played.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return {
      period,
      totalMs, totalPlays,
      songs: rank(tracks, MAX_TOP.songs), artists: rank(artists, MAX_TOP.artists), albums: rank(albums, MAX_TOP.albums),
      hourOfDay: hours, peakHour,
      busiestDay: days.length ? { date: days[0][0], ms: days[0][1] } : null,
      activeDays: days.length,
      distinctSongs: Object.keys(tracks).length, distinctArtists: Object.keys(artists).length, distinctAlbums: Object.keys(albums).length,
      streakDays: streak,
      since: keys.length ? keys[0] : null
    };
  }

  function reset() {
    flush();
    cache.clear(); dirty.clear();
    try { for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) fs.unlinkSync(path.join(dir, f)); } catch (e) { /* nothing to remove */ }
  }

  return { record, summary, flush, reset };
}

module.exports = { createStats, primaryArtist, dayKey, PERIODS };
