import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static wiring for the 3D replay experiment. These checks keep the UI markup,
// the controller's element lookups and the vendored three build in sync
// without needing a browser.

const here = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(here, '..', 'index.html'), 'utf8');
const appSource = await readFile(path.join(here, '..', 'app.js'), 'utf8');
const controllerSource = await readFile(path.join(here, 'replay3d.js'), 'utf8');

test('every replay element the controller looks up exists in index.html', () => {
  const ids = [...controllerSource.matchAll(/byId\('([\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, `expected a full theatre, found ${ids.length} lookups`);
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(', ')}`);
});

test('the replay CTA lives in the sidebar Highlights stack, not over the pitch', () => {
  const stageStart = html.indexOf('<div id="stage">');
  const stageEnd = html.indexOf('<aside id="sidebar">');
  const card = html.indexOf('id="replay3d-card"');
  assert.ok(stageStart >= 0 && stageEnd > stageStart, 'stage and sidebar exist');
  assert.ok(card > stageEnd, 'the card is not inside the stage/pitch container');

  const highlights = html.indexOf('<h2>Highlights');
  assert.ok(highlights >= 0 && card > highlights, 'the card is part of the Highlights stack');
  assert.match(html, /id="replay3d-theater"/);
  assert.match(html, /id="r3d-canvas"/);
});

test('app.js records clips and resets them on load/seek', () => {
  assert.match(appSource, /createClipRecorder\(/);
  assert.match(appSource, /createReplay3D\(/);
  assert.match(appSource, /replayRecorder\.observe\(simNow, players, ball\)/);
  assert.match(appSource, /replayRecorder\.notifyEvent\(/);
  const resets = appSource.match(/replayRecorder\.reset\(/g) || [];
  assert.ok(resets.length >= 2, 'reset on match load and seek');
  assert.match(appSource, /replay3d\.reset\(/);
  assert.match(appSource, /roles: Array\.isArray\(playerRoles\)/);
});

test('the replay stage feeds the clip into the animation system', async () => {
  const stageSource = await readFile(path.join(here, 'stage.js'), 'utf8');
  const playersSource = await readFile(path.join(here, 'players.js'), 'utf8');
  const stadiumSource = await readFile(path.join(here, 'stadium.js'), 'utf8');

  assert.match(stageSource, /players\.update\(data, tAbs, dt, reducedMotion, currentClip\)/);
  assert.match(stageSource, /atmosphere\.event\(/);
  assert.match(stageSource, /stadium\.celebrate\(/);

  assert.match(playersSource, /actionForSlot\(/);
  assert.match(playersSource, /sampleClipPose\(/);
  assert.match(playersSource, /locomotionLevel\(/);

  assert.match(stadiumSource, /attribute float aPhase/);
  assert.match(stadiumSource, /function addTifo/);
  assert.match(stadiumSource, /function addFlags/);
  assert.match(stadiumSource, /function addConfetti/);
  assert.match(stadiumSource, /confetti\.burst\(dir/);
});

test('the 3D theatre carries the full analysis UI', async () => {
  for (const id of [
    'r3d-fx', 'r3d-shuffle', 'r3d-presets', 'r3d-lab', 'r3d-readout',
    'r3d-minimap', 'r3d-momentum', 'r3d-feed', 'r3d-panel-open',
    'r3d-player-panel', 'r3d-quality',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `theatre has #${id}`);
  }
  // All eight analytical layers are toggleable in 3D.
  for (const key of [
    'heatmap', 'network', 'offside', 'analysis',
    'passingLanes', 'attackChannels', 'visionCone', 'dribbles',
  ]) {
    assert.ok(html.includes(`data-fx="${key}"`), `fx bar toggles ${key}`);
  }
  // Presets mirror the 2D GEV set; quality tiers drive the post pipeline.
  for (const preset of ['broadcast', 'tactical', 'clean', 'all']) {
    assert.ok(html.includes(`data-preset="${preset}"`), `preset ${preset}`);
  }
  for (const tier of ['high', 'medium', 'low']) {
    assert.ok(html.includes(`data-fxq="${tier}"`), `quality tier ${tier}`);
  }
  // The theatre player panel reuses the 2D panel shell contract.
  const panelHtml = html.slice(html.indexOf('id="r3d-player-panel"'));
  assert.match(panelHtml, /class="pp-tabs"/);
  assert.match(panelHtml, /class="pp-body"/);
  assert.match(panelHtml, /class="pp-actions"/);
});

test('the theatre analysis stack is wired end to end', async () => {
  const stageSource = await readFile(path.join(here, 'stage.js'), 'utf8');
  const analysisSource = await readFile(path.join(here, 'analysis3d.js'), 'utf8');

  // The stage feeds sampled frames into the projection layer with the
  // theatre's effect controller, and returns the summary for the readout.
  assert.match(stageSource, /analysis\.update\(data, tAbs, fx\)/);
  assert.match(stageSource, /return summary/);
  assert.match(stageSource, /stadium\.setClock/);
  // Clip meta carries match-long context (heat snapshot + analysis index).
  assert.match(appSource, /heat: \{\s*$/m);
  assert.match(appSource, /index: dribbleIndex/);
  assert.match(appSource, /getIndex: \(\) => dribbleIndex/);
  // The projection layer reuses every 2D draw routine and variant.
  for (const fn of [
    'drawHeatmap', 'drawOffsideLine', 'drawAnalysis', 'drawAttackLanes',
    'drawAttackChannels', 'drawPassingNetwork', 'drawVisionField',
    'drawVisionCone', 'drawDribbleLayer',
  ]) {
    assert.match(analysisSource, new RegExp(`\\b${fn}\\b`), `analysis3d reuses ${fn}`);
  }
  assert.match(analysisSource, /getVariant\('/);
  // The controller owns an effect controller, presets, lab, minimap, panel.
  assert.match(controllerSource, /createEffectController\(\)/);
  assert.match(controllerSource, /createMinimap\(/);
  assert.match(controllerSource, /createPlayerPanel\(/);
  assert.match(controllerSource, /applyFxPreset\(/);
  assert.match(controllerSource, /stage\.setQuality/);
});

test('post-processing addons are vendored locally with the core', async () => {
  for (const file of [
    'postprocessing/EffectComposer.js',
    'postprocessing/RenderPass.js',
    'postprocessing/ShaderPass.js',
    'postprocessing/UnrealBloomPass.js',
    'postprocessing/OutputPass.js',
    'postprocessing/Pass.js',
    'shaders/CopyShader.js',
    'shaders/LuminosityHighPassShader.js',
    'shaders/OutputShader.js',
  ]) {
    const statInfo = await stat(path.join(here, '..', 'vendor', 'three', 'addons', file));
    assert.ok(statInfo.size > 500, `${file} is vendored`);
  }
  const composerSource = await readFile(
    path.join(here, '..', 'vendor', 'three', 'addons', 'postprocessing', 'EffectComposer.js'), 'utf8');
  assert.ok(!composerSource.includes(`from 'three'`), 'addons resolve the vendored core relatively');
  assert.match(composerSource, /three\.module\.min\.js/);
  assert.ok(!html.includes('cdn.jsdelivr.net'), 'no CDN dependency in the page');
  const stageSource = await readFile(path.join(here, 'stage.js'), 'utf8');
  assert.match(stageSource, /new EffectComposer\(/);
  assert.match(stageSource, /new UnrealBloomPass\(/);
  assert.match(stageSource, /setQuality/);
});

test('three.js is vendored locally with its split core build', async () => {
  const vendor = path.join(here, '..', 'vendor', 'three');
  const modulePath = path.join(vendor, 'three.module.min.js');
  const corePath = path.join(vendor, 'three.core.js');
  const moduleStat = await stat(modulePath);
  const coreStat = await stat(corePath);
  assert.ok(moduleStat.size > 100_000, 'three module is present');
  assert.ok(coreStat.size > 100_000, 'three core is present');
  const moduleSource = await readFile(modulePath, 'utf8');
  assert.match(moduleSource, /three\.core\.js/, 'the split core import resolves locally');
  assert.ok(!html.includes('cdn.jsdelivr.net'), 'no CDN dependency in the page');
  assert.ok(!moduleSource.includes('https://unpkg.com'), 'no CDN fallback in the vendored build');
});
