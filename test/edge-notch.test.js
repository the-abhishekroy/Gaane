const test = require('node:test');
const assert = require('node:assert');
const { parseNotches, notchFor } = require('../edge-notch');

test('the built-in MacBook screen has a notch, an external display next to it does not', () => {
  const map = parseNotches([
    { id: 1, w: 1710, top: 37.5, leftW: 751, rightW: 751 },
    { id: 7, w: 2560, top: 0, leftW: 0, rightW: 0 }
  ]);
  assert.deepStrictEqual(notchFor(map, { id: 1 }), { x0: 751, x1: 959, h: 37.5 });
  assert.strictEqual(notchFor(map, { id: 7 }), null);
});

test('no information means no notch (desktop Mac, Windows, Linux)', () => {
  assert.strictEqual(notchFor(parseNotches([]), { id: 1 }), null);
  assert.strictEqual(notchFor(parseNotches(undefined), { id: 1 }), null);
  assert.strictEqual(notchFor(new Map(), null), null);
});

test('a tall menu bar alone is not a notch', () => {
  assert.strictEqual(notchFor(parseNotches([{ id: 2, w: 1920, top: 0, leftW: 0, rightW: 0 }]), { id: 2 }), null);
});
