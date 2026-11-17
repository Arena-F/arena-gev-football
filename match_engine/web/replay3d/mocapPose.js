// Quaternion pose sampling for the Mixamo-baked clips.
//
// The procedural clips in pose.js are additive Euler offsets: cheap to author,
// but they cannot represent a mocap pose without gimbal artefacts. Baked mocap
// is stored as absolute local quaternions plus one hips translation, sampled
// with slerp. Playback is still a pure function of absolute clip time, so
// scrubbing and pausing land on exactly the same pose as forward playback.
//
// Layout per frame:
//   [ qx, qy, qz, qw ] × BONE_COUNT, then [ tx, ty, tz ] for the hips.
// The hips translation is a delta from the rig rest position, in metres, for a
// 1.0-height rig; rig.js scales it by the player's height.

import { BONE_COUNT, BONE_NAMES, CHANNELS, POSE_STRIDE } from './pose.js';

export const MOCAP_STRIDE = BONE_COUNT * 4 + 3;
export const HIP_OFFSET = BONE_COUNT * 4;

export function createMocapPose() {
  return new Float32Array(MOCAP_STRIDE);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function localTime(clip, t) {
  if (clip.loop) return ((t % clip.duration) + clip.duration) % clip.duration;
  return clamp(t, 0, clip.duration);
}

/** Slerp one quaternion in flat buffers. `flip` keeps the shortest arc. */
function slerpFlat(a, ao, b, bo, w, out, oo) {
  let ax = a[ao];
  let ay = a[ao + 1];
  let az = a[ao + 2];
  let aw = a[ao + 3];
  let bx = b[bo];
  let by = b[bo + 1];
  let bz = b[bo + 2];
  let bw = b[bo + 3];
  let dot = ax * bx + ay * by + az * bz + aw * bw;

  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }

  let s0;
  let s1;
  if (dot > 0.9995) {
    s0 = 1 - w;
    s1 = w;
  } else {
    const theta = Math.acos(clamp(dot, -1, 1));
    const sin = Math.sin(theta);
    s0 = Math.sin((1 - w) * theta) / sin;
    s1 = Math.sin(w * theta) / sin;
  }

  let x = ax * s0 + bx * s1;
  let y = ay * s0 + by * s1;
  let z = az * s0 + bz * s1;
  let qw = aw * s0 + bw * s1;
  const len = Math.hypot(x, y, z, qw) || 1;
  out[oo] = x / len;
  out[oo + 1] = y / len;
  out[oo + 2] = z / len;
  out[oo + 3] = qw / len;
}

/**
 * Sample a baked mocap clip at local time `t` into `out`.
 * Loops wrap, one-shots clamp. All quaternions are absolute local rotations.
 */
export function sampleMocapPose(clip, t, out) {
  if (!clip || !out) return out;
  const local = localTime(clip, t);
  const f = local * clip.fps;
  let i0 = Math.floor(f);
  if (i0 < 0) i0 = 0;
  if (i0 >= clip.frameCount) i0 = clip.frameCount - 1;
  let i1 = i0 + 1;
  if (i1 >= clip.frameCount) i1 = clip.loop ? 0 : clip.frameCount - 1;
  const frac = clamp(f - i0, 0, 1);
  const qa = i0 * BONE_COUNT * 4;
  const qb = i1 * BONE_COUNT * 4;

  for (let bone = 0; bone < BONE_COUNT; bone++) {
    const o = bone * 4;
    slerpFlat(clip.quats, qa + o, clip.quats, qb + o, frac, out, o);
  }

  const ha = i0 * 3;
  const hb = i1 * 3;
  for (let i = 0; i < 3; i++) {
    const av = clip.hips[ha + i];
    out[HIP_OFFSET + i] = av + (clip.hips[hb + i] - av) * frac;
  }
  return out;
}

/** out = slerp(a, b, w) per bone, lerp the hips. */
export function blendMocapPose(a, b, w, out) {
  const t = clamp(w, 0, 1);
  for (let bone = 0; bone < BONE_COUNT; bone++) {
    const o = bone * 4;
    slerpFlat(a, o, b, o, t, out, o);
  }
  for (let i = 0; i < 3; i++) {
    out[HIP_OFFSET + i] = a[HIP_OFFSET + i] + (b[HIP_OFFSET + i] - a[HIP_OFFSET + i]) * t;
  }
  return out;
}

export function copyMocapPose(src, out) {
  out.set(src);
  return out;
}

/** Euler XYZ -> quaternion, matching three.js `Euler(...,'XYZ')`. */
function eulerToQuat(x, y, z, out, o) {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  out[o] = s1 * c2 * c3 + c1 * s2 * s3;
  out[o + 1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[o + 2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[o + 3] = c1 * c2 * c3 - s1 * s2 * s3;
}

/**
 * Bridge a procedural additive pose into the mocap layout. Used for the
 * celebration fallback and for clips that have no mocap source, so a
 * procedural one-shot can still slerp over a mocap locomotion base.
 */
export function eulerPoseToMocap(pose, restRot, out) {
  const hip = BONE_NAMES.indexOf('Hips');
  for (let bone = 0; bone < BONE_COUNT; bone++) {
    const p = bone * CHANNELS.length;
    const r = bone * 3;
    eulerToQuat(
      restRot[r] + pose[p],
      restRot[r + 1] + pose[p + 1],
      restRot[r + 2] + pose[p + 2],
      out,
      bone * 4,
    );
  }
  out[HIP_OFFSET] = pose[hip * CHANNELS.length + 3];
  out[HIP_OFFSET + 1] = pose[hip * CHANNELS.length + 4];
  out[HIP_OFFSET + 2] = pose[hip * CHANNELS.length + 5];
  return out;
}

/** True when every quaternion is finite and unit length. */
export function validateMocapPose(pose, tolerance = 1e-4) {
  for (let bone = 0; bone < BONE_COUNT; bone++) {
    const o = bone * 4;
    const x = pose[o];
    const y = pose[o + 1];
    const z = pose[o + 2];
    const w = pose[o + 3];
    if (![x, y, z, w].every(Number.isFinite)) return `${BONE_NAMES[bone]} is not finite`;
    const len = Math.hypot(x, y, z, w);
    if (Math.abs(len - 1) > tolerance) return `${BONE_NAMES[bone]} length ${len}`;
  }
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(pose[HIP_OFFSET + i])) return 'hips translation is not finite';
  }
  return null;
}

export { POSE_STRIDE };
