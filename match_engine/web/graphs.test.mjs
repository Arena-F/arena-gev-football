import test from 'node:test';
import assert from 'node:assert/strict';

import { createMomentumTracker, createPassingNetwork, networkLevel, networkUnit, seqNumber } from './graphs.js';

test('seqNumber normalizes the wasm u64 BigInt event cursor', () => {
  assert.equal(seqNumber(42n), 42);
  assert.equal(typeof seqNumber(42n), 'number');
  assert.equal(seqNumber(0n), 0);
  // Number cursors pass through unchanged (older wasm builds).
  assert.equal(seqNumber(7), 7);
  assert.equal(seqNumber(0), 0);
});

test('seqNumber maps unknown cursors to the -1 sentinel', () => {
  assert.equal(seqNumber(undefined), -1);
  assert.equal(seqNumber(null), -1);
});

test('momentum dedupes on the exact string observation key', () => {
  const m = createMomentumTracker();
  const row = (t, dv, team = 0) => [{ t, dv, team }];
  m.observe('3:0', row(10, 0.5));
  m.observe('3:0', row(10, 0.5));
  assert.equal(m.home.length, 1);
  m.observe('3:1', row(10, 0.5));
  assert.equal(m.home.length, 2);
  // BigInt-derived seq plus row index can never collide with the -1 seed.
  assert.equal(m.home.reduce((sum, r) => sum + r.v, 0), 1.5);
});

test('passing network snapshots filter to a single team on request', () => {
  const net = createPassingNetwork();
  const p = (x, y, team, shirt) => ({ x, y, team, shirt });
  net.observePass(p(0, 0, 0, 9), p(10, 0, 0, 8));
  net.observePass(p(0, 0, 0, 9), p(10, 0, 0, 8));
  net.observePass(p(0, 0, 1, 5), p(-10, 0, 1, 4));

  const home = net.snapshot(8, 0);
  assert.equal(home.nodes.length, 2);
  assert.ok(home.nodes.every((n) => n.team === 0));
  assert.equal(home.links.length, 1);
  assert.equal(home.links[0].n, 2);
  assert.equal(home.maxTouches, 2);
  assert.equal(home.maxLink, 2);

  // Default (no team) keeps the old both-teams behaviour.
  const all = net.snapshot(8);
  assert.equal(all.nodes.length, 4);
  assert.equal(all.links.length, 2);
});

test('passing network mesh includes every roster shirt and every pair', () => {
  const net = createPassingNetwork();
  const p = (x, y, team, shirt) => ({ x, y, team, shirt });
  net.observePass(p(0, 0, 0, 9), p(10, 0, 0, 8));
  net.observePass(p(0, 0, 0, 9), p(10, 0, 0, 8));
  net.observePass(p(10, 0, 0, 8), p(0, 0, 0, 9)); // reverse direction sums

  const roster = [
    { team: 0, shirt: 9, x: 0, y: 0 },
    { team: 0, shirt: 8, x: 10, y: 0 },
    { team: 0, shirt: 1, x: -40, y: 0 }, // no touches yet
  ];
  const snap = net.snapshot(8, 0, roster);
  assert.equal(snap.nodes.length, 3);
  const keeper = snap.nodes.find((n) => n.shirt === 1);
  assert.equal(keeper.n, 0);
  assert.equal(keeper.x, -40);
  // Complete mesh for three players, weakest first.
  assert.equal(snap.links.length, 3);
  assert.equal(snap.links[0].n, 0);
  assert.equal(snap.links[snap.links.length - 1].n, 3);
  assert.equal(snap.maxLink, 3);
  // Mesh links are undirected: one entry per pair.
  const pairs = new Set(snap.links.map((l) => [l.a, l.b].sort().join('|')));
  assert.equal(pairs.size, snap.links.length);
});

