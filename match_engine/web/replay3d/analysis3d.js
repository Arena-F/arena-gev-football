// 3D analysis overlays projected onto the pitch.
//
// Reuses the exact 2D draw routines (overlays.js, heatmap, dribble layer) on a
// high-resolution ground canvas that is texture-mapped onto the pitch. Same
// maths, same variants, same layer names as the live GEV — only the
// presentation surface is 3D. Match-long context (heat, network, momentum,
// dribbles) comes from the clip meta / analysis log at the event clock;
// live geometry (lanes, channels, vision, offside, shape) is recomputed from
// the sampled clip frames.

import * as THREE from '../vendor/three/three.module.min.js';
import {
  attackLaneState, attackChannels, visionCone, raycastVision, visionBlockers,
  offsideLineVisible, applyRoles, ROLE,
} from '../analysis.js';
import {
  createNetworkFade, drawHeatmap, drawOffsideLine, drawAnalysis, drawAttackLanes,
  drawAttackChannels, drawPassingNetwork, drawVisionField, drawVisionCone,
} from '../overlays.js';
import { drawDribbleLayer } from '../dribbleOverlay.js';
import { createPassingNetwork, createMomentumTracker, rowValue } from '../graphs.js';
import { getVariant } from '../variants.js';
import { STRIDE } from './clipStore.js';

export const GROUND_W = 2048;
export const GROUND_H = 1330;
export const PX_PER_M = GROUND_W / 105;

export function groundToScreen(x, y) {
  return [((x + 52.5) / 105) * GROUND_W, ((34 - y) / 68) * GROUND_H];
}

// Heat snapshots are static per clip. drawHeatmap caches its raster on
// `heat.version`, so each clip needs a version that can never collide with
// the live 2D heat counter (a string): otherwise the 3D theatre would reuse
// a blank or foreign cache image.
let heatSeq = 0;

/**
 * Adapt a snapshotted heat grid for drawHeatmap. The version is unique per
 * call so the shared raster cache always rebuilds for a new clip.
 */
export function makeHeatAdapter(raw, tag = '') {
  if (!raw || !raw.grid) return null;
  return {
    cols: raw.cols,
    rows: raw.rows,
    max: raw.max || 0,
    grid: raw.grid instanceof Float32Array ? raw.grid : Float32Array.from(raw.grid),
    version: `r3d:${++heatSeq}:${tag}`,
  };
}

const TYPE_LABEL = {
  1: 'Pass', 2: 'Offside', 3: 'Take on', 4: 'Foul', 5: 'Out', 6: 'Corner',
  7: 'Tackle', 8: 'Interception', 10: 'Save', 12: 'Clearance', 13: 'Shot',
  14: 'Woodwork', 15: 'Saved', 16: 'Goal', 17: 'Card', 41: 'Punch',
  44: 'Aerial', 45: 'Challenge', 49: 'Recovery', 52: 'Pick-up',
  61: 'Touch', 74: 'Blocked',
};

function labelFor(type) {
  return TYPE_LABEL[type] || `Event ${type}`;
}

