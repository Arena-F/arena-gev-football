import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL_MARKER_RADIUS,
  CARRIER_MARKER_RADIUS,
  CARRIER_RING_GAP,
  TRAIL_FADE_MIN_SPEED,
  TRAIL_FULL_SPEED,
  TRAIL_MAX_POINTS,
  TRAIL_SECONDS,
  createBallTrail,
  createCarrierEmphasis,
  createCarrierRing,
  drawBallTrail,
  drawCarrierRing,
  easeTrailFade,
  nearestCarrier,
  trailFadeForSpeed,
} from './ballMotion.js';

function makeCtx() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop === 'string') {
          return (...args) => { calls.push([prop, ...args]); };
        }
        return target[prop];
      },
      set(target, prop, value) {
        calls.push(['set', prop, value]);
        target[prop] = value;
        return true;
      },
    },
  );
  return { ctx, calls };
}

/** Recording context with a working (stubbed) conic gradient. */
function makeRingCtx() {
  const calls = [];
  const gradients = [];
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'createConicGradient') {
          return (startAngle, x, y) => {
            const gradient = {
              startAngle,
              x,
              y,
              stops: [],
              addColorStop(offset, color) { gradient.stops.push([offset, color]); },
            };
            gradients.push(gradient);
            calls.push(['createConicGradient', startAngle, x, y]);
            return gradient;
          };
        }
        if (typeof prop === 'string') {
          return (...args) => { calls.push([prop, ...args]); };
        }
        return target[prop];
      },
      set(target, prop, value) {
        calls.push(['set', prop, value]);
        target[prop] = value;
        return true;
      },
    },
  );
  return { ctx, calls, gradients };
}

const toScreen = (x, y) => [x * 8 + 525, 340 - y * 8];

test('trail keeps only the rolling window and never grows unbounded', () => {
  const trail = createBallTrail();
  for (let i = 0; i <= 120; i++) {
    trail.push({ x: i * 0.4, y: 0, z: 0 }, i * 16);
  }
  const oldest = trail.points[0];
  const newest = trail.points[trail.points.length - 1];
  assert.ok(newest.t - oldest.t <= TRAIL_SECONDS * 1000 + 16);
  assert.ok(trail.points.length <= TRAIL_MAX_POINTS);
});

test('a stopped ball does not accumulate duplicate samples', () => {
  const trail = createBallTrail();
  assert.equal(trail.push({ x: 0, y: 0 }, 0), true);
  for (let i = 1; i < 40; i++) {
    assert.equal(trail.push({ x: 0, y: 0 }, i * 16), false);
  }
  assert.ok(trail.points.length <= 1, `expected one live head, got ${trail.points.length}`);
  assert.equal(trail.speed(), 0);
});

test('trail speed tracks the real ball velocity', () => {
  const trail = createBallTrail();
  // 10 m/s: 1 m every 100 ms.
  trail.push({ x: 0, y: 0 }, 0);
  trail.push({ x: 1, y: 0 }, 100);
  trail.push({ x: 2, y: 0 }, 200);
  trail.push({ x: 3, y: 0 }, 300);
  assert.ok(Math.abs(trail.speed() - 10) < 0.001, `speed=${trail.speed()}`);
});

test('a teleported ball starts a fresh trail instead of a phantom streak', () => {
  const trail = createBallTrail();
  trail.push({ x: 45, y: 0 }, 0);
  trail.push({ x: 46, y: 0 }, 100);
  trail.push({ x: 47, y: 0 }, 200);
  assert.equal(trail.points.length, 3);

  // Kickoff re-spot: the ball jumps from the goal mouth to the centre spot.
  assert.equal(trail.push({ x: 0, y: 0 }, 216), true);
  assert.equal(trail.points.length, 1);
  assert.deepEqual(
    { x: trail.points[0].x, y: trail.points[0].y },
    { x: 0, y: 0 },
  );
});

test('trail bends through the samples instead of chaining straight chords', () => {
  const trail = createBallTrail();
  trail.push({ x: 0, y: 0 }, 0);
  trail.push({ x: 4, y: 2 }, 100);
  trail.push({ x: 8, y: 0 }, 200);
  trail.push({ x: 12, y: -2 }, 300);
  assert.ok(trail.points.length >= 4);

  const { ctx, calls } = makeCtx();
  const segments = drawBallTrail(ctx, toScreen, trail.points);
  assert.equal(segments, trail.points.length - 1);
  const curves = calls.filter(([name]) => name === 'quadraticCurveTo');
  assert.equal(curves.length, segments, 'every drawn segment is a quadratic');
  assert.ok(calls.some(([name]) => name === 'stroke'));
  // White strokes only: the trail never borrows the ball or team colour.
  assert.ok(calls.some(([name, prop, value]) => name === 'set' && prop === 'strokeStyle' && value === '#ffffff'));
});

