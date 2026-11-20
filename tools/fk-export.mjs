// FK export: FK the 4 T3 pair clips + 4 T7 pair clips into per-frame
// WORLD joint positions in one normalized pair frame, then dump JSON for the
// PIL renderer (tools/render.py). Pure node, no THREE. Math reuses
// probe-pair-fk.mjs (T3) and verify-t7-throws.mjs (T7) — same quat helpers,
// same FK traversal.
//
// Pair frame (documented render choice, same for T3 and T7):
//   - thrower base at (0,0,0), victim base at (+1.0, 0, 0) — the live 1.0 m gap
//   - thrower faces +X (toward victim), victim faces -X (toward thrower)
//   - T3: heading = live lean yaw = 90 deg + yaw0 (probe-pair-fk.mjs geometry)
//   - T7: clips carry no yaw0; heading = rotation that maps the clip's f0
//     chest-forward azimuth onto the desired facing (90 deg thrower / 270 deg
//     victim). Relative motion (spin, travel) is preserved exactly.
//   - world joint = R_y(heading) * (FKpos - restRoot + root_t) + base, where
//     restRoot is P[Root] (T3) / P[Hips] (T7) and root_t is the clip's
//     absolute root position in its source frame (verified: f0 root_t y
//     ~0.90-0.95 T3 / ~1.02-1.10 T7 puts the feet on the ground).
//
// Usage (from the repo root):
//   node tools/fk-export.mjs [--t3dir <dir>] [--t7dir <dir>] [--t7skel <file>] [--out <file>]
// Clip sources are NOT vendored in this repo — point at them with the flags.
// Defaults assume a data/ checkout at the repo root:
//   --t3dir data/t3fk  (king-pack.json + king-skeleton.json)
//   --t7dir data/t7/throws  (common_709.json, rotsm_534/574/578.json)
//   --t7skel data/t7/skeleton.json
//   --out tools/fk-export.json
// See docs/RENDER-HOWTO.md for where the source clips come from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p));
const T3DIR = resolve(argVal('--t3dir') ?? 'data/t3fk');
const T7DIR = resolve(argVal('--t7dir') ?? 'data/t7/throws');
const T7SKEL = resolve(argVal('--t7skel') ?? 'data/t7/skeleton.json');
const OUT = resolve(argVal('--out') ?? 'tools/fk-export.json');
const TO_STDOUT = argv.includes('--stdout'); // print JSON to stdout instead of writing a file (EPERM-flicker workaround: capture in a shell variable, write with a builtin)
// Diagnostics go to stderr in --stdout mode so stdout stays pure JSON.
const diag = (...a) => (TO_STDOUT ? console.error : console.log)(...a);

const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qrot = (q, v) => { const [x,y,z,w]=q; const tx=2*(y*v[2]-z*v[1]), ty=2*(z*v[0]-x*v[2]), tz=2*(x*v[1]-y*v[0]);
  return [v[0]+w*tx+(y*tz-z*ty), v[1]+w*ty+(z*tx-x*tz), v[2]+w*tz+(x*ty-y*tx)]; };
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const norm=(a)=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
const deg=(r)=>r*180/Math.PI, rad=(d)=>d*Math.PI/180;
// R_y(theta) per three.js rotation.y: world=[c*x+s*z, y, -s*x+c*z]; +Z maps to (sin,0,cos)
const rotY = (th, v) => { const c=Math.cos(th), s=Math.sin(th); return [c*v[0]+s*v[2], v[1], -s*v[0]+c*v[2]]; };

function fkFrame(skel, rot, f) {
  const G={}, X={};
  for (const j of skel.order) {
    const arr = rot[j];
    const q = arr && arr.length ? arr[Math.min(f, arr.length-1)] : [0,0,0,1];
    const p = skel.par[j];
    if (p && G[p]) { G[j]=qmul(G[p],q); const o=qrot(G[p],sub(skel.P[j],skel.P[p])); X[j]=[X[p][0]+o[0],X[p][1]+o[1],X[p][2]+o[2]]; }
    else { G[j]=q; X[j]=skel.P[j].slice(); }
  }
  return {G, X};
}

function loadSkel(path) {
  const s = JSON.parse(fs.readFileSync(path, 'utf8'));
  const P={}, par={}, order=s.joints.map(j=>j.name);
  for (const j of s.joints) { P[j.name]=j.rest; par[j.name]=j.parent; }
  return {P, par, order, rootJoint: order[0]};
}

