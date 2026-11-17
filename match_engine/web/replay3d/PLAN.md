# 3D Highlights Replay — build plan (experiment)

Status: shipped as an opt-in experiment · Last reviewed: Phase 7

## Goal

Replay the moments the 2D GEV already flags as highlights (goal, shot, save,
corner, notable event) as a short 3D stadium sequence. Example: a goal at
`05:00` replays `04:45 → 05:15` with 3D players, team-coloured kits and a
directed broadcast camera, at **0.5× by default**.

The live 2D GEV keeps running untouched. The 3D layer is a separate component:

- a compact **3D replay CTA in the sidebar Highlights stack**, and
- an opt-in **theatre overlay** that opens on click and closes back to live.

No changes to the Rust engine. No bundler. No new runtime dependency until the
theatre is opened.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Replay source | Live 10 Hz ring buffer in JS | Zero engine cost, seek-safe, no second WASM instance |
| Window | 15 s before + 15 s after the event | User brief: 15–30 s sequence |
| Speed | 0.5× default, 0.25× / 1× selectable | Slow-motion replays |
| Players | Procedural humanoids (no GLB yet) | No asset pipeline; kits + numbers are the goal |
| Three.js | r186 vendored (`three.module.min.js` + `three.core.js`) | Works with plain `python -m http.server` and offline |
| Loading | `import('./stage.js')` only when theatre opens | Main GEV page load stays unchanged |
| Camera | Director FSM with hard cuts + damped follow | Wide → follow → close → goal/celebration |
| Placement | Sidebar Highlights CTA + full-screen theatre | Never covers the 2D pitch canvas, always reachable |
| Pause | 2.5 s stall watchdog flushes a partial clip | A paused match must not leave "REC" stuck forever |
| Player motion | Deterministic keyframe clips + 19-bone rig | Scrubbing must land on the same pose; no mixer state to drift |
| Action triggers | Derived from `clip.event` + sampled positions | Goals, shots, saves, headers and fouls already carry a type/team/origin |
| Crowd | One instanced billboard mesh + shader bob/jump | Thousands of fans for one draw call; no per-fan CPU work |
| Atmosphere | One energy scalar feeding crowd, flags, nets, LEDs, confetti | Big moments read as one stadium reaction, not five disconnected effects |

## Phases

### Phase 0 — Clip recorder (pure data) ✅

- [x] `clipStore.js`: 10 Hz snapshot ring buffer, event windowing, merge/upgrade,
      max 3 ready clips, seek reset, angle interpolation sampler, `flush()`.
- [x] `clipStore.test.mjs`: window math, merge, seek, cap, partial flush,
      interpolation.
- [x] `app.js` hooks: `observe()` after the render snapshot, `notifyEvent()`
      where highlights are pushed, `reset()` on load/seek.
- [x] Roles captured in clip meta for GK kit colours.

### Phase 1 — CTA + theatre shell ✅

- [x] Markup/CSS in `index.html`: card in the sidebar, `#replay3d-theater`
      overlay.
- [x] `replay3d.js` controller: pending/ready states, open/close, scroll lock,
      ESC/space/arrow keys, play state, speed chips, camera chips, scrubber,
      clock HUD, focus return.
- [x] Graceful fallback when WebGL / stage import fails.
- [x] Card moved from a fixed bottom-right overlay to the sidebar after review
      (the overlay clipped the pitch at 1440 px).

### Phase 2 — Stadium scaffold ✅

- [x] Vendored `three.module.min.js`, `three.core.js` and `LICENSE`.
- [x] `stadium.js`: procedural pitch texture with metric markings, goal frames
      + nets, LED boards, three-tier bowl with roofs, floodlights, instanced
      crowd.
- [x] `stage.js`: renderer, lights, fog, resize, `compileAsync`, dpr cap 2.
- [x] Static stadium matrices frozen; crowd is one InstancedMesh.
- [x] Review: camera originally sat behind the near stand roof (dead black
      band); moved to a broadcast line just inside the near touchline.

### Phase 3 — Players, ball, animation ✅

- [x] Procedural humanoid: torso, sleeves, arms, skin thighs, socks, boots,
      head, hair, shorts.
- [x] Team jersey + shorts + socks, GK variants, back-number canvas texture
      redrawn on substitutions.
- [x] Position/heading interpolation from clip frames, eased facing.
- [x] Run cycle (arm/leg swing from measured speed), torso lean, bob; ball
      canvas texture + rolling spin.