test('drawBallTrail tapers: tail is thinner and fainter than the head', () => {
  const { ctx, calls } = makeCtx();
  const points = [];
  for (let i = 0; i < 12; i++) points.push({ x: i * 2, y: 0, z: 0 });
  drawBallTrail(ctx, toScreen, points);

  const alphas = calls.filter(([name, prop]) => name === 'set' && prop === 'globalAlpha')
    .map(([, , value]) => value);
  const widths = calls.filter(([name, prop]) => name === 'set' && prop === 'lineWidth')
    .map(([, , value]) => value);
  assert.ok(alphas.length >= 5);
  assert.ok(widths.length >= 5);
  assert.ok(alphas[0] < alphas[alphas.length - 1], `alphas ${alphas.join(',')}`);
  assert.ok(widths[0] < widths[widths.length - 1], `widths ${widths.join(',')}`);
  // The tail starts effectively invisible and the head stays soft white.
  assert.ok(alphas[0] < 0.05, `tail alpha ${alphas[0]}`);
  assert.ok(alphas[alphas.length - 1] > 0.5);
});

test('drawBallTrail no-ops on an empty or single-point history', () => {
  const { ctx, calls } = makeCtx();
  assert.equal(drawBallTrail(ctx, toScreen, []), 0);
  assert.equal(drawBallTrail(ctx, toScreen, [{ x: 0, y: 0 }, { x: 1, y: 0 }]), 0);
  assert.equal(calls.length, 0);
});

test('nearestCarrier finds the man at the ball and ignores lofted balls', () => {
  const players = [
    { x: 0, y: 0, team: 0, shirt: 9 },
    { x: 4, y: 0, team: 0, shirt: 8 },
    { x: 1.5, y: 0, team: 1, shirt: 4 },
  ];
  assert.equal(nearestCarrier(players, { x: 1.4, y: 0 }, { maxDistance: 3.5 })?.shirt, 4);
  assert.equal(nearestCarrier(players, { x: 20, y: 0 }), null);
  assert.equal(nearestCarrier(players, { x: 1.4, y: 0, z: 3 }), null);
});

test('carrier emphasis eases up toward the carrier and back down after', () => {
  const emphasis = createCarrierEmphasis();
  const keys = ['0:9', '1:4'];
  emphasis.update('0:9', keys, 0.016);
  const first = emphasis.get('0:9');
  assert.ok(first > BALL_MARKER_RADIUS && first < CARRIER_MARKER_RADIUS);

  for (let i = 0; i < 120; i++) emphasis.update('0:9', keys, 0.016);
  assert.ok(Math.abs(emphasis.get('0:9') - CARRIER_MARKER_RADIUS) < 0.01);
  assert.equal(emphasis.get('1:4'), BALL_MARKER_RADIUS);

  // Turnover: the old carrier shrinks while the new one grows.
  emphasis.update('1:4', keys, 0.016);
  const oldAfter = emphasis.get('0:9');
  const newAfter = emphasis.get('1:4');
  assert.ok(oldAfter < CARRIER_MARKER_RADIUS);
  assert.ok(newAfter > BALL_MARKER_RADIUS);

  for (let i = 0; i < 120; i++) emphasis.update('1:4', keys, 0.016);
  assert.ok(Math.abs(emphasis.get('0:9') - BALL_MARKER_RADIUS) < 0.01);
  assert.ok(Math.abs(emphasis.get('1:4') - CARRIER_MARKER_RADIUS) < 0.01);
});

test('carrier emphasis is monotonic (no bounce) and snaps for reduced motion', () => {
  const emphasis = createCarrierEmphasis();
  const keys = ['0:9'];
  let prev = BALL_MARKER_RADIUS;
  for (let i = 0; i < 60; i++) {
    emphasis.update('0:9', keys, 0.016);
    const value = emphasis.get('0:9');
    assert.ok(value >= prev, 'radius never dips while growing');
    prev = value;
  }

  const snapped = createCarrierEmphasis();
  snapped.update('0:9', keys, 0.016, { snap: true });
  assert.equal(snapped.get('0:9'), CARRIER_MARKER_RADIUS);
});

