import test from 'node:test';
import assert from 'node:assert/strict';

import { GROUND_W, GROUND_H, PX_PER_M, groundToScreen, makeHeatAdapter } from './analysis3d.js';

// DOM-free contract for the 3D analysis projection: geometry mapping and the
// layer/variant wiring. Canvas drawing itself is covered by browser QA.

test('the ground canvas matches the pitch aspect', () => {
  assert.equal(GROUND_W, 2048);
  assert.equal(GROUND_H, 1330);
  assert.ok(Math.abs(GROUND_W / GROUND_H - 105 / 68) < 0.01, '105:68 pitch aspect');
  assert.equal(PX_PER_M, GROUND_W / 105);
});

test('world metres map onto the ground canvas corners', () => {
  const [x0, y0] = groundToScreen(-52.5, 34);
  const [x1, y1] = groundToScreen(52.5, -34);
  assert.deepEqual([Math.round(x0), Math.round(y0)], [0, 0]);
  assert.deepEqual([Math.round(x1), Math.round(y1)], [GROUND_W, GROUND_H]);
  const [cx, cy] = groundToScreen(0, 0);
  assert.deepEqual([Math.round(cx), Math.round(cy)], [GROUND_W / 2, GROUND_H / 2]);
  // Screen rows run top-down like the 2D heatmap (row 0 = y +34).
  const [, top] = groundToScreen(0, 34);
  const [, bottom] = groundToScreen(0, -34);
  assert.ok(top < bottom, 'north is up');
});

test('heat snapshots carry a cache-busting version', () => {
  assert.equal(makeHeatAdapter(null), null);
  assert.equal(makeHeatAdapter({}), null);
  const a = makeHeatAdapter({ cols: 2, rows: 2, max: 3, grid: [0, 1, 2, 3] }, 'clip:home');
  assert.ok(a, 'adapter built');
  assert.ok(typeof a.version === 'string', 'version is a string, never a live counter');
  assert.ok(a.grid instanceof Float32Array, 'grid is a Float32Array for drawHeatmap');
  assert.equal(a.grid[3], 3);
  const b = makeHeatAdapter({ cols: 2, rows: 2, max: 3, grid: [0, 1, 2, 3] }, 'clip:home');
  assert.notEqual(a.version, b.version, 'every snapshot busts the shared raster cache');
});
