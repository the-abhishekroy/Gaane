const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { DATA_DIR } = require('./platform');
const logger = require('./logger');
const signin = require('./ytm-signin');

const AUTH_PATH = path.join(DATA_DIR, 'ytm-auth.json');
const CLIENT_VERSION = '1.20250101.01.00';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let authCache = null;
let accountCache = null;
let homeCache = null;

function safeStorage() {
  try { return process.versions.electron ? require('electron').safeStorage : null; } catch (e) { return null; }
}

// The saved session never depends on the macOS Keychain (its key differs between a dev run and the installed app,
// which used to make Gaane forget the login). It is sealed with a key kept next to it in the data folder.
const KEY_PATH = path.join(DATA_DIR, 'ytm-auth.key');
function localKey() {
  try {
    const k = fs.readFileSync(KEY_PATH);
    if (k.length === 32) return k;
  } catch (e) {}
  const k = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, k, { mode: 0o600 });
  return k;
}
function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', localKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { v: 2, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unseal(p) {
  const d = crypto.createDecipheriv('aes-256-gcm', localKey(), Buffer.from(p.iv, 'base64'));
  d.setAuthTag(Buffer.from(p.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(p.data, 'base64')), d.final()]).toString('utf8');
}

function writeAuthFile(cookie) {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  const tmp = AUTH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(seal(cookie)), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_PATH);
}

function loadAuth() {
  if (authCache) return authCache;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')); } catch (e) { return null; }
  let cookie = '';
  let legacy = false;
  try {
    if (raw.v === 2) cookie = unseal(raw);
    else if (raw.enc) {
      const ss = safeStorage();
      if (ss && ss.isEncryptionAvailable()) cookie = ss.decryptString(Buffer.from(raw.enc, 'base64'));
      legacy = true;
    } else if (raw.cookie) { cookie = raw.cookie; legacy = true; }
  } catch (e) {
    logger.log('warn', `Saved YouTube Music login could not be read (${e.message}); the file is kept untouched`);
  }
  if (cookie) {
    authCache = { cookie };
    if (legacy) { try { writeAuthFile(cookie); } catch (e) {} }   // move old Keychain-sealed logins to the stable format
  }
  return authCache;
}

function saveAuth(cookie) {
  accountCache = null;
  writeAuthFile(cookie);
  authCache = { cookie };
  homeCache = null;
  homeCacheByParams.clear();
  tabCache.clear();
  authFailures = 0;
}

// Google rotates parts of the session cookie while you use it; keep the newest values so the login keeps working.
let persistTimer = null;
function mergeSetCookies(setCookie) {
  if (!authCache || !Array.isArray(setCookie) || !setCookie.length) return;
  let cookie = authCache.cookie, changed = false;
  for (const line of setCookie) {
    const first = String(line).split(';')[0];
    const eq = first.indexOf('=');
    if (eq < 1) continue;
    const name = first.slice(0, eq).trim(), value = first.slice(eq + 1).trim();
    const attrs = String(line).toLowerCase();
    const maxAge = /max-age=(-?\d+)/.exec(attrs);
    if (!value || (maxAge && parseInt(maxAge[1], 10) <= 0) || /expires=[^;]*(19|1970)/.test(attrs)) continue;   // deletions never log us out
    if (!/^(__Secure-[13]P(SID|APISID|SIDTS|SIDCC)|S?SID|HSID|SSID|S?APISID|SIDCC|LOGIN_INFO|VISITOR_INFO1_LIVE|__Secure-ROLLOUT_TOKEN)$/.test(name)) continue;
    const re = new RegExp('(^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=[^;]*');
    if (re.test(cookie)) { if (cookieValue(cookie, name) !== value) { cookie = cookie.replace(re, `$1${name}=${value}`); changed = true; } }
    else { cookie = cookie.replace(/;?\s*$/, '') + `; ${name}=${value}`; changed = true; }
  }
  if (!changed) return;
  authCache = { cookie };
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { try { writeAuthFile(authCache.cookie); } catch (e) {} }, 600);
}

// The saved login is only ever removed by the user (Disconnect). A failed request marks it "needs attention"
// after several confirmed failures, but the cookie stays, so a hiccup never signs you out.
let authFailures = 0, lastGoodAt = 0;
function noteAuthResult(ok) {
  if (ok) { authFailures = 0; lastGoodAt = Date.now(); } else authFailures++;
}
function needsReconnect() {
  return !!authCache && authFailures >= 3 && Date.now() - lastGoodAt > 20 * 60 * 1000;
}

