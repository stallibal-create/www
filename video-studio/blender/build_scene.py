"""LIBALSTAL Transformation Protocol v2 — Blender scene build (Blender 4.2).

Builds the transforming duct from logo_parts.json, keys every part and the camera on every frame from rig.py
(the same motion as the animatic), sets up materials, studio light and the airflow, then renders.

Command line:
  blender --background --factory-startup --python video-studio/blender/build_scene.py -- \
      --format desktop|mobile  --mode animatic|lookdev|master  [--frames 0,45,75] [--out DIR] [--save FILE.blend]
From the Blender MCP connection:
  f = '<repo>/video-studio/blender/build_scene.py'
  exec(open(f).read(), {'__name__': '__main__', '__file__': f, 'ARGS': ['--format', 'desktop', '--mode', 'animatic']})

Modes: animatic = Workbench, half resolution, MP4 · lookdev = EEVEE stills · master = Cycles PNG sequence + passes.
Status: WRITTEN WITHOUT ACCESS TO BLENDER. Its first run on the Mac is its first test.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent   # pass '__file__' in the globals when exec'ing from the MCP connection
sys.path.insert(0, str(HERE))
import importlib
import rig  # noqa: E402
importlib.reload(rig)

# ---------------------------------------------------------------- arguments
def args():
    a = globals().get('ARGS') or (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    o = {'format': 'desktop', 'mode': 'animatic', 'frames': None, 'out': str(HERE.parent / 'out' / 'blender'), 'save': None}
    i = 0
    while i < len(a):
        k = a[i].lstrip('-')
        if k in o and i + 1 < len(a):
            o[k] = a[i + 1]; i += 2
        else:
            i += 1
    if o['frames']:
        o['frames'] = [int(x) for x in o['frames'].split(',')]
    return o

OPT = args()
FMT, MODE = OPT['format'], OPT['mode']
P = rig.PARTS
COMP = rig.INTRO['compositions'][FMT]

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True) if bpy.app.background else None
scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene.frame_start, scene.frame_end = 0, rig.FRAMES - 1
scene.render.fps = rig.FPS
scene.unit_settings.system = 'METRIC'

# ---------------------------------------------------------------- materials
def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)

def mat_galvanised(name='Galvanised steel', scale=38.0, tint=(0.80, 0.82, 0.84, 1)):
    """Hot-dip galvanised sheet: metal, per-crystal (Voronoi) roughness and a faint sheen variation = spangle."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; n = nt.nodes; l = nt.links
    bsdf = n['Principled BSDF']
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Base Color'].default_value = tint
    tc = n.new('ShaderNodeTexCoord')
    vor = n.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = scale
    rough = n.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value, rough.inputs['To Max'].default_value = 0.22, 0.42
    l.new(tc.outputs['Object'], vor.inputs['Vector'])
    l.new(vor.outputs['Distance'], rough.inputs['Value'])
    l.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    return m

def mat_brushed(name='Brushed stainless'):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Base Color'].default_value = (0.86, 0.87, 0.88, 1)
    b.inputs['Roughness'].default_value = 0.18
    b.inputs['Anisotropic'].default_value = 0.75
    return m

