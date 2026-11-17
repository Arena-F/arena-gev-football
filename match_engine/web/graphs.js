// Match graphs: momentum/xT timeline, passing network, shot map (all Canvas,
// all renderer-side, all fed by engine getters + analysis maths).
//
// Nothing here touches the sim: graphs accumulate from the same snapshots
// the overlays use, so halftime/fulltime views are free at any seek point.

import { shotXg, xtAt, xtGain } from './analysis.js';

/**
 * Normalize the engine's u64 event cursor. wasm-bindgen exposes u64 as a JS
 * BigInt, and mixing BigInt with Number throws; unknown cursors map to -1.
 */
export function seqNumber(v) {
  return typeof v === 'bigint' ? Number(v) : (v ?? -1);
}

/**
 * Cumulative threat timeline. Feed rows drive it: completed passes add
 * xT gain, shots add xG, goals/cards mark the line. One series per team.
 */
export function createMomentumTracker() {
  let home = [];
  let away = [];
  let lastKey = -1;

  function observe(key, rows) {
    if (key === lastKey) return;
    lastKey = key;
    for (const r of rows) {
      const series = r.team === 0 ? home : r.team === 1 ? away : null;
      if (!series) continue;
      const prev = series.length ? series[series.length - 1].v : 0;
      series.push({ t: r.t, v: prev + (r.dv || 0), label: r.label, type: r.type });
    }
  }

  function reset() {
    home = [];
    away = [];
    lastKey = -1;
  }

  return { observe, reset, get home() { return home; }, get away() { return away; } };
}

/** Value of a feed row for the momentum strip (model estimates). */
export function rowValue(type, label) {
  if (type === 16) return { dv: 1.0, big: true };
  if (type === 15 || type === 13 || type === 14) return { dv: 0.12, big: true };
  if (type === 17) return { dv: 0.0, big: true };
  if (type === 1 || type === 2) return { dv: 0.015, big: false };
  return { dv: 0.0, big: false };
}

/**
 * Passing network: average positions + weighted links from completed passes.
 *
 * Two modes share one accumulator:
 * - `mesh` (match-long): every roster shirt is a node. Nodes are grouped into
 *   dynamic DEF / MID / FWD bands from live shape (see below) and each band
 *   is chained end to end across the pitch width, so a band of four reads as
 *   three short links instead of six crossing diagonals. Pairs with real pass
 *   history always draw their own wire on top and step up their ladder, so an
 *   overloading full-back or a dropping striker never loses his earned
 *   channel when the bands regroup.
 * - `outlet` (possession-window): each player keeps exactly one wire — his
 *   most-used teammate in his own dynamic band in the current run of
 *   possession. The window clears on a turnover, so the shape always
 *   describes the attack being watched.
 *
 * Dynamic bands: a player's band follows his live attacking depth, not just
 * his listed role. Anchors are the live role-line means; a midfielder who
 * pushes beyond the forward line (plus a hysteresis margin) joins the attack
 * band and chains with the strikers, and dropping back returns him to the
 * midfield — and eventually the defence — band. The same rule promotes and
 * demotes every line, so a formation change, an overlapping full-back or a
 * deep-lying forward regroups the webs automatically. Band switches need a
 * decisive crossing (BAND_HYSTERESIS_M past the boundary) and previously
 * seen shirts hold their band inside the margin, so a winger hovering on the
 * line never flaps between webs. Inverted boundaries (scrambled shapes, lone
 * outliers) collapse to one line, so depths near it keep their listed role
 * until the lines separate again.
 *
 * When the roster carries engine roles, snapshots are unit-aware: the
 * goalkeeper and unknown roles are dropped. Callers without roles keep the
 * legacy whole-team behaviour.
 */
// Link weight halves roughly every two minutes without a pass, so a pair
// that stopped combining thins back into the quiet mesh instead of staying a
// thick wire for the rest of the match.
export const NETWORK_DECAY_TAU = 180;
const WINDOW_LINK_DECAY_TAU = 90;

