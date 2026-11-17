# God's Eye View — WASM front end

Zero-copy HTML5 Canvas renderer driving the Rust match engine compiled to
WebAssembly.

```
web/
├── index.html         # pitch, HUD and controls
├── app.js             # fixed-step loop + Canvas drawing (Float32Array view)
├── analysis.js        # pure tactical geometry (roles, shape units, triangles)
├── analysis.test.mjs  # Node unit tests for the geometry maths
├── attackLanes.js     # live four-channel tracker (grow, score easing, pass pulse)
├── attackLanes.test.mjs
├── attackChannels.js  # live run-channel tracker (grow, fade, landing glow)
├── attackChannels.test.mjs
├── heatmap.js         # pure cumulative team heatmap (density grid)
├── heatmap.test.mjs
├── overlays.js        # Canvas drawing for the team overlays
├── overlays.test.mjs  # headless Canvas-harness tests for the draw routines
├── graphs.js          # momentum strip + passing network accumulators
├── graphs.test.mjs
├── ballMotion.js      # ball trail + carrier emphasis + possession ring
├── ballMotion.test.mjs
├── effects.js         # layer toggles + shuffle state
├── effects.test.mjs
├── presets.js         # Broadcast / Tactical / Clean layer presets + storage
├── presets.test.mjs
├── variants.js        # persisted render-variant catalog for the Variant lab
├── variants.test.mjs
├── fieldThemes.js     # pitch palettes for the field variants
├── fieldThemes.test.mjs
├── dribbles.js        # pure dribble analysis (zones, stats, live window, insights)
├── dribbles.test.mjs
├── dribbleOverlay.js  # Canvas drawing for the 12-zone dribble heat layer
├── dribbleOverlay.test.mjs
├── playerPanel.js     # slide-in analysis panel (team lens + per-player lens)
├── playerPanel.test.mjs
├── transitions.js     # renderer-only substitution choreography
├── transitions.test.mjs
├── replay3d/          # 3D highlight replay experiment (see below)
│   ├── PLAN.md        # phase log, decisions and review notes
│   ├── clipStore.js   # 10 Hz ring buffer + windowing + sampler
│   ├── replay3d.js    # sidebar CTA + theatre controller
│   ├── stage.js       # lazy three.js renderer
│   ├── stadium.js     # pitch, goals, stands, crowd
│   ├── players.js     # Mixamo mocap playback + kit recolour
│   ├── mocapPose.js   # seek-safe quaternion sampling + procedural bridge
│   ├── playerActions.js # event → action state machine
│   ├── mixamoClips.js # generated 30 Hz mocap buffers (do not edit)
│   └── director.js    # broadcast camera shots
├── vendor/three/      # vendored three.js r186 (module + core + license)
├── smoke.test.mjs     # boots app.js under a stub DOM (link/id/render checks)
├── smoke_test.cjs     # end-to-end test of the compiled .wasm (Node)
└── README.md
```

## Quick start (one command)

From the crate root:

```bash
./run_web.sh            # builds the wasm + bindings, then serves on :8000
./run_web.sh 9000       # …or a different port
```

Then open **<http://localhost:8000/web/>**.

The script adds the `wasm32` target and `wasm-bindgen-cli` if missing, compiles
the JS bindings into `web/pkg/`, copies the bundled fixtures into `web/matches/`,
generates `web/matches.json`, and starts a static server.

### Manual steps (if you prefer)

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli

cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/match_engine.wasm

python -m http.server 8000     # then visit http://localhost:8000/web/
```

> Browsers refuse ES modules and `fetch()` over `file://`, so you must serve the
> crate root with a static server — opening `index.html` directly will not work.

## Browsing matches

The match panel lists every Opta F24 match bundled in `data/`. Click one to
load it and watch the simulation. The list is generated at build time into
`web/matches.json` by `cargo run --release --example gen_manifest`; the XML
files themselves are copied into `web/matches/` so the browser can fetch them.

## Loading a different XML file

Three ways, in order of convenience:

1. **`?xml=` query parameter** — put the file anywhere under the served root and
   address it:
   `http://localhost:8000/web/?xml=my_match.xml`