def mat_blue_reveal(name):
    """Galvanised until the airflow reaches it, then RAL 5017 powder coat: a Mix Shader keyed by the rig."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; n = nt.nodes; l = nt.links
    out = n['Material Output']; galv = n['Principled BSDF']
    galv.inputs['Metallic'].default_value = 1.0
    galv.inputs['Roughness'].default_value = 0.3
    galv.inputs['Base Color'].default_value = (0.80, 0.82, 0.84, 1)
    blue = n.new('ShaderNodeBsdfPrincipled')
    blue.inputs['Base Color'].default_value = srgb('#0066CC')
    blue.inputs['Metallic'].default_value = 0.35
    blue.inputs['Roughness'].default_value = 0.28
    blue.inputs['Coat Weight'].default_value = 0.6
    blue.inputs['Coat Roughness'].default_value = 0.2
    mix = n.new('ShaderNodeMixShader'); mix.name = 'reveal'
    l.new(galv.outputs['BSDF'], mix.inputs[1]); l.new(blue.outputs['BSDF'], mix.inputs[2])
    l.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m

def mat_emission(name, color='#4D9BFF', strength=6.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    n = m.node_tree.nodes; l = m.node_tree.links
    n.remove(n['Principled BSDF'])
    e = n.new('ShaderNodeEmission'); e.inputs['Color'].default_value = srgb(color); e.inputs['Strength'].default_value = strength
    l.new(e.outputs['Emission'], n['Material Output'].inputs['Surface'])
    return m

GALV = mat_galvanised()
GALV_FINE = mat_galvanised('Galvanised flange', 70.0, (0.74, 0.77, 0.80, 1))
STEEL = mat_brushed()
DARK = bpy.data.materials.new('Duct interior'); DARK.use_nodes = True
DARK.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.022, 0.025, 1)
DARK.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
BLUE_PANEL, BLUE_WEDGE, BLUE_COLLAR = mat_blue_reveal('RAL 5017 panel'), mat_blue_reveal('RAL 5017 wedge'), mat_blue_reveal('RAL 5017 collar')
FLOW = mat_emission('Airflow')

# ---------------------------------------------------------------- mesh helpers
def mesh_obj(name, bm, mat, parent=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    if isinstance(mat, list):
        for x in mat: me.materials.append(x)
    else:
        me.materials.append(mat)
    if parent: ob.parent = parent
    for p in me.polygons: p.use_smooth = False
    return ob

def bm_box(w, h, d, at=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((w, h, d)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return bm

def add_bevel(ob, width=0.008, segments=2):
    m = ob.modifiers.new('Bevel', 'BEVEL'); m.width = width; m.segments = segments; m.limit_method = 'ANGLE'
    return ob

def empty(name, parent=None):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e)
    if parent: e.parent = parent
    return e

def box(name, w, h, d, mat, parent, at=(0, 0, 0), bevel=0.006):
    ob = mesh_obj(name, bm_box(w, h, d, at), mat, parent)
    return add_bevel(ob, bevel) if bevel else ob

def cross_broken_panel(name, a, b, mat, parent, matrix, bulge=0.010, t=0.008):
    """Panel a x b with its cross-break (centre stands proud: the diagonal crease of real duct sheet)."""
    bm = bmesh.new()
    c = bm.verts.new((0, 0, bulge))
    corners = [bm.verts.new(v) for v in ((-a / 2, -b / 2, 0), (a / 2, -b / 2, 0), (a / 2, b / 2, 0), (-a / 2, b / 2, 0))]
    for i in range(4):
        bm.faces.new((corners[i], corners[(i + 1) % 4], c))
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    ob = mesh_obj(name, bm, mat, parent)
    s = ob.modifiers.new('Sheet', 'SOLIDIFY'); s.thickness = t; s.offset = -1
    return ob

# ---------------------------------------------------------------- parts
def rect_run(name, p):
    """Rectangular duct section: 4 cross-broken panels, Pittsburgh seam, TDF flange frames, cleats, bolts."""
    root = empty(name)
    L, Ho = p['x'][1] - p['x'][0], p['y'][1] - p['y'][0]
    Hb, D, fw = p['body'][1] - p['body'][0], p['depth'], p['flange']
    yb = (p['body'][0] + p['body'][1]) / 2 - (p['y'][0] + p['y'][1]) / 2
    Lb = L - 2 * fw
    R = Matrix.Rotation
    cross_broken_panel(name + ' front', Lb, Hb, GALV, root, Matrix.Translation((0, yb, D / 2)))
    cross_broken_panel(name + ' back', Lb, Hb, GALV, root, Matrix.Translation((0, yb, -D / 2)) @ R(math.pi, 4, 'Y'))
    cross_broken_panel(name + ' top', Lb, D, GALV, root, Matrix.Translation((0, yb + Hb / 2, 0)) @ R(-math.pi / 2, 4, 'X'))
    cross_broken_panel(name + ' bottom', Lb, D, GALV, root, Matrix.Translation((0, yb - Hb / 2, 0)) @ R(math.pi / 2, 4, 'X'))
    box(name + ' interior', Lb * 0.998, Hb * 0.99, D * 0.99, DARK, root, (0, yb, 0), bevel=0)
    box(name + ' lock seam', Lb, 0.03, 0.03, GALV_FINE, root, (0, yb + Hb / 2 + 0.01, -D / 2 - 0.01))
    lip = (Ho - Hb) / 2
    for s in (-1, 1):
        x = s * (L - fw) / 2
        for y in (yb + Hb / 2 + lip / 2, yb - Hb / 2 - lip / 2):
            box(f'{name} flange h', fw, lip, D + 2 * lip, GALV_FINE, root, (x, y, 0))
        for z in (D / 2 + lip / 2, -D / 2 - lip / 2):
            box(f'{name} flange v', fw, Hb, lip, GALV_FINE, root, (x, yb, z))
        for cy in (-1, 1):
            for cz in (-1, 1):
                box(f'{name} cleat', fw * 0.6, lip * 1.1, lip * 1.1, STEEL, root, (x + s * 0.004, yb + cy * (Hb / 2 + lip * 0.55), cz * (D / 2 + lip * 0.55)), 0.003)
                # bolt heads on the front face of the frame, as on the logo
            bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.035, radius2=0.035, depth=0.025)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
            bmesh.ops.translate(bm, vec=Vector((x, yb + cy * (Hb / 2 + lip * 0.45), D / 2 + lip + 0.012)), verts=bm.verts)
            mesh_obj(f'{name} bolt', bm, STEEL, root)
    return root

def slab(name, pts, thickness, mat):
    bm = bmesh.new()
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    vs = [bm.verts.new((x - cx, y - cy, thickness / 2)) for x, y in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=Vector((0, 0, -thickness)), verts=[v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return add_bevel(mesh_obj(name, bm, mat), 0.012, 3), (cx, cy)

def gore(name, length, radius, cut_start, cut_end):
    """One gore of a segmented elbow: a tube along +X from 0 to length, both ends mitred (cut planes tilted
    about Z by cut_start / cut_end radians), hollow sheet with a rolled bead at each seam."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=radius, radius2=radius, depth=length + 0.6)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'Y'))
    bmesh.ops.translate(bm, vec=Vector((length / 2, 0, 0)), verts=bm.verts)
    for x0, ang, keep_pos in ((0.0, cut_start, True), (length, cut_end, False)):
        no = Vector((math.cos(ang), math.sin(ang), 0))
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((x0, 0, 0)), plane_no=no, clear_inner=keep_pos, clear_outer=not keep_pos)
    ob = mesh_obj(name, bm, GALV)
    s = ob.modifiers.new('Sheet', 'SOLIDIFY'); s.thickness = 0.01
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def grille(name, p):
    root = empty(name)
    W, H, D, fr = p['x'][1] - p['x'][0], p['y'][1] - p['y'][0], p['depth'], p['frame']
    for w, h, x, y in ((W, fr, 0, (H - fr) / 2), (W, fr, 0, -(H - fr) / 2), (fr, H, -(W - fr) / 2, 0), (fr, H, (W - fr) / 2, 0)):
        box(name + ' frame', w, h, D, STEEL, root, (x, y, 0))
    box(name + ' plenum', W - 2 * fr, H - 2 * fr, 0.02, DARK, root, (0, 0, -D / 2 + 0.02), 0)
    pitch = (H - 2 * fr) / p['louvres']
    blades = []
    for i in range(p['louvres']):
        pivot = empty(f'{name} blade pivot {i}', root)
        pivot.location = (0, (H - 2 * fr) / 2 - pitch * (i + 0.5), D / 2 - 0.12)
        b = box(f'{name} blade {i}', W - 2 * fr - 0.02, pitch * 0.94, 0.03, STEEL, pivot)
        blades.append(pivot)
    for cx in (-1, 1):
        for cy in (-1, 1):
            bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.04, radius2=0.04, depth=0.02)
            bmesh.ops.translate(bm, vec=Vector((cx * (W / 2 - fr / 2), cy * (H / 2 - fr / 2), D / 2 + 0.01)), verts=bm.verts)
            mesh_obj(name + ' screw', bm, STEEL, root)
    return root, blades

