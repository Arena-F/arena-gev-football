// Authored procedural fallback clips for the 3D replay.
//
// The retargeted Mixamo set in mixamoClips.js is the default motion source.
// These keyframes remain as a safe fallback for any clip that has no mocap
// source, as the reduced-motion rest pose, and as the goal celebrations (the
// downloaded Mixamo soccer pack does not include celebrations). The format is
// the one in pose.js, so the rig, state machine and tests never care where a
// clip came from. A real GLB pack can later feed the same interface without
// touching the players.
//
// Conventions: the rig faces local +X, +Y is up, limbs hang down (-Y).
// Positive rz swings a limb forward; negative rz bends a knee (heel back).
// The character's right side is local -Z.

const DEG = Math.PI / 180;

function rot(bone, channel, keys) {
  return { bone, channel, keys: keys.map(([t, value]) => [t, value * DEG]) };
}

function pos(bone, channel, keys) {
  return { bone, channel, keys };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Evaluate a normalized cycle [[p, v], ...] with wrap-around. */
function evalCycle(points, p) {
  const t = ((p % 1) + 1) % 1;
  if (t <= points[0][0]) {
    const a = points[points.length - 1];
    const b = points[0];
    const span = 1 - a[0] + b[0];
    const u = span > 1e-9 ? (t + 1 - a[0]) / span : 0;
    return a[1] + (b[1] - a[1]) * u;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b[0]) {
      const span = b[0] - a[0];
      return span > 1e-9 ? a[1] + (b[1] - a[1]) * ((t - a[0]) / span) : b[1];
    }
  }
  return points[points.length - 1][1];
}

/** Turn a cycle into loop keys sampled every `steps`, phase-shifted. */
function cycleKeys(duration, points, shift = 0, steps = 12) {
  const keys = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    keys.push([p * duration, evalCycle(points, p + shift)]);
  }
  return keys;
}

/**
 * Shared gait builder. One leg cycle is authored, the other is shifted half a
 * turn; arms swing opposite the same-side leg. `knee` is the peak knee flex.
 */
function gait({ name, duration, thigh, knee, arm, bob, lean, twist, elbow = 26 }) {
  const thighPts = [[0, thigh], [0.25, 0], [0.5, -thigh], [0.75, 0], [1, thigh]];
  const kneePts = [
    [0, -8], [0.18, -6], [0.46, -knee * 0.42],
    [0.68, -knee], [0.88, -knee * 0.3], [1, -8],
  ];
  const footPts = [[0, 7], [0.24, 0], [0.5, -9], [0.72, 13], [1, 7]];
  const armPts = [[0, -arm], [0.5, arm], [1, -arm]];
  const forearmPts = [[0, elbow + 8], [0.5, elbow - 4], [1, elbow + 8]];
  const bobPts = [[0, 0], [0.25, bob], [0.5, 0], [0.75, bob], [1, 0]];
  const twistPts = [[0, -twist], [0.5, twist], [1, -twist]];

  return {
    name,
    duration,
    loop: true,
    tracks: [
      rot('ThighR', 'rz', cycleKeys(duration, thighPts, 0)),
      rot('ThighL', 'rz', cycleKeys(duration, thighPts, 0.5)),
      rot('ShinR', 'rz', cycleKeys(duration, kneePts, 0)),
      rot('ShinL', 'rz', cycleKeys(duration, kneePts, 0.5)),
      rot('FootR', 'rz', cycleKeys(duration, footPts, 0)),
      rot('FootL', 'rz', cycleKeys(duration, footPts, 0.5)),
      rot('UpperArmR', 'rz', cycleKeys(duration, armPts, 0)),
      rot('UpperArmL', 'rz', cycleKeys(duration, armPts, 0.5)),
      rot('ForearmR', 'rz', cycleKeys(duration, forearmPts, 0)),
      rot('ForearmL', 'rz', cycleKeys(duration, forearmPts, 0.5)),
      pos('Hips', 'ty', cycleKeys(duration, bobPts, 0)),
      rot('Chest', 'ry', cycleKeys(duration, twistPts, 0)),
      rot('Hips', 'ry', cycleKeys(duration, twistPts, 0.5, 12).map(([t, v]) => [t, v * -0.35])),
      rot('Spine', 'rz', [[0, -lean], [duration, -lean]]),
      rot('Head', 'rz', [[0, lean * 0.25], [duration, lean * 0.25]]),
    ],
  };
}