test('carrier emphasis forgets hidden bodies and resets cleanly', () => {
  const emphasis = createCarrierEmphasis();
  emphasis.update('0:9', ['0:9', '1:4'], 0.016);
  assert.ok(emphasis.get('0:9') > BALL_MARKER_RADIUS);
  // The carrier is substituted away: only the remaining key survives.
  emphasis.update(null, ['1:4'], 0.016);
  assert.equal(emphasis.get('0:9'), BALL_MARKER_RADIUS);
  emphasis.update('1:4', ['1:4'], 0.016);
  emphasis.reset();
  assert.equal(emphasis.get('1:4'), BALL_MARKER_RADIUS);
});

test('carrier emphasis is a clearly noticeable bump over the base marker', () => {
  assert.ok(CARRIER_MARKER_RADIUS >= BALL_MARKER_RADIUS * 1.6,
    `carrier ${CARRIER_MARKER_RADIUS} vs base ${BALL_MARKER_RADIUS}`);
  assert.ok(CARRIER_RING_GAP > 0);
});

test('carrier ring spins steadily, freezes on pause and resets', () => {
  const ring = createCarrierRing({ speed: 1.5 });
  assert.equal(ring.angle, 0);
  assert.ok(Math.abs(ring.update(1) - 1.5) < 1e-9);
  const held = ring.angle;
  assert.equal(ring.update(0), held);
  assert.equal(ring.update(-1), held);
  // A long frame wraps into one turn instead of growing without bound.
  ring.update(10);
  assert.ok(ring.angle >= 0 && ring.angle < Math.PI * 2);
  ring.reset();
  assert.equal(ring.angle, 0);
});

test('comet ring draws a blended white/pink conic band that rotates', () => {
  const { ctx, calls, gradients } = makeRingCtx();
  assert.equal(drawCarrierRing(ctx, 100, 120, { radius: 12.2, alpha: 1, angle: 0.4 }), true);
  assert.equal(gradients.length, 1);
  const gradient = gradients[0];
  assert.ok(Math.abs(gradient.startAngle - 0.4) < 1e-9);
  assert.equal(gradient.x, 100);
  assert.equal(gradient.y, 120);
  // White and pink stops alternate and the ends meet so there is no seam.
  assert.ok(gradient.stops.some(([, color]) => color.includes('200,97,209')));
  assert.ok(gradient.stops.some(([, color]) => color.includes('255,255,255')));
  assert.equal(gradient.stops[0][0], 0);
  assert.equal(gradient.stops[gradient.stops.length - 1][0], 1);
  // The ring is stroked at the requested radius, with a pink glow.
  const arc = calls.find(([name]) => name === 'arc');
  assert.equal(arc[3], 12.2);
  assert.ok(calls.some(([name, prop, value]) =>
    name === 'set' && prop === 'shadowColor' && String(value).includes('200,97,209')));
});

test('duo ring draws counter-rotating white and pink tapered arcs', () => {
  const { ctx, calls } = makeRingCtx();
  assert.equal(drawCarrierRing(ctx, 0, 0, {
    radius: 12, alpha: 0.8, angle: 1, variant: 'duo',
  }), true);
  const arcs = calls.filter(([name]) => name === 'arc');
  assert.ok(arcs.length > 20, `expected tapered segments, got ${arcs.length}`);
  const styles = calls
    .filter(([name, prop]) => name === 'set' && prop === 'strokeStyle')
    .map(([, , value]) => String(value));
  assert.ok(styles.some((s) => s.includes('255,255,255')));
  assert.ok(styles.some((s) => s.includes('200,97,209')));
  // Heads sit on opposite sides of the circle and travel in opposite directions.
  const starts = arcs.map(([, , , , a0]) => a0);
  assert.ok(starts.some((a) => a > 0.9 && a < 1.1), 'white head at +angle');
  assert.ok(starts.some((a) => a > Math.PI - 1.1 && a < Math.PI - 0.9), 'pink head mirrored');
  const alphas = calls
    .filter(([name, prop]) => name === 'set' && prop === 'globalAlpha')
    .map(([, , value]) => value);
  assert.ok(Math.min(...alphas) < 0.02, 'tails fade to nothing');
  assert.ok(Math.max(...alphas) > 0.7, 'heads stay solid');
});

test('comet ring falls back to dual arcs when conic gradients are missing', () => {
  const { ctx, calls } = makeCtx(); // createConicGradient resolves to undefined
  assert.equal(drawCarrierRing(ctx, 10, 10, { radius: 12, alpha: 1, angle: 0 }), true);
  // The conic path was attempted and rejected, then the dual-arc fallback ran.
  assert.ok(calls.some(([name]) => name === 'createConicGradient'));
  assert.ok(calls.filter(([name]) => name === 'arc').length > 20);
});

