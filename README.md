# arena-gev — God's Eye View

A Rust football match simulation engine fed by Opta F24 XML, with a
WASM-powered web UI that renders all 22 players and the ball on an
HTML5 canvas from a zero-copy render buffer.

## Project layout

- `match_engine/` — the Rust crate (parser, simulation engine, WASM bridge)
  - `src/` — parser, engine, ball, agent, brain, formation, dispatcher, timeline
  - `examples/` — diagnostic CLIs plus `gen_manifest` (builds the match list)
  - `tests/` — unit, integration, accuracy and shape-regression suites
  - `data/` — bundled Opta F24 fixtures (`*.xml`) and `mappings/`
  - `web/` — the front end (`index.html`, `app.js`, `analysis.js`, `overlays.js`,
    `variants.js`, `fieldThemes.js`, `presets.js`, `smoke_test.cjs`)
- `Dockerfile`, `Caddyfile`, `render.yaml` — Render deployment

## Run locally

```
cd match_engine
./run_web.sh
```

`run_web.sh` builds the WASM engine, copies the fixtures into
`web/matches/`, generates `web/matches.json`, and serves the crate root
on `:8000`. Open <http://localhost:8000/web/>.

The left-hand **Matches** panel lists every bundled fixture — scroll the
list and click a match to load and watch it. The controls give you
pause/play, restart, a **Freeze frame** ghost comparison (bodies, lanes and vision), a **PNG frame export** with legend, a 0.25×–8× speed
slider, ±5 minute seek, and a path box to load any XML by path (or use the **Load XML** dialog).

The viewer starts on the **Tactical** preset and overlays broadcast-style analysis: a light cumulative heatmap,
ball-carrier highlight, an attacking triangle, four attacking channels that
show where the ball can go, gold run landings, a role-shaped vision field
(keepers see wide, strikers see tight), three unit passing webs (DEF teal,
MID violet, ATT rose) with tiered strength and formation-aware regrouping,
a translucent defensive hull when out of possession, a
pressing trigger, and an offside line that appears only while it is informative
(open play, an attacker near the line, and no parked back line). The overlays
follow possession and fade during set pieces. Each analytical layer has a
toggle in the effects bar; **Shuffle effects** cycles one enabled layer at a
time. Two presentation toggles sit beside them: **Ball trail** draws a long,
tapered white streak behind a moving ball, and **Carrier grow** eases the
marker of the player in possession noticeably larger (5 px → 9 px) and spins a
white/pink possession ring around it that grows with the body and fades smoothly
to the next carrier. Both stay on screen during shuffle and
ride along with the Broadcast, Tactical and All presets; with
`prefers-reduced-motion` the trail is omitted, the radius changes snap and the
ring holds a fixed angle.

Click **Lab** above the pitch (or add `?lab=1` to the URL) to open the
Variant lab and compare alternate renders of the same analysis without editing
code. Vision cones have classic, soft-wedge,
spotlight and outline skins; pass lanes have classic, dot-free, corridor-target
and ghost-trail versions; run channels can be arrows, arrow-free lanes, landing
blobs, trails or thin traces; heatmaps switch between raster and hex bins; the
passing network switches between unit outlet wires and the dynamic DEF / MID /
FWD bands chained end to end;
the possession ring has a blended comet gradient and a counter-spinning duo;
the field has classic, broadcast and night palettes. Presets switch the whole
layer stack between Broadcast, Tactical and Clean. The recommended default is the
softened cone, the labeled pass corridor, the arrow-free run lane and the comet
ring; the original classic skins remain selectable. Shift-click an effect to solo it, or use the Broadcast / Tactical / Clean
presets; preset and variant choices both survive a reload. In the default pass-lane corridor, click a target chip to open that
receiver's player analysis. The chosen variant is stored in
`localStorage`, so a demo survives a reload. Pass lanes hold for ~2.4 s by
default and passing-network links decay over ~3 minutes; both are adjustable
under the pitch and fade as ghosts across a turnover
instead of disappearing on the first pass.

## 3D highlight replay

When a notable event lands, the sidebar Highlights stack grows a **3D replay**
card. Opening it runs a short theatre sequence around the event (15 s before,
15 s after) at 0.5× speed, with Auto / Wide / Follow / Close cameras and a
scrubber. The stadium, kits and ball are built procedurally at runtime; the
live 2D GEV is untouched.

Players are 19-bone humanoids animated from retargeted Mixamo soccer mocap:
idle, walk/jog/run/sprint, side-foot passes and instep strikes, jumping headers,
slide tackles, falls and get-ups, keeper dives/catches/body blocks, throw-ins,
receives, volleys and scoops. Walk, run and sprint are motion-warped from the
jog cycle because the source pack does not ship separate locomotion clips.
Actions are derived deterministically from the event (the passer and the
receiver are both animated from the future ball path, the defending keeper
dives or catches, fouls produce a tackle → fall → get-up, aerials produce a
jumping duel) and sampled from absolute clip time, so scrubbing and pausing
always land on the correct pose.

The FBX files are a local build input and are not committed: Mixamo allows
shipped game motion but not redistribution of the raw character/animation
files. `match_engine/tools/bake-mixamo` retargets the source pack offline into
the compact 30 Hz quaternion buffers in `mixamoClips.js`. Re-run the baker after
changing the rig rest pose, clip trims or gait warps; see its README.

The crowd reacts as one stadium: head bob, sway, a travelling goal wave, tifo
banners in team colours, waving flags, rippling goal nets, pulsing LED boards
and a pooled confetti burst behind the scoring goal. One shared energy scalar
drives all of them and decays over a few seconds. `prefers-reduced-motion`
falls back to a static wide camera and rest poses.

## Deploy to Render

The repo ships a multi-stage `Dockerfile` (Rust WASM build → Caddy
static server) and a `render.yaml`. Push to GitHub, then:

1. In Render, create a **Web Service** and connect this repository.
2. Set the environment to **Docker** (Render auto-detects the
   `Dockerfile` at the repo root).
3. Deploy. The container compiles the WASM engine, copies the fixtures
   into `web/matches/`, generates `matches.json`, and serves the app on
   the port Render injects through `$PORT`.

Or with the Render CLI:

```
render apply --file render.yaml
```

## Tests

```
cd match_engine
cargo test
node --test web/*.test.mjs
node web/smoke_test.cjs          # requires the Node wasm bindings (see web/README.md)
```