const idle = {
  name: 'idle',
  duration: 4,
  loop: true,
  tracks: [
    rot('Spine', 'rx', [[0, 1.2], [1, 0], [2, -1.2], [3, 0], [4, 1.2]]),
    rot('Chest', 'rx', [[0, -0.8], [2, 0.8], [4, -0.8]]),
    rot('Chest', 'rz', [[0, -1], [2, -2], [4, -1]]),
    rot('Head', 'ry', [[0, 0], [1, 7], [2, 2], [3, -6], [4, 0]]),
    rot('Head', 'rz', [[0, 0], [2, -1.5], [4, 0]]),
    rot('UpperArmR', 'rz', [[0, 2], [2, -1], [4, 2]]),
    rot('UpperArmL', 'rz', [[0, -1], [2, 2], [4, -1]]),
    rot('UpperArmR', 'rx', [[0, 3], [2, 5], [4, 3]]),
    rot('UpperArmL', 'rx', [[0, -5], [2, -3], [4, -5]]),
    rot('ForearmR', 'rz', [[0, 10], [2, 14], [4, 10]]),
    rot('ForearmL', 'rz', [[0, 14], [2, 10], [4, 14]]),
    pos('Hips', 'ty', [[0, 0], [2, -0.008], [4, 0]]),
    pos('Hips', 'tz', [[0, 0.012], [2, -0.012], [4, 0.012]]),
  ],
};

const walk = gait({
  name: 'walk', duration: 1.05, thigh: 25, knee: 58, arm: 18,
  bob: 0.018, lean: 4, twist: 5, elbow: 22,
});
const jog = gait({
  name: 'jog', duration: 0.78, thigh: 42, knee: 88, arm: 40,
  bob: 0.035, lean: 9, twist: 8, elbow: 46,
});
const run = gait({
  name: 'run', duration: 0.62, thigh: 60, knee: 112, arm: 62,
  bob: 0.05, lean: 14, twist: 11, elbow: 68,
});
const sprint = gait({
  name: 'sprint', duration: 0.52, thigh: 72, knee: 126, arm: 80,
  bob: 0.06, lean: 20, twist: 13, elbow: 84,
});

const kick = {
  name: 'kick',
  duration: 0.95,
  loop: false,
  tracks: [
    rot('ThighR', 'rz', [[0, -8], [0.15, -52], [0.3, 48], [0.42, 62], [0.6, 26], [0.95, 0]]),
    rot('ShinR', 'rz', [[0, -12], [0.15, -96], [0.3, -8], [0.42, -4], [0.6, -38], [0.95, -6]]),
    rot('FootR', 'rz', [[0, 0], [0.15, -16], [0.3, 26], [0.42, 30], [0.7, 8], [0.95, 0]]),
    rot('ThighL', 'rz', [[0, 8], [0.3, 16], [0.5, 10], [0.95, 0]]),
    rot('ShinL', 'rz', [[0, -8], [0.3, -20], [0.5, -16], [0.95, -5]]),
    rot('Hips', 'ry', [[0, 0], [0.15, 13], [0.3, -13], [0.42, -18], [0.6, -6], [0.95, 0]]),
    rot('Chest', 'ry', [[0, 0], [0.15, -11], [0.3, 16], [0.42, 21], [0.6, 7], [0.95, 0]]),
    rot('Spine', 'rz', [[0, -2], [0.15, 7], [0.3, -14], [0.42, -17], [0.6, -7], [0.95, -2]]),
    rot('UpperArmR', 'rz', [[0, 8], [0.15, -32], [0.3, 42], [0.42, 56], [0.6, 26], [0.95, 0]]),
    rot('UpperArmL', 'rz', [[0, -8], [0.15, 36], [0.3, -46], [0.42, -60], [0.6, -26], [0.95, 0]]),
    rot('ForearmR', 'rz', [[0, 24], [0.3, 30], [0.95, 20]]),
    rot('ForearmL', 'rz', [[0, 20], [0.3, 34], [0.95, 20]]),
    rot('UpperArmR', 'rx', [[0, 4], [0.3, 18], [0.6, 10], [0.95, 4]]),
    rot('UpperArmL', 'rx', [[0, -4], [0.3, -18], [0.6, -10], [0.95, -4]]),
    pos('Hips', 'ty', [[0, 0], [0.15, -0.02], [0.3, -0.045], [0.42, -0.01], [0.95, 0]]),
  ],
};