2. **”XML path” box** — type a path relative to `web/` and press **Load path**
   (e.g. `my_match.xml`, or `matches/OTHER.xml`).
3. **”Load XML” button** — pick any local `.xml` file with the OS file dialog
   (works without copying it into the served folder).

The controls also give you **Pause/Play**, **Restart**, a **0.25×–8× speed**
slider, and **Freeze frame**: the current bodies, pass lanes and vision cone stay as dashed
ghosts while live play continues, so you can compare the shape before and after
a change. Once the match has changed hands, the previous possession is drawn
as an extra faint ghost underneath; the ◀/▶ buttons step back through up to
four recent possessions. **Export frame** downloads the current pitch view with a burned-in
legend and match clock as a PNG. The HUD shows match time, FPS, entity count and ball altitude, plus a
team pill naming the side currently being analysed and its formation.

## Live event feed & splash

A right-hand **sidebar** shows the last 8 events (time · type, colour-coded by
team). **Goals, cards, fouls, corners, offsides and substitutions** also
trigger a large centre splash. The HUD carries a **scoreboard**, a
**possession bar** and ball altitude; both **goal nets** are rendered.
**⏪/⏩ 5 min** buttons seek through the match for analysis.

All of it reads straight from the engine via the bridge:

```js
engine.get_event_seq();            // changes when a new event fires
engine.get_recent_event_count();   // newest is index count-1
engine.get_recent_event_label(i);  // "Goal", "Card", …
engine.get_recent_event_notable(i);
engine.get_score_home();           // scoreboard
engine.get_score_away();
engine.get_possession_home();      // 0..1 possession bar
engine.get_player_role(i);         // 0 unknown, 1 GK, 2 DEF, 3 MID, 4 FWD
engine.get_possession_team();      // 0 home, 1 away, -1 neutral
engine.seek_to(300);               // jump to 05:00 (rebuilds + fast-forwards)
```

## 3D highlight replay (experiment)

The **3D Replay** card sits in the sidebar's Highlights stack (above the 2D
highlight canvas), so it never covers the pitch. When a notable event fires,
the card shows `REC` while a short window is captured, then flips to `READY`;
clicking it opens a full-screen theatre. The live 2D GEV keeps running behind
the overlay, and `Escape` returns to it.

- **Window** — 15 s before and 15 s after the event (30 s sequence by default),
  captured from the same 10 Hz snapshot the 2D pitch draws. Nothing is
  re-simulated and the engine is never seeked for a replay. A corner followed by
  a goal inside the window becomes one clip with the goal as its headline.
- **Playback** — opens at the start of the window at **0.5×** (0.25× / 1×
  selectable). Scrubber, play/pause, `Space`, `←`/`→` (±2 s), `Escape` to close.
- **Camera** — Auto glides through high broadcast positions: a top-of-stadium
  wide, a high broadcast follow, an elevated close-up and a behind-goal net cam
  for shots/goals, then back to broadcast. Shot changes blend over ~1 s with a
  fly-over lift instead of hard cuts; scrubbing snaps. Manual `Broadcast`,
  `Wide`, `Follow`, `Close`, `Goal` and `Tactical` chips override the director.
  A beaten net ripples the goal cam, scaled by the stadium energy.
- **Players** — 19-bone humanoids with team shirt/shorts/socks, GK variants,
  back numbers redrawn on substitutions and a soft blob shadow per player.
  Motion is retargeted Mixamo soccer mocap from the extended 67-file pack (51
  baked clips): idle variants, directional locomotion (backpedal, side-shuffle,
  diagonal runs, striker runs), side-foot/driven/chipped passes, strikes,
  jumping headers, slide tackles, trips, downed holds, get-ups, dribble
  touches, skill stalls, throw-ins, receives, volleys, keeper dives/catches/
  blocks/scoops/misses/distribution/placing. Same-name clips shuffle
  deterministically per player (the base clip owns hash < 0.62, so legacy
  behaviour is preserved); a group never serves another semantic (a header
  variant never plays a pass). Locomotion follows the measured speed and
  direction; one-shots are blended from the event and sampled from absolute
  clip time, so 0.5× playback and scrubbing stay correct. The raw FBX files
  are a local build input and are not committed; the baker lives in
  `match_engine/tools/bake-mixamo` (`--append` freezes the base clips).
