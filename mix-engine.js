// Playback extras for Gaane, in the spirit of BitChord's player:
//   * true crossfade: the outgoing song keeps playing on a second deck while the next one fades in
//   * Automix: the blend length comes from analysing the song's outro, the incoming song is tempo-matched
//     and the bass is swapped across the blend
//   * Skip silence, Spatial audio, AutoPlay
(function (root) {
  const KEY = 'gaane_mix';
  const DEFAULTS = { crossfade: 0, automix: false, skipSilence: false, spatial: 0, autoplay: true };
  const MAX_LEN = 12;

  let host = null;                 // { el, state, engine, playNext, base, toast, track }
  let ghost = null;                // second <audio> element
  let cfg = load();
  let analyses = {};               // trackId -> analysis
  let pending = {};                // trackId -> Promise
  let phase = 'idle';              // idle | preparing | ready | handoff | blending
  let plan = null, planFor = '', lastMix = null;
  let blendFinish = null, glideTimer = null, ownStart = false;
  let silenceSince = 0, silenceSkipping = false, baseRate = 1, outId = '';

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      const c = Object.assign({}, DEFAULTS, raw || {});
      if (!raw) { const old = parseInt(localStorage.getItem('riff_crossfade') || '0', 10); if (old > 0) c.crossfade = Math.min(MAX_LEN, old); }
      return c;
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  function loadCache() { try { analyses = JSON.parse(localStorage.getItem('gaane_mix_analysis') || '{}') || {}; } catch (e) { analyses = {}; } }
  function saveCache() {
    try {
      const keys = Object.keys(analyses);
      if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((k) => delete analyses[k]);
      localStorage.setItem('gaane_mix_analysis', JSON.stringify(analyses));
    } catch (e) {}
  }

  const mode = () => (cfg.automix ? 'auto' : cfg.crossfade > 0 ? 'fixed' : 'off');
  const eng = () => (host && host.engine && host.engine());
  const audio = () => host.el.nativeAudio;

  // ---------------------------------------------------------------- analysis
  async function decodeMono(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch ' + res.status);
    const buf = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 11025);
    const decoded = await ctx.decodeAudioData(buf);
    if (decoded.numberOfChannels === 1) return { pcm: decoded.getChannelData(0), sr: decoded.sampleRate };
    const a = decoded.getChannelData(0), b = decoded.getChannelData(1), out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return { pcm: out, sr: decoded.sampleRate };
  }

  function analyseUrl(id, url) {
    if (analyses[id]) return Promise.resolve(analyses[id]);
    if (pending[id]) return pending[id];
    pending[id] = decodeMono(url).then(({ pcm, sr }) => {
      const a = root.GaaneMixAnalysis.analyze(pcm, sr);
      analyses[id] = a; saveCache();
      return a;
    }).catch((e) => { return null; }).finally(() => { delete pending[id]; });
    return pending[id];
  }

  async function streamUrlFor(track) {
    if (!track) return '';
    if (track.platform === 'local') return `${host.base()}/api/library-file?id=${encodeURIComponent(track.id)}`;
    try {
      const q = `url=${encodeURIComponent(track.url || '')}&id=${encodeURIComponent(track.id || '')}&platform=${track.platform || 'youtube'}&title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}&duration=${encodeURIComponent(track.duration || 0)}&thumbnail=${encodeURIComponent(track.thumbnail || '')}`;
      const d = await (await fetch(`${host.base()}/api/stream-info?${q}`)).json();
      return d && d.success && !d.isHls ? d.streamUrl : '';
    } catch (e) { return ''; }
  }

  function nextTrack() {
    const s = host.state;
    if (!s.queue || !s.queue.length) return null;
    if (s.isShuffle) return null;                       // random pick is made at the moment of the join
    const i = s.queueIndex + 1;
    return i < s.queue.length ? s.queue[i] : null;
  }

  function startAnalysis() {
    if (mode() !== 'auto') return;
    const cur = host.state.currentTrack;
    if (cur && cur.id && !analyses[cur.id]) { const src = audio().currentSrc; if (src && !/^blob:/.test(src)) analyseUrl(cur.id, src); }
  }
  async function analyseNext() {
    if (mode() !== 'auto') return;
    const nx = nextTrack();
    if (!nx || analyses[nx.id]) return;
    const url = await streamUrlFor(nx);
    if (url) analyseUrl(nx.id, url);
  }

  // ---------------------------------------------------------------- planning
  function currentPlan(dur) {
    const cur = host.state.currentTrack, nx = nextTrack();
    const key = `${cur && cur.id}|${nx && nx.id}|${mode()}|${cfg.crossfade}`;
    if (plan && planFor === key) return plan;
    let p;
    if (mode() === 'auto') {
      const a = cur && analyses[cur.id], b = nx && analyses[nx.id];
      p = a ? root.GaaneMixAnalysis.planMix(a, b || null, MAX_LEN) : { len: 8, rate: 1, bassSwap: true, tempoMatched: false, reason: 'not analysed yet', startAt: dur - 8 };
      if (a) p.startAt = Math.min(p.startAt, dur - 1);
      p.analysed = !!a;
    } else {
      const X = Math.min(MAX_LEN, cfg.crossfade);
      p = { len: X, rate: 1, bassSwap: false, tempoMatched: false, reason: '', startAt: dur - X, analysed: true };
    }
    // when only the outgoing song has been analysed we may still be waiting for the next one: keep re-planning
    if (mode() === 'auto' && !(nx && analyses[nx.id])) { plan = null; return p; }
    plan = p; planFor = key; return p;
  }

  // ---------------------------------------------------------------- the transition
  function usable() {
    const a = audio(), e = eng();
    if (!a || !e || !e.graphInitialized) return false;
    if (a.paused || !a.currentSrc) return false;
    if (host.hls && host.hls()) return false;           // HLS streams cannot be copied to the second deck
    if (e.isLiveStream && e.isLiveStream(a)) return false;
    return true;
  }
  function hasNext() {
    const s = host.state;
    return !s.isRepeat && ((s.queue && s.queue.length > 1) || (cfg.autoplay && s.currentTrack && s.currentTrack.platform !== 'local'));
  }

  function prepareGhost() {
    if (phase !== 'idle') return;
    const e = eng(), a = audio();
    if (!ghost) { ghost = new Audio(); ghost.crossOrigin = 'anonymous'; ghost.preload = 'auto'; ghost.id = 'gaane-ghost-audio'; }
    try { e.ensureGhost(ghost); } catch (err) { return; }
    phase = 'preparing';
    ghost.pause();
    ghost.src = a.currentSrc;
    ghost.playbackRate = a.playbackRate;
    ghost.volume = 1;
    const ready = () => { if (phase === 'preparing') phase = 'ready'; };
    ghost.addEventListener('canplay', ready, { once: true });
    ghost.load();
  }

  async function handoff(p) {
    if (phase !== 'ready' || !usable()) return false;
    phase = 'handoff';
    const a = audio(), e = eng();
    try {
      ghost.currentTime = Math.min(a.duration - 0.2, a.currentTime + 0.06);
      ghost.playbackRate = a.playbackRate;
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('ghost start timeout')), 1200);
        ghost.addEventListener('playing', () => { clearTimeout(t); res(); }, { once: true });
        ghost.play().catch(rej);
      });
      baseRate = a.playbackRate;
      // wait until the ghost really is producing sound (the "playing" event fires a little early), then swap
      const t0 = performance.now(), startPos = ghost.currentTime;
      while (ghost.currentTime < startPos + 0.12 && performance.now() - t0 < 900) await new Promise((r) => setTimeout(r, 15));
      plan = p; plan.handoffOffsetMs = Math.round((ghost.currentTime - a.currentTime) * 1000);
      e.swapToGhost();
      outId = host.state.currentTrack && host.state.currentTrack.id;
    } catch (err) { abort(); return false; }
    ownStart = true;
    host.state._isNaturalEnding = true;
    try { host.playNext(); } finally { host.state._isNaturalEnding = false; ownStart = false; }
    phase = 'blending';
    plan = p;
    // the incoming song never started? give up after a while and let the ghost finish
    clearTimeout(blendFinish);
    blendFinish = setTimeout(() => { if (phase === 'blending' && !blendRunning) finishBlend(); }, 15000);
    return true;
  }

  let blendRunning = false;
  const mod = (x, m) => ((x % m) + m) % m;

  // Put the incoming song's beats on the outgoing song's beats. Done while the incoming deck is still silent.
  async function alignIncoming(A, B) {
    const a = audio();
    a.playbackRate = baseRate * plan.rate;
    const seekTo = (t) => new Promise((res) => {
      const done = () => { clearTimeout(to); a.removeEventListener('seeked', done); res(); };
      const to = setTimeout(done, 700);
      a.addEventListener('seeked', done, { once: true });
      try { a.currentTime = Math.max(0, t); } catch (err) { done(); }
    });
    const PA = 60 / plan.aBpm, PB = 60 / plan.bBpm;
    const error = () => {
      const fa = mod(ghost.currentTime - A.tailPhase, PA) / PA, fb = mod(a.currentTime - B.headPhase, PB) / PB;
      let d = fa - fb; if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
      return d * PB;                                    // media seconds the incoming song has to move
    };
    // skip a silent start
    if (B.audibleStart > 0.4 && a.currentTime < B.audibleStart && B.audibleStart < 8) await seekTo(B.audibleStart);
    for (let attempt = 0; attempt < 2; attempt++) {
      const d = error();
      if (Math.abs(d) < 0.012) break;
      await seekTo(a.currentTime + d + 0.035);          // 35 ms: what a seek costs before sound flows again
      await new Promise((r) => setTimeout(r, 90));
    }
    plan.alignErrMs = Math.round(error() * PA / PB * 1000);
  }

  async function onMainPlaying() {
    if (phase !== 'blending' || blendRunning) return;
    const e = eng();
    blendRunning = true;
    const cur = host.state.currentTrack, A = analyses[outId], B = cur && analyses[cur.id];
    if (mode() === 'auto' && B) {
      try {
        if (plan.tempoMatched && A && A.tailPhase !== undefined && B.headPhase !== undefined) await alignIncoming(A, B);
        else if (B.audibleStart > 0.4 && B.audibleStart < 8 && audio().currentTime < B.audibleStart) { audio().currentTime = B.audibleStart; await new Promise((r) => setTimeout(r, 120)); }
      } catch (err) {}
    }
    if (phase !== 'blending') return;
    const remaining = Math.max(0.5, (ghost.duration || 0) - ghost.currentTime - 0.15);
    const len = Math.max(0.6, Math.min(plan.len, remaining));
    plan.usedLen = Math.round(len * 10) / 10;
    e.crossfadeDecks(len, !!plan.bassSwap, !!(A && mode() === 'auto' && (A.audibleEnd - A.outroStart) >= 3));
    if (plan.tempoMatched) {
      const a = audio();
      a.playbackRate = baseRate * plan.rate;
      const t0 = performance.now(), span = Math.max(8000, len * 1000);
      clearInterval(glideTimer);
      glideTimer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / span);
        try { a.playbackRate = baseRate * (plan.rate + (1 - plan.rate) * k); } catch (err) {}
        if (k >= 1) { clearInterval(glideTimer); glideTimer = null; try { a.playbackRate = baseRate; } catch (err) {} }
      }, 200);
    }
    lastMix = Object.assign({}, plan, { from: outId, to: cur && cur.id });
    clearTimeout(blendFinish);
    blendFinish = setTimeout(finishBlend, len * 1000 + 250);
  }

  function finishBlend() {
    clearTimeout(blendFinish); blendFinish = null;
    try { if (ghost) ghost.pause(); } catch (e) {}
    const e = eng(); if (e && e.resetDecks) e.resetDecks();
    blendRunning = false; phase = 'idle'; plan = null; planFor = '';
  }

  function abort() {
    clearTimeout(blendFinish); blendFinish = null;
    clearInterval(glideTimer); glideTimer = null;
    try { if (ghost) ghost.pause(); } catch (e) {}
    const e = eng(); if (e && e.resetDecks) e.resetDecks();
    blendRunning = false; phase = 'idle';
  }

  // Called by the app on every timeupdate of the main element. Returns true when the mix has taken over the ending.
  function onTimeUpdate(cur, dur) {
    if (!host || mode() === 'off' || !(dur > 8)) return false;
    if (phase === 'blending' || phase === 'handoff') return true;
    if (!usable() || !hasNext()) return false;
    if (cur < 2) return false;
    if (dur > 0 && cur / dur > 0.35) analyseNext();
    const p = currentPlan(dur);
    if (mode() === 'auto' && !p.analysed) startAnalysis();
    if (cur >= p.startAt - 8 && phase === 'idle') prepareGhost();
    if (cur >= p.startAt - 1.6 && phase === 'ready') { handoff(p); return true; }
    return false;
  }

  function onTrackStart() {
    // a track started by the user (or anything other than our own hand-off) cancels a transition in flight
    if (!ownStart && (phase === 'blending' || phase === 'handoff' || phase === 'preparing' || phase === 'ready')) abort();
    plan = null; planFor = ''; silenceSkipping = false; silenceSince = 0;
    try { audio().playbackRate = audio().playbackRate; } catch (e) {}
  }
  // the main element pauses by itself while the next song is being loaded: that is not the user stopping the music
  function onPause() { if ((phase === 'blending' && blendRunning) ) abort(); }
  const isBlending = () => phase === 'blending' || phase === 'handoff';

  // ---------------------------------------------------------------- skip silence
  function silenceTick() {
    if (!host || !cfg.skipSilence || isBlending()) return;
    const a = audio(), e = eng();
    if (!a || !e || a.paused || !e.getOutputDb || !a.duration) return;
    const db = e.getOutputDb();
    const now = performance.now();
    if (db < -58) {
      if (!silenceSince) silenceSince = now;
      if (!silenceSkipping && now - silenceSince > 450) { silenceSkipping = true; baseRate = a.playbackRate; try { a.playbackRate = Math.min(4, baseRate * 4); } catch (err) {} }
    } else if (db > -50) {
      silenceSince = 0;
      if (silenceSkipping) { silenceSkipping = false; try { a.playbackRate = baseRate; } catch (err) {} }
    }
  }

  // ---------------------------------------------------------------- spatial audio
  function applySpatial() { const e = eng(); if (e && e.setSpatial && e.graphInitialized) e.setSpatial(cfg.spatial); }

  // ---------------------------------------------------------------- autoplay
  const radioSeen = new Set();
  async function extendQueue() {
    if (!cfg.autoplay || !host) return 0;
    const s = host.state, last = s.currentTrack;
    if (!last || last.platform === 'local' || !/^[\w-]{11}$/.test(String(last.id || ''))) return 0;
    if (radioSeen.has(last.id)) return 0;
    radioSeen.add(last.id);
    try {
      const d = await (await fetch(`${host.base()}/api/ytm-radio?id=${encodeURIComponent(last.id)}`)).json();
      if (!d.success || !Array.isArray(d.tracks)) return 0;
      const norm = (t) => `${String(t.title).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()}|${String(t.artist).toLowerCase().split(/,|&/)[0].trim()}`;
      const have = new Set(s.queue.map((t) => t.id)); const haveNorm = new Set(s.queue.map(norm));
      const perArtist = {}; s.queue.slice(-6).forEach((t) => { const a = String(t.artist).toLowerCase(); perArtist[a] = (perArtist[a] || 0) + 1; });
      const seedArtist = String(last.artist || '').toLowerCase();
      const fresh = [];
      for (const t of d.tracks) {
        if (fresh.length >= 10) break;
        const a = String(t.artist).toLowerCase(), cap = a === seedArtist ? 4 : 2;
        if (have.has(t.id) || haveNorm.has(norm(t)) || (perArtist[a] || 0) >= cap) continue;
        perArtist[a] = (perArtist[a] || 0) + 1; have.add(t.id); haveNorm.add(norm(t));
        fresh.push(Object.assign({}, t, { autoplay: true }));
      }
      if (fresh.length) { s.queue.push(...fresh); if (host.queueChanged) host.queueChanged(); }
      return fresh.length;
    } catch (e) { return 0; }
  }
  function maybeExtend() {
    const s = host && host.state;
    if (!cfg.autoplay || !s || s.isRepeat || s.myWaveActive) return;
    if (s.queue.length - 1 - s.queueIndex <= 2) extendQueue();
  }

  // ---------------------------------------------------------------- public api
  function init(h) {
    host = h; loadCache();
    const a = audio();
    a.addEventListener('playing', () => { onMainPlaying(); if (mode() === 'auto') setTimeout(startAnalysis, 3000); });
    a.addEventListener('pause', onPause);
    setInterval(silenceTick, 120);
    applySpatial();
  }

  const api = {
    init, onTimeUpdate, onTrackStart, isBlending, applySpatial, extendQueue, maybeExtend,
    get settings() { return Object.assign({}, cfg); },
    set(patch) { cfg = Object.assign({}, cfg, patch); save(); plan = null; planFor = ''; applySpatial(); if (!cfg.skipSilence && silenceSkipping) { silenceSkipping = false; try { audio().playbackRate = baseRate; } catch (e) {} } if (mode() === 'off') abort(); return cfg; },
    status() { return { mode: mode(), phase, plan, lastMix, analysed: Object.keys(analyses).length }; },
    lastMix: () => lastMix,
    _debug: { analyses: () => analyses, abort, level: () => { const e = eng(); return e && e.getOutputDb ? e.getOutputDb() : -120; }, gains: () => { const e = eng(); return e && e.mainDeck ? { main: +e.mainDeck.gain.value.toFixed(2), ghost: e.ghostDeck ? +e.ghostDeck.gain.value.toFixed(2) : null } : null; } }
  };
  root.GaaneMix = api;
})(typeof window !== 'undefined' ? window : globalThis);
