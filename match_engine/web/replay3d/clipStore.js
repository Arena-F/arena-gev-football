// 3D replay clip store — DOM-free.
//
// The live engine already produces a 6-float snapshot per entity every frame
// (23 × 6 f32). We keep a low-rate ring of those snapshots so a highlight can
// be replayed in 3D without ever seeking or re-simulating the engine. An event
// opens a window (15 s before, 15 s after by default); nearby events grow the
// same window so a corner-then-goal sequence stays one clip, and the headline
// stays on the more valuable moment.

export const STRIDE = 6;

// Higher wins the clip headline when two events land in the same window.
const TYPE_PRIORITY = {
  16: 100, // goal
  17: 100, // own goal / penalty outcome
  14: 78, // woodwork
  15: 74, // attempt saved
  13: 70, // shot
  10: 64, // save
  4: 56, // corner
  5: 52, // free kick / throw-in family
  2: 50, // offside
  55: 48,
  7: 46, // tackle
  8: 46, // interception
};

export function eventPriority(ev) {
  if (!ev) return 0;
  let priority = TYPE_PRIORITY[ev.type] ?? 10;
  if (ev.notable) priority = Math.max(priority, 60);
  return priority;
}

function snapshot(simTime, players, ball) {
  const count = players.length + 1;
  const data = new Float32Array(count * STRIDE);
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const o = i * STRIDE;
    data[o] = p.x;
    data[o + 1] = p.y;
    data[o + 2] = p.z || 0;
    data[o + 3] = p.heading || 0;
    data[o + 4] = p.team;
    data[o + 5] = p.shirt;
  }
  const o = players.length * STRIDE;
  data[o] = ball ? ball.x : 0;
  data[o + 1] = ball ? ball.y : 0;
  data[o + 2] = ball ? ball.z || 0 : 0;
  data[o + 3] = 0;
  data[o + 4] = 2; // ball team marker
  data[o + 5] = 0;
  return { t: simTime, count, data };
}

/** Shortest-angle interpolation; headings are engine radians, not quaternions. */
export function lerpAngle(a, b, u) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * u;
}