- **Stadium** — procedural night bowl: worn mown pitch with metric markings,
  corner flags, goals and nets, LED boards, three tiers, roofs with light
  strips, floodlights with glow sprites, stars, jumbotron with fixture/score/
  match clock, dugouts, tunnel and pitch-side cameras. The crowd is four
  instanced layers sharing one placement set: bodies (bob/sway/wave), heads
  (independent nod), arms (energy-gated waves) and handheld banners (raised,
  waved, then lowered periodically) — plus tifo, flags and confetti, all
  driven by one energy scalar.
- **Analysis in 3D** — the theatre projects the same analytical stack onto
  the pitch: heatmap (match-so-far snapshot), passing network (unit outlet /
  unit webs from the analysis log), offside line (informative-only rule), carrier &
  shape, pass lanes, run channels, role-shaped vision cone/field and dribble
  zones, drawn by the same 2D routines onto a ground canvas with the same
  variants. Side panel: layer toggles with shift-click solo, shuffle, the
  Broadcast/Tactical/Clean/All presets, a layer-style lab, readout, live
  minimap, momentum strip, event feed and the full team/player analysis
  panel (follows the replay clock; seeking stays inside the clip window).
- **Post FX** — High (bloom + broadcast grade/vignette/grain), Medium
  (grade only) and Low (direct render) tiers with a vendored composer; any
  failure falls back to direct rendering. Reduced-motion freezes the grain
  and the camera transitions.

Three.js r186 is vendored under `web/vendor/three/` (`three.module.min.js`
imports `three.core.js`, plus the post-processing addons), so the page works
offline with the same `python -m http.server`; the stage is imported lazily
only when the theatre is opened. Pausing the match freezes the sim clock, so
a 2.5 s watchdog flushes a partial clip instead of leaving the card on `REC`
forever. Seeks and match loads reset the recorder and close a stale theatre.

Files: `replay3d/clipStore.js` (ring buffer + sampler, DOM-free),
`replay3d/replay3d.js` (card/theatre controller), `replay3d/stage.js`
(renderer + post pipeline), `replay3d/stadium.js`, `replay3d/players.js`,
`replay3d/mocapPose.js` (seek-safe quaternion sampler),
`replay3d/playerActions.js` (event → action state machine with variants),
`replay3d/analysis3d.js` (ground-projected analysis layers),
`replay3d/playerClips.js` (procedural fallback/celebrations),
`replay3d/mixamoClips.js` + `mixamoTiming.js` (generated mocap data,
timings and variant groups), `replay3d/director.js`. Tests:
`node --test web/replay3d/*.test.mjs`. `window.__gev.replayRecorder` and
`window.__gev.replay3d` expose read-only debug handles (including the last
analysis layer error).

## Team analysis overlays

The overlays **follow possession**: exactly one team is shown at a time (the
side in possession). The layer waits for 0.35 s of stable possession and then
crossfades over 0.18 s, so turnovers never cause the whole analysis to
flicker. Every analytical layer is on by default and can be switched off
independently from the effects bar above the pitch.

- **Shape (triangle)** — three unit segments traced through the current
  defenders, midfielders and forwards (the GK is excluded), plus a translucent
  triangle joining the three unit centroids. DEF / MID / ATT are colour-coded
  and labelled at the end of each segment. A unit with one player shows a dot
  instead of a line; the triangle only appears when all three units exist.
- **Passing network** — three dynamic bands in the possession
  team's colours: defenders in teal, midfielders in violet, attackers in
  rose (the keeper is excluded). A band follows live shape, not just the
  teamsheet: a midfielder who pushes beyond the forward line joins the
  attack band and chains with the strikers, and dropping deep returns him
  to the midfield — and eventually the defence — band, with hysteresis so
  shirts never flap between bands. Each band is chained end to end across
  the pitch width for the smallest total length, so lines never wrap around
  bodies. Pairs with real pass history always draw their own wire and step
  up a per-unit pass ladder (DEF 1/4/10/22, MID 1/3/8/18, ATT 1/2/5/12)
  as they keep combining. The **Unit outlet** variant in the lab keeps one
  wire per player to his most-used same-band teammate in the current
  possession; the window clears on a turnover. Link weight decays with a
  three-minute time constant: a pair that stops combining thins back toward
  the baseline, while a fresh pass refreshes the timestamp and thickens it
  again. Formation changes regroup the bands live: new band links fade in,
  removed ones fade out, and surviving wires ease toward their new tier.