// ---- T3 decode (probe-pair-fk.mjs) ----
const pack = JSON.parse(fs.readFileSync(`${T3DIR}/data/king-pack.json`, 'utf8'));
const t3skel = loadSkel(`${T3DIR}/data/king-skeleton.json`);
function b64i16(s) { const b=Buffer.from(s,'base64'); const o=new Int16Array(b.length>>1); for(let i=0;i<o.length;i++)o[i]=b.readInt16LE(2*i); return o; }
function decodeT3Row(rec) {
  const q=b64i16(rec.q), rx=b64i16(rec.rx), ry=b64i16(rec.ry), rz=b64i16(rec.rz);
  const nb=pack.bones.length, n=rec.n, rot={};
  pack.bones.forEach((b,bi)=>{ const arr=new Array(n); for(let f=0;f<n;f++){ const o=(f*nb+bi)*4; arr[f]=[q[o]/32767,q[o+1]/32767,q[o+2]/32767,q[o+3]/32767]; } rot[b]=arr; });
  const root_t=new Array(n);
  for(let f=0;f<n;f++) root_t[f]=[rx[f]/1000, ry[f]/1000, rz[f]/1000];
  return {n, rot, root_t, stream_frames: rec.stream_frames, yaw0: rec.yaw0, slot: rec.slot, move_row: rec.move_row};
}

// ---- T7 decode (verify-t7-throws.mjs shape) ----
const t7skel = loadSkel(T7SKEL);
function decodeT7(key) {
  const c = JSON.parse(fs.readFileSync(`${T7DIR}/${key}.json`, 'utf8'));
  return {n: c.root_t.length, rot: c.rot_xyzw, root_t: c.root_t, fps: c.fps, format: c.format,
    bones: c.bones, source: c.source, t7_source: c.t7_source};
}

// ---- export one clip into world pair frame ----
function exportClip({game, move, role, key, skel, data, headingDeg, base, srcFps}) {
  const rootRest = skel.P[skel.rootJoint];
  const heading = rad(headingDeg);
  // f0 chest-forward azimuth in clip frame (for the report)
  const {G: G0, X: X0} = fkFrame(skel, data.rot, 0);
  const cf0 = qrot(G0.Chest, [0,0,1]);
  const chestAz0 = deg(Math.atan2(cf0[0], cf0[2]));
  // f0 shoulder-line facing azimuth in clip frame: forward = up x (RShoulder-LShoulder)
  const rSh = [X0.RightShoulder[0]-X0.LeftShoulder[0], 0, X0.RightShoulder[2]-X0.LeftShoulder[2]];
  const rl = Math.hypot(rSh[0], rSh[2]) || 1; rSh[0]/=rl; rSh[2]/=rl;
  const fwd0 = [rSh[2], 0, -rSh[0]]; // up x right  == (rz,0,-rx) for up=(0,1,0)
  const shoulderAz0 = deg(Math.atan2(fwd0[0], fwd0[2]));
  // recenter: base is shifted so the figure's f0 root lands exactly on `base` (x/z)
  const rt0 = data.root_t[0];
  const off = rotY(heading, [rt0[0], 0, rt0[2]]);
  const baseEff = [base[0]-off[0], 0, base[2]-off[2]];
  const frames = [];
  let maxPitch=0, maxPitchF=-1, maxChestUp=0, maxChestUpF=-1, minHipsY=9, minHipsYF=-1, maxHipsY=-9, maxHipsYF=-1;
  for (let f=0; f<data.n; f++) {
    const {G, X} = fkFrame(skel, data.rot, f);
    const rt = data.root_t[f];
    const joints = {};
    for (const j of skel.order) {
      const local = [X[j][0]-rootRest[0]+rt[0], X[j][1]-rootRest[1]+rt[1], X[j][2]-rootRest[2]+rt[2]];
      const w = rotY(heading, local);
      joints[j] = [+(w[0]+baseEff[0]).toFixed(4), +w[1].toFixed(4), +(w[2]+baseEff[2]).toFixed(4)];
    }
    // diagnostics (world frame)
    const torso = norm(sub(joints.Head, joints.Hips));
    const pitch = deg(Math.acos(Math.max(-1, Math.min(1, torso[1]))));
    if (pitch>maxPitch){maxPitch=pitch;maxPitchF=f;}
    const chestUp = qrot(G.Chest,[0,1,0]);
    const cu = deg(Math.acos(Math.max(-1, Math.min(1, chestUp[1]))));
    if (cu>maxChestUp){maxChestUp=cu;maxChestUpF=f;}
    const hy = joints.Hips[1];
    if (hy<minHipsY){minHipsY=hy;minHipsYF=f;}
    if (hy>maxHipsY){maxHipsY=hy;maxHipsYF=f;}
    frames.push(joints);
  }
  return { game, move, role, key, srcFps, srcFrames: data.n,
    stream_frames: data.stream_frames || null, slot: data.slot || null, move_row: data.move_row || null,
    headingDeg: +headingDeg.toFixed(2), chestAzF0: +chestAz0.toFixed(1), shoulderAzF0: +shoulderAz0.toFixed(1),
    f0RootOffsetRemoved: [+rt0[0].toFixed(3), +rt0[2].toFixed(3)], base,
    diag: { maxTorsoPitchDeg: +maxPitch.toFixed(1), maxTorsoPitchF: maxPitchF,
      maxChestUpDeg: +maxChestUp.toFixed(1), maxChestUpF: maxChestUpF,
      minHipsY: +minHipsY.toFixed(3), minHipsYF, maxHipsY: +maxHipsY.toFixed(3), maxHipsYF,
      hipsYf0: +frames[0].Hips[1].toFixed(3), hipsYfLast: +frames[frames.length-1].Hips[1].toFixed(3) },
    joints: skel.order, frames };
}

