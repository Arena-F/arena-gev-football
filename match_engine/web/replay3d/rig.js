// Articulated player rig for the 3D replay.
//
// The old rig had one pivot per arm and leg, which is why it read as sticks.
// This one is a proper humanoid chain: hips -> spine -> chest -> neck -> head,
// clavicle -> upper arm -> forearm -> hand, and hip -> thigh -> shin -> foot.
//
// Each player is a single SkinnedMesh with rigid per-vertex weights and vertex
// colours, plus one textured number plane. That keeps the 22-player pool to
// ~44 draw calls instead of one draw call per limb. Poses arrive as flat offset
// buffers from pose.js or absolute quaternion buffers from mocapPose.js, so
// animation is pure data and a seek rebuilds any instant exactly.

import * as THREE from '../vendor/three/three.module.min.js';
import { BONE_NAMES, CHANNELS } from './pose.js';
import { HIP_OFFSET } from './mocapPose.js';

const GK_HOME = '#f5c542';
const GK_AWAY = '#ff6b6b';
const DEFAULT_HOME = '#52B4F5';
const DEFAULT_AWAY = '#C861D1';
const BOOT_COLOR = '#111417';

export const SKIN_TONES = ['#f2c9a0', '#e0ac7e', '#c68a5a', '#a96b41', '#7d4b2e', '#5c3520'];
export const HAIR_TONES = ['#1a1a1a', '#3a2a1a', '#6b4a2a', '#2b2b2b', '#8a6a3a'];

// Rest skeleton. Positions are local to the parent, in metres. The character
// faces +X; their right side is -Z. Exported so the offline Mixamo baker and
// the mocap tests share the exact same rest pose as the runtime.
export const BONE_TREE = {
  Hips: { parent: null, pos: [0, 0.95, 0] },
  Spine: { parent: 'Hips', pos: [0, 0.12, 0] },
  Chest: { parent: 'Spine', pos: [0, 0.22, 0] },
  Neck: { parent: 'Chest', pos: [0, 0.18, 0] },
  Head: { parent: 'Neck', pos: [0, 0.12, 0] },
  ShoulderR: { parent: 'Chest', pos: [0, 0.12, -0.2] },
  UpperArmR: { parent: 'ShoulderR', pos: [0, 0, 0] },
  ForearmR: { parent: 'UpperArmR', pos: [0, -0.3, 0] },
  HandR: { parent: 'ForearmR', pos: [0, -0.27, 0] },
  ShoulderL: { parent: 'Chest', pos: [0, 0.12, 0.2] },
  UpperArmL: { parent: 'ShoulderL', pos: [0, 0, 0] },
  ForearmL: { parent: 'UpperArmL', pos: [0, -0.3, 0] },
  HandL: { parent: 'ForearmL', pos: [0, -0.27, 0] },
  ThighR: { parent: 'Hips', pos: [0, -0.05, -0.1] },
  ShinR: { parent: 'ThighR', pos: [0, -0.44, 0] },
  FootR: { parent: 'ShinR', pos: [0, -0.42, 0] },
  ThighL: { parent: 'Hips', pos: [0, -0.05, 0.1] },
  ShinL: { parent: 'ThighL', pos: [0, -0.44, 0] },
  FootL: { parent: 'ShinL', pos: [0, -0.42, 0] },
};

for (const name of BONE_NAMES) {
  if (!BONE_TREE[name]) throw new Error(`rig is missing bone ${name}`);
}

// A small rest splay keeps the arms from clipping the torso.
export const REST_ROTATION = {
  UpperArmR: [0.09, 0, 0],
  UpperArmL: [-0.09, 0, 0],
  ForearmR: [0, 0, 0.1],
  ForearmL: [0, 0, 0.1],
};

export function hash01(index, salt = 0) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function luminance(hex) {
  const color = new THREE.Color(hex);
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function darken(hex, factor) {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return `#${color.getHexString()}`;
}

export function createSharedRigAssets() {
  const geometry = {
    torso: new THREE.CapsuleGeometry(0.195, 0.4, 6, 12),
    head: new THREE.SphereGeometry(0.118, 14, 10),
    hair: new THREE.SphereGeometry(0.121, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2.3),
    neck: new THREE.CylinderGeometry(0.05, 0.058, 0.09, 8),
    upperArm: new THREE.CapsuleGeometry(0.054, 0.19, 4, 8),
    forearm: new THREE.CapsuleGeometry(0.045, 0.18, 4, 8),
    thigh: new THREE.CapsuleGeometry(0.08, 0.28, 4, 8),
    shin: new THREE.CapsuleGeometry(0.062, 0.28, 4, 8),
    shorts: new THREE.CylinderGeometry(0.19, 0.195, 0.14, 12),
    shortLeg: new THREE.CylinderGeometry(0.1, 0.108, 0.22, 8),
    boot: new THREE.BoxGeometry(0.19, 0.08, 0.11),
    hand: new THREE.SphereGeometry(0.05, 8, 6),
    joint: new THREE.SphereGeometry(1, 10, 8),
    number: new THREE.PlaneGeometry(0.24, 0.18),
    blob: new THREE.PlaneGeometry(1, 1),
  };
  const bodyMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
  });
  // Soft blob shadow: grounds each player even where the shadow map is soft.
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = 128;
  blobCanvas.height = 128;
  const blobCtx = blobCanvas.getContext('2d');
  const blobGradient = blobCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
  blobGradient.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  blobGradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
  blobGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  blobCtx.fillStyle = blobGradient;
  blobCtx.fillRect(0, 0, 128, 128);
  const blobTexture = new THREE.CanvasTexture(blobCanvas);
  const blobMaterial = new THREE.MeshBasicMaterial({
    map: blobTexture,
    transparent: true,
    depthWrite: false,
  });
  return { geometry, bodyMaterial, blobMaterial };
}