export function createClipRecorder({
  fps = 10,
  preSecs = 15,
  postSecs = 15,
  maxClips = 3,
  maxClipSecs = preSecs + postSecs + 15,
} = {}) {
  const sampleDt = 1 / fps;
  const historySecs = Math.max(60, preSecs + postSecs + 10);
  const maxHistoryFrames = Math.ceil(historySecs * fps) + 2;

  let history = [];
  let clips = [];
  let readyQueue = [];
  let pending = null;
  let nextId = 1;
  let lastSimT = -Infinity;
  let lastSampleT = -Infinity;

  function framesInWindow(startT, endT) {
    const out = [];
    for (const frame of history) {
      if (frame.t >= startT - 1e-6 && frame.t <= endT + 1e-6) out.push(frame);
    }
    return out;
  }

  /** Union two frame lists, keeping one sample per timestamp, sorted by time. */
  function mergeFrames(a, b) {
    if (!b.length) return a;
    if (!a.length) return b;
    const byTime = new Map();
    for (const frame of a) byTime.set(frame.t, frame);
    for (const frame of b) byTime.set(frame.t, frame);
    return [...byTime.values()].sort((x, y) => x.t - y.t);
  }

  function reset({ clearClips = false } = {}) {
    history = [];
    readyQueue = [];
    pending = null;
    lastSimT = -Infinity;
    lastSampleT = -Infinity;
    if (clearClips) {
      clips = [];
      nextId = 1;
    }
  }

  function observe(simTime, players, ball) {
    if (!Number.isFinite(simTime) || !players) return;
    if (simTime + 1e-6 < lastSimT) {
      // A backwards jump means the history belongs to another timeline. Drop
      // it, and drop a pending window rather than splicing two matches.
      history = [];
      pending = null;
      lastSampleT = -Infinity;
    }
    lastSimT = simTime;
    if (simTime - lastSampleT < sampleDt - 1e-6) return;
    lastSampleT = simTime;

    const frame = snapshot(simTime, players, ball);
    history.push(frame);
    if (history.length > maxHistoryFrames) {
      const cutoff = simTime - historySecs;
      while (history.length && history[0].t < cutoff) history.shift();
      if (history.length > maxHistoryFrames) history = history.slice(-maxHistoryFrames);
    }
    if (pending && simTime >= pending.startT - 1e-6 && simTime <= pending.endT + 1e-6) {
      // Keep one sample per timestamp; observe() already rate-limits, this is
      // belt and braces for floating point.
      if (pending.frames.length === 0 || simTime > pending.frames[pending.frames.length - 1].t + 1e-6) {
        pending.frames.push(frame);
      }
    }
  }

  function notifyEvent(ev) {
    if (!ev || !Number.isFinite(ev.t)) return null;
    const t = ev.t;
    const priority = eventPriority(ev);
    const newStart = Math.max(0, t - preSecs);
    const newEnd = t + postSecs;

    if (pending) {
      const gap = t - pending.event.t;
      if (gap >= 0 && gap <= preSecs) {
        // Same phase of play: one clip, wider window, best headline.
        pending.startT = Math.min(pending.startT, newStart);
        pending.endT = Math.min(
          pending.startT + maxClipSecs,
          Math.max(pending.endT, newEnd),
        );
        if (priority >= pending.priority) {
          pending.event = { ...ev };
          pending.priority = priority;
        }
        pending.meta = { ...pending.meta, ...(ev.meta || {}) };
        if (!pending.frames.length) {
          pending.frames = framesInWindow(pending.startT, t);
        } else {
          // A seek can announce an event whose post-roll is already in the
          // ring; fold it in so the clip is not missing its second half.
          const tail = framesInWindow(pending.startT, Math.min(pending.endT, lastSimT));
          pending.frames = mergeFrames(pending.frames, tail);
        }
        return pending.id;
      }

      // Far enough apart to be its own highlight: close the old window at the
      // new event so the earlier replay is not lost.
      finalizePending(t);
    }

    pending = {
      id: nextId++,
      event: { ...ev },
      priority,
      startT: newStart,
      endT: newEnd,
      // Usually lastSimT ≈ event time, but a seek can hand us an event whose
      // whole window is already in the ring. Capture every frame we have.
      frames: framesInWindow(newStart, Math.min(newEnd, Math.max(t, lastSimT))),
      meta: ev.meta ? { ...ev.meta } : {},
    };
    return pending.id;
  }

  function finalizePending(hardEnd = null) {
    if (!pending) return null;
    const p = pending;
    pending = null;
    if (!p.frames.length) return null;

    const lastFrameT = p.frames[p.frames.length - 1].t;
    const endT = hardEnd == null
      ? p.endT
      : Math.min(p.endT, hardEnd, lastFrameT);
    const frames = p.frames.filter(
      (frame) => frame.t >= p.startT - 1e-6 && frame.t <= endT + 1e-6,
    );
    if (!frames.length) return null;

    const clip = {
      id: p.id,
      event: p.event,
      priority: p.priority,
      startT: p.startT,
      endT,
      frames,
      partial: hardEnd != null && endT < p.endT - 1e-6,
      meta: p.meta,
    };
    clips.push(clip);
    readyQueue.push(clip);
    while (clips.length > maxClips) clips.shift();
    return clip;
  }

  function collect(now = lastSimT) {
    if (pending && Number.isFinite(now) && now >= pending.endT - 1e-6) {
      finalizePending(null);
    }
    if (!readyQueue.length) return [];
    const out = readyQueue;
    readyQueue = [];
    return out;
  }

  /**
   * Close a pending window early (pause, full time, stalled tab). The clip is
   * delivered as `partial` and simply ends at the last recorded frame.
   */
  function flush() {
    if (!pending) return [];
    const last = pending.frames.length
      ? pending.frames[pending.frames.length - 1].t
      : lastSimT;
    finalizePending(last);
    if (!readyQueue.length) return [];
    const out = readyQueue;
    readyQueue = [];
    return out;
  }

  function getPending() {
    if (!pending) return null;
    return {
      id: pending.id,
      event: pending.event,
      meta: pending.meta,
      startT: pending.startT,
      endT: pending.endT,
      recordedTo: lastSimT,
      remaining: Math.max(0, pending.endT - lastSimT),
    };
  }

  return {
    observe,
    notifyEvent,
    collect,
    flush,
    reset,
    getPending,
    getClips: () => clips.slice(),
    getClip: (id) => clips.find((clip) => clip.id === id) || null,
    get length() { return clips.length; },
  };
}

/**
 * Sample a clip at an absolute match time, writing into `out`.
 * Returns the out buffer, or null when the clip has no frames.
 * `out` must hold `count * STRIDE` floats; allocate once per viewer and reuse.
 */
export function sampleClipInto(clip, tAbs, out = null) {
  const frames = clip && clip.frames;
  if (!frames || !frames.length) return null;
  const t = Math.max(frames[0].t, Math.min(frames[frames.length - 1].t, tAbs));

  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo];
  const b = lo + 1 < frames.length ? frames[lo + 1] : a;
  const span = b.t - a.t;
  const u = span > 1e-6 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 0;
  const count = a.count;
  const length = count * STRIDE;
  if (!out || out.length < length) out = new Float32Array(length);

  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    out[o] = a.data[o] + (b.data[o] - a.data[o]) * u;
    out[o + 1] = a.data[o + 1] + (b.data[o + 1] - a.data[o + 1]) * u;
    out[o + 2] = a.data[o + 2] + (b.data[o + 2] - a.data[o + 2]) * u;
    out[o + 3] = lerpAngle(a.data[o + 3], b.data[o + 3], u);
    out[o + 4] = a.data[o + 4];
    out[o + 5] = a.data[o + 5];
  }
  return out;
}

/** Convenience wrapper for tests / one-off callers; allocates a buffer. */
export function sampleClip(clip, tAbs) {
  const buf = sampleClipInto(clip, tAbs, null);
  if (!buf) return null;
  return { t: tAbs, count: buf.length / STRIDE, data: buf };
}
