// Offline Mixamo -> 3D replay baker.
//
// Mixamo has no public download API, so the FBX files are a local, gitignored
// build input. This script retargets them onto the replay rig once and writes
// the compact, seek-safe clip data that ships with the app. The FBX files
// themselves must never be committed (Adobe forbids redistributing the raw
// character/animation files); the baked motion is part of the game.
//
// Usage:
//   npm install
//   npm run bake -- --source "C:/Users/me/Downloads/Soccer Game Pack"
//
// `--source` is optional when the FBX files are in ./source. Set MIXAMO_SOURCE
// to override the default from the environment. Re-run after changing the clip
// config, trims, warps, or the rig rest pose.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import { BONE_NAMES } from '../../web/replay3d/pose.js';
import { BONE_TREE, REST_ROTATION } from '../../web/replay3d/rig.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../../web/replay3d');
const DEFAULT_SOURCE = process.env.MIXAMO_SOURCE || path.resolve(HERE, 'source');
const FPS = 30;

// ── Base clip set (frozen) ────────────────────────────────────────────────
// These 20 clips ship with the app and are byte-frozen: `--append` reuses the
// previously baked data for them so a re-bake can never change existing
// behaviour. Only EXTRA_CLIPS below are baked from the current source pack.
const BASE_CLIPS = [
  // contact: source-time of the key event in the clip (seconds from the file
  //          start). For a kick that is the boot strike; for a header it is the
  //          jump apex; for a dive it is full extension.
  // lead:    how long before the game event the clip should start. Usually equal
  //          to the local contact, but a dive starts just before a shot while its
  //          catch is later, and a throw-in starts after the ball goes out.
  //
  // warp:    reuse the jog cycle for walk/run/sprint. `duration` is the output
  //          cycle length, `amp` scales limb swing around the rest pose, `lean`
  //          adds a forward torso pitch, `hipY` scales the vertical bob.
  { name: 'idle', file: 'offensive idle.fbx', loop: true },
  {
    name: 'walk', file: 'jog forward.fbx', loop: true,
    warp: { duration: 1.22, amp: 0.58, lean: 0, hipY: 0.92 },
  },
  { name: 'jog', file: 'jog forward.fbx', loop: true },
  {
    name: 'run', file: 'jog forward.fbx', loop: true,
    warp: { duration: 0.58, amp: 1.14, lean: 6, hipY: 1.06 },
  },
  {
    name: 'sprint', file: 'jog forward.fbx', loop: true,
    warp: { duration: 0.47, amp: 1.32, lean: 13, hipY: 1.12 },
  },
  { name: 'gk_idle', file: 'goalkeeper idle.fbx', loop: true },

  // Outfield actions. The two kick files are a side-foot pass and a full
  // instep strike, which gives the replay two distinct ball-striking shapes.
  { name: 'pass', file: 'kick soccerball (2).fbx', loop: false, contact: 0.27, lead: 0.27 },
  { name: 'kick', file: 'kick soccerball.fbx', loop: false, contact: 0.31, lead: 0.31 },
  {
    name: 'header', file: 'header soccerball.fbx', start: 0.45, end: 1.35,
    loop: false, contact: 0.93, lead: 0.48, warpArms: 0.6,
  },
  {
    name: 'tackle', file: 'soccer tackle.fbx', start: 0.25, end: 2.55,
    loop: false, contact: 0.9, lead: 0.65,
  },
  {
    name: 'fall', file: 'goalkeeper body block.fbx', start: 0.35, end: 1.55,
    loop: false, contact: 0.8, lead: 0.0, lateralScale: 0.45,
  },
  { name: 'getup', file: 'standing up.fbx', loop: false, contact: 0.0, lead: 0.0 },
  {
    name: 'receive', file: 'receive soccerball.fbx', start: 0, end: 1.35,
    loop: false, contact: 0.33, lead: 0.33,
  },
  {
    name: 'throw_in', file: 'throw in.fbx', start: 0.65, end: 1.85,
    loop: false, contact: 1.2, lead: -0.35,
  },
  {
    name: 'volley', file: 'kick up soccerball.fbx', start: 0.35, end: 1.15,
    loop: false, contact: 0.78, lead: 0.43,
  },

  // Keepers. The two Mixamo dive files are opposite directions, so we do not
  // need to mirror a pose. Lateral hip travel is scaled down: the engine moves
  // the keeper, and a 3 m local slide would snap when the action ends.
  {
    name: 'gk_dive_r', file: 'goalkeeper diving save.fbx', start: 0.12, end: 1.78,
    loop: false, contact: 1.3, lead: 0.30, lateralScale: 0.38,
  },
  {
    name: 'gk_dive_l', file: 'goalkeeper diving save (2).fbx', start: 0.12, end: 1.78,
    loop: false, contact: 1.3, lead: 0.30, lateralScale: 0.30,
  },
  {
    name: 'gk_catch', file: 'goalkeeper catch (2).fbx', loop: false,
    contact: 0.4, lead: 0.4,
  },
  {
    name: 'gk_block', file: 'goalkeeper body block.fbx', start: 0.35, end: 1.55,
    loop: false, contact: 0.8, lead: 0.45, lateralScale: 0.55,
  },
  {
    name: 'gk_scoop', file: 'goalkeeper scoop.fbx', start: 0.35, end: 1.35,
    loop: false, contact: 0.8, lead: 0.45, lateralScale: 0.5,
  },
];