- [x] Review: split legs into skin thigh + team sock; added sleeves; tightened
      the close-up.

### Phase 4 — Director camera + playback ✅

- [x] Shot schedule: wide → follow → close (event) → behind-goal for
      shots/goals → wide.
- [x] Damped position/lookAt/fov, hard cuts on shot change and manual camera
      changes; `dt=0` snaps on scrub.
- [x] Manual Auto / Wide / Follow / Close chips.
- [x] 0.5× default; speed chips; scrubber; end-of-clip replay state.
- [x] Pause stops the 3D RAF loop; camera/seek changes render a single frame.
- [x] Review: goal cam moved back/up so the top net does not fill the frame;
      net opacity/repeat reduced.

### Phase 5 — Polish, performance, docs ✅

- [x] `prefers-reduced-motion`: static wide camera, no limb swing, no title
      card transition.
- [x] Shadow map 2048, static stadium matrices, no per-frame allocations in the
      stage loop, dpr cap 2.
- [x] `ui.test.mjs` static wiring + vendored-build checks.
- [x] README section + this status update.
- [x] Full `node --test web/*.test.mjs` and Playwright pass.

### Phase 6 — Real player motion ✅

- [x] `rig.js`: 19-bone humanoid (hips, spine, chest, neck, head, clavicle,
      upper arm, forearm, hand, thigh, shin, foot). The whole body merges into
      one SkinnedMesh with rigid vertex weights and vertex colours, plus one
      number plane, so the 22-player pool stays around 44 draw calls instead of
      one per limb. Separate short legs and hands keep the silhouette readable.
- [x] `pose.js`: authoring format `{ bone, channel, keys }`, baked to 30 Hz
      flat buffers, sampled by absolute clip time. Loop clips wrap seamlessly;
      one-shots clamp. No per-frame allocation.
- [x] `playerClips.js`: idle, walk, jog, run, sprint, kick, header, tackle,
      fall, get-up, three celebrations and keeper idle/dive clips. Gaits are
      authored around a natural speed so playback rate can track measured
      speed.
- [x] `playerActions.js`: hysteresis locomotion (idle/walk/jog/run/sprint),
      event-derived one-shots. Kick/header on the nearest attacker, dive on the
      defending keeper, tackle + fall + get-up on fouls, looping celebrations on
      goals. Windows fade in/out and overlap so there is no snap.
- [x] `players.js`: position/heading from the 6-float snapshots, speed from the
      next sample (seek lands mid-stride), locomotion crossfade, action blended
      over it, keeper stance, `prefers-reduced-motion` rest pose.
- [x] Tests: `pose.test.mjs` (sampling, wrap, bake validation, gait swing) and
      `playerActions.test.mjs` (thresholds, every trigger, determinism).

### Phase 7 — Living crowd, banners, nets ✅

- [x] `atmosphere.js`: one 0..1 energy scalar from event type, 3.4 s crowd
      decay, 0.75 s net/impulse decay, ambient floor so the bowl never freezes.
- [x] Crowd sprite (head-and-shoulders silhouette) + per-instance phase
      attribute. Shader adds idle bob, goal jump, lateral sway, a travelling
      wave around the bowl and an energy tint. Still one draw call.
- [x] Tifo banners on both long sides and behind both goals, canvas-redrawn
      from team colours/names on clip load. Flag/scarf instances around the
      tiers with a shared wave shader.
- [x] Goal nets subdivided and displaced by a shader: subtle idle sway plus a
      short ripple on a goal. LED boards pulse with the same energy scalar.
- [x] Confetti: one pooled `Points` burst behind the scoring goal, team colours
      plus white/gold, gravity + drag, auto-hidden when settled.
- [x] `stadium.setTeams()` / `update()` / `celebrate()` wired from `stage.js`.
      Event fires once when playback crosses `event.t`; a seek before the event
      re-arms it, a seek after it does not double-fire.
- [x] Tests: `atmosphere.test.mjs` (event ranking, decay, reset, ambient) and
      static wiring checks in `ui.test.mjs`.
- [x] Visual QA in headless Chromium: goal, kick, keeper dive, celebration,
      crowd idle vs goal, confetti, tifo and nets; no console/shader errors.
      Scene cost: 136 draw calls and ~2.4 ms CPU/frame at 1280×720 (from 789
      calls / 13.5 ms before the skinned merge). Headless RAF FPS is not a
      useful signal here because SwiftShader itself runs the empty scene below
      1 FPS.

