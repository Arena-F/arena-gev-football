// Procedural stadium for the 3D replay experiment.
//
// Everything is built from primitives at runtime: no model downloads, no
// texture files. The pitch markings are a CanvasTexture drawn in the same
// metres the engine uses (105 × 68, home attacks +x).

import * as THREE from '../vendor/three/three.module.min.js';

export const PITCH_W = 105;
export const PITCH_H = 68;
export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;

const HOME_COLOR = '#f2f2f2';
const AWAY_COLOR = '#2f81f7';
const NEUTRAL_COLOR = '#ffbe5a';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pitch markings + mowing stripes, drawn in metres. */
export function makePitchTexture(renderer) {
  const scale = 20; // px per metre
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PITCH_W * scale);
  canvas.height = Math.round(PITCH_H * scale);
  const ctx = canvas.getContext('2d');
  const X = (x) => (x + PITCH_W / 2) * scale;
  const Y = (y) => (PITCH_H / 2 - y) * scale;
  const line = 0.12 * scale;

  // Base wash.
  const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, '#1a5230');
  base.addColorStop(0.5, '#1d5c36');
  base.addColorStop(1, '#17502c');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Mowing stripes across the width.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  const stripeW = canvas.width / 12;
  for (let i = 0; i < 12; i += 2) {
    ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
  }

  // Wear: heavy-traffic zones (centre spot, penalty spots, touchlines) read
  // slightly thinner, like a real late-season pitch.
  const wearRand = mulberry32(0x9c4f);
  for (let i = 0; i < 260; i++) {
    const hot = wearRand();
    const cx = hot < 0.4
      ? X(0) + (wearRand() - 0.5) * 26 * scale
      : (wearRand() - 0.5) * canvas.width;
    const cy = hot < 0.4
      ? Y(0) + (wearRand() - 0.5) * 20 * scale
      : (wearRand() - 0.5) * canvas.height;
    const r = (2 + wearRand() * 9) * scale * 0.28;
    const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const pale = wearRand() < 0.5;
    spot.addColorStop(0, pale ? 'rgba(210, 225, 190, 0.05)' : 'rgba(6, 26, 14, 0.07)');
    spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.lineWidth = line;
  ctx.lineCap = 'butt';

  const halfW = PITCH_W / 2;
  const halfH = PITCH_H / 2;
  const inset = line / 2;

  // Touchlines.
  ctx.strokeRect(X(-halfW) + inset, Y(halfH) + inset,
    PITCH_W * scale - line, PITCH_H * scale - line);

  // Halfway line + centre circle + spot.
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-halfH));
  ctx.lineTo(X(0), Y(halfH));
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(X(0), Y(0), 9.15 * scale, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(X(0), Y(0), 2.5, 0, Math.PI * 2);
  ctx.fill();

  for (const dir of [-1, 1]) {
    const goalLine = dir * halfW;
    const boxX = goalLine - dir * 16.5;
    const goalAreaX = goalLine - dir * 5.5;
    const spotX = goalLine - dir * 11;

    // Penalty area.
    ctx.strokeRect(
      Math.min(X(goalLine), X(boxX)),
      Y(20.16),
      Math.abs(X(boxX) - X(goalLine)),
      40.32 * scale,
    );

    // Goal area.
    ctx.strokeRect(
      Math.min(X(goalLine), X(goalAreaX)),
      Y(9.16),
      Math.abs(X(goalAreaX) - X(goalLine)),
      18.32 * scale,
    );

    // Penalty spot + arc outside the box.
    ctx.beginPath();
    ctx.arc(X(spotX), Y(0), 2.5, 0, Math.PI * 2);
    ctx.fill();

    const arcAngle = Math.acos((16.5 - 11) / 9.15);
    ctx.beginPath();
    if (dir > 0) ctx.arc(X(spotX), Y(0), 9.15 * scale, -arcAngle, arcAngle);
    else ctx.arc(X(spotX), Y(0), 9.15 * scale, Math.PI - arcAngle, Math.PI + arcAngle);
    ctx.stroke();
  }

  // Corner arcs.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(X(sx * halfW), Y(sy * halfH), 1 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  return texture;
}

function makeNetTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(235, 245, 255, 0.72)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLedTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#07100d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f2a20';
  for (let x = 0; x < canvas.width; x += 128) {
    ctx.fillRect(x, 0, 64, canvas.height);
  }
  ctx.font = '700 40px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#dff8ea';
  const words = ['GOD’S EYE VIEW', '3D REPLAY', 'GEV'];
  let x = 26;
  let i = 0;
  while (x < canvas.width) {
    const word = words[i % words.length];
    ctx.fillStyle = i % 3 === 1 ? '#3fd07c' : '#dff8ea';
    ctx.fillText(word, x, canvas.height / 2 + 1);
    x += ctx.measureText(word).width + 64;
    i++;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

/** White head-and-shoulders silhouette; instance colour multiplies it. */
function makeCrowdSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 17, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, 63);
  ctx.quadraticCurveTo(15, 38, 24, 30);
  ctx.quadraticCurveTo(32, 25, 40, 30);
  ctx.quadraticCurveTo(49, 38, 46, 63);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A scarf-like flag: white cloth with a darker sash, tinted per instance. */
function makeFlagTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 96);
  ctx.fillStyle = 'rgba(8, 18, 26, 0.28)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(44, 0);
  ctx.lineTo(0, 64);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(8, 18, 26, 0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 52, 17, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Head-only sprite for the nodding head layer. */
function makeHeadSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 22, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(22, 34, 20, 14);
  ctx.beginPath();
  ctx.moveTo(10, 63);
  ctx.quadraticCurveTo(12, 46, 24, 44);
  ctx.lineTo(40, 44);
  ctx.quadraticCurveTo(52, 46, 54, 63);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Arms-up celebration silhouette for the arms layer. */
function makeArmsSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.translate(48, 78);
  ctx.rotate(-0.5);
  ctx.fillRect(-7, -52, 14, 52);
  ctx.restore();
  ctx.save();
  ctx.translate(48, 78);
  ctx.rotate(0.5);
  ctx.fillRect(-7, -52, 14, 52);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(48, 62, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(34, 70, 28, 26);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Handheld banner: cloth with an emblem, waved above the head. */
function makeBannerSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 96);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(14, 8, 100, 56);
  ctx.fillStyle = 'rgba(8, 18, 26, 0.3)';
  ctx.fillRect(14, 8, 100, 10);
  ctx.fillRect(14, 54, 100, 10);
  ctx.strokeStyle = 'rgba(8, 18, 26, 0.5)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 36, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(8, 18, 26, 0.55)';
  ctx.fillRect(60, 64, 8, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft radial glow for floodlights. */
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.25, 'rgba(220, 235, 255, 0.45)');
  gradient.addColorStop(0.6, 'rgba(180, 210, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(160, 200, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A tifo banner canvas, redrawn when the teams change. */
function makeTifoTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, texture };
}

function drawTifo(canvas, texture, primary, secondary, label) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = secondary;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = primary;
  ctx.fillRect(0, h * 0.1, w, h * 0.8);
  // Diagonal supporter scarves.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let x = -h; x < w + h; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 52, 0);
    ctx.lineTo(x + 52 - h, h);
    ctx.lineTo(x - h, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 10, w, 10);
  ctx.font = '900 116px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.strokeText(label, w / 2, h / 2 + 4);
  ctx.fillStyle = '#f7fbff';
  ctx.fillText(label, w / 2, h / 2 + 4);
  texture.needsUpdate = true;
}