// ── Extra clips from the extended Soccer Game Pack ─────────────────────────
// Same-name numbered files (e.g. `Soccer Tackle`, `(1)`, `(2)`) are baked as
// separate variants and shuffled deterministically at runtime. Contact points
// mirror the fraction used by the analogous base clip (strikes ~55%,
// receives/catches ~40%, headers ~53%, tackles ~28%).
const EXTRA_CLIPS = [
  // Idle variants (loop).
  { name: 'idle_b', file: 'Soccer Idle.fbx', loop: true },
  { name: 'gk_idle_b', file: 'goalkeeper idle (2).fbx', loop: true },
  { name: 'gk_shuffle', file: 'goalkeeper sidestep.fbx', loop: true },
  // Directional locomotion (loop). Used when the velocity direction diverges
  // from the facing direction (backpedal, side-shuffle, diagonal runs).
  { name: 'strafe_l', file: 'Jog Strafe Left.fbx', loop: true },
  { name: 'strafe_r', file: 'Jog Strafe Right.fbx', loop: true },
  { name: 'jog_back', file: 'Jog Backward.fbx', loop: true },
  { name: 'jog_back_diag', file: 'Jog Backward Diagonal.fbx', loop: true },
  { name: 'jog_back_diag_b', file: 'Jog Backward Diagonal (1).fbx', loop: true },
  { name: 'jog_diag', file: 'Jog Forward Diagonal.fbx', loop: true },
  { name: 'jog_diag_b', file: 'Jog Forward Diagonal (1).fbx', loop: true },
  { name: 'strike_run', file: 'Strike Foward Jog.fbx', loop: true },
  // Outfield action variants.
  { name: 'pass_b', file: 'Soccer Pass.fbx', loop: false, contact: 0.88, lead: 0.88 },
  { name: 'pass_chip', file: 'Chip.fbx', loop: false, contact: 0.92, lead: 0.92 },
  { name: 'receive_b', file: 'Receive.fbx', loop: false, contact: 0.56, lead: 0.56 },
  { name: 'receive_knee', file: 'kneeing soccerball (2).fbx', loop: false, contact: 0.24, lead: 0.24 },
  {
    name: 'header_b', file: 'Header.fbx',
    loop: false, contact: 0.76, lead: 0.48, warpArms: 0.6,
  },
  {
    name: 'header_c', file: 'Soccer Header.fbx',
    loop: false, contact: 1.25, lead: 0.48, warpArms: 0.6,
  },
  { name: 'tackle_b', file: 'Soccer Tackle (1).fbx', loop: false, contact: 0.77, lead: 0.65 },
  { name: 'tackle_c', file: 'Soccer Tackle (2).fbx', loop: false, contact: 0.64, lead: 0.65 },
  {
    name: 'fall_b', file: 'Soccer Trip.fbx',
    loop: false, contact: 0.6, lead: 0.0, lateralScale: 0.45,
  },
  { name: 'fallen_idle', file: 'Fallen Idle.fbx', loop: true },
  { name: 'dribble', file: 'Dribble.fbx', loop: false, contact: 0.87, lead: 0.5 },
  { name: 'stall', file: 'stall soccerball (4).fbx', loop: true },
  // Keeper variants.
  { name: 'gk_catch_b', file: 'Goalkeeper Catch.fbx', loop: false, contact: 0.5, lead: 0.5 },
  { name: 'gk_catch_c', file: 'goalkeeper catch (3).fbx', loop: false, contact: 1.07, lead: 0.4 },
  {
    name: 'gk_block_b', file: 'goalkeeper body block (2).fbx', start: 0.35, end: 1.55,
    loop: false, contact: 0.8, lead: 0.45, lateralScale: 0.55,
  },
  { name: 'gk_miss', file: 'Goalkeeper Miss.fbx', loop: false, contact: 1.7, lead: 0.3 },
  { name: 'gk_dist_pass', file: 'goalkeeper pass.fbx', loop: false, contact: 1.7, lead: 1.7 },
  { name: 'gk_dist_drop', file: 'Goalkeeper Drop Kick.fbx', loop: false, contact: 2.1, lead: 2.1 },
  { name: 'gk_dist_throw', file: 'goalkeeper overhand throw.fbx', loop: false, contact: 1.55, lead: 1.55 },
  { name: 'gk_place', file: 'Goalkeeper Placing Ball.fbx', loop: false, contact: 1.75, lead: 1.75 },
];

