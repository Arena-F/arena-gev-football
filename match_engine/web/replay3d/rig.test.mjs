import test from 'node:test';
import assert from 'node:assert/strict';

// Guard the browser-only rig module at import time. It must never touch the
// DOM until createRigPool() is called, so Node can verify exports and the bone
// table without a browser.
test('the rig module imports without a DOM and exposes the pool factory', async () => {
  const mod = await import('./rig.js');
  assert.equal(typeof mod.createRigPool, 'function');
  assert.equal(typeof mod.createSharedRigAssets, 'function');
  assert.ok(Array.isArray(mod.BONE_NAMES));
  assert.equal(mod.BONE_NAMES.length, 19);
  assert.ok(mod.BONE_NAMES.includes('Hips'));
  assert.ok(mod.BONE_NAMES.includes('FootL'));
});

test('the player pool module imports without a DOM', async () => {
  const mod = await import('./players.js');
  assert.equal(typeof mod.createPlayerPool, 'function');
});

test('the stadium, atmosphere and stage modules import without a DOM', async () => {
  const stadium = await import('./stadium.js');
  assert.equal(typeof stadium.buildStadium, 'function');
  const atmosphere = await import('./atmosphere.js');
  assert.equal(typeof atmosphere.createAtmosphere, 'function');
  const stage = await import('./stage.js');
  assert.equal(typeof stage.createStage, 'function');
});
