'use strict';
// ListenBrainz scrobbling (the same service BitChord offers next to Last.fm). The user's token lives in the data dir.
// Last.fm needs an app key and secret registered to a developer account, so it is not wired in.
const fs = require('fs');
const path = require('path');
const https = require('https');

const API = 'api.listenbrainz.org';

function buildPayload(track, kind, listenedAt) {
  const t = track || {};
  const artist = String(t.artist || '').trim();
  const title = String(t.title || '').trim();
  if (!artist || !title) return null;
  const meta = {
    artist_name: artist,
    track_name: title,
    additional_info: { media_player: 'Gaane', submission_client: 'Gaane', duration_ms: Math.round((Number(t.duration) || 0) * 1000) || undefined }
  };
  if (t.album) meta.release_name = String(t.album);
  const entry = { track_metadata: meta };
  if (kind !== 'playing_now') entry.listened_at = Math.floor((listenedAt || Date.now()) / 1000);
  return { listen_type: kind === 'playing_now' ? 'playing_now' : 'single', payload: [entry] };
}

function request(method, p, token, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: API, path: p, method, timeout: 8000,
      headers: Object.assign({ 'User-Agent': 'Gaane/1.2 (https://www.abhishekkroy.me)', Authorization: `Token ${token}` },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(out); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
    if (data) req.write(data);
    req.end();
  });
}

function createScrobbler(dir) {
  const file = path.join(dir, 'scrobble.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; } };
  const write = (o) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(o), { mode: 0o600 }); } catch (e) {} };
  return {
    status() { const s = read(); return { connected: !!s.listenbrainzToken, user: s.user || '' }; },
    async connect(token) {
      const t = String(token || '').replace(/^Token\s+/i, '').trim();
      if (!t) return { ok: false, error: 'Paste your ListenBrainz user token' };
      const r = await request('GET', '/1/validate-token', t);
      if (!r.json || !r.json.valid) return { ok: false, error: 'ListenBrainz did not accept that token' };
      write({ listenbrainzToken: t, user: r.json.user_name || '' });
      return { ok: true, user: r.json.user_name || '' };
    },
    disconnect() { write({}); },
    async submit(track, kind, listenedAt) {
      const s = read();
      if (!s.listenbrainzToken) return { ok: false, error: 'not connected' };
      const body = buildPayload(track, kind, listenedAt);
      if (!body) return { ok: false, error: 'missing artist or title' };
      const r = await request('POST', '/1/submit-listens', s.listenbrainzToken, body);
      return { ok: r.status === 200, status: r.status };
    }
  };
}

module.exports = { createScrobbler, buildPayload };