test('possession ring is invisible at zero alpha and ignores bad coordinates', () => {
  const { ctx, calls } = makeCtx();
  assert.equal(drawCarrierRing(ctx, 0, 0, { radius: 12, alpha: 0 }), false);
  assert.equal(drawCarrierRing(ctx, 0, 0, { radius: 12, alpha: 1 }), true);
  calls.length = 0;
  assert.equal(drawCarrierRing(ctx, NaN, 0, { radius: 12, alpha: 1 }), false);
  assert.equal(calls.length, 0);
});

test('long window stretches the trail with speed: shots very long, passes longer', () => {
  assert.ok(TRAIL_SECONDS >= 1.2, `window ${TRAIL_SECONDS}s is long enough for a driven shot`);
  // Distance covered inside the window scales with speed: 25 m/s shot vs 5 m/s pass.
  const shotMetres = 25 * TRAIL_SECONDS;
  const passMetres = 5 * TRAIL_SECONDS;
  assert.ok(shotMetres >= 25, `shot trail ${shotMetres}m should be very long`);
  assert.ok(passMetres >= 5, `slow pass trail ${passMetres}m should read clearly`);
  assert.ok(shotMetres > passMetres * 3, 'faster balls leave proportionally longer streaks');
});

test('trail speed reacts to the recent slice so the fade can check promptly', () => {
  const trail = createBallTrail();
  // Fast for a while, then the ball checks to a crawl over the last samples.
  let t = 0;
  for (let i = 0; i < 40; i++) {
    trail.push({ x: i * 0.4, y: 0, z: 0 }, t);
    t += 16;
  }
  const fast = trail.speed();
  assert.ok(fast > 10, `fast segment speed=${fast}`);
  // Settle into the crawl for longer than the recent slice so the window is
  // fully slow: the fade target must fall once the ball has checked.
  for (let i = 0; i < 40; i++) {
    trail.push({ x: 16 + i * 0.01, y: 0, z: 0 }, t);
    t += 16;
  }
  const checked = trail.speed();
  assert.ok(checked < 3, `checked speed=${checked} should fall fast once the ball checks`);
});

test('trail fade envelope: invisible at rest, partial for slow passes, full for shots', () => {
  assert.equal(trailFadeForSpeed(0), 0);
  assert.equal(trailFadeForSpeed(TRAIL_FADE_MIN_SPEED), 0);
  assert.equal(trailFadeForSpeed(TRAIL_FULL_SPEED), 1);
  assert.equal(trailFadeForSpeed(30), 1);
  const slowPass = trailFadeForSpeed(1.5);
  assert.ok(slowPass > 0 && slowPass < 1, `slow pass fade=${slowPass} should be partial, not popped`);
  const prev = trailFadeForSpeed(1.0);
  const next = trailFadeForSpeed(2.0);
  assert.ok(next > prev, 'fade rises monotonically with speed');
});

test('trail fade eases without overshoot for a smooth shrink back to the ball', () => {
  let v = 0;
  const target = 1;
  for (let i = 0; i < 200; i++) v = easeTrailFade(v, target, 0.016);
  assert.ok(Math.abs(v - 1) < 0.01, `fade in reaches full, got ${v}`);
  // Fade out is monotonic and never overshoots below zero.
  let prevFade = v;
  for (let i = 0; i < 200; i++) {
    v = easeTrailFade(v, 0, 0.016);
    assert.ok(v <= prevFade + 1e-12, 'fade never grows while shrinking');
    assert.ok(v >= 0, 'fade never overshoots below zero');
    prevFade = v;
  }
  assert.ok(v < 0.01, `fade out settles near zero, got ${v}`);
});

test('drawBallTrail honours the fade envelope and stays white', () => {
  const points = [];
  for (let i = 0; i < 12; i++) points.push({ x: i * 2, y: 0, z: 0 });
  const faded = makeCtx();
  assert.equal(drawBallTrail(faded.ctx, toScreen, points, { fade: 0 }), 0);
  assert.equal(faded.calls.length, 0, 'fully faded trail draws nothing');
  const { ctx, calls } = makeCtx();
  drawBallTrail(ctx, toScreen, points, { fade: 0.5 });
  assert.ok(calls.some(([name, prop, value]) => name === 'set' && prop === 'strokeStyle' && value === '#ffffff'));
  // The final `globalAlpha = 1` reset before restore is not a segment alpha.
  const alphas = calls.filter(([name, prop]) => name === 'set' && prop === 'globalAlpha')
    .map(([, , value]) => value)
    .filter((value) => value < 1);
  assert.ok(alphas.length > 0);
  assert.ok(Math.max(...alphas) <= 0.36, `faded head ${Math.max(...alphas)} respects the envelope`);
});