test('outlet mode keeps one wire per player in the current possession', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt) => ({ x, y, team: 0, shirt });
  net.observePass(p(0, 0, 9), p(10, 0, 8));
  net.observePass(p(10, 0, 8), p(0, 0, 9));
  net.observePass(p(0, 0, 9), p(10, 0, 8));
  net.observePass(p(10, 0, 8), p(0, 0, 9));
  net.observePass(p(0, 0, 9), p(10, 0, 8));
  net.observePass(p(0, 0, 9), p(-10, 10, 11));
  net.observePass(p(-10, 10, 11), p(10, 0, 8));
  const roster = [
    { team: 0, shirt: 9, x: 0, y: 0 },
    { team: 0, shirt: 8, x: 10, y: 0 },
    { team: 0, shirt: 1, x: -40, y: 0 },
  ];
  const snap = net.snapshot(8, 0, roster, 'outlet');
  assert.equal(snap.mode, 'outlet');
  assert.equal(snap.streak, 7);
  // Roster 9/8/1 plus shirt 11 from the possession touches.
  assert.equal(snap.nodes.length, 4);
  assert.equal(snap.nodes.find((n) => n.shirt === 1).n, 0);
  // 9 -> 8 is each man's top outlet, so the pair is drawn once; 11 -> 8 is
  // the only other wire. Two wires, not the six-pair mesh.
  assert.equal(snap.links.length, 2);
  const pair = (a, b) => [a, b].sort().join('|');
  const nineEight = snap.links.find((l) => pair(l.a, l.b) === '0:8|0:9');
  assert.equal(nineEight.n, 3);
  const elevenEight = snap.links.find((l) => pair(l.a, l.b) === pair('0:8', '0:11'));
  assert.equal(elevenEight.n, 1);
  assert.equal(snap.maxLink, 3);

  // A turnover clears the possession window, not the match-long stats.
  net.breakRetention();
  const after = net.snapshot(8, 0, roster, 'outlet');
  assert.equal(after.streak, 0);
  assert.equal(after.links.length, 0);
  assert.ok(after.nodes.every((n) => n.n === 0));
  const mesh = net.snapshot(8, 0, roster, 'mesh');
  assert.equal(mesh.mode, 'mesh');
  assert.equal(mesh.links.length, 6);
  assert.equal(mesh.links.find((l) => pair(l.a, l.b) === '0:8|0:9').n, 5);
});

test('breakRetention ends the retained sequence but keeps accumulated stats', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt) => ({ x, y, team: 0, shirt });
  for (let i = 0; i < 3; i++) net.observePass(p(0, 0, 9), p(10, 0, 8));
  assert.equal(net.retention, 3);
  const before = net.snapshot(8, 0);
  assert.equal(before.nodes.length, 2);
  assert.equal(before.streak, 3);

  net.breakRetention();
  assert.equal(net.retention, 0);
  const after = net.snapshot(8, 0);
  assert.equal(after.streak, 0);
  assert.equal(after.nodes.length, before.nodes.length);
  assert.equal(after.links[0].n, before.links[0].n);

  // A new pass sequence starts from one.
  net.observePass(p(0, 0, 9), p(10, 0, 8));
  assert.equal(net.retention, 1);
});

test('passing links decay when a pair stops combining', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt) => ({ x, y, team: 0, shirt });
  for (let i = 0; i < 10; i++) net.observePass(p(0, 0, 9), p(10, 0, 8), 0);
  const fresh = net.snapshot(8, 0, null, 'mesh', 0);
  const old = net.snapshot(8, 0, null, 'mesh', 360);
  const link = (snap) => snap.links.find((l) => (l.a === '0:9' && l.b === '0:8') || (l.a === '0:8' && l.b === '0:9'));
  assert.ok(fresh && old);
  assert.ok(link(old).n < link(fresh).n);
  // A fresh pass refreshes the timestamp and thickens it again.
  net.observePass(p(0, 0, 9), p(10, 0, 8), 360);
  const refreshed = net.snapshot(8, 0, null, 'mesh', 360);
  assert.ok(link(refreshed).n > link(old).n);
});

test('outlet window links also thin without recent passes', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt) => ({ x, y, team: 0, shirt });
  for (let i = 0; i < 4; i++) net.observePass(p(0, 0, 9), p(10, 0, 8), 0);
  const fresh = net.snapshot(8, 0, null, 'outlet', 0);
  const old = net.snapshot(8, 0, null, 'outlet', 300);
  assert.ok(fresh.links.length === 1 && old.links.length === 1);
  assert.ok(old.links[0].n < fresh.links[0].n);
});

