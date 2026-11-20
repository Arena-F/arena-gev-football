// Broadcast shot director for the 3D replay.
//
// The clip is 30 s long and the event sits in the middle. Auto mode moves
// through high broadcast positions — a top-of-stadium wide, a high broadcast
// follow, an elevated close-up and a behind-goal net cam — with smooth
// eased transitions between shots instead of hard cuts. Manual chips override
// the director; scrubbing and reduced-motion snap.

import * as THREE from '../vendor/three/three.module.min.js';
import { STRIDE } from './clipStore.js';

const SHOT_NAMES = new Set(['broadcast', 'wide', 'follow', 'close', 'goal', 'tactical']);

// Transition between shots: long enough to read as a directed move, short
// enough to keep up with a 30 s replay.
const TRANSITION_SECS = 1.1;

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function smootherstep(u) {
  const t = Math.max(0, Math.min(1, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createDirector() {
  let shotName = '';
  let fov = 40;
  const look = new THREE.Vector3(0, 0.8, 0);
  const desiredPos = new THREE.Vector3(0, 27.5, 35.2);
  const desiredLook = new THREE.Vector3(0, 0.8, 0);
  // Transition state: blend from the shot we are leaving to the new one.
  const fromPos = new THREE.Vector3();
  const fromLook = new THREE.Vector3();
  let fromFov = 40;
  let transT = 1;

  function autoShot(clip, timeRel) {
    const duration = Math.max(0.001, clip.endT - clip.startT);
    const p = Math.max(0, Math.min(1, timeRel / duration));
    const type = clip.event ? clip.event.type : -1;
    const isShot = type === 13 || type === 14 || type === 15 || type === 16;
    if (p < 0.12) return 'wide';
    if (p < 0.4) return 'broadcast';
    if (p < 0.58) return 'close';
    if (p < 0.78) return isShot ? 'goal' : 'follow';
    return 'broadcast';
  }

  /**
   * Compute the desired camera for a named shot from the sampled frame.
   * World mapping: x = engine x, y = altitude, z = -engine y.
   * All positions sit on the broadcast side, above the roof line of the near
   * stand, so the camera never clips through the bowl.
   */
  function computeShot(name, data, clip) {
    const offset = data.length - STRIDE;
    const bx = data[offset];
    const by = data[offset + 1];
    const bz = data[offset + 2];
    const ballX = bx;
    const ballZ = -by;
    const dir = clip && clip.event && clip.event.team === 1 ? -1 : 1;

    switch (name) {
      case 'wide': {
        // Top-of-stadium opening: the whole pitch reads at a glance.
        desiredPos.set(ballX * 0.15, 30, 34.6);
        desiredLook.set(ballX * 0.5, 0.7, ballZ * 0.4);
        fov = 48;
        break;
      }
      case 'follow': {
        // High side camera outside the near touchline, tracking the play.
        desiredPos.set(ballX - dir * 6, 23, 34.8);
        desiredLook.set(ballX + dir * 4, 0.8, ballZ);
        fov = 36;
        break;
      }
      case 'close': {
        // Elevated three-quarter behind the ball. Stays on the pitch side of
        // the near touchline and inside the goal lines.
        desiredPos.set(
          Math.max(-51.5, Math.min(51.5, ballX - dir * 4.5)),
          13.5,
          Math.max(-33.5, Math.min(33.5, ballZ + 5.5)),
        );
        desiredLook.set(ballX + dir * 2.5, 0.9, ballZ);
        fov = 30;
        break;
      }
      case 'goal': {
        // Behind the goal, above the crossbar, looking through the net.
        desiredPos.set(dir * 56, 16, Math.max(-5, Math.min(5, ballZ * 0.4)));
        desiredLook.set(ballX, 1, ballZ);
        fov = 32;
        break;
      }
      case 'tactical': {
        // High analysis angle: both shapes and the ball in one frame.
        desiredPos.set(0, 52, 18);
        desiredLook.set(0, 0, 0);
        fov = 42;
        break;
      }
      case 'broadcast':
      default: {
        // Main broadcast line: high touchline camera, gently trucking.
        desiredPos.set(ballX * 0.2, 27.5, 35.2);
        desiredLook.set(ballX * 0.65, 0.8, ballZ);
        fov = 40;
        break;
      }
    }
  }

  function update(camera, dt, { clip, data, timeRel, mode = 'auto', reducedMotion = false, energy = 0 } = {}) {
    if (!clip || !data) return;
    const name = reducedMotion
      ? 'wide'
      : (mode === 'auto' ? autoShot(clip, timeRel) : (SHOT_NAMES.has(mode) ? mode : 'broadcast'));

    computeShot(name, data, clip);
    const cut = name !== shotName;
    if (cut) {
      fromPos.copy(camera.position);
      fromLook.copy(look);
      fromFov = camera.fov;
      transT = 0;
    }
    shotName = name;

    if (cut && (reducedMotion || dt <= 0)) {
      // Scrubbing and reduced-motion snap; everything else glides.
      camera.position.copy(desiredPos);
      look.copy(desiredLook);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      transT = 1;
    } else if (transT < 1 && dt > 0) {
      transT = Math.min(1, transT + dt / TRANSITION_SECS);
      const u = smootherstep(transT);
      // Big moves fly over the bowl instead of through it.
      const dist = fromPos.distanceTo(desiredPos);
      const lift = dist > 15 ? Math.sin(Math.PI * u) * 7 : 0;
      camera.position.lerpVectors(fromPos, desiredPos, u);
      camera.position.y += lift;
      look.lerpVectors(fromLook, desiredLook, u);
      const nextFov = fromFov + (fov - fromFov) * u;
      if (Math.abs(nextFov - camera.fov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    } else {
      const lambda = mode === 'auto' ? 5 : 6;
      camera.position.x = damp(camera.position.x, desiredPos.x, lambda, dt);
      camera.position.y = damp(camera.position.y, desiredPos.y, lambda, dt);
      camera.position.z = damp(camera.position.z, desiredPos.z, lambda, dt);
      look.x = damp(look.x, desiredLook.x, 4, dt);
      look.y = damp(look.y, desiredLook.y, 4, dt);
      look.z = damp(look.z, desiredLook.z, 4, dt);
      const nextFov = damp(camera.fov, fov, 6, dt);
      if (Math.abs(nextFov - camera.fov) > 0.01) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    }
    // A beaten net ripples the frame: tiny goal shake, scaled by the
    // stadium energy so it decays with the roar. Deterministic in replay
    // time, so scrubbing lands on the same frame.
    if (shotName === 'goal' && energy > 0.3 && dt > 0) {
      const shake = (energy - 0.3) * 0.35;
      look.x += Math.sin(timeRel * 47) * shake * 0.4;
      look.y += Math.sin(timeRel * 39 + 1.3) * shake * 0.25;
    }
    camera.lookAt(look);
  }

  function reset() {
    shotName = '';
    fov = 40;
    transT = 1;
  }

  return {
    update,
    reset,
    get shot() { return shotName; },
  };
}
