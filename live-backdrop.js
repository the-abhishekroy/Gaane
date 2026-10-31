// Live backdrop: original music-reactive animated backgrounds drawn with WebGL, in the cover's own colours.
// Scenes: aurora (flowing colour), voxels (an LED-style wall of columns), contours (map lines), ripples (rings on the beat).
// The host app feeds it 28 spectrum bands and a palette; everything else lives here.
(function (root) {
  const FLAT = ['aurora', 'voxels', 'contours', 'ripples'];
  const POINTS = ['holo', 'pearl', 'vortex', 'tunnel', 'bloom'];
  const SCENES = FLAT.concat(POINTS);
  const SCENE_LABELS = [['holo', 'Holo tide'], ['pearl', 'Pearl'], ['vortex', 'Voxel vortex'], ['tunnel', 'Tunnel'], ['bloom', 'Voxel bloom']];
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


  // ---- 3D point / voxel scenes (one point per voxel, placed on the GPU) ----------------------------------------
  const PHEAD = `
precision highp float;
attribute vec3 s;
uniform vec2 uRes; uniform float uTime, uBass, uMid, uHigh, uBeat, uPx;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uB[${NB}];
varying vec3 vC; varying float vA;
float band(float x){ float f = clamp(x, 0.0, 1.0) * ${NB - 1}.0; int i0 = int(floor(f)); float fr = f - floor(f); float a = 0.0, b = 0.0;
  for (int i = 0; i < ${NB}; i++){ if (i == i0) a = uB[i]; if (i == i0 + 1) b = uB[i]; } return mix(a, b, fr); }
vec3 pal(float t){ t = clamp(t, 0.0, 1.0) * 3.0; return t < 1.0 ? mix(uC0, uC1, t) : t < 2.0 ? mix(uC1, uC2, t - 1.0) : mix(uC2, uC3, t - 2.0); }
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  return mix(mix(mix(h1(n), h1(n + 1.0), f.x), mix(h1(n + 57.0), h1(n + 58.0), f.x), f.y), mix(mix(h1(n + 113.0), h1(n + 114.0), f.x), mix(h1(n + 170.0), h1(n + 171.0), f.x), f.y), f.z); }
// perspective camera: position, pitch (down), yaw
vec4 proj(vec3 p, vec3 cam, float pitch, float yaw, float fov){
  p -= cam;
  float cy = cos(yaw), sy = sin(yaw); p = vec3(cy * p.x - sy * p.z, p.y, sy * p.x + cy * p.z);
  float cp = cos(pitch), sp = sin(pitch); p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  float asp = uRes.x / uRes.y; float z = max(0.05, -p.z);
  return vec4(p.x / (z * fov * asp), p.y / (z * fov), 0.0, 1.0) * vec4(1.0, 1.0, 1.0, 1.0) + vec4(0.0, 0.0, z * 0.01, 0.0);
}
`;
  const PFRAG = `
precision mediump float; varying vec3 vC; varying float vA; uniform float uSquare;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = uSquare > 0.5 ? max(abs(q.x), abs(q.y)) : length(q);
  float a = uSquare > 0.5 ? (1.0 - smoothstep(0.82, 1.0, d)) : (1.0 - smoothstep(0.35, 1.0, d));
  gl_FragColor = vec4(vC * (uSquare > 0.5 ? (1.0 - 0.28 * (q.y * 0.5 + 0.5)) : 1.0), a * vA);
}`;
  const PTS = {
    holo: {
      n: () => { const cols = 220, rows = 120, a = new Float32Array(cols * rows * 3); let k = 0; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { a[k++] = i / (cols - 1); a[k++] = j / (rows - 1); a[k++] = Math.random(); } return a; },
      square: 0,
      vs: PHEAD + `void main(){
  float u = s.x, v = s.y;
  float x = (u - 0.5) * 18.0, z = -1.5 - v * 15.0;
  float mir = abs(u * 2.0 - 1.0);
  float wave = sin(x * 0.55 + uTime * 0.9) * 0.35 + sin(z * 0.45 - uTime * 0.7 + x * 0.2) * 0.35 + sin(x * 1.3 + z * 0.9 + uTime * 1.4) * 0.12;
  float e = band(mir * 0.92 + 0.02) * (1.0 - v * 0.55);
  float y = wave * (0.6 + uMid * 0.8) + e * 4.2 + uBeat * 0.25 * (1.0 - v);
  vec4 P = proj(vec3(x, y - 1.2, z), vec3(0.0, 1.7, 2.2), 0.42, 0.0, 0.62);
  gl_Position = P; gl_PointSize = max(1.0, (2.6 + e * 3.0) * uPx / (1.0 + v * 4.0));
  vC = pal(0.15 + y * 0.18 + v * 0.25) * (0.55 + 0.9 * e + 0.3 * uBeat);
  vA = (0.55 + 0.45 * (1.0 - v)) * (0.6 + 0.4 * s.z);
}`
    },
    pearl: {
      n: () => { const N = 9000, a = new Float32Array(N * 3); const g = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < N; i++) { a[i * 3] = i / N; a[i * 3 + 1] = (i * g) % (Math.PI * 2); a[i * 3 + 2] = Math.random(); } return a; },
      square: 0,
      vs: PHEAD + `void main(){
  float y0 = 1.0 - 2.0 * s.x; float r0 = sqrt(max(0.0, 1.0 - y0 * y0));
  vec3 d = vec3(cos(s.y) * r0, y0, sin(s.y) * r0);
  float lvl = band(abs(y0) * 0.9 + 0.03);
  float ns = n3(d * 2.4 + vec3(0.0, uTime * 0.35, uTime * 0.2));
  float rad = 1.55 + (ns - 0.5) * (0.55 + uBass * 1.5) + lvl * 0.75 + uBeat * 0.18;
  vec3 p = d * rad;
  float ry = uTime * 0.18; float c = cos(ry), sn = sin(ry); p = vec3(c * p.x - sn * p.z, p.y, sn * p.x + c * p.z);
  vec4 P = proj(p, vec3(0.0, 0.0, 5.4), 0.0, 0.0, 0.52);
  gl_Position = P; gl_PointSize = max(1.5, (3.4 + lvl * 4.0) * uPx * (5.4 / (5.4 - p.z)));
  vC = mix(pal(0.2 + ns * 0.7), vec3(1.0), 0.28 + 0.4 * lvl) * (0.7 + 0.6 * lvl);
  vA = 0.55 + 0.45 * smoothstep(-1.6, 1.6, p.z);
}`
    },
    vortex: {
      n: () => { const N = 26000, a = new Float32Array(N * 3); for (let i = 0; i < N; i++) { a[i * 3] = Math.random(); a[i * 3 + 1] = Math.floor(Math.random() * 4); a[i * 3 + 2] = Math.random(); } return a; },
      square: 1,
      vs: PHEAD + `void main(){
  float r = pow(s.x, 0.62) * 7.0;
  float th = r * 0.85 - uTime * (0.22 + uMid * 0.5) + s.y * 1.5708 + (s.z - 0.5) * 0.55;
  float lvl = band(clamp(r / 7.0, 0.0, 1.0) * 0.85 + 0.02);
  float y = sin(r * 1.8 - uTime * 1.6) * (0.12 + uBass * 0.55) + (s.z - 0.5) * 0.25 + lvl * 1.1 * (1.0 - r / 8.0);
  vec3 p = vec3(cos(th) * r, y, sin(th) * r);
  vec4 P = proj(p, vec3(0.0, 4.4, 8.4), 0.5, 0.0, 0.62);
  gl_Position = P; gl_PointSize = max(1.5, (4.2 + lvl * 5.0) * uPx * (9.5 / (9.5 + r * 0.5)));
  vC = pal(r / 7.5 + y * 0.12) * (0.45 + 0.9 * lvl + 0.25 * uBeat);
  vA = 0.85;
}`
    },
    tunnel: {
      n: () => { const N = 14000, a = new Float32Array(N * 3); for (let i = 0; i < N; i++) { a[i * 3] = Math.random(); a[i * 3 + 1] = Math.random() * Math.PI * 2; a[i * 3 + 2] = Math.random(); } return a; },
      square: 1,
      vs: PHEAD + `void main(){
  float speed = 0.07 + uMid * 0.1 + uBeat * 0.05;
  float z = -fract(s.x - uTime * speed) * 44.0;
  float lvl = band(fract(s.x * 3.0 + s.z * 0.2) * 0.9);
  float rad = 3.6 + sin(s.x * 40.0 + uTime) * 0.25 + lvl * 1.6 + uBass * 0.8 + s.z * 0.6;
  float a = s.y + z * 0.05 + uTime * 0.12;
  vec3 p = vec3(cos(a) * rad, sin(a) * rad, z);
  vec4 P = proj(p, vec3(0.0, 0.0, 1.0), 0.0, 0.0, 0.7);
  gl_Position = P; float dep = max(0.5, 1.0 - z);
  gl_PointSize = max(1.5, (3.5 + lvl * 5.0) * uPx * 9.0 / dep);
  vC = pal(0.1 + s.y / 6.4 + lvl * 0.4) * (0.5 + 1.1 * lvl + 0.3 * uBeat) * smoothstep(44.0, 8.0, dep);
  vA = smoothstep(0.0, 4.0, dep);
}`
    },
    bloom: {
      n: () => { const R = 90, A = 200, a = new Float32Array(R * A * 3); let k = 0; for (let i = 0; i < R; i++) for (let j = 0; j < A; j++) { a[k++] = (i + 0.5) / R; a[k++] = (j + Math.random() * 0.5) / A; a[k++] = Math.random(); } return a; },
      square: 1,
      vs: PHEAD + `void main(){
  float r = s.x * 6.2; float th = s.y * 6.2832;
  float lvl = band(s.x * 0.9 + 0.02);
  float ring = sin(r * 3.2 - uTime * (1.4 + uMid)) * 0.5 + 0.5;
  float y = lvl * 2.6 * (1.0 - 0.4 * s.x) + ring * (0.18 + uBass * 0.9) * (1.0 - s.x) + (n3(vec3(cos(th) * r, sin(th) * r, uTime * 0.3) * 0.6) - 0.5) * 0.5 + uBeat * 0.4 * (1.0 - s.x);
  float ry = uTime * 0.07; float c = cos(th + ry), sn = sin(th + ry);
  vec3 p = vec3(c * r, y - 1.0, sn * r);
  vec4 P = proj(p, vec3(0.0, 4.6, 8.8), 0.52, 0.0, 0.6);
  gl_Position = P; gl_PointSize = max(1.5, (3.3 + lvl * 4.2) * uPx * (10.0 / (10.0 + r * 0.6)));
  vC = pal(0.05 + lvl * 0.8 + s.x * 0.25) * (0.22 + 0.5 * lvl + 0.18 * ring * uBass + 0.12 * uBeat);
  vA = 0.6;
}`
    }
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

    const pointBuffers = {};
    function pointProgram(name) {
      if (programs[name]) return programs[name];
      const def = PTS[name];
      const sh = (type, code) => { const x = gl.createShader(type); gl.shaderSource(x, code); gl.compileShader(x); return x; };
      const vs = sh(gl.VERTEX_SHADER, def.vs), fs = sh(gl.FRAGMENT_SHADER, PFRAG);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.bindAttribLocation(pr, 0, 's'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { programs[name] = { failed: (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getProgramInfoLog(pr) || '') }; return programs[name]; }
      const u = {};
      ['uRes', 'uTime', 'uBass', 'uMid', 'uHigh', 'uBeat', 'uPx', 'uC0', 'uC1', 'uC2', 'uC3', 'uB', 'uSquare'].forEach((k) => { u[k] = gl.getUniformLocation(pr, k); });
      programs[name] = { pr, u, points: true };
      return programs[name];
    }
    function program(name) {
      if (PTS[name]) return pointProgram(name);
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
      const u = P.u;
      if (P.points) {
        if (!pointBuffers[scene]) {
          const data = PTS[scene].n();
          const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          pointBuffers[scene] = { b, count: data.length / 3 };
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffers[scene].b);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.clearColor(0.012, 0.012, 0.02, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.uniform1f(u.uPx, Math.max(0.6, canvas.height / 520));
        gl.uniform1f(u.uSquare, PTS[scene].square);
      } else {
        gl.disable(gl.BLEND);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, (performance.now() - t0) / 1000);
      gl.uniform1f(u.uBass, bass); gl.uniform1f(u.uMid, mid); gl.uniform1f(u.uHigh, high);
      gl.uniform1f(u.uBeat, beat); gl.uniform1f(u.uBeatT, beatT);
      gl.uniform3fv(u.uC0, pal[0]); gl.uniform3fv(u.uC1, pal[1]); gl.uniform3fv(u.uC2, pal[2]); gl.uniform3fv(u.uC3, pal[3]);
      gl.uniform1fv(u.uB, lv);
      if (P.points) gl.drawArrays(gl.POINTS, 0, pointBuffers[scene].count); else gl.drawArrays(gl.TRIANGLES, 0, 3);
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

  const api = { create, SCENES, SCENE_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaaneBackdrop = api;
})(typeof window !== 'undefined' ? window : globalThis);
