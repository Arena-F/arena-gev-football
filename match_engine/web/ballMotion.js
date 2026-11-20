// Ball trail + carrier emphasis.
//
// Three presentation-only layers live here so the renderer stays readable:
//
// - `createBallTrail` keeps a wall-clock history of ball positions. The
//   history is long (TRAIL_SECONDS) so the visible streak scales with speed:
//   a slow pass leaves a modest tail while a driven long shot leaves a very
//   long one. `drawBallTrail` tapers from a thin, transparent tail to a soft
//   white head, and follows the real trajectory so a cut or a bending pass
//   bends the line with it. Opacity rides a smoothed speed fade, so a
//   decelerating ball shrinks back to the ball instead of popping off.
// - `createCarrierEmphasis` eases one player's marker radius up while the ball
//   is at his feet and back down when it moves on. The state is a per-shirt
//   map, so a quick turnover grows the new carrier and shrinks the old one
//   without a pop.
// - `createCarrierRing` spins a team-colour possession band around that grown
//   marker; `drawCarrierRing` renders it and reads the same eased radius for
//   its size and hand-over fade.
//
// Wall-clock time keeps the trail the same length at every playback speed;
// sim-time would make it crawl at 0.25x and vanish at 8x.

export const TRAIL_SECONDS = 1.5;
export const TRAIL_MAX_POINTS = 160;
export const TRAIL_MIN_STEP_M = 0.01;
export const TRAIL_MIN_INTERVAL_MS = 14;
export const TRAIL_MIN_SPEED = 1.0; // m/s, below this the ball reads as stationary
export const TRAIL_FULL_SPEED = 3.5; // m/s, at and above this the trail is fully opaque
export const TRAIL_FADE_MIN_SPEED = 0.6; // m/s, below this the trail is fully transparent
export const TRAIL_SMOOTH_TAU = 0.18; // seconds, critically-damped ease for the fade in/out
export const TRAIL_RECENT_WINDOW_S = 0.4; // seconds, speed is measured over this trailing slice
export const TRAIL_MAX_JUMP_M = 12;

export const BALL_MARKER_RADIUS = 5;
export const CARRIER_MARKER_RADIUS = 8;
export const CARRIER_TAU = 0.14;

// Possession ring: a team-colour band that spins around the carrier's grown
// marker. The radius rides on the emphasis radius, so the ring widens with the
// body and hands over to the next carrier at exactly the same pace.
export const CARRIER_RING_GAP = 3.2; // px between body edge and ring centreline
export const CARRIER_RING_WIDTH = 2;
export const CARRIER_RING_SPIN = 1.5; // rad/s, roughly one turn every 4.2 s

/**
 * Long rolling history of ball positions in world metres.
 *
 * `now` is a wall-clock timestamp in milliseconds. Samples are throttled and
 * de-duplicated, but the newest sample always tracks the live ball so the
 * trail head never lags a metre behind during a fast break.
 */
