// 3D highlight replay — UI controller.
//
// Owns the docked card and the theatre overlay only. The three.js stage is
// imported lazily the first time the theatre opens, so the live GEV page pays
// nothing for the experiment unless the viewer asks for it.

import { formatClock } from '../dribbles.js';
import { createEffectController, EFFECTS } from '../effects.js';
import { PRESETS } from '../presets.js';
import { variantsOf, getVariant, setVariant } from '../variants.js';
import { createMinimap } from '../minimap.js';
import { createPlayerPanel } from '../playerPanel.js';

const MAX_UI_CLIPS = 3;
const DEFAULT_SPEED = 0.5;
const THEATRE_FX_LAYERS = [
  'heatmap', 'network', 'offside', 'analysis',
  'passingLanes', 'attackChannels', 'visionCone', 'dribbles',
];
const THEATRE_VARIANT_LAYERS = [
  ['heatmap', 'Heatmap'],
  ['network', 'Network'],
  ['passLanes', 'Pass lanes'],
  ['runChannels', 'Run channels'],
  ['visionCone', 'Vision cone'],
  ['analysis', 'Carrier & shape'],
];
const R3D_PRESET_KEY = 'gev.r3d.preset';

const TYPE_LABEL = {
  1: 'Pass', 2: 'Offside', 3: 'Take on', 4: 'Foul', 5: 'Out', 6: 'Corner',
  7: 'Tackle', 8: 'Interception', 10: 'Save', 12: 'Clearance', 13: 'Shot',
  14: 'Woodwork', 15: 'Saved', 16: 'Goal', 17: 'Card', 41: 'Punch',
  44: 'Aerial', 45: 'Challenge', 49: 'Recovery', 52: 'Pick-up',
  61: 'Touch', 74: 'Blocked',
};

