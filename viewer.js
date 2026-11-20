// WH Mocap Viewer — live browser port of lane-B render.py (PIL renderer).
// Same camera, same colors, same HUD. Data: clips/*.json (wh-mocap-clip/1),
// FK'd world joint positions in the normalized pair frame:
// thrower base (0,0,0) facing +X, victim base (+1.0,0,0) facing -X, Y up.
'use strict';

const CW = 640, CH = 560;            // canvas: figure area only (header/footer are HTML)
const FPS = 60;
const AZ = 32 * Math.PI / 180, EL = 14 * Math.PI / 180;   // render.py camera
const CTR = [0, 0.95, 0];

const BONES = [['Hips','Spine'],['Spine','Chest'],['Chest','Neck'],['Neck','Head'],
  ['Chest','LeftShoulder'],['LeftShoulder','LeftArm'],['LeftArm','LeftForeArm'],['LeftForeArm','LeftHand'],
  ['Chest','RightShoulder'],['RightShoulder','RightArm'],['RightArm','RightForeArm'],['RightForeArm','RightHand'],
  ['Hips','LeftUpLeg'],['LeftUpLeg','LeftLeg'],['LeftLeg','LeftFoot'],['LeftFoot','LeftToeBase'],
  ['Hips','RightUpLeg'],['RightUpLeg','RightLeg'],['RightLeg','RightFoot'],['RightFoot','RightToeBase']];
const JOINTS = ['Hips','Spine','Chest','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand',
  'RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase',
  'RightUpLeg','RightLeg','RightFoot','RightToeBase'];
const COL = { thrower: 'rgb(0,150,190)', victim: 'rgb(230,80,0)' };
const COL_D = { thrower: 'rgb(0,90,120)', victim: 'rgb(150,45,0)' };
const COL_L = { thrower: 'rgb(0,190,230)', victim: 'rgb(255,120,40)' };

// ---- camera (render.py cam_basis / unscaled, verbatim) ----
function camBasis() {
  let f = [-Math.sin(AZ) * Math.cos(EL), -Math.sin(EL), -Math.cos(AZ) * Math.cos(EL)];
  const fl = Math.hypot(...f); f = f.map(v => v / fl);
  let r = cross(f, [0, 1, 0]); const rl = Math.hypot(...r); r = r.map(v => v / rl);
  const u = cross(r, f);
  return { f, r, u };
}
const CAM = camBasis();
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function unscaled(p) {
  const v = [p[0]-CTR[0], p[1]-CTR[1], p[2]-CTR[2]];
  return [dot(v, CAM.r), dot(v, CAM.u)];
}

// ---- clip timing (render.py clip_len_out / src_idx) ----
const clipLenOut = c => (c.srcFps === 30 ? 2 * c.srcFrames - 1 : c.srcFrames);
const srcIdx = (c, of) => (c.srcFps === 30
  ? Math.min(Math.floor(of / 2), c.srcFrames - 1)
  : Math.min(of, c.srcFrames - 1));