/** Patch a material's vertex shader with a small time-driven displacement. */
function patchVertex(material, key, uniforms, header, body) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${header}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/** Crowd shader: per-instance bob/jump plus an energy tint. */
function patchCrowdMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPhase;
        uniform float uTime;
        uniform float uEnergy;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float phase = aPhase * 6.2831853;
        float bob = sin(uTime * 2.2 + phase);
        float jump = max(0.0, sin(uTime * 4.4 - phase * 1.7));
        vec3 instPos = instanceMatrix[3].xyz;
        float travel = max(0.0, sin(uTime * 2.0 - (instPos.x + instPos.z) * 0.075));
        transformed.y += bob * (0.025 + 0.035 * uEnergy)
          + jump * uEnergy * 0.1
          + travel * uEnergy * 0.13;
        transformed.x += sin(uTime * 1.35 + phase * 1.6) * (0.012 + 0.026 * uEnergy);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEnergy;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 + 0.32 * uEnergy;`);
  };
  material.customProgramCacheKey = () => 'crowd-wave';
  return material;
}

/** Soft vertical gradient used as the night sky dome. */
function makeSkyTexture() {  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#04070a');
  gradient.addColorStop(0.55, '#081420');
  gradient.addColorStop(0.82, '#0d2130');
  gradient.addColorStop(1, '#122b24');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addGoals(group, netMaterial) {
  const goalMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f8fa, roughness: 0.35, metalness: 0.1,
  });
  const postGeometry = new THREE.CylinderGeometry(0.07, 0.07, GOAL_HEIGHT, 10);
  const barGeometry = new THREE.CylinderGeometry(0.07, 0.07, GOAL_HALF_WIDTH * 2 + 0.14, 10);
  const netBack = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT, 20, 10);
  const netTop = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, 1.9, 20, 3);

  for (const dir of [-1, 1]) {
    const goal = new THREE.Group();
    goal.position.x = dir * (PITCH_W / 2);

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, goalMaterial);
      post.position.set(0, GOAL_HEIGHT / 2, side * GOAL_HALF_WIDTH);
      post.castShadow = true;
      goal.add(post);
    }
    const bar = new THREE.Mesh(barGeometry, goalMaterial);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, GOAL_HEIGHT, 0);
    bar.castShadow = true;
    goal.add(bar);

    const back = new THREE.Mesh(netBack, netMaterial);
    back.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    back.position.set(dir * 1.9, GOAL_HEIGHT / 2, 0);
    goal.add(back);

    const top = new THREE.Mesh(netTop, netMaterial);
    top.rotation.x = -Math.PI / 2;
    top.position.set(dir * 0.95, GOAL_HEIGHT, 0);
    goal.add(top);

    group.add(goal);
  }
}

function addLedBoards(group, texture) {
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const backing = new THREE.MeshStandardMaterial({ color: 0x0a1210, roughness: 0.9 });

  const longGeo = new THREE.PlaneGeometry(104, 1.1);
  const longBackGeo = new THREE.BoxGeometry(104, 1.1, 0.16);
  for (const dir of [-1, 1]) {
    const board = new THREE.Mesh(longGeo, material);
    board.position.set(0, 0.55, dir * 35.3);
    board.rotation.y = dir > 0 ? Math.PI : 0;
    group.add(board);
    const back = new THREE.Mesh(longBackGeo, backing);
    back.position.set(0, 0.55, dir * 35.42);
    group.add(back);
  }

  const endGeo = new THREE.PlaneGeometry(66, 1.1);
  const endBackGeo = new THREE.BoxGeometry(0.16, 1.1, 66);
  for (const dir of [-1, 1]) {
    const board = new THREE.Mesh(endGeo, material);
    board.position.set(dir * 53.5, 0.55, 0);
    board.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(board);
    const back = new THREE.Mesh(endBackGeo, backing);
    back.position.set(dir * 53.62, 0.55, 0);
    group.add(back);
  }
  return material;
}

function addStands(group) {
  const seatMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b4f5c,
    roughness: 0.86,
    metalness: 0.04,
    emissive: 0x09131a,
    emissiveIntensity: 1,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2a33, roughness: 0.95 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x141c22, roughness: 0.8, metalness: 0.15 });
  const trimMaterial = new THREE.MeshBasicMaterial({ color: 0x5fe3a1, toneMapped: false });

  const sides = [
    { axis: 'x', sign: -1, length: 138 },
    { axis: 'x', sign: 1, length: 138 },
    { axis: 'z', sign: -1, length: 96 },
    { axis: 'z', sign: 1, length: 96 },
  ];

  for (const side of sides) {
    const along = side.axis === 'x';
    const tierDepth = 5.2;
    const tierRise = 3.1;
    const inner = (along ? 38.4 : 58.5);

    for (let tier = 0; tier < 3; tier++) {
      const width = 3.2;
      const height = 3.4;
      const geometry = along
        ? new THREE.BoxGeometry(side.length, height, width)
        : new THREE.BoxGeometry(width, height, side.length);
      const mesh = new THREE.Mesh(geometry, seatMaterial);
      const offset = side.sign * (inner + tier * tierDepth);
      mesh.position.set(
        along ? 0 : offset,
        1.7 + tier * tierRise,
        along ? offset : 0,
      );
      group.add(mesh);

      // A thin lit lip on the front of each tier reads as an aisle light.
      const lipGeo = along
        ? new THREE.BoxGeometry(side.length, 0.07, 0.16)
        : new THREE.BoxGeometry(0.16, 0.07, side.length);
      const lip = new THREE.Mesh(lipGeo, trimMaterial);
      lip.position.set(
        along ? 0 : side.sign * (inner + tier * tierDepth - width / 2 + 0.1),
        1.7 + tier * tierRise + height / 2 + 0.02,
        along ? side.sign * (inner + tier * tierDepth - width / 2 + 0.1) : 0,
      );
      group.add(lip);
    }

    // Back wall + roof.
    const wallDistance = inner + 2 * tierDepth + 3.4;
    const wallGeo = along
      ? new THREE.BoxGeometry(side.length + 8, 12, 0.8)
      : new THREE.BoxGeometry(0.8, 12, side.length + 8);
    const wall = new THREE.Mesh(wallGeo, wallMaterial);
    wall.position.set(
      along ? 0 : side.sign * wallDistance,
      6,
      along ? side.sign * wallDistance : 0,
    );
    group.add(wall);

    const roofGeo = along
      ? new THREE.BoxGeometry(side.length + 16, 0.5, 17)
      : new THREE.BoxGeometry(17, 0.5, side.length + 16);
    const roof = new THREE.Mesh(roofGeo, roofMaterial);
    roof.position.set(
      along ? 0 : side.sign * (inner + 8),
      13.4,
      along ? side.sign * (inner + 8) : 0,
    );
    group.add(roof);

    // Roof supports at both ends of the side.
    for (const end of [-1, 1]) {
      const support = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.3, 13.4, 8),
        roofMaterial,
      );
      support.position.set(
        along ? end * (side.length / 2 + 4) : side.sign * (inner + 13),
        6.7,
        along ? side.sign * (inner + 13) : end * (side.length / 2 + 4),
      );
      group.add(support);
    }
  }
}

function addFloodlights(group) {
  const mastMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4d58, roughness: 0.7 });
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xe8f6ff, toneMapped: false });
  const glowMaterial = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 22, 8), mastMaterial);
      mast.position.set(sx * 82, 11, sz * 56);
      group.add(mast);

      const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 0.4), lampMaterial);
      panel.position.set(sx * 82, 22.4, sz * 56);
      panel.lookAt(0, 0, 0);
      group.add(panel);

      const glow = new THREE.Sprite(glowMaterial);
      glow.position.set(sx * 82, 22.4, sz * 56);
      glow.scale.set(22, 22, 1);
      group.add(glow);
    }
  }
}

function makeCrowdPlacements() {
  const rand = mulberry32(0x474556);
  const extras = ['#8b949e', '#c9d1d9', '#3fd07c', '#1f4f7a', '#14202b', '#ffd166'];
  const placements = [];
  const sides = [
    { axis: 'x', sign: -1, length: 132 },
    { axis: 'x', sign: 1, length: 132 },
    { axis: 'z', sign: -1, length: 90 },
    { axis: 'z', sign: 1, length: 90 },
  ];

  for (const side of sides) {
    const along = side.axis === 'x';
    const inner = along ? 38.4 : 58.5;
    for (let tier = 0; tier < 3; tier++) {
      const topY = 1.7 + tier * 3.1 + 1.7;
      const baseOffset = inner + tier * 5.2;
      const columns = Math.floor(side.length / 0.66);
      for (let row = 0; row < 2; row++) {
        const offset = side.sign * (baseOffset + row * 1.7);
        for (let c = 0; c < columns; c++) {
          const alongPos = -side.length / 2 + c * 0.66 + 0.3 + (rand() - 0.5) * 0.18;
          const facing = along
            ? (side.sign > 0 ? Math.PI : 0)
            : (side.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
          const roll = rand();
          placements.push({
            x: along ? alongPos : offset,
            y: topY + 0.31 + rand() * 0.05,
            z: along ? offset : alongPos,
            ry: facing + (rand() - 0.5) * 0.28,
            scale: 0.86 + rand() * 0.28,
            kind: roll < 0.46 ? 'home' : roll < 0.72 ? 'away' : roll < 0.82 ? 'neutral' : 'extra',
            extra: extras[Math.floor(rand() * extras.length)],
            phase: rand(),
          });
        }
      }
    }
  }
  return placements;
}

/** Paint one instanced crowd layer in the current team colours. */
function paintCrowdLayer(mesh, placements, homeColor, awayColor) {
  const color = new THREE.Color();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const hex = p.kind === 'home' ? homeColor
      : p.kind === 'away' ? awayColor
        : p.kind === 'neutral' ? NEUTRAL_COLOR : p.extra;
    color.set(hex);
    // setColorAt lazily allocates instanceColor on first use.
    mesh.setColorAt(i, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function fillCrowdInstances(mesh, placements, yOff = 0) {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    dummy.position.set(p.x, p.y + yOff * p.scale, p.z);
    dummy.rotation.set(0, p.ry, 0);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function phasedGeometry(width, height, placements) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const phases = new Float32Array(placements.length);
  for (let i = 0; i < phases.length; i++) phases[i] = placements[i].phase;
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  return geometry;
}

/** Head-and-nod layer: heads bob and nod on their own phase, above the body. */
function addCrowdHeads(group, uniforms, placements) {
  const material = patchVertex(new THREE.MeshBasicMaterial({
    map: makeHeadSprite(),
    side: THREE.DoubleSide,
    alphaTest: 0.42,
    toneMapped: false,
  }), 'crowd-heads', uniforms,
  'attribute float aPhase;\nuniform float uTime;\nuniform float uEnergy;',
  `float hp = aPhase * 6.2831853;
   float nod = sin(uTime * 3.1 + hp * 2.0);
   float jump = max(0.0, sin(uTime * 4.4 - hp * 1.7));
   transformed.y += sin(uTime * 2.2 + hp) * (0.03 + 0.04 * uEnergy)
     + nod * 0.02 + jump * uEnergy * 0.12;
   transformed.x += sin(uTime * 1.7 + hp * 1.6) * (0.012 + 0.03 * uEnergy);`);
  const heads = new THREE.InstancedMesh(phasedGeometry(0.22, 0.24, placements), material, placements.length);
  heads.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  fillCrowdInstances(heads, placements, 0.33);
  heads.castShadow = false;
  heads.receiveShadow = false;
  group.add(heads);
  return heads;
}

/** Arms-up layer: fans raise their hands in waves, gated by the energy. */
function addCrowdArms(group, uniforms, placements) {
  const material = patchVertex(new THREE.MeshBasicMaterial({
    map: makeArmsSprite(),
    side: THREE.DoubleSide,
    alphaTest: 0.42,
    toneMapped: false,
  }), 'crowd-arms', uniforms,
  'attribute float aPhase;\nuniform float uTime;\nuniform float uEnergy;',
  `float ap = aPhase * 6.2831853;
   float cyc = fract(uTime * 0.08 + aPhase);
   float gate = smoothstep(0.55, 0.75, cyc + uEnergy * 0.35)
     * (1.0 - smoothstep(0.9, 1.0, cyc));
   gate *= smoothstep(0.12, 0.45, uEnergy + 0.25);
   transformed.y = transformed.y * gate;
   transformed.y += sin(uTime * 4.4 - ap * 1.7) * uEnergy * 0.1 * gate;
   transformed.x += sin(uTime * 3.0 + ap) * 0.03 * gate;`);
  const arms = new THREE.InstancedMesh(phasedGeometry(0.42, 0.5, placements), material, placements.length);
  arms.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  fillCrowdInstances(arms, placements, 0.18);
  arms.castShadow = false;
  arms.receiveShadow = false;
  group.add(arms);
  return arms;
}

/** Handheld banners: raised for a few seconds, waved, then lowered again. */
function addCrowdBanners(group, uniforms, placements) {
  const material = patchVertex(new THREE.MeshBasicMaterial({
    map: makeBannerSprite(),
    side: THREE.DoubleSide,
    alphaTest: 0.42,
    toneMapped: false,
  }), 'crowd-banners', uniforms,
  'attribute float aPhase;\nuniform float uTime;\nuniform float uEnergy;',
  `float bp = aPhase * 6.2831853;
   float cyc = fract(uTime * 0.045 + aPhase * 1.7);
   float gate = smoothstep(0.1, 0.25, cyc) * (1.0 - smoothstep(0.42, 0.55, cyc));
   gate *= smoothstep(0.1, 0.4, uEnergy + 0.22);
   transformed.y = transformed.y * gate;
   transformed.x += sin(uTime * 3.4 + bp) * (0.04 + 0.1 * uEnergy) * gate;
   transformed.z += cos(uTime * 2.7 + bp) * 0.03 * gate;`);
  const banners = new THREE.InstancedMesh(phasedGeometry(0.52, 0.4, placements), material, placements.length);
  banners.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  fillCrowdInstances(banners, placements, 0.72);
  banners.castShadow = false;
  banners.receiveShadow = false;
  group.add(banners);
  return banners;
}

function addCrowd(group, uniforms) {
  const placements = makeCrowdPlacements();

  const geometry = phasedGeometry(0.34, 0.62, placements);

  const material = patchCrowdMaterial(new THREE.MeshBasicMaterial({
    map: makeCrowdSprite(),
    side: THREE.DoubleSide,
    alphaTest: 0.42,
    toneMapped: false,
  }), uniforms);

  const crowd = new THREE.InstancedMesh(geometry, material, placements.length);
  crowd.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  fillCrowdInstances(crowd, placements);
  const color = new THREE.Color();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    color.set(p.kind === 'extra' ? p.extra : '#8b949e');
    crowd.setColorAt(i, color);
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.castShadow = false;
  crowd.receiveShadow = false;
  group.add(crowd);

  const heads = addCrowdHeads(group, uniforms, placements);
  const arms = addCrowdArms(group, uniforms, placements);
  const banners = addCrowdBanners(group, uniforms, placements);

  function setTeams(homeColor, awayColor) {
    paintCrowdLayer(crowd, placements, homeColor, awayColor);
    paintCrowdLayer(heads, placements, homeColor, awayColor);
    paintCrowdLayer(arms, placements, homeColor, awayColor);
    paintCrowdLayer(banners, placements, homeColor, awayColor);
  }
  setTeams(HOME_COLOR, AWAY_COLOR);

  return { mesh: crowd, material, setTeams };
}

/** Animated jumbotron: fixture, score and match clock, redrawn on change. */
function addJumbotron(group) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x0b1016, roughness: 0.6, metalness: 0.3 });

  const state = {
    home: 'HOME', away: 'AWAY', scoreHome: 0, scoreAway: 0, clock: '00:00',
    homeColor: HOME_COLOR, awayColor: AWAY_COLOR,
  };
  let lastDrawn = '';

  function draw() {
    const key = `${state.home}|${state.away}|${state.scoreHome}|${state.scoreAway}|${state.clock}|${state.homeColor}|${state.awayColor}`;
    if (key === lastDrawn) return;
    lastDrawn = key;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, state.homeColor);
    gradient.addColorStop(0.5, '#0d1620');
    gradient.addColorStop(1, state.awayColor);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f6fa';
    ctx.font = '800 64px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${state.home}  ${state.scoreHome} – ${state.scoreAway}  ${state.away}`, w / 2, h / 2 - 28);
    ctx.fillStyle = '#8be9b0';
    ctx.font = '700 56px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(state.clock, w / 2, h / 2 + 52);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.font = '700 30px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('GOD’S EYE VIEW · 3D REPLAY', w / 2, 30);
    texture.needsUpdate = true;
  }

  for (const dir of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(26, 8.4, 0.8), frameMaterial);
    frame.position.set(0, 17.5, dir * 47.5);
    group.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(24.6, 7.2), material);
    screen.position.set(0, 17.5, dir * 47.05);
    screen.rotation.y = dir > 0 ? Math.PI : 0;
    group.add(screen);
  }
  draw();

  return {
    setTeams({ homeName, awayName, homeColor, awayColor, scoreHome, scoreAway }) {
      state.home = String(homeName || 'HOME').toUpperCase().slice(0, 13);
      state.away = String(awayName || 'AWAY').toUpperCase().slice(0, 13);
      state.homeColor = homeColor || HOME_COLOR;
      state.awayColor = awayColor || AWAY_COLOR;
      if (Number.isFinite(scoreHome)) state.scoreHome = scoreHome;
      if (Number.isFinite(scoreAway)) state.scoreAway = scoreAway;
      draw();
    },
    setClock(clock) {
      state.clock = clock;
      draw();
    },
  };
}

