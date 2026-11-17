// Layer toggles and the one-at-a-time shuffle state.
//
// The controller only answers "should this layer be drawn?"; it never touches
// the drawing routines themselves. Sampling and trackers keep running while a
// layer is hidden, so turning it back on resumes the live view instead of
// resetting it. Analytical layers take part in the shuffle rotation;
// presentation polish (`shuffle: false`) does not.

export const EFFECTS = Object.freeze([
  Object.freeze({ key: 'heatmap', label: 'Heatmap' }),
  Object.freeze({ key: 'network', label: 'Passing network' }),
  Object.freeze({ key: 'offside', label: 'Offside line' }),
  Object.freeze({ key: 'analysis', label: 'Analysis' }),
  Object.freeze({ key: 'passingLanes', label: 'Pass lanes' }),
  Object.freeze({ key: 'attackChannels', label: 'Run channels' }),
  Object.freeze({ key: 'visionCone', label: 'Vision cone' }),
  Object.freeze({ key: 'dribbles', label: 'Dribble zones' }),
  // Presentation layers polish the ball and the body in possession. They are
  // toggles like every other effect, but `shuffle: false` keeps them out of
  // the one-at-a-time rotation: a rotation frame with no analysis layer at
  // all would read as a broken pitch rather than a comparison.
  Object.freeze({ key: 'ballTrail', label: 'Ball trail', shuffle: false }),
  Object.freeze({ key: 'carrierGrow', label: 'Carrier grow', shuffle: false }),
]);

export const SHUFFLE_SECONDS = 4;

function isShuffleable(effect) {
  return effect.shuffle !== false;
}

export function createEffectController(options = {}) {
  const effects = options.effects ?? EFFECTS;
  const interval = Number.isFinite(options.interval) && options.interval > 0
    ? options.interval
    : SHUFFLE_SECONDS;
  const enabled = new Map(effects.map((effect) => [effect.key, true]));
  let shuffleActive = false;
  let currentKey = null;
  let elapsed = 0;

  function enabledKeys() {
    return effects
      .filter((effect) => isShuffleable(effect) && enabled.get(effect.key))
      .map((effect) => effect.key);
  }

  function selectFirst(pool) {
    currentKey = pool.length > 0 ? pool[0] : null;
    elapsed = 0;
  }

  /**
   * Next enabled layer after `key` in toolbar order, wrapping around. Used
   * when the layer being shuffled to is switched off mid-rotation.
   */
  function pickAfter(key, pool) {
    if (pool.length === 0) return null;
    const order = effects.map((effect) => effect.key);
    const start = order.indexOf(key);
    if (start < 0) return pool[0];
    for (let step = 1; step <= order.length; step++) {
      const candidate = order[(start + step) % order.length];
      if (pool.includes(candidate)) return candidate;
    }
    return pool[0];
  }

  function setEnabled(key, value) {
    if (!enabled.has(key)) return false;
    const next = Boolean(value);
    if (enabled.get(key) === next) return false;
    enabled.set(key, next);
    if (!shuffleActive) return true;
    const pool = enabledKeys();
    if (pool.length === 0) {
      currentKey = null;
      elapsed = 0;
    } else if (currentKey === null || !pool.includes(currentKey)) {
      currentKey = pickAfter(currentKey, pool);
      elapsed = 0;
    }
    return true;
  }

  function toggleEnabled(key) {
    return setEnabled(key, !enabled.get(key));
  }

  function setShuffle(active) {
    const next = Boolean(active);
    if (next === shuffleActive) return false;
    shuffleActive = next;
    elapsed = 0;
    if (shuffleActive) selectFirst(enabledKeys());
    else currentKey = null;
    return true;
  }

  function update(dt) {
    if (!shuffleActive) return false;
    const pool = enabledKeys();
    if (pool.length === 0) {
      if (currentKey === null) return false;
      currentKey = null;
      elapsed = 0;
      return true;
    }
    if (currentKey === null || !pool.includes(currentKey)) {
      currentKey = pickAfter(currentKey, pool);
      elapsed = 0;
      return true;
    }
    if (!Number.isFinite(dt) || dt <= 0) return false;
    elapsed += dt;
    let changed = false;
    while (elapsed >= interval) {
      elapsed -= interval;
      const index = pool.indexOf(currentKey);
      currentKey = pool[(index + 1) % pool.length];
      changed = true;
    }
    return changed;
  }

  return {
    effects,
    interval,
    isEnabled(key) {
      return enabled.get(key) === true;
    },
    isVisible(key) {
      if (enabled.get(key) !== true) return false;
      if (!shuffleActive) return true;
      // Presentation polish is not part of the comparison rotation, so it
      // stays on screen whenever its own toggle is on.
      const effect = effects.find((entry) => entry.key === key);
      if (effect && !isShuffleable(effect)) return true;
      return key === currentKey;
    },
    setEnabled,
    toggleEnabled,
    setShuffle,
    toggleShuffle() {
      return setShuffle(!shuffleActive);
    },
    update,
    get shuffleActive() {
      return shuffleActive;
    },
    get currentKey() {
      return currentKey;
    },
  };
}