function clearAuth() {
  accountCache = null;
  authCache = null;
  homeCache = null;
  homeCacheByParams.clear();
  tabCache.clear();
  authFailures = 0;
  try { fs.unlinkSync(AUTH_PATH); } catch (e) {}
}

function cookieValue(cookie, name) {
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1] : '';
}

function authHeaders(cookie) {
  const sapisid = cookieValue(cookie, 'SAPISID') || cookieValue(cookie, '__Secure-3PAPISID');
  const headers = { Cookie: cookie };
  if (sapisid) {
    const ts = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash('sha1').update(`${ts} ${sapisid} https://music.youtube.com`).digest('hex');
    headers.Authorization = `SAPISIDHASH ${ts}_${hash}`;
    headers['X-Goog-AuthUser'] = '0';
    headers['X-Origin'] = 'https://music.youtube.com';
  }
  return headers;
}

function ytmRequest(endpoint, extra = {}, query = '', visitorData = '') {
  return new Promise((resolve, reject) => {
    const auth = loadAuth();
    const body = JSON.stringify(Object.assign({
      context: { client: Object.assign({ clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSION, hl: 'en' }, visitorData ? { visitorData } : {}), user: {} }
    }, extra));
    const req = https.request({
      hostname: 'music.youtube.com',
      path: `/youtubei/v1/${endpoint}?prettyPrint=false${query}`,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
        'User-Agent': UA
      }, auth ? authHeaders(auth.cookie) : {})
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      if (auth) { try { mergeSetCookies(res.headers['set-cookie']); } catch (e) {} }
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (auth) noteAuthResult(res.statusCode === 200);
        if (res.statusCode === 401 || res.statusCode === 403) {
          const err = new Error('auth');
          err.authExpired = true;
          return reject(err);
        }
        if (res.statusCode !== 200) return reject(new Error(`ytmusic ${endpoint} status ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('ytmusic timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function isLoggedInResponse(json) {
  const params = (json && json.responseContext && json.responseContext.serviceTrackingParams) || [];
  for (const sp of params) {
    for (const p of (sp.params || [])) if (p.key === 'logged_in') return p.value === '1';
  }
  return false;
}

const runsText = (obj) => ((obj && obj.runs) || []).map((r) => r.text).join('');

function bestThumb(thumbs, videoId) {
  const list = thumbs || [];
  let url = list.length ? list[list.length - 1].url : (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
  return url.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544');
}

const looksLikeAlbum = (t) => !!t && !/^\d{4}$/.test(t) && !/\b(plays?|views?|subscribers?|crore|lakh|[KMB]\b)/i.test(t) && !/^\d+(:\d{2}){1,2}$/.test(t);

function parseDuration(text) {
  if (!text || !/^\d+(:\d{1,2}){1,2}$/.test(text.trim())) return 0;
  return text.trim().split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
}

const isVideoType = (t) => !!t && t !== 'MUSIC_VIDEO_TYPE_ATV';

function makeTrack(id, title, artist, duration, thumbnail, album) {
  return {
    id, title, artist: artist || 'Unknown Artist', duration: duration || 180, album: album || '',
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube'
  };
}

function splitBylineRuns(runs) {
  const segs = [];
  let cur = [];
  for (const run of runs || []) {
    if (/^\s*[•·]\s*$/.test(run.text)) { segs.push(cur.join('').trim()); cur = []; } else cur.push(run.text);
  }
  segs.push(cur.join('').trim());
  return segs.filter((s) => s && !/^(song|video|single|album|ep)$/i.test(s));
}

function parseListItem(r) {
  const cols = r.flexColumns || [];
  const runsOf = (i) => (cols[i] && cols[i].musicResponsiveListItemFlexColumnRenderer && cols[i].musicResponsiveListItemFlexColumnRenderer.text && cols[i].musicResponsiveListItemFlexColumnRenderer.text.runs) || [];
  const overlay = r.overlay && r.overlay.musicItemThumbnailOverlayRenderer && r.overlay.musicItemThumbnailOverlayRenderer.content && r.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer;
  const videoId = (r.playlistItemData && r.playlistItemData.videoId) || (overlay && overlay.playNavigationEndpoint && overlay.playNavigationEndpoint.watchEndpoint && overlay.playNavigationEndpoint.watchEndpoint.videoId);
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;
  const title = runsOf(0).map((x) => x.text).join('').trim();
  const segs = splitBylineRuns(runsOf(1));
  let artist = segs[0] || '';
  // Library/likes lists put artist in column 1 as bare runs and album in column 2.
  if (!artist) artist = runsOf(1).map((x) => x.text).join('').trim();
  const fixed = (r.fixedColumns && r.fixedColumns[0] && r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer && r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer.text) || null;
  const duration = parseDuration(runsText(fixed)) || parseDuration(segs[segs.length - 1]);
  const thumbs = r.thumbnail && r.thumbnail.musicThumbnailRenderer && r.thumbnail.musicThumbnailRenderer.thumbnail && r.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
  if (!title) return null;
  const albumGuess = runsText(cols[2] && cols[2].musicResponsiveListItemFlexColumnRenderer && cols[2].musicResponsiveListItemFlexColumnRenderer.text).trim() || (segs.length > 2 ? segs[1] : '');
  const track = makeTrack(videoId, title, artist.replace(/\s*-\s*Topic$/i, '').trim(), duration, bestThumb(thumbs, videoId), looksLikeAlbum(albumGuess) ? albumGuess : '');
  const vt = overlay && overlay.playNavigationEndpoint && overlay.playNavigationEndpoint.watchEndpoint && overlay.playNavigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs && overlay.playNavigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig && overlay.playNavigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType;
  if (isVideoType(vt)) track.isVideo = true;
  return track;
}

function parseTwoRowItemInner(r) {
  const title = runsText(r.title).trim();
  if (!title) return null;
  const nav = r.navigationEndpoint || {};
  const overlay = r.thumbnailOverlay && r.thumbnailOverlay.musicItemThumbnailOverlayRenderer && r.thumbnailOverlay.musicItemThumbnailOverlayRenderer.content && r.thumbnailOverlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer;
  const play = (overlay && overlay.playNavigationEndpoint) || nav;
  const thumbs = r.thumbnailRenderer && r.thumbnailRenderer.musicThumbnailRenderer && r.thumbnailRenderer.musicThumbnailRenderer.thumbnail && r.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails;
  const segs = splitBylineRuns(r.subtitle && r.subtitle.runs);
  const videoId = (nav.watchEndpoint && nav.watchEndpoint.videoId) || (play.watchEndpoint && play.watchEndpoint.videoId);
  if (videoId && /^[\w-]{11}$/.test(videoId) && !(play.watchPlaylistEndpoint)) {
    return { kind: 'track', track: makeTrack(videoId, title, (segs[0] || '').replace(/\s*-\s*Topic$/i, ''), 0, bestThumb(thumbs, videoId)) };
  }
  const playlistId = (play.watchPlaylistEndpoint && play.watchPlaylistEndpoint.playlistId) || (play.watchEndpoint && play.watchEndpoint.playlistId) || (nav.watchPlaylistEndpoint && nav.watchPlaylistEndpoint.playlistId);
  if (playlistId) {
    return { kind: 'collection', id: playlistId, title, subtitle: segs.join(' • '), thumbnail: bestThumb(thumbs, '') };
  }
  const browseId = nav.browseEndpoint && nav.browseEndpoint.browseId;
  if (browseId && /^VL/.test(browseId)) {
    return { kind: 'collection', id: browseId.slice(2), title, subtitle: segs.join(' • '), thumbnail: bestThumb(thumbs, '') };
  }
  if (browseId && /^UC/.test(browseId)) {
    return { kind: 'artist', id: browseId, title, subtitle: segs.join(' • '), thumbnail: bestThumb(thumbs, '') };
  }
  return null;
}

function parseTwoRowItem(r) {
  const it = parseTwoRowItemInner(r);
  if (it) {
    const wide = /16_9|RECTANGULAR/i.test(r.aspectRatio || '');
    if (it.kind === 'track') it.track.wide = wide; else it.wide = wide;
  }
  return it;
}

function parseShelfItems(contents) {
  const tracks = [];
  const collections = [];
  const items = [];
  for (const wrap of contents || []) {
    if (wrap.musicResponsiveListItemRenderer) {
      const t = parseListItem(wrap.musicResponsiveListItemRenderer);
      if (t) { t.list = true; tracks.push(t); items.push({ kind: 'track', track: t }); }
    } else if (wrap.musicTwoRowItemRenderer) {
      const it = parseTwoRowItem(wrap.musicTwoRowItemRenderer);
      if (it && it.kind === 'track') { tracks.push(it.track); items.push(it); }
      else if (it) { collections.push(it); items.push(it); }
    }
  }
  return { tracks, collections, items };
}

const SHELF_KEYS = ['musicCarouselShelfRenderer', 'musicImmersiveCarouselShelfRenderer', 'musicShelfRenderer', 'musicPlaylistShelfRenderer', 'gridRenderer'];

function shelfTitle(shelf) {
  const header = shelf.header && (shelf.header.musicCarouselShelfBasicHeaderRenderer || shelf.header.musicImmersiveCarouselShelfBasicHeaderRenderer || shelf.header.gridHeaderRenderer);
  return (header && runsText(header.title)) || runsText(shelf.title) || '';
}

function walkShelves(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 16) return out;
  if (Array.isArray(node)) { node.forEach((n) => walkShelves(n, out, depth + 1)); return out; }
  for (const key of Object.keys(node)) {
    if (SHELF_KEYS.includes(key)) {
      const shelf = node[key];
      const { tracks, collections, items } = parseShelfItems(shelf.contents || shelf.items);
      if (tracks.length || collections.length) {
        const title = shelfTitle(shelf);
        const all = tracks.length + collections.length;
        const wideCount = tracks.filter((t) => t.wide).length + collections.filter((c) => c.wide).length;
        let layout = 'cards';
        if (/speed dial/i.test(title)) layout = 'grid';
        else if (tracks.length && !collections.length && tracks.every((t) => t.list)) layout = 'list';
        else if (wideCount > all / 2) layout = 'wide';
        out.push({ title, layout, tracks, collections, items });
      }
    } else {
      walkShelves(node[key], out, depth + 1);
    }
  }
  return out;
}

function findContinuation(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 16) return null;
  if (node.nextContinuationData && node.nextContinuationData.continuation) return node.nextContinuationData.continuation;
  for (const key of Object.keys(node)) {
    const r = findContinuation(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

// Parses any browse page (home, library, history, explore) into titled shelves.
function parseHomeSections(json) {
  const cc = json && json.continuationContents;
  let sections;
  if (cc && cc.musicShelfContinuation) {
    const { tracks, collections } = parseShelfItems(cc.musicShelfContinuation.contents);
    sections = [{ title: '', tracks, collections }];
  } else if (cc && cc.gridContinuation) {
    const { tracks, collections } = parseShelfItems(cc.gridContinuation.items);
    sections = [{ title: '', tracks, collections }];
  } else {
    sections = walkShelves(cc || (json && json.contents) || {}, []);
  }
  return { sections, continuation: findContinuation(json) };
}

function collectListItems(node, acc, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectListItems(n, acc, depth + 1)); return acc; }
  if (node.musicResponsiveListItemRenderer) {
    const t = parseListItem(node.musicResponsiveListItemRenderer);
    if (t) acc.push(t);
    return acc;
  }
  for (const k of Object.keys(node)) collectListItems(node[k], acc, depth + 1);
  return acc;
}

function parsePanelTracks(json) {
  const tabs = json && json.contents && json.contents.singleColumnMusicWatchNextResultsRenderer && json.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer && json.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer && json.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs;
  const panel = tabs && tabs[0] && tabs[0].tabRenderer && tabs[0].tabRenderer.content && tabs[0].tabRenderer.content.musicQueueRenderer && tabs[0].tabRenderer.content.musicQueueRenderer.content && tabs[0].tabRenderer.content.musicQueueRenderer.content.playlistPanelRenderer;
  const out = [];
  for (const wrap of (panel && panel.contents) || []) {
    const r = wrap.playlistPanelVideoRenderer || (wrap.playlistPanelVideoWrapperRenderer && wrap.playlistPanelVideoWrapperRenderer.primaryRenderer && wrap.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer);
    if (!r || !r.videoId) continue;
    const segs = splitBylineRuns(r.longBylineText && r.longBylineText.runs);
    const pt = makeTrack(r.videoId, runsText(r.title), (segs[0] || '').replace(/\s*-\s*Topic$/i, ''), parseDuration(runsText(r.lengthText)), bestThumb(r.thumbnail && r.thumbnail.thumbnails, r.videoId), looksLikeAlbum(segs[1]) ? segs[1] : '');
    const mt = r.navigationEndpoint && r.navigationEndpoint.watchEndpoint && r.navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs && r.navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig && r.navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType;
    if (isVideoType(mt)) pt.isVideo = true;
    out.push(pt);
  }
  return out;
}

function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

const TAB_PAGES = {
  library: [['FEmusic_liked_videos', 'Liked songs'], ['FEmusic_liked_playlists', 'Playlists'], ['FEmusic_liked_albums', 'Albums'], ['FEmusic_library_corpus_artists', 'Artists']],
  history: [['FEmusic_history', 'History']],
  explore: [['FEmusic_explore', 'Explore'], ['FEmusic_charts', 'Charts'], ['FEmusic_new_releases_albums', 'New releases']]
};
const tabCache = new Map();

async function fetchPaged(browseId, maxPages, params = '') {
  const first = await ytmRequest('browse', params ? { browseId, params } : { browseId });
  const visitorData = (first.responseContext && first.responseContext.visitorData) || '';
  let { sections, continuation } = parseHomeSections(first);
  for (let i = 0; i < maxPages && continuation; i++) {
    try {
      const next = await ytmRequest('browse', {}, `&ctoken=${encodeURIComponent(continuation)}&continuation=${encodeURIComponent(continuation)}&type=next`, visitorData);
      const parsed = parseHomeSections(next);
      if (parsed.sections.length && parsed.sections.every((x) => !x.title) && sections.length) {
        const last = sections[sections.length - 1];
        parsed.sections.forEach((x) => { last.tracks.push(...x.tracks); last.collections.push(...x.collections); last.items = (last.items || []).concat(x.items || []); });
      } else {
        sections = sections.concat(parsed.sections);
      }
      continuation = parsed.continuation;
    } catch (e) { break; }
  }
  return { first, sections };
}

function findChips(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (node.chipCloudRenderer && Array.isArray(node.chipCloudRenderer.chips)) {
    return node.chipCloudRenderer.chips.map((c) => {
      const r = c.chipCloudChipRenderer || {};
      const be = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
      const text = runsText(r.text) || (typeof r.text === 'string' ? r.text : '');
      return text && be && be.params ? { title: text, params: be.params, selected: !!r.isSelected } : null;
    }).filter(Boolean);
  }
  for (const key of Object.keys(node)) {
    const r = findChips(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

const homeCacheByParams = new Map();

async function fetchHome(force, params = '') {
  const hit = homeCacheByParams.get(params);
  if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  const { first, sections: homeSections } = await fetchPaged('FEmusic_home', params ? 3 : 10, params);
  const connected = isLoggedInResponse(first);
  const sections = homeSections.slice();
  const chips = findChips(first) || [];
  const data = { connected, sections, chips };
  homeCacheByParams.set(params, { at: Date.now(), data });
  return data;
}

async function fetchTab(tab, force) {
  const hit = tabCache.get(tab);
  if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.sections;
  const pages = TAB_PAGES[tab];
  if (!pages) return [];
  const results = await Promise.all(pages.map(async ([id, label]) => {
    try {
      if (id === 'FEmusic_liked_videos') {
        const liked = dedupe(collectListItems(await ytmRequest('browse', { browseId: id }), []));
        return liked.length ? [{ title: label, tracks: liked, collections: [] }] : [];
      }
      const { sections } = await fetchPaged(id, tab === 'history' ? 6 : 3);
      return sections.map((sec) => ({ ...sec, title: sec.title ? (tab === 'history' ? sec.title : `${label}: ${sec.title}`) : label }));
    } catch (e) {
      if (e.authExpired) throw e;
      logger.log('warn', `ytm ${id} failed: ${e.message}`);
      return [];
    }
  }));
  const sections = results.flat();
  tabCache.set(tab, { at: Date.now(), sections });
  return sections;
}

async function artistTracks(browseId) {
  const json = await ytmRequest('browse', { browseId });
  return dedupe(collectListItems(json, [])).slice(0, 50);
}

function waveTracks(sections) {
  const rank = (title) => (/quick picks|listen again|mixed for you|your|similar|because|more like/i.test(title) ? 0 : 1);
  const ordered = sections.slice().sort((a, b) => rank(a.title) - rank(b.title));
  const lists = ordered.map((s) => s.tracks).filter((l) => l.length);
  const out = [];
  // Round-robin across shelves so the wave mixes quick picks, likes and mixes.
  for (let i = 0; out.length < 30; i++) {
    let added = false;
    for (const l of lists) if (l[i]) { out.push(l[i]); added = true; }
    if (!added) break;
  }
  return dedupe(out).slice(0, 30);
}

// --- Connecting an account -------------------------------------------------
// Google refuses sign-in inside embedded browser windows, so the user signs in to
// music.youtube.com in their normal browser and pastes that session's cookie here.

async function connectWithCookie(cookie) {
  cookie = String(cookie || '').replace(/^cookie:\s*/i, '').replace(/[\r\n]+/g, ' ').trim();
  if (!/(^|;\s*)(SAPISID|__Secure-3PAPISID)=/.test(cookie)) {
    return { ok: false, error: 'That cookie does not include a signed-in YouTube session (SAPISID is missing). Copy the whole cookie value.' };
  }
  const previous = authCache;
  saveAuth(cookie);
  try {
    const data = await fetchHome(true);
    if (data.connected) return { ok: true };
  } catch (e) {}
  if (previous) saveAuth(previous.cookie); else clearAuth();
  return { ok: false, error: 'YouTube Music did not accept that session. Make sure you are signed in there, copy the cookie again, and retry.' };
}

async function logout() {
  clearAuth();
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const ROUTES = new Set(['/api/ytm-status', '/api/ytm-import-cookie', '/api/ytm-logout', '/api/ytm-home', '/api/ytm-collection', '/api/ytm-radio', '/api/ytm-tab', '/api/ytm-artist', '/api/ytm-suggest', '/api/ytm-signin-start', '/api/ytm-signin-status', '/api/ytm-signin-cancel', '/api/ytm-browsers', '/api/ytm-account']);

async function handleRoute(parsedUrl, req, res) {
  const p = parsedUrl.pathname;
  try {
    if (p === '/api/ytm-status') {
      return sendJson(res, 200, { success: true, connected: !!loadAuth(), needsReconnect: needsReconnect() });
    }
    if (p === '/api/ytm-import-cookie' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 65536) return sendJson(res, 413, { success: false, error: 'too large' }); }
      let cookie = '';
      try { cookie = JSON.parse(body).cookie; } catch (e) {}
      const r = await connectWithCookie(cookie);
      return sendJson(res, 200, { success: r.ok, error: r.error });
    }
    if (p === '/api/ytm-logout' && req.method === 'POST') {
      await logout();
      return sendJson(res, 200, { success: true });
    }
    if (p === '/api/ytm-home') {
      let data = await fetchHome(parsedUrl.query.refresh === '1', String(parsedUrl.query.params || ''));
      if (!data.connected && loadAuth()) {
        // not signed-in looking: refresh the session cookie the way a browser would, then ask once more
        await rotateCookies(true);
        try { data = await fetchHome(true, String(parsedUrl.query.params || '')); } catch (e) {}
      }
      if (!data.connected && loadAuth()) {
        noteAuthResult(false);
        if (needsReconnect()) return sendJson(res, 200, { success: false, expired: true, error: 'YouTube Music needs you to connect again' });
        return sendJson(res, 200, { success: false, connected: true, retry: true, error: 'YouTube Music did not answer; trying again shortly' });
      }
      if (data.connected) noteAuthResult(true);
      return sendJson(res, 200, { success: true, connected: data.connected, sections: data.sections, chips: data.chips, wave: waveTracks(data.sections) });
    }
    if (p === '/api/ytm-account') {
      if (!loadAuth()) return sendJson(res, 200, { success: true, connected: false });
      return sendJson(res, 200, { success: true, connected: true, account: await accountInfo() });
    }
    if (p === '/api/ytm-browsers') {
      const list = signin.findBrowsers();
      const def = signin.defaultBrowserName();
      return sendJson(res, 200, { success: true, browsers: list.map((b) => b.name), defaultBrowser: def && !def.startsWith('other:') ? def : '', defaultIsOther: !!def && def.startsWith('other:') });
    }
    if (p === '/api/ytm-signin-start' && req.method === 'POST') {
      const st = await signin.start(connectWithCookie, { browser: String(parsedUrl.query.browser || '') });
      return sendJson(res, 200, { success: true, ...st });
    }
    if (p === '/api/ytm-signin-status') {
      return sendJson(res, 200, { success: true, ...signin.status(), connected: !!loadAuth() });
    }
    if (p === '/api/ytm-signin-cancel' && req.method === 'POST') {
      return sendJson(res, 200, { success: true, ...signin.cancel() });
    }
    if (p === '/api/ytm-suggest') {
      const q = String(parsedUrl.query.q || '').trim().slice(0, 120);
      if (!q) return sendJson(res, 200, { success: true, suggestions: [] });
      return sendJson(res, 200, { success: true, suggestions: await searchSuggestions(q) });
    }
    if (p === '/api/ytm-tab') {
      const tab = String(parsedUrl.query.tab || '');
      if (!TAB_PAGES[tab]) return sendJson(res, 400, { success: false, error: 'bad tab' });
      return sendJson(res, 200, { success: true, sections: await fetchTab(tab, parsedUrl.query.refresh === '1') });
    }
    if (p === '/api/ytm-artist') {
      const id = String(parsedUrl.query.id || '');
      if (!/^UC[\w-]{10,40}$/.test(id)) return sendJson(res, 400, { success: false, error: 'bad id' });
      return sendJson(res, 200, { success: true, tracks: await artistTracks(id) });
    }
    if (p === '/api/ytm-collection') {
      const id = String(parsedUrl.query.id || '');
      if (!/^[\w-]{5,64}$/.test(id)) return sendJson(res, 400, { success: false, error: 'bad id' });
      const json = await ytmRequest('next', { playlistId: id, isAudioOnly: true });
      return sendJson(res, 200, { success: true, tracks: parsePanelTracks(json) });
    }
    if (p === '/api/ytm-radio') {
      const id = String(parsedUrl.query.id || '');
      if (!/^[\w-]{11}$/.test(id)) return sendJson(res, 400, { success: false, error: 'bad id' });
      const json = await ytmRequest('next', { videoId: id, playlistId: `RDAMVM${id}`, isAudioOnly: true });
      return sendJson(res, 200, { success: true, tracks: parsePanelTracks(json).filter((t) => t.id !== id) });
    }
  } catch (e) {
    logger.log('warn', `${p} failed: ${e.message}`);
    if (e.authExpired) {
      if (needsReconnect()) return sendJson(res, 200, { success: false, expired: true, error: 'YouTube Music needs you to connect again' });
      return sendJson(res, 200, { success: false, retry: true, error: 'YouTube Music did not answer; trying again shortly' });
    }
    return sendJson(res, 200, { success: false, error: e.message });
  }
  return sendJson(res, 404, { success: false, error: 'not found' });
}

// What YouTube Music offers while typing (get_search_suggestions), cached briefly per query.
const suggestCache = new Map();
async function searchSuggestions(q) {
  const key = q.toLowerCase();
  const hit = suggestCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list;
  const json = await ytmRequest('music/get_search_suggestions', { input: q });
  const out = [];
  (function walk(n) {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      const r = n.searchSuggestionRenderer;
      if (r && r.suggestion && Array.isArray(r.suggestion.runs)) {
        const text = r.suggestion.runs.map((x) => x.text).join('').trim();
        if (text && !out.includes(text)) out.push(text);
      }
      Object.values(n).forEach(walk);
    }
  })(json);
  const list = out.slice(0, 8);
  if (suggestCache.size > 200) suggestCache.clear();
  suggestCache.set(key, { at: Date.now(), list });
  return list;
}

// Browsers refresh the short-lived part of a Google session (the SIDTS cookie) every few minutes through
// accounts.google.com/RotateCookies. A pasted cookie never gets that refresh unless the app does it too, which is why
// a login used to die after a day or two. This does what the browser does, and keeps whatever Google sends back.
let lastRotate = 0, rotating = null;
function rotateCookies(force) {
  if (!loadAuth()) return Promise.resolve(false);
  if (rotating) return rotating;
  if (!force && Date.now() - lastRotate < 10 * 60 * 1000) return Promise.resolve(true);
  rotating = new Promise((resolve) => {
    const body = '[000,"-0000000000000000000"]';
    const req = https.request({
      hostname: 'accounts.google.com', path: '/RotateCookies', method: 'POST', timeout: 12000,
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        Origin: 'https://accounts.google.com',
        Referer: 'https://accounts.google.com/RotateCookiesPage?origin=https%3A%2F%2Fmusic.youtube.com&yt_pid=1',
        'User-Agent': UA, Cookie: authCache.cookie
      }
    }, (res) => {
      res.resume();
      try { mergeSetCookies(res.headers['set-cookie']); } catch (e) {}
      res.on('end', () => { lastRotate = Date.now(); logger.log('info', `YouTube Music cookie refresh: HTTP ${res.statusCode}`); resolve(res.statusCode === 200); });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  }).finally(() => { rotating = null; });
  return rotating;
}

// Quietly use the saved login now and then so Google keeps handing out fresh session cookies (merged above).
let keepAliveTimer = null;
function startKeepAlive() {
  if (keepAliveTimer) return;
  const tick = async () => {
    if (!loadAuth()) return;
    await rotateCookies(true);
    try { await ytmRequest('browse', { browseId: 'FEmusic_home' }); } catch (e) { /* tried again at the next tick; never signs out */ }
  };
  setTimeout(tick, 8000);
  keepAliveTimer = setInterval(tick, 45 * 60 * 1000);
  if (keepAliveTimer.unref) keepAliveTimer.unref();
}

// Who is signed in: the name, handle and picture YouTube Music shows in its own account menu.
async function accountInfo() {
  if (accountCache && Date.now() - accountCache.at < 10 * 60 * 1000) return accountCache.info;
  let info = { name: 'YouTube Music account', handle: '', photo: '' };
  try {
    const json = await ytmRequest('account/account_menu', {});
    for (const o of walkObjects(json)) {
      const h = o.activeAccountHeaderRenderer;
      if (h) {
        const photos = (h.accountPhoto && h.accountPhoto.thumbnails) || [];
        info = {
          name: joinRuns(h.accountName) || info.name,
          handle: joinRuns(h.channelHandle) || joinRuns(h.email) || '',
          photo: photos.length ? photos[photos.length - 1].url : ''
        };
        break;
      }
    }
  } catch (e) { /* the menu still works without the details */ }
  accountCache = { at: Date.now(), info };
  return info;
}

// ---- lyrics from YouTube itself (used by lyrics-providers.js) ------------------------------------------------
function* walkObjects(node) {
  if (Array.isArray(node)) { for (const n of node) yield* walkObjects(n); }
  else if (node && typeof node === 'object') { yield node; for (const v of Object.values(node)) yield* walkObjects(v); }
}
const joinRuns = (x) => (x && x.runs ? x.runs.map((r) => r.text).join('') : (x && x.simpleText) || '');

// The Lyrics tab of the playing video: plain text, for songs the dedicated lyric databases do not have.
async function youtubeMusicLyrics(videoId) {
  if (!/^[\w-]{11}$/.test(String(videoId || ''))) return null;
  const next = await ytmRequest('next', { videoId, isAudioOnly: true });
  let browseId = null;
  for (const o of walkObjects(next)) {
    const id = o.browseEndpoint && o.browseEndpoint.browseId;
    if (typeof id === 'string' && id.startsWith('MPLYt')) { browseId = id; break; }
  }
  if (!browseId) return null;
  const page = await ytmRequest('browse', { browseId });
  for (const o of walkObjects(page)) {
    if (o.musicDescriptionShelfRenderer) {
      const text = joinRuns(o.musicDescriptionShelfRenderer.description).trim();
      if (text && !/^lyrics not available/i.test(text)) return text;
    }
  }
  return null;
}

module.exports = { youtubeMusicLyrics, rotateCookies, startKeepAlive, mergeSetCookies, _test: { seal, unseal, saveAuth, loadAuth, clearAuth, cookie: () => (authCache ? authCache.cookie : null), reset: () => { authCache = null; } }, searchSuggestions, connectWithCookie, fetchHome, fetchTab, ROUTES, handleRoute, parseHomeSections, parsePanelTracks, collectListItems, waveTracks };