/** Star field above the night bowl: one draw call, no per-frame work. */
function addStars(group) {
  const rand = mulberry32(0x57a2);
  const COUNT = 700;
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = rand() * Math.PI * 0.42;
    const r = 225;
    positions[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
    positions[i * 3 + 1] = Math.sin(phi) * r + 8;
    positions[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size: 0.9,
    color: 0xcfe0ff,
    transparent: true,
    opacity: 0.75,
    sizeAttenuation: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  group.add(stars);
}

/** Roof front fascia: an emissive strip that reads as bowl lighting. */
function addRoofFascia(group) {
  const material = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, toneMapped: false });
  const dim = new THREE.MeshStandardMaterial({ color: 0x10161d, roughness: 0.9 });
  const sides = [
    { axis: 'x', sign: -1, length: 138 },
    { axis: 'x', sign: 1, length: 138 },
    { axis: 'z', sign: -1, length: 96 },
    { axis: 'z', sign: 1, length: 96 },
  ];
  for (const side of sides) {
    const along = side.axis === 'x';
    const inner = along ? 38.4 : 58.5;
    const stripGeo = along
      ? new THREE.BoxGeometry(side.length + 16, 0.28, 0.28)
      : new THREE.BoxGeometry(0.28, 0.28, side.length + 16);
    const strip = new THREE.Mesh(stripGeo, material);
    strip.position.set(
      along ? 0 : side.sign * (inner + 8 - 8.5),
      13.1,
      along ? side.sign * (inner + 8 - 8.5) : 0,
    );
    group.add(strip);
    const bandGeo = along
      ? new THREE.BoxGeometry(side.length + 16, 1.1, 0.5)
      : new THREE.BoxGeometry(0.5, 1.1, side.length + 16);
    const band = new THREE.Mesh(bandGeo, dim);
    band.position.set(
      along ? 0 : side.sign * (inner + 8 - 8.5),
      13.75,
      along ? side.sign * (inner + 8 - 8.5) : 0,
    );
    group.add(band);
  }
}

