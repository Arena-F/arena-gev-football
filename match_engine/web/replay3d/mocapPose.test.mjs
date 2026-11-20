import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOCAP_CLIPS, MOCAP_CLIP_META, mocapClip,
} from './mixamoClips.js';
import { MOCAP_TIMING, MOCAP_GAIT_SPEED } from './mixamoTiming.js';
import {
  MOCAP_STRIDE, HIP_OFFSET, createMocapPose, sampleMocapPose,
  blendMocapPose, copyMocapPose, eulerPoseToMocap, validateMocapPose,
} from './mocapPose.js';
import { BONE_NAMES, POSE_STRIDE } from './pose.js';
import { BONE_TREE } from './rig.js';
import { ACTION_DURATION } from './playerActions.js';

const REQUIRED = [
  'idle', 'walk', 'jog', 'run', 'sprint', 'gk_idle',
  'pass', 'kick', 'header', 'tackle', 'fall', 'getup',
  'receive', 'throw_in', 'volley',
  'gk_dive_l', 'gk_dive_r', 'gk_catch', 'gk_block', 'gk_scoop',
];

function assertUnit(q, label) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  assert.ok(Math.abs(len - 1) < 1e-4, `${label} quaternion length ${len}`);
}

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function footHeight(pose) {
  const world = {};
  const worldQ = {};
  for (const name of BONE_NAMES) {
    const spec = BONE_TREE[name];
    const parent = spec.parent;
    const pq = parent ? worldQ[parent] : [0, 0, 0, 1];
    const pp = parent ? world[parent] : [0, 0, 0];
    const o = BONE_NAMES.indexOf(name) * 4;
    const lq = [pose[o], pose[o + 1], pose[o + 2], pose[o + 3]];
    worldQ[name] = quatMul(pq, lq);
    const lp = [
      spec.pos[0] + (name === 'Hips' ? pose[HIP_OFFSET] : 0),
      spec.pos[1] + (name === 'Hips' ? pose[HIP_OFFSET + 1] : 0),
      spec.pos[2] + (name === 'Hips' ? pose[HIP_OFFSET + 2] : 0),
    ];
    const r = rotate(pq, lp);
    world[name] = [pp[0] + r[0], pp[1] + r[1], pp[2] + r[2]];
  }
  return Math.min(world.FootR[1], world.FootL[1]);
}

test('the baked Mixamo set covers every replay action', () => {
  for (const name of REQUIRED) {
    assert.ok(MOCAP_CLIPS[name], `missing mocap clip ${name}`);
    assert.ok(MOCAP_CLIP_META[name], `missing mocap metadata ${name}`);
    assert.ok(MOCAP_TIMING[name], `missing timing ${name}`);
  }
  for (const name of Object.keys(MOCAP_CLIPS)) {
    assert.ok(MOCAP_TIMING[name], `timing missing for ${name}`);
  }
  assert.equal(MOCAP_STRIDE, BONE_NAMES.length * 4 + 3);
  assert.equal(POSE_STRIDE, 114);
});

test('every baked clip has finite, unit quaternions and valid buffers', () => {
  for (const name of REQUIRED) {
    const clip = MOCAP_CLIPS[name];
    assert.ok(clip.duration > 0.2, `${name} duration`);
    assert.ok(clip.frameCount >= 2, `${name} frame count`);
    assert.equal(clip.quats.length, clip.frameCount * BONE_NAMES.length * 4, `${name} quats`);
    assert.equal(clip.hips.length, clip.frameCount * 3, `${name} hips`);
    for (let i = 0; i < clip.frameCount; i++) {
      for (let b = 0; b < BONE_NAMES.length; b++) {
        const o = (i * BONE_NAMES.length + b) * 4;
        assertUnit([clip.quats[o], clip.quats[o + 1], clip.quats[o + 2], clip.quats[o + 3]], `${name} f${i} ${BONE_NAMES[b]}`);
      }
      for (let k = 0; k < 3; k++) {
        assert.ok(Number.isFinite(clip.hips[i * 3 + k]), `${name} hips finite`);
      }
    }
  }
});

test('sampling is exact at frame boundaries and deterministic on a seek', () => {
  const a = createMocapPose();
  const b = createMocapPose();
  for (const name of REQUIRED) {
    const clip = MOCAP_CLIPS[name];
    for (const t of [0, clip.duration * 0.25, clip.duration * 0.5, clip.duration * 0.8]) {
      sampleMocapPose(clip, t, a);
      sampleMocapPose(clip, t, b);
      assert.deepEqual(a, b, `${name} is deterministic at ${t}`);
      assert.equal(validateMocapPose(a), null, `${name} samples cleanly at ${t}`);
    }
  }
});

