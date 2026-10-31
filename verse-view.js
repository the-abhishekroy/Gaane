// Verse: kinetic, word-by-word lyrics. One word is the hero at any moment; the words around it keep the sentence
// readable. Every style is a different way of arranging the same moving words, all timed to the song.
(function (root) {
  const STYLES = [
    { id: 'reel', name: 'Reel', note: 'A vertical reel: the word being sung sits in the middle, the words around it scroll past' },
    { id: 'glide', name: 'Glide', note: 'Light words fill up into a heavy one as it is sung' },
    { id: 'elastic', name: 'Elastic', note: 'The word pops onto a tilted label with a springy bounce' },
    { id: 'cascade', name: 'Cascade', note: 'Words step down a staircase, the current one underlined' },
    { id: 'orbit', name: 'Orbit', note: 'The words circle around the one being sung' },
    { id: 'surge', name: 'Surge', note: 'A wave under the word swells with the bass' },
    { id: 'echo', name: 'Echo', note: 'Outlines of the word ripple outwards on every beat' },
    { id: 'halo', name: 'Halo', note: 'A ring draws itself around the word while it is sung' }
  ];
  const MODES = [
    { id: 'source', name: 'Cover' },
    { id: 'tonal', name: 'Tonal' },
    { id: 'analogous', name: 'Analogous' },
    { id: 'complementary', name: 'Complementary' },
    { id: 'white', name: 'White' }
  ];

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const hexRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function rgbHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0; const l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((h * 60) + 360) % 360, s * 100, l * 100];
  }
  const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360},${clamp(s, 0, 100)}%,${clamp(l, 0, 100)}%)`;

  // text / highlight / supporting colours from the cover's palette, as a colour harmony
  function colours(mode, palette) {
    if (mode === 'white' || !palette || !palette.length) return { text: '#f4f4f6', hi: '#ffffff', sup: 'rgba(255,255,255,.55)' };
    const [h, s0, l0] = rgbHsl(...hexRgb(palette[0]));
    const s = clamp(s0, 45, 95);
    const hi = hsl(h, s, clamp(l0 + 12, 58, 72));
    if (mode === 'tonal') return { text: hsl(h, s * 0.35, 92), hi, sup: hsl(h, s * 0.6, 62) };
    if (mode === 'analogous') return { text: hsl(h + 32, s, 80), hi, sup: hsl(h - 32, s * 0.8, 66) };
    if (mode === 'complementary') return { text: '#f6f6f8', hi, sup: hsl(h + 180, s * 0.8, 68) };
    const second = palette[1] ? rgbHsl(...hexRgb(palette[1])) : [h + 25, s, 70];
    const third = palette[2] ? rgbHsl(...hexRgb(palette[2])) : [h - 25, s, 62];
    return { text: hsl(second[0], clamp(second[1], 30, 90), clamp(second[2] + 18, 72, 90)), hi, sup: hsl(third[0], clamp(third[1], 30, 90), clamp(third[2] + 8, 55, 74)) };
  }

  // The lyrics as one running list of words with times (lines without word timing get them spread over the line).
  function flatten(lines) {
    const out = [];
    const L = lines || [];
    for (let i = 0; i < L.length; i++) {
      const line = L[i];
      if (!line || !(line.time >= 0)) continue;
      const next = L.slice(i + 1).find((x) => x && x.time >= 0);
      const end = next ? next.time : line.time + 4;
      let words = line.words && line.words.length ? line.words : null;
      if (!words) {
        const parts = String(line.text || '').split(/\s+/).filter(Boolean);
        const span = Math.max(0.8, end - line.time - 0.15);
        const wts = parts.map((p) => Math.max(2, p.length));
        const total = wts.reduce((a, b) => a + b, 0) || 1;
        let at = line.time;
        words = parts.map((p, k) => { const d = span * wts[k] / total; const w = { t: p, s: at, e: at + d }; at += d; return w; });
      }
      words.forEach((w, k) => out.push({ t: w.t, s: w.s, e: Math.max(w.e, w.s + 0.12), line: i, first: k === 0, last: k === words.length - 1 }));
    }
    return out;
  }

  // Where each word goes, relative to the one being sung (r = 0). Sizes are fractions of the hero size.
  const LAYOUT = {
    reel: (r, c) => {
      const a = Math.abs(r);
      if (a > 2) return null;
      return r === 0 ? { x: 0, y: 0, s: 1, o: 1, w: 560, col: 'hi' } : { x: 0, y: Math.sign(r) * c.F * (a === 1 ? 0.92 : 1.42), s: a === 1 ? 0.34 : 0.22, o: a === 1 ? 0.6 : 0.26, w: 300, col: 'sup' };
    },
    glide: (r, c) => {
      if (r < -2 || r > 1) return null;
      if (r === 0) return { x: 0, y: 0, s: 1, o: 1, w: 300 + 600 * c.p, col: 'hi' };
      if (r === 1) return { x: 0, y: c.F * 0.86, s: 0.55, o: 0.32, w: 300, col: 'sup' };
      return { x: 0, y: -c.F * (r === -1 ? 0.88 : 1.5), s: r === -1 ? 0.8 : 0.5, o: r === -1 ? 0.8 : 0.3, w: 300, col: 'text' };
    },
    elastic: (r, c) => {
      if (r < -2 || r > 0) return null;
      if (r === 0) return { x: 0, y: 0, s: 1, o: 1, w: 800, col: 'ink', spring: true };
      return { x: -c.F * 0.55 + r * c.F * 0.32, y: -c.F * (1.0 + (-r - 1) * 0.42), s: r === -1 ? 0.36 : 0.28, o: r === -1 ? 0.85 : 0.5, w: 700, col: 'text', rot: -5 };
    },
    cascade: (r, c) => {
      if (r < -2 || r > 1) return null;
      if (r === 0) return { x: c.F * 0.15, y: c.F * 0.12, s: 1, o: 1, w: 800, col: 'hi' };
      if (r === 1) return { x: c.F * 0.9, y: c.F * 0.85, s: 0.34, o: 0.4, w: 500, col: 'sup' };
      return { x: -c.F * (r === -1 ? 0.55 : 1.1), y: -c.F * (r === -1 ? 0.62 : 1.18), s: r === -1 ? 0.46 : 0.33, o: r === -1 ? 0.85 : 0.5, w: 650, col: 'text' };
    },
    orbit: (r, c) => {
      if (r < -2 || r > 2) return null;
      if (r === 0) return { x: 0, y: 0, s: 1, o: 1, w: 800, col: 'hi' };
      return { ang: -Math.PI / 2 - r * 1.05, s: Math.abs(r) === 1 ? 0.3 : 0.22, o: Math.abs(r) === 1 ? 0.8 : 0.4, w: 650, col: r < 0 ? 'text' : 'sup', orbit: true };
    },
    surge: (r, c) => {
      if (r < -2 || r > 0) return null;
      if (r === 0) return { x: 0, y: 0, s: 1, o: 1, w: 800, col: 'hi' };
      return { x: -c.F * 0.75 + r * c.F * 0.3, y: -c.F * (0.95 + (-r - 1) * 0.4), s: r === -1 ? 0.34 : 0.26, o: r === -1 ? 0.85 : 0.5, w: 700, col: 'text' };
    },
    echo: (r, c) => {
      if (r < -2 || r > 0) return null;
      if (r === 0) return { x: 0, y: 0, s: 1, o: 1, w: 800, col: 'hi' };
      return { x: r === -1 ? -c.F * 0.2 : -c.F * 0.5, y: -c.F * (0.95 + (-r - 1) * 0.4), s: r === -1 ? 0.34 : 0.26, o: r === -1 ? 0.85 : 0.5, w: 700, col: 'text' };
    },
    halo: (r, c) => {
      if (r < -2 || r > 0) return null;
      if (r === 0) return { x: 0, y: 0, s: 1, o: 1, w: 800, col: 'hi' };
      return { x: r === -1 ? -c.F * 0.15 : -c.F * 0.4, y: -c.F * (1.15 + (-r - 1) * 0.4), s: r === -1 ? 0.34 : 0.26, o: r === -1 ? 0.85 : 0.5, w: 700, col: 'text' };
    }
  };

  function create(host, opts) {
    const stage = document.createElement('div');
    stage.className = 'verse-stage2';
    host.appendChild(stage);
    const decor = document.createElement('div');
    decor.className = 'verse-decor';
    stage.appendChild(decor);

    let style = 'reel', mode = 'source';
    let flat = [], flatKey = null, ai = -2;
    const els = new Map();                  // flat index -> { el, x, y, s, r, o, w, ang, vs }
    let raf = 0, last = 0, bass = 0, W = 1000, H = 600, F = 120;
    let col = colours(mode, []);

    function measure() { W = stage.clientWidth || 1000; H = stage.clientHeight || 600; F = clamp(Math.min(W * 0.115, H * 0.2), 44, 190); }
    function setLines(lines) { flatKey = lines; flat = flatten(lines); ai = -2; els.forEach((v) => v.el.remove()); els.clear(); }

    function wordEl(i) {
      let v = els.get(i);
      if (v) return v;
      const el = document.createElement('span');
      el.className = 'vw';
      el.textContent = flat[i].t;
      stage.appendChild(el);
      v = { el, x: 0, y: 0, s: 0.5, r: 0, o: 0, w: 500, ang: 0, vs: 0, born: true };
      els.set(i, v);
      return v;
    }

    function decorFor(c) {
      // style-specific extras behind the hero word, rebuilt only when the style changes
      if (decor.dataset.style === style) return;
      decor.dataset.style = style;
      decor.innerHTML = '';
      if (style === 'elastic') decor.innerHTML = '<div class="vd-bar"></div><i class="vd-tick t1"></i><i class="vd-tick t2"></i>';
      if (style === 'cascade') decor.innerHTML = '<div class="vd-under"></div>';
      if (style === 'surge') decor.innerHTML = '<svg class="vd-wave" viewBox="0 0 400 60" preserveAspectRatio="none"><path d="" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
      if (style === 'halo') decor.innerHTML = '<svg class="vd-ring" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="48" ry="48" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".25" vector-effect="non-scaling-stroke"/><ellipse class="arc" cx="50" cy="50" rx="48" ry="48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" transform="rotate(-90 50 50)" vector-effect="non-scaling-stroke"/></svg>';
      if (style === 'orbit') decor.innerHTML = '<div class="vd-ellipse"></div>';
      if (style === 'echo') decor.innerHTML = '<span class="vd-echo e1"></span><span class="vd-echo e2"></span><span class="vd-echo e3"></span>';
    }

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.06, (ts - (last || ts)) / 1000); last = ts;
      measure();
      const lines = opts.lines();
      if (lines !== flatKey) setLines(lines);
      if (!flat.length) { els.forEach((v) => { v.o = 0; v.el.style.opacity = 0; }); return; }
      const t = opts.time();
      let idx = -1;
      for (let i = 0; i < flat.length; i++) { if (t >= flat[i].s) idx = i; else break; }
      const lo = Math.max(0, idx - 3), hi = Math.min(flat.length - 1, idx + 3);
      const audio = opts.audio ? opts.audio() : { bass: 0 };
      bass += (audio.bass - bass) * 0.3;
      col = colours(mode, opts.palette());
      const word = idx >= 0 ? flat[idx] : null;
      const p = word ? clamp((t - word.s) / Math.max(0.12, Math.min(0.7, word.e - word.s)), 0, 1) : 0;
      const ctx = { F, W, H, p, bass };
      const layout = LAYOUT[style];
      if (idx !== ai) { ai = idx; stage.dataset.pulse = String(Date.now()); }
      decorFor(ctx);
      stage.style.setProperty('--vhi', col.hi); stage.style.setProperty('--vtext', col.text); stage.style.setProperty('--vsup', col.sup);

      // create / retire word elements around the active one
      for (const [i, v] of els) if (i < lo - 1 || i > hi + 1) { v.el.remove(); els.delete(i); }
      let heroBox = null;
      for (let i = lo; i <= hi; i++) {
        const r = idx < 0 ? i + 1 : i - idx;
        const target = layout(r, ctx);
        const v = els.get(i) || (target ? wordEl(i) : null);
        if (!v) continue;
        const k = 1 - Math.exp(-dt * (style === 'orbit' ? 7 : 11));
        if (!target) { v.o += (0 - v.o) * k; v.el.style.opacity = v.o.toFixed(3); continue; }
        const lenFit = clamp((W * 0.78) / (Math.max(3, flat[i].t.length) * F * 0.56), 0.4, 1);
        if (v.born) { v.born = false; v.s = (target.s || 1) * 0.55; v.o = 0; v.y = (target.y || 0) + (r >= 0 ? F * 0.35 : 0); v.x = target.x || 0; if (target.orbit) v.ang = target.ang; }
        if (target.orbit) {
          v.ang += (target.ang - v.ang) * k;
          const a = Math.min(W * 0.26, 520), b = Math.min(H * 0.22, 260);
          target.x = Math.cos(v.ang) * a; target.y = Math.sin(v.ang) * b * 1.15;
        }
        v.x += ((target.x || 0) - v.x) * k; v.y += ((target.y || 0) - v.y) * k;
        if (target.spring && r === 0) {                      // damped spring: pops past full size, then settles
          const age = t - flat[i].s;
          const sc = age < 0 ? 0.5 : 1 - Math.exp(-11 * age) * Math.cos(17 * age) * 0.55;
          v.s = clamp(sc, 0.45, 1.25) * (target.s || 1);
        } else v.s += ((target.s || 1) - v.s) * k;
        v.o += (target.o - v.o) * k;
        v.w += (target.w - v.w) * k;
        const size = F * v.s * (r === 0 ? lenFit : Math.min(1, lenFit * 1.3));
        const pulse = r === 0 ? 1 + 0.03 * bass : 1;
        const rot = target.rot || 0;
        const colour = target.col === 'ink' ? '#101014' : col[target.col] || col.text;
        const s = v.el.style;
        s.fontSize = size.toFixed(1) + 'px';
        s.fontWeight = Math.round(v.w / 10) * 10;
        s.opacity = v.o.toFixed(3);
        s.color = colour;
        s.transform = `translate(-50%,-50%) translate(${v.x.toFixed(1)}px,${v.y.toFixed(1)}px) rotate(${rot}deg) scale(${pulse.toFixed(3)})`;
        s.zIndex = r === 0 ? 3 : 2;
        s.textShadow = r === 0 && style !== 'elastic' ? `0 0 ${(0.25 + bass * 0.6).toFixed(2)}em color-mix(in srgb, ${col.hi} 55%, transparent)` : 'none';
        if (r === 0) heroBox = { x: v.x, y: v.y, w: v.el.offsetWidth, h: v.el.offsetHeight, size, i };
      }
      // decor follows the hero word
      if (heroBox) {
        const d = decor.style;
        d.transform = `translate(-50%,-50%) translate(${heroBox.x.toFixed(1)}px,${heroBox.y.toFixed(1)}px)`;
        d.setProperty('--hw', heroBox.w + 'px'); d.setProperty('--hh', heroBox.h + 'px'); d.setProperty('--hf', heroBox.size + 'px');
        d.setProperty('--vp', p.toFixed(3)); d.setProperty('--vb', bass.toFixed(3));
        d.setProperty('--ow', (Math.min(W * 0.26, 520) * 2) + 'px'); d.setProperty('--oh', (Math.min(H * 0.22, 260) * 2.3) + 'px');
        if (style === 'surge') {
          const path = decor.querySelector('.vd-wave path');
          if (path) {
            const amp = 6 + bass * 22, ph = ts / 380, n = 24;
            let dstr = '';
            for (let q = 0; q <= n; q++) { const x = (q / n) * 400, y = 30 + Math.sin(q * 0.7 + ph) * amp * (0.4 + 0.6 * Math.sin((q / n) * Math.PI)); dstr += (q ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
            path.setAttribute('d', dstr);
          }
        }
        if (style === 'halo') {
          const arc = decor.querySelector('.arc');
          if (arc) { const C = 2 * Math.PI * 48; arc.setAttribute('stroke-dasharray', C.toFixed(1)); arc.setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(1)); }
        }
        if (style === 'echo') {
          decor.querySelectorAll('.vd-echo').forEach((e, n) => { e.textContent = flat[heroBox.i].t; e.style.transform = `translate(-50%,-50%) scale(${(1.05 + n * 0.07 + bass * 0.08 * (n + 1)).toFixed(3)})`; e.style.opacity = (0.4 - n * 0.11).toFixed(2); });
        }
      }
    }

    return {
      stage,
      styles: STYLES, modes: MODES,
      setStyle(s) { if (LAYOUT[s]) { style = s; decor.dataset.style = ''; stage.dataset.style = s; els.forEach((v) => v.el.remove()); els.clear(); } },
      setMode(m) { if (MODES.some((x) => x.id === m)) mode = m; },
      get style() { return style; },
      get mode() { return mode; },
      start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
      stop() { cancelAnimationFrame(raf); raf = 0; },
      show(on) { stage.style.display = on ? '' : 'none'; }
    };
  }

  const api = { create, flatten, colours, STYLES, MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaaneVerse = api;
})(typeof window !== 'undefined' ? window : globalThis);