// ---- per-move camera plan (render.py plan_camera, verbatim logic) ----
function planCamera(clips) { // clips: {T3:{thrower,victim}, T7:{thrower,victim}}
  const n = Math.max(...Object.values(clips).flatMap(g => Object.values(g).map(clipLenOut)));
  const boxes = {};
  let allx = [], allz = [];
  for (const game of ['T3', 'T7']) {
    for (let of = 0; of < n; of++) {
      const sxs = [], sys = [];
      for (const role of ['thrower', 'victim']) {
        const c = clips[game][role];
        const fr = c.frames[srcIdx(c, of)];
        for (const j of JOINTS) {
          if (!(j in fr)) continue;
          const [sx, sy] = unscaled(fr[j]);
          sxs.push(sx); sys.push(sy);
          allx.push(fr[j][0]); allz.push(fr[j][2]);
        }
      }
      boxes[game + ':' + of] = [Math.min(...sxs), Math.max(...sxs), Math.min(...sys), Math.max(...sys)];
    }
  }
  let scale = Infinity;
  for (const k in boxes) {
    const [x0, x1, y0, y1] = boxes[k];
    scale = Math.min(scale, (CW - 16 - 60) / (x1 - x0), (CH - 8 - 60) / (y1 - y0));
  }
  const centers = {};
  for (const game of ['T3', 'T7']) {
    const raw = [];
    for (let of = 0; of < n; of++) {
      const b = boxes[game + ':' + of];
      raw.push([(b[0] + b[1]) / 2, (b[2] + b[3]) / 2]);
    }
    centers[game] = raw.map((_, i) => {
      const lo = Math.max(0, i - 4), hi = Math.min(n, i + 5);
      let xs = 0, ys = 0;
      for (let k = lo; k < hi; k++) { xs += raw[k][0]; ys += raw[k][1]; }
      return [xs / (hi - lo), ys / (hi - lo)];
    });
  }
  // numeric no-clip check; shrink scale until every joint fits (render.py loop)
  for (let iter = 0; iter < 10; iter++) {
    let bad = false;
    outer:
    for (const game of ['T3', 'T7']) for (let of = 0; of < n; of++) {
      const [cx, cy] = centers[game][of];
      for (const role of ['thrower', 'victim']) {
        const c = clips[game][role];
        const fr = c.frames[srcIdx(c, of)];
        for (const j of JOINTS) {
          if (!(j in fr)) continue;
          const [sx, sy] = unscaled(fr[j]);
          const px = CW / 2 + (sx - cx) * scale;
          const py = CH / 2 - (sy - cy) * scale;
          if (px < 10 || px > CW - 10 || py < 10 || py > CH - 10) { bad = true; break outer; }
        }
      }
    }
    if (!bad) break;
    scale *= 0.95;
  }
  const grid = [Math.floor(Math.min(...allx)) - 1, Math.ceil(Math.max(...allx)) + 1,
                Math.floor(Math.min(...allz)) - 1, Math.ceil(Math.max(...allz)) + 1];
  return { scale, centers, grid, n };
}

function project(plan, game, of, p) {
  const [sx, sy] = unscaled(p);
  const [cx, cy] = plan.centers[game][of];
  return [CW / 2 + (sx - cx) * plan.scale, CH / 2 - (sy - cy) * plan.scale];
}

// ---- drawing (render.py draw_figure, grid, tags) ----
function drawFigure(ctx, plan, game, of, frame, role) {
  const P = {};
  for (const j of JOINTS) if (j in frame) P[j] = project(plan, game, of, frame[j]);
  // soft elliptical foot shadows
  for (const j of ['LeftFoot', 'RightFoot']) {
    if (!(j in frame)) continue;
    const [gx, gy] = project(plan, game, of, [frame[j][0], 0, frame[j][2]]);
    const rr = Math.max(4, 0.11 * plan.scale);
    ctx.fillStyle = 'rgba(0,0,0,0.27)';
    ctx.beginPath(); ctx.ellipse(gx, gy, rr, rr * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of [[COL_D[role], 7], [COL_L[role], 4]]) {
    ctx.strokeStyle = pass[0]; ctx.lineWidth = pass[1];
    for (const [a, b] of BONES) {
      if (!(a in P) || !(b in P)) continue;
      ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); ctx.stroke();
    }
  }
  for (const j in P) {
    const r = j === 'Head' ? 8 : (j === 'Hips' ? 6 : 5);
    ctx.beginPath(); ctx.arc(P[j][0], P[j][1], r, 0, Math.PI * 2);
    ctx.fillStyle = COL_L[role]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = COL_D[role]; ctx.stroke();
  }
  return P;
}