test('one-shots clamp and loops wrap', () => {
  const a = createMocapPose();
  const b = createMocapPose();
  for (const name of REQUIRED) {
    const clip = MOCAP_CLIPS[name];
    if (clip.loop) {
      sampleMocapPose(clip, 0, a);
      sampleMocapPose(clip, clip.duration, b);
      for (let i = 0; i < MOCAP_STRIDE; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < 1e-4, `${name} wraps at channel ${i}`);
      }
      sampleMocapPose(clip, -clip.duration, b);
      for (let i = 0; i < MOCAP_STRIDE; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < 1e-4, `${name} wraps backwards at channel ${i}`);
      }
    } else {
      sampleMocapPose(clip, clip.duration, a);
      sampleMocapPose(clip, clip.duration + 10, b);
      assert.deepEqual(a, b, `${name} clamps at the end`);
    }
  }
});

test('blending hits both endpoints exactly', () => {
  const a = createMocapPose();
  const b = createMocapPose();
  const out = createMocapPose();
  sampleMocapPose(MOCAP_CLIPS.kick, 0.1, a);
  sampleMocapPose(MOCAP_CLIPS.kick, 0.4, b);
  blendMocapPose(a, b, 0, out);
  for (let i = 0; i < MOCAP_STRIDE; i++) assert.ok(Math.abs(out[i] - a[i]) < 1e-6, `blend 0 channel ${i}`);
  blendMocapPose(a, b, 1, out);
  for (let i = 0; i < MOCAP_STRIDE; i++) assert.ok(Math.abs(out[i] - b[i]) < 1e-6, `blend 1 channel ${i}`);
  blendMocapPose(a, b, 0.5, out);
  assert.equal(validateMocapPose(out), null);
  copyMocapPose(b, out);
  assert.deepEqual(out, b);
});

test('the procedural-to-mocap bridge preserves rest rotations', () => {
  const restRot = new Float32Array(BONE_NAMES.length * 3);
  const rest = new Float32Array(POSE_STRIDE);
  const out = createMocapPose();
  eulerPoseToMocap(rest, restRot, out);
  assert.equal(validateMocapPose(out), null);
  for (let b = 0; b < BONE_NAMES.length; b++) {
    assert.deepEqual(
      [out[b * 4], out[b * 4 + 1], out[b * 4 + 2], out[b * 4 + 3]],
      [0, 0, 0, 1],
      `${BONE_NAMES[b]} rest bridge is identity`,
    );
  }
  assert.equal(out[HIP_OFFSET], 0);
  assert.equal(out[HIP_OFFSET + 1], 0);
  assert.equal(out[HIP_OFFSET + 2], 0);

  // A 90° X rotation must become the same quaternion three.js would build
  // from Euler(…, 'XYZ'), not a different order.
  const hip = BONE_NAMES.indexOf('Hips');
  rest[hip * 6] = Math.PI / 2;
  eulerPoseToMocap(rest, restRot, out);
  const s = Math.SQRT1_2;
  assert.ok(Math.abs(out[hip * 4] - s) < 1e-6);
  assert.ok(Math.abs(out[hip * 4 + 1]) < 1e-6);
  assert.ok(Math.abs(out[hip * 4 + 2]) < 1e-6);
  assert.ok(Math.abs(out[hip * 4 + 3] - s) < 1e-6);
});

test('baked feet stay on or above the ground', () => {
  const pose = createMocapPose();
  for (const name of REQUIRED) {
    const clip = MOCAP_CLIPS[name];
    for (let i = 0; i < 12; i++) {
      sampleMocapPose(clip, clip.duration * i / 11, pose);
      const h = footHeight(pose);
      assert.ok(h > -0.06, `${name} foot ${h.toFixed(3)} at sample ${i}`);
    }
  }
});

test('timings line up with the baked clips and gait speeds are ordered', () => {
  for (const [name, timing] of Object.entries(MOCAP_TIMING)) {
    const clip = MOCAP_CLIPS[name];
    assert.ok(clip, `timing has no clip ${name}`);
    assert.ok(Math.abs(clip.duration - timing.duration) < 1e-3, `${name} duration drift`);
    assert.equal(clip.loop, !!timing.loop, `${name} loop flag`);
    if (timing.contact != null) {
      assert.ok(timing.contact >= 0 && timing.contact <= timing.duration + 1e-6, `${name} contact in range`);
      assert.ok(Number.isFinite(timing.lead), `${name} lead is finite`);
    }
  }
  assert.ok(MOCAP_GAIT_SPEED.walk < MOCAP_GAIT_SPEED.jog);
  assert.ok(MOCAP_GAIT_SPEED.jog < MOCAP_GAIT_SPEED.run);
  assert.ok(MOCAP_GAIT_SPEED.run < MOCAP_GAIT_SPEED.sprint);
  assert.equal(MOCAP_GAIT_SPEED.idle, 0);
  assert.equal(ACTION_DURATION.kick, MOCAP_TIMING.kick.duration);
  assert.equal(ACTION_DURATION.header, MOCAP_TIMING.header.duration);
  assert.equal(ACTION_DURATION.celebrate_a, 1.2);
  assert.equal(mocapClip('does-not-exist'), null);
});
