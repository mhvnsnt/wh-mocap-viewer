# Video renderer: PIL + numpy 3D skeleton visualization of the FK'd real
# clip data (tools/fk-export.json) -> two side-by-side 1280x720 @60fps mp4s.
# Fixed orthographic 3/4 view + per-frame follow center (fixed scale per video
# from the max pair bbox, per-frame view center = smoothed pair-bbox center,
# numeric no-clip check with scale shrink loop) so the figures are as big as
# possible; label pills behind THROWER/VICTIM head tags; exact T3 stream
# length 2n-1. No matplotlib, no Blender, no Chromium.
# Ground grid + foot shadows. Labels burned in: move, game, clip ids, frame
# counts, measured victim max torso pitch, per-frame source-frame HUD.
# Ended clips hold their last frame.
# Usage (from the repo root):
#   python3 tools/render.py [--in tools/fk-export.json] [--outdir renders/]
# See docs/RENDER-HOWTO.md.
import argparse
import json, math, os, subprocess, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W = 640            # panel width
H = 720            # panel height
PW, PH = 1280, 720 # video size
FPS = 60
TITLE_H = 30
SUB_H = 66         # sub-line block
FIG_TOP = TITLE_H + SUB_H
FIG_BOT = 664
FOOT_H = H - FIG_BOT
FIG_W, FIG_H = W - 16, FIG_BOT - FIG_TOP - 8

F_TITLE = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
F_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

BONES = [('Hips', 'Spine'), ('Spine', 'Chest'), ('Chest', 'Neck'), ('Neck', 'Head'),
         ('Chest', 'LeftShoulder'), ('LeftShoulder', 'LeftArm'), ('LeftArm', 'LeftForeArm'), ('LeftForeArm', 'LeftHand'),
         ('Chest', 'RightShoulder'), ('RightShoulder', 'RightArm'), ('RightArm', 'RightForeArm'), ('RightForeArm', 'RightHand'),
         ('Hips', 'LeftUpLeg'), ('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot'), ('LeftFoot', 'LeftToeBase'),
         ('Hips', 'RightUpLeg'), ('RightUpLeg', 'RightLeg'), ('RightLeg', 'RightFoot'), ('RightFoot', 'RightToeBase')]
JOINTS = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
          'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
          'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']

COL = {'thrower': (0, 150, 190), 'victim': (230, 80, 0)}          # cyan / orange
COL_D = {'thrower': (0, 90, 120), 'victim': (150, 45, 0)}          # dark outline
COL_L = {'thrower': (0, 190, 230), 'victim': (255, 120, 40)}       # bright core

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _parse_args():
    ap = argparse.ArgumentParser(description='Render T3-vs-T7 throw comparison videos from fk-export.json')
    ap.add_argument('--in', dest='fk_json', default=os.path.join(REPO_ROOT, 'tools', 'fk-export.json'),
                    help='FK export JSON from tools/fk-export.mjs (default: tools/fk-export.json); use - to read from stdin')
    ap.add_argument('--outdir', default=os.path.join(REPO_ROOT, 'renders'),
                    help='output directory for the mp4s (default: renders/)')
    ap.add_argument('--frames-dir', default=None,
                    help='two-phase mode: render each frame to a PNG in this dir '
                         '(<dir>/<move>/fNNNN.png) and then encode the mp4 from the '
                         'PNG sequence, instead of piping raw frames to ffmpeg. '
                         'Every file write is retried, so this survives the VM\'s '
                         'intermittent EPERM write flicker that kills the single '
                         'long pipe run. Pixels are identical either way (PNG is lossless).')
    ap.add_argument('--only', choices=['1+3', '2+4'], default=None,
                    help='render only one move (default: both)')
    ap.add_argument('--raw-stdout', action='store_true',
                    help='write raw RGB24 frames (1280x720 @60fps) to stdout instead '
                         'of encoding an mp4 (progress goes to stderr). Pipe into '
                         'ffmpeg for the encode — the fully wave-proof route, since '
                         'only pipe writes survive the VM\'s EPERM flicker. '
                         'Example: python3 tools/render.py --in - --only 1+3 --raw-stdout '
                         '| ffmpeg -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 60 -i - '
                         '-c:v libx264 -pix_fmt yuv420p -crf 20 '
                         '-movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1')
    return ap.parse_args()