- **Live heatmap** — a cumulative density map of the followed team's
  positions from load/seek onward, sampled every 0.25 s of match time. Home
  uses a warm ramp, away a cool ramp; the soft wash is confined to the pitch
  and resets on load, restart and seek so it always describes the current
  position.
- **Momentum strip** — sidebar canvas: cumulative model-estimate threat per
  team with goal/shot/card ticks.
- **Pass lanes** — four 17 m horizontal channels on the opposition half,
  drawn only for the team in possession once the carrier is past halfway. The
  lane the carrier's velocity and acceleration project into burns brightest;
  the other lanes brighten by the best viable pass into them, and the carrier's
  current lane keeps a baseline. Lanes grow from halfway and **hold for 2.4 s
  (adjustable with the Lane memory slider)** after possession changes, then
  fade as ghosts, so a pass or turnover reads as a handover rather than a
  vanish. The default **Corridor** variant marks the best receiving shirt and
  its completion probability at the end of each lane; hovering that chip previews the receiver and click
  opens the receiver's player analysis; the chip follows the live player. **Classic** keeps the original travelling
  pass pulse.
- **Run channels** — live 6–12 m forward runs the attackers should make
  during a progression, scored by xT gain and the time gained on the nearest
  defender. The default **Lanes** variant draws a wide arrow-free corridor with
  a calm centreline; other variants keep the legacy arrows, landing blobs,
  player trails or a thin trace. The landing zone still tints gold when the
  endpoint reaches the attacking half.
- **Vision** — two layers for the carrier, both sized by **role**, not by a
  random draw. The near layer is the familiar cone and blind circle
  (GK 26 m / 80°, DEF 24 m / 70°, MID 22 m / 62°, FWD 20 m / 54°). The long
  layer is a raycast field: GK 58 m, DEF 44 m, MID 36 m, FWD 30 m. Opponents
  block the sightline; a keeper is additionally screened by his own
  defenders. The near cone and the long field share an angular falloff:
  brightness peaks at the facing direction and fades toward the rim. The rate
  is role-shaped — the keeper keeps a high rim value (a floodlight, near
  all-round awareness), each line forward steepens it, and a forward reads as
  a tight torch. Distance falloff and the crisp raycast shadows stay on top.
  Teammates with a clear sightline are joined in teal; the rest are dotted
  red. The cone faces the best available pass (not the ball at the carrier's
  feet). The default **Soft wedge** skin drops the teammate lines and the
  long-field shadows; **Spotlight**, **Minimal outline** and **Classic** remain
  selectable in the Variant lab.
- **Player heat** — the analysis minimap sometimes shows a randomly chosen
  player's cumulative heat (rotates every 45 s, resets with the followed team).
- **Scripted sequences** — goal mob, save puff, woodwork ping, card/penalty
  banners; all renderer ghosts, all seek-safe.

The passing network is anchored to the live player positions and shows while
the followed team still has the ball, after at least three consecutive passes.
A sustained interception clears the retained sequence immediately (the layer
hides as soon as possession is lost). The default **Unit webs** mode keeps
three match-long cumulative webs — DEF, MID and FWD — instead of one team
web: every intra-unit pair is a link, zero-pass pairs are a faint thread,
and a pair steps up its unit's pass ladder only as those two players keep
exchanging the ball (absolute pass count, not relative to the strongest
link). **Unit outlet** describes only the current possession instead: each
player keeps one wire to his most-used same-unit teammate, and the window
empties on a turnover.

The offside line is a reference, not a fixture: it is shown only while it says
something. It hides when the back line is camped within 15 m of the goal it
defends (the line sits on the box, with no space behind it), when the line
merely repeats the ball position (the ball is beyond the second-last defender),
and when no attacker is within 18 m of it. Set pieces hide it too, and a 0.5 s
dwell keeps a drifting line from strobing.

### Effect toggles & shuffle