function byId(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function durationOf(clip) {
  return Math.max(0.001, clip.endT - clip.startT);
}

function teamInfo(meta, team) {
  if (team === 0) {
    return { name: (meta && meta.homeName) || 'Home', color: (meta && meta.homeColor) || '#f2f2f2' };
  }
  if (team === 1) {
    return { name: (meta && meta.awayName) || 'Away', color: (meta && meta.awayColor) || '#2f81f7' };
  }
  return { name: 'Match', color: '#ffbe5a' };
}

export function createReplay3D({ recorder = null, getIndex = null } = {}) {
  const els = {
    card: byId('replay3d-card'),
    status: byId('r3d-card-status'),
    open: byId('r3d-card-open'),
    cardEvent: byId('r3d-card-event'),
    cardMeta: byId('r3d-card-meta'),
    cardProgress: byId('r3d-card-progress'),
    theater: byId('replay3d-theater'),
    viewport: byId('r3d-viewport'),
    canvas: byId('r3d-canvas'),
    close: byId('r3d-close'),
    title: byId('r3d-title'),
    score: byId('r3d-score'),
    loading: byId('r3d-loading'),
    loadingSub: byId('r3d-loading-sub'),
    error: byId('r3d-error'),
    errorSub: byId('r3d-error-sub'),
    eventLabel: byId('r3d-event-label'),
    eventClock: byId('r3d-event-clock'),
    eventTeam: byId('r3d-event-team'),
    speedTag: byId('r3d-speed-tag'),
    titleCard: byId('r3d-title-card'),
    tcMain: byId('r3d-tc-main'),
    tcSub: byId('r3d-tc-sub'),
    play: byId('r3d-play'),
    scrub: byId('r3d-scrub'),
    clock: byId('r3d-clock'),
    window: byId('r3d-window'),
    speeds: byId('r3d-speeds'),
    cameras: byId('r3d-cameras'),
    fx: byId('r3d-fx'),
    shuffle: byId('r3d-shuffle'),
    presets: byId('r3d-presets'),
    lab: byId('r3d-lab'),
    readout: byId('r3d-readout'),
    minimap: byId('r3d-minimap'),
    momentum: byId('r3d-momentum'),
    feed: byId('r3d-feed'),
    panelOpen: byId('r3d-panel-open'),
    playerPanel: byId('r3d-player-panel'),
    quality: byId('r3d-quality'),
  };

  const required = [els.card, els.open, els.theater, els.canvas];
  if (!recorder || required.some((el) => !el)) {
    return {
      update() {},
      reset() {},
      open() {},
      close() {},
      get state() { return { available: false }; },
    };
  }

  const reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let clips = [];
  let cardClip = null;
  let theaterClip = null;
  let stage = null;
  let stagePromise = null;
  let stageFailed = false;
  let theaterOpen = false;
  let playing = false;
  let speed = DEFAULT_SPEED;
  let camMode = 'auto';
  let clipTime = 0;
  let rafId = 0;
  let lastTs = 0;
  let lastUiAt = -Infinity;
  let lastClock = '';
  let lastFeedKey = '';
  let lastReadoutAt = -Infinity;
  let titleTimer = null;
  let scrubbing = false;
  let stalled = { id: 0, sim: null, since: 0 };

  // ── 3D analysis UI: effects, presets, lab, minimap, panel ────
  const fx = createEffectController();
  let minimap = null;
  let panel = null;
  let fxQuality = 'high';
  try {
    fxQuality = (typeof localStorage !== 'undefined' && localStorage.getItem('gev.r3d.fx')) || 'high';
  } catch { fxQuality = 'high'; }
  if (!['high', 'medium', 'low'].includes(fxQuality)) fxQuality = 'high';

  function currentIndex() {
    if (typeof getIndex === 'function') {
      try { return getIndex(); } catch { return null; }
    }
    return (theaterClip && theaterClip.meta && theaterClip.meta.index) || null;
  }

  function syncFxUi() {
    if (els.fx) {
      for (const button of Array.from(els.fx.querySelectorAll('[data-fx]'))) {
        button.setAttribute('aria-pressed', String(fx.isVisible(button.dataset.fx)));
      }
    }
    if (els.shuffle) {
      els.shuffle.setAttribute('aria-pressed', String(fx.shuffleActive));
    }
    if (els.presets) {
      for (const b of Array.from(els.presets.querySelectorAll('[data-r3d-preset]'))) {
        b.setAttribute('aria-pressed', String(fxPreset != null && b.dataset.r3dPreset === fxPreset));
      }
    }
    if (els.quality) {
      for (const button of Array.from(els.quality.querySelectorAll('[data-fxq]'))) {
        button.setAttribute('aria-pressed', String(button.dataset.fxq === fxQuality));
      }
    }
  }

  let fxPreset = null;

  function applyFxPreset(name) {
    const set = PRESETS[name];
    if (!set) return;
    fxPreset = name;
    for (const key of THEATRE_FX_LAYERS) {
      fx.setEnabled(key, set.includes(key));
    }
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(R3D_PRESET_KEY, name);
    } catch { /* ignore */ }
    syncFxUi();
    renderOnce();
  }

  function buildLab() {
    if (!els.lab || els.lab.dataset.built) return;
    els.lab.dataset.built = '1';
    for (const [layer, label] of THEATRE_VARIANT_LAYERS) {
      const options = variantsOf(layer);
      if (!options.length) continue;
      const wrap = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = label;
      const select = document.createElement('select');
      select.dataset.layer = layer;
      select.setAttribute('aria-label', `${label} style`);
      for (const opt of options) {
        const node = document.createElement('option');
        node.value = opt.id;
        node.textContent = opt.label;
        if (opt.id === getVariant(layer)) node.selected = true;
        select.append(node);
      }
      select.addEventListener('change', () => {
        setVariant(layer, select.value);
        renderOnce();
      });
      wrap.append(name, select);
      els.lab.append(wrap);
    }
  }

  function feedEvents() {
    const index = currentIndex();
    if (!theaterClip || !index || !Array.isArray(index.events)) return [];
    return index.events
      .filter((e) => e.mt >= theaterClip.startT - 0.5 && e.mt <= theaterClip.endT + 0.5)
      .sort((a, b) => a.mt - b.mt || a.t - b.t);
  }

  function syncFeedUi() {
    if (!els.feed || !theaterClip) return;
    const tAbs = theaterClip.startT + clipTime;
    const key = `${Math.round(tAbs * 2)}`;
    if (key === lastFeedKey) return;
    lastFeedKey = key;
    const rows = feedEvents().slice(-8);
    els.feed.innerHTML = rows.map((e) => {
      const now = Math.abs(e.mt - tAbs) < 1.0;
      const team = e.team === 0 ? 'home' : e.team === 1 ? 'away' : '';
      return `<div class="row ${team} ${now ? 'is-now' : ''}">` +
        `<span class="t">${formatClock(e.mt)}</span><span class="lbl">${labelFor(e.ty)}</span></div>`;
    }).join('');
  }

  function labelFor(type) {
    return TYPE_LABEL[type] || `Event ${type}`;
  }

  function drawMomentumStrip() {
    if (!els.momentum || !stage || typeof stage.analysis === 'undefined' || !stage.analysis) return;
    const ctx = els.momentum.getContext('2d');
    if (!ctx) return;
    const W = els.momentum.width;
    const H = els.momentum.height;
    const { home, away } = stage.analysis.momentum || { home: [], away: [] };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);
    const all = home.concat(away);
    if (!all.length) {
      ctx.fillStyle = '#6e7681';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('No threat yet in this window', 12, H / 2 + 4);
      return;
    }
    let max = 0.01;
    for (const p of all) max = Math.max(max, p.v);
    const t0 = theaterClip ? theaterClip.startT : 0;
    const t1 = theaterClip ? theaterClip.endT : 1;
    const X = (t) => 8 + ((t - t0) / Math.max(1e-6, t1 - t0)) * (W - 16);
    const Y = (v) => H - 8 - (v / max) * (H - 20);
    for (const [series, color] of [[home, '#f2f2f2'], [away, '#2f81f7']]) {
      if (!series.length) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(X(Math.max(t0, series[0].t)), Y(0));
      for (const p of series) ctx.lineTo(X(p.t), Y(p.v));
      ctx.stroke();
    }
    if (theaterClip) {
      const cx = X(Math.max(t0, Math.min(t1, theaterClip.startT + clipTime)));
      ctx.strokeStyle = 'rgba(255, 190, 90, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.lineTo(cx, H - 4);
      ctx.stroke();
    }
  }

  function syncReadoutUi(summary) {
    if (!els.readout) return;
    const now = nowMs();
    if (now - lastReadoutAt < 250 && summary) return;
    lastReadoutAt = now;
    if (!summary || !summary.laneState || !summary.laneState.carrier) {
      if (!summary) return;
      els.readout.innerHTML = summary.laneState && !summary.laneState.active
        ? 'Ball in flight · lanes held'
        : 'Neutral phase · analysis on hold';
      return;
    }
    const carrier = summary.laneState.carrier;
    const best = summary.laneState.bestPass;
    const parts = [`<strong>#${carrier.shirt}</strong> on ball`];
    if (best && best.player && Number.isFinite(best.player.shirt)) {
      parts.push(`best <strong>#${best.player.shirt}</strong> ${Math.round((best.p ?? 0) * 100)}%`);
    }
    els.readout.innerHTML = parts.join(' · ');
  }

  function buildMinimapFeed() {
    if (!minimap || !theaterClip) return;
    const data = minimap.data;
    if (!data) return;
    data.shots.home.length = 0;
    data.shots.away.length = 0;
    data.passes.home.length = 0;
    data.passes.away.length = 0;
    data.attacks.home.length = 0;
    data.attacks.away.length = 0;
    data.tackles.home.length = 0;
    data.tackles.away.length = 0;
    data.recoveries.home.length = 0;
    data.recoveries.away.length = 0;
    data.progressive.home.length = 0;
    data.progressive.away.length = 0;
    data.setPieces.length = 0;
    data.playerHeat = null;
    data.chosenPlayerShirt = null;
    const metaHeat = (theaterClip.meta && theaterClip.meta.heat) || null;
    data.heat.home = metaHeat && metaHeat.home ? metaHeat.home : null;
    data.heat.away = metaHeat && metaHeat.away ? metaHeat.away : null;
    const index = currentIndex();
    if (!index || !Array.isArray(index.events)) return;
    const horizon = Number.isFinite(theaterClip.event.t) ? theaterClip.event.t : Infinity;
    for (const e of index.events) {
      if (!Number.isFinite(e.mt) || e.mt > horizon) continue;
      if (e.team !== 0 && e.team !== 1) continue;
      const side = e.team === 0 ? 'home' : 'away';
      const pt = { x: e.x, y: e.y };
      if (e.ty >= 13 && e.ty <= 16) data.shots[side].push({ ...pt, targetY: 0 });
      else if (e.ty === 1 || e.ty === 2) {
        data.passes[side].push(pt);
        if (Math.abs(e.x) > 35) data.attacks[side].push(pt);
      } else if (e.ty === 3 || e.ty === 83) data.progressive[side].push(pt);
      else if (e.ty === 7 || e.ty === 8) data.tackles[side].push(pt);
      else if (e.ty === 49) data.recoveries[side].push(pt);
      else if (e.ty === 5 || e.ty === 6) data.setPieces.push({ ...pt, team: e.team });
    }
  }

  function ensurePanel() {
    if (panel || !els.playerPanel) return panel;
    panel = createPlayerPanel(els.playerPanel, {
      onSeek: (secs) => {
        if (!theaterClip) return;
        seekTo(Number(secs) - theaterClip.startT);
      },
      status: () => {},
    });
    return panel;
  }

  let lastPanelIndex = null;
  let lastPanelTeam = -1;

  function syncPanelUi() {
    const p = ensurePanel();
    if (!p || !theaterClip) return;
    const index = currentIndex();
    const team = theaterClip.event.team === 1 ? 1 : 0;
    // setIndex resets selection/filters/zone, so only call it when the
    // underlying match or side actually changes. setNow is horizon-snapped
    // and focus-safe, so it runs every tick.
    if (index && (index !== lastPanelIndex || team !== lastPanelTeam)) {
      lastPanelIndex = index;
      lastPanelTeam = team;
      p.setIndex(index, team);
    }
    p.setNow(theaterClip.startT + clipTime);
  }

  // ── Card ─────────────────────────────────────────────────────

  function renderCard(pending) {
    let state = '';
    let eventLabel = '';
    let metaText = '';
    let progressPct = 0;
    let team = 2;
    let meta = {};

    if (pending) {
      state = 'rec';
      team = pending.event.team;
      meta = pending.meta || {};
      eventLabel = pending.event.label || 'Highlight';
      const info = teamInfo(meta, team);
      metaText = `${formatClock(pending.event.t)} · ${info.name} · ${Math.ceil(pending.remaining)}s left`;
      const span = Math.max(1e-6, pending.endT - pending.startT);
      progressPct = clamp01((pending.recordedTo - pending.startT) / span) * 100;
    } else if (cardClip) {
      state = 'ready';
      team = cardClip.event.team;
      meta = cardClip.meta || {};
      eventLabel = cardClip.event.label || 'Highlight';
      const info = teamInfo(meta, team);
      metaText = `${formatClock(cardClip.event.t)} · ${info.name} · ${Math.round(durationOf(cardClip))}s 3D`;
      progressPct = 100;
    } else {
      els.card.hidden = true;
      return;
    }

    const info = teamInfo(meta, team);
    els.card.hidden = false;
    els.card.dataset.state = state;
    els.card.dataset.team = String(team ?? 2);
    if (els.card.style && typeof els.card.style.setProperty === 'function') {
      els.card.style.setProperty('--r3d-team', info.color);
    }
    if (els.status) {
      els.status.textContent = state === 'rec'
        ? `REC ${Math.max(0, Math.ceil(pending.remaining))}s`
        : 'READY';
    }
    if (els.cardEvent) els.cardEvent.textContent = eventLabel;
    if (els.cardMeta) els.cardMeta.textContent = metaText;
    if (els.cardProgress) els.cardProgress.style.width = `${progressPct.toFixed(1)}%`;
    els.open.disabled = state !== 'ready';
    els.open.setAttribute(
      'aria-label',
      state === 'rec' ? '3D replay is still recording' : `Open 3D replay: ${eventLabel}`,
    );
  }

  function update(simNow) {
    const now = nowMs();
    const pending = recorder.getPending();
    let ready = [];

    // A paused or finished match freezes the sim clock, so a pending window
    // would otherwise read "REC 12s" forever. Close it after a short stall and
    // deliver whatever was recorded.
    if (pending) {
      if (pending.id !== stalled.id || pending.recordedTo !== stalled.sim) {
        stalled = { id: pending.id, sim: pending.recordedTo, since: now };
      } else if (now - stalled.since > 2500 && typeof recorder.flush === 'function') {
        ready = ready.concat(recorder.flush());
        stalled = { id: 0, sim: null, since: 0 };
      }
    } else {
      stalled = { id: 0, sim: null, since: 0 };
    }

    ready = ready.concat(recorder.collect(simNow));
    if (ready.length) {
      for (const clip of ready) {
        clips.push(clip);
        cardClip = clip;
      }
      while (clips.length > MAX_UI_CLIPS) clips.shift();
    }
    if (ready.length || now - lastUiAt >= 200) {
      lastUiAt = now;
      renderCard(recorder.getPending());
    }
  }

  // ── Stage lifecycle ─────────────────────────────────────────

  function ensureStage() {
    if (stage) return Promise.resolve(stage);
    if (stagePromise) return stagePromise;
    stagePromise = (async () => {
      const rect = els.viewport.getBoundingClientRect();
      const width = Math.max(2, Math.round(rect.width || 960));
      const height = Math.max(2, Math.round(rect.height || 540));
      const mod = await import('./stage.js');
      stage = await mod.createStage(els.canvas, { width, height, reducedMotion });
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
          const r = els.viewport.getBoundingClientRect();
          if (r.width > 1 && r.height > 1 && stage && typeof stage.resize === 'function') {
            stage.resize(r.width, r.height);
          }
        });
        observer.observe(els.viewport);
      }
      return stage;
    })();
    stagePromise.catch(() => {
      stagePromise = null;
    });
    return stagePromise;
  }

  function setControlsEnabled(on) {
    if (els.play) els.play.disabled = !on;
    if (els.scrub) els.scrub.disabled = !on;
  }

  function showLoading(on, subtext) {
    if (!els.loading) return;
    els.loading.hidden = !on;
    if (subtext && els.loadingSub) els.loadingSub.textContent = subtext;
  }

  function showError(message) {
    if (!els.error) return;
    els.error.hidden = !message;
    if (message && els.errorSub) {
      els.errorSub.textContent = `${message}. The 2D highlight stays available in the sidebar.`;
    }
  }

  async function open() {
    if (!cardClip || theaterOpen) return;
    theaterClip = cardClip;
    clipTime = 0;
    playing = false;
    theaterOpen = true;
    stageFailed = false;
    lastClock = '';
    lastFeedKey = '';
    lastPanelIndex = null;
    lastPanelTeam = -1;
    els.theater.hidden = false;
    els.theater.setAttribute('aria-hidden', 'false');
    if (document.body && document.body.classList) document.body.classList.add('r3d-open');
    applyClipUi(theaterClip);
    syncControls();
    setControlsEnabled(false);
    showError('');
    showLoading(true, stage ? 'Warming the pitch…' : 'Loading three.js…');
    hideTitleCard();
    cancelLoop();

    try {
      await ensureStage();
      if (!theaterOpen) return;
      if (typeof stage.setClip === 'function') stage.setClip(theaterClip);
      if (typeof stage.setQuality === 'function') stage.setQuality(fxQuality);
      if (!minimap && els.minimap) {
        try {
          minimap = createMinimap(els.minimap, document.createElement('span'));
        } catch { minimap = null; }
      }
      buildMinimapFeed();
      buildLab();
      syncFxUi();
      lastFeedKey = '';
      showLoading(false);
      setControlsEnabled(true);
      applyClipUi(theaterClip);
      syncPanelUi();
      setPlaying(true);
      showTitleCard();
      if (els.close && typeof els.close.focus === 'function') els.close.focus();
    } catch (err) {
      if (!theaterOpen) return;
      stageFailed = true;
      showLoading(false);
      setControlsEnabled(false);
      showError(err && err.message ? err.message : String(err));
      if (els.close && typeof els.close.focus === 'function') els.close.focus();
    }
  }

  function close() {
    if (!theaterOpen) return;
    theaterOpen = false;
    setPlaying(false);
    cancelLoop();
    hideTitleCard();
    if (panel) {
      try { panel.close(); } catch { /* ignore */ }
    }
    els.theater.hidden = true;
    els.theater.setAttribute('aria-hidden', 'true');
    if (document.body && document.body.classList) document.body.classList.remove('r3d-open');
    if (!els.card.hidden && els.open && typeof els.open.focus === 'function') {
      els.open.focus();
    }
  }

  function cancelLoop() {
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ── Playback ────────────────────────────────────────────────

  function tick(ts) {
    rafId = 0;
    if (!theaterOpen || !stage || !theaterClip) return;
    const now = typeof ts === 'number' ? ts : nowMs();
    let dt = (now - lastTs) / 1000;
    lastTs = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 1 / 30);

    const dur = durationOf(theaterClip);
    if (playing) {
      clipTime += dt * speed;
      if (clipTime >= dur) {
        clipTime = dur;
        setPlaying(false);
      }
    }

    if (fx.update(dt)) syncFxUi();
    let summary = null;
    try {
      summary = stage.render(dt, theaterClip, clipTime, camMode, fx) || null;
    } catch (err) {
      stageFailed = true;
      setPlaying(false);
      showError(err && err.message ? err.message : String(err));
      syncPlayButton();
      return;
    }
    syncClockUi();
    syncFeedUi();
    syncReadoutUi(summary);
    syncPanelUi();
    drawMomentumStrip();
    if (minimap) {
      try { minimap.update(now / 1000); } catch { /* best-effort */ }
    }
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function renderOnce() {
    if (!stage || !theaterClip) return;
    try {
      const summary = stage.render(0, theaterClip, clipTime, camMode, fx) || null;
      syncClockUi();
      syncFeedUi();
      syncReadoutUi(summary);
      syncPanelUi();
      drawMomentumStrip();
    } catch { /* the live loop reports the real failure */ }
  }

  function togglePlay() {
    if (!stage || !theaterClip) return;
    const dur = durationOf(theaterClip);
    if (!playing && clipTime >= dur - 1e-3) clipTime = 0;
    setPlaying(!playing);
  }

  function setPlaying(on) {
    playing = Boolean(on);
    if (playing) {
      if (rafId) cancelLoop();
      lastTs = nowMs();
      if (!rafId && theaterOpen && stage) rafId = requestAnimationFrame(tick);
    } else {
      cancelLoop();
    }
    syncPlayButton();
  }

  function seekTo(seconds) {
    if (!theaterClip) return;
    const dur = durationOf(theaterClip);
    clipTime = Math.max(0, Math.min(dur, seconds));
    lastReadoutAt = -Infinity;
    renderOnce();
  }

  function seekBy(seconds) {
    seekTo(clipTime + seconds);
  }

  function setSpeed(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return;
    speed = v;
    syncControls();
  }

  function setCam(value) {
    camMode = value || 'auto';
    syncControls();
    if (!playing) renderOnce();
  }

  function syncPlayButton() {
    if (!els.play) return;
    const dur = theaterClip ? durationOf(theaterClip) : 0;
    const atEnd = dur > 0 && clipTime >= dur - 1e-3;
    els.play.textContent = playing ? '❚❚' : atEnd ? '↺' : '▶';
    els.play.setAttribute(
      'aria-label',
      playing ? 'Pause replay' : atEnd ? 'Replay from start' : 'Play replay',
    );
  }

  function syncControls() {
    const speedButtons = els.speeds ? Array.from(els.speeds.querySelectorAll('[data-speed]')) : [];
    for (const button of speedButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed));
    }
    const camButtons = els.cameras ? Array.from(els.cameras.querySelectorAll('[data-cam]')) : [];
    for (const button of camButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.cam === camMode));
    }
    if (els.speedTag) els.speedTag.textContent = `${speed}×`;
    syncPlayButton();
  }

  function syncClockUi() {
    if (!theaterClip || !els.clock) return;
    const dur = durationOf(theaterClip);
    const rel = Math.max(0, Math.min(dur, clipTime));
    const text = formatClock(theaterClip.startT + rel);
    if (text !== lastClock) {
      lastClock = text;
      els.clock.textContent = text;
    }
    if (!scrubbing && els.scrub) {
      els.scrub.value = String(Math.round((rel / dur) * 1000));
    }
  }

  function applyClipUi(clip) {
    if (!clip) return;
    const meta = clip.meta || {};
    const info = teamInfo(meta, clip.event.team);
    const eventClock = formatClock(clip.event.t);
    const label = clip.event.label || 'Highlight';
    if (els.title) {
      els.title.textContent = `${meta.homeName || 'Home'} vs ${meta.awayName || 'Away'}`;
    }
    if (els.score) {
      els.score.textContent = `${Number.isFinite(meta.scoreHome) ? meta.scoreHome : 0} – ${Number.isFinite(meta.scoreAway) ? meta.scoreAway : 0}`;
    }
    if (els.eventLabel) els.eventLabel.textContent = label;
    if (els.eventClock) els.eventClock.textContent = eventClock;
    if (els.eventTeam) els.eventTeam.textContent = info.name;
    if (els.tcMain) els.tcMain.textContent = `${label} · ${info.name}`;
    if (els.tcSub) {
      els.tcSub.textContent = `${eventClock} · replay ${formatClock(clip.startT)}–${formatClock(clip.endT)}`;
    }
    if (els.window) {
      els.window.textContent = `${formatClock(clip.startT)} – ${formatClock(clip.endT)}`;
    }
    if (els.viewport && els.viewport.style && typeof els.viewport.style.setProperty === 'function') {
      els.viewport.style.setProperty('--r3d-team', info.color);
    }
    if (els.titleCard && els.titleCard.style && typeof els.titleCard.style.setProperty === 'function') {
      els.titleCard.style.setProperty('--r3d-team', info.color);
    }
    lastClock = '';
    lastFeedKey = '';
    syncClockUi();
  }

  function showTitleCard() {
    if (!els.titleCard) return;
    els.titleCard.classList.add('is-visible');
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      if (els.titleCard) els.titleCard.classList.remove('is-visible');
      titleTimer = null;
    }, reducedMotion ? 2600 : 5400);
  }

  function hideTitleCard() {
    if (titleTimer) {
      clearTimeout(titleTimer);
      titleTimer = null;
    }
    if (els.titleCard) els.titleCard.classList.remove('is-visible');
  }

  // ── Wiring ──────────────────────────────────────────────────

  els.open.addEventListener('click', () => { open(); });
  if (els.close) els.close.addEventListener('click', close);
  if (els.play) els.play.addEventListener('click', togglePlay);
  if (els.theater) {
    els.theater.addEventListener('pointerdown', (ev) => {
      if (ev.target === els.theater) close();
    });
  }
  if (els.scrub) {
    els.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
    els.scrub.addEventListener('pointerup', () => { scrubbing = false; });
    els.scrub.addEventListener('change', () => { scrubbing = false; });
    els.scrub.addEventListener('input', () => {
      scrubbing = true;
      if (!theaterClip) return;
      const dur = durationOf(theaterClip);
      seekTo((Number(els.scrub.value) / 1000) * dur);
    });
  }
  if (els.speeds) {
    for (const button of Array.from(els.speeds.querySelectorAll('[data-speed]'))) {
      button.addEventListener('click', () => setSpeed(button.dataset.speed));
    }
  }
  if (els.cameras) {
    for (const button of Array.from(els.cameras.querySelectorAll('[data-cam]'))) {
      button.addEventListener('click', () => setCam(button.dataset.cam));
    }
  }
  if (els.fx) {
    for (const button of Array.from(els.fx.querySelectorAll('[data-fx]'))) {
      button.addEventListener('click', (ev) => {
        const key = button.dataset.fx;
        if (ev.shiftKey) {
          // Solo: keep only this layer enabled.
          const only = !fx.isEnabled(key) || !THEATRE_FX_LAYERS.every((k) => k === key ? fx.isEnabled(k) : !fx.isEnabled(k));
          for (const k of THEATRE_FX_LAYERS) fx.setEnabled(k, only ? k === key : true);
        } else {
          fx.toggleEnabled(key);
        }
        fxPreset = null;
        syncFxUi();
        renderOnce();
      });
    }
  }
  if (els.shuffle) {
    els.shuffle.addEventListener('click', () => {
      fx.toggleShuffle();
      syncFxUi();
      renderOnce();
    });
  }
  if (els.presets) {
    for (const button of Array.from(els.presets.querySelectorAll('[data-r3d-preset]'))) {
      button.addEventListener('click', () => applyFxPreset(button.dataset.r3dPreset));
    }
  }
  if (els.quality) {
    for (const button of Array.from(els.quality.querySelectorAll('[data-fxq]'))) {
      button.addEventListener('click', () => {
        fxQuality = button.dataset.fxq || 'high';
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem('gev.r3d.fx', fxQuality);
        } catch { /* ignore */ }
        if (stage && typeof stage.setQuality === 'function') {
          try { stage.setQuality(fxQuality); } catch { /* best-effort */ }
        }
        syncFxUi();
        renderOnce();
      });
    }
  }
  if (els.panelOpen) {
    els.panelOpen.addEventListener('click', () => {
      const p = ensurePanel();
      if (!p) return;
      syncPanelUi();
      p.open('team', { team: theaterClip && theaterClip.event.team === 1 ? 1 : 0 });
    });
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (ev) => {
      if (!theaterOpen) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
        return;
      }
      const tag = ev.target && ev.target.tagName ? String(ev.target.tagName).toLowerCase() : '';
      // Buttons are not text fields: focus lands on Close when the theatre
      // opens, and arrow/space shortcuts must still work there. Only real
      // editable controls swallow playback keys.
      const editing = tag === 'input' || tag === 'select' || tag === 'textarea';
      if (editing) return;
      if (ev.key === ' ') {
        ev.preventDefault();
        togglePlay();
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        seekBy(-2);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        seekBy(2);
      }
    });
  }

  // Initial state: every layer on (like the live GEV default); a stored 3D
  // preset is restored on top. The card is already hidden in the markup.
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(R3D_PRESET_KEY) : null;
    if (stored && PRESETS[stored]) applyFxPreset(stored);
  } catch { /* ignore */ }
  syncControls();
  syncFxUi();

  function reset() {
    clips = [];
    cardClip = null;
    theaterClip = null;
    clipTime = 0;
    lastPanelIndex = null;
    lastPanelTeam = -1;
    close();
    if (stage && typeof stage.clearClip === 'function') {
      try { stage.clearClip(); } catch { /* ignore */ }
    }
    renderCard(null);
  }

  return {
    update,
    reset,
    open,
    close,
    get state() {
      return {
        available: true,
        open: theaterOpen,
        playing,
        speed,
        camMode,
        clipTime,
        clips: clips.length,
        stageReady: Boolean(stage),
        stageFailed,
        reducedMotion,
        analysisError: (stage && stage.analysis && stage.analysis.lastError) || null,
      };
    },
  };
}