/** Units that own a passing web. */
export const NETWORK_UNITS = Object.freeze(['def', 'mid', 'fwd']);

const BAND_RANK = Object.freeze({ def: 0, mid: 1, fwd: 2 });

/**
 * Hysteresis margin in metres for dynamic band promotion/demotion. A player
 * must be this far past the inter-line boundary to change bands, and a
 * previously seen shirt holds its band inside the margin — so a winger
 * hovering on the forward line never flaps between webs frame to frame.
 */
export const BAND_HYSTERESIS_M = 2.5;

/**
 * Pass-count thresholds for the link-strength ladder, per unit. A link with
 * decayed weight `n` sits at level 0 below `GHOST_MAX`, level 1 up to the
 * second threshold, and so on: DEF 1/4/10/22, MID 1/3/8/18, FWD 1/2/5/12.
 * Forwards brighten sooner because they see less of the ball.
 */
export const NETWORK_UNIT_THRESHOLDS = Object.freeze({
  def: Object.freeze([1, 4, 10, 22]),
  mid: Object.freeze([1, 3, 8, 18]),
  fwd: Object.freeze([1, 2, 5, 12]),
});

/** Decayed weights below this read as a zero-pass ghost thread. */
const GHOST_MAX = 0.05;

/**
 * Unit for an engine role: 2 → defenders, 3 → midfielders, 4 → attackers.
 * Goalkeepers, unknown roles and anything else own no web.
 */
export function networkUnit(role) {
  if (role === 2) return 'def';
  if (role === 3) return 'mid';
  if (role === 4) return 'fwd';
  return null;
}

/**
 * Strength level 0–4 for a decayed link weight in `unit`. Level 0 is the
 * ghost thread; levels 1–4 step up at the unit's pass thresholds.
 */
export function networkLevel(unit, n) {
  if (!Number.isFinite(n) || n <= GHOST_MAX) return 0;
  const t = NETWORK_UNIT_THRESHOLDS[unit] ?? NETWORK_UNIT_THRESHOLDS.mid;
  if (n >= t[3]) return 4;
  if (n >= t[2]) return 3;
  if (n >= t[1]) return 2;
  return 1;
}

/**
 * Live role-line anchors (oriented attacking depth) for dynamic bands, from
 * roster/touch entries carrying `{ d, roleBand }`. Missing lines extrapolate
 * 8 m beyond the nearest known line. Returns null when no entry has a usable
 * depth — the caller then falls back to listed roles.
 */
function bandAnchors(entries) {
  const ds = { def: [], mid: [], fwd: [] };
  for (const e of entries) {
    if (e.roleBand && Number.isFinite(e.d)) ds[e.roleBand].push(e.d);
  }
  if (!ds.def.length && !ds.mid.length && !ds.fwd.length) return null;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const all = [...ds.def, ...ds.mid, ...ds.fwd];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  let defA = ds.def.length ? mean(ds.def) : null;
  let midA = ds.mid.length ? mean(ds.mid) : null;
  let fwdA = ds.fwd.length ? mean(ds.fwd) : null;
  if (defA === null) defA = Math.min(midA ?? hi, fwdA ?? hi) - 8;
  if (fwdA === null) fwdA = Math.max(midA ?? lo, defA ?? lo) + 8;
  if (midA === null) midA = (defA + fwdA) / 2;
  return { defA, midA, fwdA };
}

/** Raw band from oriented depth: listed role wins near the boundaries. */
function rawBandFor(d, roleBand, b1, b2) {
  const M = BAND_HYSTERESIS_M;
  if (!Number.isFinite(d)) return roleBand;
  if (roleBand === 'def') {
    if (d > b1 + M) return d > b2 + M ? 'fwd' : 'mid';
    return 'def';
  }
  if (roleBand === 'fwd') {
    if (d < b2 - M) return d < b1 - M ? 'def' : 'mid';
    return 'fwd';
  }
  if (d > b2 + M) return 'fwd';
  if (d < b1 - M) return 'def';
  return 'mid';
}