function drawPanel(ctx, plan, game, of, clips) {
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, CW, CH);
  const [gx0, gx1, gz0, gz1] = plan.grid;
  ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1;
  for (let gx = gx0; gx <= gx1 + 0.01; gx += 0.5) {
    const a = project(plan, game, of, [gx, 0, gz0]);
    const b = project(plan, game, of, [gx, 0, gz1]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (let gz = gz0; gz <= gz1 + 0.01; gz += 0.5) {
    const a = project(plan, game, of, [gx0, 0, gz]);
    const b = project(plan, game, of, [gx1, 0, gz]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // farthest figure first (depth = (hips - CTR) . f, render.py order)
  const order = [];
  for (const role of ['thrower', 'victim']) {
    const c = clips[game][role];
    const fr = c.frames[srcIdx(c, of)];
    order.push([dot([fr.Hips[0]-CTR[0], fr.Hips[1]-CTR[1], fr.Hips[2]-CTR[2]], CAM.f), role, fr]);
  }
  order.sort((a, b) => b[0] - a[0]);
  const panels = {};
  for (const [, role, fr] of order) panels[role] = drawFigure(ctx, plan, game, of, fr, role);
  // head tags with white pill behind (readable when figures overlap)
  ctx.font = 'bold 13px sans-serif';
  for (const role in panels) {
    const hp = panels[role].Head;
    const label = role.toUpperCase();
    const tw = ctx.measureText(label).width;
    const x0 = hp[0] + 10, y0 = hp[1] - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.roundRect(x0 - 3, y0 - 2, tw + 6, 17, 4); ctx.fill();
    ctx.fillStyle = COL_D[role];
    ctx.fillText(label, x0, y0 + 11);
  }
}

// ---- app state ----
const state = {
  manifest: null,
  moveId: null,
  clips: null,      // {T3:{thrower,victim}, T7:{thrower,victim}}
  plan: null,
  outFrame: 0,
  playing: false,
  speed: 1,
  view: 'both',     // 'T3' | 'T7' | 'both'
  lastTs: 0, acc: 0,
};

const $ = id => document.getElementById(id);
const els = {
  status: $('status'), clipSel: $('clipSel'), playBtn: $('playBtn'),
  scrub: $('scrub'), speed: $('speed'), speedVal: $('speedVal'),
  viewT3: $('viewT3'), viewT7: $('viewT7'), viewBoth: $('viewBoth'),
  panels: $('panels'),
};
const PANELS = {};   // game -> {root, canvas, ctx, meta, foot}
for (const game of ['T3', 'T7']) {
  const root = document.querySelector(`.panel[data-game="${game}"]`);
  const canvas = root.querySelector('canvas');
  canvas.width = CW; canvas.height = CH;
  PANELS[game] = { root, canvas, ctx: canvas.getContext('2d'),
    meta: root.querySelector('.meta'), foot: root.querySelector('.foot') };
}

function fmtFact(v) {
  const p = v.diag.maxTorsoPitchDeg;
  if (p >= 160) return `victim max torso pitch ${p.toFixed(0)}° — FULLY INVERTED (spinning spiral)`;
  if (p >= 100) return `victim max torso pitch ${p.toFixed(0)}° — past horizontal, not inverted`;
  return `victim max torso pitch ${p.toFixed(0)}°`;
}
function headerLines(game, moveEntry) {
  const t = moveEntry.games[game].thrower, v = moveEntry.games[game].victim;
  const tline = game === 'T3'
    ? `THROWER slot ${t.slot} row ${t.moveRow} · ${t.srcFrames}f stored @30fps`
    : `THROWER ${t.sourceClip} · ${t.srcFrames}f @60fps`;
  const vline = game === 'T3'
    ? `VICTIM slot ${v.slot} row ${v.moveRow} · ${v.srcFrames}f stored @30fps`
    : `VICTIM ${v.sourceClip} · ${v.srcFrames}f @60fps`;
  return [tline, vline, fmtFact(v)];
}

async function loadMove(moveId) {
  const entry = state.manifest.moves.find(m => m.id === moveId);
  if (!entry) throw new Error('unknown move ' + moveId);
  state.moveId = moveId;
  const clips = {};
  for (const game of ['T3', 'T7']) {
    clips[game] = {};
    for (const role of ['thrower', 'victim']) {
      const info = entry.games[game][role];
      const res = await fetch(info.file);
      if (!res.ok) throw new Error(`failed to load ${info.file} (${res.status})`);
      clips[game][role] = await res.json();
    }
  }
  state.clips = clips;
  state.plan = planCamera(clips);
  state.outFrame = 0; state.acc = 0;
  els.scrub.max = state.plan.n - 1;
  els.scrub.value = 0;
  for (const game of ['T3', 'T7']) {
    const [tline, vline, fact] = headerLines(game, entry);
    PANELS[game].root.querySelector('.title').textContent = `${game} · ${entry.name} (${entry.move})`;
    PANELS[game].meta.innerHTML =
      `<div>${tline}</div><div>${vline}</div><div class="fact">${fact}</div>`;
  }
  applyView();
  render();
}

function applyView() {
  for (const game of ['T3', 'T7']) {
    PANELS[game].root.classList.toggle('hidden',
      state.view !== 'both' && state.view !== game);
  }
}

function render() {
  if (!state.plan) return;
  const of = Math.floor(state.outFrame);
  for (const game of ['T3', 'T7']) {
    if (state.view !== 'both' && state.view !== game) continue;
    drawPanel(PANELS[game].ctx, state.plan, game, of, state.clips);
    const tc = state.clips[game].thrower, vc = state.clips[game].victim;
    const ti = srcIdx(tc, of), vi = srcIdx(vc, of);
    const tHeld = of >= clipLenOut(tc), vHeld = of >= clipLenOut(vc);
    PANELS[game].foot.innerHTML =
      `<span class="thr">● THROWER</span><span class="vic">● VICTIM</span>` +
      `<span>THR f${ti}/${tc.srcFrames - 1}${tHeld ? ' <span class="held">HELD</span>' : ''}` +
      ` · VIC f${vi}/${vc.srcFrames - 1}${vHeld ? ' <span class="held">HELD</span>' : ''}</span>` +
      `<span class="time">out f${of}/${state.plan.n - 1} · ${(of / FPS).toFixed(2)}s</span>`;
  }
  els.scrub.value = of;
}

function tick(ts) {
  if (state.playing && state.plan) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(100, ts - state.lastTs);
    state.lastTs = ts;
    state.acc += dt * state.speed;
    const step = 1000 / FPS;
    while (state.acc >= step) {
      state.acc -= step;
      state.outFrame++;
      if (state.outFrame >= state.plan.n) { state.outFrame = state.plan.n - 1; setPlaying(false); break; }
    }
    render();
  } else {
    state.lastTs = 0;
  }
  requestAnimationFrame(tick);
}

function setPlaying(p) {
  state.playing = p;
  els.playBtn.textContent = p ? '❚❚ Pause' : '▶ Play';
  els.playBtn.setAttribute('aria-pressed', String(p));
}

// ---- controls ----
els.playBtn.addEventListener('click', () => {
  if (!state.plan) return;
  if (!state.playing && state.outFrame >= state.plan.n - 1) state.outFrame = 0;
  setPlaying(!state.playing);
});
els.scrub.addEventListener('input', () => {
  state.outFrame = parseInt(els.scrub.value, 10);
  state.acc = 0;
  render();
});
els.speed.addEventListener('input', () => {
  state.speed = parseFloat(els.speed.value);
  els.speedVal.textContent = state.speed.toFixed(2) + '×';
});
els.clipSel.addEventListener('change', async () => {
  setPlaying(false);
  els.status.textContent = 'Loading clip…';
  try { await loadMove(els.clipSel.value); els.status.textContent = ''; }
  catch (e) { els.status.textContent = 'Error: ' + e.message; }
});
for (const [btn, view] of [[els.viewT3, 'T3'], [els.viewT7, 'T7'], [els.viewBoth, 'both']]) {
  btn.addEventListener('click', () => {
    state.view = view;
    for (const b of [els.viewT3, els.viewT7, els.viewBoth])
      b.setAttribute('aria-pressed', String(b === btn));
    applyView();
    render();
  });
}
// tap a panel canvas to toggle play (phone-friendly)
for (const game of ['T3', 'T7'])
  PANELS[game].canvas.addEventListener('click', () => els.playBtn.click());

// ---- boot ----
(async () => {
  try {
    const res = await fetch('clips/manifest.json');
    if (!res.ok) throw new Error('manifest fetch failed (' + res.status + ')');
    state.manifest = await res.json();
    for (const m of state.manifest.moves) {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = `${m.move} ${m.name} — King`;
      els.clipSel.appendChild(opt);
    }
    await loadMove(state.manifest.moves[0].id);
    requestAnimationFrame(tick);
  } catch (e) {
    els.status.textContent = 'Error: ' + e.message;
  }
})();