test('network memory controls how fast old links thin', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt) => ({ x, y, team: 0, shirt });
  net.observePass(p(0, 0, 9), p(10, 0, 8), 0);
  net.setDecay(60);
  assert.equal(net.decay, 60);
  const slow = createPassingNetwork();
  slow.observePass(p(0, 0, 9), p(10, 0, 8), 0);
  slow.setDecay(600);
  const shortMemory = net.snapshot(8, 0, null, 'mesh', 120);
  const longMemory = slow.snapshot(8, 0, null, 'mesh', 120);
  const weight = (snap) => snap.links[0]?.n ?? 0;
  assert.ok(weight(longMemory) > weight(shortMemory));
});

test('unit webs split defenders, midfielders and attackers and drop the keeper', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt, role) => ({ x, y, team: 0, shirt, role });
  net.observePass(p(-30, -12, 4, 2), p(-30, 12, 5, 2));
  net.observePass(p(-5, -8, 8, 3), p(-5, 8, 6, 3));
  // A heavy DEF–MID pair earns its own wire on top of the chains.
  for (let i = 0; i < 6; i++) net.observePass(p(-30, -12, 4, 2), p(-5, -8, 8, 3));
  const roster = [
    { team: 0, shirt: 4, x: -30, y: -12, role: 2 },
    { team: 0, shirt: 5, x: -30, y: 12, role: 2 },
    { team: 0, shirt: 8, x: -5, y: -10, role: 3 },
    { team: 0, shirt: 6, x: -5, y: 8, role: 3 },
    { team: 0, shirt: 9, x: 20, y: 0, role: 4 },
    { team: 0, shirt: 1, x: -48, y: 0, role: 1 },
  ];
  const snap = net.snapshot(8, 0, roster, 'mesh');
  assert.ok(snap.nodes.every((n) => n.team === 0));
  assert.ok(snap.nodes.every((n) => n.unit === 'def' || n.unit === 'mid' || n.unit === 'fwd'));
  assert.ok(!snap.nodes.some((n) => n.shirt === 1));
  assert.equal(snap.nodes.length, 5);
  for (const l of snap.links) {
    assert.ok(l.unit === 'def' || l.unit === 'mid' || l.unit === 'fwd');
    const a = snap.nodes.find((n) => `0:${n.shirt}` === l.a);
    const b = snap.nodes.find((n) => `0:${n.shirt}` === l.b);
    if (l.unit === 'mid' && a.unit !== b.unit) continue; // earned cross-band wire
    assert.equal(a.unit, l.unit);
    assert.equal(b.unit, l.unit);
  }
  // Two band chains (4–5, 8–6) plus the earned 4–8 wire; the lone forward
  // stands alone until he combines.
  assert.equal(snap.links.length, 3);
  const earned = snap.links.filter((l) => (
    (l.a === '0:4' && l.b === '0:8') || (l.a === '0:8' && l.b === '0:4')
  ));
  assert.equal(earned.length, 1);
  assert.equal(earned[0].unit, 'mid');
  assert.ok(earned[0].n >= 6);
});

test('unit mesh chains each band end to end with light baselines', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt, role) => ({ x, y, team: 0, shirt, role });
  net.observePass(p(-30, -8, 4, 2), p(-30, 8, 5, 2));
  const roster = [
    { team: 0, shirt: 2, x: -31, y: -14, role: 2 },
    { team: 0, shirt: 4, x: -30, y: -2, role: 2 },
    { team: 0, shirt: 5, x: -29, y: 10, role: 2 },
  ];
  const snap = net.snapshot(8, 0, roster, 'mesh');
  // A band of three chains into two short links — never the three-pair mesh.
  assert.equal(snap.links.length, 2);
  const pair = (l) => [l.a, l.b].sort().join('|');
  const pairs = new Set(snap.links.map(pair));
  assert.ok(pairs.has('0:2|0:4'), 'left end links its neighbour');
  assert.ok(pairs.has('0:4|0:5'), 'middle links the right end');
  assert.ok(!pairs.has('0:2|0:5'), 'no wrap-around diagonal');
});

