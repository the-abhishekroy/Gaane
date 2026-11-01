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

test('a stamped blank line is kept as an instrumental break, not dropped', () => {
  const lines = L.parseLrc('[00:05.00]first\n[00:10.00]\n[00:20.00]second');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[1].gap, true);
  assert.strictEqual(L.kindOf(lines), 'line');
});

test('breaks of 4 s or more after a word-timed line become blank stamped lines', () => {
  const lines = [
    { time: 6000, text: 'a b', words: [{ s: 6000, e: 6500, t: 'a' }, { s: 6500, e: 7000, t: 'b' }] },
    { time: 20000, text: 'c', words: [{ s: 20000, e: 20500, t: 'c' }] },
    { time: 21000, text: 'd', words: [{ s: 21000, e: 21500, t: 'd' }] }
  ];
  const out = L.withGaps(lines);
  assert.deepStrictEqual(out.map((l) => !!l.gap), [true, false, true, false, false]);   // intro break, line, break, line, line
  assert.strictEqual(out[2].time, 7000);
  const lrc = L.toLrc(lines);
  assert.match(lrc, /^\[00:00\.00\]\n\[00:06\.00\]/);
  assert.match(lrc, /\n\[00:07\.00\]\n\[00:20\.00\]/);
});

test('word-timed answers: a longer edition is rejected and the best-ranked provider wins', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (endMs) => ({ kind: 'word', lines: [{ time: 1000, text: 'a b', words: [{ s: 1000, e: 1500, t: 'a' }, { s: endMs - 500, e: endMs, t: 'b' }] }] });
  const r = await L.fetchLyrics({ title: 't', artist: 'a', durationMs: 180000 }, {
    priorityWait: 120,
    providers: [
      { name: 'top-but-too-long', run: async () => { await wait(60); return mk(260000); } },
      { name: 'second', run: async () => { await wait(10); return mk(170000); } },
      { name: 'third', run: async () => mk(171000) }
    ]
  });
  assert.strictEqual(r.source, 'second');                      // the longer edition is not this recording, 'third' ranks lower
  const r2 = await L.fetchLyrics({ title: 't', artist: 'a', durationMs: 180000 }, {
    priorityWait: 150,
    providers: [
      { name: 'first', run: async () => { await wait(50); return mk(172000); } },
      { name: 'fast', run: async () => mk(172000) }
    ]
  });
  assert.strictEqual(r2.source, 'first');                      // a slightly later top-ranked answer still wins
});

test('QQ karaoke lines are read word by word, in either of the two layouts', () => {
  const suffix = L.parseKaraoke('[1000,2000]Hello(1000,500) world(1500,1000)');
  assert.deepStrictEqual(suffix[0].words.map((w) => w.t), ['Hello', 'world']);
  assert.strictEqual(suffix[0].words[1].s, 1500);
  const prefix = L.parseKaraoke('[5000,1500](5000,400)Good (5400,500)night');
  assert.deepStrictEqual(prefix[0].words.map((w) => w.t), ['Good', 'night']);
});

test('parseAny reads whatever a provider sends and drops section headers and error text', () => {
  assert.strictEqual(L.parseAny('{"lyrics":"[Chorus]\\n[00:01.00]one\\n[00:03.00]two"}').kind, 'line');
  assert.strictEqual(L.parseAny('{"error":"not found"}'), null);
  assert.strictEqual(L.parseAny('Lyrics not found'), null);
  assert.strictEqual(L.parseAny('<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[1000,500]Hi(1000,250) there(1250,250)"/></QrcInfos>').kind, 'word');
});