The effects bar above the pitch controls each analytical layer independently:
**Heatmap**, **Passing network**, **Offside line**, **Carrier & shape** (carrier
ring, threat label, press ring and defensive hull), **Pass lanes**, **Run
channels**, **Vision cone** and **Dribbles**. The app starts on the
**Tactical** preset (all spatial layers except dribble zones); **All** turns
every layer on.

Two **Motion** toggles sit at the end of the same bar and are independent of
the analysis stack:

- **Ball trail** — a short white streak behind a moving ball (roughly 0.4 s of
  travel). It is tapered from a transparent tail to a soft white head, drawn as
  midpoint quadratics through the real trajectory, and suppressed below
  walking pace and while paused. A teleport (kickoff re-spot, seek) starts a
  fresh history instead of drawing a phantom line across the pitch.
- **Carrier grow** — the marker of the player at the ball eases from 5 px to
  9 px radius and the previous carrier eases back. The change follows the ball
  itself, so it works for either team and hands over on a turnover. A white/pink
  possession ring spins around the grown marker; it rides the same eased radius
  (so it widens with the body), fades out with the old carrier and fades in with
  the new one. The **Comet gradient** skin (default) blends the two colours
  around one continuous band; **Counter-spin duo** in the Variant lab runs a
  white arc and a pink arc in opposite directions. Under
  `prefers-reduced-motion` the trail is omitted, the radius change snaps and the
  ring holds a fixed angle.

Both motion toggles stay on screen during **Shuffle effects** (which rotates
only the analytical layers) and ride along with the Broadcast, Tactical and All
presets; Clean turns them off with everything else.

**Shift-click** any layer to solo it; shift-click again restores every layer. Preset and variant choices are both stored in `localStorage`.
The **Lane memory** slider under the pitch controls how long pass lanes linger
after possession changes. **Network memory** controls the passing-network
decay constant; shorter values thin old links faster.

The **Presets** control switches coherent layer sets: **Broadcast** (heatmap,
carrier shape, offside), **Tactical** (the full spatial stack), **Clean** (no
overlays) and **All**. The passing network's unit-outlet/unit-webs choice now lives in
the Variant lab rather than a separate button. Hiding a layer only skips its draw call: the samplers and trackers
keep running, so switching it back on resumes the live state instead of
resetting it. Toggle choices persist across seeks, restarts and match loads.

**🔀 Shuffle effects** shows exactly one enabled analytical layer at a time and advances
every 4 seconds, wrapping through the enabled set. The current layer's button
is highlighted. Turning Shuffle off restores the normal view for every enabled
toggle. Disabling the layer currently on screen moves Shuffle to the next
enabled layer; if no layers are enabled, Shuffle shows nothing. The two
**Motion** layers are deliberately outside the rotation and stay visible for
every shuffle frame.

### Variant lab

The **Lab** button (or `?lab=1` in the URL) opens the Variant lab. The lab swaps renderings without touching
the analysis maths. Vision cone has classic, soft-wedge, spotlight and outline
skins. Pass lanes has classic, dot-free, corridor-target and ghost-trail
versions; Corridor draws the receiving shirt and completion probability at the
lane end. Run channels has arrows, arrow-free lanes, landing blobs, player
trails and a thin trace. Heatmap has raster and hex-bin outputs; field has
classic, broadcast and night palettes; analysis has a minimal carrier-and-hull
mode; the possession ring can be the blended **Comet gradient** (default) or the
counter-spinning **Duo** arcs. The recommended defaults are soft-wedge, corridor,
lanes and comet. Selections are stored in `localStorage`, and **Reset to
recommended** restores them.