// Deterministic variant groups. The runtime picks entry [0] for hash < 0.62
// so default/legacy hashes keep the base clip; other hashes spread over the
// variants. Same-name files always live in the same group.
const VARIANT_GROUPS = {
  idle: ['idle', 'idle_b'],
  gk_idle: ['gk_idle', 'gk_idle_b', 'gk_shuffle'],
  run: ['run', 'strike_run'],
  jog_diag: ['jog_diag', 'jog_diag_b'],
  jog_back_diag: ['jog_back_diag', 'jog_back_diag_b'],
  pass: ['pass', 'pass_b'],
  receive: ['receive', 'receive_b', 'receive_knee', 'dribble'],
  header: ['header', 'header_b', 'header_c'],
  tackle: ['tackle', 'tackle_b', 'tackle_c'],
  fall: ['fall', 'fall_b'],
  gk_catch: ['gk_catch', 'gk_catch_b', 'gk_catch_c'],
  gk_block: ['gk_block', 'gk_block_b'],
  celebrate: ['celebrate_a', 'celebrate_b', 'celebrate_c', 'stall'],
};

// Files in the extended pack that the vendored FBXLoader cannot parse
// ("Unknown property type" in three 0.186). Each has a usable alternative in
// the same group except the scissor kick, which has no substitute.
const SKIPPED_FILES = [
  'goalkeeper sidestep (2).fbx',
  'jog backward diagonal (2).fbx',
  'jog forward diagonal (2).fbx',
  'kneeing soccerball.fbx',
  'scissor kick.fbx',
  'soccer tackle (3).fbx',
];

// Mixamo bones that drive our 19-bone rig. Source Left maps to target Right
// because a +90° yaw aligns Mixamo's +Z facing with our +X facing.
const MAP = {
  Hips: 'Hips',
  Spine: 'Spine',
  Spine2: 'Chest',
  Neck: 'Neck',
  Head: 'Head',
  LeftShoulder: 'ShoulderR',
  LeftArm: 'UpperArmR',
  LeftForeArm: 'ForearmR',
  LeftHand: 'HandR',
  RightShoulder: 'ShoulderL',
  RightArm: 'UpperArmL',
  RightForeArm: 'ForearmL',
  RightHand: 'HandL',
  LeftUpLeg: 'ThighR',
  LeftLeg: 'ShinR',
  LeftFoot: 'FootR',
  RightUpLeg: 'ThighL',
  RightLeg: 'ShinL',
  RightFoot: 'FootL',
};

// Torso/head keep the full source world orientation (twist and lean matter).
// Limbs use swing-only retargeting so Mixamo's bone roll cannot flip a boot or
// twist an arm capsule. The target bone points down -Y while Mixamo points
// down +Y, hence the negated target axis.
const FULL = new Set(['Hips', 'Spine', 'Chest', 'Neck', 'Head']);
const SWING = new Set([
  'UpperArmR', 'ForearmR', 'HandR', 'UpperArmL', 'ForearmL', 'HandL',
  'ThighR', 'ShinR', 'FootR', 'ThighL', 'ShinL', 'FootL',
]);
const LIMBS = [...SWING];
const ARMS = ['UpperArmR', 'ForearmR', 'HandR', 'UpperArmL', 'ForearmL', 'HandL'];
const SHOULDER = new Set(['ShoulderR', 'ShoulderL']);

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let source = DEFAULT_SOURCE;
  let append = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) source = args[++i];
    else if (args[i] === '--append') append = true;
  }
  return { source, append };
}

