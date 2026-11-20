# Render HOWTO — T3 vs T7 throw comparison videos

This repo ships the pipeline that renders the side-by-side skeleton videos
of real King throw clips (Tekken 3 vs Tekken 7) — the same pipeline that
produced the shipped `king-1plus3-winding-nut-t3-vs-t7.mp4` and
`king-2plus4-suplex-t3-vs-t7.mp4` in `renders/`. The videos are skeleton
visualizations of the real source motion data, not game renders.

## What the pipeline does

1. **`tools/fk-export.mjs`** (Node, no dependencies) — FKs the 8 source clips
   (4 T3 + 4 T7: thrower + victim for `1+3` Winding Nut and `2+4` Suplex)
   into per-frame world joint positions in one normalized pair frame and
   writes `tools/fk-export.json`.
   - Pair frame: thrower base (0,0,0) facing +X, victim base (+1.0,0,0)
     facing −X — the live 1.0 m gap. Y up, ground y=0.
   - Heading: each figure rotated so its f0 shoulder line faces squarely at
     the opponent (thrower 90°, victim 270°). Pure rigid rotation per figure;
     relative motion (spin, travel) is untouched.
   - Recentering: each figure shifted so its f0 root lands exactly on its
     base (removes the T7 victim clips' clip-space root offsets).
2. **`tools/render.py`** (Python 3, PIL + numpy, ffmpeg) — renders the two
   videos from `tools/fk-export.json` into `renders/`.
   - 1280x720 @ 60 fps, h264 (libx264, crf 20, yuv420p, faststart).
   - Two side-by-side panels (left T3, right T7), thrower + victim in each.
   - Thrower cyan, victim orange, white ground grid, foot shadows.
   - Fixed orthographic 3/4 camera (azimuth 32°, elevation 14°), one fixed
     scale per video from the max pair bbox, per-frame view center that
     follows the pair (9-frame centered moving average) — same scale for
     both panels, so T3 vs T7 travel/height compare true to scale.
   - Headers burned in: move, game, clip ids, stored frame counts,
     measured victim max torso pitch. Footer: per-frame source frame per
     figure (THR f / VIC f), output frame, time. Ended clips hold their
     last frame, tagged HELD.

## Inputs (clip sources)

The source clips are **not vendored in this repo**. Point the tools at them
with the flags below. The canonical locations:

- **T3** — `~/workspace/_pantera-throwfix2-20261119/lane-m-midthrow/t3fk/`
  - `data/king-pack.json` (6.5 MB, T3 King move pack, base64 quats + root
    translations) and `data/king-skeleton.json` (22 joints).
  - Clips used: 1+3 thrower row `0xaeb` (slot 2795, row 415, 66 stored f),
    victim `0xbca` (slot 3018, row 416, 65 stored f); 2+4 thrower `0xaed`
    (slot 2797, row 417, 54 stored f), victim `0xbeb` (slot 3051, row 418,
    52 stored f). T3 stored @ 30 fps; the 60 fps stream is 2n−1 frames.
- **T7** — `~/workspace/_pantera-corkscrew-20261120/lane-b-render/t7/game/assets/anim/t7/king/throws/`
  - Standalone `wh-anim/1` clips (`common_709.json`, `rotsm_534.json`,
    `rotsm_574.json`, `rotsm_578.json`), sha256-verified against the
    western-heart manifest; T7 skeleton at
    `~/workspace/_pantera-100-20261118/lane-c-grapples/repo-scratch/game/assets/anim/t7/king/skeleton.json`
    (21 joints, Hips root).
  - T7 native 60 fps, 1:1. Note: the T7 victim clips include a get-up tail —
    the victim ends back on his feet; the tail is recovery, not throw.

Or lay the data out under this repo as `data/` (same relative structure):

```
data/
  t3fk/data/king-pack.json
  t3fk/data/king-skeleton.json
  t7/throws/common_709.json
  t7/throws/rotsm_534.json
  t7/throws/rotsm_574.json
  t7/throws/rotsm_578.json
  t7/skeleton.json
```

## Run it

```sh
# from the repo root
node tools/fk-export.mjs \
  --t3dir ~/workspace/_pantera-throwfix2-20261119/lane-m-midthrow/t3fk \
  --t7dir ~/workspace/_pantera-corkscrew-20261120/lane-b-render/t7/game/assets/anim/t7/king/throws \
  --t7skel ~/workspace/_pantera-100-20261118/lane-c-grapples/repo-scratch/game/assets/anim/t7/king/skeleton.json \
  --out tools/fk-export.json

python3 tools/render.py --in tools/fk-export.json --outdir renders/
```

With a `data/` checkout in place, the bare commands work:

```sh
node tools/fk-export.mjs
python3 tools/render.py
```

Pipe route (no intermediate file — also the workaround when the VM's
intermittent EPERM write flicker blocks file writes):

```sh
node tools/fk-export.mjs --stdout --t3dir <dir> --t7dir <dir> --t7skel <file> \
  | python3 tools/render.py --in - --outdir renders/
```

`--stdout` prints the FK JSON to stdout (diagnostics go to stderr);
`--in -` reads it from stdin.

Two-phase mode (survives the VM's intermittent EPERM write flicker, which
can kill the single long pipe run mid-encode): render frames to PNGs first,
then encode from the PNG sequence — every file write is retried inside the
tool. Pixels are identical either way (PNG is lossless):

```sh
python3 tools/render.py --in tools/fk-export.json --outdir renders/ --frames-dir /tmp/laneb-frames
```

Requirements: Node 20+, Python 3.10+ with `PIL` and `numpy`, `ffmpeg`
(libx264). No matplotlib, no Blender, no Chromium.

## Outputs

| File | Spec |
|---|---|
| `renders/king-1plus3-winding-nut-t3-vs-t7.mp4` | 1280x720, 60 fps, 131 frames, 2.1833 s |
| `renders/king-2plus4-suplex-t3-vs-t7.mp4` | 1280x720, 60 fps, 138 frames, 2.3000 s |

## What the videos show (measured from the real clip data)

Victim max torso pitch (0 = upright, 90 = horizontal, 180 = fully inverted):

| Clip | Victim max torso pitch |
|---|---|
| T3 1+3 victim (slot 3018, row 416) | 172.6° @ stored f30 — FULLY INVERTED (spinning spiral) |
| T3 2+4 victim (slot 3051, row 418) | 172.1° @ stored f25 — FULLY INVERTED (spinning spiral) |
| T7 1+3 victim (rotsm_574) | 116.3° @ f54 — past horizontal, NOT inverted |
| T7 2+4 victim (rotsm_578) | 108.6° @ f76 — past horizontal, NOT inverted |

Throwers: T3 throwers bend hard with the throw (max torso pitch 104.8° 1+3,
88.8° 2+4 — the thrower goes down with the victim). T7 throwers stay on
their feet (40.9° 1+3, 37.7° 2+4). In the videos: T3 both figures end up
down/tangled; T7 the thrower stays standing while the victim goes down.

## Retiming (nothing retimed silently)

- Output 60 fps. T3 stored at 30 fps: each stored frame held 2 output
  frames — timing-exact vs the pair clock.
- 1+3 video = 131 output frames = the T3 pair clock exactly. 2+4 video =
  138 output frames, driven by the T7 victim (138f); the T3 panels hold
  their last frame after f108 (T3 pair clock is 1.8000 s / 108f).
- T7 throwers end at f40 = 0.667 s and hold; the hold-vs-blend question
  after the thrower clip ends is the loader's call — the video shows the
  hold.

## Provenance

Packaged from `~/workspace/_pantera-corkscrew-20261120/lane-b-render/`
(`fk-export.mjs`, `render.py`, `RENDER-REPORT.md`), which produced the
same two videos released as `corkscrew-throw-compare-20261120` on
`mhvnsnt/western-heart`. The FK math, projection math, colors, grid/shadows,
and HUD are unchanged from that working pipeline — only the input/output
paths were adapted to this repo layout. Real source data only: no
hand-tooled motion, no invented clips.