const T3 = {
  '1+3': { thrower: '0xaeb', victim: '0xbca' },
  '2+4': { thrower: '0xaed', victim: '0xbeb' },
};
const T7 = {
  '1+3': { thrower: 'common_709', victim: 'rotsm_574' },
  '2+4': { thrower: 'rotsm_534', victim: 'rotsm_578' },
};

const out = { pairFrame: 'thrower base (0,0,0) facing +X; victim base (+1.0,0,0) facing -X; Y up, ground y=0',
  clips: {}, diag: {} };

// Heading rule (both games, rigid per-figure rotation, motion untouched):
// square facing at f0 from the clip's own f0 shoulder line:
//   thrower -> 90deg (+X), victim -> 270deg (-X).
// T3 live lean (90+yaw0) is recorded as liveLeanDeg for the report; the
// render heading differs from it by the f0 torso twist + yaw0 (~34deg).
// Position rule: each figure recentered so its f0 root lands on its base
// (thrower (0,0,0), victim (1,0,0)); T3 f0 roots are already at the bases,
// T7 victim f0 clip-space offsets are removed (recorded per clip).
function squareHeading(skel, data, role) {
  const {X: X0} = fkFrame(skel, data.rot, 0);
  const rSh = [X0.RightShoulder[0]-X0.LeftShoulder[0], 0, X0.RightShoulder[2]-X0.LeftShoulder[2]];
  const rl = Math.hypot(rSh[0], rSh[2]) || 1; rSh[0]/=rl; rSh[2]/=rl;
  const fwd0 = [rSh[2], 0, -rSh[0]];
  const az0 = deg(Math.atan2(fwd0[0], fwd0[2]));
  return (role==='thrower' ? 90 : 270) - az0;
}
for (const move of ['1+3','2+4']) {
  for (const role of ['thrower','victim']) {
    const key = T3[move][role];
    const data = decodeT3Row(pack.rows[key]);
    const liveLean = 90 + deg(data.yaw0);
    const heading = squareHeading(t3skel, data, role);
    const base = role==='thrower' ? [0,0,0] : [1.0,0,0];
    const clip = exportClip({game:'T3', move, role, key, skel:t3skel, data, headingDeg:heading, base, srcFps:30});
    clip.liveLeanDeg = +liveLean.toFixed(1);
    out.clips[`T3-${move}-${role}`] = clip;
    diag(`T3 ${move} ${role} (${key} slot ${data.slot} row ${data.move_row}): n=${data.n} stream=${data.stream_frames} liveLean=${liveLean.toFixed(1)}deg heading=${heading.toFixed(1)}deg shoulderAzF0=${clip.shoulderAzF0}deg f0RootOff=${JSON.stringify(clip.f0RootOffsetRemoved)} | maxPitch ${clip.diag.maxTorsoPitchDeg}deg @f${clip.diag.maxTorsoPitchF} maxChestUp ${clip.diag.maxChestUpDeg}deg @f${clip.diag.maxChestUpF} hipsY ${clip.diag.minHipsY}..${clip.diag.maxHipsY} f0=${clip.diag.hipsYf0} last=${clip.diag.hipsYfLast}`);
  }
}
// T7: same square-heading rule (no yaw0 in T7 clips; shoulder line is the reference)
for (const move of ['1+3','2+4']) {
  for (const role of ['thrower','victim']) {
    const key = T7[move][role];
    const data = decodeT7(key);
    if (data.format !== 'wh-anim/1' || data.fps !== 60) throw new Error(`${key}: unexpected format ${data.format} fps ${data.fps}`);
    const heading = squareHeading(t7skel, data, role);
    const base = role==='thrower' ? [0,0,0] : [1.0,0,0];
    const clip = exportClip({game:'T7', move, role, key, skel:t7skel, data, headingDeg:heading, base, srcFps:60});
    out.clips[`T7-${move}-${role}`] = clip;
    diag(`T7 ${move} ${role} (${key}): n=${data.n} @60fps heading=${heading.toFixed(1)}deg shoulderAzF0=${clip.shoulderAzF0}deg chestAzF0=${clip.chestAzF0}deg f0RootOff=${JSON.stringify(clip.f0RootOffsetRemoved)} | maxPitch ${clip.diag.maxTorsoPitchDeg}deg @f${clip.diag.maxTorsoPitchF} maxChestUp ${clip.diag.maxChestUpDeg}deg @f${clip.diag.maxChestUpF} hipsY ${clip.diag.minHipsY}..${clip.diag.maxHipsY} f0=${clip.diag.hipsYf0} last=${clip.diag.hipsYfLast}`);
  }
}

const json = JSON.stringify(out);
if (TO_STDOUT) {
  process.stdout.write(json);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
}