// ── Target rest ─────────────────────────────────────────────────────────────

function buildTarget() {
  const bones = {};
  const localQ = {};
  for (const name of BONE_NAMES) {
    const b = new THREE.Object3D();
    b.name = name;
    const spec = BONE_TREE[name];
    b.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    const rest = REST_ROTATION[name];
    if (rest) b.rotation.set(rest[0], rest[1], rest[2]);
    bones[name] = b;
    localQ[name] = b.quaternion.clone();
  }
  for (const name of BONE_NAMES) {
    const parent = BONE_TREE[name].parent;
    if (parent) bones[parent].add(bones[name]);
  }
  const root = new THREE.Group();
  root.add(bones.Hips);
  root.updateMatrixWorld(true);
  const worldQ = {};
  const worldP = {};
  for (const name of BONE_NAMES) {
    worldQ[name] = bones[name].getWorldQuaternion(new THREE.Quaternion());
    worldP[name] = bones[name].getWorldPosition(new THREE.Vector3());
  }
  return { bones, localQ, worldQ, worldP };
}

// ── Source loading / sampling ───────────────────────────────────────────────

const sourceCache = new Map();

function loadSource(sourceDir, file) {
  if (sourceCache.has(file)) return sourceCache.get(file);
  const full = path.join(sourceDir, file);
  if (!fs.existsSync(full)) throw new Error(`missing Mixamo file: ${full}`);
  const buf = fs.readFileSync(full);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const root = new FBXLoader().parse(ab, '');
  const clip = root.animations && root.animations[0];
  if (!clip) throw new Error(`${file} has no animation`);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const bones = {};
  root.traverse((o) => {
    if (o.isBone) bones[o.name.replace(/^mixamorig/, '')] = o;
  });
  for (const src of Object.keys(MAP)) {
    if (!bones[src]) throw new Error(`${file} is missing bone ${src}`);
  }
  // Bind pose (before the mixer is advanced) gives the true leg length.
  root.updateMatrixWorld(true);
  const restHip = bones.Hips.getWorldPosition(new THREE.Vector3());
  const restAnkle = bones.LeftFoot.getWorldPosition(new THREE.Vector3());
  const entry = { file, root, clip, mixer, action, bones, restHip, restAnkle };
  sourceCache.set(file, entry);
  return entry;
}

function sampleSource(entry, t) {
  entry.action.time = clamp(t, 0, entry.clip.duration);
  entry.mixer.update(0);
  entry.root.updateMatrixWorld(true);
  const out = {};
  for (const src of Object.keys(MAP)) {
    const bone = entry.bones[src];
    out[src] = {
      p: bone.getWorldPosition(new THREE.Vector3()),
      q: bone.getWorldQuaternion(new THREE.Quaternion()),
    };
  }
  return out;
}

// ── Retarget ────────────────────────────────────────────────────────────────

function makeRetargeter(target, anchor, legScale) {
  const correction = {};
  for (const [src, tgt] of Object.entries(MAP)) {
    if (!FULL.has(tgt)) continue;
    correction[tgt] = target.worldQ[tgt].clone().multiply(anchor[src].q.clone().invert());
  }

  function retargetFrame(s) {
    const world = {};
    for (const [src, tgt] of Object.entries(MAP)) {
      if (FULL.has(tgt)) {
        world[tgt] = correction[tgt].clone().multiply(s[src].q);
      } else if (SWING.has(tgt)) {
        const targetDir = Y_AXIS.clone().applyQuaternion(target.worldQ[tgt]).negate();
        const sourceDir = Y_AXIS.clone().applyQuaternion(s[src].q);
        const swing = new THREE.Quaternion().setFromUnitVectors(targetDir, sourceDir);
        world[tgt] = swing.multiply(target.worldQ[tgt]);
      }
    }
    // Clavicles inherit the animated chest at their rest local rotation.
    for (const tgt of SHOULDER) {
      world[tgt] = world.Chest.clone().multiply(target.localQ[tgt]);
    }

    const local = {};
    for (const tgt of BONE_NAMES) {
      const parent = BONE_TREE[tgt].parent;
      const parentQ = parent ? world[parent] : new THREE.Quaternion();
      local[tgt] = parentQ.clone().invert().multiply(world[tgt]);
    }

    const hipDelta = new THREE.Vector3(
      (s.Hips.p.x - anchor.Hips.p.x) / 100,
      (s.Hips.p.y - anchor.Hips.p.y) / 100,
      (s.Hips.p.z - anchor.Hips.p.z) / 100,
    ).multiplyScalar(legScale);

    return { local, hipDelta, source: s };
  }
  return retargetFrame;
}