export function createBallTrail(options = {}) {
  const seconds = Number.isFinite(options.seconds) ? options.seconds : TRAIL_SECONDS;
  const maxPoints = options.maxPoints ?? TRAIL_MAX_POINTS;
  const minStep = options.minStep ?? TRAIL_MIN_STEP_M;
  const minInterval = options.minInterval ?? TRAIL_MIN_INTERVAL_MS;
  // A single frame that moves the ball further than any match-speed pass
  // (even at 8x) is an engine teleport — a kickoff, a restart, a seek. Start
  // a fresh history instead of drawing a streak across the pitch.
  const maxJump = options.maxJump ?? TRAIL_MAX_JUMP_M;
  const points = [];
  let lastPush = -Infinity;
  let lastX = NaN;
  let lastY = NaN;

  function trim() {
    while (points.length > maxPoints) points.shift();
  }

  return {
    points,
    /**
     * Record one frame of ball movement. Returns true when a new sample was
     * kept, false when the frame was throttled or the ball barely moved.
     */
    push(pos, now) {
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
      if (!Number.isFinite(now)) return false;
      const z = Number.isFinite(pos.z) ? pos.z : 0;
      const moved = Number.isFinite(lastX) ? Math.hypot(pos.x - lastX, pos.y - lastY) : Infinity;
      if (moved > maxJump) {
        // Teleport: the engine re-spotted the ball. Drop the stale history so
        // no phantom line is drawn from the old spot to the new one.
        points.length = 0;
        lastPush = -Infinity;
        lastX = NaN;
        lastY = NaN;
        points.push({ x: pos.x, y: pos.y, z, t: now });
        lastPush = now;
        lastX = pos.x;
        lastY = pos.y;
        return true;
      }
      if (moved < minStep || now - lastPush < minInterval) {
        // Keep the live head glued to the ball without adding degenerate
        // samples: a stopped ball should not grow a pile of identical points.
        if (points.length > 0) {
          const head = points[points.length - 1];
          head.x = pos.x;
          head.y = pos.y;
          head.z = z;
        }
        return false;
      }
      points.push({ x: pos.x, y: pos.y, z, t: now });
      lastPush = now;
      lastX = pos.x;
      lastY = pos.y;
      while (points.length > 0 && now - points[0].t > seconds * 1000) points.shift();
      trim();
      return true;
    },
    /** Drop samples older than the rolling window. */
    prune(now) {
      if (!Number.isFinite(now)) return;
      while (points.length > 0 && now - points[0].t > seconds * 1000) points.shift();
    },
    /** Ground speed over the trailing slice, in m/s. */
    speed() {
      if (points.length < 2) return 0;
      const head = points[points.length - 1];
      // Measure over the recent slice so the fade reacts the moment the ball
      // checks its run: averaging the whole 1.5 s window would keep reporting
      // a fast mean long after the ball has stopped, and the line would hang
      // around instead of easing back to the ball.
      const cutoff = head.t - TRAIL_RECENT_WINDOW_S * 1000;
      let from = points[0];
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].t <= cutoff) {
          from = points[i];
          break;
        }
        from = points[i];
      }
      let span = (head.t - from.t) / 1000;
      if (span < 0.06) {
        // A freshly restarted trail only has a couple of samples; use the
        // shortest usable span rather than reporting zero speed.
        from = points[points.length - 2];
        span = (head.t - from.t) / 1000;
      }
      if (!(span > 0)) return 0;
      return Math.hypot(head.x - from.x, head.y - from.y) / span;
    },
    clear() {
      points.length = 0;
      lastPush = -Infinity;
      lastX = NaN;
      lastY = NaN;
    },
  };
}

/**
 * Smooth 0..1 visibility envelope for a ground speed in m/s.
 *
 * 0 at or below TRAIL_FADE_MIN_SPEED, 1 at or above TRAIL_FULL_SPEED, with a
 * smootherstep ramp between so a ball easing through the threshold fades the
 * line in and out instead of popping it. Slow passes (~1-2 m/s) read as a
 * soft partial tail; driven shots (>= 3.5 m/s) read at full strength.
 */
