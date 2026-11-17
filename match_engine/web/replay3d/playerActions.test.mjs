import test from 'node:test';
import assert from 'node:assert/strict';
import { STRIDE } from './clipStore.js';
import {
  locomotionLevel, locomotionName, celebrationName, pickVariant, variantFor,
  buildEventContext, actionForSlot, actionWeight,
} from './playerActions.js';
import { MOCAP_TIMING, MOCAP_VARIANTS } from './mixamoTiming.js';

function makeClip({ event, players, startT = 85, endT = 115, fps = 10 }) {
  const frames = [];
  for (let t = startT; t <= endT + 1e-6; t += 1 / fps) {
    const data = new Float32Array((players.length + 1) * STRIDE);
    players.forEach((p, i) => {
      const o = i * STRIDE;
      data[o] = p.x;
      data[o + 1] = p.y;
      data[o + 2] = p.z || 0;
      data[o + 3] = 0;
      data[o + 4] = p.team;
      data[o + 5] = p.shirt ?? i + 1;
    });
    const o = players.length * STRIDE;
    data[o] = event.ballX ?? 0;
    data[o + 1] = event.ballY ?? 0;
    data[o + 2] = event.ballZ ?? 0;
    data[o + 4] = 2;
    frames.push({ t, count: players.length + 1, data });
  }
  return {
    id: 1,
    event,
    startT,
    endT,
    frames,
    meta: {},
  };
}

// A clip whose ball follows a supplied path, used to verify that the receiver
// is found from the future ball position rather than the pass origin.
function makeBallPathClip({ event, players, ballAt, startT = 97, endT = 105, fps = 10 }) {
  const frames = [];
  for (let t = startT; t <= endT + 1e-6; t += 1 / fps) {
    const data = new Float32Array((players.length + 1) * STRIDE);
    players.forEach((p, i) => {
      const o = i * STRIDE;
      data[o] = p.x;
      data[o + 1] = p.y;
      data[o + 2] = 0;
      data[o + 3] = 0;
      data[o + 4] = p.team;
      data[o + 5] = p.shirt ?? i + 1;
    });
    const ball = ballAt(t);
    const o = players.length * STRIDE;
    data[o] = ball.x;
    data[o + 1] = ball.y;
    data[o + 2] = 0;
    data[o + 4] = 2;
    frames.push({ t, count: players.length + 1, data });
  }
  return { id: 1, event, startT, endT, frames, meta: {} };
}

// A simple 4-player match: home 9 nearest the ball, home 1 in goal, away 1 in
// goal, away 5 far away.
const players = [
  { x: 48, y: 0, team: 0, shirt: 9 },
  { x: -48, y: 0, team: 0, shirt: 1 },
  { x: 50, y: 1, team: 1, shirt: 1 },
  { x: -10, y: 20, team: 1, shirt: 5 },
];
const roles = [0, 1, 1, 0];

// Two-player passing shape: slot 0 has the ball, slot 1 is the outlet.
function passLike() {
  return [
    { x: 0, y: 0, team: 0, shirt: 9 },
    { x: 15, y: 0, team: 0, shirt: 8 },
    { x: 20, y: 10, team: 1, shirt: 5 },
    { x: 40, y: 0, team: 1, shirt: 1 },
  ];
}

test('locomotion thresholds use hysteresis in both directions', () => {
  assert.equal(locomotionLevel(0), 0);
  assert.equal(locomotionLevel(0.5), 0, 'below the walk entry stays idle');
  assert.equal(locomotionLevel(0.95), 1);
  assert.equal(locomotionLevel(2.4), 2, 'above the jog entry is a jog');
  assert.equal(locomotionLevel(2.8), 2);
  assert.equal(locomotionLevel(5.0), 3);
  assert.equal(locomotionLevel(7.0), 4);
  // Coming down, thresholds are lower so gaits do not chatter.
  assert.equal(locomotionLevel(6.3, 4), 4);
  assert.equal(locomotionLevel(5.0, 4), 3);
  assert.equal(locomotionLevel(3.0, 3), 2);
  assert.equal(locomotionLevel(1.8, 2), 2);
  assert.equal(locomotionLevel(1.5, 2), 1);
  assert.equal(locomotionLevel(0.4, 1), 1);
  assert.equal(locomotionLevel(0.3, 1), 0);
  assert.equal(locomotionLevel(NaN, 3), 0);
});

test('keepers idle in their stance instead of a walking idle', () => {
  assert.equal(locomotionName(0, true), 'gk_idle');
  assert.equal(locomotionName(1, true), 'gk_idle');
  assert.equal(locomotionName(2, true), 'jog');
  assert.equal(locomotionName(3, false), 'run');
});