### Phase 8 — Extended animation pack (51 clips, deterministic variants) ✅

- [x] `tools/bake-mixamo`: `--append` mode bakes only the extra clips and
      merges them with the frozen base outputs, so re-bakes can never drift
      existing behaviour; full rebuilds fail loudly on base duration drift.
      Per-file try/catch logs `SKIP` (6 unparseable FBX + `X Bot` documented
      in the baker README) instead of failing the run; an audit warns on
      short loops, long one-shots, feet below ground or contacts outside the
      clip. Emits `MOCAP_VARIANTS` group table.
- [x] `playerActions.js`: `pickVariant`/`variantFor` — base clip owns hash
      < 0.62 (default/legacy hashes unchanged), other hashes spread over the
      same-name variants; groups never leak across semantics. New triggers:
      chipped high passes, keeper misses on goals, fall → fallen idle →
      get-up, keeper place → distribution on goal kicks, keeper throws on
      recoveries, corner pass variants, stall celebration, dribble take-ons.
- [x] `players.js`: directional locomotion (backpedal, side-shuffle, diagonal
      runs from measured velocity vs facing), idle/gk-idle/run variant
      shuffles with baked-clip guards, header lift for the new header
      variants. `ACTION_DURATION` picks up every new timing automatically.
- [x] `rig.js`: per-player blob shadow pinned to the root.
- [x] Tests: variant determinism/base-preservation, chip-vs-pass,
      dive-vs-miss, fallen-idle sequence; all 249 web tests green.

### Phase 9 — Broadcast cameras ✅

- [x] `director.js`: high broadcast line (wide 30 m, broadcast 27.5 m, follow
      23 m, close 13.5 m, goal 16 m, tactical 52 m). Shot changes blend over
      ~1.1 s smootherstep with a fly-over lift on big moves; scrub and
      reduced-motion snap. Goal cam carries an energy-scaled shake. Manual
      Broadcast/Wide/Follow/Close/Goal/Tactical chips; auto schedule
      wide → broadcast → close → goal/follow → broadcast.

### Phase 10 — Stadium and crowd v2 ✅

- [x] `stadium.js`: crowd is four instanced layers on one placement set —
      bodies, nodding heads, energy-gated arms, periodic handheld banners —
      plus jumbotron (fixture/score/match clock), floodlight glow sprites,
      star field, roof fascia strips, corner flags, dugouts, tunnel,
      pitch-side cameras and pitch wear. `setClock()` drives the jumbotron.

### Phase 11 — Full 2D analysis in 3D ✅

- [x] `analysis3d.js`: ground-projected 2048×1330 canvas using the exact 2D
      draw routines (heatmap snapshot, network outlet/mesh rebuilt from the
      analysis log, offside, carrier & shape, lanes, channels, vision,
      dribbles). 10 Hz redraws, layer-safe per-layer try/catch with a
      `lastError` debug surface. Heat adapters carry a unique string version
      so the shared raster cache rebuilds per clip.
- [x] `replay3d.js` + `index.html`: theatre side panel with layer toggles
      (+shift solo), shuffle, presets, layer-style lab, readout, live minimap,
      momentum strip, event feed and the full team/player panel following the
      replay clock. `app.js` attaches the heat snapshot + analysis index to
      clip meta and passes `getIndex`.
- [x] Tests: `analysis3d.test.mjs` (aspect, mapping, heat versioning),
      `ui.test.mjs` theatre/UI/wiring/post-FX contracts.

### Phase 12 — Post FX ✅

- [x] Vendored r186 composer addons (relative-path relink, no CDN):
      EffectComposer + MSAA target, RenderPass, UnrealBloomPass, grade
      ShaderPass (cool shadows / warm highlights / vignette / grain),
      OutputPass. High/Medium/Low tiers; any failure falls back to direct
      rendering; reduced-motion freezes the grain.
- [x] Headless Edge QA (`qa/` scratch, not committed): seek to a real goal,
      REC → READY, theatre opens, all cameras + presets + panel screenshot
      clean with zero console/page errors.

## File map