test('unit outlet keeps one same-band wire per player', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt, role) => ({ x, y, team: 0, shirt, role });
  net.observePass(p(-30, -6, 4, 2), p(-28, 8, 5, 2));
  net.observePass(p(-28, 8, 5, 2), p(-30, -6, 4, 2));
  net.observePass(p(-30, -6, 4, 2), p(-28, 8, 5, 2));
  // Heavy cross-band history must not leak into the outlet web.
  for (let i = 0; i < 5; i++) net.observePass(p(-30, -6, 4, 2), p(-5, 0, 8, 3));
  const roster = [
    { team: 0, shirt: 4, x: -30, y: -6, role: 2 },
    { team: 0, shirt: 5, x: -28, y: 8, role: 2 },
    { team: 0, shirt: 8, x: -5, y: 0, role: 3 },
  ];
  const snap = net.snapshot(8, 0, roster, 'outlet');
  assert.equal(snap.links.length, 1);
  assert.equal(snap.links[0].unit, 'def');
});

test('role changes regroup the bands without losing history', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt, role) => ({ x, y, team: 0, shirt, role });
  net.observePass(p(-30, -8, 4, 2), p(-28, 8, 8, 2));
  net.observePass(p(-28, 8, 8, 2), p(-30, -8, 4, 2));
  const defRoster = [
    { team: 0, shirt: 4, x: -30, y: -8, role: 2 },
    { team: 0, shirt: 8, x: -28, y: 8, role: 2 },
  ];
  const before = net.snapshot(8, 0, defRoster, 'mesh');
  assert.equal(before.links.length, 1);
  assert.equal(before.links[0].unit, 'def');
  // Shirt 8 pushes into midfield: the band chain breaks, but the pair's two
  // passes earn a cross-band wire so the history stays visible.
  const midRoster = [
    { team: 0, shirt: 4, x: -30, y: -8, role: 2 },
    { team: 0, shirt: 8, x: -4, y: 2, role: 3 },
  ];
  const after = net.snapshot(8, 0, midRoster, 'mesh');
  assert.equal(after.links.length, 1);
  assert.equal(after.links[0].unit, 'mid');
  assert.ok(after.links[0].n > 0);
  // Shifting back restores the band wire from retained history.
  const restored = net.snapshot(8, 0, defRoster, 'mesh');
  assert.equal(restored.links.length, 1);
  assert.equal(restored.links[0].unit, 'def');
  assert.ok(restored.links[0].n > 0);
});

test('each band chains end to end in a 4-4-2, with no cross wires at baseline', () => {
  const net = createPassingNetwork();
  const defs = [2, 3, 4, 5];
  const mids = [6, 7, 8, 9];
  const fwds = [10, 11];
  const roster = [
    ...defs.map((shirt, i) => ({ team: 0, shirt, x: -30, y: -18 + i * 12, role: 2 })),
    ...mids.map((shirt, i) => ({ team: 0, shirt, x: -5, y: -18 + i * 12, role: 3 })),
    ...fwds.map((shirt, i) => ({ team: 0, shirt, x: 20, y: -6 + i * 12, role: 4 })),
  ];
  const snap = net.snapshot(8, 0, roster, 'mesh');
  // 3 + 3 + 1 short chain links — never the 21-pair mesh.
  assert.equal(snap.links.length, 3 + 3 + 1);
  for (const fwd of fwds) {
    const partners = snap.links
      .filter((l) => l.a === `0:${fwd}` || l.b === `0:${fwd}`)
      .map((l) => (l.a === `0:${fwd}` ? l.b : l.a));
    // The strikers link each other; the midfield is a separate band.
    assert.deepEqual(partners, fwds.filter((s) => s !== fwd).map((s) => `0:${s}`));
  }
  assert.ok(snap.links.every((l) => {
    const au = snap.nodes.find((n) => `0:${n.shirt}` === l.a).unit;
    const bu = snap.nodes.find((n) => `0:${n.shirt}` === l.b).unit;
    return au === bu;
  }), 'baseline chains never cross bands');
});