export function trailFadeForSpeed(speed) {
  if (!Number.isFinite(speed)) return 0;
  const lo = TRAIL_FADE_MIN_SPEED;
  const hi = TRAIL_FULL_SPEED;
  if (speed <= lo) return 0;
  if (speed >= hi) return 1;
  const t = (speed - lo) / (hi - lo);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Critically-damped step toward a fade target: no overshoot, no pop. */
export function easeTrailFade(current, target, dt, tau = TRAIL_SMOOTH_TAU) {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  if (!(dt > 0) || !(tau > 0)) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  if (Math.abs(next - target) < 0.002) return target;
  return Math.max(0, Math.min(1, next));
}

/**
 * Nearest visible player to the ball, ignoring bodies the viewer cannot see.
 * The altitude cap keeps a defender underneath a lofted pass from lighting up
 * while the ball is still in the air.
 */
export function nearestCarrier(players, ball, options = {}) {
  const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : 3.5;
  const maxLift = Number.isFinite(options.maxLift) ? options.maxLift : 1.2;
  if (!players || !players.length || !ball) return null;
  if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y)) return null;
  if (Number.isFinite(ball.z) && ball.z > maxLift) return null;
  let best = null;
  let bestD = maxDistance;
  for (const p of players) {
    const d = Math.hypot(p.x - ball.x, p.y - ball.y);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * Smooth, interruptible marker radius per `team:shirt`.
 *
 * `update` is fed the current carrier key plus every visible key each frame.
 * Each radius eases from its live value toward the target with an exponential
 * decay (critically damped, no overshoot), so a change of possession reads as
 * one body growing while the other settles back, never as a jump.
 */
export function createCarrierEmphasis(options = {}) {
  const base = Number.isFinite(options.base) ? options.base : BALL_MARKER_RADIUS;
  const emphasis = Number.isFinite(options.emphasis) ? options.emphasis : CARRIER_MARKER_RADIUS;
  const tau = Number.isFinite(options.tau) && options.tau > 0 ? options.tau : CARRIER_TAU;
  const radii = new Map();

  return {
    get(key) {
      return radii.has(key) ? radii.get(key) : base;
    },
    update(carrierKey, keys, dt, updateOptions = {}) {
      const snap = updateOptions.snap === true;
      const live = new Set(keys);
      // Substituted or hidden bodies leave the map so a recycled shirt never
      // inherits a stale radius.
      for (const key of radii.keys()) {
        if (!live.has(key)) radii.delete(key);
      }
      for (const key of keys) {
        const target = key === carrierKey ? emphasis : base;
        const current = radii.has(key) ? radii.get(key) : base;
        let next;
        if (snap) {
          next = target;
        } else if (Number.isFinite(dt) && dt > 0) {
          next = current + (target - current) * (1 - Math.exp(-dt / tau));
          if (Math.abs(next - target) < 0.005) next = target;
        } else {
          // No elapsed time: hold the presentation value instead of snapping.
          next = current;
        }
        radii.set(key, next);
      }
    },
    reset() {
      radii.clear();
    },
    get base() {
      return base;
    },
    get emphasis() {
      return emphasis;
    },
  };
}

/**
 * Draw the trail from a history of world-space samples.
 *
 * Each segment is a quadratic through the sample points (midpoint-to-midpoint),
 * so the line bends with the ball rather than reading as a chain of straight
 * chords. Width and opacity ramp from nothing at the tail to a soft white head
 * under the ball; the round caps keep the tail from ending in a hard pixel.
 * `fade` (0..1) is a global envelope for the smooth speed fade: the caller
 * eases it toward the speed target, so a slowing ball dissolves back to the
 * ball instead of blinking off.
 */
export function drawBallTrail(ctx, toScreen, points, options = {}) {
  if (!ctx || !points || points.length < 3) return 0;
  const fade = clamp01(Number.isFinite(options.fade) ? options.fade : 1);
  if (fade <= 0.01) return 0;
  const maxAlpha = (Number.isFinite(options.alpha) ? options.alpha : 0.7) * fade;
  const maxWidth = Number.isFinite(options.width) ? options.width : 2.6;
  const minWidth = Number.isFinite(options.minWidth) ? options.minWidth : 0.3;
  const lift = Number.isFinite(options.lift) ? options.lift : 3.0;
  const pts = points.map((p) => {
    const [x, y] = toScreen(p.x, p.y);
    return { x, y: y - (Number.isFinite(p.z) ? p.z : 0) * lift };
  });
  const n = pts.length;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  // Tail first so the brighter head is painted last and reads continuous.
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1);
    const prev = pts[i - 1];
    const here = pts[i];
    const next = i < n - 1 ? pts[i + 1] : null;
    const x0 = (prev.x + here.x) / 2;
    const y0 = (prev.y + here.y) / 2;
    const x1 = next ? (here.x + next.x) / 2 : here.x;
    const y1 = next ? (here.y + next.y) / 2 : here.y;
    ctx.globalAlpha = maxAlpha * Math.pow(t, 1.6);
    ctx.lineWidth = minWidth + (maxWidth - minWidth) * Math.pow(t, 0.85);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(here.x, here.y, x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return n - 1;
}

// ── Possession ring ────────────────────────────────────────────
// The ring is deliberately presentation-only: it reads the same eased carrier
// radius the body uses, so a change of possession is one continuous motion
// (old body shrinks, new body grows, old ring fades, new ring fades in) with no
// frame where two rings sit at full strength or none does.

const TAU = Math.PI * 2;
import { hexCss, BRAND } from './brand.js';

const RING_DEFAULT = hexCss(BRAND.secondary); // Arena secondary (pink 500)

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/**
 * Rotation state for the possession ring. Kept separate from the radius
 * emphasis so the spin can freeze while paused/reduced-motion without
 * disturbing the hand-over easing.
 */
export function createCarrierRing(options = {}) {
  const speed = Number.isFinite(options.speed) ? options.speed : CARRIER_RING_SPIN;
  let angle = Number.isFinite(options.angle) ? options.angle : 0;
  return {
    get angle() {
      return angle;
    },
    update(dt, updateOptions = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return angle;
      const spin = Number.isFinite(updateOptions.speed) ? updateOptions.speed : speed;
      angle = (angle + dt * spin) % TAU;
      if (angle < 0) angle += TAU;
      return angle;
    },
    reset() {
      angle = 0;
    },
  };
}

/**
 * One tapered arc: `steps` round-capped segments whose opacity ramps from
 * nothing at the tail to full at the head. Segment overlap hides the seams, and
 * the round caps keep the low-alpha end from reading as a dotted line.
 */
function strokeRingArc(ctx, x, y, radius, width, alpha, angle, span, rgb) {
  const steps = 24;
  ctx.strokeStyle = `rgba(${rgb},1)`;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    ctx.globalAlpha = alpha * t * t;
    ctx.beginPath();
    ctx.arc(x, y, radius, angle + span * (i / steps) - 0.02, angle + span * t + 0.02);
    ctx.stroke();
  }
}

