const test = require('node:test');
const assert = require('node:assert');
const Q = require('../queue-core');

const song = (id, title, artist = 'A', extra = {}) => Object.assign({ id, title, artist }, extra);
const titles = (tl) => tl.map((t) => t.title);

test('normalised titles drop video noise but keep remix and cover markers', () => {
  assert.strictEqual(Q.normalisedTitle('Kesariya (From "Brahmastra") | Official Video'), 'kesariya');
  assert.strictEqual(Q.normalisedTitle('Kesariya (Official Video)'), 'kesariya');
  assert.notStrictEqual(Q.normalisedTitle('Kesariya (Remix)'), 'kesariya');
  assert.notStrictEqual(Q.normalisedTitle('Kesariya (Cover)'), 'kesariya');
});

test('the same recording is recognised across the audio and video cut, whatever the billing order', () => {
  const a = song('1', 'Kesariya', 'Pritam, Arijit Singh & Shilpa Rao');
  const b = song('2', 'Kesariya (Official Video)', 'Shilpa Rao, Arijit Singh, & Pritam');
  assert.ok(Q.isSameRecording(a, b));
  assert.ok(!Q.isSameRecording(a, song('3', 'Kesariya', 'Someone Else')));
  assert.ok(Q.isSameRecording(a, song('1', 'Different', 'X')), 'same id is the same recording');
});

test('station: no repeats, per-artist caps, songs preferred to videos, limit respected', () => {
  const existing = [song('seed', 'Seed Song', 'Seed Artist')];
  const cands = [
    song('v1', 'Seed Song (Official Video)', 'Seed Artist', { isVideo: true }),
    song('a', 'One', 'Seed Artist'), song('b', 'Two', 'Seed Artist'), song('c', 'Three', 'Seed Artist'), song('d', 'Four', 'Seed Artist'), song('e', 'Five', 'Seed Artist'),
    song('f', 'Six', 'Other'), song('g', 'Seven', 'Other'), song('h', 'Eight', 'Other'),
    song('x', 'Video only', 'Third', { isVideo: true })
  ];
  const out = Q.extend(existing, cands, 10);
  assert.ok(!out.some((s) => s.id === 'v1'), 'the video of the seed is not queued again');
  assert.ok(!out.some((s) => s.isVideo), 'songs are preferred to videos');
  assert.strictEqual(out.filter((s) => s.artist === 'Seed Artist').length, 4, 'seed artist gets 4');
  assert.strictEqual(out.filter((s) => s.artist === 'Other').length, 2, 'others get 2');
  assert.strictEqual(Q.extend(existing, cands, 3).length, 3);
});

test('a station that plays on from a music video keeps to videos when the mix has enough of them', () => {
  const seed = [song('s', 'Seed', 'A', { isVideo: true })];
  const vids = [1, 2, 3, 4].map((i) => song('v' + i, 'Video ' + i, 'Art' + i, { isVideo: true }));
  const out = Q.extend(seed, [song('a', 'Song', 'Z'), ...vids], 10, true);
  assert.ok(out.every((s) => s.isVideo));
  const few = Q.extend(seed, [song('a', 'Song', 'Z'), vids[0]], 10, true);
  assert.strictEqual(few.length, 2, 'too few videos: songs join in');
});

test('a single song plays alone, keeping what was queued by hand', () => {
  const q = [Q.entry(song('1', 'Now'), Q.CONTEXT), Q.entry(song('u', 'Hand queued'), Q.USER), Q.entry(song('3', 'Later'), Q.CONTEXT)];
  const next = Q.buildOneOffQueue(q, 0, song('9', 'Tapped'), 'Search');
  assert.deepStrictEqual(titles(next), ['Tapped', 'Hand queued']);
  assert.strictEqual(next[0]._tier, Q.CONTEXT);
});

test('starting a list: earlier songs behind, hand-queued songs right after the picked one', () => {
  const q = [Q.entry(song('1', 'Now'), Q.CONTEXT), Q.entry(song('u', 'Hand queued'), Q.USER)];
  const list = ['A', 'B', 'C', 'D'].map((t) => song(t, t));
  const r = Q.buildContextQueue(q, 0, list, 2, 'Album');
  assert.deepStrictEqual(titles(r.timeline), ['A', 'B', 'C', 'Hand queued', 'D']);
  assert.strictEqual(r.startIndex, 2);
});

test('Play next goes to the head of the hand-queued songs, Add to queue to their tail', () => {
  const t = [Q.entry(song('1', 'Now'), Q.CONTEXT), Q.entry(song('u1', 'U1'), Q.USER), Q.entry(song('u2', 'U2'), Q.USER), Q.entry(song('c', 'C'), Q.CONTEXT)];
  assert.strictEqual(Q.userInsertionIndex(t, 0, true), 1);
  assert.strictEqual(Q.userInsertionIndex(t, 0, false), 3);
});

test('jump order: skipping hand-queued songs pins them after the target; an AutoPlay row pivots', () => {
  const tiers = [Q.CONTEXT, Q.USER, Q.CONTEXT, Q.CONTEXT, Q.AUTOPLAY];
  const p = Q.computeJumpOrder(tiers, 0, 3);
  assert.strictEqual(p.isPureSeek, false);
  assert.deepStrictEqual(p.order, [0, 2, 3, 1, 4]);
  assert.strictEqual(p.target, 2);
  assert.strictEqual(Q.computeJumpOrder(tiers, 2, 3).isPureSeek, true);
  assert.strictEqual(Q.computeJumpOrder(tiers, 0, 4).promoteTargetToContext, true);
  assert.strictEqual(Q.computeJumpOrder(tiers, 3, 0).isPureSeek, true);
});

test('the station is topped up when fewer than three songs are left (never on repeat or when off)', () => {
  const q = [1, 2, 3, 4, 5];
  assert.ok(Q.needsTopUp(q, 3, false, true));
  assert.ok(!Q.needsTopUp(q, 1, false, true));
  assert.ok(!Q.needsTopUp(q, 4, true, true));
  assert.ok(!Q.needsTopUp(q, 4, false, false));
});
