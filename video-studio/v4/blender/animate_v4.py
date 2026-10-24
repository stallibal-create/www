"""LIBALSTAL V4 "Future Engineered" — real mechanical animation (Blender 4.2 LTS).

Builds the emblem with the V3 builder (geometry + materials, unchanged V3 source), then keys EVERY frame of the
6-second sequence (180 frames @ 30 fps) on the parts' own pivots: a genuine rig, not image switching.

  blender -b --factory-startup --python animate_v4.py -- OUT.blend
(build_v3.py and logo_parts.json must sit next to this file.)

Timeline (seconds)
  0.00-0.60  awakening: blue strip light sweeps a macro of the dormant elbow joint; the stack vibrates
  0.60-2.30  transformation: camera pulls back/orbits; panel swings shut on its hinge, top run rises on telescopic
             rails, bottom run and grille slide in on their mounts, wedge slides home
  2.30-3.50  precision lock: elbow articulates seam by seam (30 deg each, overshoot + settle), collar rises and
             engages, louvres rotate in sequence, rails retract, bolts spin and seat
  3.50-4.40  airflow ignition: a blue pulse ring travels the real centreline; streamlines leave the louvres
  4.40-5.25  identity: dolly-zoom to the exact framing of the official logo in the 1920x1080 composition
  5.25-6.00  hold (Remotion dissolves to the official PNG and hands off to the live homepage)
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

# ---------------------------------------------------------------- 1. build with the V3 builder (fresh file)
g = {'__name__': '__main__', 'PARTS_JSON': open(os.path.join(HERE, 'logo_parts.json')).read(), 'SAVE_TO': None,
     'SEG': [0.34297496631183705, 0.6859499326236741, 0.6859499326236741, 0.34297496631183705]}
exec(compile(open(os.path.join(HERE, 'build_v3.py')).read(), 'build_v3.py', 'exec'), g)
sc = bpy.data.scenes['LIBALSTAL_V3']; sc.name = 'LIBALSTAL_V4'
for s in list(bpy.data.scenes):
    if s != sc:
        bpy.data.scenes.remove(s)
sc.frame_start, sc.frame_end, sc.render.fps = 0, FRAMES - 1, FPS
O = bpy.data.objects
S = 0.1
J = math.radians(30)

# ---------------------------------------------------------------- 2. V3 review fixes that apply to every frame
for mname, (b0, b1, r0, r1) in (('galvanised', (0.988, 1.006, 0.30, 0.33)), ('galvanised_flange', (0.985, 1.008, 0.31, 0.35))):
    nt = bpy.data.materials[mname].node_tree
    vors = [n for n in nt.nodes if n.type == 'TEX_VORONOI' and n.feature == 'F1']
    for v in vors:                                    # softer crystal borders: smooth F1
        v.feature = 'SMOOTH_F1'; v.inputs['Smoothness'].default_value = 0.6
    mrs = [n for n in nt.nodes if n.type == 'MAP_RANGE']
    mrs[0].inputs['To Min'].default_value, mrs[0].inputs['To Max'].default_value = b0, b1   # crystal brightness
    mrs[1].inputs['To Min'].default_value, mrs[1].inputs['To Max'].default_value = r0, r1   # crystal roughness
for o in list(O):                                     # the static V3 halo tubes are replaced by animated streams
    if o.name.endswith('_halo'):
        bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- 3. timing helpers
def clamp01(x): return 0.0 if x < 0 else 1.0 if x > 1 else x
def span(t, a, b): return clamp01((t - a) / (b - a))
def ease(u): u = clamp01(u); return u * u * u * (u * (6 * u - 15) + 10)            # smootherstep
def ease_out(u): u = clamp01(u); return 1 - (1 - u) ** 3
def lock(u, over=0.07):
    """0 -> 1 with one overshoot and a damped settle: a part seating against its stop."""
    u = clamp01(u)
    if u < 0.72:
        return ease(u / 0.72) * (1 + over)
    v = (u - 0.72) / 0.28
    return 1 + over * math.cos(v * math.pi / 2) ** 2 * math.exp(-3 * v) * (1 - v)
def lerp(a, b, u): return a + (b - a) * u

# ---------------------------------------------------------------- 4. rest transforms
parts = ['top_run', 'bottom_run', 'side_panel', 'wedge', 'collar', 'grille'] + [f'elbow_gore_{k}' for k in range(1, 5)] + [f'louvre_{k}' for k in range(1, 7)]
REST = {p: (O[p].location.copy(), O[p].rotation_euler.copy()) for p in parts}
for p in parts:
    O[p].rotation_mode = 'XYZ'

# grille mounts travel with the grille (parented, transform kept)
gr = O['grille']; bpy.context.view_layer.update()
for o in list(O):
    if o.name.startswith(('mount_3_', 'mount_4_')):
        mw = o.matrix_world.copy(); o.parent = gr; o.matrix_world = mw

# fasteners: move each bolt's origin to its own centre so it can spin about its own axis (axis known from its name)
bolts = []
for o in list(O):
    if o.type == 'MESH' and o.name.startswith('fastener_') and '_bolt_' in o.name:
        if o.name.startswith('fastener_elbow_flange_bolt'):
            n, ax = Vector((-1, 0, 0)), 0
        else:
            n, ax = Vector((0, 0, float(o.name.rsplit('_', 1)[1]))), 2
        me = o.data
        lo = [min(v.co[i] for v in me.vertices) for i in range(3)]; hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
        c = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
        me.transform(Matrix.Translation(-c)); o.location = o.location + c
        o.rotation_mode = 'XYZ'
        bolts.append((o, o.location.copy(), n, ax))

# ---------------------------------------------------------------- 5. telescopic rails (carry the rising top run)
rail_mat = bpy.data.materials['stainless_brushed']
RAILS = []
for side, x in (('l', 0.215), ('r', 0.36)):
    stages = []
    for st, w in enumerate((0.016, 0.0125, 0.0095)):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((w, 1.0, w)), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((0, 0.5, 0)), verts=bm.verts)        # origin at the stage's foot
        me = bpy.data.meshes.new(f'rail_{side}_{st}'); bm.to_mesh(me); bm.free(); me.materials.append(rail_mat)
        ob = bpy.data.objects.new(f'rail_{side}_{st}', me); bpy.data.collections['EMBLEM'].objects.link(ob)
        ob.parent = O['LIBALSTAL_emblem']; bv = ob.modifiers.new('b', 'BEVEL'); bv.width = 0.001; bv.segments = 2
        stages.append(ob)
    RAILS.append((x, stages))
P = json.loads(g['PARTS_JSON'])['parts']
Y_BOTTOM_TOP = P['bottomRun']['body'][1] * S                                  # bottom run body top
TOP_BODY_HALF = (P['topRun']['body'][1] - P['topRun']['body'][0]) / 2 * S

# ---------------------------------------------------------------- 6. awakening strip light + interior pulse
def area(name, size, size_y, energy, color):
    d = bpy.data.lights.new(name, 'AREA'); d.shape = 'RECTANGLE'; d.size = size; d.size_y = size_y; d.energy = energy; d.color = color
    o = bpy.data.objects.new(name, d); bpy.data.collections['LIGHTS'].objects.link(o)
    return o
strip = area('awaken_strip', 0.02, 0.6, 0.0, (0.15, 0.45, 1.0))
LIGHT_BASE = {o.name: o.data.energy for o in bpy.data.collections['LIGHTS'].objects if o.type == 'LIGHT' and o.name != 'awaken_strip'}

pulse_mat = bpy.data.materials.new('airflow_pulse'); pulse_mat.use_nodes = True
pn = pulse_mat.node_tree.nodes; pn.remove(pn['Principled BSDF'])
pe = pn.new('ShaderNodeEmission'); pe.inputs['Color'].default_value = (0.12, 0.45, 1.0, 1)
pulse_mat.node_tree.links.new(pe.outputs['Emission'], pn['Material Output'].inputs['Surface'])
me = bpy.data.meshes.new('pulse_ring')
bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=1.0, radius2=1.0, depth=0.012)   # thin band
bm.to_mesh(me); bm.free(); me.materials.append(pulse_mat)
pulse = bpy.data.objects.new('pulse_ring', me); bpy.data.collections['AIRFLOW'].objects.link(pulse)
pl = bpy.data.lights.new('pulse_light', 'POINT'); pl.color = (0.12, 0.45, 1.0); pl.shadow_soft_size = 0.02
plo = bpy.data.objects.new('pulse_light', pl); bpy.data.collections['AIRFLOW'].objects.link(plo)

# centreline of the assembled system (logo frame -> world), resampled by length
def L2W(p): return Vector((p[0], -p[2], p[1]))
ZC = -0.06
gx = (P['grille']['x'][0] + P['grille']['x'][1]) / 2 * S; gy = (P['grille']['y'][0] + P['grille']['y'][1]) / 2 * S
cl = [(0.151, -0.097, ZC), (0.432, -0.097, ZC)]
xx, yy, ph = 0.432, -0.097, 0.0
for k, Lk in enumerate(g['SEG']):
    for i in range(1, 9):
        cl.append((xx + Lk * S * i / 8 * math.cos(ph), yy + Lk * S * i / 8 * math.sin(ph), ZC))
    xx += Lk * S * math.cos(ph); yy += Lk * S * math.sin(ph)
    if k < 3: ph -= J
cl += [(xx, -0.29, ZC), (gx, gy, ZC), (gx, gy - 0.01, 0.06)]
CL = [L2W(p) for p in cl]
seg_len = [(CL[i + 1] - CL[i]).length for i in range(len(CL) - 1)]; TOT = sum(seg_len)
def along(u):
    d = clamp01(u) * TOT
    for i, l in enumerate(seg_len):
        if d <= l or i == len(seg_len) - 1:
            f = d / l if l else 0
            return CL[i].lerp(CL[i + 1], f), (CL[i + 1] - CL[i]).normalized()
        d -= l

# animated streamline material (dash phase + growing head + intensity), on the V3 flow tubes
fm = bpy.data.materials.new('airflow_v4'); fm.use_nodes = True; fm.blend_method = 'BLEND'
N, Lk_ = fm.node_tree.nodes, fm.node_tree.links
N.remove(N['Principled BSDF'])
def node(t, **kw):
    n = N.new(t)
    for k, v in kw.items(): setattr(n, k, v)
    return n
def val(name, v):
    n = node('ShaderNodeValue'); n.name = name; n.label = name; n.outputs[0].default_value = v; return n
uv = node('ShaderNodeUVMap'); sep = node('ShaderNodeSeparateXYZ'); Lk_.new(uv.outputs['UV'], sep.inputs['Vector'])
v_phase, v_head, v_int = val('phase', 0.0), val('head', 0.0), val('intensity', 0.0)
def math_(op, a, b=None, clamp=False):
    n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, (int, float)): n.inputs[i].default_value = x
        else: Lk_.new(x, n.inputs[i])
    return n.outputs[0]
u = sep.outputs['X']
dash = math_('FRACT', math_('SUBTRACT', math_('MULTIPLY', u, 10.0), v_phase.outputs[0]))
dwin = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP'); Lk_.new(dash, dwin.inputs['Value'])
dwin.inputs['From Min'].default_value, dwin.inputs['From Max'].default_value = 0.0, 0.5
dwin.inputs['To Min'].default_value, dwin.inputs['To Max'].default_value = 0.15, 1.0
headm = math_('LESS_THAN', u, v_head.outputs[0])
tail = math_('POWER', math_('SUBTRACT', 1.0, u, True), 1.6)
alpha = math_('MULTIPLY', math_('MULTIPLY', math_('MULTIPLY', dwin.outputs['Result'], headm), tail), v_int.outputs[0], True)
em = node('ShaderNodeEmission'); em.inputs['Color'].default_value = (0.10, 0.42, 1.0, 1); em.inputs['Strength'].default_value = 3.0
tr = node('ShaderNodeBsdfTransparent'); mx = node('ShaderNodeMixShader')
Lk_.new(alpha, mx.inputs['Fac']); Lk_.new(tr.outputs['BSDF'], mx.inputs[1]); Lk_.new(em.outputs['Emission'], mx.inputs[2])
Lk_.new(mx.outputs['Shader'], N['Material Output'].inputs['Surface'])
for o in bpy.data.collections['AIRFLOW'].all_objects:
    if o.type == 'MESH' and o.name.startswith('flow_'):
        o.data.materials.clear(); o.data.materials.append(fm)
bpy.data.collections['AIRFLOW'].hide_render = False

# ---------------------------------------------------------------- 7. camera rig
cd = bpy.data.cameras.new('CAM_V4'); cd.sensor_width = 36; cd.clip_start = 0.01; cd.clip_end = 80
cam = bpy.data.objects.new('CAM_V4', cd); bpy.data.collections['CAMERAS'].objects.link(cam); sc.camera = cam
cd.dof.use_dof = True; cd.dof.aperture_blades = 9
CENTER = L2W((0.33, -0.265, ZC))
JOINT_REST = L2W((0.432, -0.097, 0.0))
# final framing = the official logo's place in the 1920x1080 composition (content/intro.json: logo rect 510,338,900x271)
PX_PER_M = 900 / 2.076
FINAL_T = Vector((0.0 + (960 - 510) / PX_PER_M, 0.0, -(540 - 338) / PX_PER_M))
FINAL_LENS = 200.0
FINAL_D = (1920 / PX_PER_M) * FINAL_LENS / 36.0
KEYS = [  # t, az, el, dist, lens, fstop, target_mix (0 = joint, 1 = centre, 2 = final)
    (0.00, 34, 14, 0.36, 100, 2.8, 0.0),
    (0.60, 28, 12, 0.50, 85, 3.5, 0.0),
    (1.40, -6, 11, 0.95, 50, 5.6, 0.75),
    (2.30, -30, 10, 1.30, 40, 8.0, 1.0),
    (3.50, -18, 7, 1.22, 45, 8.0, 1.0),
    (4.40, -9, 4, 1.30, 50, 8.0, 1.0),
    (5.25, 0, 0, FINAL_D, FINAL_LENS, 22.0, 2.0),
    (6.00, 0, 0, FINAL_D, FINAL_LENS, 22.0, 2.0),
]
def cam_at(t, joint_world):
    for i in range(len(KEYS) - 1):
        if KEYS[i][0] <= t <= KEYS[i + 1][0]:
            a, b = KEYS[i], KEYS[i + 1]; break
    else:
        a = b = KEYS[-1]
    w = ease(span(t, a[0], b[0])) if b[0] > a[0] else 1.0
    az = lerp(a[1], b[1], w); el = lerp(a[2], b[2], w)
    # dolly-zoom on the last move: interpolate lens on a log scale, keep the emblem's size continuous
    lens = math.exp(lerp(math.log(a[4]), math.log(b[4]), w)); dist = math.exp(lerp(math.log(a[3]), math.log(b[3]), w))
    fst = lerp(a[5], b[5], w); m = lerp(a[6], b[6], w)
    tgt = joint_world.lerp(CENTER, m) if m <= 1 else CENTER.lerp(FINAL_T, m - 1)
    d = Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)), -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el))))
    loc = tgt + d * dist
    return loc, tgt, lens, fst

# ---------------------------------------------------------------- 8. key every frame
def key(o, *paths, f):
    for pth in paths: o.keyframe_insert(pth, frame=f)

for f in range(FRAMES):
    t = f / FPS
    # --- top run: dormant 170 mm low (resting on the bottom run), rises on its rails, seats
    up = lock(span(t, 0.75, 2.05), 0.05)
    buzz = 0.0004 * math.sin(t * 2 * math.pi * 23) * (span(t, 0.15, 0.35) * (1 - span(t, 0.55, 0.75)))
    l, r = REST['top_run']; O['top_run'].location = l + Vector((0, -0.17 * (1 - up) + buzz, 0)); O['top_run'].rotation_euler = r
    # --- bottom run slides in from the left on the floor mounts' line
    s_in = lock(span(t, 0.65, 1.75), 0.03)
    l, r = REST['bottom_run']; O['bottom_run'].location = l + Vector((-0.11 * (1 - s_in), 0, 0)); O['bottom_run'].rotation_euler = r
    # --- blue diffuser panel swings shut on its hinge (starts open 95 deg toward the camera)
    sw = lock(span(t, 0.85, 2.15), 0.04)
    l, r = REST['side_panel']; O['side_panel'].location = l; O['side_panel'].rotation_euler = Euler((r.x, r.y + math.radians(95) * (1 - sw), r.z))
    # --- wedge slides home from the left-front
    wd = lock(span(t, 1.45, 2.3), 0.04)
    l, r = REST['wedge']; O['wedge'].location = l + Vector((-0.10, 0, 0.08)) * (1 - wd); O['wedge'].rotation_euler = r
    # --- grille slides in from the right with its mounts; louvres closed until the lock
    gi = lock(span(t, 1.05, 2.4), 0.03)
    l, r = REST['grille']; O['grille'].location = l + Vector((0.22 * (1 - gi), 0, 0)); O['grille'].rotation_euler = r
    for k in range(1, 7):
        lv = lock(span(t, 2.75 + 0.06 * (k - 1), 3.2 + 0.06 * (k - 1)), 0.12)
        l, r = REST[f'louvre_{k}']; O[f'louvre_{k}'].location = l; O[f'louvre_{k}'].rotation_euler = Euler((r.x * lv, r.y, r.z))
    # --- collar: parked inside the grille spigot, rides in with it, then rises and engages the outlet
    cu = lock(span(t, 2.95, 3.4), 0.06)
    l, r = REST['collar']; O['collar'].location = l + Vector((0.22 * (1 - gi), -0.07 * (1 - cu), 0)); O['collar'].rotation_euler = r
    # --- elbow: straight spigot until the lock, then the three seams bend 30 deg each, in sequence
    for k, a0 in ((2, 2.25), (3, 2.45), (4, 2.65)):
        b = lock(span(t, a0, a0 + 0.5), 0.09)
        l, r = REST[f'elbow_gore_{k}']; O[f'elbow_gore_{k}'].location = l; O[f'elbow_gore_{k}'].rotation_euler = Euler((r.x, r.y, r.z * b))
    l, r = REST['elbow_gore_1']; O['elbow_gore_1'].location = l; O['elbow_gore_1'].rotation_euler = r
    for p in parts:
        key(O[p], 'location', 'rotation_euler', f=f)
    # --- rails: span the gap between the runs while the top run rises, retract into the bottom run after the lock
    top_bottom_y = REST['top_run'][0].y - 0.17 * (1 - up) - TOP_BODY_HALF
    ret = ease(span(t, 2.9, 3.45))
    vis = 0.6 <= t < 3.5
    h_total = max(0.0005, (top_bottom_y - Y_BOTTOM_TOP) * (1 - ret))
    for x, stages in RAILS:
        for st, ob in enumerate(stages):
            a_, b_ = ((0.0, 0.42), (0.34, 0.74), (0.66, 1.0))[st]
            ob.location = (x, Y_BOTTOM_TOP + h_total * a_, ZC)
            ob.scale = (1, max(0.0005, h_total * (b_ - a_)), 1)
            ob.hide_render = ob.hide_viewport = not vis or h_total < 0.004
            key(ob, 'location', 'scale', 'hide_render', 'hide_viewport', f=f)
    # --- bolts spin in and seat (staggered by position)
    for i, (o, base, n, ax) in enumerate(bolts):
        a0 = 3.05 + (i % 9) * 0.035
        sd = lock(span(t, a0, a0 + 0.3), 0.0)
        o.location = base + n * 0.007 * (1 - sd)
        e = Euler((0, 0, 0)); e[ax] = 4 * math.pi * (1 - ease(span(t, a0, a0 + 0.3)))
        o.rotation_euler = e
        key(o, 'location', 'rotation_euler', f=f)
    # --- lights: dark start, a narrow blue strip sweeps the joint, the studio fades up
    lu = ease(span(t, 0.35, 1.35))
    for nme, e0 in LIGHT_BASE.items():
        O[nme].data.energy = e0 * (0.02 + 0.98 * lu); O[nme].data.keyframe_insert('energy', frame=f)
    jw = JOINT_REST + Vector((0, 0, -0.17 * (1 - up)))
    sweep = span(t, 0.0, 0.7)
    strip.location = jw + Vector((-0.25 + 0.5 * sweep, -0.22, 0.10)); strip.rotation_euler = (jw - strip.location).to_track_quat('-Z', 'Y').to_euler()
    strip.data.energy = 9.0 * math.sin(math.pi * sweep) if 0 < sweep < 1 else 0.0
    key(strip, 'location', 'rotation_euler', f=f); strip.data.keyframe_insert('energy', frame=f)
    # --- airflow: pulse ring travels the centreline 3.5-4.3 s, streams grow out of the louvres from 3.9 s
    pu = span(t, 3.5, 4.3)
    pos, tan = along(ease(pu))
    pulse.location = pos; pulse.rotation_mode = 'QUATERNION'; pulse.rotation_quaternion = tan.to_track_quat('Z', 'Y')
    rad = 0.093 if pos.x > 0.43 else 0.098
    pulse.scale = (rad, rad, 1.0)
    pe.inputs['Strength'].default_value = 7.0 * math.sin(math.pi * pu) if 0 < pu < 1 else 0.0
    pulse.hide_render = not (0 < pu < 1)
    plo.location = pos; pl.energy = 4.0 * math.sin(math.pi * pu) if 0 < pu < 1 else 0.0
    key(pulse, 'location', 'rotation_quaternion', 'scale', 'hide_render', f=f); key(plo, 'location', f=f)
    pe.inputs['Strength'].keyframe_insert('default_value', frame=f); pl.keyframe_insert('energy', frame=f)
    v_head.outputs[0].default_value = ease_out(span(t, 3.9, 4.6)); v_int.outputs[0].default_value = ease(span(t, 3.9, 4.25)) * (1 - 0.35 * span(t, 5.0, 6.0))
    v_phase.outputs[0].default_value = max(0.0, t - 3.9) * 2.4
    for v in (v_head, v_int, v_phase):
        v.outputs[0].keyframe_insert('default_value', frame=f)
    # --- camera
    loc, tgt, lens, fst = cam_at(t, jw)
    cam.location = loc; cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler(); cd.lens = lens
    cd.dof.focus_distance = (tgt - loc).length; cd.dof.aperture_fstop = fst
    key(cam, 'location', 'rotation_euler', f=f); cd.keyframe_insert('lens', frame=f)
    cd.dof.keyframe_insert('focus_distance', frame=f); cd.dof.keyframe_insert('aperture_fstop', frame=f)

# per-frame keys carry the easing: make every curve linear (constant for visibility)
def linearize(idblock):
    ad = getattr(idblock, 'animation_data', None)
    if ad and ad.action:
        for fc in ad.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT' if 'hide' in fc.data_path else 'LINEAR'
for coll in (bpy.data.objects, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
    for idb in coll:
        linearize(idb)
        if hasattr(idb, 'node_tree') and idb.node_tree:
            linearize(idb.node_tree)

sc.frame_set(0)
if OUT:
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
print(f'LIBALSTAL_V4 animated: {FRAMES} frames, {len(bolts)} bolts rigged, saved {OUT}')
