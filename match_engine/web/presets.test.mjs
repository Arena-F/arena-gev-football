import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, isPreset, presetKeys, readStoredPreset, storePreset, clearStoredPreset } from './presets.js';

test('presets cover coherent layer sets', () => {
  assert.deepEqual(presetKeys(), ['broadcast', 'tactical', 'clean', 'all']);
  assert.ok(PRESETS.broadcast.includes('heatmap'));
  assert.ok(PRESETS.tactical.includes('passingLanes'));
  // The motion polish rides along with every preset that shows the pitch
  // analysis, and stays off in Clean like every other layer.
  assert.ok(PRESETS.broadcast.includes('ballTrail'));
  assert.ok(PRESETS.broadcast.includes('carrierGrow'));
  assert.ok(PRESETS.tactical.includes('ballTrail'));
  assert.ok(PRESETS.tactical.includes('carrierGrow'));
  assert.equal(PRESETS.clean.length, 0);
  assert.equal(PRESETS.all.length, 10);
});

test('preset names validate', () => {
  assert.equal(isPreset('tactical'), true);
  assert.equal(isPreset('nope'), false);
});

test('preset choice round-trips through storage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  clearStoredPreset();
  assert.equal(readStoredPreset(), null);
  assert.equal(storePreset('clean'), true);
  assert.equal(readStoredPreset(), 'clean');
  assert.equal(storePreset('nope'), false);
  clearStoredPreset();
  assert.equal(readStoredPreset(), null);
  delete globalThis.localStorage;
});