function fk(target, localQ, hipDelta) {
  const pos = {};
  const q = {};
  for (const name of BONE_NAMES) {
    const spec = BONE_TREE[name];
    const parent = spec.parent;
    const pq = parent ? q[parent] : new THREE.Quaternion();
    q[name] = pq.clone().multiply(localQ[name]);
    const pp = parent ? pos[parent] : new THREE.Vector3();
    const lp = new THREE.Vector3(spec.pos[0], spec.pos[1], spec.pos[2]);
    if (name === 'Hips') lp.add(hipDelta);
    pos[name] = lp.clone().applyQuaternion(pq).add(pp);
  }
  return pos;
}

// ── Motion warping ──────────────────────────────────────────────────────────

function quatAround(axis, angle) {
  return new THREE.Quaternion().setFromAxisAngle(axis, angle);
}

/** Scale a limb's deviation from the rest pose around its bone axis. */
function warpList(local, target, amp, names) {
  if (Math.abs(amp - 1) < 1e-6) return;
  for (const name of names) {
    const rest = target.localQ[name];
    const q = local[name];
    const delta = q.clone().multiply(rest.clone().invert());
    let twist = new THREE.Quaternion(0, delta.y, 0, delta.w);
    if (twist.lengthSq() < 1e-10) twist = new THREE.Quaternion();
    else twist.normalize();
    const swing = delta.clone().multiply(twist.clone().invert());
    const scaled = new THREE.Quaternion().slerp(swing, clamp(amp, 0, 2.5));
    local[name] = scaled.multiply(twist).multiply(rest);
  }
}

function warpLimbs(local, target, amp) {
  warpList(local, target, amp, LIMBS);
}

function applyLean(local, leanDeg) {
  if (!leanDeg) return;
  const lean = quatAround(Z_AXIS, -leanDeg * Math.PI / 180);
  local.Spine = local.Spine.clone().multiply(lean);
  local.Chest = local.Chest.clone().multiply(lean.clone().multiply(quatAround(Z_AXIS, leanDeg * 0.2 * Math.PI / 180)));
}

// ── Bake ────────────────────────────────────────────────────────────────────

function b64(floatArray) {
  return Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength).toString('base64');
}