export function createAnalysis3D() {
  const canvas = document.createElement('canvas');
  canvas.width = GROUND_W;
  canvas.height = GROUND_H;
  const ctx = canvas.getContext('2d');
  const rect = { x: 0, y: 0, w: GROUND_W, h: GROUND_H };

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(105, 68),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.renderOrder = 2;
  mesh.visible = false;

  let clipRef = null;
  let roles = [];
  let heat = { home: null, away: null };
  let netRef = null;
  let netRoster = [];
  let netMode = '';
  let netSnap = null;
  let netLive = new Map();
  const netFade = createNetworkFade();
  let dribbleStats = null;
  let dribbleTeam = 0;
  let momentum = { home: [], away: [] };
  let eventT = 0;
  let displayTeam = 0;
  let dir = 1;
  let varsityIndex = null;
  let lastError = null;

  function noteError(layer, err) {
    lastError = { layer, message: String((err && err.message) || err).slice(0, 200) };
  }

  // Finite-difference velocity state over clip time (scrub-safe: clamped).
  let prevPos = null;
  let prevVel = null;
  let prevT = NaN;
  let lastDrawnAt = -Infinity;

  function buildPlayers(data, tAbs) {
    const count = Math.max(0, data.length / STRIDE - 1);
    const dt = Number.isFinite(prevT) ? tAbs - prevT : 0;
    const useDt = dt > 1e-4 && dt < 1 ? dt : 0;
    if (!prevPos || prevPos.length !== count * 2) {
      prevPos = new Float32Array(count * 2);
      prevVel = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        prevPos[i * 2] = data[i * STRIDE];
        prevPos[i * 2 + 1] = data[i * STRIDE + 1];
      }
      prevT = tAbs;
    }
    const players = [];
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      const x = data[o];
      const y = data[o + 1];
      let vx = 0;
      let vy = 0;
      let ax = 0;
      let ay = 0;
      if (useDt > 0) {
        vx = (x - prevPos[i * 2]) / useDt;
        vy = (y - prevPos[i * 2 + 1]) / useDt;
        const pvx = prevVel[i * 2];
        const pvy = prevVel[i * 2 + 1];
        ax = Math.max(-12, Math.min(12, (vx - pvx) / useDt));
        ay = Math.max(-12, Math.min(12, (vy - pvy) / useDt));
        vx = Math.max(-12, Math.min(12, vx));
        vy = Math.max(-12, Math.min(12, vy));
      }
      players.push({
        x, y, vx, vy, ax, ay,
        speed: Math.hypot(vx, vy),
        heading: data[o + 3],
        team: data[o + 4],
        shirt: data[o + 5],
        role: roles[i] ?? ROLE.UNKNOWN,
      });
    }
    if (useDt > 0) {
      for (let i = 0; i < count; i++) {
        prevPos[i * 2] = data[i * STRIDE];
        prevPos[i * 2 + 1] = data[i * STRIDE + 1];
        const p = players[i];
        prevVel[i * 2] = p.vx;
        prevVel[i * 2 + 1] = p.vy;
      }
      prevT = tAbs;
    }
    return players;
  }

  function posToRole(pos) {
    if (pos === 1) return 1;
    if (pos === 2) return 2;
    if (pos === 3) return 3;
    if (pos === 4) return 4;
    return 0;
  }

  function buildNetwork(index, team, horizonT) {
    const net = createPassingNetwork();
    if (!index || !Array.isArray(index.events)) return { net, snap: null };
    const passes = index.events
      .filter((e) => (e.ty === 1 || e.ty === 2) && e.mt <= horizonT && (e.team === 0 || e.team === 1))
      .sort((a, b) => a.mt - b.mt || a.t - b.t);
    let prev = null;
    for (const e of passes) {
      const entry = index.playerById ? index.playerById(e.pid) : null;
      const shirt = entry ? entry.shirt : 0;
      const role = entry ? posToRole(entry.pos) : 0;
      const touch = { team: e.team, shirt, x: e.x, y: e.y, role };
      if (prev && prev.team === e.team) {
        net.observePass(prev, touch, e.mt);
      } else if (!prev || prev.team !== e.team) {
        net.observePass(touch, touch, e.mt);
      }
      prev = touch;
    }
    const roster = [];
    if (index.rosterFor) {
      for (const p of index.rosterFor(team)) roster.push({ team, shirt: p.shirt, x: 0, y: 0, role: posToRole(p.pos) });
    }
    const snap = net.snapshot(8, team, roster, getVariant('network') === 'mesh' ? 'mesh' : 'outlet', horizonT);
    return { net, snap };
  }

  function buildMomentum(index, horizonT) {
    const tracker = createMomentumTracker();
    if (!index || !Array.isArray(index.events)) return { home: [], away: [] };
    const rows = [];
    const sorted = index.events
      .filter((e) => e.mt <= horizonT)
      .sort((a, b) => a.mt - b.mt || a.t - b.t);
    for (const e of sorted) {
      const { dv } = rowValue(e.ty, labelFor(e.ty));
      if (!dv) continue;
      rows.push({ t: e.mt, dv, label: labelFor(e.ty), type: e.ty, team: e.team });
    }
    tracker.observe(`r3d:${horizonT.toFixed(1)}`, rows);
    return { home: tracker.home, away: tracker.away };
  }

  function setClip(clip) {
    clipRef = clip;
    roles = [];
    heat = { home: null, away: null };
    netRef = null;
    netRoster = [];
    netFade.reset();
    netMode = '';
    netLive = new Map();
    dribbleStats = null;
    momentum = { home: [], away: [] };
    prevPos = null;
    prevVel = null;
    prevT = NaN;
    lastDrawnAt = -Infinity;
    mesh.visible = false;
    if (!clip) return;
    const meta = clip.meta || {};
    roles = Array.isArray(meta.roles) ? meta.roles.slice() : [];
    eventT = Number.isFinite(clip.event?.t) ? clip.event.t : 0;
    displayTeam = clip.event && (clip.event.team === 0 || clip.event.team === 1) ? clip.event.team : 0;
    dribbleTeam = displayTeam;
    dir = displayTeam === 0 ? 1 : -1;
    varsityIndex = meta.index || null;
    if (meta.heat) {
      for (const side of ['home', 'away']) {
        heat[side] = makeHeatAdapter(meta.heat[side], `${clip.id ?? 0}:${side}`);
      }
    }
    if (varsityIndex) {
      const built = buildNetwork(varsityIndex, displayTeam, eventT);
      netRef = built.net;
      netRoster = (varsityIndex.rosterFor ? varsityIndex.rosterFor(displayTeam) : [])
        .map((p) => ({ team: displayTeam, shirt: p.shirt, x: 0, y: 0, role: posToRole(p.pos) }));
      netMode = getVariant('network') === 'mesh' ? 'mesh' : 'outlet';
      netSnap = built.snap;
      momentum = buildMomentum(varsityIndex, eventT);
      try {
        dribbleStats = varsityIndex.teamStats
          ? varsityIndex.teamStats(displayTeam, { period: 'all', state: 'all', until: eventT })
          : null;
      } catch { dribbleStats = null; }
    }
    ctx.clearRect(0, 0, GROUND_W, GROUND_H);
    texture.needsUpdate = true;
  }

  function update(data, tAbs, effects) {
    if (!clipRef || !data || !effects) return null;
    // 10 Hz redraws; the static heat layer is composited from the snapshot.
    if (tAbs - lastDrawnAt < 0.099 && Number.isFinite(lastDrawnAt)) return null;
    lastDrawnAt = tAbs;
    let players;
    let ball;
    try {
      players = buildPlayers(data, tAbs);
      applyRoles(players, roles);
      const ballSlot = data.length / STRIDE - 1;
      ball = {
        x: data[ballSlot * STRIDE],
        y: data[ballSlot * STRIDE + 1],
        z: data[ballSlot * STRIDE + 2],
      };
    } catch (err) {
      noteError('players', err);
      return null;
    }
    let vis;
    try {
      vis = effects.isVisible.bind(effects);
    } catch (err) {
      noteError('effects', err);
      return null;
    }
    ctx.clearRect(0, 0, GROUND_W, GROUND_H);

    if (vis('heatmap')) {
      const h = heat[displayTeam === 0 ? 'home' : 'away'];
      if (h) {
        try {
          drawHeatmap(ctx, rect, h, displayTeam, 1, getVariant('heatmap'));
        } catch (err) { noteError('heatmap', err); }
      }
    }
    if (vis('dribbles') && dribbleStats) {
      try {
        drawDribbleLayer(ctx, groundToScreen, dribbleStats, dribbleTeam, { alpha: 0.55 });
      } catch (err) { noteError('dribbles', err); }
    }
    if (vis('network') && netSnap) {
      try {
        const mode = getVariant('network') === 'mesh' ? 'mesh' : 'outlet';
        if (netRef && mode !== netMode) {
          netMode = mode;
          netSnap = netRef.snapshot(8, displayTeam, netRoster, mode, eventT);
        }
      } catch (err) { noteError('network-rebuild', err); }
      netLive.clear();
      for (const p of players) netLive.set(`${p.team}:${p.shirt}`, { x: p.x, y: p.y });
      try {
        drawPassingNetwork(ctx, groundToScreen, netSnap, 1, displayTeam, netLive, null, { fade: netFade, dt: 0.1 });
      } catch (err) { noteError('network', err); }
    }
    if (vis('analysis')) {
      try {
        drawAnalysis(ctx, groundToScreen, players, displayTeam, 1, ball, displayTeam,
          { links: false, ringRadius: 16 }, getVariant('analysis'));
      } catch (err) { noteError('analysis', err); }
    }

    const opps = players.filter((p) => p.team !== displayTeam);
    let laneState = null;
    if (vis('passingLanes')) {
      try {
        laneState = attackLaneState(players, ball, displayTeam, dir, opps, null);
        if (laneState && laneState.active) {
          drawAttackLanes(ctx, groundToScreen, laneState.lanes, 1, getVariant('passLanes'), displayTeam, null);
        }
      } catch (err) { noteError('passingLanes', err); }
    }
    if (vis('attackChannels')) {
      try {
        const channels = attackChannels(players, ball, displayTeam, dir, opps);
        if (channels && channels.length) {
          drawAttackChannels(ctx, groundToScreen, channels, 1, getVariant('runChannels'));
        }
      } catch (err) { noteError('attackChannels', err); }
    }
    if (vis('visionCone')) {
      try {
        const carrier = laneState?.carrier
          || players.filter((p) => p.team === displayTeam)
            .sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0]
          || null;
        if (carrier) {
          const mates = players.filter((p) => p !== carrier && p.team === displayTeam);
          const foes = players.filter((p) => p.team !== displayTeam);
          const focus = laneState?.bestPass?.player
            ? { x: laneState.bestPass.player.x, y: laneState.bestPass.player.y }
            : null;
          const cone = visionCone(carrier, mates, foes, dir, focus);
          if (cone) drawVisionCone(ctx, groundToScreen, cone, 1, getVariant('visionCone'));
          const field = raycastVision(carrier, visionBlockers(carrier, mates, foes), dir, focus);
          if (field) drawVisionField(ctx, groundToScreen, field, 1, PX_PER_M, getVariant('visionCone'));
        }
      } catch (err) { noteError('visionCone', err); }
    }
    if (vis('offside')) {
      try {
        const rawX = (() => {
          const defending = players.filter((p) => p.team !== displayTeam && p.role !== ROLE.GK);
          const line = defending.length
            ? defending.sort((a, b) => dir > 0 ? b.x - a.x : a.x - b.x)[1]?.x ?? NaN
            : NaN;
          return line;
        })();
        const verdict = offsideLineVisible({ offsideX: rawX, players, possessionTeam: displayTeam, ball });
        if (verdict.show) {
          drawOffsideLine(ctx, groundToScreen, rawX, 1, 0, GROUND_H);
        }
      } catch (err) { noteError('offside', err); }
    }
    texture.needsUpdate = true;
    mesh.visible = true;
    return { players, ball, laneState };
  }

  function clear() {
    clipRef = null;
    lastError = null;
    mesh.visible = false;
  }

  return {
    mesh,
    texture,
    setClip,
    update,
    clear,
    groundToScreen,
    get clip() { return clipRef; },
    get momentum() { return momentum; },
    get dribbleTeam() { return dribbleTeam; },
    get displayTeam() { return displayTeam; },
    get index() { return varsityIndex; },
    get lastError() { return lastError; },
  };
}