const header = {
  name: 'header',
  duration: 0.9,
  loop: false,
  tracks: [
    pos('Hips', 'ty', [[0, 0], [0.12, -0.08], [0.3, 0.22], [0.42, 0.26], [0.62, 0.05], [0.75, -0.06], [0.9, 0]]),
    rot('ThighR', 'rz', [[0, 0], [0.12, 20], [0.3, -5], [0.62, 16], [0.75, 22], [0.9, 0]]),
    rot('ThighL', 'rz', [[0, 0], [0.12, 20], [0.3, -5], [0.62, 16], [0.75, 22], [0.9, 0]]),
    rot('ShinR', 'rz', [[0, -5], [0.12, -55], [0.3, -14], [0.62, -42], [0.75, -56], [0.9, -5]]),
    rot('ShinL', 'rz', [[0, -5], [0.12, -55], [0.3, -14], [0.62, -42], [0.75, -56], [0.9, -5]]),
    rot('Spine', 'rz', [[0, -1], [0.12, 9], [0.3, -6], [0.42, -19], [0.62, 0], [0.9, -1]]),
    rot('Chest', 'rz', [[0, 0], [0.12, 6], [0.3, 4], [0.42, -17], [0.62, 0], [0.9, 0]]),
    rot('Head', 'rz', [[0, 0], [0.3, 11], [0.42, -29], [0.62, 0], [0.9, 0]]),
    rot('UpperArmR', 'rz', [[0, 4], [0.12, -22], [0.3, 148], [0.42, 168], [0.62, 58], [0.9, 0]]),
    rot('UpperArmL', 'rz', [[0, 4], [0.12, -22], [0.3, 148], [0.42, 168], [0.62, 58], [0.9, 0]]),
    rot('ForearmR', 'rz', [[0, 16], [0.42, 26], [0.9, 20]]),
    rot('ForearmL', 'rz', [[0, 16], [0.42, 26], [0.9, 20]]),
    rot('UpperArmR', 'rx', [[0, 5], [0.42, 22], [0.9, 5]]),
    rot('UpperArmL', 'rx', [[0, -5], [0.42, -22], [0.9, -5]]),
  ],
};

const tackle = {
  name: 'tackle',
  duration: 1.0,
  loop: false,
  tracks: [
    pos('Hips', 'ty', [[0, 0], [0.15, -0.16], [0.35, -0.48], [0.8, -0.48], [1.0, -0.1]]),
    rot('Hips', 'rz', [[0, 0], [0.15, -8], [0.35, 19], [0.8, 23], [1.0, 5]]),
    rot('Spine', 'rz', [[0, -2], [0.3, 9], [0.8, 12], [1.0, 2]]),
    rot('ThighR', 'rz', [[0, 0], [0.2, 36], [0.4, 56], [0.8, 42], [1.0, 10]]),
    rot('ShinR', 'rz', [[0, -5], [0.4, -10], [0.8, -6], [1.0, -5]]),
    rot('ThighL', 'rz', [[0, 0], [0.2, -10], [0.4, -26], [0.8, -31], [1.0, 0]]),
    rot('ShinL', 'rz', [[0, -5], [0.4, -72], [0.8, -82], [1.0, -15]]),
    rot('UpperArmR', 'rz', [[0, 0], [0.3, -38], [0.8, -46], [1.0, -8]]),
    rot('UpperArmL', 'rz', [[0, 0], [0.3, 24], [0.8, 30], [1.0, 6]]),
    rot('UpperArmR', 'rx', [[0, 4], [0.3, 38], [0.8, 42], [1.0, 6]]),
    rot('UpperArmL', 'rx', [[0, -4], [0.3, -30], [0.8, -34], [1.0, -6]]),
    rot('Head', 'ry', [[0, 0], [0.4, -10], [1.0, 0]]),
  ],
};

