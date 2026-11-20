import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BONE_NAMES, CHANNELS, POSE_STRIDE,
  createPoseBuffer, compileClip, compileLibrary, sampleClipPose,
  blendPoseInto, sampleKeys,
} from './pose.js';
import { PLAYER_CLIP_DEFS, LOCOMOTION_CLIPS } from './playerClips.js';

test('the skeleton and channel layout stay stable', () => {
  assert.equal(BONE_NAMES.length, 19);
  assert.equal(CHANNELS.length, 6);
  assert.equal(POSE_STRIDE, 114);
  assert.equal(new Set(BONE_NAMES).size, BONE_NAMES.length);
});

test('linear key sampling clamps flat outside the ends', () => {
  const keys = [[0, 0], [1, 10], [2, 0]];
  assert.equal(sampleKeys(keys, -3), 0);
  assert.equal(sampleKeys(keys, 0), 0);
  assert.equal(sampleKeys(keys, 0.5), 5);
  assert.equal(sampleKeys(keys, 1.5), 5);
  assert.equal(sampleKeys(keys, 9), 0);
});

test('a loop bakes a whole number of frames and wraps without a duplicate pose', () => {
  const clip = compileClip({
    name: 'ping', duration: 1, loop: true,
    tracks: [{ bone: 'Hips', channel: 'ty', keys: [[0, 0], [0.5, 1], [1, 0]] }],
  });
  assert.equal(clip.frameCount, 30);
  assert.equal(clip.duration, 1);
  const out = createPoseBuffer();
  sampleClipPose(clip, 0, out);
  assert.ok(Math.abs(out[4] - 0) < 1e-6);
  sampleClipPose(clip, 0.5, out);
  assert.ok(Math.abs(out[4] - 1) < 1e-6);
  // Wrapped past the end equals the start.
  sampleClipPose(clip, 1, out);
  assert.ok(Math.abs(out[4] - 0) < 1e-6);
  sampleClipPose(clip, 1.5, out);
  assert.ok(Math.abs(out[4] - 1) < 1e-6);
  // Negative time wraps instead of clamping.
  sampleClipPose(clip, -0.5, out);
  assert.ok(Math.abs(out[4] - 1) < 1e-6);
});

test('one-shots clamp and hold their final pose at the end', () => {
  const clip = compileClip({
    name: 'once', duration: 0.5, loop: false,
    tracks: [{ bone: 'Head', channel: 'rz', keys: [[0, 0], [0.5, 2]] }],
  });
  const out = createPoseBuffer();
  sampleClipPose(clip, 99, out);
  const head = BONE_NAMES.indexOf('Head') * 6 + 2;
  assert.ok(Math.abs(out[head] - 2) < 1e-6);
  sampleClipPose(clip, -5, out);
  assert.equal(out[head], 0);
});

test('bake rejects unknown bones and duplicate tracks', () => {
  assert.throws(() => compileClip({
    name: 'bad', duration: 1,
    tracks: [{ bone: 'Tail', channel: 'rz', keys: [[0, 0]] }],
  }), /unknown bone/);
  assert.throws(() => compileClip({
    name: 'dupe', duration: 1,
    tracks: [
      { bone: 'Hips', channel: 'rz', keys: [[0, 0]] },
      { bone: 'Hips', channel: 'rz', keys: [[0, 1]] },
    ],
  }), /duplicate track/);
});

test('blending is clamped and exact at both ends', () => {
  const a = createPoseBuffer().fill(2);
  const b = createPoseBuffer().fill(6);
  const out = createPoseBuffer();
  blendPoseInto(a, b, 0, out);
  assert.equal(out[0], 2);
  blendPoseInto(a, b, 1, out);
  assert.equal(out[0], 6);
  blendPoseInto(a, b, 2, out);
  assert.equal(out[0], 6);
  blendPoseInto(a, b, 0.5, out);
  assert.equal(out[0], 4);
});

test('every authored clip compiles, including the four gaits and keeper set', () => {
  const lib = compileLibrary(PLAYER_CLIP_DEFS);
  for (const name of LOCOMOTION_CLIPS) assert.ok(lib.has(name), `missing ${name}`);
  for (const name of [
    'kick', 'header', 'tackle', 'fall', 'getup',
    'celebrate_a', 'celebrate_b', 'celebrate_c',
    'gk_idle', 'gk_dive_l', 'gk_dive_r',
  ]) {
    assert.ok(lib.has(name), `missing ${name}`);
  }
  for (const name of lib.names()) {
    const clip = lib.get(name);
    assert.ok(clip.duration > 0.3, `${name} is long enough to read`);
    assert.ok(clip.frames.length === clip.frameCount * POSE_STRIDE);
    for (const value of clip.frames) assert.ok(Number.isFinite(value), `${name} stayed finite`);
  }
});

test('locomotion clips swing limbs and a kick peaks harder than a jog', () => {
  const lib = compileLibrary(PLAYER_CLIP_DEFS);
  const out = createPoseBuffer();
  const thighR = BONE_NAMES.indexOf('ThighR') * 6 + 2;
  let walkMin = Infinity;
  let walkMax = -Infinity;
  for (let t = 0; t <= 1.05; t += 0.01) {
    sampleClipPose(lib.get('walk'), t, out);
    walkMin = Math.min(walkMin, out[thighR]);
    walkMax = Math.max(walkMax, out[thighR]);
  }
  assert.ok(walkMax > 0.25, 'walk swings the thigh forward');
  assert.ok(walkMin < -0.25, 'walk swings the thigh back');

  sampleClipPose(lib.get('kick'), 0.42, out);
  const kickStrike = out[thighR];
  assert.ok(kickStrike > 0.9, 'the kick strike clears a jog stride');
});

test('loop clips wrap seamlessly instead of snapping at a duplicate pose', () => {
  const lib = compileLibrary(PLAYER_CLIP_DEFS);
  const a = createPoseBuffer();
  const b = createPoseBuffer();
  for (const name of ['idle', 'walk', 'jog', 'run', 'sprint', 'gk_idle',
    'celebrate_a', 'celebrate_b', 'celebrate_c']) {
    const clip = lib.get(name);
    sampleClipPose(clip, 0, a);
    sampleClipPose(clip, clip.duration, b);
    for (let i = 0; i < POSE_STRIDE; i++) {
      assert.ok(Math.abs(a[i] - b[i]) < 1e-4,
        `${name} wraps exactly at its duration on channel ${i}`);
    }
    // A negative seek lands on the same wrapped pose.
    sampleClipPose(clip, -clip.duration, b);
    for (let i = 0; i < POSE_STRIDE; i++) {
      assert.ok(Math.abs(a[i] - b[i]) < 1e-4, `${name} wraps backwards on channel ${i}`);
    }
  }
});
