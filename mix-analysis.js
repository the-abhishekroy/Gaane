// Track analysis for Automix: tempo, where the outro starts and where the audio really ends.
// Pure functions over mono PCM so they can be unit-tested without a browser.
(function (root) {
  const ENV_HOP_HZ = 200;   // envelope resolution (5 ms)

  function envelope(pcm, sr) {
    const hop = Math.max(1, Math.round(sr / ENV_HOP_HZ));
    const n = Math.floor(pcm.length / hop);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = i * hop, e = k + hop; k < e; k++) sum += pcm[k] * pcm[k];
      env[i] = Math.sqrt(sum / hop);
    }
    return { env, rate: sr / hop };
  }

  function percentile(arr, p) {
    const c = Array.from(arr).sort((a, b) => a - b);
    return c[Math.min(c.length - 1, Math.floor(p * c.length))] || 0;
  }

  // 0.5 s moving average
  function smooth(env, rate, seconds = 0.5) {
    const w = Math.max(1, Math.round(seconds * rate));
    const out = new Float32Array(env.length);
    let acc = 0;
    for (let i = 0; i < env.length; i++) {
      acc += env[i];
      if (i >= w) acc -= env[i - w];
      out[i] = acc / Math.min(i + 1, w);
    }
    return out;
  }

  function onsetStrength(env) {
    const n = env.length, onset = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const d = Math.log1p(env[i] * 60) - Math.log1p(env[i - 1] * 60);
      onset[i] = d > 0 ? d : 0;
    }
    return onset;
  }

  // tempo of an onset-strength segment
  function tempoOf(seg, rate) {
    if (seg.length < rate * 8) return { bpm: 0, confidence: 0 };
    let mean = 0; for (let i = 0; i < seg.length; i++) mean += seg[i]; mean /= seg.length || 1;
    const x = new Float32Array(seg.length); for (let i = 0; i < seg.length; i++) x[i] = seg[i] - mean;
    const minLag = Math.floor(rate * 60 / 190), maxLag = Math.ceil(rate * 60 / 65);
    const ac = new Float32Array(maxLag + 2);
    let zero = 0; for (let i = 0; i < x.length; i++) zero += x[i] * x[i]; zero /= (x.length || 1);
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0; for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
      ac[lag] = s / Math.max(1, x.length - lag);
    }
    let best = -1, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = rate * 60 / lag;
      const prior = bpm >= 80 && bpm <= 160 ? 1 : 0.8;
      const score = ac[lag] * prior;
      if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && score > bestScore) { bestScore = score; best = lag; }
    }
    if (best < 0 || zero === 0) return { bpm: 0, confidence: 0 };
    const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    let bpm = rate * 60 / (best + shift);
    while (bpm < 80) bpm *= 2;
    while (bpm > 165) bpm /= 2;
    const confidence = Math.max(0, Math.min(1, zero > 0 ? y1 / zero : 0));
    return { bpm: Math.round(bpm * 100) / 100, confidence: Math.round(confidence * 1000) / 1000 };
  }

  // Fold the onsets over one beat period: the phase where they pile up is where the beats fall.
  // The tempo is refined at the same time (a 0.2% tempo error would drift 80 ms over 40 s).
  function foldAt(onset, rate, bpm, fromFrame, toFrame) {
    const P = 60 / bpm, BINS = 64, acc = new Float64Array(BINS);
    for (let n = fromFrame; n < toFrame && n < onset.length; n++) {
      const ph = ((n / rate) % P) / P;
      acc[Math.min(BINS - 1, Math.floor(ph * BINS))] += onset[n];
    }
    let best = 0, bv = -1, sharp = 0;
    for (let i = 0; i < BINS; i++) {
      const v = acc[(i + BINS - 1) % BINS] + 2 * acc[i] + acc[(i + 1) % BINS];
      sharp += acc[i] * acc[i];
      if (v > bv) { bv = v; best = i; }
    }
    return { phase: ((best + 0.5) / BINS) * P, sharp };
  }

  function beatPhase(onset, rate, bpm, fromFrame, toFrame) {
    if (!(bpm > 0)) return { phase: 0, bpm: 0 };
    let bestBpm = bpm, bestSharp = -1;
    for (let k = -60; k <= 60; k++) {
      const cand = bpm * (1 + k * 0.0002);
      const f = foldAt(onset, rate, cand, fromFrame, toFrame);
      if (f.sharp > bestSharp) { bestSharp = f.sharp; bestBpm = cand; }
    }
    const f = foldAt(onset, rate, bestBpm, fromFrame, toFrame);
    return { phase: f.phase, bpm: Math.round(bestBpm * 1000) / 1000 };
  }

  function tempo(env, rate) {
    const onset = onsetStrength(env), n = onset.length;
    const maxN = Math.floor(90 * rate);
    const start = n > maxN ? Math.floor((n - maxN) / 2) : 0;
    return tempoOf(onset.subarray(start, start + Math.min(n, maxN)), rate);
  }

  // ---- key (Krumhansl-Schmuckler on a chroma built with Goertzel filters)
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function chroma(pcm, sr, fromSec, toSec) {
    const N = 4096, hop = N * 2, out = new Float64Array(12);
    const from = Math.max(0, Math.floor(fromSec * sr)), to = Math.min(pcm.length - N, Math.floor(toSec * sr));
    const notes = []; for (let m = 45; m <= 80; m++) notes.push({ pc: m % 12, w: 2 * Math.cos(2 * Math.PI * (440 * Math.pow(2, (m - 69) / 12)) / sr) });
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    for (let pos = from; pos <= to; pos += hop) {
      for (const nt of notes) {
        let s1 = 0, s2 = 0;
        for (let i = 0; i < N; i++) { const s0 = pcm[pos + i] * win[i] + nt.w * s1 - s2; s2 = s1; s1 = s0; }
        out[nt.pc] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - nt.w * s1 * s2));
      }
    }
    return out;
  }

  function detectKey(pcm, sr) {
    const dur = pcm.length / sr;
    const c = chroma(pcm, sr, Math.max(0, dur * 0.15), Math.min(dur, dur * 0.15 + 60));
    let total = 0; for (const v of c) total += v;
    if (!(total > 0)) return null;
    const corr = (profile, shift) => {
      let mx = 0, my = 0; for (let i = 0; i < 12; i++) { mx += c[(i + shift) % 12]; my += profile[i]; } mx /= 12; my /= 12;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < 12; i++) { const x = c[(i + shift) % 12] - mx, y = profile[i] - my; num += x * y; dx += x * x; dy += y * y; }
      return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
    };
    let best = { tonic: 0, minor: false, score: -2 }, second = -2;
    for (let t = 0; t < 12; t++) for (const minor of [false, true]) {
      const sc = corr(minor ? MINOR : MAJOR, t);
      if (sc > best.score) { second = best.score; best = { tonic: t, minor, score: sc }; } else if (sc > second) second = sc;
    }
    const major = best.minor ? (best.tonic + 3) % 12 : best.tonic;
    let camelot = (8 + 7 * major) % 12; if (camelot === 0) camelot = 12;
    return { tonic: best.tonic, minor: best.minor, camelot, letter: best.minor ? 'A' : 'B', confidence: Math.max(0, best.score - second) };
  }

  // harmonic mixing: same key, relative major/minor, or a step round the Camelot wheel
  function keysCompatible(a, b) {
    if (!a || !b) return null;
    if (a.confidence < 0.04 || b.confidence < 0.04) return null;
    const d = Math.min((a.camelot - b.camelot + 12) % 12, (b.camelot - a.camelot + 12) % 12);
    if (a.letter === b.letter) return d <= 1;
    return d === 0;
  }

  function analyze(pcm, sr) {
    const { env, rate } = envelope(pcm, sr);
    const duration = pcm.length / sr;
    const sm = smooth(env, rate);
    const loud = percentile(sm, 0.75) || 1e-6;
    const floor = loud * 0.04;
    let firstAudible = 0; while (firstAudible < sm.length && sm[firstAudible] < floor) firstAudible++;
    let lastAudible = sm.length - 1; while (lastAudible > 0 && sm[lastAudible] < floor) lastAudible--;
    // the outro starts after the last stretch that is still at full level
    let outro = lastAudible; const full = loud * 0.55;
    while (outro > 0 && sm[outro] < full) outro--;
    // the intro ends once the track has stayed at full level for a second
    const hold = Math.round(rate);
    let introEnd = firstAudible, run = 0;
    for (let i = firstAudible; i < sm.length; i++) { if (sm[i] >= full) { run++; if (run >= hold) { introEnd = i - hold + 1; break; } } else run = 0; introEnd = i; }
    const t = tempo(env, rate);
    const onset = onsetStrength(env);
    const grid = (fromSec, toSec) => {
      const f = Math.max(0, Math.floor(fromSec * rate)), e = Math.min(onset.length, Math.floor(toSec * rate));
      const tt = tempoOf(onset.subarray(f, e), rate);
      const useBpm = tt.confidence >= 0.2 && Math.abs(tt.bpm / (t.bpm || 1) - 1) < 0.08 ? tt.bpm : t.bpm;
      return beatPhase(onset, rate, useBpm, f, e);
    };
    const startS = firstAudible / rate, endS = (lastAudible + 1) / rate;
    const head = grid(startS, Math.min(endS, startS + 40));
    const tail = grid(Math.max(0, endS - 40), endS);
    let key = null; try { key = detectKey(pcm, sr); } catch (e) {}
    return {
      headBpm: head.bpm, headPhase: head.phase, tailBpm: tail.bpm, tailPhase: tail.phase, key,

      duration,
      bpm: t.bpm, bpmConfidence: t.confidence,
      audibleStart: firstAudible / rate,
      audibleEnd: Math.min(duration, (lastAudible + 1) / rate),
      outroStart: Math.min(duration, outro / rate),
      introEnd: Math.min(duration, introEnd / rate),
      loudness: loud
    };
  }

  // Decide how to join `a` (outgoing) to `b` (incoming).
  //  maxLen: longest blend allowed (seconds)
  function planMix(a, b, maxLen = 12) {
    const plan = { len: 6, rate: 1, bassSwap: true, tempoMatched: false, reason: '', keyCompatible: null };
    if (!a) { plan.reason = 'no analysis of the outgoing track'; return plan; }
    const tail = Math.max(0, a.audibleEnd - a.outroStart);
    let len = tail >= 3 ? Math.min(maxLen, Math.max(4, tail)) : Math.min(maxLen, 6);
    if (b && b.introEnd - b.audibleStart > len + 2) len = Math.min(maxLen, Math.max(len, b.introEnd - b.audibleStart));
    // harmonic mixing: songs that clash in key get a short, clean blend; compatible ones may overlap for longer
    plan.keyCompatible = b ? keysCompatible(a.key, b.key) : null;
    if (plan.keyCompatible === false) { len = Math.min(len, 5); plan.reason = 'keys clash: short blend'; }
    else if (plan.keyCompatible === true) len = Math.min(maxLen, len + 2);
    plan.len = Math.round(len * 10) / 10;

    const aBpm = a.tailBpm || a.bpm, bBpm = (b && (b.headBpm || b.bpm)) || 0;
    const aConf = a.bpmConfidence, bConf = b ? b.bpmConfidence : 0;
    if (b && aConf >= 0.06 && bConf >= 0.06 && aBpm > 0 && bBpm > 0) {
      let ratio = aBpm / bBpm;
      if (ratio > 1.7) ratio /= 2; else if (ratio < 0.6) ratio *= 2;
      if (ratio >= 0.9 && ratio <= 1.25) { plan.rate = Math.round(ratio * 1000) / 1000; plan.tempoMatched = true; }
      else plan.reason = (plan.reason ? plan.reason + '; ' : '') + `tempos too far apart (${aBpm} -> ${bBpm})`;
    } else if (b) {
      plan.reason = (plan.reason ? plan.reason + '; ' : '') + 'tempo not reliable';
    }
    // start the blend on a beat of the outgoing song, so it ends where its audio ends
    let startAt = Math.max(0, a.audibleEnd - plan.len);
    if (plan.tempoMatched && a.tailPhase !== undefined && aBpm > 0) {
      const P = 60 / aBpm;
      startAt = a.tailPhase + Math.floor((startAt - a.tailPhase) / P) * P;
      if (startAt < 0) startAt += P;
    }
    plan.startAt = startAt;
    plan.aBpm = aBpm; plan.bBpm = bBpm;
    return plan;
  }

  const api = { analyze, planMix, tempo, envelope, detectKey, keysCompatible };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaaneMixAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
