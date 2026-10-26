const test = require('node:test');
const assert = require('node:assert');
const { analyze, planMix } = require('../mix-analysis');

const SR = 22050;
// a synthetic song: kick every beat, steady pad, optional quiet intro, fade-out, trailing silence
function song({ bpm, seconds, intro = 0, fade = 0, silence = 0 }) {
  const n = Math.floor((seconds + silence) * SR);
  const pcm = new Float32Array(n);
  const beat = 60 / bpm;
  for (let i = 0; i < seconds * SR; i++) {
    const t = i / SR;
    let gain = t < intro ? 0.15 : 1;
    if (fade > 0 && t > seconds - fade) gain *= Math.max(0, (seconds - t) / fade);
    const ph = (t % beat);
    const kick = Math.exp(-ph * 28) * Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-ph * 40)) * ph);
    const hat = ((t + beat / 2) % beat) < 0.02 ? (Math.random() - 0.5) * 0.3 : 0;
    const pad = 0.12 * Math.sin(2 * Math.PI * 220 * t);
    pcm[i] = (kick * 0.8 + hat + pad) * gain;
  }
  return pcm;
}

test('tempo detection lands within 1.5 BPM on a steady track', () => {
  for (const bpm of [100, 124, 140]) {
    const a = analyze(song({ bpm, seconds: 60 }), SR);
    assert.ok(Math.abs(a.bpm - bpm) < 1.5, `expected ~${bpm}, got ${a.bpm}`);
    assert.ok(a.bpmConfidence > 0.2, 'confidence ' + a.bpmConfidence);
  }
});

test('a fade-out gives a long outro, a hard ending gives almost none', () => {
  const faded = analyze(song({ bpm: 120, seconds: 60, fade: 10 }), SR);
  assert.ok(faded.audibleEnd - faded.outroStart > 4, `outro ${faded.audibleEnd - faded.outroStart}`);
  const hard = analyze(song({ bpm: 120, seconds: 60 }), SR);
  assert.ok(hard.audibleEnd - hard.outroStart < 3, `outro ${hard.audibleEnd - hard.outroStart}`);
});

test('trailing silence is not counted as audio', () => {
  const a = analyze(song({ bpm: 120, seconds: 50, silence: 8 }), SR);
  assert.ok(a.audibleEnd > 48 && a.audibleEnd < 52, 'audibleEnd ' + a.audibleEnd);
  assert.ok(a.duration > 57);
});

test('a quiet intro is detected', () => {
  const a = analyze(song({ bpm: 120, seconds: 40, intro: 8 }), SR);
  assert.ok(a.introEnd > 6 && a.introEnd < 10, 'introEnd ' + a.introEnd);
});

test('planMix: close tempos are matched, far ones are not', () => {
  const a = analyze(song({ bpm: 120, seconds: 60, fade: 8 }), SR);
  const near = analyze(song({ bpm: 126, seconds: 60 }), SR);
  const far = analyze(song({ bpm: 90, seconds: 60 }), SR);
  const p1 = planMix(a, near, 12);
  assert.ok(p1.tempoMatched && p1.rate > 0.9 && p1.rate < 1.0, JSON.stringify(p1));
  assert.ok(p1.len >= 4 && p1.len <= 12);
  const p2 = planMix(a, { ...far, bpm: 90, bpmConfidence: 0.9 }, 12);
  assert.strictEqual(p2.tempoMatched, false);
});

test('planMix: never longer than the maximum and starts so the blend ends with the audio', () => {
  const a = analyze(song({ bpm: 120, seconds: 60, fade: 20 }), SR);
  const p = planMix(a, null, 8);
  assert.ok(p.len <= 8);
  assert.ok(Math.abs(p.startAt + p.len - a.audibleEnd) < 0.2);
});