def tube(name, radius, length, mat, segments=64):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=segments, radius1=radius, radius2=radius, depth=length)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'Y'))
    ob = mesh_obj(name, bm, mat)
    s = ob.modifiers.new('Sheet', 'SOLIDIFY'); s.thickness = 0.012
    for p in ob.data.polygons: p.use_smooth = True
    return ob

# ---- build
top = rect_run('Top run', P['topRun'])
bottom = rect_run('Bottom run', P['bottomRun'])
pan, wed = P['sidePanel'], P['wedge']
cut = pan['cut']
panel_pts = [(pan['x'][0], pan['y'][1]), (pan['x'][1], pan['y'][1]), (pan['x'][1], cut[1][1]), (pan['x'][0], cut[0][1])]
panel, panel_c = slab('Side panel', panel_pts, pan['thickness'], BLUE_PANEL)
slope = (cut[1][1] - cut[0][1]) / (cut[1][0] - cut[0][0])
wedge_pts = [(wed['x'][0], cut[0][1] - 0.06), (wed['x'][1], cut[0][1] - 0.06 + slope * (wed['x'][1] - wed['x'][0])), (wed['x'][1], wed['y'][0]), (wed['x'][0], wed['y'][0])]
wedge, wedge_c = slab('Wedge', wedge_pts, wed['thickness'], BLUE_WEDGE)
# the rig poses the panel's / wedge's bounding-box centre: offset the meshes so their own centroid sits right
for ob, c, part in ((panel, panel_c, pan), (wedge, wedge_c, wed)):
    holder = empty(ob.name + ' pose')
    ob.parent = holder
    ob.location = (c[0] - (part['x'][0] + part['x'][1]) / 2, c[1] - (part['y'][0] + part['y'][1]) / 2, 0)
