// Stadium atmosphere for the 3D replay.
//
// A tiny energy model shared by the crowd, banners, LED boards, goal nets and
// confetti. Events pulse it, it decays every frame, and the scene reads one
// number instead of recomputing "how excited should the stadium be" five
// different ways. DOM-free so the decay curves can be tested without WebGL.

export const EVENT_ENERGY = {
  16: 1.0,  // goal
  17: 1.0,  // own goal / penalty outcome
  14: 0.85, // woodwork
  10: 0.78, // save
  15: 0.7,  // attempt saved
  13: 0.62, // shot
  4: 0.42,  // corner
  5: 0.34,  // free kick / throw family
  7: 0.3,   // tackle / foul
  8: 0.26,  // interception
  2: 0.22,  // offside
};

export const DEFAULT_ENERGY = 0.18;

/** Event type -> a 0..1 crowd spike. `notable` nudges it up, capped at 1. */
export function energyForEvent(type, notable = false) {
  const base = EVENT_ENERGY[type] ?? DEFAULT_ENERGY;
  return Math.max(0, Math.min(1, base + (notable ? 0.12 : 0)));
}

export function createAtmosphere({ energyTau = 3.4, impulseTau = 0.75 } = {}) {
  let energy = 0;
  let impulse = 0;
  let goals = 0;

  function pulse(value = 0.5) {
    const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    energy = Math.max(energy, v);
    impulse = Math.max(impulse, v);
  }

  function event(type, notable = false) {
    pulse(energyForEvent(type, notable));
    if (type === 16 || type === 17) goals++;
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // A normal hitch is capped so one slow frame does not collapse the roar;
    // a multi-second tab resume is allowed to decay all the way.
    const step = dt > 1 ? dt : Math.min(dt, 0.25);
    energy *= Math.exp(-step / energyTau);
    impulse *= Math.exp(-step / impulseTau);
    if (energy < 1e-4) energy = 0;
    if (impulse < 1e-4) impulse = 0;
  }

  function reset() {
    energy = 0;
    impulse = 0;
    goals = 0;
  }

  return {
    pulse,
    event,
    update,
    reset,
    get energy() { return energy; },
    get impulse() { return impulse; },
    get goals() { return goals; },
  };
}

/** Ambient floor so an idle stadium still breathes instead of freezing. */
export function ambientEnergy(time, energy) {
  const base = 0.14 + Math.sin(time * 0.7) * 0.03 + Math.sin(time * 0.23 + 1.7) * 0.02;
  return Math.max(0, Math.min(1, base + (energy || 0) * 0.86));
}