function makeBones() {
  const bones = {};
  for (const name of BONE_NAMES) {
    const bone = new THREE.Object3D();
    bone.name = name;
    const spec = BONE_TREE[name];
    bone.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    const rest = REST_ROTATION[name];
    if (rest) bone.rotation.set(rest[0], rest[1], rest[2]);
    bones[name] = bone;
  }
  for (const name of BONE_NAMES) {
    const spec = BONE_TREE[name];
    if (spec.parent) bones[spec.parent].add(bones[name]);
  }
  return bones;
}

const PART_LIST = [
  { geo: 'torso', bone: 'Chest', pos: [0, -0.08, 0], scale: [0.68, 1, 0.92], cat: 'jersey' },
  { geo: 'shorts', bone: 'Hips', pos: [0, 0, 0], cat: 'shorts' },
  { geo: 'shortLeg', bone: 'ThighR', pos: [0, -0.1, 0], cat: 'shorts' },
  { geo: 'shortLeg', bone: 'ThighL', pos: [0, -0.1, 0], cat: 'shorts' },
  { geo: 'neck', bone: 'Neck', pos: [0, 0.03, 0], cat: 'skin' },
  { geo: 'head', bone: 'Head', pos: [0, 0.11, 0], scale: [1, 1.06, 1], cat: 'skin' },
  { geo: 'hair', bone: 'Head', pos: [0, 0.12, 0], cat: 'hair' },
  { geo: 'joint', bone: 'Spine', pos: [0, -0.04, 0], scale: [0.145, 0.115, 0.135], cat: 'jersey' },
  { geo: 'joint', bone: 'ForearmR', pos: [0, 0, 0], scale: [0.053, 0.053, 0.053], cat: 'skin' },
  { geo: 'joint', bone: 'ForearmL', pos: [0, 0, 0], scale: [0.053, 0.053, 0.053], cat: 'skin' },
  { geo: 'joint', bone: 'ThighR', pos: [0, -0.01, 0], scale: [0.086, 0.086, 0.086], cat: 'shorts' },
  { geo: 'joint', bone: 'ThighL', pos: [0, -0.01, 0], scale: [0.086, 0.086, 0.086], cat: 'shorts' },
  { geo: 'joint', bone: 'ShinR', pos: [0, 0, 0], scale: [0.065, 0.065, 0.065], cat: 'skin' },
  { geo: 'joint', bone: 'ShinL', pos: [0, 0, 0], scale: [0.065, 0.065, 0.065], cat: 'skin' },
  { geo: 'joint', bone: 'FootR', pos: [0, 0, 0], scale: [0.057, 0.057, 0.057], cat: 'sock' },
  { geo: 'joint', bone: 'FootL', pos: [0, 0, 0], scale: [0.057, 0.057, 0.057], cat: 'sock' },
  { geo: 'upperArm', bone: 'UpperArmR', pos: [0, -0.15, 0], cat: 'jersey' },
  { geo: 'upperArm', bone: 'UpperArmL', pos: [0, -0.15, 0], cat: 'jersey' },
  { geo: 'forearm', bone: 'ForearmR', pos: [0, -0.135, 0], cat: 'skin' },
  { geo: 'forearm', bone: 'ForearmL', pos: [0, -0.135, 0], cat: 'skin' },
  { geo: 'hand', bone: 'HandR', pos: [0, -0.02, 0], cat: 'skin' },
  { geo: 'hand', bone: 'HandL', pos: [0, -0.02, 0], cat: 'skin' },
  { geo: 'thigh', bone: 'ThighR', pos: [0, -0.22, 0], cat: 'skin' },
  { geo: 'thigh', bone: 'ThighL', pos: [0, -0.22, 0], cat: 'skin' },
  { geo: 'shin', bone: 'ShinR', pos: [0, -0.21, 0], cat: 'sock' },
  { geo: 'shin', bone: 'ShinL', pos: [0, -0.21, 0], cat: 'sock' },
  { geo: 'boot', bone: 'FootR', pos: [0.05, 0.005, 0], cat: 'boot' },
  { geo: 'boot', bone: 'FootL', pos: [0.05, 0.005, 0], cat: 'boot' },
];