/** Confirm a band switch: the depth must be decisively past the boundary. */
function confirmBandSwitch(d, from, to, b1, b2) {
  const M = BAND_HYSTERESIS_M;
  if (!Number.isFinite(d)) return false;
  if (to === 'fwd' && from !== 'fwd') return d > b2 + M;
  if (to === 'def' && from !== 'def') return d < b1 - M;
  if (to === 'mid') {
    if (from === 'fwd') return d < b2 - M;
    if (from === 'def') return d > b1 + M;
  }
  return true;
}

/**
 * Assign every entry to a dynamic band and remember it on `prev` (the
 * network's band memory, mutated in place). A role change or a new shirt
 * takes the depth-implied band at once; otherwise a switch needs a decisive
 * crossing so shirts hold their band inside the margin. Inverted boundaries
 * (scrambled shapes, single-line outliers) collapse to one line, so depths
 * near it keep their listed role until the lines separate again.
 *
 * Returns a Map of key -> band.
 */
function assignBands(entries, anchors, prev) {
  const next = new Map();
  if (!anchors) {
    for (const e of entries) {
      const band = e.roleBand ?? 'mid';
      next.set(e.key, band);
    }
    return next;
  }
  const { defA, midA, fwdA } = anchors;
  let b1 = (defA + midA) / 2;
  let b2 = (midA + fwdA) / 2;
  if (b1 > b2) {
    const m = (b1 + b2) / 2;
    b1 = m;
    b2 = m;
  }
  for (const e of entries) {
    const roleBand = e.roleBand ?? 'mid';
    const cand = rawBandFor(e.d, roleBand, b1, b2);
    const p = prev.get(e.key);
    let band = cand;
    if (p && p.role === e.role && cand !== p.band &&
        !confirmBandSwitch(e.d, p.band, cand, b1, b2)) {
      band = p.band;
    }
    prev.set(e.key, { band, role: e.role });
    next.set(e.key, band);
  }
  return next;
}

/**
 * Minimal end-to-end chain for one band: members sorted across the pitch
 * width, consecutive pairs linked. With similar depths the polyline cannot
 * wrap around bodies, and the total length is the band's lateral span.
 */
function chainLinks(members) {
  const sorted = members.slice().sort((a, b) => (a.y - b.y) || (a.shirt - b.shirt));
  const edges = [];
  for (let i = 1; i < sorted.length; i++) edges.push([sorted[i - 1].key, sorted[i].key]);
  return edges;
}