const fall = {
  name: 'fall',
  duration: 0.85,
  loop: false,
  tracks: [
    pos('Hips', 'ty', [[0, 0], [0.2, -0.12], [0.5, -0.55], [0.85, -0.6]]),
    rot('Hips', 'rz', [[0, 0], [0.2, 11], [0.5, 72], [0.85, 78]]),
    rot('ThighR', 'rz', [[0, 0], [0.3, 26], [0.5, -15], [0.85, -20]]),
    rot('ThighL', 'rz', [[0, 0], [0.3, 22], [0.5, -20], [0.85, -24]]),
    rot('ShinR', 'rz', [[0, -5], [0.5, -42], [0.85, -30]]),
    rot('ShinL', 'rz', [[0, -5], [0.5, -48], [0.85, -36]]),
    rot('UpperArmR', 'rx', [[0, 4], [0.3, 70], [0.85, 84]]),
    rot('UpperArmL', 'rx', [[0, -4], [0.3, -70], [0.85, -84]]),
    rot('UpperArmR', 'rz', [[0, 0], [0.3, -24], [0.85, -30]]),
    rot('UpperArmL', 'rz', [[0, 0], [0.3, 24], [0.85, 30]]),
    rot('Head', 'rz', [[0, 0], [0.4, -16], [0.85, -10]]),
  ],
};

const getup = {
  name: 'getup',
  duration: 1.1,
  loop: false,
  tracks: [
    pos('Hips', 'ty', [[0, -0.6], [0.4, -0.32], [0.75, -0.09], [1.1, 0]]),
    rot('Hips', 'rz', [[0, 78], [0.5, 40], [0.8, 11], [1.1, 0]]),
    rot('ThighR', 'rz', [[0, -20], [0.5, 34], [1.1, 0]]),
    rot('ThighL', 'rz', [[0, -24], [0.5, 30], [1.1, 0]]),
    rot('ShinR', 'rz', [[0, -30], [0.5, -72], [1.1, -5]]),
    rot('ShinL', 'rz', [[0, -36], [0.5, -68], [1.1, -5]]),
    rot('UpperArmR', 'rz', [[0, -30], [0.4, 34], [1.1, 0]]),
    rot('UpperArmL', 'rz', [[0, 30], [0.4, -30], [1.1, 0]]),
    rot('Spine', 'rz', [[0, 10], [0.5, 4], [1.1, -1]]),
  ],
};