test('a winger who pushes up joins the attack band and chains the strikers', () => {
  const net = createPassingNetwork();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairSet = (snap) => new Set(snap.links.map((l) => key(l.a, l.b)));
  const base = (x7) => [
    { team: 0, shirt: 4, x: -32, y: -14, role: 2 },
    { team: 0, shirt: 5, x: -32, y: 12, role: 2 },
    { team: 0, shirt: 7, x: x7, y: 18, role: 3 },
    { team: 0, shirt: 8, x: -5, y: -8, role: 3 },
    { team: 0, shirt: 9, x: 20, y: -4, role: 4 },
    { team: 0, shirt: 11, x: 20, y: 6, role: 4 },
  ];
  // Back line of the midfield: the winger chains with his fellow midfielder.
  const deep = net.snapshot(8, 0, base(-5), 'mesh');
  assert.ok(pairSet(deep).has(key('0:7', '0:8')), 'winger chains in midfield when deep');
  // High line: the same winger joins the attack band and chains the strikers.
  const high = net.snapshot(8, 0, base(26), 'mesh');
  assert.ok(!pairSet(high).has(key('0:7', '0:8')), 'no midfield wire once promoted');
  assert.ok(pairSet(high).has(key('0:7', '0:9')) || pairSet(high).has(key('0:7', '0:11')),
    'promoted winger chains a striker');
  // Tracking back returns him to the midfield band.
  const back = net.snapshot(8, 0, base(-5), 'mesh');
  assert.ok(pairSet(back).has(key('0:7', '0:8')));
});

test('a dropping midfielder joins the defence band', () => {
  const net = createPassingNetwork();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairSet = (snap) => new Set(snap.links.map((l) => key(l.a, l.b)));
  const base = (x6, y6) => [
    { team: 0, shirt: 4, x: -30, y: -8, role: 2 },
    { team: 0, shirt: 5, x: -30, y: 8, role: 2 },
    { team: 0, shirt: 6, x: x6, y: y6, role: 3 },
    { team: 0, shirt: 7, x: -5, y: -12, role: 3 },
    { team: 0, shirt: 10, x: -5, y: 12, role: 3 },
  ];
  const held = net.snapshot(8, 0, base(-5, 0), 'mesh');
  assert.ok(pairSet(held).has(key('0:6', '0:7')), 'midfielder chains midfield when held');
  assert.ok(pairSet(held).has(key('0:6', '0:10')));
  // Tracking back to full-back territory puts him on the defensive chain.
  const dropped = net.snapshot(8, 0, base(-32, 20), 'mesh');
  assert.ok(!pairSet(dropped).has(key('0:6', '0:7')), 'no midfield wire once dropped');
  assert.ok(pairSet(dropped).has(key('0:5', '0:6')) || pairSet(dropped).has(key('0:4', '0:6')),
    'deep midfielder chains the back line');
});

test('band hysteresis holds a shirt hovering on the line', () => {
  const net = createPassingNetwork();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairSet = (snap) => new Set(snap.links.map((l) => key(l.a, l.b)));
  const base = (x7) => [
    { team: 0, shirt: 4, x: -30, y: -14, role: 2 },
    { team: 0, shirt: 5, x: -30, y: 12, role: 2 },
    { team: 0, shirt: 7, x: x7, y: 18, role: 3 },
    { team: 0, shirt: 8, x: -5, y: -8, role: 3 },
    { team: 0, shirt: 9, x: 20, y: -4, role: 4 },
    { team: 0, shirt: 11, x: 20, y: 6, role: 4 },
  ];
  const has7 = (snap) => pairSet(snap).has(key('0:7', '0:9')) || pairSet(snap).has(key('0:7', '0:11'));
  // Anchors: midfield pair + forward line → b2 ≈ 11–13. A winger 2 m short
  // of the margin stays midfield; 3 m past it promotes.
  const near = net.snapshot(8, 0, base(8.5), 'mesh');
  assert.ok(!has7(near));
  const over = net.snapshot(8, 0, base(16), 'mesh');
  assert.ok(has7(over));
  // A 1 m wobble back does not demote him again.
  const wobble = net.snapshot(8, 0, base(15), 'mesh');
  assert.ok(has7(wobble));
});