test('celebration variants spread across the squad', () => {
  assert.equal(celebrationName(0.1), 'celebrate_a');
  assert.equal(celebrationName(0.5), 'celebrate_b');
  assert.equal(celebrationName(0.9), 'celebrate_c');
});

test('event context finds the nearest attacker and the keepers', () => {
  const clip = makeClip({ event: { t: 100, type: 13, team: 0, x: 49, y: 0, ballX: 49, ballY: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  assert.equal(ctx.nearestSlot, 0);
  assert.equal(ctx.nearestOppSlot, 2);
  assert.deepEqual(ctx.gkSlots, [1, 2]);
  assert.equal(ctx.eventTeam, 0);
  assert.equal(ctx.ballX, 49);
});

test('a shot triggers a kick on the nearest attacker only', () => {
  const clip = makeClip({ event: { t: 100, type: 13, team: 0, x: 49, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  const striker = actionForSlot(0, 99.9, ctx, { team: 0, hash01: 0.1 });
  assert.ok(striker);
  assert.equal(striker.name, 'kick');
  assert.equal(actionForSlot(3, 99.9, ctx, { team: 1 }), null, 'a far defender does not kick');
  assert.equal(actionForSlot(1, 99.9, ctx, { team: 0, isGK: true }), null, 'the attacking keeper does not kick');
});

test('an aerial duel picks the header clip, not a foot strike', () => {
  const clip = makeClip({ event: { t: 100, type: 44, team: 0, x: 49, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  const action = actionForSlot(0, 100.0, ctx, { team: 0 });
  assert.equal(action.name, 'header');
  assert.ok(action.start < 100 && action.until > 100);
});

test('an attempt-saved event is a foot strike, not a header', () => {
  const clip = makeClip({ event: { t: 100, type: 15, team: 0, x: 49, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  const action = actionForSlot(0, 99.7, ctx, { team: 0 });
  assert.equal(action.name, 'kick');
  assert.equal(actionForSlot(0, 100.0, ctx, { team: 0 }), null, 'the strike is over by the save');
});

test('the defending keeper dives toward the ball side', () => {
  const clip = makeClip({
    event: { t: 100, type: 13, team: 0, x: 49, y: -2, ballX: 49, ballY: -2 },
    players: [
      { x: 49, y: -2, team: 0, shirt: 9 },
      { x: -48, y: 0, team: 0, shirt: 1 },
      { x: 50, y: 0.5, team: 1, shirt: 1 },
      { x: -10, y: 20, team: 1, shirt: 5 },
    ],
  });
  const ctx = buildEventContext(clip, roles);
  const dive = actionForSlot(2, 99.8, ctx, { team: 1, isGK: true });
  assert.ok(dive);
  assert.equal(dive.name, 'gk_dive_l');
  assert.equal(actionForSlot(1, 99.8, ctx, { team: 0, isGK: true }), null, 'the attacking keeper stays up');
});

test('a high shot picks the volley clip', () => {
  const clip = makeClip({
    event: { t: 100, type: 13, team: 0, x: 49, y: 0, ballX: 49, ballY: 0, ballZ: 1.8 },
    players,
  });
  const ctx = buildEventContext(clip, roles);
  assert.equal(actionForSlot(0, 100.0, ctx, { team: 0 }).name, 'volley');
});

test('a save gives the keeper a catch and the shooter a strike', () => {
  const clip = makeClip({ event: { t: 100, type: 10, team: 1, x: 50, y: 1, ballX: 50, ballY: 1 }, players });
  const ctx = buildEventContext(clip, roles);
  const save = actionForSlot(2, 100.0, ctx, { team: 1, isGK: true });
  assert.ok(save);
  assert.equal(save.name, 'gk_catch');
  assert.ok(save.start < 100 && save.until > 100);
  const strike = actionForSlot(0, 99.6, ctx, { team: 0 });
  assert.equal(strike.name, 'kick');
  assert.ok(strike.start < 100 && strike.until <= 100, 'the strike finishes before the save');
});

test('a pass animates the passer and the receiver from the ball path', () => {
  const passPlayers = [
    { x: 0, y: 0, team: 0, shirt: 9 },
    { x: 15, y: 0, team: 0, shirt: 8 },
    { x: 20, y: 10, team: 1, shirt: 5 },
    { x: -40, y: 0, team: 0, shirt: 1 },
    { x: 40, y: 0, team: 1, shirt: 1 },
  ];
  const clip = makeBallPathClip({
    event: { t: 100, type: 1, team: 0, x: 0, y: 0 },
    players: passPlayers,
    ballAt: (t) => {
      if (t <= 100) return { x: 0, y: 0 };
      if (t >= 102.5) return { x: 15, y: 0 };
      const u = (t - 100) / 2.5;
      return { x: 15 * u, y: 0 };
    },
  });
  const roles5 = [0, 0, 0, 1, 1];
  const ctx = buildEventContext(clip, roles5);
  assert.equal(ctx.nearestSlot, 0, 'the passer is nearest the ball');
  assert.equal(ctx.receiverSlot, 1, 'the future ball path finds the receiver');
  assert.ok(Math.abs(ctx.receiveT - 102.5) < 0.2);
  assert.equal(actionForSlot(0, 99.9, ctx, { team: 0 }).name, 'pass');
  assert.equal(actionForSlot(1, 102.5, ctx, { team: 0 }).name, 'receive');
  assert.equal(actionForSlot(1, 100.2, ctx, { team: 0 }), null, 'the receiver waits for the ball');
});

test('a throw-in starts after the ball goes out, a goal kick starts after it too', () => {
  const wide = makeClip({
    event: { t: 100, type: 5, team: 0, x: 10, y: 30, ballX: 10, ballY: 30 },
    players,
  });
  const wideCtx = buildEventContext(wide, roles);
  const throwIn = actionForSlot(0, 100.5, wideCtx, { team: 0 });
  assert.equal(throwIn.name, 'throw_in');
  assert.ok(throwIn.start > 100, 'the throw is taken after the out event');
  assert.equal(actionForSlot(0, 100.0, wideCtx, { team: 0 }), null);

  const central = makeClip({
    event: { t: 100, type: 5, team: 0, x: 10, y: 2, ballX: 10, ballY: 2 },
    players,
  });
  const centralCtx = buildEventContext(central, roles);
  const goalKick = actionForSlot(0, 100.7, centralCtx, { team: 0 });
  assert.equal(goalKick.name, 'kick');
  assert.ok(goalKick.start > 100, 'the restart is taken after the out event');
});

test('a take-on plays a control turn', () => {
  const clip = makeClip({ event: { t: 100, type: 3, team: 0, x: 49, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  const action = actionForSlot(0, 100.1, ctx, { team: 0 });
  assert.equal(action.name, 'receive');
  assert.ok(action.start <= 100 && action.until > 100);
});

test('a goal sends the scoring team into a looping celebration', () => {
  const clip = makeClip({ event: { t: 100, type: 16, team: 0, x: 49, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  const cel = actionForSlot(1, 102, ctx, { team: 0, isGK: true, hash01: 0.5 });
  assert.ok(cel);
  assert.equal(cel.name, 'celebrate_b');
  assert.equal(cel.loop, true);
  assert.ok(cel.until - cel.start >= 4, 'celebration covers the post-goal window');
  assert.equal(actionForSlot(2, 102, ctx, { team: 1, isGK: true }), null, 'the conceding side does not celebrate');

  // Kick first, then celebration: no gap where the scorer snaps to idle.
  const kick = actionForSlot(0, 100.0, ctx, { team: 0 });
  assert.equal(kick.name, 'kick');
  const later = actionForSlot(0, 100.9, ctx, { team: 0, hash01: 0.1 });
  assert.equal(later.name, 'celebrate_a');
});

test('variant groups shuffle deterministically without breaking the base', () => {
  // Every group entry must be a baked clip with valid timing.
  for (const [group, names] of Object.entries(MOCAP_VARIANTS)) {
    assert.ok(names.length >= 2, `${group} has variants`);
    for (const name of names) {
      if (name.startsWith('celebrate_')) continue; // procedural fallback
      assert.ok(MOCAP_TIMING[name], `${name} has baked timing`);
    }
  }
  // Default and legacy hashes keep the base clip; high hashes spread.
  for (const [group, names] of Object.entries(MOCAP_VARIANTS)) {
    if (group === 'celebrate') continue;
    assert.equal(pickVariant(names, 0.1), names[0], `${group} base at 0.1`);
    assert.equal(pickVariant(names, 0.5), names[0], `${group} base at 0.5`);
    assert.notEqual(pickVariant(names, 0.9), names[0], `${group} shuffles at 0.9`);
    assert.equal(pickVariant(names, 0.9), pickVariant(names, 0.9), `${group} deterministic`);
    assert.equal(variantFor(group, names[0], 0.5), names[0]);
  }
  // Same-name files never leak across semantic groups.
  assert.ok(!MOCAP_VARIANTS.header.includes('pass_b'));
  assert.ok(!MOCAP_VARIANTS.pass.includes('header_b'));
  // A missed bake falls back to the base instead of a rest pose.
  assert.equal(variantFor('no_such_group', 'kick', 0.9), 'kick');
});

test('high balls are chipped, low balls are passed', () => {
  const low = makeClip({ event: { t: 100, type: 1, team: 0, x: 0, y: 0, ballZ: 0.2 }, players: passLike() });
  const lowCtx = buildEventContext(low, [0, 0, 0, 1]);
  assert.equal(actionForSlot(0, 99.9, lowCtx, { team: 0 }).name, 'pass');
  const high = makeClip({ event: { t: 100, type: 1, team: 0, x: 0, y: 0, ballZ: 2.0 }, players: passLike() });
  const highCtx = buildEventContext(high, [0, 0, 0, 1]);
  assert.equal(actionForSlot(0, 99.9, highCtx, { team: 0 }).name, 'pass_chip');
});

test('a goal beats the keeper with a dive or a miss, never a celebration', () => {
  const clip = makeClip({ event: { t: 100, type: 16, team: 0, x: 52, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  const dive = actionForSlot(2, 99.9, ctx, { team: 1, isGK: true, hash01: 0.1 });
  assert.equal(dive.name, 'gk_dive_l');
  const miss = actionForSlot(2, 99.9, ctx, { team: 1, isGK: true, hash01: 0.9 });
  assert.equal(miss.name, 'gk_miss');
  assert.ok(miss.until <= 101.8, 'the miss window ends before the celebration check');
  assert.equal(actionForSlot(2, 102, ctx, { team: 1, isGK: true }), null);
});

test('a card neither celebrates nor dives', () => {
  const clip = makeClip({ event: { t: 100, type: 17, team: 0, x: 49, y: 0 }, players });
  const ctx = buildEventContext(clip, roles);
  assert.equal(actionForSlot(0, 102, ctx, { team: 0 }), null);
  assert.equal(actionForSlot(2, 102, ctx, { team: 1, isGK: true }), null);
});

test('a foul falls the victim and gets him up again', () => {
  const clip = makeClip({
    event: { t: 100, type: 7, team: 0, x: 49, y: 0 },
    players: [
      { x: 49, y: 0, team: 0, shirt: 9 },
      { x: 48.5, y: 0.5, team: 1, shirt: 5 },
      { x: -48, y: 0, team: 0, shirt: 1 },
      { x: 50, y: 1, team: 1, shirt: 1 },
    ],
  });
  const ctx = buildEventContext(clip, roles);
  assert.equal(actionForSlot(0, 100.1, ctx, { team: 0 }).name, 'tackle');
  assert.equal(actionForSlot(1, 100.6, ctx, { team: 1 }).name, 'fall');
  assert.equal(actionForSlot(1, 101.8, ctx, { team: 1 }).name, 'fallen_idle');
  assert.equal(actionForSlot(1, 103.2, ctx, { team: 1 }).name, 'getup');
  assert.equal(actionForSlot(1, 100.6, ctx, { team: 0 }), null, 'a teammate is not the victim');
});

test('the same time always answers the same action', () => {
  const clip = makeClip({ event: { t: 100, type: 13, team: 0, x: 49, y: 0 }, players });
  const ctxA = buildEventContext(clip, roles);
  const ctxB = buildEventContext(clip, roles);
  for (const t of [99.6, 99.8, 100, 100.2, 100.6, 101]) {
    const a = actionForSlot(0, t, ctxA, { team: 0 });
    const b = actionForSlot(0, t, ctxB, { team: 0 });
    assert.deepEqual(a, b, `deterministic at ${t}`);
  }
});

test('an eventless clip has no actions', () => {
  const clip = makeClip({ event: { t: 100, type: 13, team: 0 }, players });
  delete clip.event;
  assert.equal(buildEventContext(clip, roles), null);
  assert.equal(actionForSlot(0, 100, null, { team: 0 }), null);
});

test('the action envelope fades in and out and is zero outside', () => {
  const action = { name: 'kick', start: 10, until: 10.95, loop: false };
  assert.equal(actionWeight(action, 9.9), 0);
  assert.equal(actionWeight(action, 10.5), 1);
  assert.ok(actionWeight(action, 10.05) > 0 && actionWeight(action, 10.05) < 1);
  assert.ok(actionWeight(action, 10.9) > 0 && actionWeight(action, 10.9) < 1);
  assert.equal(actionWeight(action, 11.1), 0);
  assert.equal(actionWeight(null, 10), 0);
});