Set-piece robustness: a corner holds the ball at the flag while the box fills.
If the feed includes a delivery pass, that cross is used; if the synthetic feed
omits it, the engine stages a plausible delivery itself. Goalkeepers are never
selected as corner/free-kick/throw-in takers and are leashed to their own goal.
Duplicate "player on" rows in synthetic feeds are ignored so two bodies can
never share one identity (which used to tear the goalkeeper's anchor apart).

The pure geometry and accumulators (`analysis.js`, `heatmap.js`, `graphs.js`)
plus the 3D clip store are DOM-free and covered by Node tests:

```bash
node --test web/*.test.mjs web/replay3d/*.test.mjs
```

## Dribble analysis

The **Dribbles** effect draws a take-on/carry layer over the pitch, and clicking
into it opens a slide-in analysis panel. Everything is derived once per match
from `engine.get_analysis_json()` (a schema-v1 log of every event plus both
rosters). The index itself is static and seek-safe; what it *shows* is
time-aware, so the analysis grows live as the match plays.

Any match file dropped into `match_engine/data/` is picked up by
`examples/gen_manifest.rs` and works with the same pipeline — there are no
match-specific constants. Feeds that contain no take-on/carry events (the
synthetic Arsenal and Man City fixtures are examples) get an honest empty
state instead of invented numbers.

### Live window

- **So far** is the default: zones, markers and every panel stat count only
  what has happened up to the sim clock. Kick-off starts blank and the view
  fills in as the match plays; seeking moves the window with the clock.
- **Whole match** flips the same views to the finished match. The toggle sits
  at the top of the panel (above its filters) and under the pitch beside the
  zone opacity — one state, two places to reach it. The pitch-side twin hides
  while the panel is open, since the panel carries its own copy.
- The model snaps a horizon to the moments stats can change (a dribble starts,
  or its 8 s post-dribble outcome window closes), so live rendering is cheap
  and never leaks the future: a shot that happens after the current clock is
  not counted yet, and only goals up to a dribble's own clock decide the
  game-state filter.
- Names come from the event rows; roster players the feed never names (bench
  players in Opta F24 often arrive anonymous) are labelled by shirt — `#49`
  in the squad, `Player 49` in headers and exports — never by the raw feed id.

### Pitch layer

- The pitch is divided into **12 zones** (4 rows × 3 columns) defined in the
  **attacker's own frame**: home attacks +x, away's view is mirrored on both
  axes, so zone 1 is always "own third, defender's left". Zone ids 1–12 run
  row-major and are printed in the corner of every cell.
- Each used zone is washed with a heat colour scaled to its attempt volume and
  tinted by success rate; empty zones stay unwashed. The **Zones** slider in
  the view controls sets the layer opacity (default 55 %).
- Attempt markers sit at the dribble's start: **✓** green = won take-on
  (arrow to where the ball was carried/received within 5 s), **✗** red = lost
  take-on, **○** blue = progressive carry. Sequence numbers appear while the
  team has 20 attempts or fewer.
- Clicking a zone selects it: the zone is outlined on the pitch, a clearable
  chip appears in the panel, the zone table and zone-map ring highlight that
  row, and the timeline dims attempts from other zones (its click-to-seek
  then only lands on this zone's attempts). Zone ids live in the attacker's
  frame, so a selection follows the team lens through possession flips.
  Hovering pre-highlights the cell.

### Analysis panel

Open it from a zone click, from a player's context menu (**Open player
analysis**), or from **Show team dribble zones**; `Escape` closes it. The team
lens follows the pitch's followed side (and flips with it live) unless the
per-player lens is open.

- **Filters** — half (1st/2nd/both), game state (ahead/level/behind) and a
  player picker apply to every stat in the view, on top of the time window.
- **Team lens** — attempt/success/shot-after totals, the busiest-zone table
  (click a row to select that zone), the ✓/✗/○ effectiveness scale, rule-based
  insights and the squad list (click a player to switch lenses). A feed with no
  dribble events shows a single explanatory note instead of empty charts.
- **Live vision** — while this player is on the ball, the panel shows their
  current field-of-view coverage, visible/blind teammate counts and best pass
  option. The block updates live without rebuilding the rest of the panel.
- **Player lens** — four percentile metrics vs team-mates with ≥2 dribbles
  (attempts, success rate, gain, shot-after rate) with star ratings; a
  **per-zone circle map** where circle *size* = attempts, *fill* = success
  rate and *ring* = confidence (few attempts → fainter ring); a thirds split;
  and a **minute strip** of every attempt across the 90 minutes. Clicking the
  strip seeks the sim to that attempt (read-only scrubber — it jumps, it does
  not scrub). The view's **Export** button downloads the current view,
  filters, time window and every attempt as JSON.

### View controls

**Zoom** (slider; ctrl/cmd + wheel also zooms), drag-to-pan on the pitch and
**Reset view**. The transform is a single canvas matrix — identity at rest,
so hit tests and export coordinates stay honest. Plain wheel still scrolls
the page; touch keeps vertical page scrolling (`touch-action: pan-y`).

The **So far / Whole match** toggle under the pitch mirrors the panel's stats
window; it hides while the panel is open (the panel carries the same control).
**Zones** sets the dribble-layer opacity. Seeking while paused updates the HUD
clock and score immediately rather than waiting for playback to resume.

`window.__gev` exposes read-only handles (`engine`, `players`, `panel`,
`index`, `view`, `toScreen`, `seekTo`) for console debugging and automated
checks.

## Off-ball movement, phases & substitutions

The macro formation engine owns each player's anchor. The utility brain adds
the details that make the other ten players look like footballers rather than
escorts:

- **Duties** — every outfielder is classified from the lineup and template as
  a centre-back, full-back, holder, central midfielder, No.10, winger or
  striker. The duty travels with the agent through substitutions and drives
  press bias, marking fit and shape. Bench players arrive as category 5 in the
  feed, so a substitute inherits the outgoing player's role and duty; he fills
  the slot's line instead of becoming an unknown forward.
- **Phases** — a hysteretic team state machine (build-up, progression, final
  third; high press, mid-block, low block; attacking/defensive transition)
  scales tempo, zone size and line height. It needs a short dwell before it
  changes, so the block does not flicker.
- **One-to-one marks** — the defending team solves a role-weighted assignment
  each tick. Each opponent is picked up by at most one marker; the presser and
  cover are excluded because the ball already occupies them; unassigned
  players hold shape instead of converging on the nearest shirt.
- **Shared event lookahead** — every player, tracked or not, reads the same
  block: this team's next ball event, the opponent's next event, and the
  landing point when that next beat is a pass. A later cross can never shadow
  an earlier shot or tackle. A player starts moving when his own travel time
  says he must in order to arrive with a settling cushion. Strikers attack the
  box, the No.10 and midfield shift across into the support pocket, the holder
  screens for the second ball, wingers attack the far post, and defenders
  shuffle laterally. The macro block owns every defender's and midfielder's
  line height, so a cue never dissolves the back line or the visible midfield
  banks; only forwards may attack a new depth. Event-bound actors stay exempt
  so the feed's logged spot remains authoritative.
- **Substitutions** — the engine swaps identity in place on the `On` event.
  `transitions.js` watches the `(team, shirt)` buffer for that swap and draws a
  renderer-only walk-off to the pavilion and a walk-on from it. The live body
  is hidden only while its incoming ghost is moving; overlays filter it out.
  Engine positions, event ownership and the 23×6 buffer are untouched.

## Player individuality & zone discipline

Every player carries deterministic attributes (pace, aggression, workrate,
flair, positioning, determination, composure, stamina) hashed from their id,
plus a coarse role (GK/DF/MF/FW). These drive sprint speed, how eagerly each
individual presses/supports, how tightly they hold their zone (defenders stay
home, forwards push high) and how much they fidget. Set pieces reshape both
teams: corners flood the box, throw-ins/free kicks send only the taker to the
ball while everyone else holds shape.

## Buffer contract

`get_render_buffer_ptr()` returns a pointer to `23 × 6 = 138` `f32`s in WASM
linear memory:

| index | field |
|---|---|
| 0 | x (metres) |
| 1 | y (metres) |
| 2 | z / altitude (metres) |
| 3 | heading (radians) |
| 4 | team index (0 home, 1 away, 2 ball) |
| 5 | shirt number |

Slots `0..get_player_count()-1` are players; the ball is always pinned to the
final slot (`22`). `app.js` creates a new
`Float32Array(wasm.memory.buffer, ptr, 138)` **every frame** because the WASM
heap can grow during `tick()` and detach older views.

## Test the wasm and overlays without a browser

```bash
node --test web/*.test.mjs web/replay3d/*.test.mjs

wasm-bindgen --target nodejs --out-dir pkg-node \
  target/wasm32-unknown-unknown/release/match_engine.wasm
node web/smoke_test.cjs
```
