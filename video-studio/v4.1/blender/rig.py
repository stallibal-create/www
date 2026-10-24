"""LIBALSTAL Transformation Protocol v2: the mechanical rig as pure functions of time.

No bpy import: the same code drives the Blender build (build_scene.py) and the grey-box animatic export
(`python3 rig.py --export frames.json`). Every value is a function of the frame number only, so any frame can
be rendered on its own, in any order, and a re-render gives identical frames.

World: 1 unit = 100 logo px, X right, Y up (= -logo y), Z toward the camera; front faces on Z = 0.
Final positions come from logo_parts.json (measured on the PNG for planning; replace with the official SVG).

Mechanism (parent -> child, see the plan's hierarchy):
  carrier (fixed) -> bottom run (fixed reference)
                  -> top run      rises on two telescopic rails (the seam between the stacked runs opens)
                  -> side panel   swings 90 degrees forward on a vertical hinge, then locks
                  -> wedge        slides along the diagonal joint into the panel's foot
  top run -> elbow gores 1..4   straight spigot bends at its three seams, 30 degrees each, in sequence
          -> collar             slides out along the last gore's axis, over the outlet
  carrier -> grille box         rises on guides under the collar; louvres flip 90 degrees and lock
          -> rails              extend with the top run, retract into the bottom run once the chain holds it
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PARTS = json.loads((HERE / 'logo_parts.json').read_text())['parts']
INTRO = json.loads((HERE.parent.parent / 'content' / 'intro.json').read_text())
FPS = INTRO['fps']
FRAMES = INTRO['durationInFrames']

# ---------------------------------------------------------------- math
def clamp01(x): return 0.0 if x < 0 else 1.0 if x > 1 else x
def lerp(a, b, u): return a + (b - a) * u
def vlerp(a, b, u): return tuple(lerp(x, y, u) for x, y in zip(a, b))
def span(t, t0, t1): return clamp01((t - t0) / (t1 - t0))

def ease_io(u):            # quintic in-out: decisive, mechanical
    u = clamp01(u)
    return 16 * u ** 5 if u < 0.5 else 1 - (-2 * u + 2) ** 5 / 2

def ease_out(u):
    u = clamp01(u)
    return 1 - (1 - u) ** 3

def lock(u, overshoot=0.06):
    """Ease to 1 with one small overshoot and a damped settle: a part seating against its stop."""
    u = clamp01(u)
    if u < 0.8:
        return ease_io(u / 0.8) * (1 + overshoot)
    v = (u - 0.8) / 0.2
    return 1 + overshoot * math.cos(v * math.pi / 2) ** 2 * (1 - v)

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)

def qaxis(axis, ang):
    s = math.sin(ang / 2)
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(ang / 2))

QI = (0.0, 0.0, 0.0, 1.0)

def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v' = q v q*
    ix = w * vx + y * vz - z * vy
    iy = w * vy + z * vx - x * vz
    iz = w * vz + x * vy - y * vx
    iw = -x * vx - y * vy - z * vz
    return (ix * w + iw * -x + iy * -z - iz * -y,
            iy * w + iw * -y + iz * -x - ix * -z,
            iz * w + iw * -z + ix * -y - iy * -x)

def vadd(a, b): return tuple(x + y for x, y in zip(a, b))
def vsub(a, b): return tuple(x - y for x, y in zip(a, b))
def vscale(a, s): return tuple(x * s for x in a)
def norm(a):
    l = math.sqrt(sum(x * x for x in a)) or 1.0
    return tuple(x / l for x in a)
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

def look_quat(pos, target, roll):
    """Quaternion for an object whose local -Z looks from pos to target, local +Y up, rolled by `roll`."""
    f = norm(vsub(target, pos))          # forward
    z = vscale(f, -1)                    # camera +Z points backward
    up = (0.0, 1.0, 0.0)
    x = norm(cross(up, z))
    y = cross(z, x)
    # roll about the view axis
    c, s = math.cos(roll), math.sin(roll)
    x, y = vadd(vscale(x, c), vscale(y, s)), vadd(vscale(y, c), vscale(x, -s))
    m00, m01, m02 = x[0], y[0], z[0]
    m10, m11, m12 = x[1], y[1], z[1]
    m20, m21, m22 = x[2], y[2], z[2]
    tr = m00 + m11 + m22
    if tr > 0:
        S = math.sqrt(tr + 1.0) * 2
        return ((m21 - m12) / S, (m02 - m20) / S, (m10 - m01) / S, 0.25 * S)
    if m00 > m11 and m00 > m22:
        S = math.sqrt(1.0 + m00 - m11 - m22) * 2
        return (0.25 * S, (m01 + m10) / S, (m02 + m20) / S, (m21 - m12) / S)
    if m11 > m22:
        S = math.sqrt(1.0 + m11 - m00 - m22) * 2
        return ((m01 + m10) / S, 0.25 * S, (m12 + m21) / S, (m02 - m20) / S)
    S = math.sqrt(1.0 + m22 - m00 - m11) * 2
    return ((m02 + m20) / S, (m12 + m21) / S, 0.25 * S, (m10 - m01) / S)

def center(p):
    return ((p['x'][0] + p['x'][1]) / 2, (p['y'][0] + p['y'][1]) / 2)

# ---------------------------------------------------------------- timing (seconds) — the storyboard
T = {
    'pulse':        (0.40, 0.85),   # pressure pulse along the stacked runs
    'seam':         (1.00, 1.10),   # lock-seam clips release: a 3 mm jolt
    'rise':         (1.08, 1.75),   # top run rises on the telescopic rails
    'hinge':        (1.25, 1.90),   # side panel swings forward and locks
    'wedge':        (1.62, 2.02),   # foot slides along the diagonal joint
    'joint1':       (1.55, 1.85),   # elbow seams close in sequence
    'joint2':       (1.70, 2.00),
    'joint3':       (1.85, 2.20),
    'collar':       (2.05, 2.40),   # collar slides over the outlet
    'grille':       (2.15, 2.52),   # grille box rises on its guides
    'louvreFlip':   (2.35, 2.55),
    'louvreLock':   (2.55, 2.70),
    'airflow':      (2.70, 3.60),   # streamline heads travel inlet -> outlet
    'railsRetract': (3.00, 3.50),
    'finalLock':    (3.80, 3.95),   # every part seats: one decisive lock
    'lightPass':    (4.00, 4.50),   # one blue light pass across the identity (composited with the handover)
    'cameraArrive': (1.00, 2.70),   # onto the emblem close framing
    'cameraBack':   (3.80, 4.25),   # out to the exact logo layout
}

# ---------------------------------------------------------------- geometry constants
TOP, BOT = PARTS['topRun'], PARTS['bottomRun']
TOP_C, BOT_C = center(TOP), center(BOT)
RISE = TOP['y'][0] - BOT['y'][1]          # gap between the runs in the final emblem (top flange - bottom flange)
EL = PARTS['elbow']
R = EL['radius']
SEG = [R * math.tan(math.radians(15)), 2 * R * math.tan(math.radians(15)),
       2 * R * math.tan(math.radians(15)), R * math.tan(math.radians(15))]   # half, full, full, half
JOINT = math.radians(30)
COL = PARTS['collar']
GR = PARTS['grille']
GR_C = center(GR)
PAN = PARTS['sidePanel']
WED = PARTS['wedge']
HINGE = (PAN['x'][1], 0.0, 0.0)             # vertical hinge on the panel's inner edge, front face plane
RAIL_X = (TOP['x'][0] + 0.7, TOP['x'][1] - 0.7)
RAIL_Z = -TOP['depth'] / 2

def pose(frame, fmt='desktop'):
    t = frame / FPS
    P = {}

    # Act I: pressure pulse — tiny damped vibration travelling along the stacked runs (amplitude 4 mm scale)
    pu = span(t, *T['pulse'])
    vib = 0.012 * math.sin(pu * math.pi * 7) * (1 - pu) if 0 < pu < 1 else 0.0

    # bottom run: the fixed reference
    P['bottomRun'] = {'pos': (BOT_C[0], BOT_C[1] + vib * 0.5, -BOT['depth'] / 2), 'quat': QI}

    # top run: stacked on the bottom run, seam jolt, then rises by RISE on the rails, locks at the end
    jolt = 0.03 * math.sin(span(t, *T['seam']) * math.pi)
    rise = lock(span(t, *T['rise']), 0.012) * RISE        # ~2 mm overshoot on a 166 mm travel
    final = 0.008 * (1 - lock(span(t, *T['finalLock']), 0.5))   # last 0.8 mm seating at the final lock
    ty = TOP_C[1] - RISE + rise + jolt + final + vib
    P['topRun'] = {'pos': (TOP_C[0], ty, -TOP['depth'] / 2), 'quat': QI}
    top_dy = ty - TOP_C[1]

    # telescopic rails between the runs: base on the bottom run, head under the top run; 3 stages each
    base = BOT['y'][1]
    head_follow = TOP['y'][0] + top_dy
    retract = ease_io(span(t, *T['railsRetract']))
    head = lerp(head_follow, base, retract)
    P['rails'] = [{'x': x, 'z': RAIL_Z, 'y0': base, 'y1': max(base, head)} for x in RAIL_X]

    # side panel: folded back 90 degrees about its hinge (lying in the YZ plane behind the runs), swings forward
    a = -math.radians(90) * (1 - lock(span(t, *T['hinge']), 0.03))
    pc = center(PAN)
    q = qaxis((0, 1, 0), a)
    local = (pc[0] - HINGE[0], 0.0, -PAN['thickness'] / 2)
    off = qrot(q, local)
    P['sidePanel'] = {'pos': (HINGE[0] + off[0], pc[1], off[2]), 'quat': q, 'hinge': HINGE}

    # wedge: carried by the panel (same hinge), stowed further along the diagonal joint; once the panel has
    # locked it slides down that joint into the panel's foot
    cut = PAN['cut']
    d = norm((cut[1][0] - cut[0][0], cut[1][1] - cut[0][1], 0.0))
    w = 1 - lock(span(t, *T['wedge']), 0.02)
    wc = center(WED)
    wl = (wc[0] - HINGE[0] + d[0] * 0.9 * w, wc[1] - pc[1] + d[1] * 0.9 * w, -WED['thickness'] / 2)
    woff = qrot(q, wl)
    P['wedge'] = {'pos': (HINGE[0] + woff[0], pc[1] + woff[1], woff[2]), 'quat': q}

    # elbow: chain of 4 gores from the top run's right flange; joint k bends 0 -> 30 degrees about -Z
    bends = [lock(span(t, *T[k]), 0.04) for k in ('joint1', 'joint2', 'joint3')]
    p = (EL['start'][0], EL['start'][1] + top_dy, -TOP['depth'] / 2)
    phi = 0.0
    gores = []
    for i, L in enumerate(SEG):
        q = qaxis((0, 0, 1), phi)
        gores.append({'pos': p, 'quat': q, 'length': L})
        p = vadd(p, qrot(q, (L, 0, 0)))
        if i < 3:
            phi -= JOINT * bends[i]
    P['gores'] = gores
    outlet, outq = p, qaxis((0, 0, 1), phi)

    # collar: on the outlet axis, slid back over the last gore until its move
    c = lock(span(t, *T['collar']), 0.03)
    col_len = COL['y'][1] - COL['y'][0]
    slide = lerp(-0.55, 0.0, c)
    cpos = vadd(outlet, qrot(outq, (slide + col_len / 2, 0, 0)))
    P['collar'] = {'pos': cpos, 'quat': outq, 'length': col_len, 'radius': COL['radius']}

    # grille box: stowed behind the bottom run; runs out along +X on its guides, then forward into the plane
    gx = lock(span(t, T['grille'][0], T['grille'][0] + 0.22), 0.0)
    gz = lock(span(t, T['grille'][0] + 0.17, T['grille'][1]), 0.015)
    P['grille'] = {'pos': (GR_C[0] - 1.7 * (1 - gx), GR_C[1], -GR['depth'] / 2 - 1.55 * (1 - gz)), 'quat': QI}
    flip = math.radians(90) * ease_io(span(t, *T['louvreFlip']))
    settle = lock(span(t, *T['louvreLock']))
    P['louvreAngle'] = flip * (1 - settle) + math.radians(-28) * settle

    # blue parts take their colour as the airflow reaches them (0 = galvanised, 1 = RAL 5017)
    af = span(t, *T['airflow'])
    P['airflow'] = af
    P['blue'] = {'sidePanel': ease_io(span(af, 0.00, 0.20)), 'wedge': ease_io(span(af, 0.10, 0.30)),
                 'collar': ease_io(span(af, 0.55, 0.75))}
    P['lightPass'] = span(t, *T['lightPass'])
    P['camera'] = camera(t, fmt)
    return P

# ---------------------------------------------------------------- camera
def camera_final(fmt):
    c = INTRO['compositions'][fmt]
    lx, ly, lw, lh = c['logo']
    k = lw / 2076.0                                                 # comp px per logo px
    unit = 100 * k                                                  # comp px per world unit
    focal, sensor = 85.0, 36.0                                      # horizontal sensor fit
    width_units = c['width'] / unit
    dist = width_units * focal / sensor
    cx = ((c['width'] / 2 - lx) / k) / 100
    cy = -((c['height'] / 2 - ly) / k) / 100
    return {'target': (cx, cy, 0.0), 'dist': dist, 'focal': focal}

MARK = (3.27, -2.65, 0.0)          # centre of the emblem (logo px 5..650 x 22..509)
MARK_W = 6.45                      # emblem width in world units

def camera(t, fmt):
    """0-1.0 push in on the stacked runs; 1.0-2.7 orbit to the front onto a close framing of the emblem;
    2.7-3.8 hold (3 % drift) while the air flows; 3.8-4.25 pull back onto the exact logo layout for the lock,
    the wordmark reveal and the handover to the official artwork."""
    fin = camera_final(fmt)
    mobile = fmt == 'mobile'
    c = INTRO['compositions'][fmt]
    t0 = (2.80, -3.05, -0.6)
    d0, d1 = (7.6, 6.2) if not mobile else (5.6, 4.7)    # phone: the rolled riser fills the portrait height
    f0 = 30.0 if not mobile else 30.0
    fm = 50.0                                                   # lens for the emblem close framing
    frac = 0.52 if not mobile else 0.86                         # emblem width / frame width while it is close
    s_close = fm / ((MARK_W / frac) * fm / 36.0)
    push = ease_out(span(t, 0.0, 1.0))
    arrive = ease_io(span(t, 1.0, 2.7))
    drift = ease_io(span(t, 2.7, 3.8))
    back = ease_io(span(t, 3.8, 4.25))
    s_start = f0 / lerp(d0, d1, push)
    s_mid = s_close * (1 + 0.03 * drift)
    s_end = fin['focal'] / fin['dist']
    ls = lerp(math.log(s_start), math.log(s_mid), arrive)
    s = math.exp(lerp(ls, math.log(s_end), back))
    focal = lerp(lerp(f0, fm, arrive), fin['focal'], back)
    dist = focal / s
    target = vlerp(vlerp(t0, MARK, arrive), fin['target'], back)
    yaw = math.radians(lerp(30.0, 0.0, arrive))      # from the right: the straight round spigot leads the shot
    pitch = math.radians(lerp(-10.0, 0.0, arrive))   # starts low, looking up at the duct
    roll = math.radians(lerp(90.0 if mobile else 0.0, 0.0, arrive))   # phone: the riser becomes the emblem
    pos = (target[0] + dist * math.sin(yaw) * math.cos(pitch),
           target[1] + dist * math.sin(pitch),
           target[2] + dist * math.cos(yaw) * math.cos(pitch))
    return {'pos': pos, 'quat': look_quat(pos, target, roll), 'focal': focal, 'sensor': 36.0, 'fit': 'horizontal'}

# ---------------------------------------------------------------- airflow path (inlet at the panel -> outlet through the louvres)
def airflow_path(steps=64):
    """Centreline of the assembled run in final position: top run, the 4 gores, the collar, out of the grille."""
    pts = [(PAN['x'][1], TOP_C[1], -TOP['depth'] / 2), (EL['start'][0], TOP_C[1], -TOP['depth'] / 2)]
    p, phi = (EL['start'][0], EL['start'][1], -TOP['depth'] / 2), 0.0
    for i, L in enumerate(SEG):
        q = qaxis((0, 0, 1), phi)
        for k in range(1, 9):
            pts.append(vadd(p, qrot(q, (L * k / 8, 0, 0))))
        p = vadd(p, qrot(q, (L, 0, 0)))
        if i < 3:
            phi -= JOINT
    pts.append((p[0], COL['y'][0], p[2]))
    pts.append((GR_C[0], GR_C[1], -GR['depth'] / 2))
    pts.append((GR_C[0], GR_C[1] - 0.2, 0.9))   # out through the louvres, toward the camera
    return pts

if __name__ == '__main__':
    if '--export' in sys.argv:
        out = Path(sys.argv[sys.argv.index('--export') + 1])
        data = {'fps': FPS, 'frames': FRAMES, 'parts': PARTS, 'segments': SEG, 'airflowPath': airflow_path(),
                'formats': {f: [pose(n, f) for n in range(FRAMES)] for f in ('desktop', 'mobile')}}
        out.write_text(json.dumps(data))
        print(f'wrote {out} ({FRAMES} frames x 2 formats)')
    else:
        for n in (0, 15, 45, 75, 105, 135, 174):
            P = pose(n)
            print(n, 'top y %.3f' % P['topRun']['pos'][1], 'gore4 %s' % str(tuple(round(v, 2) for v in P['gores'][3]['pos'])),
                  'cam %s f%.0f' % (tuple(round(v, 1) for v in P['camera']['pos']), P['camera']['focal']))
