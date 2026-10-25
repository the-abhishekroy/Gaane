// Turns the player's ticking into listening time and plays, like BitChord's ListeningRecorder.
//
// It samples instead of measuring: every tick adds the wall-clock time since the previous tick (capped), so
// seeking cannot inflate the numbers, pausing adds nothing, and an hour left paused is not an hour listened.
// Minutes accumulate continuously; a "play" is counted once, when min(half the track, 4 minutes) (and at least
// 30 seconds) has gone by.
(function (root) {
  const MAX_STEP_MS = 8000;
  const PLAY_FLOOR_MS = 30000;
  const PLAY_CEILING_MS = 4 * 60 * 1000;

  function createRecorder(sink, now) {
    now = now || (() => Date.now());
    let current = null, last = 0, played = 0, counted = false;
    const pending = new Map();    // track id -> { track, ms, plays, ts }

    function add(track, ms, play) {
      const e = pending.get(track.id) || { track, ms: 0, plays: 0, ts: now() };
      e.ms += ms; e.plays += play ? 1 : 0; e.ts = now(); e.track = track;
      pending.set(track.id, e);
    }

    // one tick while audio is actually coming out
    function tick(track, durationMs) {
      if (!track || !track.id) return;
      const t = now();
      if (current !== track.id) { current = track.id; last = t; played = 0; counted = false; return; }
      const step = Math.min(Math.max(0, t - last), MAX_STEP_MS);
      last = t;
      if (step <= 0) return;
      played += step;
      const length = durationMs > 0 ? durationMs : (Number(track.duration) || 0) * 1000;
      const threshold = length > 0 ? Math.max(PLAY_FLOOR_MS, Math.min(length / 2, PLAY_CEILING_MS)) : PLAY_FLOOR_MS;
      const play = !counted && played >= threshold;
      if (play) counted = true;
      add(track, step, play);
    }

    // paused, stopped or moved on: the next tick anchors instead of contributing
    function stop() { current = null; played = 0; counted = false; flush(); }

    function flush() {
      if (!pending.size) return;
      const batch = [...pending.values()];
      pending.clear();
      try { sink(batch); } catch (e) { /* stats must never break playback */ }
    }

    return { tick, stop, flush, _pending: pending };
  }

  const api = { createRecorder, MAX_STEP_MS, PLAY_FLOOR_MS, PLAY_CEILING_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaaneListening = api;
})(typeof window !== 'undefined' ? window : globalThis);
