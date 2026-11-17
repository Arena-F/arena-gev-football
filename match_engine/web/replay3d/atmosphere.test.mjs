import test from 'node:test';
import assert from 'node:assert/strict';
import { energyForEvent, createAtmosphere, ambientEnergy } from './atmosphere.js';

test('goal and shot events rank above a throw-in', () => {
  assert.equal(energyForEvent(16), 1);
  assert.ok(energyForEvent(10) > energyForEvent(13));
  assert.ok(energyForEvent(13) > energyForEvent(4));
  assert.ok(energyForEvent(4) > energyForEvent(99));
  assert.ok(energyForEvent(13, true) > energyForEvent(13));
  assert.equal(energyForEvent(16, true), 1, 'a goal cannot exceed 1');
  assert.equal(energyForEvent(NaN), 0.18, 'unknown types fall back quietly');
});

test('a pulse spikes energy and impulse, then both decay', () => {
  const atm = createAtmosphere();
  atm.event(16);
  assert.equal(atm.energy, 1);
  assert.equal(atm.impulse, 1);
  atm.update(0.25);
  assert.ok(atm.energy > atm.impulse, 'the net impulse dies faster than the crowd');
  atm.update(2);
  assert.ok(atm.energy > 0.2 && atm.energy < 0.8);
  assert.ok(atm.impulse < 0.1, 'the net impulse has almost settled after two seconds');
  atm.update(30);
  assert.equal(atm.energy, 0);
  assert.equal(atm.impulse, 0);
});

test('a weaker event never lowers an existing roar', () => {
  const atm = createAtmosphere();
  atm.event(16);
  atm.event(4);
  assert.equal(atm.energy, 1);
});

test('update ignores bad deltas and caps a huge tab-resume step', () => {
  const atm = createAtmosphere();
  atm.event(16);
  atm.update(NaN);
  atm.update(-4);
  assert.equal(atm.energy, 1);
  atm.update(1000);
  assert.ok(atm.energy >= 0 && atm.energy < 0.001);
});

test('reset clears energy, impulse and the goal counter', () => {
  const atm = createAtmosphere();
  atm.event(16);
  assert.equal(atm.goals, 1);
  atm.reset();
  assert.equal(atm.energy, 0);
  assert.equal(atm.impulse, 0);
  assert.equal(atm.goals, 0);
});

test('the ambient floor keeps the stands alive but stays below a goal', () => {
  const calm = ambientEnergy(2, 0);
  const roaring = ambientEnergy(2, 1);
  assert.ok(calm > 0.05 && calm < 0.25);
  assert.ok(roaring > calm);
  assert.ok(roaring <= 1);
});