def _save_retry(img, path, tries=900):
    # File-content writes on this VM intermittently fail with EPERM
    # ("Operation not permitted") — a time-based flicker: good windows of
    # 1-2 min separated by bad stretches of 10+ min, flipping in seconds.
    # Wait patiently inside one save (up to ~7.5 min) so a single render
    # run can ride out a bad stretch and blast through frames when a good
    # window arrives, instead of dying on frame 0. The caller also resumes
    # (verified PNGs are skipped), so progress accumulates across runs.
    for i in range(tries):
        try:
            img.save(path)
            return
        except OSError:
            try:
                os.remove(path)  # never leave a partial file behind
            except OSError:
                pass
            if i == tries - 1:
                raise
            time.sleep(0.5)

def _png_complete(path):
    # A PNG left by a failed save is 0 bytes or truncated; only trust one
    # that PIL can fully decode (lets the frames mode resume across runs).
    try:
        with Image.open(path) as im:
            im.load()
        return True
    except Exception:
        return False

def _run_retry(cmd, tries=120, delay=1):
    for i in range(tries):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            return r
        if i == tries - 1:
            raise RuntimeError(f'command failed after {tries} tries: {" ".join(cmd)}\n{r.stderr}')
        time.sleep(delay)

ARGS = _parse_args()
if ARGS.fk_json == '-':
    import sys
    d = json.load(sys.stdin)
else:
    d = json.load(open(ARGS.fk_json))
CLIPS = d['clips']

def clip_len_out(clip):
    # T3 stored @30fps -> 60fps stream is 2n-1 frames (stream_frames);
    # T7 native @60fps -> n frames.
    return 2 * clip['srcFrames'] - 1 if clip['srcFps'] == 30 else clip['srcFrames']

