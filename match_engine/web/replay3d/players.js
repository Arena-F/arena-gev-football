// Mocap-driven players for the 3D replay.
//
// v3 replaces the authored gait fakes with retargeted Mixamo soccer clips
// (mixamoClips.js). The seek-safe pose system is unchanged: poses are sampled
// from absolute clip time, so a pause or scrub lands on the same frame as
// forward playback. Locomotion still comes from measured speed; one-shot
// actions are derived from the event and blended over the base.
//
// Mixamo sources are baked offline into absolute local quaternions. Limbs are
// retargeted swing-only so Mixamo's bone roll cannot flip a boot or twist an
// arm capsule; the torso keeps its full orientation. The procedural clips in
// playerClips.js remain as the celebration fallback and as a safe default if a
// mocap clip is ever missing.

import { sampleClipInto, STRIDE } from './clipStore.js';
import { createRigPool, hash01 } from './rig.js';
import {
  compileLibrary, createPoseBuffer, sampleClipPose,
} from './pose.js';
import {
  createMocapPose, sampleMocapPose, blendMocapPose, copyMocapPose,
  eulerPoseToMocap,
} from './mocapPose.js';
import { MOCAP_CLIPS } from './mixamoClips.js';
import { MOCAP_GAIT_SPEED, MOCAP_TIMING } from './mixamoTiming.js';
import { PLAYER_CLIP_DEFS, GAIT_SPEED } from './playerClips.js';
import {
  buildEventContext, actionForSlot, actionWeight, variantFor,
  locomotionLevel, locomotionName,
} from './playerActions.js';

const CLIPS = compileLibrary(PLAYER_CLIP_DEFS);
const DEFAULT_HOME = '#FFFFFF';
const DEFAULT_AWAY = '#52B4F5';

// Actions whose whole body should leave the ground. The mocap standing header
// keeps a foot planted, so the jump arc is applied at the rig root and fades
// with the action window.
const ACTION_LIFT = { header: 0.35, header_b: 0.35, header_c: 0.35 };

