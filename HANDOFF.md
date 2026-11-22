# HANDOFF — wh-mocap-viewer

**Last updated: 2026-11-22 (America/New_York).**
**Repo:** `mhvnsnt/wh-mocap-viewer` (PUBLIC), default branch `main`.
**Purpose of this file:** any agent that picks up work here reads this FIRST, then the linked docs. It states what we've done, where we're at, and what we're working toward — so the owner can say "go to this repo, pick up the work" and you just know. Update this file in the same PR whenever the state changes (add, don't delete).

## 1. What this repo is

The stick-figure mocap viewer for Western Heart — test fighting-game animations on the little blue and orange guys (white grid, shadows, thrower cyan / victim orange). It plays real source clip data. No build step, no dependencies: `index.html` + `viewer.js` + `viewer.css`.

Live viewer: https://mhvnsnt.github.io/wh-mocap-viewer/ — open it on a phone or desktop; it loads clips from `clips/` and renders them. It is the quick-look tool for the moveset work: before a clip goes into the game, it gets watched here first. The viewer is how the Pantera throw problem (victim thrown on camera, real paired throw never playing) gets seen and checked.

## 2. Where we're at

### DONE
- **Viewer built and live:** `index.html`, `viewer.js`, `viewer.css`, `clips/`, `renders/`, `tools/`, `docs/`. Live at the GitHub Pages URL above.
- **Lane B render tools merged (2026-11-20, PR #2):** `tools/` render tooling landed.
- **Blank-canvas fix merged (2026-11-21, PR #3):** the viewer shipped broken — nothing rendered — because one line read `maxTorsoPitchDeg` from the wrong place (`v.diag.*` instead of flat). Fix commit `aa9b3bc` reads the manifest value flat; merge commit `1626589` (2026-11-21).

### IN PROGRESS
- **Live page check still pending (as of 2026-11-22).** The fix is merged, but it is NOT handed back until it is seen playing in a real browser. Next step: open the live URL in a real browser, watch a clip play, own-eyes confirm the canvas renders — then report it fixed. Never merge or claim "fixed" blind.
- **No open PRs, no releases** as of 2026-11-22. Last push 2026-11-21 02:40 UTC (the PR #3 merge).

### BLOCKED
- **Nothing recorded as blocked in the repo state read 2026-11-22.** The only open item is the pending live check (above) — that is verification owed, not a blocker. If the live page still fails, the exact failure is the next fact to record, then route-switch from there.

## 3. What we're working toward

**The goal:** a viewer the owner trusts — open the link on his phone, pick a clip, watch the thrower and victim move exactly as the source data says, and know at a glance whether a move is right before it goes into Western Heart.

**The bar (owner):** VERIFY-FIX-BEFORE-CLAIMING-FIXED — compare the same before-and-after view with your own eyes before reporting a fix. A viewer that renders nothing is not a viewer; done means seen playing in a real browser, not merged.

**In order:** (1) live-page check of the PR #3 fix, own-eyes; (2) keep the clip set current with the moveset work (Pantera clips, throw pairs); (3) any viewer gaps found while watching get logged as viewer work, not silently worked around.

## 4. Standing rules that apply here

- **Branch → PR → merge, always.** Never push to main directly. Add-only, zero-conflict PRs, no force pushes.
- **Checkpoint-and-save law:** CHECKPOINT.md first, update after every step; the repo is the save; resume, never restart.
- **No-temp-storage law:** nothing in /tmp or any wipeable location, ever. Everything goes straight into the repo or a durable folder the second it exists.
- **Verify-fix-before-claiming-fixed:** compare the same before and after view with your own eyes before reporting anything fixed. Never merge blind, never hand back unverified.
- **Real-source-only:** the viewer plays REAL source clip data — no hand-tooled animation standing in for source clips.
- **No-gaps / solve-it law:** a gap or block is never the end of the work — route-switch until it's done or every reasonable route is exhausted with exact errors recorded.
- **Phone-only:** the owner opens the live link on his phone. The viewer must work there, with no setup steps for him.

## 5. Key files and paths

| What | Where |
|---|---|
| Viewer (start here) | `index.html`, `viewer.js`, `viewer.css` |
| Live viewer | https://mhvnsnt.github.io/wh-mocap-viewer/ |
| Clips (real source clip data) | `clips/` |
| Renders | `renders/` |
| Render tools | `tools/` |
| Docs | `docs/`, `README.md` |
| Merged PRs | #2 (lane B render tools, 2026-11-20), #3 (blank-canvas fix, 2026-11-21) |

There are no open PRs and no releases in this repo.

## 6. Open decisions needing the owner

- **No owner decision is recorded as open in this repo's state.** The live-page check is verification work, not a decision for him. If the live check fails, the failure and the fix options come back to him plainly — lanes don't decide that.
- **Clip-set priorities** (which moves get watched/tested first) follow the Western Heart moveset work; the owner sets that order there, not here.

## 7. How to pick up

1. Read this HANDOFF.md first, then `README.md` and `docs/`.
2. FIRST job: the live-page check. Open https://mhvnsnt.github.io/wh-mocap-viewer/ in a real browser, play a clip, confirm with your own eyes that the canvas renders and the two fighters move. Report what you actually saw.
3. Never claim the viewer fixed until that check passes. If it fails, record the exact failure and route-switch.
4. Resume from the stated next step — never restart, never re-derive finished work.
5. Land work branch → PR → merge, add-only. Update this HANDOFF.md in the same PR when the state changes.
