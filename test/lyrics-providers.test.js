const test = require('node:test');
const assert = require('node:assert');
const L = require('../lyrics-providers');

test('parseTtml reads word-timed spans and merges syllables', () => {
  const ttml = '<tt><body><div><p begin="1.0" end="3.0"><span begin="1.0" end="1.5">Hel</span><span begin="1.5" end="2.0">lo</span> <span begin="2.0" end="3.0">world</span></p></div></body></tt>';
  const lines = L.parseTtml(ttml);
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(lines[0].words.map((w) => w.t), ['Hello', 'world']);
  assert.strictEqual(lines[0].words[0].s, 1000);
  assert.strictEqual(L.kindOf(lines), 'word');
});

test('parseTtml falls back to line timing', () => {
  const lines = L.parseTtml('<tt><body><div><p begin="00:01:02.500" end="00:01:05">Just a line</p></div></body></tt>');
  assert.strictEqual(lines[0].time, 62500);
  assert.strictEqual(L.kindOf(lines), 'line');
});

test('toLrc and parseLrc round-trip enhanced LRC', () => {
  const lines = [{ time: 1000, end: 3000, text: 'Hello world', words: [{ s: 1000, e: 2000, t: 'Hello' }, { s: 2000, e: 3000, t: 'world' }] }];
  const lrc = L.toLrc(lines);
  assert.match(lrc, /^\[00:01\.00\]<00:01\.00>Hello <00:02\.00>world <00:03\.00>$/);
  const back = L.parseLrc(lrc);
  assert.deepStrictEqual(back[0].words.map((w) => w.t), ['Hello', 'world']);
  assert.strictEqual(back[0].text, 'Hello world');
});

test('parseLrc handles plain and synced LRC', () => {
  assert.strictEqual(L.kindOf(L.parseLrc('a\nb')), 'plain');
  assert.strictEqual(L.kindOf(L.parseLrc('[00:01.00]a\n[00:02.50]b')), 'line');
});

test('race: word-timed beats an earlier line-synced answer', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const line = { kind: 'line', lines: [{ time: 0, text: 'x', words: null }] };
  const word = { kind: 'word', lines: [{ time: 0, text: 'x', words: [{ s: 0, e: 500, t: 'x' }, { s: 500, e: 900, t: 'y' }] }] };
  const r = await L.fetchLyrics({ title: 't', artist: 'a' }, {
    grace: 400,
    providers: [{ name: 'slowWord', run: async () => { await wait(100); return word; } }, { name: 'fastLine', run: async () => line }],
  });
  assert.strictEqual(r.source, 'slowWord');
  assert.strictEqual(r.kind, 'word');
});

test('race: line-synced returned after grace when no word answer', async () => {
  const line = { kind: 'line', lines: [{ time: 0, text: 'x', words: null }] };
  const r = await L.fetchLyrics({ title: 't', artist: 'a' }, { grace: 50, providers: [{ name: 'l', run: async () => line }, { name: 'none', run: async () => null }] });
  assert.strictEqual(r.kind, 'line');
});

test('bestLrcRedHit rejects remixes and wrong lengths', () => {
  const hits = [
    { isrc: 'GBAHT2400001', title: 'Houdini (Remix)', artist: 'Dua Lipa', duration: 185 },
    { isrc: 'GBAHT2400002', title: 'Houdini', artist: 'Dua Lipa', duration: 186 },
  ];
  assert.strictEqual(L.bestLrcRedHit(hits, 'Houdini', 'Dua Lipa', 185000).isrc, 'GBAHT2400002');
  assert.strictEqual(L.bestLrcRedHit(hits, 'Houdini', 'Dua Lipa', 240000), null);
});

test('all-zero timestamps are treated as plain text, so a real synced source wins', async () => {
  const zero = { kind: 'line', lines: [{ time: 0, text: 'a', words: null }, { time: 0, text: 'b', words: null }] };
  const lines = L.parseLrc('[00:00.00]a\n[00:00.00]b');
  assert.strictEqual(L.kindOf(lines), 'line');
  const r = await L.fetchLyrics({ title: 't', artist: 'a' }, { grace: 30, providers: [{ name: 'zero', run: async () => L._answer(lines) }, { name: 'good', run: async () => L._answer(L.parseLrc('[00:01.00]a\n[00:03.00]b')) }] });
  assert.strictEqual(r.source, 'good');
});