/** Use a baked clip only when it exists; otherwise keep the fallback. */
function bakedOr(pool, name, fallback) {
  return pool && pool[name] ? name : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createPlayerPool(count = 22) {
  const pool = createRigPool(count);
  const rigs = pool.rigs;

  let activeCount = 0;
  let currentRoles = [];
  let currentHomeColor = DEFAULT_HOME;
  let currentAwayColor = DEFAULT_AWAY;
  let clipRef = null;
  let eventCtx = null;
  let futureBuf = new Float32Array((count + 1) * STRIDE);

  const states = rigs.map((rig, index) => {
    const state = {
      rig,
      speed: 0,
      level: 0,
      locoName: 'idle',
      prevLoco: 'idle',
      blend: 1,
      prevT: null,
      facing: 0,
      heading: 0,
      phase: hash01(index, 4) * 2,
      integration: hash01(index, 5),
      isGK: false,
      team: 0,
      poseTemp: createPoseBuffer(),
      restPose: createPoseBuffer(),
      mocapA: createMocapPose(),
      mocapB: createMocapPose(),
      mocapAction: createMocapPose(),
      mocapOut: createMocapPose(),
      mocapRest: createMocapPose(),
    };
    eulerPoseToMocap(state.restPose, rig.restRot, state.mocapRest);
    return state;
  });

  function resetState(state) {
    state.speed = 0;
    state.level = 0;
    state.locoName = 'idle';
    state.prevLoco = 'idle';
    state.blend = 1;
    state.prevT = null;
    state.facing = 0;
    state.heading = 0;
  }

  function applyClip(clip) {
    clipRef = clip;
    eventCtx = null;
    if (!clip || !clip.frames.length) {
      clear();
      return;
    }
    const first = clip.frames[0];
    const playerCount = Math.min(first.count - 1, rigs.length);
    const meta = clip.meta || {};
    const roles = Array.isArray(meta.roles) ? meta.roles : [];
    currentRoles = roles;
    currentHomeColor = meta.homeColor || DEFAULT_HOME;
    currentAwayColor = meta.awayColor || DEFAULT_AWAY;
    futureBuf = new Float32Array(Math.max(first.count, 1) * STRIDE);

    for (let i = 0; i < rigs.length; i++) {
      const rig = rigs[i];
      const state = states[i];
      rig.group.visible = i < playerCount;
      resetState(state);
      if (i >= playerCount) continue;
      const o = i * STRIDE;
      const team = first.data[o + 4];
      const shirt = first.data[o + 5];
      const isGK = roles[i] === 1;
      state.isGK = isGK;
      state.team = team;
      rig.setAppearance(team, shirt, isGK, currentHomeColor, currentAwayColor);
    }
    activeCount = playerCount;
    eventCtx = buildEventContext(clip, roles);
  }

  /**
   * Sample a named clip into the mocap layout. Mocap clips are already in the
   * target format; authored procedural clips (celebrations) are converted from
   * additive Euler offsets so they can slerp over a mocap locomotion base.
   */
  function sampleNamed(state, name, t, out) {
    const mocap = MOCAP_CLIPS[name];
    if (mocap) {
      sampleMocapPose(mocap, t, out);
      return true;
    }
    const procedural = CLIPS.get(name);
    if (procedural) {
      sampleClipPose(procedural, t, state.poseTemp);
      eulerPoseToMocap(state.poseTemp, state.rig.restRot, out);
      return true;
    }
    copyMocapPose(state.mocapRest, out);
    return false;
  }

  function update(data, tAbs, dtWall, reducedMotion = false, clip = clipRef) {
    if (!data) return;
    const playerCount = Math.min((data.length / STRIDE) - 1, rigs.length);
    const roles = currentRoles;
    const wall = Number.isFinite(dtWall) ? clamp(dtWall, 0, 0.1) : 0;

    if (clip && clip !== clipRef) {
      clipRef = clip;
      eventCtx = buildEventContext(clip, roles);
    }
    const future = clip && clip.frames && clip.frames.length
      ? sampleClipInto(clip, tAbs + 0.12, futureBuf)
      : null;

    for (let i = 0; i < playerCount; i++) {
      const o = i * STRIDE;
      const rig = rigs[i];
      const state = states[i];
      const x = data[o];
      const y = data[o + 1];
      const heading = data[o + 3];
      const team = data[o + 4];
      const shirt = data[o + 5];
      const isGK = roles[i] === 1;

      rig.group.visible = true;
      state.team = team;
      state.isGK = isGK;
      rig.setAppearance(team, shirt, isGK, currentHomeColor, currentAwayColor);
      rig.group.position.set(x, 0, -y);

      // Facing follows the engine heading with a shortest-angle ease.
      state.heading = heading;
      if (wall <= 0) {
        state.facing = heading;
      } else {
        const delta = Math.atan2(
          Math.sin(heading - state.facing),
          Math.cos(heading - state.facing),
        );
        state.facing += delta * Math.min(1, 1 - Math.exp(-wall * 12));
      }
      rig.group.rotation.y = state.facing;

      // Speed from the next sample, not from the previous frame: a seek lands
      // mid-stride instead of collapsing to idle. The velocity vector also
      // drives directional locomotion (backpedal, shuffle, diagonal runs).
      let rawSpeed = 0;
      let velX = 0;
      let velY = 0;
      if (future) {
        const fx = future[o];
        const fy = future[o + 1];
        velX = (fx - x) / 0.12;
        velY = (fy - y) / 0.12;
        rawSpeed = clamp(Math.hypot(velX, velY), 0, 12);
      }
      state.speed = wall <= 0
        ? rawSpeed
        : state.speed + (rawSpeed - state.speed) * Math.min(1, wall * 10);

      if (reducedMotion) {
        rig.group.position.y = 0;
        rig.applyPose(state.restPose);
        continue;
      }

      const level = locomotionLevel(state.speed, state.level);
      let locoName = locomotionName(level, isGK);
      if (state.speed > 0.5) {
        const cos = Math.cos(state.facing);
        const sin = Math.sin(state.facing);
        const fwd = velX * cos + velY * sin;
        const lat = -velX * sin + velY * cos;
        if (fwd < -0.8) {
          locoName = Math.abs(lat) > 1
            ? bakedOr(MOCAP_CLIPS, variantFor('jog_back_diag', 'jog_back_diag', state.integration), locoName)
            : bakedOr(MOCAP_CLIPS, 'jog_back', locoName);
        } else if (Math.abs(lat) > 1.2 && fwd < 1.0) {
          locoName = bakedOr(MOCAP_CLIPS, lat > 0 ? 'strafe_r' : 'strafe_l', locoName);
        } else if (locoName === 'jog' && Math.abs(lat) > 1.0 && fwd > 1.0) {
          locoName = bakedOr(MOCAP_CLIPS, variantFor('jog_diag', 'jog_diag', state.integration), locoName);
        } else if (locoName === 'run' && !isGK) {
          locoName = bakedOr(MOCAP_CLIPS, variantFor('run', 'run', state.integration), locoName);
        }
      } else if (locoName === 'idle' || locoName === 'gk_idle') {
        locoName = bakedOr(MOCAP_CLIPS,
          variantFor(locoName === 'idle' ? 'idle' : 'gk_idle', locoName, state.integration),
          locoName);
      }
      if (locoName !== state.locoName) {
        state.prevLoco = state.locoName;
        state.locoName = locoName;
        state.blend = 0;
      }
      state.level = level;
      state.blend = wall <= 0 ? 1 : Math.min(1, state.blend + wall / 0.14);

      const natural = MOCAP_GAIT_SPEED[locoName] ?? GAIT_SPEED[locoName] ?? 0;
      const rate = natural > 0.1 ? clamp(state.speed / natural, 0.5, 2.0) : 1;
      const tLoc = tAbs * rate + state.phase;

      if (state.blend < 1 && state.prevLoco !== locoName) {
        sampleNamed(state, state.prevLoco, tLoc, state.mocapA);
        sampleNamed(state, locoName, tLoc, state.mocapB);
        blendMocapPose(state.mocapA, state.mocapB, state.blend, state.mocapOut);
      } else {
        sampleNamed(state, locoName, tLoc, state.mocapOut);
      }

      let lift = 0;

      // One-shot action derived from the event, blended over locomotion.
      if (eventCtx) {
        const action = actionForSlot(i, tAbs, eventCtx, {
          isGK, team, hash01: state.integration,
        });
        if (action) {
          const fadeIn = action.name === 'getup' ? 0 : 0.08;
          const weight = actionWeight(action, tAbs, fadeIn, 0.14);
          if (weight > 0 && sampleNamed(state, action.name, tAbs - action.start, state.mocapAction)) {
            blendMocapPose(state.mocapOut, state.mocapAction, weight, state.mocapOut);
          }
          const height = ACTION_LIFT[action.name];
          if (height && weight > 0) {
            const duration = MOCAP_TIMING[action.name]?.duration || (action.until - action.start);
            const p = clamp((tAbs - action.start) / Math.max(0.2, duration), 0, 1);
            lift = height * Math.sin(Math.PI * p) * weight;
          }
        }
      }

      rig.group.position.y = lift;
      rig.applyMocapPose(state.mocapOut);
    }

    for (let i = playerCount; i < rigs.length; i++) rigs[i].group.visible = false;
    activeCount = playerCount;
  }

  function clear() {
    for (const rig of rigs) rig.group.visible = false;
    currentRoles = [];
    activeCount = 0;
    clipRef = null;
    eventCtx = null;
  }

  function dispose() {
    pool.dispose();
  }

  return {
    group: pool.root,
    applyClip,
    update,
    clear,
    dispose,
    get activeCount() { return activeCount; },
    get clips() { return CLIPS; },
    get mocapClips() { return MOCAP_CLIPS; },
  };
}