// ---- beat phase and key, with known ground truth
function clickTrack({ bpm, seconds, offset }) {
  const pcm = new Float32Array(Math.floor(seconds * SR));
  const P = 60 / bpm;
  for (let t = offset; t < seconds; t += P) {
    const s = Math.floor(t * SR);
    for (let k = 0; k < 900 && s + k < pcm.length; k++) pcm[s + k] += Math.exp(-k / 150) * Math.sin(2 * Math.PI * 90 * k / SR) * 0.9;
  }
  for (let i = 0; i < pcm.length; i++) pcm[i] += 0.05 * Math.sin(2 * Math.PI * 200 * i / SR);
  return pcm;
}
const circ = (a, b, P) => { let d = Math.abs(a - b) % P; return Math.min(d, P - d); };

test('beat phase: the grid lands within 20 ms of where the beats really are', () => {
  for (const [bpm, offset] of [[120, 0.13], [100, 0.31], [132, 0.05]]) {
    const a = analyze(clickTrack({ bpm, seconds: 50, offset }), SR);
    const P = 60 / bpm;
    assert.ok(circ(a.headPhase, offset, P) < 0.02, `head ${a.headPhase.toFixed(3)} vs ${offset} (bpm ${bpm})`);
    assert.ok(circ(a.tailPhase, offset, P) < 0.03, `tail ${a.tailPhase.toFixed(3)} vs ${offset} (bpm ${bpm})`);
  }
});

function chordTrack(notesHz, seconds = 30) {
  const pcm = new Float32Array(seconds * SR);
  for (let i = 0; i < pcm.length; i++) { let v = 0; for (const f of notesHz) v += Math.sin(2 * Math.PI * f * i / SR) + 0.4 * Math.sin(2 * Math.PI * 2 * f * i / SR); pcm[i] = v * 0.1; }
  return pcm;
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const { detectKey, keysCompatible } = require('../mix-analysis');

test('key detection: C major and A minor triads', () => {
  const cMaj = detectKey(chordTrack([hz(48), hz(52), hz(55), hz(60), hz(64), hz(67), hz(48 + 12 * 0), hz(55)]), SR);
  assert.strictEqual(cMaj.camelot + cMaj.letter, '8B', JSON.stringify(cMaj));
  const aMin = detectKey(chordTrack([hz(45), hz(48), hz(52), hz(57), hz(60), hz(64), hz(45), hz(52)]), SR);
  assert.strictEqual(aMin.camelot + aMin.letter, '8A', JSON.stringify(aMin));
});

test('harmonic mixing rules', () => {
  const k = (camelot, letter) => ({ camelot, letter, confidence: 0.5 });
  assert.strictEqual(keysCompatible(k(8, 'B'), k(8, 'A')), true, 'relative major/minor');
  assert.strictEqual(keysCompatible(k(8, 'B'), k(9, 'B')), true, 'a fifth up');
  assert.strictEqual(keysCompatible(k(8, 'B'), k(3, 'B')), false, 'far away');
  assert.strictEqual(keysCompatible(k(12, 'A'), k(1, 'A')), true, 'wraps round the wheel');
  assert.strictEqual(keysCompatible(k(8, 'B'), { camelot: 3, letter: 'B', confidence: 0.01 }), null, 'unsure');
});

test('planMix: starts on a beat of the outgoing song and clashing keys shorten the blend', () => {
  const a = analyze(clickTrack({ bpm: 120, seconds: 60, offset: 0.2 }), SR);
  const b = analyze(clickTrack({ bpm: 124, seconds: 60, offset: 0.1 }), SR);
  const p = planMix({ ...a, key: { camelot: 8, letter: 'B', confidence: 0.5 } }, { ...b, key: { camelot: 3, letter: 'B', confidence: 0.5 } }, 12);
  assert.ok(p.len <= 5, 'clash -> short, got ' + p.len);
  const P = 60 / (a.tailBpm || a.bpm);
  assert.ok(circ(p.startAt, a.tailPhase, P) < 0.01, 'on the beat grid');
});
