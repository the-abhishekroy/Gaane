'use strict';
// Which displays have a camera notch. Only a MacBook's built-in screen does; everything else (external monitors,
// desktop Macs, Windows, Linux) gets none. macOS reports a notch as a non-zero top safe-area inset with usable
// areas on both sides of it.
function parseNotches(list) {
  const out = new Map();
  for (const n of Array.isArray(list) ? list : []) {
    if (n && n.top > 0 && n.leftW > 0 && n.rightW > 0 && n.leftW + n.rightW < n.w) {
      out.set(n.id, { x0: n.leftW, x1: n.w - n.rightW, h: n.top });
    }
  }
  return out;
}
const notchFor = (map, display) => (display && map && map.get(display.id)) || null;
module.exports = { parseNotches, notchFor };