def src_idx(clip, out_f):
    if clip['srcFps'] == 30:
        return min(out_f // 2, clip['srcFrames'] - 1)
    return min(out_f, clip['srcFrames'] - 1)

def out_len(move):
    n = 0
    for game in ('T3', 'T7'):
        for role in ('thrower', 'victim'):
            n = max(n, clip_len_out(CLIPS[f'{game}-{move}-{role}']))
    return n

# ---- camera: fixed orthographic 3/4 view + per-frame follow center ----
AZ, EL = math.radians(32), math.radians(14)
CTR = np.array([0.0, 0.95, 0.0])

def cam_basis():
    f = np.array([-math.sin(AZ) * math.cos(EL), -math.sin(EL), -math.cos(AZ) * math.cos(EL)])
    f = f / np.linalg.norm(f)
    r = np.cross(f, np.array([0.0, 1.0, 0.0])); r = r / np.linalg.norm(r)
    u = np.cross(r, f)
    return f, r, u

def unscaled(cam, p):
    v = np.array(p, dtype=float) - CTR
    return (float(v @ cam['r']), float(v @ cam['u']))

def plan_camera(move):
    f, r, u = cam_basis()
    cam = {'f': f, 'r': r, 'u': u}
    n = out_len(move)
    # per panel per frame: unscaled bbox of both figures
    boxes = {}
    allx, allz = [], []
    for game in ('T3', 'T7'):
        for of in range(n):
            sxs, sys = [], []
            for role in ('thrower', 'victim'):
                c = CLIPS[f'{game}-{move}-{role}']
                fr = c['frames'][src_idx(c, of)]
                for j in JOINTS:
                    if j in fr:
                        sx, sy = unscaled(cam, fr[j])
                        sxs.append(sx); sys.append(sy)
                        allx.append(fr[j][0]); allz.append(fr[j][2])
            boxes[(game, of)] = (min(sxs), max(sxs), min(sys), max(sys))
    scale = 1e9
    for (game, of), (x0, x1, y0, y1) in boxes.items():
        scale = min(scale, (FIG_W - 60) / (x1 - x0), (FIG_H - 60) / (y1 - y0))
    # centers: centered moving average (window 9) of bbox centers, per panel
    centers = {}
    for game in ('T3', 'T7'):
        raw = [((boxes[(game, of)][0] + boxes[(game, of)][1]) / 2,
                (boxes[(game, of)][2] + boxes[(game, of)][3]) / 2) for of in range(n)]
        sm = []
        for i in range(n):
            lo, hi = max(0, i - 4), min(n, i + 5)
            xs = [raw[k][0] for k in range(lo, hi)]
            ys = [raw[k][1] for k in range(lo, hi)]
            sm.append((sum(xs) / len(xs), sum(ys) / len(ys)))
        centers[game] = sm
    # numeric no-clip verification; shrink scale until every joint fits
    for _ in range(10):
        bad = False
        for game in ('T3', 'T7'):
            for of in range(n):
                cx, cy = centers[game][of]
                for role in ('thrower', 'victim'):
                    c = CLIPS[f'{game}-{move}-{role}']
                    fr = c['frames'][src_idx(c, of)]
                    for j in JOINTS:
                        if j not in fr:
                            continue
                        sx, sy = unscaled(cam, fr[j])
                        px = W / 2 + (sx - cx) * scale
                        py = FIG_TOP + FIG_H / 2 - (sy - cy) * scale
                        if px < 10 or px > W - 10 or py < FIG_TOP + 10 or py > FIG_BOT - 10:
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    break
            if bad:
                break
        if not bad:
            break
        scale *= 0.95
    grid = (math.floor(min(allx)) - 1, math.ceil(max(allx)) + 1,
            math.floor(min(allz)) - 1, math.ceil(max(allz)) + 1)
    return {'cam': cam, 'scale': scale, 'centers': centers, 'grid': grid}

def project(plan, game, of, p, ox=0):
    sx, sy = unscaled(plan['cam'], p)
    cx, cy = plan['centers'][game][of]
    sc = plan['scale']
    return (ox + W / 2 + (sx - cx) * sc, FIG_TOP + FIG_H / 2 - (sy - cy) * sc)

def draw_figure(draw, ov, plan, game, of, frame, role, ox):
    cold, coll = COL_D[role], COL_L[role]
    P = {j: project(plan, game, of, frame[j], ox) for j in JOINTS if j in frame}
    o = ImageDraw.Draw(ov, 'RGBA')
    for j in ('LeftFoot', 'RightFoot'):
        if j in frame:
            gx, gy = project(plan, game, of, [frame[j][0], 0.0, frame[j][2]], ox)
            rr = max(4.0, 0.11 * plan['scale'])
            o.ellipse([gx - rr, gy - rr * 0.35, gx + rr, gy + rr * 0.35], fill=(0, 0, 0, 70))
    for a, b in BONES:
        if a in P and b in P:
            draw.line([P[a], P[b]], fill=cold, width=7)
    for a, b in BONES:
        if a in P and b in P:
            draw.line([P[a], P[b]], fill=coll, width=4)
    for j, p in P.items():
        r = 5 if j not in ('Head', 'Hips') else (8 if j == 'Head' else 6)
        draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=coll, outline=cold, width=2)
    return P

def header_lines(game, move):
    t = CLIPS[f'{game}-{move}-thrower']; v = CLIPS[f'{game}-{move}-victim']
    if game == 'T3':
        tline = f"THROWER slot {t['slot']} row {t['move_row']} \u00b7 {t['srcFrames']}f stored @30fps"
        vline = f"VICTIM slot {v['slot']} row {v['move_row']} \u00b7 {v['srcFrames']}f stored @30fps"
    else:
        tline = f"THROWER {t['key']} \u00b7 {t['srcFrames']}f @60fps"
        vline = f"VICTIM {v['key']} \u00b7 {v['srcFrames']}f @60fps"
    pitch = v['diag']['maxTorsoPitchDeg']
    if pitch >= 160:
        fact = f"victim max torso pitch {pitch:.0f}\u00b0 \u2014 FULLY INVERTED (spinning spiral)"
    elif pitch >= 100:
        fact = f"victim max torso pitch {pitch:.0f}\u00b0 \u2014 past horizontal, not inverted"
    else:
        fact = f"victim max torso pitch {pitch:.0f}\u00b0"
    return tline, vline, fact

