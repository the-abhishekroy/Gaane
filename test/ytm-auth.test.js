const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaane-auth-'));
process.env.RIFF_DATA_DIR = dir;
const yt = require('../ytmusic');
const t = yt._test;

test('the saved login is sealed with a local key and reads back after a restart', () => {
  t.saveAuth('SAPISID=abc; __Secure-1PSIDTS=old; HSID=x');
  const onDisk = fs.readFileSync(path.join(dir, 'ytm-auth.json'), 'utf8');
  assert.ok(!onDisk.includes('SAPISID'), 'cookie must not be stored in plain text');
  t.reset();
  assert.strictEqual(t.loadAuth().cookie, 'SAPISID=abc; __Secure-1PSIDTS=old; HSID=x');
});

test('rotated session cookies from Google are kept, deletions are ignored', () => {
  t.saveAuth('SAPISID=abc; __Secure-1PSIDTS=old; HSID=x');
  yt.mergeSetCookies([
    '__Secure-1PSIDTS=new; Path=/; Secure; HttpOnly',
    'HSID=; Max-Age=0; Path=/',
    'SomethingElse=1; Path=/'
  ]);
  const c = t.cookie();
  assert.match(c, /__Secure-1PSIDTS=new/);
  assert.match(c, /HSID=x/);
  assert.doesNotMatch(c, /SomethingElse/);
});

test('an unreadable or failed login is never deleted on its own', () => {
  t.saveAuth('SAPISID=keepme');
  fs.writeFileSync(path.join(dir, 'ytm-auth.key'), Buffer.alloc(32, 7));   // key no longer matches
  t.reset();
  assert.strictEqual(t.loadAuth(), null);
  assert.ok(fs.existsSync(path.join(dir, 'ytm-auth.json')), 'the file stays');
});