/**
 * Merge every body part into one skinned geometry. Each vertex is rigidly
 * weighted to a single bone, which is all a stylised footballer needs and keeps
 * the merge (and the shader) cheap.
 */
function buildBody(shared, bones, skinColor, hairColor, kitColors) {
  const positions = [];
  const normals = [];
  const colors = [];
  const skinIndices = [];
  const skinWeights = [];
  const ranges = { jersey: [], shorts: [], sock: [] };

  const colorCache = new Map();
  function colorOf(cat) {
    let hex;
    if (cat === 'skin') hex = skinColor;
    else if (cat === 'hair') hex = hairColor;
    else if (cat === 'boot') hex = BOOT_COLOR;
    else hex = kitColors[cat];
    if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex));
    return colorCache.get(hex);
  }

  const boneIndex = new Map(BONE_NAMES.map((name, index) => [name, index]));
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  for (const part of PART_LIST) {
    const geometry = shared.geometry[part.geo];
    const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const bone = bones[part.bone];
    const s = part.scale || [1, 1, 1];
    pos.set(part.pos[0], part.pos[1], part.pos[2]);
    quaternion.identity();
    scale.set(s[0], s[1], s[2]);
    local.compose(pos, quaternion, scale);
    world.multiplyMatrices(bone.matrixWorld, local);
    geo.applyMatrix4(world);

    const count = geo.attributes.position.count;
    const start = positions.length / 3;
    const color = colorOf(part.cat);
    const boneIdx = boneIndex.get(part.bone);

    const p = geo.attributes.position.array;
    const n = geo.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      positions.push(p[i], p[i + 1], p[i + 2]);
      normals.push(n[i], n[i + 1], n[i + 2]);
      colors.push(color.r, color.g, color.b);
      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    if (ranges[part.cat]) ranges[part.cat].push([start, count]);
    geo.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return { geometry, ranges };
}

