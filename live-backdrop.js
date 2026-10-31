// Live backdrop: original music-reactive animated backgrounds drawn with WebGL, in the cover's own colours.
// Scenes: aurora (flowing colour), voxels (an LED-style wall of columns), contours (map lines), ripples (rings on the beat).
// The host app feeds it 28 spectrum bands and a palette; everything else lives here.
(function (root) {
  const SCENES = ['aurora', 'voxels', 'contours', 'ripples'];
  const NB = 28;

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

  const HEAD = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uBass, uMid, uHigh, uBeat, uBeatT;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uB[${NB}];
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
float band(float x){ // x 0..1 across the spectrum, linear interpolation between bands
  float f = clamp(x, 0.0, 1.0) * ${NB - 1}.0; int i0 = int(floor(f)); float fr = f - floor(f); float a = 0.0, b = 0.0;
  for (int i = 0; i < ${NB}; i++){ if (i == i0) a = uB[i]; if (i == i0 + 1) b = uB[i]; }
  return mix(a, b, fr);
}
vec3 pal(float t){ t = clamp(t, 0.0, 1.0) * 3.0; return t < 1.0 ? mix(uC0, uC1, t) : t < 2.0 ? mix(uC1, uC2, t - 1.0) : mix(uC2, uC3, t - 2.0); }
vec3 vignette(vec3 c, vec2 uv){ float d = length(uv - 0.5); return c * (1.0 - 0.18 * smoothstep(0.6, 1.3, d)); }
`;

  const FRAGS = {
    aurora: HEAD + `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.2;
  float t = uTime * (0.06 + 0.10 * uMid);
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.2 * q + vec2(1.7, 9.2) + t * (1.0 + uBass * 1.4)), fbm(p + 3.2 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 3.0 * r);
  vec3 col = pal(f * 1.25);
  col = mix(col, pal(0.55 + 0.45 * r.x), 0.45);
  col = mix(col, uC2, clamp(length(q) - 0.35, 0.0, 1.0) * 0.5);
  float glow = 0.38 + 0.75 * f + 0.28 * uBass + 0.35 * uBeat;
  col *= glow;
  col += uC3 * 0.10 * uHigh * smoothstep(0.5, 1.0, f);
  gl_FragColor = vec4(vignette(col, uv), 1.0);
}`,
    voxels: HEAD + `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float rows = 22.0, cols = floor(rows * uRes.x / uRes.y);
  vec2 g = vec2(uv.x * cols, uv.y * rows); vec2 cell = floor(g); vec2 f = fract(g) - 0.5;
  float x = (cell.x + 0.5) / cols;
  float lvl = band(abs(x * 2.0 - 1.0) * 0.9 + 0.02);                 // mirrored spectrum, bass in the middle
  float wob = 0.5 + 0.5 * sin(uTime * 0.8 + cell.x * 0.55) * 0.5 + 0.25 * vnoise(vec2(cell.x * 0.7, uTime * 0.4));
  float h = clamp(lvl * 0.95 + 0.06 + 0.08 * wob + uBeat * 0.08, 0.0, 1.0) * rows;
  float on = step(cell.y + 0.5, h);
  float top = smoothstep(0.0, 1.0, 1.0 - clamp(h - cell.y - 0.5, 0.0, 1.2));       // brighter at the tip of each column
  vec2 q = abs(f) - vec2(0.36); float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
  float box = 1.0 - smoothstep(-0.02, 0.04, d);
  vec3 c = pal(cell.y / rows * 0.8 + lvl * 0.4);
  float bright = 0.40 + 0.95 * top;
  vec3 col = vec3(0.012) + box * (on * c * bright + (1.0 - on) * c * 0.075);
  col += on * box * 0.12 * uBeat;
  float halo = exp(-length(f) * 2.4) * on * 0.07;
  col += c * halo * 1.8;
  gl_FragColor = vec4(vignette(col * 1.25, uv), 1.0);
}`,
    contours: HEAD + `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  float t = uTime * 0.05;
  float f = fbm(p * 1.3 + vec2(t, -t * 0.7)) + 0.35 * fbm(p * 2.6 - t * 1.3);
  f += (0.10 + 0.22 * uBass) * sin(length(p) * 3.0 - uTime * (0.6 + uMid));
  float lines = 14.0 + 6.0 * uMid;
  float v = f * lines;
  float w = fwidth(v) * 1.2 + 0.001;
  float line = 1.0 - smoothstep(0.0, w * (1.0 + 1.6 * uBeat), abs(fract(v) - 0.5) * 2.0 - 0.0);
  float thick = smoothstep(0.55, 0.0, abs(fract(v) - 0.5));
  vec3 base = pal(f * 0.9) * 0.10;
  vec3 col = base * 1.6 + pal(f * 1.1 + 0.1) * (line * 1.25 + thick * 0.2) * (0.8 + 0.7 * uBass + 0.5 * uBeat);
  gl_FragColor = vec4(vignette(col, uv), 1.0);
}`,
    ripples: HEAD + `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float warp = fbm(p * 3.0 + uTime * 0.1) - 0.5;
  float d = length(p) + warp * (0.05 + 0.05 * uMid);
  vec3 col = pal(0.15 + 0.2 * fbm(p * 1.5 + uTime * 0.03)) * 0.10;
  for (int i = 0; i < 6; i++){
    float k = float(i) / 6.0;
    float r = fract(uTime * (0.045 + 0.05 * uMid) + k);
    float ring = exp(-pow((d - r * 0.95) * (14.0 - 6.0 * r), 2.0)) * (1.0 - r);
    col += pal(k + 0.2 * r) * ring * (0.5 + 0.9 * uBass);
  }
  float br = clamp(uBeatT * 0.9, 0.0, 1.0);          // the ring thrown out by the latest beat
  float beatRing = exp(-pow((d - br * 1.1) * 18.0, 2.0)) * (1.0 - br) * uBeat * 2.4;
  col += pal(0.7) * beatRing;
  col += pal(0.5) * exp(-d * 5.0) * (0.10 + 0.5 * uBass);
  gl_FragColor = vec4(vignette(col, uv), 1.0);
}`
  };

  function hex(c, fallback) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
    const n = m ? parseInt(m[1], 16) : fallback;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function create() {
    const canvas = document.createElement('canvas');
    canvas.className = 'live-backdrop-canvas';
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return null;

    const programs = {};
    let scene = 'aurora';
    let raf = 0, running = false, last = 0, fpsGap = 16;
    let src = { bands: () => new Float32Array(NB), palette: () => [] };
    let scale = 0.5;
    // smoothed audio state
    const lv = new Float32Array(NB);
    let bass = 0, mid = 0, high = 0, beat = 0, beatT = 1, avgBass = 0, beatAt = 0;
    let pal = [hex('#ff4678', 0), hex('#8c5aff', 0), hex('#31c3ff', 0), hex('#ffd76a', 0)];
    let palTarget = pal.map((c) => c.slice());
    const t0 = performance.now();

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    function program(name) {
      if (programs[name]) return programs[name];
      const sh = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); return s; };
      const vs = sh(gl.VERTEX_SHADER, VERT);
      const fs = sh(gl.FRAGMENT_SHADER, '#extension GL_OES_standard_derivatives : enable\n' + FRAGS[name]);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
        programs[name] = { failed: gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(pr) };
        return programs[name];
      }
      const u = {};
      ['uRes', 'uTime', 'uBass', 'uMid', 'uHigh', 'uBeat', 'uBeatT', 'uC0', 'uC1', 'uC2', 'uC3', 'uB'].forEach((k) => { u[k] = gl.getUniformLocation(pr, k); });
      programs[name] = { pr, u };
      return programs[name];
    }
    gl.getExtension('OES_standard_derivatives');

    function resize() {
      const w = Math.max(2, Math.round((canvas.clientWidth || window.innerWidth) * scale));
      const h = Math.max(2, Math.round((canvas.clientHeight || window.innerHeight) * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || ts - last < fpsGap) return;
      const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
      resize();
      const bands = src.bands() || [];
      for (let i = 0; i < NB; i++) { const tv = bands[i] || 0; lv[i] += (tv - lv[i]) * (tv > lv[i] ? 0.8 : 0.18); }
      const q = Math.floor(NB / 4);
      const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += lv[i]; return s / Math.max(1, b - a); };
      const tb = avg(0, q), tm = avg(q, q * 2 + 2), th = avg(q * 2 + 2, NB);
      bass += (tb - bass) * (tb > bass ? 0.7 : 0.15); mid += (tm - mid) * 0.35; high += (th - high) * 0.35;
      avgBass += (tb - avgBass) * 0.02;
      const now = ts / 1000;
      if (tb > avgBass * 1.35 + 0.05 && now - beatAt > 0.26) { beat = 1; beatAt = now; }
      beat *= Math.pow(0.04, dt); beatT = Math.min(1.5, now - beatAt);
      const wanted = src.palette() || [];
      if (wanted.length) {
        palTarget = [0, 1, 2, 3].map((i) => hex(wanted[i % wanted.length], 0xffffff));
      }
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) pal[i][k] += (palTarget[i][k] - pal[i][k]) * 0.04;   // colours glide to the next song's

      const P = program(scene);
      if (!P || P.failed) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(P.pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const u = P.u;
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, (performance.now() - t0) / 1000);
      gl.uniform1f(u.uBass, bass); gl.uniform1f(u.uMid, mid); gl.uniform1f(u.uHigh, high);
      gl.uniform1f(u.uBeat, beat); gl.uniform1f(u.uBeatT, beatT);
      gl.uniform3fv(u.uC0, pal[0]); gl.uniform3fv(u.uC1, pal[1]); gl.uniform3fv(u.uC2, pal[2]); gl.uniform3fv(u.uC3, pal[3]);
      gl.uniform1fv(u.uB, lv);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return {
      canvas,
      scenes: SCENES,
      get scene() { return scene; },
      setScene(s) { if (SCENES.includes(s)) scene = s; },
      setSource(s) { src = Object.assign(src, s); },
      setQuality(fps, sc) { fpsGap = 1000 / fps - 2; scale = sc; },
      start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; },
      shaderErrors() { return Object.fromEntries(Object.entries(programs).filter(([, v]) => v.failed).map(([k, v]) => [k, v.failed])); },
      compileAll() { SCENES.forEach(program); return this.shaderErrors(); }
    };
  }

  const api = { create, SCENES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaaneBackdrop = api;
})(typeof window !== 'undefined' ? window : globalThis);