// Celebrations are loops so the state machine can hold them for the whole
// post-goal window without a snap when the clip ends.
const celebrateA = {
  name: 'celebrate_a',
  duration: 1.2,
  loop: true,
  tracks: [
    pos('Hips', 'ty', [[0, 0], [0.15, -0.05], [0.35, 0.28], [0.55, 0], [0.7, -0.05], [0.9, 0.28], [1.2, 0]]),
    rot('ThighR', 'rz', [[0, 20], [0.35, -10], [0.55, 20], [0.9, -10], [1.2, 20]]),
    rot('ThighL', 'rz', [[0, 18], [0.35, -12], [0.55, 18], [0.9, -12], [1.2, 18]]),
    rot('ShinR', 'rz', [[0, -42], [0.35, -12], [0.55, -42], [0.9, -12], [1.2, -42]]),
    rot('ShinL', 'rz', [[0, -40], [0.35, -12], [0.55, -40], [0.9, -12], [1.2, -40]]),
    rot('UpperArmR', 'rz', [[0, 80], [0.35, 158], [0.6, 80], [0.9, 158], [1.2, 80]]),
    rot('UpperArmL', 'rz', [[0, 64], [0.35, 150], [0.6, 64], [0.9, 150], [1.2, 64]]),
    rot('ForearmR', 'rz', [[0, 70], [0.35, 96], [0.6, 70], [1.2, 70]]),
    rot('ForearmL', 'rz', [[0, 66], [0.35, 92], [0.6, 66], [1.2, 66]]),
    rot('Spine', 'rz', [[0, -4], [0.35, -8], [0.7, -4], [1.2, -4]]),
    rot('Head', 'rz', [[0, -6], [0.35, -10], [1.2, -6]]),
  ],
};

const celebrateB = {
  name: 'celebrate_b',
  duration: 1.6,
  loop: true,
  tracks: [
    pos('Hips', 'ty', [[0, -0.42], [0.8, -0.44], [1.6, -0.42]]),
    rot('Hips', 'rz', [[0, 14], [0.8, 16], [1.6, 14]]),
    rot('ThighR', 'rz', [[0, 44], [0.8, 46], [1.6, 44]]),
    rot('ShinR', 'rz', [[0, -22], [0.8, -20], [1.6, -22]]),
    rot('ThighL', 'rz', [[0, 8], [0.8, 10], [1.6, 8]]),
    rot('ShinL', 'rz', [[0, -95], [0.8, -92], [1.6, -95]]),
    rot('UpperArmR', 'rz', [[0, 110], [0.5, 128], [1.0, 110], [1.6, 110]]),
    rot('UpperArmL', 'rz', [[0, 110], [0.5, 96], [1.0, 110], [1.6, 110]]),
    rot('UpperArmR', 'rx', [[0, 36], [1.6, 36]]),
    rot('UpperArmL', 'rx', [[0, -36], [1.6, -36]]),
    rot('ForearmR', 'rz', [[0, 60], [1.6, 60]]),
    rot('ForearmL', 'rz', [[0, 60], [1.6, 60]]),
    rot('Chest', 'ry', [[0, -8], [0.8, 8], [1.6, -8]]),
    rot('Head', 'rz', [[0, -8], [1.6, -8]]),
  ],
};

const celebrateC = {
  name: 'celebrate_c',
  duration: 1.4,
  loop: true,
  tracks: [
    pos('Hips', 'ty', [[0, 0], [0.35, 0.06], [0.7, 0], [1.05, 0.06], [1.4, 0]]),
    rot('ThighR', 'rz', [[0, 24], [0.7, -18], [1.4, 24]]),
    rot('ThighL', 'rz', [[0, -18], [0.7, 24], [1.4, -18]]),
    rot('ShinR', 'rz', [[0, -38], [0.7, -12], [1.4, -38]]),
    rot('ShinL', 'rz', [[0, -12], [0.7, -38], [1.4, -12]]),
    rot('UpperArmR', 'rx', [[0, 120], [1.4, 120]]),
    rot('UpperArmL', 'rx', [[0, -120], [1.4, -120]]),
    rot('UpperArmR', 'rz', [[0, 24], [0.7, 42], [1.4, 24]]),
    rot('UpperArmL', 'rz', [[0, 42], [0.7, 24], [1.4, 42]]),
    rot('Spine', 'rz', [[0, -6], [1.4, -6]]),
    rot('Head', 'ry', [[0, -6], [0.7, 6], [1.4, -6]]),
  ],
};