panel_pose, wedge_pose = bpy.data.objects['Side panel pose'], bpy.data.objects['Wedge pose']

el = P['elbow']
J = math.radians(15)  # half of each 30-degree joint
gores = [gore(f'Elbow gore {i + 1}', L, el['diameter'] / 2, 0.0 if i == 0 else J, 0.0 if i == 3 else -J) for i, L in enumerate(rig.SEG)]
collar = tube('Collar', P['collar']['radius'], P['collar']['y'][1] - P['collar']['y'][0], BLUE_COLLAR)
grille_root, blades = grille('Grille', P['grille'])
rails = [[box(f'Rail {r} stage {k}', s, 1.0, s, STEEL, None, bevel=0.002) for k, s in enumerate((0.18, 0.14, 0.10))] for r in range(2)]

# ---- airflow streamlines (curves along the run's centreline, offset inside the section)
path = [Vector(p) for p in rig.airflow_path()]
flow = []
for i in range(28):
    a = i / 28 * math.tau * 3.1
    rr = 0.12 + 0.36 * ((i * 37) % 28) / 28
    cu = bpy.data.curves.new(f'Flow {i}', 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('NURBS'); sp.points.add(len(path) - 1); sp.use_endpoint_u = True; sp.order_u = 4
    for k, p in enumerate(path):
        t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
        n1 = t.orthogonal().normalized(); n2 = t.cross(n1)
        q = p + n1 * math.cos(a) * rr + n2 * math.sin(a) * rr
        sp.points[k].co = (q.x, q.y, q.z, 1)
    cu.bevel_depth = 0.006; cu.bevel_resolution = 2; cu.bevel_factor_mapping_start = cu.bevel_factor_mapping_end = 'SPLINE'
    ob = bpy.data.objects.new(f'Flow {i}', cu); ob.data.materials.append(FLOW); scene.collection.objects.link(ob)
    flow.append((ob, (i * 7 % 28) / 28 * 0.35))

# ---------------------------------------------------------------- camera and light
cam_data = bpy.data.cameras.new('Camera'); cam_data.sensor_fit = 'HORIZONTAL'; cam_data.sensor_width = 36.0
cam = bpy.data.objects.new('Camera', cam_data); scene.collection.objects.link(cam); scene.camera = cam
cam_data.clip_start, cam_data.clip_end = 0.05, 1000

def area(name, size, energy, loc, target=(3.2, -2.6, 0), color=(1, 1, 1), shape='RECTANGLE', size_y=None):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.color = color; d.shape = shape
    d.size = size; d.size_y = size_y or size
    o = bpy.data.objects.new(name, d); o.location = loc; scene.collection.objects.link(o)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y')
    return o

area('Key softbox', 8, 1800, (-2, 7, 9))                      # large overhead-front softbox: long reflections
area('Fill', 6, 350, (-9, -1, 6))
area('Rim left', 0.6, 900, (-6, 2, -7), size_y=9)             # dramatic edge light behind
area('Rim right', 0.6, 900, (13, 1, -7), size_y=9)
strip = area('Strip (blue edge)', 0.15, 0, (3, -2.6, 9), color=srgb('#4D9BFF')[:3], size_y=14)  # Act I edge light
world = bpy.data.worlds.new('Studio'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.0045, 0.005, 1)

# ---------------------------------------------------------------- keys: every frame from the rig
def key_pose(ob, pos, quat, frame):
    ob.rotation_mode = 'QUATERNION'
    ob.location = pos
    ob.rotation_quaternion = (quat[3], quat[0], quat[1], quat[2])
    ob.keyframe_insert('location', frame=frame); ob.keyframe_insert('rotation_quaternion', frame=frame)

frames = OPT['frames'] or range(rig.FRAMES)
for n in range(rig.FRAMES):
    F = rig.pose(n, FMT); t = n / rig.FPS
    key_pose(top, F['topRun']['pos'], F['topRun']['quat'], n)
    key_pose(bottom, F['bottomRun']['pos'], F['bottomRun']['quat'], n)
    key_pose(panel_pose, F['sidePanel']['pos'], F['sidePanel']['quat'], n)
    key_pose(wedge_pose, F['wedge']['pos'], F['wedge']['quat'], n)
    for g, G in zip(gores, F['gores']):
        key_pose(g, G['pos'], G['quat'], n)
    key_pose(collar, F['collar']['pos'], F['collar']['quat'], n)
    key_pose(grille_root, F['grille']['pos'], F['grille']['quat'], n)
    for b in blades:
        b.rotation_euler = (F['louvreAngle'], 0, 0); b.keyframe_insert('rotation_euler', frame=n)
    for (stages, r) in zip(rails, F['rails']):
        h = max(0.0005, r['y1'] - r['y0'])
        for k, s in enumerate(stages):
            s.location = (r['x'], r['y0'] + h * (0.2 + 0.3 * k), r['z']); s.scale = (1, h * 0.4, 1)
            s.hide_render = s.hide_viewport = h < 0.02
            s.keyframe_insert('location', frame=n); s.keyframe_insert('scale', frame=n)
            s.keyframe_insert('hide_render', frame=n); s.keyframe_insert('hide_viewport', frame=n)
    for mat, v in ((BLUE_PANEL, F['blue']['sidePanel']), (BLUE_WEDGE, F['blue']['wedge']), (BLUE_COLLAR, F['blue']['collar'])):
        fac = mat.node_tree.nodes['reveal'].inputs['Fac']; fac.default_value = v; fac.keyframe_insert('default_value', frame=n)
    # airflow heads (2.7 s → 4.6 s), tails 0.16 of the path
    for ob, delay in flow:
        head = (t - 2.7) / 0.9 - delay
        on = 2.7 <= t < 4.6 and head > 0
        ob.data.bevel_factor_end = min(1.0, max(0.0, head)); ob.data.bevel_factor_start = min(1.0, max(0.0, head - 0.16))
        ob.hide_render = not on
        ob.data.keyframe_insert('bevel_factor_end', frame=n); ob.data.keyframe_insert('bevel_factor_start', frame=n)
        ob.keyframe_insert('hide_render', frame=n)
    # Act I: one narrow blue edge light travelling along the duct (0.1–0.9 s), then off
    u = rig.span(t, 0.1, 0.9)
    strip.data.energy = 2500 * math.sin(math.pi * u) if 0 < u < 1 else 0.0
    strip.location = (rig.lerp(-1.0, 7.0, u), -1.9, 6.0)
    strip.data.keyframe_insert('energy', frame=n); strip.keyframe_insert('location', frame=n)
    C = F['camera']
    key_pose(cam, C['pos'], C['quat'], n)
    cam_data.lens = C['focal']; cam_data.keyframe_insert('lens', frame=n)

# every key linear: the rig already carries the easing, frame by frame
for ob in list(bpy.data.objects) + list(bpy.data.cameras) + list(bpy.data.lights) + list(bpy.data.curves) + list(bpy.data.materials):
    ad = getattr(ob, 'animation_data', None) or (getattr(ob, 'node_tree', None) and ob.node_tree.animation_data)
    if ad and ad.action:
        for fc in ad.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT' if fc.data_path.startswith('hide') else 'LINEAR'

# ---------------------------------------------------------------- render settings
r = scene.render
r.resolution_x, r.resolution_y = COMP['width'], COMP['height']
r.film_transparent = False
scene.view_settings.view_transform = 'AgX'
out = Path(OPT['out']); out.mkdir(parents=True, exist_ok=True)
if MODE == 'animatic':
    r.engine = 'BLENDER_WORKBENCH'
    r.resolution_percentage = 50
    scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    r.image_settings.file_format = 'FFMPEG'; r.ffmpeg.format = 'MPEG4'; r.ffmpeg.codec = 'H264'
    r.ffmpeg.constant_rate_factor = 'MEDIUM'
    r.filepath = str(out / f'animatic-blender-{FMT}.mp4')
elif MODE == 'lookdev':
    r.engine = 'BLENDER_EEVEE_NEXT'
    r.resolution_percentage = 50
    r.image_settings.file_format = 'PNG'
    r.filepath = str(out / f'lookdev-{FMT}-')
else:
    r.engine = 'CYCLES'
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    r.resolution_percentage = 100
    r.image_settings.file_format = 'PNG'; r.image_settings.color_depth = '16'
    r.filepath = str(out / f'master-{FMT}' / 'frame-')

if OPT['save']:
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(OPT['save']).resolve()))

if bpy.app.background:
    if MODE == 'animatic' and not OPT['frames']:
        bpy.ops.render.render(animation=True)
    else:
        for n in frames:
            scene.frame_set(n)
            r.filepath = str(out / f'{MODE}-{FMT}-{n:04d}.png') if MODE != 'master' else str(out / f'master-{FMT}' / f'frame-{n:04d}.png')
            bpy.ops.render.render(write_still=True)
print(f'LIBALSTAL v2 scene built: {FMT} · {MODE} · {len(bpy.data.objects)} objects')