```
web/replay3d/
  PLAN.md            this file
  clipStore.js       ring buffer + windowing + sampler (DOM-free)
  clipStore.test.mjs
  replay3d.js        UI controller (card + theatre), no three import
  stage.js           three.js scene (imported lazily), atmosphere wiring
  stadium.js         pitch, stands, living crowd, tifo, flags, nets, confetti
  rig.js             19-bone humanoid rig + kit materials + numbers
  pose.js            keyframe bake/sample/blend (DOM-free)
  playerClips.js     authored gaits, strikes, falls, celebrations, dives
  playerActions.js   locomotion hysteresis + event-derived action windows
  analysis3d.js      ground-projected analysis layers (heat/net/lanes/vision)
  analysis3d.test.mjs  aspect, mapping, heat versioning
  atmosphere.js      event energy + decay + ambient floor (DOM-free)
  players.js         pool, appearances, poses, action blending
  director.js        camera shots + damping
  ui.test.mjs        static markup/vendor/wiring contract checks
  pose.test.mjs      sampler, bake validation, gait range
  playerActions.test.mjs  every trigger + deterministic seeks
  atmosphere.test.mjs     event ranking, decay, ambient floor
  rig.test.mjs       DOM-free module import guards
web/vendor/three/    three.module.min.js, three.core.js, LICENSE
web/vendor/three/addons/  vendored r186 post-processing passes + shaders
```

## Integration contract (app.js)

```js
replayRecorder.observe(simNow, players, ball);      // every render
replayRecorder.notifyEvent({ t, type, label, team, x, y, ...meta });
replayRecorder.collect(simNow);                     // inside replay3d.update
replayRecorder.flush();                             // pause/stall watchdog
replayRecorder.reset(); replay3d.reset();           // load / seek
```

## Data layout

Frame = `{ t, count, data: Float32Array(count * 6) }`
stride: `x, y, z(alt), heading, team, shirt`; ball is the last slot
(`team = 2`). Interpolation is linear; heading uses shortest-angle lerp.

Clip = `{ id, event, startT, endT, frames, partial, meta }`.
`meta` carries team names/colours, score at the event, competition and the
per-slot role array used for GK kits.

## Review notes / bugs caught between phases

- Fixed-bottom card overlapped the pitch at 1440 px → moved into the sidebar
  Highlights stack (in flow, no overlay).
- Wide camera behind the near stand roof produced a black dead band → camera
  moved to a valid broadcast line inside the bowl.
- Corner infill blocks read as floating black rectangles → removed.
- The vendored three build is split: `three.module.min.js` imports
  `three.core.js`; both must ship or dynamic import fails.
- Paused matches froze the sim clock, so pending clips never finalized → added
  a wall-time watchdog + `flush()`; fixed a bug where `flush()` results were
  dropped instead of delivered to the UI.
- The goal cam's top net dominated the foreground → moved the camera back/up
  and reduced net opacity/repeat.
- Phase 6: the old single-pivot legs could not knee-bend, so the kick read as a
  pendulum. Split the rig into thigh/shin/foot chains and authored the strike
  around plant → backswing → contact → follow-through.
- Phase 6: sampling from the previous frame collapsed a seek to idle. Speed is
  now measured from the next sample, so a scrub lands mid-stride.
- Phase 7: confetti launched 2.5 km away because the goal distance was applied
  twice (stage × burst). Burst now owns its radius.
- Phase 7: the first net pass was over-displaced and read as a blanket. Impulse
  amplitude cut and the idle sway halved.
- Phase 7: tifo behind the goal was outside the behind-goal camera. Added
  banners on both long sides as well as both ends.
- Per-limb meshes cost 789 draw calls. Merging the body into one rigid-weighted
  SkinnedMesh cut that to 136 and kept the same silhouettes.
- The theatre focused its Close button on open, and the keyboard guard treated
  any button as "editing", so arrows/space did nothing until the viewer clicked
  the pitch. Only real text fields swallow playback keys now.

## Review checklist

- [x] `node --test web/*.test.mjs web/replay3d/*.test.mjs` green.
- [x] `app.js` diff stays a handful of hooks; no engine/overlay changes.
- [x] Card never appears over the pitch canvas.
- [x] Seek/load resets recorder and closes stale theatre.
- [x] No per-frame allocations in the 3D loop; 2D loop untouched.
- [x] Playwright: no console errors, theatre renders, ESC closes, focus returns.
- [x] Playwright: synthetic 30 s goal clip opens the real card → theatre, stage
      ready, 0.5× playback, ESC closes.
- [x] Visual QA at goal: kick, keeper dive, celebration, crowd jump, confetti,
      tifo, nets, flags.

## Out of scope (v1)

GLB/Mixamo characters (the pose format can drive a skeletal mixer later),
facial rig, commentary/audio, post-processing bloom, goal-net physics, real kit
extraction from XML.