function smoothLift(lifts, loop) {
  const n = lifts.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -2; k <= 2; k++) {
      let j = i + k;
      if (loop) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      sum += lifts[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

function bakeClip(sourceDir, target, retargetFrame, anchor, cfg) {
  const entry = loadSource(sourceDir, cfg.file);
  const sourceDuration = entry.clip.duration;
  const start = clamp(cfg.start ?? 0, 0, sourceDuration);
  const end = clamp(cfg.end ?? sourceDuration, start + 1e-4, sourceDuration);
  const sourceSpan = end - start;

  const outDuration = cfg.loop
    ? (cfg.warp?.duration ?? sourceSpan)
    : sourceSpan;
  const frameCount = cfg.loop
    ? Math.max(2, Math.round(outDuration * FPS))
    : Math.max(2, Math.round(outDuration * FPS) + 1);
  const duration = cfg.loop ? frameCount / FPS : (frameCount - 1) / FPS;

  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const u = cfg.loop ? i / frameCount : i / (frameCount - 1);
    const sourceT = start + u * sourceSpan;
    const s = sampleSource(entry, sourceT);
    const frame = retargetFrame(s);
    if (cfg.warp) warpLimbs(frame.local, target, cfg.warp.amp ?? 1);
    if (cfg.warpArms != null) warpList(frame.local, target, cfg.warpArms, ARMS);
    if (cfg.warp?.lean) applyLean(frame.local, cfg.warp.lean);
    frames.push(frame);
  }

  // Remove net horizontal travel. Locomotion keeps the cyclic sway/swing;
  // one-shots stay at the engine's player position. Keeper dives keep only
  // their lateral excursion (source X, which becomes target -Z after the
  // +90° facing correction), scaled down so the rig never leaves the keeper's
  // engine position by more than about a metre.
  const first = frames[0].source.Hips.p;
  const last = frames[frames.length - 1].source.Hips.p;
  const bob = cfg.hipYScale ?? cfg.warp?.hipY ?? 1;
  const lateral = cfg.lateralScale ?? null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const u = frames.length > 1 ? i / (frames.length - 1) : 0;
    const forward = ((f.source.Hips.p.z - first.z) - (last.z - first.z) * u) / 100;
    const side = -((f.source.Hips.p.x - first.x) - (last.x - first.x) * u) / 100;
    if (cfg.loop) {
      f.hipDelta.x = forward;
      f.hipDelta.z = side;
    } else if (lateral != null) {
      f.hipDelta.x = 0;
      f.hipDelta.z = side * lateral;
    } else {
      f.hipDelta.x = 0;
      f.hipDelta.z = 0;
    }
    f.hipDelta.y *= bob;
  }

  // Keep the lowest boot at ground level. The lift is smoothed so planted-foot
  // switches do not bob the whole body.
  const lifts = frames.map((f) => {
    const pos = fk(target, f.local, f.hipDelta);
    const minFoot = Math.min(pos.FootR.y, pos.FootL.y);
    return Math.max(0, 0.012 - minFoot);
  });
  const smooth = smoothLift(lifts, cfg.loop);
  for (let i = 0; i < frames.length; i++) frames[i].hipDelta.y += smooth[i];

  const quats = new Float32Array(frameCount * BONE_NAMES.length * 4);
  const hips = new Float32Array(frameCount * 3);
  let footMin = Infinity;
  let footMax = -Infinity;
  for (let i = 0; i < frameCount; i++) {
    const f = frames[i];
    for (let b = 0; b < BONE_NAMES.length; b++) {
      const q = f.local[BONE_NAMES[b]];
      const o = (i * BONE_NAMES.length + b) * 4;
      quats[o] = q.x;
      quats[o + 1] = q.y;
      quats[o + 2] = q.z;
      quats[o + 3] = q.w;
    }
    hips[i * 3] = f.hipDelta.x;
    hips[i * 3 + 1] = f.hipDelta.y;
    hips[i * 3 + 2] = f.hipDelta.z;
    const pos = fk(target, f.local, f.hipDelta);
    footMin = Math.min(footMin, pos.FootR.y, pos.FootL.y);
    footMax = Math.max(footMax, pos.FootR.y, pos.FootL.y);
  }

  const localContact = cfg.contact == null ? null : clamp(cfg.contact, start, end) - start;
  const localLead = cfg.lead == null ? null : cfg.lead;
  return {
    name: cfg.name,
    loop: cfg.loop !== false,
    fps: FPS,
    frameCount,
    duration,
    contact: localContact,
    lead: localLead,
    quats,
    hips,
    sourceDuration,
    sourceSpan,
    footMin,
    footMax,
  };
}

// ── Emit ────────────────────────────────────────────────────────────────────

