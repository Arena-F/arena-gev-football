# Mixamo → 3D replay baker

Offline retargeter for the 3D highlight replay. It converts the downloaded
Mixamo soccer FBX set into the compact, seek-safe quaternion clips the runtime
plays.

## Licensing

Mixamo's terms allow shipped game motion but **not redistribution of the raw
character or animation files**. The FBX files are therefore a local build input
and are gitignored; only the baked motion buffers (`mixamoClips.js`) ship with
the app. Do not commit `source/`, `*.fbx`, or a copy of the raw Mixamo files.
The app does not train models on Mixamo content.

## Setup

1. Download the soccer clips from Mixamo (free Adobe ID) at 30 fps, without
   skin. The current set is the extended **Soccer Game Pack** (67 files):
   base idles, jog/strafe/diagonal locomotion, passes (`kick soccerball (2)`,
   `Soccer Pass`, `Chip`), strikes, headers, tackles, trips, falls, dribbles,
   stalls, throw-ins and the full keeper set (dives, catches, blocks, scoop,
   miss, distribution, placing, sidestep, directing).
2. Put the FBX files in `source/` (or pass `--source <folder>`).
3. Install the one dev dependency and bake:

```bash
cd match_engine/tools/bake-mixamo
npm install
npm run bake -- --source "C:/Users/me/Downloads/Soccer Game Pack" --append
```

`--append` bakes only the extra clips and merges them with the previously
committed outputs, reusing the frozen base clips byte-for-byte so existing
behaviour can never drift. A full rebuild (no `--append`) re-bakes everything
and fails loudly if any base clip duration drifts.

The baker writes:

- `match_engine/web/replay3d/mixamoClips.js` — 30 Hz quaternion + hips buffers
  (base64), decoded at module load.
- `match_engine/web/replay3d/mixamoTiming.js` — clip durations, contact points,
  event lead times, natural gait speeds and the `MOCAP_VARIANTS` group table
  used by `playerActions.js` for deterministic variant shuffling.

Re-run after changing trims, warps, the rig rest pose, or the Mixamo source
list. The generated files are committed so the app and its tests never need
Node dependencies or the FBX files.

## Unparseable files

Six files in the extended pack use an FBX property type the vendored
FBXLoader (three 0.186) does not understand, so the baker skips them with a
`SKIP` warning instead of failing the run:

- `goalkeeper sidestep (2).fbx` → covered by `goalkeeper sidestep.fbx`
- `jog backward diagonal (2).fbx` → covered by `Jog Backward Diagonal[. (1)].fbx`
- `jog forward diagonal (2).fbx` → covered by `Jog Forward Diagonal[. (1)].fbx`
- `kneeing soccerball.fbx` → covered by `kneeing soccerball (2).fbx`
- `soccer tackle (3).fbx` → covered by `Soccer Tackle[. (1), (2)].fbx`
- `scissor kick.fbx` → no substitute in the pack (not baked)

`X Bot.fbx` (bind-pose reference, 0.03 s) and the over-long ambient takes
(`Goalkeeper Placing Ball (1)/(2)`, `goalkeeper directing`, `Transition`) are
deliberately not baked: they have no runtime trigger.

## What it does

- Samples each FBX at 30 Hz.
- Maps Mixamo's bones onto the replay rig's 19 bones. The source faces +Z, the
  replay rig faces +X, so source-left maps to target-right and vice versa.
- Keeps full world orientation for hips/spine/chest/neck/head (twist and lean
  matter). Limbs use **swing-only** retargeting: only the bone direction is
  copied, so Mixamo's bone roll cannot flip a boot or twist an arm capsule.
- Removes forward/lateral travel. One-shots stay at the engine's player
  position; keeper dives keep a scaled lateral excursion. The hips still carry
  the vertical bob, crouch and dive height.
- Clamps the lowest boot to the ground and smooths the lift.
- Derives walk/run/sprint from the jog cycle: time-warp plus limb-swing
  amplitude and a forward torso lean.
- Adds a 0.9 s jump lift for the standing header at the rig root in
  `players.js` (the mocap header keeps a foot planted).

The runtime pose path is pure: every pose is a function of absolute clip time,
so seeking, pausing and reverse playback are deterministic.