export function createPassingNetwork() {
  const touches = new Map(); // key team:shirt -> {x,y,n}
  const links = new Map(); // key from>to -> n
  const linkLast = new Map(); // key from>to -> last pass sim time
  const windowTouches = new Map();
  const windowLinks = new Map();
  const windowLinkLast = new Map();
  // Dynamic band memory: key team:shirt -> { band, role }. Bands follow live
  // depth with hysteresis, so a shirt holds its band inside the margin instead
  // of flapping when two lines run level.
  const bandOf = new Map();
  let lastTeam = null;
  let streak = 0;
  // Match-long memory is tunable from the UI; the outlet window is kept
  // shorter so a possession's shape stays responsive.
  let meshTau = NETWORK_DECAY_TAU;

  function addTouch(map, p) {
    const k = `${p.team}:${p.shirt}`;
    const t = map.get(k) ?? { x: 0, y: 0, n: 0, team: p.team, shirt: p.shirt, role: p.role };
    t.x += p.x;
    t.y += p.y;
    t.n += 1;
    // Keep the latest observed role so touch-only nodes (no roster entry)
    // can still join their unit's web. Roster roles win at snapshot time.
    if (p.role !== undefined) t.role = p.role;
    map.set(k, t);
  }

  function addLink(map, key, time) {
    map.set(key, (map.get(key) ?? 0) + 1);
    return time;
  }

  function clearWindow() {
    windowTouches.clear();
    windowLinks.clear();
    windowLinkLast.clear();
  }

  function observePass(from, to, time = null) {
    if (!from || !to) return;
    const at = Number.isFinite(time) ? time : null;
    // Both ends of a pass are touches: the passer and the receiver both need
    // a node, otherwise links to a player who has not passed yet disappear.
    addTouch(touches, from);
    addTouch(touches, to);
    const lk = `${from.team}:${from.shirt}>${to.team}:${to.shirt}`;
    addLink(links, lk, at);
    if (at !== null) linkLast.set(lk, at);
    // Retention: consecutive passes by the same team build the streak.
    if (from.team === to.team) {
      if (lastTeam === from.team && streak > 0) {
        streak += 1;
      } else {
        // New possession sequence: the outlet window starts here.
        clearWindow();
        lastTeam = from.team;
        streak = 1;
      }
      addTouch(windowTouches, from);
      addTouch(windowTouches, to);
      addLink(windowLinks, lk, at);
      if (at !== null) windowLinkLast.set(lk, at);
    } else {
      lastTeam = null;
      streak = 0;
      clearWindow();
    }
  }

  /**
   * Snapshot of the network.
   *
   * `roster` (optional) is the followed team's live squad: when supplied,
   * every listed shirt becomes a node (even with zero touches). Roster
   * entries may carry the engine `role`; when any roster role maps to a
   * unit, the snapshot is unit-aware: the goalkeeper is dropped and nodes
   * are grouped into dynamic DEF / MID / FWD bands from live shape, each
   * tagged with its band as `unit`.
   *
   * `mode` selects the link rule:
   * - `'mesh'` (default) chains each band end to end across the pitch width
   *   (minimal total length, no wrap-around) and adds a direct wire for every
   *   pair with real pass history, so earned channels survive regroups;
   * - `'outlet'` keeps one wire per player to his top same-band teammate in
   *   the current possession window, so the layer reads as this attack's
   *   shape.
   */
  function snapshot(topLinks = 5, team = null, roster = null, mode = 'mesh', time = null) {
    const teamFilter = team === 0 || team === 1 ? team : null;
    const outlet = mode === 'outlet';
    const sourceTouches = outlet ? windowTouches : touches;
    const sourceLinks = outlet ? windowLinks : links;
    const sourceLast = outlet ? windowLinkLast : linkLast;
    const tau = outlet ? Math.max(20, meshTau * 0.5) : meshTau;
    const at = Number.isFinite(time) ? time : null;
    // Unit-aware when the caller knows roles: any roster role that maps to
    // a unit switches the snapshot from the legacy whole-team web to three
    // independent DEF / MID / FWD webs.
    const unitMode = Array.isArray(roster) && roster.some((r) => r && networkUnit(r.role) !== null);
    const roleByKey = new Map();
    if (unitMode) {
      for (const r of roster) {
        if (!r) continue;
        roleByKey.set(`${r.team}:${r.shirt}`, r.role);
      }
    }
    const unitForKey = (key, touch) => {
      if (!unitMode) return null;
      if (roleByKey.has(key)) return networkUnit(roleByKey.get(key));
      if (touch && touch.role !== undefined) return networkUnit(touch.role);
      return null;
    };
    const weightOf = (key) => {
      const raw = sourceLinks.get(key) ?? 0;
      if (at === null || raw <= 0) return raw;
      const last = sourceLast.get(key);
      if (!Number.isFinite(last)) return raw;
      return raw * Math.exp(-Math.max(0, at - last) / tau);
    };
    const nodes = [];
    const nodeByKey = new Map();

    // Dynamic bands from live shape: roster spots use live positions (so an
    // overlapping run promotes the runner mid-attack), touch-only shirts fall
    // back to their average spot. Oriented depth puts the attack at +x for
    // both teams.
    const bandEntries = [];
    const seenEntry = new Set();
    const entryDir = (team) => (team === 1 ? -1 : 1);
    for (const r of roster ?? []) {
      if (!r) continue;
      if (teamFilter !== null && r.team !== teamFilter) continue;
      const roleBand = networkUnit(r.role);
      if (unitMode && roleBand === null) continue;
      const key = `${r.team}:${r.shirt}`;
      if (seenEntry.has(key)) continue;
      seenEntry.add(key);
      bandEntries.push({
        key,
        d: Number.isFinite(r.x) ? r.x * entryDir(r.team) : NaN,
        y: Number.isFinite(r.y) ? r.y : 0,
        shirt: r.shirt,
        role: r.role,
        roleBand,
      });
    }
    for (const [key, t] of sourceTouches) {
      if (seenEntry.has(key)) continue;
      if (teamFilter !== null && t.team !== teamFilter) continue;
      const roleBand = networkUnit(t.role);
      if (unitMode && roleBand === null) continue;
      seenEntry.add(key);
      const n = Math.max(1, t.n);
      bandEntries.push({
        key,
        d: Number.isFinite(t.x) ? (t.x / n) * entryDir(t.team) : NaN,
        y: Number.isFinite(t.y) ? t.y / n : 0,
        shirt: t.shirt,
        role: t.role,
        roleBand,
      });
    }
    const bandByKey = unitMode
      ? assignBands(bandEntries, bandAnchors(bandEntries), bandOf)
      : new Map();

    function addNode(key, fallback, fallbackUnit = null) {
      if (nodeByKey.has(key)) return;
      const t = sourceTouches.get(key);
      const unit = unitMode ? (bandByKey.get(key) ?? unitForKey(key, t) ?? fallbackUnit) : null;
      if (unitMode && unit === null) return;
      const node = t
        ? {
            x: t.x / Math.max(1, t.n),
            y: t.y / Math.max(1, t.n),
            n: t.n,
            team: t.team,
            shirt: t.shirt,
            unit,
          }
        : { ...fallback, unit };
      nodes.push(node);
      nodeByKey.set(key, node);
    }

    for (const r of roster ?? []) {
      if (!r) continue;
      if (teamFilter !== null && r.team !== teamFilter) continue;
      const key = `${r.team}:${r.shirt}`;
      addNode(key, {
        x: Number.isFinite(r.x) ? r.x : 0,
        y: Number.isFinite(r.y) ? r.y : 0,
        n: 0,
        team: r.team,
        shirt: r.shirt,
      }, networkUnit(r.role));
    }
    for (const [key, t] of sourceTouches) {
      if (teamFilter !== null && t.team !== teamFilter) continue;
      addNode(key, {
        x: t.x / Math.max(1, t.n),
        y: t.y / Math.max(1, t.n),
        n: t.n,
        team: t.team,
        shirt: t.shirt,
      });
    }

    let out;
    if (outlet) {
      // One outgoing wire per player: his most-used teammate in his own
      // dynamic band this window. Bands follow live shape, so the wire tracks
      // the attack as it is, not the teamsheet.
      const bestOut = new Map();
      for (const key of sourceLinks.keys()) {
        const n = weightOf(key);
        if (n <= 0) continue;
        const [a, b] = key.split('>');
        const nodeA = nodeByKey.get(a);
        const nodeB = nodeByKey.get(b);
        if (!nodeA || !nodeB) continue;
        if (unitMode && (nodeA.unit == null || nodeA.unit !== nodeB.unit)) continue;
        const cur = bestOut.get(a);
        if (!cur || n > cur.n) bestOut.set(a, { b, n, unit: unitMode ? nodeA.unit : null });
      }
      // If two players choose each other, draw one wire rather than two.
      const pairs = new Map();
      for (const [a, { b, n, unit }] of bestOut) {
        const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
        const cur = pairs.get(pair);
        if (!cur || n > cur.n) pairs.set(pair, { a, b, n, unit });
      }
      out = [...pairs.values()].sort((x, y) => x.n - y.n);
      if (!roster || roster.length === 0) {
        out = out.slice(-Math.max(0, topLinks));
      }
    } else if (roster && roster.length > 0) {
      // Minimal end-to-end chains per dynamic band plus every earned wire.
      // The chain gives each band its smallest total length (a back four reads
      // as three short links, never six crossing diagonals), and any pair with
      // real pass history keeps its direct wire — coloured by the higher band
      // — so earned channels survive regroups and phase changes.
      const seen = new Set();
      out = [];
      const pushLink = (ka, kb, unit) => {
        const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seen.has(pair)) return;
        seen.add(pair);
        out.push({
          a: ka,
          b: kb,
          n: weightOf(`${ka}>${kb}`) + weightOf(`${kb}>${ka}`),
          ...(unitMode ? { unit } : {}),
        });
      };
      if (unitMode) {
        // 1. Earned wires first: any pair above the ghost floor draws direct,
        // whatever bands the two currently sit in.
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            if (a.unit == null || b.unit == null) continue;
            const ka = `${a.team}:${a.shirt}`;
            const kb = `${b.team}:${b.shirt}`;
            const w = weightOf(`${ka}>${kb}`) + weightOf(`${kb}>${ka}`);
            if (!(w > GHOST_MAX)) continue;
            pushLink(ka, kb, BAND_RANK[a.unit] >= BAND_RANK[b.unit] ? a.unit : b.unit);
          }
        }
        // 2. Chain each band end to end across the pitch width. Earned pairs
        // already in `seen` keep their wire; the rest get the light baseline.
        const byBand = new Map();
        for (const n of nodes) {
          if (n.unit == null) continue;
          const ka = `${n.team}:${n.shirt}`;
          const list = byBand.get(n.unit) ?? [];
          list.push({ key: ka, y: n.y, shirt: n.shirt });
          byBand.set(n.unit, list);
        }
        for (const [band, members] of byBand) {
          for (const [ka, kb] of chainLinks(members)) pushLink(ka, kb, band);
        }
      } else {
        // Legacy whole-team mesh: one undirected link per pair.
        for (const a of nodes) {
          for (const b of nodes) {
            if (a === b) continue;
            const ka = `${a.team}:${a.shirt}`;
            const kb = `${b.team}:${b.shirt}`;
            pushLink(ka, kb, null);
          }
        }
      }
      out.sort((x, y) => x.n - y.n);
    } else {
      const teamOf = (key) => Number(key.split(':')[0]);
      out = [...sourceLinks.keys()]
        .map((k) => ({ k, n: weightOf(k) }))
        .filter(({ k, n }) => {
          if (n <= 0) return false;
          if (teamFilter === null) return true;
          const [a, b] = k.split('>');
          return teamOf(a) === teamFilter && teamOf(b) === teamFilter;
        })
        .sort((a, b) => b.n - a.n)
        .slice(0, topLinks)
        .map(({ k, n }) => {
          const [a, b] = k.split('>');
          return { a, b, n };
        });
    }
    return {
      nodes,
      links: out,
      maxTouches: nodes.reduce((m, n) => Math.max(m, n.n), 0),
      maxLink: out.reduce((m, l) => Math.max(m, l.n), 0),
      streak,
      mode: outlet ? 'outlet' : 'mesh',
    };
  }

  /** Interception / turnover: end the retained sequence and its outlet window. */
  function breakRetention() {
    lastTeam = null;
    streak = 0;
    clearWindow();
  }

  function reset() {
    touches.clear();
    links.clear();
    linkLast.clear();
    bandOf.clear();
    clearWindow();
    lastTeam = null;
    streak = 0;
  }

  function setDecay(seconds) {
    const next = Number(seconds);
    if (Number.isFinite(next) && next > 0) meshTau = Math.max(20, Math.min(900, next));
  }

  return {
    observePass,
    snapshot,
    setDecay,
    get decay() { return meshTau; },
    breakRetention,
    reset,
    get retention() { return streak; },
  };
}

export { shotXg, xtAt, xtGain };