/** Corner flags, dugouts and pitch-side cameras around the apron. */
function addPitchDressing(group) {
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f8fa, roughness: 0.5 });
  const flagMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, toneMapped: false });
  const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6);
  const flagGeo = new THREE.PlaneGeometry(0.4, 0.28);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMaterial);
      pole.position.set(sx * (PITCH_W / 2), 0.75, sz * (PITCH_H / 2));
      group.add(pole);
      const flag = new THREE.Mesh(flagGeo, flagMaterial);
      flag.position.set(sx * (PITCH_W / 2) + 0.2, 1.32, sz * (PITCH_H / 2));
      group.add(flag);
    }
  }

  const dugMaterial = new THREE.MeshStandardMaterial({ color: 0x18222c, roughness: 0.85 });
  const dugRoof = new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 0.7 });
  for (const dir of [-1, 1]) {
    const dug = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 2), dugMaterial);
    dug.position.set(dir * 4, 1.1, 37.6);
    group.add(dug);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.18, 2.6), dugRoof);
    roof.position.set(dir * 4, 2.3, 37.6);
    group.add(roof);
    const tunnel = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 3.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 1 }),
    );
    tunnel.position.set(dir * 14, 1.6, 38.6);
    group.add(tunnel);
  }

  const camBody = new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 0.6 });
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6);
  const headGeo = new THREE.BoxGeometry(0.42, 0.26, 0.5);
  for (const [cx, cz, ry] of [[-56, 20, Math.PI / 4], [56, -20, -Math.PI * 0.75], [30, -37.5, Math.PI], [-30, 37.5, 0]]) {
    const legs = new THREE.Mesh(legGeo, camBody);
    legs.position.set(cx, 0.55, cz);
    group.add(legs);
    const head = new THREE.Mesh(headGeo, camBody);
    head.position.set(cx, 1.2, cz);
    head.rotation.y = ry;
    group.add(head);
  }
}