def render_video(move, move_name, out_path):
    n = out_len(move)
    plan = plan_camera(move)
    raw_stdout = ARGS.raw_stdout
    # In raw-stdout mode stdout carries binary frames — all progress to stderr.
    # Progress writes must never kill the render: on this VM even stderr can
    # point at a file whose writes fail with EPERM mid-run.
    def log(*a, **k):
        try:
            if raw_stdout:
                print(*a, file=sys.stderr, **k)
            else:
                print(*a, **k)
        except OSError:
            pass
    log(f'{move}: scale={plan["scale"]:.1f} px/m, frames={n}')
    f_title = ImageFont.truetype(F_TITLE, 20)
    f_sub = ImageFont.truetype(F_REG, 14)
    f_fact = ImageFont.truetype(F_TITLE, 14)
    f_foot = ImageFont.truetype(F_REG, 13)
    f_tag = ImageFont.truetype(F_TITLE, 13)
    heads = {game: header_lines(game, move) for game in ('T3', 'T7')}
    cmd = ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
           '-s', f'{PW}x{PH}', '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
           '-movflags', '+faststart', out_path]
    frames_dir = None
    proc = None
    if raw_stdout:
        pass  # frames go straight to sys.stdout.buffer below
    elif ARGS.frames_dir:
        frames_dir = os.path.join(ARGS.frames_dir, move)
        os.makedirs(frames_dir, exist_ok=True)
    else:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    gx0, gx1, gz0, gz1 = plan['grid']
    for of in range(n):
        img = Image.new('RGB', (PW, PH), (242, 242, 242))
        draw = ImageDraw.Draw(img)
        ov = Image.new('RGBA', (PW, PH), (0, 0, 0, 0))
        for pi, game in enumerate(('T3', 'T7')):
            ox = pi * W
            tline, vline, fact = heads[game]
            draw.rectangle([ox, 0, ox + W, TITLE_H], fill=(30, 30, 34))
            draw.text((ox + 10, 4), f"{game}  \u00b7  {move_name} ({move})", font=f_title, fill=(255, 255, 255))
            draw.text((ox + 10, TITLE_H + 5), tline, font=f_sub, fill=(40, 40, 40))
            draw.text((ox + 10, TITLE_H + 25), vline, font=f_sub, fill=(40, 40, 40))
            draw.text((ox + 10, TITLE_H + 45), fact, font=f_fact, fill=(120, 40, 0) if game == 'T3' else (0, 80, 110))
            for gx in np.arange(gx0, gx1 + 0.01, 0.5):
                a = project(plan, game, of, [gx, 0, gz0], ox)
                b = project(plan, game, of, [gx, 0, gz1], ox)
                draw.line([a, b], fill=(208, 208, 208), width=1)
            for gz in np.arange(gz0, gz1 + 0.01, 0.5):
                a = project(plan, game, of, [gx0, 0, gz], ox)
                b = project(plan, game, of, [gx1, 0, gz], ox)
                draw.line([a, b], fill=(208, 208, 208), width=1)
            a = project(plan, game, of, [gx0, 0, 0], ox)
            b = project(plan, game, of, [gx1, 0, 0], ox)
            draw.line([a, b], fill=(170, 170, 170), width=2)
            tc = CLIPS[f'{game}-{move}-thrower']; vc = CLIPS[f'{game}-{move}-victim']
            tf = tc['frames'][src_idx(tc, of)]; vf = vc['frames'][src_idx(vc, of)]
            order = []
            for role, fr in (('thrower', tf), ('victim', vf)):
                depth = float((np.array(fr['Hips']) - CTR) @ plan['cam']['f'])
                order.append((depth, role, fr))
            order.sort(reverse=True)  # largest depth (farthest from camera) first
            panels = {}
            for _, role, fr in order:
                panels[role] = draw_figure(draw, ov, plan, game, of, fr, role, ox)
            # head tags with white pill behind so they stay readable when figures overlap
            o = ImageDraw.Draw(ov, 'RGBA')
            for role, P in panels.items():
                hp = P['Head']
                label = role.upper()
                bb = draw.textbbox((0, 0), label, font=f_tag)
                tw, th = bb[2] - bb[0], bb[3] - bb[1]
                x0, y0 = hp[0] + 10, hp[1] - 8
                o.rounded_rectangle([x0 - 3, y0 - 2, x0 + tw + 3, y0 + th + 2], radius=4, fill=(255, 255, 255, 190))
                draw.text((x0, y0), label, font=f_tag, fill=COL_D[role])
            ti = src_idx(tc, of); vi = src_idx(vc, of)
            t_held = ' HELD' if of >= clip_len_out(tc) else ''
            v_held = ' HELD' if of >= clip_len_out(vc) else ''
            draw.rectangle([ox, FIG_BOT, ox + W, H], fill=(228, 228, 228))
            draw.text((ox + 10, FIG_BOT + 8), '\u25cf THROWER', font=f_foot, fill=COL['thrower'])
            draw.text((ox + 110, FIG_BOT + 8), '\u25cf VICTIM', font=f_foot, fill=COL['victim'])
            draw.text((ox + 210, FIG_BOT + 8), f"THR f{ti}/{tc['srcFrames']-1}{t_held} \u00b7 VIC f{vi}/{vc['srcFrames']-1}{v_held}", font=f_foot, fill=(40, 40, 40))
            draw.text((ox + W - 170, FIG_BOT + 8), f"out f{of}/{n-1} \u00b7 {of/FPS:.2f}s", font=f_foot, fill=(40, 40, 40))
            draw.line([(ox, FIG_BOT), (ox + W, FIG_BOT)], fill=(180, 180, 180), width=1)
            if pi == 0:
                draw.line([(W, 0), (W, H)], fill=(30, 30, 34), width=3)
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        if raw_stdout:
            sys.stdout.buffer.write(img.tobytes())
        elif frames_dir is not None:
            png_path = os.path.join(frames_dir, f'f{of:04d}.png')
            if not _png_complete(png_path):
                _save_retry(img, png_path)
        else:
            proc.stdin.write(img.tobytes())
        if of % 30 == 0 or of == n - 1:
            log(f'  {move} frame {of+1}/{n}', flush=True)
    if raw_stdout:
        sys.stdout.buffer.flush()
        log(f'wrote {n} raw frames to stdout')
        return
    if frames_dir is not None:
        enc = ['ffmpeg', '-y', '-v', 'error', '-framerate', str(FPS),
               '-i', os.path.join(frames_dir, 'f%04d.png'),
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
               '-movflags', '+faststart', out_path]
        _run_retry(enc)
        print(f'encoded {out_path} from {n} PNG frames')
        return
    proc.stdin.close()
    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f'ffmpeg failed rc={rc} for {out_path}')
    print(f'wrote {out_path}')

if __name__ == '__main__':
    moves = [('1+3', 'WINDING NUT', 'king-1plus3-winding-nut-t3-vs-t7.mp4'),
             ('2+4', 'SUPLEX', 'king-2plus4-suplex-t3-vs-t7.mp4')]
    if ARGS.only:
        moves = [m for m in moves if m[0] == ARGS.only]
    if not ARGS.raw_stdout:
        os.makedirs(ARGS.outdir, exist_ok=True)
    for move, name, fname in moves:
        render_video(move, name, os.path.join(ARGS.outdir, fname))