test('a scrambled shape falls back to listed roles', () => {
  const net = createPassingNetwork();
  const roster = [
    { team: 0, shirt: 4, x: 18, y: -6, role: 2 },
    { team: 0, shirt: 5, x: 17, y: 6, role: 2 },
    { team: 0, shirt: 8, x: 19, y: -2, role: 3 },
    { team: 0, shirt: 9, x: 16, y: 2, role: 4 },
  ];
  const snap = net.snapshot(8, 0, roster, 'mesh');
  const byKey = new Map(snap.nodes.map((n) => [`0:${n.shirt}`, n.unit]));
  assert.equal(byKey.get('0:4'), 'def');
  assert.equal(byKey.get('0:5'), 'def');
  assert.equal(byKey.get('0:8'), 'mid');
  assert.equal(byKey.get('0:9'), 'fwd');
});

test('a lone forward stands alone until he combines', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt, role) => ({ x, y, team: 0, shirt, role });
  const roster = [
    ...[2, 3, 4, 5].map((shirt, i) => ({ team: 0, shirt, x: -30, y: -18 + i * 12, role: 2 })),
    ...[6, 7, 8, 10, 11].map((shirt, i) => ({ team: 0, shirt, x: -5, y: -20 + i * 10, role: 3 })),
    { team: 0, shirt: 9, x: 22, y: 0, role: 4 },
  ];
  const quiet = net.snapshot(8, 0, roster, 'mesh');
  const strikerLinks = quiet.links.filter((l) => l.a === '0:9' || l.b === '0:9');
  assert.equal(strikerLinks.length, 0);
  assert.equal(quiet.links.length, 3 + 4);
  // Three balls into feet earn his thread to the ten, whatever the bands say.
  for (let i = 0; i < 3; i++) net.observePass(p(-5, 0, 10, 3), p(22, 0, 9, 4));
  const busy = net.snapshot(8, 0, roster, 'mesh');
  const earned = busy.links.filter((l) =>
    (l.a === '0:9' && l.b === '0:10') || (l.a === '0:10' && l.b === '0:9'));
  assert.equal(earned.length, 1);
  assert.equal(earned[0].unit, 'fwd');
  assert.equal(earned[0].n, 3);
});

test('a mid-match formation change regroups the webs and keeps history', () => {
  const net = createPassingNetwork();
  const p = (x, y, shirt, role) => ({ x, y, team: 0, shirt, role });
  // 4-4-2: the wide midfielder feeds the striker three times.
  for (let i = 0; i < 3; i++) net.observePass(p(0, 10, 7, 3), p(20, 0, 9, 4));
  const flat = [
    { team: 0, shirt: 7, x: 0, y: 10, role: 3 },
    { team: 0, shirt: 9, x: 20, y: 0, role: 4 },
  ];
  const before = net.snapshot(8, 0, flat, 'mesh');
  assert.equal(before.links.length, 1);
  assert.equal(before.links[0].unit, 'fwd'); // attack bridge
  assert.equal(before.links[0].n, 3);
  // 4-3-3 style shift: shirt 7 pushes up front. The same pair regroups from
  // a bridge into the forward web with its three passes intact.
  const attacking = [
    { team: 0, shirt: 7, x: 15, y: 10, role: 4 },
    { team: 0, shirt: 9, x: 20, y: 0, role: 4 },
  ];
  const after = net.snapshot(8, 0, attacking, 'mesh');
  assert.equal(after.links.length, 1);
  assert.equal(after.links[0].unit, 'fwd');
  assert.equal(after.links[0].n, 3);
});

test('networkLevel steps up each unit ladder and ghosts near-zero weights', () => {
  assert.equal(networkUnit(2), 'def');
  assert.equal(networkUnit(3), 'mid');
  assert.equal(networkUnit(4), 'fwd');
  assert.equal(networkUnit(1), null);
  assert.equal(networkUnit(0), null);
  assert.equal(networkLevel('def', 0), 0);
  assert.equal(networkLevel('def', 0.04), 0);
  assert.equal(networkLevel('def', 1), 1);
  assert.equal(networkLevel('def', 4), 2);
  assert.equal(networkLevel('def', 10), 3);
  assert.equal(networkLevel('def', 22), 4);
  assert.equal(networkLevel('mid', 3), 2);
  assert.equal(networkLevel('mid', 8), 3);
  assert.equal(networkLevel('fwd', 2), 2);
  assert.equal(networkLevel('fwd', 5), 3);
  assert.equal(networkLevel('fwd', 12), 4);
});