/** Tifo banners around the bowl, redrawn when the teams change. */
function addTifo(group, uniforms) {
  const configs = [
    { pos: [0, 6.6, -41.6], ry: 0, team: 0, w: 30, h: 5 },
    { pos: [0, 6.6, 41.6], ry: Math.PI, team: 1, w: 30, h: 5 },
    { pos: [-61.6, 6.3, 0], ry: Math.PI / 2, team: 0, w: 24, h: 6 },
    { pos: [61.6, 6.3, 0], ry: -Math.PI / 2, team: 1, w: 24, h: 6 },
  ];
  const banners = configs.map((cfg, index) => {
    const ends = makeTifoTexture();
    const material = new THREE.MeshBasicMaterial({
      map: ends.texture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    patchVertex(material, `tifo-wave-${index}`, uniforms,
      'uniform float uTime;\nuniform float uEnergy;',
      `float tw = sin(uTime * 1.5 + position.x * 0.35);
       transformed.z += tw * (0.05 + 0.12 * uEnergy);
       transformed.y += sin(uTime * 1.1 + position.x * 0.2) * 0.03;`);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cfg.w, cfg.h, 24, 8), material);
    mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    mesh.rotation.y = cfg.ry;
    mesh.castShadow = false;
    group.add(mesh);
    return { ...cfg, ...ends };
  });

  return {
    setTeams({ homeColor, awayColor, homeName, awayName }) {
      const homeLabel = String(homeName || 'HOME').toUpperCase().slice(0, 13);
      const awayLabel = String(awayName || 'AWAY').toUpperCase().slice(0, 13);
      for (const banner of banners) {
        const primary = banner.team === 0 ? homeColor : awayColor;
        const label = banner.team === 0 ? homeLabel : awayLabel;
        drawTifo(banner.canvas, banner.texture, primary, '#0b1820', label);
      }
    },
  };
}

