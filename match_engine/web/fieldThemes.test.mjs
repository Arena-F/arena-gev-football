import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_THEMES, fieldTheme } from './fieldThemes.js';

test('field themes expose classic, broadcast, night and figma palettes', () => {
  assert.deepEqual(Object.keys(FIELD_THEMES).sort(), ['broadcast', 'classic', 'figma', 'night']);
  for (const theme of Object.values(FIELD_THEMES)) {
    assert.match(theme.base, /^#/);
    assert.match(theme.pitch, /^#/);
    assert.match(theme.stripe, /^rgba/);
  }
  assert.equal(FIELD_THEMES.figma.figma, true);
  assert.equal(FIELD_THEMES.figma.stripeA, '#151623');
  assert.equal(FIELD_THEMES.figma.stripeB, '#1D1934');
  assert.equal(FIELD_THEMES.figma.line, 'rgba(255,255,255,0.08)');
});

test('unknown field ids fall back to classic', () => {
  assert.equal(fieldTheme('nope'), FIELD_THEMES.classic);
  assert.equal(fieldTheme('night'), FIELD_THEMES.night);
});
