const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { DATA_DIR } = require('./platform');
const logger = require('./logger');

const AUTH_PATH = path.join(DATA_DIR, 'ytm-auth.json');
const CLIENT_VERSION = '1.20250101.01.00';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let authCache = null;
let homeCache = null;

function safeStorage() {
  try { return process.versions.electron ? require('electron').safeStorage : null; } catch (e) { return null; }
}

function loadAuth() {
  if (authCache) return authCache;
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    let cookie = raw.cookie || '';
    if (raw.enc) {
      const ss = safeStorage();
      cookie = ss && ss.isEncryptionAvailable() ? ss.decryptString(Buffer.from(raw.enc, 'base64')) : '';
    }
    if (cookie) authCache = { cookie };
  } catch (e) {}
  return authCache;
}

function saveAuth(cookie) {
  const ss = safeStorage();
  const payload = ss && ss.isEncryptionAvailable()
    ? { enc: ss.encryptString(cookie).toString('base64') }
    : { cookie };
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(payload), { mode: 0o600 });
  authCache = { cookie };
  homeCache = null;
  homeCacheByParams.clear();
  tabCache.clear();
}

function clearAuth() {
  authCache = null;
  homeCache = null;
  homeCacheByParams.clear();
  tabCache.clear();
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
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
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
  return makeTrack(videoId, title, artist.replace(/\s*-\s*Topic$/i, '').trim(), duration, bestThumb(thumbs, videoId), looksLikeAlbum(albumGuess) ? albumGuess : '');
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
    out.push(makeTrack(r.videoId, runsText(r.title), (segs[0] || '').replace(/\s*-\s*Topic$/i, ''), parseDuration(runsText(r.lengthText)), bestThumb(r.thumbnail && r.thumbnail.thumbnails, r.videoId), looksLikeAlbum(segs[1]) ? segs[1] : ''));
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

const ROUTES = new Set(['/api/ytm-status', '/api/ytm-import-cookie', '/api/ytm-logout', '/api/ytm-home', '/api/ytm-collection', '/api/ytm-radio', '/api/ytm-tab', '/api/ytm-artist']);

async function handleRoute(parsedUrl, req, res) {
  const p = parsedUrl.pathname;
  try {
    if (p === '/api/ytm-status') {
      return sendJson(res, 200, { success: true, connected: !!loadAuth() });
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
      const data = await fetchHome(parsedUrl.query.refresh === '1', String(parsedUrl.query.params || ''));
      if (!data.connected && loadAuth()) {
        clearAuth();
        return sendJson(res, 200, { success: false, expired: true, error: 'YouTube Music session expired' });
      }
      return sendJson(res, 200, { success: true, connected: data.connected, sections: data.sections, chips: data.chips, wave: waveTracks(data.sections) });
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
    if (e.authExpired) { clearAuth(); return sendJson(res, 200, { success: false, expired: true, error: 'YouTube Music session expired' }); }
    return sendJson(res, 200, { success: false, error: e.message });
  }
  return sendJson(res, 404, { success: false, error: 'not found' });
}

module.exports = { connectWithCookie, fetchHome, fetchTab, ROUTES, handleRoute, parseHomeSections, parsePanelTracks, collectListItems, waveTracks };
