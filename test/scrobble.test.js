const test = require('node:test');
const assert = require('node:assert');
const { buildPayload } = require('../scrobble');

test('single listen carries artist, title, album and a unix time', () => {
  const p = buildPayload({ artist: 'Dua Lipa', title: 'Houdini', album: 'Radical Optimism', duration: 185 }, 'single', 1700000000000);
  assert.strictEqual(p.listen_type, 'single');
  assert.strictEqual(p.payload[0].listened_at, 1700000000);
  assert.strictEqual(p.payload[0].track_metadata.artist_name, 'Dua Lipa');
  assert.strictEqual(p.payload[0].track_metadata.release_name, 'Radical Optimism');
  assert.strictEqual(p.payload[0].track_metadata.additional_info.duration_ms, 185000);
});

test('playing_now has no listened_at; tracks without artist or title are skipped', () => {
  assert.strictEqual('listened_at' in buildPayload({ artist: 'a', title: 'b' }, 'playing_now').payload[0], false);
  assert.strictEqual(buildPayload({ title: 'x' }, 'single'), null);
});
