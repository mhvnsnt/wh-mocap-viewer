# wh-mocap-viewer
Stick-figure mocap viewer — test fighting-game animations on the little blue and orange guys (white grid, shadows, thrower cyan / victim orange). Plays real source clip data.

Live viewer: https://mhvnsnt.github.io/wh-mocap-viewer/

## The viewer

`index.html` + `viewer.js` + `viewer.css` — no build step, no dependencies. Open the
live URL on a phone or desktop; it loads `clips/manifest.json` and plays the clips.

- **Panels:** T3 vs T7 side by side (landscape) or stacked (portrait). View toggle: T3 / T7 / both.
- **Controls:** play/pause (or tap a panel), scrub bar, speed (0.25×–2×), clip selector.
- **The look** (kept from the lane-B skeleton videos): white grid floor (`#f2f2f2`,
  grid lines `#d0d0d0` every 0.5 m), soft elliptical foot shadows, stick-figure
  skeletons — thrower cyan `(0,150,190)` with dark outline `(0,90,120)`, victim orange
  `(230,80,0)` with dark outline `(150,45,0)`. Move/game/clip IDs and measured numbers
  in each panel header; per-frame HUD in the footer (THR f / VIC f, output frame, time).
- **Camera** (ported from lane-B `render.py`, not reinvented): fixed orthographic 3/4 view,
  azimuth 32°, elevation 14°; per-frame follow center = centered 9-frame moving average
  of the pair-bbox center; one fixed scale per clip pair (computed from the max pair
  bbox, with a no-clip shrink check), so T3 vs T7 travel/height compare true to scale.
- **Retiming:** output 60 fps. T3 clips are stored at 30 fps — each stored frame is held
  2 output frames (stream length 2n−1). T7 clips are native 60 fps. A clip that ends
  before the pair clock holds its last frame, tagged HELD in the footer.
- **Data:** real source clip data only. No hand-tooled motion, no invented clips.

## Clip format (`wh-mocap-clip/1`)

`clips/<game>-<move>-<role>.json` — one file per figure per game per move:

```json
{
  "format": "wh-mocap-clip/1",
  "id": "t3-1plus3-winding-nut-thrower",
  "fighter": "king",
  "move": "1+3",
  "moveName": "WINDING NUT",
  "game": "T3",
  "role": "thrower",
  "sourceClip": "0xaeb",
  "slot": 2795,
  "moveRow": 415,
  "srcFps": 30,
  "srcFrames": 66,
  "streamFrames": 131,
  "headingDeg": 108.5,
  "base": [0, 0, 0],
  "diag": { "maxTorsoPitchDeg": 104.8, "maxTorsoPitchF": 26, "...": "..." },
  "joints": ["Hips", "Spine", "Chest", "..."],
  "frames": [ { "Hips": [x, y, z], "...": "..." }, "..." ]
}
```

- `frames[i][joint]` is the joint's **world position** `[x, y, z]` in metres in the
  normalized pair frame: thrower base `(0,0,0)` facing +X, victim base `(+1.0,0,0)`
  facing −X, Y up, ground `y=0`. Each figure is rotated at f0 so its shoulder line
  faces squarely at the opponent (thrower 90°, victim 270°), and recentered so its f0
  root lands exactly on its base. Motion itself is untouched (rigid transforms only).
- `srcFps` / `srcFrames` are the stored clip; `streamFrames` is the 60 fps output
  length for T3 clips (`2n−1`), `null` for native-60 fps clips.
- `diag` carries measured numbers from the FK export (max torso pitch, max chest-up,
  hips-Y range) — the viewer shows the victim's max torso pitch in the header.
- Joint names follow the source skeleton (`Hips`, `Spine`, `Chest`, `Neck`, `Head`,
  `LeftShoulder`/`RightShoulder`, `LeftArm`/`RightArm`, `LeftForeArm`/`RightForeArm`,
  `LeftHand`/`RightHand`, `LeftUpLeg`/`RightUpLeg`, `LeftLeg`/`RightLeg`,
  `LeftFoot`/`RightFoot`, `LeftToeBase`/`RightToeBase`). T3 skeletons have 22 joints
  (incl. `Root`); T7 has 21 (Hips is the root). The viewer only needs the 21 joints
  in `BONES`/`JOINTS` in `viewer.js` — extra joints in a clip file are ignored.

`clips/manifest.json` (`wh-mocap-manifest/1`) lists every move, its games, the clip
files, frame counts, fps, and measured max torso pitch per clip. The viewer loads the
manifest first, then the clip files for the selected move.

## Adding clips (any fighter, any move)

1. FK the source clips into world joint positions in the normalized pair frame
   (see `fk-export-viewer.mjs` in the lane workdir for the T3/T7 reference — Node,
   quats → per-frame world positions, square-heading + f0 recenter). The clip file
   holds **positions**, not rotations, so the viewer never needs a skeleton or FK.
2. Drop the new `clips/<game>-<move>-<role>.json` files in `clips/`.
3. Add the move to `clips/manifest.json` (same shape as the King entries: `id`,
   `move`, `name`, per-game `thrower`/`victim` entries with `file`, `sourceClip`,
   `srcFps`, `srcFrames`, `maxTorsoPitchDeg`).
4. The clip selector picks moves up from the manifest automatically — no viewer
   code changes needed for a new fighter or move. (A move needs both roles in at
   least one game; a game with only one role still plays, the missing figure just
   never draws.)

## Seed data

King throws, FK'd 2026-11-20 from the real sources (see the lane-B render report
for the full provenance):

| Move | T3 thrower | T3 victim | T7 thrower | T7 victim |
|---|---|---|---|---|
| 1+3 Winding Nut | `0xaeb` slot 2795 row 415, 66f @30fps | `0xbca` slot 3018 row 416, 65f @30fps | `common_709`, 40f @60fps | `rotsm_574`, 130f @60fps |
| 2+4 Suplex | `0xaed` slot 2797 row 417, 54f @30fps | `0xbeb` slot 3051 row 418, 52f @30fps | `rotsm_534`, 40f @60fps | `rotsm_578`, 138f @60fps |

Measured victim max torso pitch: T3 1+3 **172.6°** (fully inverted), T3 2+4 **172.1°**
(fully inverted), T7 1+3 116.3°, T7 2+4 108.6° (past horizontal, not inverted).
