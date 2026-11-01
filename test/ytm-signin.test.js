const test = require('node:test');
const assert = require('node:assert');
const s = require('../ytm-signin');

test('finds the browsers that exist, in order', () => {
  const have = new Set(['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
  const found = s.findBrowsers((p) => have.has(p), 'darwin', { HOME: '/Users/x' });
  assert.deepStrictEqual(found.map((b) => b.name), ['Google Chrome', 'Brave Browser']);
  assert.deepStrictEqual(s.findBrowsers(() => false, 'darwin', { HOME: '/Users/x' }), []);
});

test('a session counts only when the signed-in YouTube cookies exist', () => {
  assert.strictEqual(s.hasSession([{ domain: '.youtube.com', name: 'VISITOR_INFO1_LIVE', value: 'a' }]), false);
  assert.strictEqual(s.hasSession([{ domain: '.google.com', name: 'SAPISID', value: 'a' }, { domain: '.google.com', name: 'SID', value: 'a' }]), false);
  assert.strictEqual(s.hasSession([{ domain: '.youtube.com', name: 'SAPISID', value: 'a' }, { domain: '.youtube.com', name: '__Secure-3PSID', value: 'b' }]), true);
});

test('the cookie header holds what a browser sends to music.youtube.com', () => {
  const h = s.cookieHeader([
    { domain: '.youtube.com', name: 'SAPISID', value: 'abc' },
    { domain: '.google.com', name: 'SID', value: 'no' },
    { domain: 'www.youtube.com', name: 'WWW_ONLY', value: 'no' },
    { domain: 'music.youtube.com', name: 'YTM', value: 'yes' }
  ]);
  assert.strictEqual(h, 'SAPISID=abc; YTM=yes');
});
