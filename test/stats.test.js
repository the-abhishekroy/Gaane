const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStats, primaryArtist } = require('../stats');
const { createRecorder } = require('../listening-recorder');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gaane-stats-'));
const track = (id, artist, album, extra = {}) => ({ id, title: `Song ${id}`, artist, album, thumbnail: `t-${id}.jpg`, duration: 200, platform: 'youtube', ...extra });
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();

test('primaryArtist keeps the lead credit only', () => {
  assert.strictEqual(primaryArtist('Arijit Singh, Pritam & Amitabh'), 'Arijit Singh');
  assert.strictEqual(primaryArtist('Dua Lipa feat. Elton John'), 'Dua Lipa');
  assert.strictEqual(primaryArtist('Aditya Rikhari - Topic'), 'Aditya Rikhari');
  assert.strictEqual(primaryArtist(''), '');
});

test('record merges listening into songs, artists and albums and ignores junk', () => {
  const stats = createStats(tmp());
  const n = stats.record([
    { track: track('a', 'Arijit Singh, Pritam', 'Album One'), ms: 60000, plays: 1, ts: at(2026, 10, 20) },
    { track: track('a', 'Arijit Singh, Pritam', 'Album One'), ms: 30000, plays: 0, ts: at(2026, 10, 20) },
    { track: track('b', 'Arijit Singh', ''), ms: 10000, plays: 0, ts: at(2026, 10, 20, 22) },
    { track: null, ms: 5000 }, { track: track('c', 'X', ''), ms: 0, plays: 0 }, { track: track('d', 'X', ''), ms: 99 * 3600 * 1000, plays: 0 }
  ]);
  assert.strictEqual(n, 3);
  const s = stats.summary('all', new Date(2026, 9, 21));
  assert.strictEqual(s.totalMs, 100000);
  assert.strictEqual(s.totalPlays, 1);
  assert.strictEqual(s.songs[0].id, 'a');
  assert.strictEqual(s.songs[0].ms, 90000);
  assert.strictEqual(s.artists.length, 1);
  assert.strictEqual(s.artists[0].name, 'Arijit Singh');
  assert.strictEqual(s.artists[0].ms, 100000);
  assert.strictEqual(s.albums.length, 1);
  assert.strictEqual(s.albums[0].name, 'Album One');
  assert.strictEqual(s.distinctSongs, 2);
  assert.strictEqual(s.hourOfDay[12], 90000);
  assert.strictEqual(s.hourOfDay[22], 10000);
  assert.strictEqual(s.peakHour, 12);
});

test('periods only include their own days and the data survives a restart', () => {
  const dir = tmp();
  const stats = createStats(dir);
  stats.record([
    { track: track('old', 'A', ''), ms: 1000, ts: at(2025, 3, 1) },
    { track: track('month', 'B', ''), ms: 2000, ts: at(2026, 10, 2) },
    { track: track('week', 'C', ''), ms: 4000, ts: at(2026, 10, 24) },
    { track: track('today', 'D', ''), ms: 8000, ts: at(2026, 10, 25) }
  ]);
  stats.flush();
  const reopened = createStats(dir);
  const now = new Date(2026, 9, 25, 15);
  assert.strictEqual(reopened.summary('all', now).totalMs, 15000);
  assert.strictEqual(reopened.summary('year', now).totalMs, 14000);
  assert.strictEqual(reopened.summary('month', now).totalMs, 14000);
  assert.strictEqual(reopened.summary('week', now).totalMs, 12000);
  assert.strictEqual(reopened.summary('all', now).since, '2025-03-01');
});

test('streak counts consecutive listening days up to today, busiest day is reported', () => {
  const stats = createStats(tmp());
  stats.record([
    { track: track('a', 'A', ''), ms: 1000, ts: at(2026, 10, 22) },
    { track: track('a', 'A', ''), ms: 9000, ts: at(2026, 10, 23) },
    { track: track('a', 'A', ''), ms: 1000, ts: at(2026, 10, 24) },
    { track: track('a', 'A', ''), ms: 1000, ts: at(2026, 10, 25) },
    { track: track('a', 'A', ''), ms: 1000, ts: at(2026, 10, 20) }
  ]);
  const s = stats.summary('all', new Date(2026, 9, 25, 18));
  assert.strictEqual(s.streakDays, 4);
  assert.strictEqual(s.busiestDay.date, '2026-10-23');
  assert.strictEqual(s.activeDays, 5);
});

test('reset removes everything', () => {
  const dir = tmp();
  const stats = createStats(dir);
  stats.record([{ track: track('a', 'A', ''), ms: 5000, ts: Date.now() }]);
  stats.flush();
  stats.reset();
  assert.strictEqual(stats.summary('all').totalMs, 0);
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 0);
});

// ---- recorder
function fakeClock() { let t = 1_000_000; return { now: () => t, advance: (ms) => { t += ms; } }; }

test('recorder: the first tick of a track only anchors; later ticks add wall-clock time', () => {
  const c = fakeClock(); const out = [];
  const r = createRecorder((b) => out.push(...b), c.now);
  const tr = track('a', 'A', '');
  r.tick(tr, 200000); c.advance(1000); r.tick(tr, 200000); c.advance(1000); r.tick(tr, 200000);
  r.flush();
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].ms, 2000);
  assert.strictEqual(out[0].plays, 0);
});

test('recorder: a long gap (pause, sleep) is capped, so pausing cannot inflate listening', () => {
  const c = fakeClock(); const out = [];
  const r = createRecorder((b) => out.push(...b), c.now);
  const tr = track('a', 'A', '');
  r.tick(tr, 200000); c.advance(3600 * 1000); r.tick(tr, 200000); r.flush();
  assert.strictEqual(out[0].ms, 8000);
  const r2 = createRecorder((b) => out.push(...b), c.now);
  r2.tick(tr, 200000); r2.stop(); c.advance(3600 * 1000); r2.tick(tr, 200000); r2.flush();
  assert.strictEqual(out.length, 1, 'after stop the next tick re-anchors and adds nothing');
});

test('recorder: a play is counted once, after half the track (min 30 s, max 4 min)', () => {
  const c = fakeClock(); const out = [];
  const r = createRecorder((b) => out.push(...b), c.now);
  const tr = track('a', 'A', '');
  r.tick(tr, 200000);
  let plays = 0;
  for (let i = 0; i < 150; i++) { c.advance(1000); r.tick(tr, 200000); if (i % 5 === 0) { r.flush(); } }
  r.flush();
  plays = out.reduce((s, e) => s + e.plays, 0);
  assert.strictEqual(plays, 1);
  const short = []; const c2 = fakeClock();
  const r2 = createRecorder((b) => short.push(...b), c2.now);
  const quick = track('q', 'A', '');
  r2.tick(quick, 200000);
  for (let i = 0; i < 20; i++) { c2.advance(1000); r2.tick(quick, 200000); }
  r2.flush();
  assert.strictEqual(short.reduce((s, e) => s + e.plays, 0), 0, 'twenty seconds of a long track is not a listen');
});

test('recorder: switching tracks starts a new anchor for the new track', () => {
  const c = fakeClock(); const out = [];
  const r = createRecorder((b) => out.push(...b), c.now);
  const a = track('a', 'A', ''), b = track('b', 'B', '');
  r.tick(a, 200000); c.advance(1000); r.tick(a, 200000); c.advance(1000); r.tick(b, 200000); c.advance(1000); r.tick(b, 200000); r.flush();
  const byId = Object.fromEntries(out.map((e) => [e.track.id, e.ms]));
  assert.strictEqual(byId.a, 1000);
  assert.strictEqual(byId.b, 1000);
});