function emitClips(clips) {
  const lines = [];
  lines.push('// GENERATED by tools/bake-mixamo/bake.mjs — do not edit by hand.');
  lines.push('//');
  lines.push('// Retargeted from Adobe Mixamo soccer animations under the Mixamo terms.');
  lines.push('// Raw FBX files are a local build input and must not be redistributed.');
  lines.push('// Each clip is a quaternion pose buffer sampled at 30 Hz; playback is a');
  lines.push('// pure function of clip time, so seeking and pausing are deterministic.');
  lines.push('');
  lines.push('const CLIP_DATA = [');
  for (const clip of clips) {
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(clip.name)},`);
    lines.push(`    loop: ${clip.loop},`);
    lines.push(`    fps: ${clip.fps},`);
    lines.push(`    frameCount: ${clip.frameCount},`);
    lines.push(`    duration: ${clip.duration.toFixed(6)},`);
    lines.push(`    quats: ${JSON.stringify(b64(clip.quats))},`);
    lines.push(`    hips: ${JSON.stringify(b64(clip.hips))},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push(`export const MOCAP_BONE_COUNT = ${BONE_NAMES.length};`);
  lines.push('');
  lines.push('function decodeFloat32(base64) {');
  lines.push('  if (typeof atob === \'function\') {');
  lines.push('    const binary = atob(base64);');
  lines.push('    const bytes = new Uint8Array(binary.length);');
  lines.push('    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);');
  lines.push('    return new Float32Array(bytes.buffer);');
  lines.push('  }');
  lines.push('  const buf = Buffer.from(base64, \'base64\');');
  lines.push('  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);');
  lines.push('}');
  lines.push('');
  lines.push('export const MOCAP_CLIPS = Object.create(null);');
  lines.push('export const MOCAP_CLIP_META = Object.create(null);');
  lines.push('for (const raw of CLIP_DATA) {');
  lines.push('  const clip = {');
  lines.push('    name: raw.name, loop: raw.loop, fps: raw.fps,');
  lines.push('    frameCount: raw.frameCount, duration: raw.duration,');
  lines.push('    quats: decodeFloat32(raw.quats),');
  lines.push('    hips: decodeFloat32(raw.hips),');
  lines.push('  };');
  lines.push('  MOCAP_CLIPS[clip.name] = clip;');
  lines.push('  MOCAP_CLIP_META[clip.name] = {');
  lines.push('    name: clip.name, loop: clip.loop, duration: clip.duration,');
  lines.push('    frameCount: clip.frameCount, fps: clip.fps,');
  lines.push('  };');
  lines.push('}');
  lines.push('');
  lines.push('export function mocapClip(name) {');
  lines.push('  return MOCAP_CLIPS[name] || null;');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function emitTiming(clips) {
  const gait = {
    idle: 0,
    walk: 1.7,
    jog: 2.6,
    run: 4.0,
    sprint: 5.8,
    gk_idle: 0,
  };
  const timing = {};
  for (const clip of clips) {
    if (clip.contact == null) {
      timing[clip.name] = { duration: Number(clip.duration.toFixed(4)), loop: clip.loop };
    } else {
      timing[clip.name] = {
        duration: Number(clip.duration.toFixed(4)),
        loop: clip.loop,
        contact: Number(clip.contact.toFixed(4)),
        lead: Number(clip.lead.toFixed(4)),
      };
    }
  }
  const lines = [];
  lines.push('// GENERATED by tools/bake-mixamo/bake.mjs — do not edit by hand.');
  lines.push('//');
  lines.push('// Clip lengths and event-alignment points used by the replay state machine.');
  lines.push('// `lead` is how many seconds before the game event the clip should start;');
  lines.push('// `contact` is where the key action happens inside the clip.');
  lines.push('');
  lines.push(`export const MOCAP_TIMING = ${JSON.stringify(timing, null, 2)};`);
  lines.push('');
  lines.push(`export const MOCAP_GAIT_SPEED = ${JSON.stringify(gait, null, 2)};`);
  lines.push('');
  lines.push('// Deterministic variant groups. Entry [0] is the base clip: the');
  lines.push('// runtime keeps it for hash < 0.62 so legacy behaviour is preserved,');
  lines.push('// other hashes spread over the remaining variants.');
  lines.push(`export const MOCAP_VARIANTS = ${JSON.stringify(VARIANT_GROUPS, null, 2)};`);
  lines.push('');
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function loadPrevious() {
  // Import the currently committed outputs so `--append` can reuse the frozen
  // base clips byte-for-byte. Dynamic import with a file URL keeps this working
  // regardless of the caller's working directory.
  const clipsUrl = pathToFileURL(path.join(OUT_DIR, 'mixamoClips.js')).href;
  const timingUrl = pathToFileURL(path.join(OUT_DIR, 'mixamoTiming.js')).href;
  const clipsMod = await import(clipsUrl);
  const timingMod = await import(timingUrl);
  const prev = [];
  for (const [name, clip] of Object.entries(clipsMod.MOCAP_CLIPS)) {
    const meta = clipsMod.MOCAP_CLIP_META[name] || {};
    const timing = timingMod.MOCAP_TIMING[name] || {};
    prev.push({
      name,
      loop: meta.loop,
      fps: meta.fps || FPS,
      frameCount: meta.frameCount,
      duration: meta.duration,
      contact: Number.isFinite(timing.contact) ? timing.contact : null,
      lead: Number.isFinite(timing.lead) ? timing.lead : null,
      quats: clip.quats,
      hips: clip.hips,
      sourceDuration: meta.duration,
      sourceSpan: meta.duration,
      footMin: 0,
      footMax: 0,
    });
  }
  return { clips: prev, timing: timingMod.MOCAP_TIMING };
}

function auditClip(clip, cfg) {
  const problems = [];
  if (!(clip.frameCount >= 2)) problems.push('fewer than 2 frames');
  if (clip.loop && !(clip.duration > 0.2)) problems.push('loop shorter than 0.2s');
  if (!clip.loop && clip.duration > 4.5) problems.push(`one-shot longer than 4.5s (${clip.duration.toFixed(2)}s)`);
  if (clip.footMin < -0.05) problems.push(`foot below ground ${clip.footMin.toFixed(3)}m`);
  if (clip.footMax > 2.2) problems.push(`foot above 2.2m ${clip.footMax.toFixed(3)}m`);
  if (clip.contact != null && !(clip.contact >= 0 && clip.contact <= clip.duration + 1e-6)) {
    problems.push(`contact ${clip.contact} outside [0, ${clip.duration}]`);
  }
  return problems;
}

async function main() {
  const { source, append } = parseArgs();
  const target = buildTarget();
  const idle = loadSource(source, 'offensive idle.fbx');
  const anchor = sampleSource(idle, 0);
  const sourceLeg = idle.restHip.distanceTo(idle.restAnkle) / 100;
  const targetLeg = target.worldP.Hips.distanceTo(target.worldP.FootL);
  const legScale = targetLeg / sourceLeg;
  const retargetFrame = makeRetargeter(target, anchor, legScale);

  console.log(`source: ${source}${append ? ' (append mode)' : ''}`);
  console.log(`leg scale: ${legScale.toFixed(3)} (${sourceLeg.toFixed(2)}m -> ${targetLeg.toFixed(2)}m)`);

  let previous = { clips: [], timing: {} };
  if (append) {
    previous = await loadPrevious();
    console.log(`loaded ${previous.clips.length} previously baked clips (frozen)`);
  }

  const configs = append ? EXTRA_CLIPS : [...BASE_CLIPS, ...EXTRA_CLIPS];
  const baked = [];
  const skipped = [];
  for (const cfg of configs) {
    let clip = null;
    try {
      clip = bakeClip(source, target, retargetFrame, anchor, cfg);
    } catch (err) {
      console.warn(`  SKIP ${cfg.name.padEnd(10)} ${cfg.file} (${err.message})`);
      skipped.push(cfg.name);
      continue;
    }
    const problems = auditClip(clip, cfg);
    if (problems.length) {
      console.warn(`  WARN ${clip.name}: ${problems.join('; ')}`);
    }
    baked.push(clip);
    const seam = clip.loop ? 'loop' : 'once';
    console.log(
      `  ${clip.name.padEnd(14)} ${seam} ${clip.duration.toFixed(2)}s ` +
      `${clip.frameCount}f feet[${clip.footMin.toFixed(2)},${clip.footMax.toFixed(2)}]` +
      (clip.contact != null ? ` contact ${clip.contact.toFixed(2)}s lead ${clip.lead.toFixed(2)}s` : ''),
    );
  }

  let out = baked;
  if (append) {
    const fresh = new Set(baked.map((c) => c.name));
    const frozen = previous.clips.filter((c) => !fresh.has(c.name));
    out = [...frozen, ...baked];
    // Guard: every base clip must still be present from the frozen set.
    const missing = BASE_CLIPS.map((c) => c.name).filter((n) => !out.some((c) => c.name === n));
    if (missing.length) {
      throw new Error(`append would drop base clips: ${missing.join(', ')}`);
    }
  } else {
    // Full rebuild: base durations must match the committed timing exactly,
    // otherwise the state machine's contact/lead alignment silently shifts.
    const mismatches = [];
    for (const cfg of BASE_CLIPS) {
      const clip = baked.find((c) => c.name === cfg.name);
      const prevTiming = previous.timing[cfg.name];
      if (clip && prevTiming && Math.abs(clip.duration - prevTiming.duration) > 1e-3) {
        mismatches.push(`${cfg.name}: was ${prevTiming.duration}s, now ${clip.duration.toFixed(4)}s`);
      }
    }
    if (mismatches.length) {
      throw new Error(`base clip drift:\n  ${mismatches.join('\n  ')}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'mixamoClips.js'), emitClips(out));
  fs.writeFileSync(path.join(OUT_DIR, 'mixamoTiming.js'), emitTiming(out));
  const total = out.reduce((n, c) => n + c.quats.byteLength + c.hips.byteLength, 0);
  console.log(`wrote ${out.length} clips, ${(total / 1024).toFixed(0)} KiB of pose data${skipped.length ? `, skipped ${skipped.length} (${skipped.join(', ')})` : ''}`);
}

main();
