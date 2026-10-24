"""LIBALSTAL V4.1 — re-engineered mechanical animation (Blender 4.2 LTS). V4 stays untouched.

  blender -b --factory-startup --python animate_v4_1.py -- OUT.blend
(build_v3.py and logo_parts.json next to this file.)

What changed from V4
* ELBOW = an adjustable gored elbow, as fabricated: every seam is a rotary joint whose axis is the normal of the
  mitre plane. Turning a gore 180 deg about that axis cancels the 30 deg bend (straight spigot); turning it back to
  0 deg makes the bend. Both cut faces stay on the same plane throughout, so the seam never opens and the gores never
  interpenetrate; the free end sweeps a cone in 3D. (The seam ellipse is 3.4 % longer than wide, so mid-turn its rim
  is offset by at most ~3 mm, as on a real adjustable elbow; the rolled bead covers it.)
* Secondary mechanisms: corner clamps slide in along the flanges and the bolts spin and seat; a coupling sleeve
  slides over the run-to-elbow joint; the collar rises and twist-locks on three bayonet lugs; two latch pins shoot
  from the diffuser panel into the top run after it closes; the bottom run and grille ride a flush floor guide
  track; the top run rises on 3-stage telescopic rails, aligns forward, the rails retract.
* Camera: extreme macro on a rotating elbow seam, then one continuous Catmull-Rom move (no stop at any key) that
  pulls back and orbits through the transformation, pushes in for the lock and lands on the official logo framing.

Timeline: 0.0-0.6 awakening (macro) | 0.6-2.3 transformation | 2.3-3.5 precision lock | 3.5-4.4 airflow |
4.4-5.25 identity framing | 5.25-6.0 hold for the Remotion hand-off.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else globals()['HERE']
OUT = (sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else globals().get('OUT'))
FPS, FRAMES = 30, 180

# ---------------------------------------------------------------- 1. build (V3 builder, unchanged)
g = {'__name__': '__main__', 'PARTS_JSON': open(os.path.join(HERE, 'logo_parts.json')).read(), 'SAVE_TO': None,
     'SEG': [0.34297496631183705, 0.6859499326236741, 0.6859499326236741, 0.34297496631183705]}
exec(compile(open(os.path.join(HERE, 'build_v3.py')).read(), 'build_v3.py', 'exec'), g)
sc = bpy.data.scenes['LIBALSTAL_V3']; sc.name = 'LIBALSTAL_V4_1'
for s in list(bpy.data.scenes):
    if s != sc:
        bpy.data.scenes.remove(s)
sc.frame_start, sc.frame_end, sc.render.fps = 0, FRAMES - 1, FPS
O = bpy.data.objects
P = json.loads(g['PARTS_JSON'])['parts']
S = 0.1
J = math.radians(30); H = J / 2
SEG = [v * S for v in g['SEG']]
ZC = -P['topRun']['depth'] / 2 * S
EMB = bpy.data.collections['EMBLEM']; STAGE = bpy.data.collections['STAGE']
ROOT = O['LIBALSTAL_emblem']

# ---------------------------------------------------------------- 2. look fixes from the V3 review
for mname, (b0, b1, r0, r1) in (('galvanised', (0.988, 1.006, 0.30, 0.33)), ('galvanised_flange', (0.985, 1.008, 0.31, 0.35))):
    nt = bpy.data.materials[mname].node_tree
    for v in [n for n in nt.nodes if n.type == 'TEX_VORONOI' and n.feature == 'F1']:
        v.feature = 'SMOOTH_F1'; v.inputs['Smoothness'].default_value = 0.6
    mrs = [n for n in nt.nodes if n.type == 'MAP_RANGE']
    mrs[0].inputs['To Min'].default_value, mrs[0].inputs['To Max'].default_value = b0, b1
    mrs[1].inputs['To Min'].default_value, mrs[1].inputs['To Max'].default_value = r0, r1
for o in list(O):
    if o.name.endswith('_halo') or (o.name.startswith('elbow_gore_') and o.name.endswith('_inner')):
        bpy.data.objects.remove(o, do_unlink=True)        # halos replaced by animated streams; inner shells caused EEVEE leaks
for k in range(1, 5):                                     # the sheet's inside face shows the dark interior material
    sh = O[f'elbow_gore_{k}_sheet']
    sh.data.materials.append(bpy.data.materials['interior'])
    sh.modifiers['Sheet'].material_offset = 1

# ---------------------------------------------------------------- 3. timing
def clamp01(x): return 0.0 if x < 0 else 1.0 if x > 1 else x
def span(t, a, b): return clamp01((t - a) / (b - a))
def ease(u): u = clamp01(u); return u * u * u * (u * (6 * u - 15) + 10)
def ease_out(u): u = clamp01(u); return 1 - (1 - u) ** 3
def lock(u, over=0.06):
    """Ease to 1 with one overshoot and a damped settle (a part seating against its stop)."""
    u = clamp01(u)
    if u < 0.72:
        return ease(u / 0.72) * (1 + over)
    v = (u - 0.72) / 0.28
    return 1 + over * math.cos(v * math.pi / 2) ** 2 * math.exp(-3 * v) * (1 - v)
def lerp(a, b, u): return a + (b - a) * u
def L2W(x, y, z): return Vector((x, -z, y))

# ---------------------------------------------------------------- 4. rest transforms, helper objects
PARTS = ['top_run', 'bottom_run', 'side_panel', 'wedge', 'collar', 'grille'] + [f'elbow_gore_{k}' for k in range(1, 5)] + [f'louvre_{k}' for k in range(1, 7)]
REST = {}
for p in PARTS:
    o = O[p]; qr = Euler(o.rotation_euler).to_quaternion()       # capture before switching the rotation mode
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = qr
    REST[p] = (o.location.copy(), qr)
bpy.context.view_layer.update()
gr = O['grille']
for o in list(O):                                         # grille mounts ride with the grille
    if o.name.startswith(('mount_3_', 'mount_4_')):
        mw = o.matrix_world.copy(); o.parent = gr; o.matrix_world = mw
br = O['bottom_run']
for o in list(O):                                         # bottom-run mounts ride with the bottom run
    if o.name.startswith(('mount_0_', 'mount_1_')):
        mw = o.matrix_world.copy(); o.parent = br; o.matrix_world = mw
wg = O['wedge']
for o in list(O):                                         # the wedge's mount slides with the wedge (no hovering)
    if o.name.startswith('mount_2_'):
        mw = o.matrix_world.copy(); o.parent = wg; o.matrix_world = mw

def mesh(name, bm, mat, parent, coll=EMB, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(bpy.data.materials[mat])
    for pp in me.polygons: pp.use_smooth = smooth
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    if parent: ob.parent = parent
    return ob
def box_bm(sx, sy, sz, at=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((sx, sy, sz)), verts=bm.verts); bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return bm
def cyl_bm(r, h, segs=20, axis='Z', at=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=h)
    rot = {'Z': Matrix(), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 3, 'X')}[axis]
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot); bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return bm
def bevel(o, w=0.0006, s=2):
    m = o.modifiers.new('Bevel', 'BEVEL'); m.width = w; m.segments = s; m.limit_method = 'ANGLE'; return o

# bolts: origin at their own centre, axis from their name
BOLTS = []
for o in list(O):
    if o.type == 'MESH' and o.name.startswith('fastener_') and '_bolt_' in o.name:
        if o.name.startswith('fastener_elbow_flange_bolt'):
            n, ax = Vector((-1, 0, 0)), 0
        else:
            n, ax = Vector((0, 0, float(o.name.rsplit('_', 1)[1]))), 2
        me = o.data
        lo = [min(v.co[i] for v in me.vertices) for i in range(3)]; hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
        c = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
        me.transform(Matrix.Translation(-c)); o.location = o.location + c; o.rotation_mode = 'XYZ'
        BOLTS.append((o, o.location.copy(), n, ax))
# corner clamps (cleats): slide in along the duct axis from outside the flange
CLEATS = []
for o in list(O):
    if o.type == 'MESH' and o.name.startswith('fastener_') and '_cleat_' in o.name:
        sgn = -1.0 if '_a_cleat_' in o.name else 1.0
        CLEATS.append((o, o.location.copy(), sgn))
CLEATS.sort(key=lambda c: c[0].name)
CLEAT_DELAY = {c[0].name: 2.35 + (i % 8) * 0.03 for i, c in enumerate(CLEATS)}
def clamp_off(name, sgn, t):
    a0 = CLEAT_DELAY[name]
    return Vector((sgn * 0.014 * (1 - lock(span(t, a0, a0 + 0.3), 0.08)), 0, 0))

# coupling sleeve at the run-to-elbow joint (the existing spigot ring) slides back over the joint
SPIGOT = O['elbow_gore_1_spigot']; SPIGOT_REST = SPIGOT.location.copy()

# collar bayonet lugs (3 at 120 deg on the top bead) — they make the twist-lock readable
cr = P['collar']['radius'] * S; cl_len = (P['collar']['y'][1] - P['collar']['y'][0]) * S
for i in range(3):
    a = i / 3 * math.tau + 0.3
    lug = mesh(f'collar_lug_{i + 1}', box_bm(0.010, 0.007, 0.006, (0, cl_len / 2 - 0.006, 0)), 'ral5017_coat', O['collar'])
    lug.location = (math.cos(a) * (cr + 0.0035), 0, math.sin(a) * (cr + 0.0035)); lug.rotation_euler = (0, -a, 0)
    bevel(lug, 0.0012, 2)

# diffuser latch pins (shoot into the top run's left flange once the panel has closed)
PINS = []
ph = (P['sidePanel']['y'][1] - P['sidePanel']['y'][0]) * S
top_c_y = (P['topRun']['body'][0] + P['topRun']['body'][1]) / 2 * S - (P['sidePanel']['y'][0] + P['sidePanel']['y'][1]) / 2 * S
for k, (yy, zz) in enumerate(((top_c_y + 0.045, -0.025), (top_c_y - 0.045, -0.095))):
    pin = mesh(f'side_panel_latch_{k + 1}', cyl_bm(0.003, 0.026, 16, 'X'), 'stainless_brushed', O['side_panel'], smooth=True)
    base = Vector((-0.004, yy, zz)); pin.location = base; PINS.append((pin, base))

# flush floor guide track under the sliding parts (stage, not exported)
FLOOR_Z = -5.34 * S
track = mesh('stage_guide_track', box_bm(1.10, 0.024, 0.0012, (0, 0, 0)), 'stainless_brushed', None, STAGE)
track.location = L2W(0.42, FLOOR_Z + 0.0006 - 0.0, ZC); bevel(track, 0.0004, 1)
slot = mesh('stage_guide_slot', box_bm(1.10, 0.010, 0.0014, (0, 0, 0)), 'interior', None, STAGE)
slot.location = L2W(0.42, FLOOR_Z + 0.0008, ZC)
slot.rotation_euler = track.rotation_euler = (0, 0, 0)

# 3-stage telescopic rails between the runs
RAILS = []
for side, x in (('l', 0.215), ('r', 0.36)):
    stages = []
    for st, w in enumerate((0.016, 0.0125, 0.0095)):
        ob = mesh(f'rail_{side}_{st}', box_bm(w, 1.0, w, (0, 0.5, 0)), 'stainless_brushed', ROOT); bevel(ob, 0.001)
        stages.append(ob)
    RAILS.append((x, stages))
Y_BOT_TOP = P['bottomRun']['body'][1] * S
TOP_HALF = (P['topRun']['body'][1] - P['topRun']['body'][0]) / 2 * S

# ---------------------------------------------------------------- 5. lights: awakening strip, interior pulse
def area(name, sx, sy, e, col, coll='LIGHTS'):
    d = bpy.data.lights.new(name, 'AREA'); d.shape = 'RECTANGLE'; d.size = sx; d.size_y = sy; d.energy = e; d.color = col
    o = bpy.data.objects.new(name, d); bpy.data.collections[coll].objects.link(o); return o
LIGHT_BASE = {o.name: o.data.energy for o in bpy.data.collections['LIGHTS'].objects if o.type == 'LIGHT'}
strip = area('awaken_strip', 0.03, 0.6, 0.0, (0.15, 0.45, 1.0))

pulse_mat = bpy.data.materials.new('airflow_pulse'); pulse_mat.use_nodes = True
pn = pulse_mat.node_tree.nodes; pn.remove(pn['Principled BSDF'])
pe = pn.new('ShaderNodeEmission'); pe.inputs['Color'].default_value = (0.12, 0.45, 1.0, 1)
pulse_mat.node_tree.links.new(pe.outputs['Emission'], pn['Material Output'].inputs['Surface'])
bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=1.0, radius2=1.0, depth=0.012)
pulse = mesh('pulse_ring', bm, 'airflow_pulse', None, bpy.data.collections['AIRFLOW'])
pl = bpy.data.lights.new('pulse_light', 'POINT'); pl.color = (0.12, 0.45, 1.0); pl.shadow_soft_size = 0.02
plo = bpy.data.objects.new('pulse_light', pl); bpy.data.collections['AIRFLOW'].objects.link(plo)

gx = (P['grille']['x'][0] + P['grille']['x'][1]) / 2 * S; gy = (P['grille']['y'][0] + P['grille']['y'][1]) / 2 * S
cl = [(P['sidePanel']['x'][1] * S, -0.097, ZC), (0.432, -0.097, ZC)]
xx, yy, ph_ = 0.432, -0.097, 0.0
for k, Lk in enumerate(SEG):
    for i in range(1, 9):
        cl.append((xx + Lk * i / 8 * math.cos(ph_), yy + Lk * i / 8 * math.sin(ph_), ZC))
    xx += Lk * math.cos(ph_); yy += Lk * math.sin(ph_)
    if k < 3: ph_ -= J
cl += [(xx, -0.29, ZC), (gx, gy, ZC), (gx, gy - 0.01, 0.06)]
CL = [L2W(*p) for p in cl]
SL = [(CL[i + 1] - CL[i]).length for i in range(len(CL) - 1)]; TOT = sum(SL)
def along(u):
    d = clamp01(u) * TOT
    for i, l in enumerate(SL):
        if d <= l or i == len(SL) - 1:
            return CL[i].lerp(CL[i + 1], d / l if l else 0), (CL[i + 1] - CL[i]).normalized()
        d -= l

# animated streamline material
fm = bpy.data.materials.new('airflow_v4'); fm.use_nodes = True; fm.blend_method = 'BLEND'
N, LK = fm.node_tree.nodes, fm.node_tree.links; N.remove(N['Principled BSDF'])
def val(name, v):
    n = N.new('ShaderNodeValue'); n.name = n.label = name; n.outputs[0].default_value = v; return n
def M_(op, a, b=None, clamp=False):
    n = N.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, (int, float)): n.inputs[i].default_value = x
        else: LK.new(x, n.inputs[i])
    return n.outputs[0]
uvn = N.new('ShaderNodeUVMap'); sep = N.new('ShaderNodeSeparateXYZ'); LK.new(uvn.outputs['UV'], sep.inputs['Vector'])
V_PH, V_HEAD, V_INT = val('phase', 0.0), val('head', 0.0), val('intensity', 0.0)
u = sep.outputs['X']
dash = M_('FRACT', M_('SUBTRACT', M_('MULTIPLY', u, 10.0), V_PH.outputs[0]))
dw = N.new('ShaderNodeMapRange'); dw.interpolation_type = 'SMOOTHSTEP'; LK.new(dash, dw.inputs['Value'])
dw.inputs['From Min'].default_value, dw.inputs['From Max'].default_value = 0.0, 0.5
dw.inputs['To Min'].default_value, dw.inputs['To Max'].default_value = 0.15, 1.0
alpha = M_('MULTIPLY', M_('MULTIPLY', M_('MULTIPLY', dw.outputs['Result'], M_('LESS_THAN', u, V_HEAD.outputs[0])),
                                       M_('POWER', M_('SUBTRACT', 1.0, u, True), 1.6)), V_INT.outputs[0], True)
em = N.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (0.10, 0.42, 1.0, 1); em.inputs['Strength'].default_value = 3.0
tr = N.new('ShaderNodeBsdfTransparent'); mx = N.new('ShaderNodeMixShader')
LK.new(alpha, mx.inputs['Fac']); LK.new(tr.outputs['BSDF'], mx.inputs[1]); LK.new(em.outputs['Emission'], mx.inputs[2])
LK.new(mx.outputs['Shader'], N['Material Output'].inputs['Surface'])
for o in bpy.data.collections['AIRFLOW'].all_objects:
    if o.type == 'MESH' and o.name.startswith('flow_'):
        o.data.materials.clear(); o.data.materials.append(fm)
bpy.data.collections['AIRFLOW'].hide_render = False

# ---------------------------------------------------------------- 6. the adjustable elbow
SEAM_N = Vector((math.cos(H), -math.sin(H), 0.0))      # mitre-plane normal at the end of the parent gore (parent frame)
Q_REST = Quaternion((0, 0, 1), -J)
def seam_q(phi):
    """Gore rotation in its parent's frame: the rest 30 deg bend, then a turn of phi about the seam normal.
    phi = pi -> straight (bend cancelled), phi = 0 -> assembled bend. The cut plane is invariant under it."""
    return Quaternion(SEAM_N, phi) @ Q_REST
# seam schedule: (start, end) of the turn pi -> 0; seam 4 'wakes' first (macro), then 2, 3, 4 in a cascade
def seam_phi(k, t):
    if k == 4:
        wake = 0.42 * ease(span(t, 0.12, 0.6))                         # the joint activates under the macro lens
        return math.pi - wake - (math.pi - 0.42) * lock(span(t, 1.9, 2.75), 0.05)
    a, b = {2: (1.15, 2.0), 3: (1.5, 2.35)}[k]
    return math.pi * (1 - lock(span(t, a, b), 0.05))

# ---------------------------------------------------------------- 7. camera: continuous Catmull-Rom move
cd = bpy.data.cameras.new('CAM_V4_1'); cd.sensor_width = 36; cd.clip_start = 0.005; cd.clip_end = 80
cam = bpy.data.objects.new('CAM_V4_1', cd); bpy.data.collections['CAMERAS'].objects.link(cam); sc.camera = cam
cd.dof.use_dof = True; cd.dof.aperture_blades = 9
CENTER = L2W(0.33, -0.265, ZC)
PX = 900 / 2.076
FINAL_T = Vector(((960 - 510) / PX, 0.0, -(540 - 338) / PX)); FINAL_LENS = 200.0; FINAL_D = (1920 / PX) * FINAL_LENS / 36
# t, az, el, log(dist), log(lens), fstop, target weight (0 seam, 1 centre, 2 final)
CK = [(0.00, 48, 24, math.log(0.17), math.log(100), 2.8, 0.0),
      (0.60, 36, 18, math.log(0.27), math.log(90), 3.2, 0.0),
      (1.50, 8, 13, math.log(0.80), math.log(50), 5.6, 0.55),
      (2.40, -28, 10, math.log(1.28), math.log(40), 8.0, 1.0),
      (3.50, -17, 7, math.log(1.18), math.log(45), 8.0, 1.0),
      (4.40, -8, 4, math.log(1.30), math.log(50), 8.0, 1.0),
      (5.25, 0, 0, math.log(FINAL_D), math.log(FINAL_LENS), 22.0, 2.0),
      (6.00, 0, 0, math.log(FINAL_D), math.log(FINAL_LENS), 22.0, 2.0)]
def cr_eval(t):
    """Catmull-Rom (centripetal-free, uniform in key index) through CK, with per-segment eased parameter only at the
    ends of the move, so velocity is continuous through every key."""
    ts = [k[0] for k in CK]
    i = max(0, min(len(CK) - 2, max(j for j in range(len(CK) - 1) if ts[j] <= t)))
    u = clamp01((t - ts[i]) / (ts[i + 1] - ts[i]))
    if i == 0: u = u * u * (2 - u)                           # gentle start from the macro
    if i == len(CK) - 3: u = ease(u)                         # land the identity framing softly
    p0, p1, p2, p3 = CK[max(0, i - 1)], CK[i], CK[i + 1], CK[min(len(CK) - 1, i + 2)]
    out = []
    for c in range(1, 7):
        a, b, cc, d = p0[c], p1[c], p2[c], p3[c]
        out.append(0.5 * ((2 * b) + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u + (-a + 3 * b - 3 * cc + d) * u ** 3))
    if i >= len(CK) - 3:                                     # no overshoot into the final framing
        out = [lerp(p1[c], p2[c], u) for c in range(1, 7)]
    return out

# ---------------------------------------------------------------- 8. key every frame
def key(o, *paths, f):
    for pth in paths: o.keyframe_insert(pth, frame=f)
TOP_DROP = 0.15                                           # flange lips clear the bottom run's by 9 mm
for f in range(FRAMES):
    t = f / FPS
    # top run: dormant on the stack -> rises on the rails -> aligns forward 8 mm -> seats
    up = lock(span(t, 0.7, 2.0), 0.04)
    fwd = 0.008 * (1 - ease(span(t, 2.0, 2.35)))
    buzz = 0.00035 * math.sin(t * math.tau * 23) * span(t, 0.1, 0.3) * (1 - span(t, 0.55, 0.75))
    l, q = REST['top_run']; O['top_run'].location = l + Vector((0, -TOP_DROP * (1 - up) + buzz, fwd)); O['top_run'].rotation_quaternion = q
    # bottom run rides the floor track in from the left
    s_in = lock(span(t, 0.6, 1.7), 0.03)
    l, q = REST['bottom_run']; O['bottom_run'].location = l + Vector((-0.11 * (1 - s_in), 0, 0)); O['bottom_run'].rotation_quaternion = q
    # diffuser swings shut on its hinge, latch pins shoot after
    sw = lock(span(t, 0.8, 2.05), 0.04)
    l, q = REST['side_panel']; O['side_panel'].location = l
    O['side_panel'].rotation_quaternion = q @ Quaternion((0, 1, 0), math.radians(95) * (1 - sw))
    for pin, base in PINS:
        pin.location = base + Vector((0.016 * ease(span(t, 2.1, 2.35)), 0, 0)); key(pin, 'location', f=f)
    # wedge slides home from the left-front
    wd = lock(span(t, 1.9, 2.65), 0.02)                        # after the panel has shut: straight back from the front
    l, q = REST['wedge']; O['wedge'].location = l + Vector((0, 0, 0.28)) * (1 - wd); O['wedge'].rotation_quaternion = q
    # grille rides the track in from the right; louvres closed, then open in a cascade
    gi = lock(span(t, 2.2, 2.95), 0.03)                       # grille arrives in the lock phase, after the outlet's sweep
    l, q = REST['grille']; O['grille'].location = l + Vector((0.22 * (1 - gi), 0, 0)); O['grille'].rotation_quaternion = q
    for k in range(1, 7):
        lv = ease(span(t, 2.95 + 0.05 * (k - 1), 3.35 + 0.05 * (k - 1)))        # no overshoot: blades seat on their stops
        l, q = REST[f'louvre_{k}']; rx = q.to_euler().x            # flipped (-125 deg) -> through horizontal -> rest (-35 deg)
        O[f'louvre_{k}'].location = l; O[f'louvre_{k}'].rotation_quaternion = Euler((rx - math.radians(90) * (1 - lv), 0, 0)).to_quaternion()
    # collar: parked in the grille spigot, rides in, rises to the outlet, twist-locks 30 deg on its lugs
    cu = ease(span(t, 2.98, 3.28)); tw = ease(span(t, 3.22, 3.48))       # no overshoot: it seats against the outlet flange
    l, q = REST['collar']; O['collar'].location = l + Vector((0.22 * (1 - gi), -0.012 * (1 - cu), 0))
    O['collar'].rotation_quaternion = q @ Quaternion((0, 1, 0), math.radians(-45) * (1 - tw))
    # elbow
    l, q = REST['elbow_gore_1']; O['elbow_gore_1'].location = l; O['elbow_gore_1'].rotation_quaternion = q
    for k in (2, 3, 4):
        l, q = REST[f'elbow_gore_{k}']; O[f'elbow_gore_{k}'].location = l; O[f'elbow_gore_{k}'].rotation_quaternion = seam_q(seam_phi(k, t))
    for p in PARTS:
        key(O[p], 'location', 'rotation_quaternion', f=f)
    # coupling sleeve slides 24 mm back over the run-to-elbow joint
    SPIGOT.location = SPIGOT_REST + Vector((0.024 * (1 - ease(span(t, 1.9, 2.3))), 0, 0)); key(SPIGOT, 'location', f=f)
    # rails: span the gap while the run rises, retract after the elbow chain holds it
    top_bottom_y = REST['top_run'][0].y - TOP_DROP * (1 - up) - TOP_HALF
    ret = ease(span(t, 3.0, 3.45)); vis = 0.55 <= t < 3.5
    h_tot = max(0.0005, (top_bottom_y - Y_BOT_TOP) * (1 - ret))
    for x, stages in RAILS:
        for st, ob in enumerate(stages):
            a_, b_ = ((0.0, 0.42), (0.34, 0.74), (0.66, 1.0))[st]
            ob.location = (x, Y_BOT_TOP + h_tot * a_, ZC + fwd * 0)
            ob.scale = (1, max(0.0005, h_tot * (b_ - a_)), 1)
            ob.hide_render = ob.hide_viewport = (not vis) or h_tot < 0.004
            key(ob, 'location', 'scale', 'hide_render', 'hide_viewport', f=f)
    # corner clamps slide 14 mm in along the duct, then the bolts spin in and seat
    for o, base, sgn in CLEATS:
        o.location = base + clamp_off(o.name, sgn, t); key(o, 'location', f=f)
    for i, (o, base, n, ax) in enumerate(BOLTS):
        a0 = (CLEAT_DELAY.get(o.name.replace('_bolt_', '_cleat_'), 2.4 + (i % 8) * 0.03) + 0.36) if ax == 2 else 3.0 + (i % 8) * 0.03
        sd = ease(span(t, a0, a0 + 0.32))
        slide = Vector((0, 0, 0))
        if ax == 2:                                            # run bolts travel with their own clamp
            slide = clamp_off(o.name.replace('_bolt_', '_cleat_'), -1.0 if '_a_bolt_' in o.name else 1.0, t)
        o.location = base + slide + n * 0.008 * (1 - sd)
        e = Euler((0, 0, 0)); e[ax] = 5 * math.pi * (1 - sd); o.rotation_euler = e
        key(o, 'location', 'rotation_euler', f=f)
    # lights
    lu = ease(span(t, 0.3, 1.3))
    for nme, e0 in LIGHT_BASE.items():
        O[nme].data.energy = e0 * (0.02 + 0.98 * lu); O[nme].data.keyframe_insert('energy', frame=f)
    bpy.context.view_layer.update()
    seam_w = O['elbow_gore_4'].matrix_world.translation.copy()
    # airflow
    pu = span(t, 3.5, 4.3); pos, tan = along(ease(pu))
    pulse.location = pos; pulse.rotation_mode = 'QUATERNION'; pulse.rotation_quaternion = tan.to_track_quat('Z', 'Y')
    rad = 0.093 if pos.x > 0.43 else 0.098; pulse.scale = (rad, rad, 1.0)
    pe.inputs['Strength'].default_value = 7.0 * math.sin(math.pi * pu) if 0 < pu < 1 else 0.0
    pulse.hide_render = not (0 < pu < 1); plo.location = pos; pl.energy = 4.0 * math.sin(math.pi * pu) if 0 < pu < 1 else 0.0
    key(pulse, 'location', 'rotation_quaternion', 'scale', 'hide_render', f=f); key(plo, 'location', f=f)
    pe.inputs['Strength'].keyframe_insert('default_value', frame=f); pl.keyframe_insert('energy', frame=f)
    V_HEAD.outputs[0].default_value = ease_out(span(t, 3.9, 4.6))
    V_INT.outputs[0].default_value = ease(span(t, 3.9, 4.25)) * (1 - 0.35 * span(t, 5.0, 6.0))
    V_PH.outputs[0].default_value = max(0.0, t - 3.9) * 2.4
    for v in (V_HEAD, V_INT, V_PH): v.outputs[0].keyframe_insert('default_value', frame=f)
    # camera
    az, el, ld, ll, fst, m = cr_eval(t)
    tgt = seam_w.lerp(CENTER, m) if m <= 1 else CENTER.lerp(FINAL_T, m - 1)
    d = Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)), -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el))))
    cam.location = tgt + d * math.exp(ld); cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cd.lens = math.exp(ll); cd.dof.aperture_fstop = fst
    cd.dof.focus_distance = math.exp(ld) - 0.0825 * max(0.0, 1.0 - m)   # macro: focus on the pipe's surface, not its axis
    key(cam, 'location', 'rotation_euler', f=f); cd.keyframe_insert('lens', frame=f)
    cd.dof.keyframe_insert('focus_distance', frame=f); cd.dof.keyframe_insert('aperture_fstop', frame=f)
    # awakening light sweep: a narrow strip close to the camera, travelling sideways, so its reflection runs
    # across the seam, its bead and the bolt heads (polished metal only shows what it reflects)
    sweep = span(t, 0.0, 0.95)
    cq = cam.rotation_euler.to_quaternion(); right = cq @ Vector((1, 0, 0)); upv = cq @ Vector((0, 1, 0))
    to_cam = (cam.location - seam_w).normalized()
    strip.location = cam.location + right * (-0.22 + 0.44 * ease(sweep)) + upv * 0.06 - to_cam * 0.02
    strip.rotation_euler = (seam_w - strip.location).to_track_quat('-Z', 'Y').to_euler()
    strip.data.energy = 26.0 * math.sin(math.pi * sweep) ** 0.7 if 0 < sweep < 1 else 0.0
    key(strip, 'location', 'rotation_euler', f=f); strip.data.keyframe_insert('energy', frame=f)

def linearize(idb):
    ad = getattr(idb, 'animation_data', None)
    if ad and ad.action:
        for fc in ad.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT' if 'hide' in fc.data_path else 'LINEAR'
for coll in (bpy.data.objects, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
    for idb in coll:
        linearize(idb)
        if getattr(idb, 'node_tree', None): linearize(idb.node_tree)
sc.frame_set(0)
if OUT:
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
print(f'LIBALSTAL_V4_1 animated: {FRAMES} frames, {len(BOLTS)} bolts, {len(CLEATS)} clamps, saved {OUT}')