function createRig(index, shared) {
  const heightScale = 0.94 + hash01(index, 3) * 0.1;
  const skinColor = SKIN_TONES[Math.floor(hash01(index, 1) * SKIN_TONES.length)];
  const hairColor = HAIR_TONES[Math.floor(hash01(index, 2) * HAIR_TONES.length)];
  const kitColors = {
    jersey: DEFAULT_HOME,
    shorts: darken(DEFAULT_HOME, 0.55),
    sock: DEFAULT_HOME,
  };

  const root = new THREE.Group();
  root.name = `player-${index}`;

  const body = new THREE.Group();
  body.name = `player-${index}-body`;
  root.add(body);

  const bones = makeBones();
  // Scale joint spacing instead of the root: a post-bind root scale would be
  // applied to both the bind matrix and the bone world matrices.
  for (const name of BONE_NAMES) bones[name].position.multiplyScalar(heightScale);
  body.add(bones.Hips);
  body.updateMatrixWorld(true);

  const { geometry, ranges } = buildBody(shared, bones, skinColor, hairColor, kitColors);
  const mesh = new THREE.SkinnedMesh(geometry, shared.bodyMaterial);
  mesh.name = `player-${index}-skin`;
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((name) => bones[name]));
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  body.add(mesh);

  // Back number: one canvas + texture per rig, redrawn when the shirt changes.
  const numberCanvas = document.createElement('canvas');
  numberCanvas.width = 128;
  numberCanvas.height = 96;
  const numberTexture = new THREE.CanvasTexture(numberCanvas);
  numberTexture.colorSpace = THREE.SRGBColorSpace;
  const numberMaterial = new THREE.MeshBasicMaterial({
    map: numberTexture,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const numberMesh = new THREE.Mesh(shared.geometry.number, numberMaterial);
  numberMesh.position.set(-0.145, 0.06, 0);
  numberMesh.rotation.y = -Math.PI / 2;
  numberMesh.castShadow = false;
  bones.Chest.add(numberMesh);

  // Blob shadow: a rotation-invariant disc pinned to the ground under the rig
  // root, so it tracks position (and lift) but never the pose.
  const blobMesh = new THREE.Mesh(shared.geometry.blob, shared.blobMaterial);
  blobMesh.rotation.x = -Math.PI / 2;
  blobMesh.position.y = 0.015;
  blobMesh.scale.setScalar(0.95 * heightScale);
  blobMesh.castShadow = false;
  blobMesh.receiveShadow = false;
  blobMesh.renderOrder = 1;
  root.add(blobMesh);

  // Rest values per bone, so a pose buffer is a clean additive offset.
  const restPos = new Float32Array(BONE_NAMES.length * 3);
  const restRot = new Float32Array(BONE_NAMES.length * 3);
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const bone = bones[BONE_NAMES[i]];
    restPos[i * 3] = bone.position.x;
    restPos[i * 3 + 1] = bone.position.y;
    restPos[i * 3 + 2] = bone.position.z;
    restRot[i * 3] = bone.rotation.x;
    restRot[i * 3 + 1] = bone.rotation.y;
    restRot[i * 3 + 2] = bone.rotation.z;
  }

  let currentKey = '';
  const colorAttr = geometry.getAttribute('color');
  const scratch = new THREE.Color();

  function recolor(cat, hex) {
    scratch.set(hex);
    for (const [start, count] of ranges[cat]) {
      for (let i = 0; i < count; i++) {
        const o = (start + i) * 3;
        colorAttr.array[o] = scratch.r;
        colorAttr.array[o + 1] = scratch.g;
        colorAttr.array[o + 2] = scratch.b;
      }
    }
    colorAttr.needsUpdate = true;
  }

  function drawNumber(shirt, baseColor) {
    const ctx = numberCanvas.getContext('2d');
    ctx.clearRect(0, 0, numberCanvas.width, numberCanvas.height);
    const text = String(shirt);
    ctx.font = '800 64px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    const darkText = luminance(baseColor) > 0.55;
    ctx.strokeStyle = darkText ? 'rgba(10, 14, 18, 0.9)' : 'rgba(255, 255, 255, 0.92)';
    ctx.strokeText(text, 64, 50);
    ctx.fillStyle = darkText ? '#10161c' : '#ffffff';
    ctx.fillText(text, 64, 50);
    numberTexture.needsUpdate = true;
  }

  function setAppearance(team, shirt, isGK, homeColor, awayColor) {
    const key = `${team}:${shirt}:${isGK ? 1 : 0}:${homeColor}:${awayColor}`;
    if (key === currentKey) return;
    currentKey = key;
    const base = isGK
      ? (team === 0 ? GK_HOME : GK_AWAY)
      : (team === 0 ? (homeColor || DEFAULT_HOME) : (awayColor || DEFAULT_AWAY));
    kitColors.jersey = base;
    kitColors.shorts = darken(base, 0.55);
    kitColors.sock = base;
    recolor('jersey', kitColors.jersey);
    recolor('shorts', kitColors.shorts);
    recolor('sock', kitColors.sock);
    drawNumber(shirt, base);
  }

  /** Write a flat pose buffer (pose.js) onto the bone chain. */
  function applyPose(pose) {
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const bone = bones[BONE_NAMES[i]];
      const o = i * CHANNELS.length;
      bone.rotation.set(
        restRot[i * 3] + pose[o],
        restRot[i * 3 + 1] + pose[o + 1],
        restRot[i * 3 + 2] + pose[o + 2],
      );
      bone.position.set(
        restPos[i * 3] + pose[o + 3],
        restPos[i * 3 + 1] + pose[o + 4],
        restPos[i * 3 + 2] + pose[o + 5],
      );
    }
  }

  const HIPS_INDEX = BONE_NAMES.indexOf('Hips');

  /**
   * Write a baked mocap pose (mocapPose.js). Quaternions are absolute local
   * rotations; only the hips carry a translation, scaled with the rig height.
   */
  function applyMocapPose(pose) {
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const bone = bones[BONE_NAMES[i]];
      const o = i * 4;
      bone.quaternion.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
      if (i === HIPS_INDEX) {
        bone.position.set(
          restPos[i * 3] + pose[HIP_OFFSET] * heightScale,
          restPos[i * 3 + 1] + pose[HIP_OFFSET + 1] * heightScale,
          restPos[i * 3 + 2] + pose[HIP_OFFSET + 2] * heightScale,
        );
      } else {
        bone.position.set(restPos[i * 3], restPos[i * 3 + 1], restPos[i * 3 + 2]);
      }
    }
  }

  function dispose() {
    numberTexture.dispose();
    numberMaterial.dispose();
    geometry.dispose();
  }

  return {
    index,
    group: root,
    bones,
    mesh,
    heightScale,
    restPos,
    restRot,
    setAppearance,
    applyPose,
    applyMocapPose,
    dispose,
  };
}

export function createRigPool(count = 22) {
  const shared = createSharedRigAssets();
  const rigs = [];
  const root = new THREE.Group();
  root.name = 'player-rigs';
  for (let i = 0; i < count; i++) {
    const rig = createRig(i, shared);
    rigs.push(rig);
    root.add(rig.group);
  }
  return {
    root,
    rigs,
    shared,
    dispose() {
      for (const rig of rigs) rig.dispose();
    },
  };
}

export { BONE_NAMES };