/**
 * Single rotating conic band in the team colour: bright and dim stops meet
 * through blended edges, so the band reads as one continuous rotating comet
 * with no white in it. Returns false when the browser (or a headless canvas
 * stub) has no conic gradient support, letting the caller fall back to the
 * dual-arc look.
 */
function strokeConicRing(ctx, x, y, radius, width, alpha, angle, rgb) {
  if (typeof ctx.createConicGradient !== 'function') return false;
  let gradient;
  try {
    gradient = ctx.createConicGradient(angle, x, y);
  } catch {
    return false;
  }
  if (!gradient || typeof gradient.addColorStop !== 'function') return false;
  gradient.addColorStop(0, `rgba(${rgb},0.98)`);
  gradient.addColorStop(0.16, `rgba(${rgb},0.45)`);
  gradient.addColorStop(0.33, `rgba(${rgb},0.99)`);
  gradient.addColorStop(0.5, `rgba(${rgb},0.98)`);
  gradient.addColorStop(0.66, `rgba(${rgb},0.45)`);
  gradient.addColorStop(0.83, `rgba(${rgb},0.99)`);
  gradient.addColorStop(1, `rgba(${rgb},0.98)`);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = gradient;
  ctx.lineWidth = width;
  ctx.shadowColor = `rgba(${rgb},0.7)`;
  ctx.shadowBlur = width * 2.4;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();
  ctx.restore();
  return true;
}

/**
 * Team-colour possession ring around a grown carrier marker — no white.
 *
 * `variant: 'comet'` (default) is one continuous conic gradient band in the
 * team colour whose bright and dim stops blend into each other as it spins;
 * `duo` is two counter-rotating tapered team-colour arcs (full strength one
 * way, half strength the other) that brighten where they cross; `dotted` is
 * a dashed team-colour circle whose dash offset spins with the ring, so the
 * dots travel around the carrier. `rgb` is the carrier's team as an 'r,g,b'
 * string (blue for home, pink for away); it defaults to Arena secondary.
 * Every variant respects `alpha` for the carrier hand-over fade, and comet
 * falls back to the dual arcs when conic gradients are unavailable.
 */
export function drawCarrierRing(ctx, x, y, options = {}) {
  if (!ctx || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const radius = Number.isFinite(options.radius) ? options.radius : 12;
  if (!(radius > 0)) return false;
  const width = Number.isFinite(options.width) && options.width > 0
    ? options.width
    : CARRIER_RING_WIDTH;
  const alpha = clamp01(Number.isFinite(options.alpha) ? options.alpha : 1);
  if (alpha <= 0.01) return false;
  const angle = Number.isFinite(options.angle) ? options.angle : 0;
  const variant = options.variant === 'dotted' ? 'dotted' : options.variant === 'duo' ? 'duo' : 'comet';
  const rgb = typeof options.rgb === 'string' && options.rgb ? options.rgb : RING_DEFAULT;

  ctx.save();
  ctx.setLineDash([]);
  if (variant === 'comet' && strokeConicRing(ctx, x, y, radius, width, alpha, angle, rgb)) {
    ctx.restore();
    return true;
  }

  if (variant === 'dotted') {
    // Dotted: a faint team-colour base for continuity plus a dashed circle
    // whose offset spins with the ring angle, so the dots travel round it.
    // Round caps turn each dash into a dot.
    ctx.globalAlpha = alpha * 0.18;
    ctx.strokeStyle = `rgba(${rgb},1)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgba(${rgb},1)`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 6.5]);
    ctx.lineDashOffset = -angle * radius;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    return true;
  }

  // Duo, and the comet fallback: two arcs spinning in opposite directions.
  // The faint base ring anchors the geometry so the arcs read as one band.
  ctx.globalAlpha = alpha * 0.18;
  ctx.strokeStyle = `rgba(${rgb},1)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  strokeRingArc(ctx, x, y, radius, width, alpha, angle, 2.5, rgb);
  strokeRingArc(ctx, x, y, radius, width, alpha * 0.55, Math.PI - angle, 2.5, rgb);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.restore();
  return true;
}
