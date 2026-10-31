// The queue rules, ported from BitChord (QueueTimeline.kt, QueueBuilder.kt, Autoplay.kt) so Gaane decides what
// plays next the same way:
//
//   * Three tiers. CONTEXT is the list the listener started (an album, a playlist, the library) or a single song;
//     USER is what they queued by hand (Play next / Add to queue); AUTOPLAY is the radio that fills the end.
//   * Tapping a song that is not part of a list (a search result, a shelf song) plays that song alone and the
//     station plays on from it. It does NOT play the next search result.
//   * The radio is de-duplicated on recording (normalised title + shared artist), capped per artist, and prefers
//     catalogue songs over music videos.
(function (root) {
  const CONTEXT = 'context', USER = 'user', AUTOPLAY = 'autoplay';
  const MAX_QUEUED_AUTOPLAY = 10, PER_ARTIST_LIMIT = 2, SEED_ARTIST_LIMIT = 4, MIN_VIDEO_STATION = 3;
  const LOW_WATER = 3;                      // top the station up when fewer than this many tracks are left
  const BACK_RESTARTS_AFTER_SEC = 10;       // Back restarts the song after this, else goes to the previous one

  let counter = 0;
  const entry = (song, tier) => Object.assign({}, song, { _tier: tier, _eid: song._eid || `q${Date.now().toString(36)}${(counter++).toString(36)}` });
  const tierOf = (t) => (t && t._tier) || CONTEXT;

  const NOISE = /\((?:official|lyric|lyrics|lyrical|audio|video|visuali[sz]er|full song|hd|4k)[^)]*\)|\(from[^)]*\)|\[[^\]]*\]|\b(?:official (?:video|audio|music video)|lyrical video|full video|4k video)\b/gi;
  const TOPIC = /\s*-\s*topic\b/gi;
  const PUNCT = /[^\p{L}\p{N}]+/gu;

  function normalisedTitle(raw) {
    return String(raw || '').toLowerCase().split(' | ')[0].replace(NOISE, ' ').replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
  }
  function artistSet(raw) {
    return new Set(String(raw || '').toLowerCase().replace(TOPIC, ' ')
      .split(/,|&|·|•|;| feat| ft\.| ft | x | with /)
      .map((s) => s.replace(PUNCT, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean));
  }
  function isSameRecording(a, b) {
    if (a.id && a.id === b.id) return true;
    const t = normalisedTitle(a.title);
    if (!t || t !== normalisedTitle(b.title)) return false;
    const l = artistSet(a.artist), r = artistSet(b.artist);
    if (!l.size || !r.size) return true;
    for (const x of l) if (r.has(x)) return true;
    return false;
  }

  // The subset of `candidates` worth appending after `existing`.
  function extend(existing, candidates, limit = MAX_QUEUED_AUTOPLAY, preferVideos = false) {
    const taken = existing.slice();
    const perArtist = {};
    const seedArtists = existing.length ? artistSet(existing[existing.length - 1].artist) : new Set();
    const songsOnly = candidates.filter((c) => !c.isVideo), videosOnly = candidates.filter((c) => c.isVideo);
    let ordered;
    if (preferVideos && videosOnly.length >= MIN_VIDEO_STATION) ordered = videosOnly;
    else if (preferVideos) ordered = candidates;
    else ordered = songsOnly.length ? songsOnly : candidates;
    const out = [];
    for (const c of ordered) {
      if (out.length >= limit) break;
      if (taken.some((t) => isSameRecording(t, c))) continue;
      const artists = [...artistSet(c.artist)].sort();
      const key = artists[0];
      if (key !== undefined) {
        let seed = false; for (const a of artists) if (seedArtists.has(a)) seed = true;
        const cap = seed ? SEED_ARTIST_LIMIT : PER_ARTIST_LIMIT;
        const played = perArtist[key] || 0;
        if (played >= cap) continue;
        perArtist[key] = played + 1;
      }
      taken.push(c); out.push(c);
    }
    return out;
  }

  const upcomingUser = (timeline, idx) => (idx >= 0 && idx < timeline.length ? timeline.slice(idx + 1).filter((t) => tierOf(t) === USER) : []);

  // A list the listener started: earlier songs behind the picked one, their hand-queued songs right after it.
  function buildContextQueue(timeline, currentIndex, songs, selectedIndex, source) {
    if (!songs.length) return { timeline: [], startIndex: 0 };
    const tag = (s) => entry(Object.assign({}, s, { _source: source || '' }), CONTEXT);
    const entries = songs.map(tag);
    const i = Math.max(0, Math.min(entries.length - 1, selectedIndex));
    return { timeline: [...entries.slice(0, i), entries[i], ...upcomingUser(timeline, currentIndex), ...entries.slice(i + 1)], startIndex: i };
  }

  // A single song: the song, then whatever the listener had queued by hand. The station is added after it.
  function buildOneOffQueue(timeline, currentIndex, song, source) {
    return [entry(Object.assign({}, song, { _source: source || '' }), CONTEXT), ...upcomingUser(timeline, currentIndex)];
  }

  // Where Play next (head of the hand-queued songs) or Add to queue (their tail) goes.
  function userInsertionIndex(timeline, currentIndex, isNext) {
    if (!timeline.length) return 0;
    const start = Math.max(0, Math.min(timeline.length, currentIndex + 1));
    if (isNext) return start;
    for (let i = start; i < timeline.length; i++) if (tierOf(timeline[i]) !== USER) return i;
    return timeline.length;
  }

  // Tapping a row in Up Next: what the queue becomes, as BitChord's computeJumpOrder.
  function computeJumpOrder(tiers, currentIndex, targetIndex) {
    const n = tiers.length;
    if (currentIndex < 0 || currentIndex >= n || targetIndex < 0 || targetIndex >= n) return null;
    const all = [...Array(n).keys()];
    if (targetIndex <= currentIndex) return { isPureSeek: true, order: all, target: targetIndex };
    const range = (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return r; };
    const hist = range(0, currentIndex + 1);
    const targetTier = tiers[targetIndex];
    if (targetTier === CONTEXT) {
      const crossedUser = range(currentIndex + 1, targetIndex).filter((i) => tiers[i] === USER);
      if (!crossedUser.length) return { isPureSeek: true, order: all, target: targetIndex };
      const bypassed = range(currentIndex + 1, targetIndex).filter((i) => tiers[i] === CONTEXT);
      const after = range(targetIndex + 1, n);
      const order = [...hist, ...bypassed, targetIndex, ...crossedUser, ...after.filter((i) => tiers[i] === USER), ...after.filter((i) => tiers[i] === CONTEXT), ...after.filter((i) => tiers[i] === AUTOPLAY)];
      return { isPureSeek: false, order, target: hist.length + bypassed.length };
    }
    if (targetTier === USER) {
      const rest = range(targetIndex + 1, n).filter((i) => tiers[i] === USER);
      const dropped = range(currentIndex + 1, targetIndex).filter((i) => tiers[i] === USER);
      const keep = range(currentIndex + 1, n).filter((i) => i !== targetIndex && !rest.includes(i) && !dropped.includes(i));
      return { isPureSeek: false, order: [...hist, targetIndex, ...rest, ...keep], target: hist.length };
    }
    // an AutoPlay row becomes the new context: a station pivot
    return { isPureSeek: false, order: [...hist, targetIndex, ...range(targetIndex + 1, n)], target: hist.length, promoteTargetToContext: true };
  }

  const needsTopUp = (queue, index, repeat, enabled) => !!enabled && !repeat && index >= 0 && queue.length - 1 - index < LOW_WATER;

  const api = { CONTEXT, USER, AUTOPLAY, MAX_QUEUED_AUTOPLAY, LOW_WATER, BACK_RESTARTS_AFTER_SEC, entry, tierOf, normalisedTitle, artistSet, isSameRecording, extend, buildContextQueue, buildOneOffQueue, userInsertionIndex, computeJumpOrder, needsTopUp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaaneQueue = api;
})(typeof window !== 'undefined' ? window : globalThis);
