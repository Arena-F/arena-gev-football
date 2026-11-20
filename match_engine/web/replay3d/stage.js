// three.js stage for the 3D replay theatre.
//
// Imported lazily by replay3d.js the first time the viewer opens a replay, so
// the live GEV page never pays for three.js unless the experiment is used.

import * as THREE from '../vendor/three/three.module.min.js';
import { sampleClipInto, STRIDE } from './clipStore.js';
import { buildStadium } from './stadium.js';
import { createPlayerPool } from './players.js';
import { createDirector } from './director.js';
import { createAtmosphere } from './atmosphere.js';
import { createAnalysis3D } from './analysis3d.js';
import { formatClock } from '../dribbles.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';

const CENTER = new THREE.Vector3(0, 0, 0);

// Broadcast colour grade: cool shadows, warm highlights, vignette and a
// whisper of animated grain. Runs as a ShaderPass just before OutputPass.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.3 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 cool = vec3(0.94, 1.0, 1.06);
      vec3 warm = vec3(1.05, 1.0, 0.94);
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb *= mix(cool, vec3(1.0), smoothstep(0.0, 0.45, lum));
      c.rgb *= mix(vec3(1.0), warm, smoothstep(0.55, 1.0, lum));
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d) * 1.6);
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 7.13) - 0.5;
      c.rgb += g * uGrain * (0.4 + 0.6 * (1.0 - lum));
      gl_FragColor = c;
    }
  `,
};

function disposeObject(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

function makeBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101418';
  const spots = [
    [32, 30], [96, 18], [158, 36], [222, 24],
    [64, 92], [128, 78], [192, 104], [246, 86], [8, 82],
  ];
  for (const [cx, cy] of spots) {
    ctx.beginPath();
    const radius = 15;
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export async function createStage(canvas, { width = 960, height = 540, reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060b09);
  scene.fog = new THREE.Fog(0x07110c, 95, 270);

  const camera = new THREE.PerspectiveCamera(44, width / height, 0.4, 620);
  camera.position.set(0, 18, 36);
  camera.lookAt(CENTER);

  // ── Post pipeline: render → bloom → grade → output ────────────
  // High = bloom + grade, medium = grade only, low = direct render.
  // Anything that throws falls back to the direct renderer, so the replay
  // never fails because of post FX.
  let composer = null;
  let bloomPass = null;
  let gradePass = null;
  let fxTier = 'high';
  let composerFailed = false;

  function buildComposer(w, h) {
    const size = new THREE.Vector2(Math.max(2, w), Math.max(2, h));
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(size.clone(), 0.55, 0.45, 0.82);
    composer.addPass(bloomPass);
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
    composer.addPass(new OutputPass());
    applyFxTier();
  }

  function applyFxTier() {
    if (!composer || !bloomPass) return;
    bloomPass.enabled = fxTier === 'high';
  }

  function useComposer() {
    return fxTier !== 'low' && composer && !composerFailed;
  }

  function setQuality(tier) {
    fxTier = tier === 'medium' || tier === 'low' ? tier : 'high';
    applyFxTier();
  }

  // ── Lighting ─────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x16281a, 1.1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.45);
  key.position.set(42, 74, 26);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -78;
  key.shadow.camera.right = 78;
  key.shadow.camera.top = 62;
  key.shadow.camera.bottom = -62;
  key.shadow.camera.near = 12;
  key.shadow.camera.far = 220;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbfe0ff, 0.45);
  fill.position.set(0, 34, 80);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0x24323c, 0.34));

  // ── Stadium ──────────────────────────────────────────────────
  const stadium = buildStadium(renderer);
  scene.add(stadium.group);
  const atmosphere = createAtmosphere();
  let clockTime = 0;
  let prevRel = -1;
  let eventFired = false;

  // ── Players + ball ───────────────────────────────────────────
  const players = createPlayerPool(22);
  scene.add(players.group);

  // ── 3D analysis overlays (ground-projected 2D layers) ─────────────
  const analysis = createAnalysis3D();
  scene.add(analysis.mesh);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 24, 16),
    new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.46, metalness: 0 }),
  );
  ball.castShadow = true;
  scene.add(ball);

  // ── Clip state ───────────────────────────────────────────────
  let clip = null;
  let sampleBuf = new Float32Array(23 * STRIDE);
  const ballTarget = new THREE.Vector3();
  const ballPrev = new THREE.Vector3();
  let ballSpinReady = false;
  const director = createDirector();

  function allocate(count) {
    const needed = count * STRIDE;
    if (sampleBuf.length !== needed) sampleBuf = new Float32Array(needed);
  }

  function setClip(next) {
    clip = next;
    if (clip && clip.frames && clip.frames.length) {
      allocate(clip.frames[0].count);
    }
    ball.position.set(0, 0.12, 0);
    ballSpinReady = false;
    director.reset();
    atmosphere.reset();
    clockTime = 0;
    prevRel = -1;
    eventFired = false;
    if (!clip) return;
    stadium.setTeams(clip.meta || {});
    players.applyClip(clip);
    analysis.setClip(clip);
    // Seat the ball on the first frame so opening a replay never shows a
    // flash from the previous clip; the director snaps on first update.
    const tAbs = clip.startT;
    const data = sampleClipInto(clip, tAbs, sampleBuf);
    if (data) applyBall(data, 0);
  }

  function clearClip() {
    clip = null;
    players.clear();
    analysis.clear();
  }

  function applyBall(data, dt) {
    const offset = data.length - STRIDE;
    const bx = data[offset];
    const by = data[offset + 1];
    const bz = data[offset + 2];
    ballTarget.set(bx, Math.max(0.12, bz + 0.12), -by);
    if (dt <= 0 || ball.position.distanceToSquared(ballTarget) > 25) {
      ball.position.copy(ballTarget);
    } else {
      const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 22);
      ball.position.lerp(ballTarget, k);
    }
    if (ballSpinReady) {
      const dx = ball.position.x - ballPrev.x;
      const dz = ball.position.z - ballPrev.z;
      const radius = 0.12;
      ball.rotation.z -= dx / radius;
      ball.rotation.x += dz / radius;
    }
    ballPrev.copy(ball.position);
    ballSpinReady = true;
  }

  function render(dt, currentClip, timeRel, camMode, fx = null) {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    clockTime += step;
    let summary = null;
    if (currentClip) {
      const event = currentClip.event;
      const rel = event && Number.isFinite(event.t)
        ? event.t - currentClip.startT
        : Infinity;
      if (rel <= timeRel + 1e-3) {
        if (!eventFired && (rel > prevRel || prevRel < 0)) {
          eventFired = true;
          atmosphere.event(event.type, event.notable);
          if (event.type === 16 || event.type === 17) stadium.celebrate(event);
        }
      } else {
        eventFired = false;
      }
      prevRel = timeRel;
      atmosphere.update(step);
      stadium.update(step, atmosphere.energy, atmosphere.impulse, clockTime);
      if (typeof stadium.setClock === 'function') {
        stadium.setClock(formatClock(currentClip.startT + timeRel));
      }

      const tAbs = currentClip.startT + timeRel;
      const data = sampleClipInto(currentClip, tAbs, sampleBuf);
      if (data) {
        applyBall(data, dt);
        players.update(data, tAbs, dt, reducedMotion, currentClip);
        if (fx && !reducedMotion) {
          try { summary = analysis.update(data, tAbs, fx); } catch { /* layers are best-effort */ }
        }
        director.update(camera, dt, {
          clip: currentClip,
          data,
          timeRel,
          mode: camMode,
          reducedMotion,
          energy: atmosphere.energy,
        });
      }
    }
    if (useComposer()) {
      if (gradePass) gradePass.uniforms.uTime.value = reducedMotion ? 0 : clockTime;
      try {
        composer.render();
      } catch {
        composerFailed = true;
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
    return summary;
  }

  function resize(w, h) {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (composer) {
      try { composer.setSize(w, h); } catch { composerFailed = true; }
    }
  }

  // Compile shaders now, while the loading overlay is still up.
  try {
    buildComposer(width, height);
  } catch { composerFailed = true; }
  try {
    await renderer.compileAsync(scene, camera);
  } catch { /* compileAsync is best-effort */ }

  return {
    render,
    setClip,
    clearClip,
    resize,
    dispose() {
      clearClip();
      disposeObject(scene);
      renderer.dispose();
    },
    get info() {
      return renderer.info;
    },
    get camera() {
      return camera;
    },
    get scene() {
      return scene;
    },
    get ball() {
      return ball;
    },
    get players() {
      return players;
    },
    get director() {
      return director;
    },
    get analysis() {
      return analysis;
    },
    get fxTier() {
      return fxTier;
    },
    setQuality,
  };
}