/** Scarves and flags around the bowl: one instanced draw call, shader-waved. */
function addFlags(group, uniforms) {
  const rand = mulberry32(0x5ca7f1a9);
  const placements = [];
  const sides = [
    { axis: 'x', sign: -1, length: 132 },
    { axis: 'x', sign: 1, length: 132 },
    { axis: 'z', sign: -1, length: 90 },
    { axis: 'z', sign: 1, length: 90 },
  ];
  for (const side of sides) {
    const along = side.axis === 'x';
    const inner = along ? 38.4 : 58.5;
    for (let tier = 0; tier < 3; tier++) {
      const count = along ? 18 : 12;
      for (let i = 0; i < count; i++) {
        const alongPos = -side.length / 2 + (i + 0.5 + (rand() - 0.5) * 0.5) * (side.length / count);
        const offset = side.sign * (inner + tier * 5.2 - 1.2);
        const facing = along
          ? (side.sign > 0 ? Math.PI : 0)
          : (side.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
        placements.push({
          x: along ? alongPos : offset,
          y: 1.7 + tier * 3.1 + 2.9 + rand() * 0.5,
          z: along ? offset : alongPos,
          ry: facing + (rand() - 0.5) * 0.5,
          scale: 0.8 + rand() * 0.5,
          phase: rand(),
          kind: rand() < 0.5 ? 'home' : rand() < 0.75 ? 'away' : 'neutral',
        });
      }
    }
  }

  const geometry = new THREE.PlaneGeometry(0.55, 0.82);
  const phases = new Float32Array(placements.length);
  for (let i = 0; i < placements.length; i++) phases[i] = placements[i].phase;
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

  const material = patchVertex(new THREE.MeshBasicMaterial({
    map: makeFlagTexture(),
    side: THREE.DoubleSide,
    toneMapped: false,
  }), 'flag-wave', uniforms,
  'attribute float aPhase;\nuniform float uTime;\nuniform float uEnergy;',
  `float fp = aPhase * 6.2831853;
   transformed.x += sin(uTime * 3.2 + fp) * (0.05 + 0.09 * uEnergy);
   transformed.y += sin(uTime * 2.1 + fp * 1.3) * 0.02;
   transformed.z += cos(uTime * 2.6 + fp) * 0.03;`);

  const flags = new THREE.InstancedMesh(geometry, material, placements.length);
  flags.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry, 0);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    flags.setMatrixAt(i, dummy.matrix);
    color.set(p.kind === 'home' ? HOME_COLOR : p.kind === 'away' ? AWAY_COLOR : NEUTRAL_COLOR);
    flags.setColorAt(i, color);
  }
  flags.instanceMatrix.needsUpdate = true;
  if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
  flags.castShadow = false;
  group.add(flags);

  function setTeams(homeColor, awayColor) {
    if (!flags.instanceColor) return;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      color.set(p.kind === 'home' ? homeColor : p.kind === 'away' ? awayColor : NEUTRAL_COLOR);
      flags.setColorAt(i, color);
    }
    flags.instanceColor.needsUpdate = true;
  }

  return { setTeams };
}

