// Procedural pose sampling for the 3D replay players.
//
// Replays are seeking: the viewer can scrub backwards, pause and replay, so
// animation cannot be a wall-clock mixer that only knows how to move forward.
// Every pose here is a pure function of absolute clip time. Authoring is a
// small keyframe format (bone, channel, keys), baked once to 30 Hz flat
// buffers, then linearly sampled. That is fast enough for 22 rigs and makes a
// seek land on exactly the same pose as a forward plays.
//
// Channel layout per bone: rx, ry, rz (radians), tx, ty, tz (metres). Values
// are offsets from the rig's rest pose, so an absent track means "rest".

export const CHANNELS = ['rx', 'ry', 'rz', 'tx', 'ty', 'tz'];
export const BONE_NAMES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'ShoulderR', 'UpperArmR', 'ForearmR', 'HandR',
  'ShoulderL', 'UpperArmL', 'ForearmL', 'HandL',
  'ThighR', 'ShinR', 'FootR',
  'ThighL', 'ShinL', 'FootL',
];
export const BONE_COUNT = BONE_NAMES.length;
export const POSE_STRIDE = BONE_COUNT * CHANNELS.length;
export const DEFAULT_FPS = 30;

const BONE_INDEX = new Map(BONE_NAMES.map((name, index) => [name, index]));
const CHANNEL_INDEX = new Map(CHANNELS.map((name, index) => [name, index]));

export function createPoseBuffer() {
  return new Float32Array(POSE_STRIDE);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear sample of a sorted [time, value] key list; flat outside the ends. */
export function sampleKeys(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b[0] - a[0];
  if (span <= 1e-9) return b[1];
  return a[1] + (b[1] - a[1]) * ((t - a[0]) / span);
}

/**
 * Compile one clip definition into a baked frame table.
 *
 * def = {
 *   name, duration, loop = true,
 *   tracks: [{ bone, channel, keys: [[t, value], ...] }],
 * }
 *
 * Loop clips bake exactly `round(duration * fps)` frames and wrap, so the last
 * frame flows into the first without a duplicate pose. One-shots bake both
 * endpoints and clamp.
 */
export function compileClip(def, fps = DEFAULT_FPS) {
  if (!def || !def.name) throw new Error('clip needs a name');
  if (!(def.duration > 0)) throw new Error(`clip ${def.name} needs a positive duration`);
  const loop = def.loop !== false;
  const frameCount = loop
    ? Math.max(2, Math.round(def.duration * fps))
    : Math.max(2, Math.round(def.duration * fps) + 1);
  const duration = loop ? frameCount / fps : (frameCount - 1) / fps;
  const frames = new Float32Array(frameCount * POSE_STRIDE);

  // Index tracks first so a bad bone/channel name fails at compile time, not
  // silently at playback.
  const bySlot = new Map();
  for (const track of def.tracks || []) {
    const bone = BONE_INDEX.get(track.bone);
    const channel = CHANNEL_INDEX.get(track.channel);
    if (bone === undefined) throw new Error(`clip ${def.name}: unknown bone ${track.bone}`);
    if (channel === undefined) throw new Error(`clip ${def.name}: unknown channel ${track.channel}`);
    const slot = bone * CHANNELS.length + channel;
    if (bySlot.has(slot)) throw new Error(`clip ${def.name}: duplicate track for ${track.bone}.${track.channel}`);
    const keys = (track.keys || [])
      .map(([time, value]) => [Number(time), Number(value)])
      .filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value))
      .sort((a, b) => a[0] - b[0]);
    bySlot.set(slot, keys);
  }

  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / fps;
    const base = frame * POSE_STRIDE;
    for (const [slot, keys] of bySlot) frames[base + slot] = sampleKeys(keys, t);
  }

  return { name: def.name, duration, fps, loop, frameCount, frames };
}

export function compileLibrary(defs, fps = DEFAULT_FPS) {
  const clips = new Map();
  for (const def of defs) {
    const clip = compileClip(def, fps);
    if (clips.has(clip.name)) throw new Error(`duplicate clip ${clip.name}`);
    clips.set(clip.name, clip);
  }
  return {
    get: (name) => clips.get(name) || null,
    has: (name) => clips.has(name),
    names: () => [...clips.keys()],
    get size() { return clips.size; },
  };
}

/**
 * Sample a baked clip at time `t` into `out`. Loops wrap, one-shots clamp.
 * `t` is local clip time in seconds (0 = first frame).
 */
export function sampleClipPose(clip, t, out) {
  if (!clip || !out) return out;
  const local = clip.loop
    ? ((t % clip.duration) + clip.duration) % clip.duration
    : clamp(t, 0, clip.duration);
  const f = local * clip.fps;
  let i0 = Math.floor(f);
  if (i0 < 0) i0 = 0;
  if (i0 >= clip.frameCount) i0 = clip.frameCount - 1;
  let i1 = i0 + 1;
  if (i1 >= clip.frameCount) i1 = clip.loop ? 0 : clip.frameCount - 1;
  const frac = clamp(f - i0, 0, 1);
  const a = i0 * POSE_STRIDE;
  const b = i1 * POSE_STRIDE;
  if (frac <= 0) {
    for (let i = 0; i < POSE_STRIDE; i++) out[i] = clip.frames[a + i];
    return out;
  }
  for (let i = 0; i < POSE_STRIDE; i++) {
    const av = clip.frames[a + i];
    out[i] = av + (clip.frames[b + i] - av) * frac;
  }
  return out;
}

/** out = a + (b - a) * w, per channel. */
export function blendPoseInto(a, b, w, out) {
  const t = clamp(w, 0, 1);
  for (let i = 0; i < POSE_STRIDE; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

export function copyPoseInto(src, out) {
  out.set(src);
  return out;
}

/** Zero pose = rest pose. */
export function resetPose(out) {
  out.fill(0);
  return out;
}

/**
 * Additive overlay used for locomotion bob/recoil on top of a blended action
 * pose. Tracks missing from `overlay` are ignored (the overlay carries values,
 * not a mask, so callers should only pass channels they mean to add).
 */
export function addPoseInto(base, overlay, out) {
  for (let i = 0; i < POSE_STRIDE; i++) out[i] = base[i] + overlay[i];
  return out;
}