const gkIdle = {
  name: 'gk_idle',
  duration: 2.0,
  loop: true,
  tracks: [
    pos('Hips', 'ty', [[0, -0.1], [1.0, -0.12], [2.0, -0.1]]),
    rot('ThighR', 'rz', [[0, 9], [1.0, 11], [2.0, 9]]),
    rot('ThighL', 'rz', [[0, 9], [1.0, 7], [2.0, 9]]),
    rot('ShinR', 'rz', [[0, -31], [1.0, -34], [2.0, -31]]),
    rot('ShinL', 'rz', [[0, -31], [1.0, -28], [2.0, -31]]),
    rot('UpperArmR', 'rz', [[0, 32], [1.0, 38], [2.0, 32]]),
    rot('UpperArmL', 'rz', [[0, 32], [1.0, 26], [2.0, 32]]),
    rot('UpperArmR', 'rx', [[0, 24], [1.0, 30], [2.0, 24]]),
    rot('UpperArmL', 'rx', [[0, -24], [1.0, -30], [2.0, -24]]),
    rot('ForearmR', 'rz', [[0, 44], [1.0, 50], [2.0, 44]]),
    rot('ForearmL', 'rz', [[0, 44], [1.0, 50], [2.0, 44]]),
    rot('Spine', 'rx', [[0, 2], [1.0, -2], [2.0, 2]]),
    rot('Head', 'ry', [[0, 0], [0.7, 5], [1.4, -5], [2.0, 0]]),
  ],
};

function dive(name, side) {
  return {
    name,
    duration: 1.0,
    loop: false,
    tracks: [
      pos('Hips', 'ty', [[0, 0], [0.15, -0.08], [0.4, 0.15], [0.6, -0.35], [0.8, -0.55], [1.0, 0]]),
      rot('Hips', 'rx', [[0, 0], [0.25, side * 15], [0.5, side * 72], [0.75, side * 44], [1.0, 0]]),
      rot('Hips', 'rz', [[0, 0], [0.3, -side * 8], [0.7, -side * 4], [1.0, 0]]),
      rot('ThighR', 'rz', [[0, 8], [0.35, side > 0 ? -18 : 26], [0.8, side > 0 ? 10 : 4], [1.0, 0]]),
      rot('ThighL', 'rz', [[0, 8], [0.35, side > 0 ? -10 : 30], [0.8, side > 0 ? 8 : 2], [1.0, 0]]),
      rot('ShinR', 'rz', [[0, -30], [0.5, -54], [1.0, -5]]),
      rot('ShinL', 'rz', [[0, -30], [0.5, -46], [1.0, -5]]),
      rot('UpperArmR', 'rx', [[0, 24], [0.35, side * 120], [0.6, side * 150], [1.0, 4]]),
      rot('UpperArmL', 'rx', [[0, -24], [0.35, side * 120], [0.6, side * 150], [1.0, -4]]),
      rot('UpperArmR', 'rz', [[0, 30], [0.5, 66], [1.0, 0]]),
      rot('UpperArmL', 'rz', [[0, 30], [0.5, 66], [1.0, 0]]),
      rot('ForearmR', 'rz', [[0, 40], [0.6, 16], [1.0, 16]]),
      rot('ForearmL', 'rz', [[0, 40], [0.6, 16], [1.0, 16]]),
      rot('Head', 'ry', [[0, 0], [0.5, side * 8], [1.0, 0]]),
    ],
  };
}

export const PLAYER_CLIP_DEFS = [
  idle, walk, jog, run, sprint,
  kick, header, tackle, fall, getup,
  celebrateA, celebrateB, celebrateC,
  gkIdle, dive('gk_dive_l', 1), dive('gk_dive_r', -1),
];

export const LOCOMOTION_CLIPS = ['idle', 'walk', 'jog', 'run', 'sprint'];

/**
 * Natural ground speed each gait clip was authored around. Playback rate is
 * scaled by measured/natural so feet stay roughly under the body and a sprint
 * does not read as a sped-up walk.
 */
export const GAIT_SPEED = {
  idle: 0.0,
  walk: 1.4,
  jog: 3.2,
  run: 5.0,
  sprint: 7.6,
  gk_idle: 0.0,
};