/** Pooled confetti burst behind the goal that was scored in. */
function addConfetti(group) {
  const COUNT = 420;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const velocity = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  const rand = mulberry32(0x1cec0f);
  for (let i = 0; i < COUNT; i++) positions[i * 3 + 1] = -999;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({
    size: 0.3,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  group.add(points);

  let active = 0;

  function burst(dir, teamColor) {
    const palette = [teamColor, '#ffffff', '#ffd166', teamColor];
    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      positions[o] = dir * (50.2 + rand() * 2.8);
      positions[o + 1] = 0.4 + rand() * 3.8;
      positions[o + 2] = (rand() - 0.5) * 8;
      velocity[o] = -dir * (2.0 + rand() * 4.2);
      velocity[o + 1] = 3.5 + rand() * 6.5;
      velocity[o + 2] = (rand() - 0.5) * 3.4;
      const color = new THREE.Color(palette[Math.floor(rand() * palette.length)]);
      colors[o] = color.r;
      colors[o + 1] = color.g;
      colors[o + 2] = color.b;
      life[i] = 2.4 + rand() * 2.2;
    }
    active = COUNT;
    geometry.setDrawRange(0, COUNT);
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.position.needsUpdate = true;
  }

  function update(dt) {
    if (!active || !(dt > 0)) return;
    let alive = 0;
    for (let i = 0; i < COUNT; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        positions[i * 3 + 1] = -999;
        continue;
      }
      const o = i * 3;
      velocity[o + 1] -= 7.5 * dt;
      const drag = Math.exp(-dt * 0.9);
      velocity[o] *= drag;
      velocity[o + 2] *= drag;
      positions[o] += velocity[o] * dt;
      positions[o + 1] += velocity[o + 1] * dt;
      positions[o + 2] += velocity[o + 2] * dt;
      alive++;
    }
    active = alive;
    if (!active) {
      geometry.setDrawRange(0, 0);
      points.visible = false;
    } else {
      points.visible = true;
    }
    geometry.attributes.position.needsUpdate = true;
  }

  return { burst, update };
}

function freezeMatrices(group) {
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    child.matrixAutoUpdate = false;
    child.updateMatrix();
  });
}

/**
 * Build the whole stadium and return its group. `renderer` is only used for
 * the pitch texture's anisotropy limit.
 */
export function buildStadium(renderer) {
  const group = new THREE.Group();
  group.name = 'stadium';
  const uniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uImpulse: { value: 0 },
  };

  // Sky dome.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 24, 12),
    new THREE.MeshBasicMaterial({
      map: makeSkyTexture(), side: THREE.BackSide, toneMapped: false, fog: false,
    }),
  );
  sky.rotation.y = Math.PI / 2;
  group.add(sky);

  // Ground apron + outer dark plane.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 150),
    new THREE.MeshStandardMaterial({ color: 0x1a3322, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  group.add(apron);

  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(480, 360),
    new THREE.MeshStandardMaterial({ color: 0x060b08, roughness: 1 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.05;
  group.add(outer);

  // Pitch.
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_W, PITCH_H),
    new THREE.MeshStandardMaterial({
      map: makePitchTexture(renderer),
      roughness: 0.94,
      metalness: 0,
    }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  group.add(pitch);

  const led = addLedBoards(group, makeLedTexture());
  const netMaterial = new THREE.MeshBasicMaterial({
    map: makeNetTexture(),
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  patchVertex(netMaterial, 'net-ripple', uniforms,
    'uniform float uTime;\nuniform float uImpulse;',
    `float sway = sin(uTime * 1.7 + position.y * 2.6 + position.x * 0.7) * 0.008;
     float ripple = sin(uTime * 18.0 + position.y * 7.0 + position.x * 2.5) * uImpulse * 0.12;
     transformed.z += sway + ripple;`);
  addGoals(group, netMaterial);
  addStands(group);
  addRoofFascia(group);
  addPitchDressing(group);
  addFloodlights(group);
  addStars(group);
  const crowd = addCrowd(group, uniforms);
  const tifo = addTifo(group, uniforms);
  const flags = addFlags(group, uniforms);
  const jumbotron = addJumbotron(group);
  const confetti = addConfetti(group);
  freezeMatrices(group);

  let homeColor = HOME_COLOR;
  let awayColor = AWAY_COLOR;
  let lastTime = -1;

  function update(dt, energy = 0, impulse = 0, time = 0) {
    const t = Number.isFinite(time) ? time : lastTime + (dt || 0);
    lastTime = t;
    uniforms.uTime.value = t;
    uniforms.uEnergy.value = Math.max(0, Math.min(1, energy || 0));
    uniforms.uImpulse.value = Math.max(0, Math.min(1, impulse || 0));
    const glow = Math.max(0.7, 1 + (energy || 0) * 0.38 + Math.sin(t * 4.6) * 0.04);
    led.color.setScalar(glow);
    confetti.update(dt);
  }

  function setTeams(meta = {}) {
    homeColor = meta.homeColor || HOME_COLOR;
    awayColor = meta.awayColor || AWAY_COLOR;
    crowd.setTeams(homeColor, awayColor);
    flags.setTeams(homeColor, awayColor);
    tifo.setTeams({
      homeColor,
      awayColor,
      homeName: meta.homeName || 'HOME',
      awayName: meta.awayName || 'AWAY',
    });
    jumbotron.setTeams({
      homeName: meta.homeName || 'HOME',
      awayName: meta.awayName || 'AWAY',
      homeColor,
      awayColor,
      scoreHome: meta.scoreHome,
      scoreAway: meta.scoreAway,
    });
  }

  function setClock(clock) {
    jumbotron.setClock(clock);
  }

  function celebrate(event) {
    const away = event && event.team === 1;
    const dir = away ? -1 : 1;
    confetti.burst(dir, away ? awayColor : homeColor);
  }

  return { group, pitch, update, setTeams, setClock, celebrate };
}
