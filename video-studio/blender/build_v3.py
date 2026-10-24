"""LIBALSTAL V3 — photoreal production scene (Blender 4.2 LTS, Cycles).

Builds the emblem from blender/logo_parts.json in the structure of v3/glb-contract.json (part empties at the
mechanical pivots, contract names, custom property 'libalstal', contract material names), with fabrication detail
(cross-broken sheet panels, Pittsburgh corner seams, TDF-style flange frames, corner cleats, M6 bolts with washers,
rivets, mitred gores with rolled seam beads, outlet flange, gasket, louvred grille on a plenum box), physically
based procedural materials, a dark studio with large softboxes and rims, four still cameras + an orthographic
front camera for the comparison with the official PNG, and the illustrative airflow.

Frame: the emblem root holds the contract's logoFrame (logo x right, y up, z toward the viewer, metres,
1 PNG px = 1 mm, origin = PNG top-left). Blender is Z-up, so the root is turned +90 degrees about X; the glTF
exporter's Y-up conversion turns that back into the contract frame.

Run from the MCP connection with PARTS_JSON and SEG defined in the globals (see v3/blender/README.md),
or:  blender --background --python build_v3.py -- PARTS.json OUT.blend
It creates a NEW scene 'LIBALSTAL_V3' and never touches other scenes or files.
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

G = globals()
if 'PARTS_JSON' not in G:
    a = sys.argv[sys.argv.index('--') + 1:]
    PARTS_JSON = open(a[0]).read()
    SAVE_TO = a[1] if len(a) > 1 else None
else:
    SAVE_TO = G.get('SAVE_TO')
P = json.loads(PARTS_JSON)['parts']
SEG = G.get('SEG') or [0.342975, 0.68595, 0.68595, 0.342975]
JOINT = math.radians(30)
S = 0.1                                  # logo units -> metres (1 unit = 100 px = 0.1 m)
FLOOR_Y = -5.34 * S                      # logo y of the studio floor (feet are 25 mm)

# ---------------------------------------------------------------- scene
if 'LIBALSTAL_V3' in bpy.data.scenes:
    raise SystemExit('scene LIBALSTAL_V3 already exists in this file: open a fresh file or rename it first')
scene = bpy.data.scenes.new('LIBALSTAL_V3')
try:
    bpy.context.window_manager.windows[0].scene = scene
except Exception:
    pass
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'MILLIMETERS'

def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(c)
    return c

C_EMBLEM, C_AIR, C_STAGE, C_LIGHT, C_CAM = (collection(n) for n in ('EMBLEM', 'AIRFLOW', 'STAGE', 'LIGHTS', 'CAMERAS'))

# ---------------------------------------------------------------- materials
def lin(c):
    return tuple((x / 255) / 12.92 if x / 255 <= 0.04045 else ((x / 255 + 0.055) / 1.055) ** 2.4 for x in c)

def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    return m, nt.nodes, nt.links, nt.nodes['Principled BSDF']

def coords(n, l, scale=(1, 1, 1)):
    tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = scale
    l.new(tc.outputs['Object'], mp.inputs['Vector'])
    return mp.outputs['Vector']

def bump_chain(n, l, bsdf, sources):
    """sources: list of (height_socket, strength, distance) chained into one normal."""
    normal = None
    for h, s, d in sources:
        b = n.new('ShaderNodeBump'); b.inputs['Strength'].default_value = s; b.inputs['Distance'].default_value = d
        l.new(h, b.inputs['Height'])
        if normal is not None:
            l.new(normal, b.inputs['Normal'])
        normal = b.outputs['Normal']
    l.new(normal, bsdf.inputs['Normal'])

def mat_galvanised(name, base=(0.56, 0.58, 0.61), rough=(0.29, 0.345), cell=150.0):
    """Hot-dip galvanised sheet: zinc spangle = Voronoi crystals with their own sheen and roughness,
    feathered crystal boundaries, very fine surface grain."""
    m, n, l, b = new_mat(name)
    b.inputs['Metallic'].default_value = 1.0
    v = coords(n, l)
    vor = n.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = cell
    l.new(v, vor.inputs['Vector'])
    sep = n.new('ShaderNodeSeparateColor'); l.new(vor.outputs['Color'], sep.inputs['Color'])
    # per-crystal brightness 0.9..1.04 of the base
    mr = n.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.975; mr.inputs['To Max'].default_value = 1.015
    l.new(sep.outputs['Red'], mr.inputs['Value'])
    mix = n.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
    mix.inputs['A'].default_value = (*base, 1)
    l.new(mr.outputs['Result'], mix.inputs['B']); l.new(mix.outputs['Result'], b.inputs['Base Color'])
    # per-crystal roughness
    rr = n.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value, rr.inputs['To Max'].default_value = rough
    l.new(sep.outputs['Green'], rr.inputs['Value'])
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 9.0; noise.inputs['Detail'].default_value = 4
    l.new(v, noise.inputs['Vector'])
    add = n.new('ShaderNodeMath'); add.operation = 'MULTIPLY_ADD'
    l.new(noise.outputs['Fac'], add.inputs[0]); add.inputs[1].default_value = 0.10; add.inputs[2].default_value = -0.05
    tot = n.new('ShaderNodeMath'); tot.operation = 'ADD'; tot.use_clamp = True
    l.new(rr.outputs['Result'], tot.inputs[0]); l.new(add.outputs['Value'], tot.inputs[1])
    l.new(tot.outputs['Value'], b.inputs['Roughness'])
    edge = n.new('ShaderNodeTexVoronoi'); edge.feature = 'DISTANCE_TO_EDGE'; edge.inputs['Scale'].default_value = cell
    l.new(v, edge.inputs['Vector'])
    grain = n.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value = 1400.0; grain.inputs['Detail'].default_value = 2
    l.new(v, grain.inputs['Vector'])
    bump_chain(n, l, b, [(edge.outputs['Distance'], 0.025, 0.0003), (grain.outputs['Fac'], 0.02, 0.0002)])
    return m

def mat_brushed(name, base=(0.78, 0.79, 0.80), rough=0.20):
    """Brushed stainless: streaks along local X (stretched noise in roughness and bump), slight anisotropy."""
    m, n, l, b = new_mat(name)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Base Color'].default_value = (*base, 1)
    v = coords(n, l, (3.0, 900.0, 900.0))
    streak = n.new('ShaderNodeTexNoise'); streak.inputs['Scale'].default_value = 1.0; streak.inputs['Detail'].default_value = 8
    streak.inputs['Roughness'].default_value = 0.65
    l.new(v, streak.inputs['Vector'])
    mr = n.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = rough - 0.06; mr.inputs['To Max'].default_value = rough + 0.08
    l.new(streak.outputs['Fac'], mr.inputs['Value']); l.new(mr.outputs['Result'], b.inputs['Roughness'])
    b.inputs['Anisotropic'].default_value = 0.35
    blot = n.new('ShaderNodeTexNoise'); blot.inputs['Scale'].default_value = 6.0
    l.new(coords(n, l), blot.inputs['Vector'])
    bump_chain(n, l, b, [(streak.outputs['Fac'], 0.06, 0.0002), (blot.outputs['Fac'], 0.02, 0.0005)])
    return m

def mat_paint(name, srgb=(1, 75, 172)):
    """Powder-coated sheet in the official LIBALSTAL blue (sampled from the official PNG), satin with a thin coat
    and fine orange-peel texture."""
    m, n, l, b = new_mat(name)
    b.inputs['Base Color'].default_value = (*lin(srgb), 1)
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Roughness'].default_value = 0.36
    b.inputs['Coat Weight'].default_value = 0.35
    b.inputs['Coat Roughness'].default_value = 0.12
    peel = n.new('ShaderNodeTexNoise'); peel.inputs['Scale'].default_value = 260.0; peel.inputs['Detail'].default_value = 3
    l.new(coords(n, l), peel.inputs['Vector'])
    bump_chain(n, l, b, [(peel.outputs['Fac'], 0.06, 0.0003)])
    return m

def mat_simple(name, base, metallic, rough, bump=0.0):
    m, n, l, b = new_mat(name)
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    if bump:
        t = n.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = 900.0
        l.new(coords(n, l), t.inputs['Vector'])
        bump_chain(n, l, b, [(t.outputs['Fac'], bump, 0.0003)])
    return m

def mat_floor(name):
    """Dark polished concrete: low, uneven roughness so it reflects the softboxes softly."""
    m, n, l, b = new_mat(name)
    v = coords(n, l)
    t = n.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = 2.5; t.inputs['Detail'].default_value = 9
    l.new(v, t.inputs['Vector'])
    c = n.new('ShaderNodeMapRange'); c.inputs['To Min'].default_value = 0.008; c.inputs['To Max'].default_value = 0.016
    l.new(t.outputs['Fac'], c.inputs['Value']); l.new(c.outputs['Result'], b.inputs['Base Color'])
    r = n.new('ShaderNodeMapRange'); r.inputs['To Min'].default_value = 0.14; r.inputs['To Max'].default_value = 0.32
    l.new(t.outputs['Fac'], r.inputs['Value']); l.new(r.outputs['Result'], b.inputs['Roughness'])
    f = n.new('ShaderNodeTexNoise'); f.inputs['Scale'].default_value = 300.0
    l.new(v, f.inputs['Vector'])
    bump_chain(n, l, b, [(f.outputs['Fac'], 0.04, 0.001)])
    return m

def mat_emit(name, rgb, strength, fade=False):
    """Emission; with fade=True it fades out along the tube's U (0 at the louvre -> 1 at the tail)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    n.remove(n['Principled BSDF'])
    e = n.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*rgb, 1); e.inputs['Strength'].default_value = strength
    out = n['Material Output']
    if not fade:
        l.new(e.outputs['Emission'], out.inputs['Surface']); return m
    uv = n.new('ShaderNodeUVMap')
    sep = n.new('ShaderNodeSeparateXYZ'); l.new(uv.outputs['UV'], sep.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')            # head soft-in, long tail fade-out
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    e1 = ramp.color_ramp.elements.new(0.08); e1.color = (1, 1, 1, 1)
    e2 = ramp.color_ramp.elements.new(0.32); e2.color = (0.28, 0.28, 0.28, 1)
    l.new(sep.outputs['X'], ramp.inputs['Fac'])
    tr = n.new('ShaderNodeBsdfTransparent'); mx = n.new('ShaderNodeMixShader')
    # travelling dashes along the stream (u * 14, 60 % duty, soft edges): reads as flow direction, not as wire
    dash = n.new('ShaderNodeMath'); dash.operation = 'MULTIPLY'; dash.inputs[1].default_value = 14.0
    l.new(sep.outputs['X'], dash.inputs[0])
    fr_ = n.new('ShaderNodeMath'); fr_.operation = 'FRACT'; l.new(dash.outputs['Value'], fr_.inputs[0])
    win = n.new('ShaderNodeMapRange'); win.interpolation_type = 'SMOOTHSTEP'
    win.inputs['From Min'].default_value, win.inputs['From Max'].default_value = 0.0, 0.25
    win.inputs['To Min'].default_value, win.inputs['To Max'].default_value = 0.25, 1.0
    l.new(fr_.outputs['Value'], win.inputs['Value'])
    dm = n.new('ShaderNodeMath'); dm.operation = 'MULTIPLY'
    l.new(ramp.outputs['Color'], dm.inputs[0]); l.new(win.outputs['Result'], dm.inputs[1])
    l.new(dm.outputs['Value'], mx.inputs['Fac']); l.new(tr.outputs['BSDF'], mx.inputs[1]); l.new(e.outputs['Emission'], mx.inputs[2])
    l.new(mx.outputs['Shader'], out.inputs['Surface'])
    m.blend_method = 'BLEND'
    return m

M = {
    'galvanised': mat_galvanised('galvanised'),
    'galvanised_flange': mat_galvanised('galvanised_flange', (0.52, 0.54, 0.57), (0.31, 0.38), 240.0),
    'stainless_brushed': mat_brushed('stainless_brushed'),
    'ral5017_coat': mat_paint('ral5017_coat'),
    'gasket': mat_simple('gasket', (0.012, 0.012, 0.013), 0.0, 0.72, 0.05),
    'interior': mat_simple('interior', (0.035, 0.037, 0.04), 0.6, 0.55),
}
M_FLOOR = mat_floor('studio_floor')
M_WALL = mat_simple('studio_wall', (0.012, 0.013, 0.015), 0.0, 0.85, 0.02)
M_RUBBER = mat_simple('mount_rubber', (0.015, 0.015, 0.016), 0.0, 0.8, 0.05)
M_FLOW = mat_emit('airflow_illustrative', (0.10, 0.42, 1.0), 4.0, fade=True)
M_FLOW_HALO = mat_emit('airflow_halo', (0.10, 0.42, 1.0), 0.35, fade=True)
M_PRACT_W = mat_emit('practical_white', (0.85, 0.9, 1.0), 0.9)
M_PRACT_B = mat_emit('practical_blue', (0.12, 0.38, 1.0), 0.9)

# ---------------------------------------------------------------- mesh helpers (part-local logo-frame metres)
def link(ob, coll):
    coll.objects.link(ob)
    return ob

def mesh_obj(name, bm, mat, parent=None, coll=None, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(M[mat] if isinstance(mat, str) else mat)
    ob = link(bpy.data.objects.new(name, me), coll or C_EMBLEM)
    if parent:
        ob.parent = parent
    return ob

def empty(name, loc, parent=None, coll=None, size=0.03):
    e = link(bpy.data.objects.new(name, None), coll or C_EMBLEM)
    e.empty_display_size = size; e.empty_display_type = 'PLAIN_AXES'
    if parent:
        e.parent = parent
    e.location = loc
    return e

def bevel(ob, w, segs=2, angle=40):
    md = ob.modifiers.new('Bevel', 'BEVEL'); md.width = w; md.segments = segs
    md.limit_method = 'ANGLE'; md.angle_limit = math.radians(angle); md.harden_normals = False
    return ob

def solidify(ob, t, offset=-1.0):
    md = ob.modifiers.new('Sheet', 'SOLIDIFY'); md.thickness = t; md.offset = offset; md.use_even_offset = True
    return ob

def bm_box(size, at=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return bm

def box(name, size, at, mat, parent, bev=0.0012, segs=2):
    ob = mesh_obj(name, bm_box(size, at), mat, parent)
    return bevel(ob, bev, segs) if bev else ob

def cyl_bm(r, h, segs=24, axis='Z', at=(0, 0, 0), caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r, radius2=r, depth=h)
    rot = {'Z': Matrix(), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 3, 'X')}[axis]
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return bm

def sweep_bm(points, radius, closed=False, segs=10, uv=True):
    """Tube of `radius` along points (parallel-transport frames, no twist). UV u = 0..1 along the length."""
    bm = bmesh.new(); n = len(points); pts = [Vector(p) for p in points]
    tang = []
    for i in range(n):
        a = pts[(i - 1) % n] if (closed or i > 0) else pts[i]
        b = pts[(i + 1) % n] if (closed or i < n - 1) else pts[i]
        tang.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tang[0].z) < 0.9 else Vector((1, 0, 0))
    n1 = tang[0].cross(ref).normalized()
    rings = []
    for i, (p, t) in enumerate(zip(pts, tang)):
        n1 = (n1 - t * n1.dot(t)).normalized(); n2 = t.cross(n1)
        rings.append([bm.verts.new(p + (n1 * math.cos(k / segs * math.tau) + n2 * math.sin(k / segs * math.tau)) * radius) for k in range(segs)])
    lay = bm.loops.layers.uv.new('UVMap') if uv else None
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            f = bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
            if lay:
                us = (i / (n - 1), i / (n - 1), (i + 1) / (n - 1), (i + 1) / (n - 1))
                vs = (k / segs, (k + 1) / segs, (k + 1) / segs, k / segs)
                for loop, u, v in zip(f.loops, us, vs):
                    loop[lay].uv = (u, v)
    return bm

def hex_bolt(name, parent, at, normal, af=0.010, head=0.004, washer=0.012):
    """M6 hex bolt head + washer (zinc-plated steel look via stainless_brushed), seated on a face whose
    outward normal is `normal` (one of ±X, ±Y, ±Z)."""
    nrm = Vector(normal); rot = nrm.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bm = cyl_bm(washer / 2, 0.0012, 20, at=(0, 0, 0.0006))
    h = bmesh.new(); bmesh.ops.create_cone(h, cap_ends=True, segments=6, radius1=af / math.sqrt(3), radius2=af / math.sqrt(3), depth=head)
    bmesh.ops.translate(h, vec=Vector((0, 0, 0.0012 + head / 2)), verts=h.verts)
    me = bpy.data.meshes.new('tmp'); h.to_mesh(me); h.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)) @ rot, verts=bm.verts)
    return bevel(mesh_obj(name, bm, 'stainless_brushed', parent), 0.0005, 1, 30)

def rivet(name, parent, at, normal, r=0.0022):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=5, radius=r)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context='VERTS')
    bmesh.ops.scale(bm, vec=Vector((1, 1, 0.55)), verts=bm.verts)
    rot = Vector(normal).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)) @ rot, verts=bm.verts)
    return mesh_obj(name, bm, 'galvanised_flange', parent, smooth=True)

def tag(ob, part, dof, explode, axis=None):
    d = {'part': part, 'dof': dof, 'explode': [round(v * S, 5) for v in explode]}
    if axis:
        d['axis'] = list(axis)
    ob['libalstal'] = d
    return ob

# ---------------------------------------------------------------- root (contract logoFrame)
root = empty('LIBALSTAL_emblem', (0, 0, 0), size=0.1)
root.rotation_euler = (math.pi / 2, 0, 0)

# ---------------------------------------------------------------- rectangular runs
def xbreak_panel(name, a, b, mat, parent, matrix, bulge=0.0016, t=0.0008):
    bm = bmesh.new()
    c = bm.verts.new((0, 0, bulge))
    q = [bm.verts.new(v) for v in ((-a / 2, -b / 2, 0), (a / 2, -b / 2, 0), (a / 2, b / 2, 0), (-a / 2, b / 2, 0))]
    for i in range(4):
        bm.faces.new((q[i], q[(i + 1) % 4], c))
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return solidify(mesh_obj(name, bm, mat, parent), t)

def rect_run(name, p, dof, explode):
    cx, cy, D = (p['x'][0] + p['x'][1]) / 2 * S, (p['body'][0] + p['body'][1]) / 2 * S, p['depth'] * S
    g = empty(name, (cx, cy, -D / 2), root)
    L, Hb, fw = (p['x'][1] - p['x'][0]) * S, (p['body'][1] - p['body'][0]) * S, p['flange'] * S
    lip_t, lip_b = (p['y'][1] - p['body'][1]) * S, (p['body'][0] - p['y'][0]) * S
    lip_z = (lip_t + lip_b) / 2
    Lb = L - 0.004
    R = Matrix.Rotation
    xbreak_panel(f'{name}_front', Lb, Hb, 'galvanised', g, Matrix.Translation((0, 0, D / 2)))
    xbreak_panel(f'{name}_back', Lb, Hb, 'galvanised', g, Matrix.Translation((0, 0, -D / 2)) @ R(math.pi, 4, 'Y'))
    xbreak_panel(f'{name}_top', Lb, D, 'galvanised', g, Matrix.Translation((0, Hb / 2, 0)) @ R(-math.pi / 2, 4, 'X'))
    xbreak_panel(f'{name}_bottom', Lb, D, 'galvanised', g, Matrix.Translation((0, -Hb / 2, 0)) @ R(math.pi / 2, 4, 'X'))
    for k, (y, z) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):           # Pittsburgh corner seams
        box(f'{name}_seam_{k}', (Lb, 0.0034, 0.0034), (0, y * Hb / 2, z * D / 2), 'galvanised', g, 0.0013, 3)
    for s, end in ((-1, 'a'), (1, 'b')):
        x = s * (L - fw) / 2
        fl = f'{name}_flange_{end}'
        box(f'{fl}_top', (fw, lip_t, D + 2 * lip_z), (x, Hb / 2 + lip_t / 2, 0), 'galvanised_flange', g)
        box(f'{fl}_bottom', (fw, lip_b, D + 2 * lip_z), (x, -Hb / 2 - lip_b / 2, 0), 'galvanised_flange', g)
        box(f'{fl}_front', (fw, Hb, lip_z), (x, 0, D / 2 + lip_z / 2), 'galvanised_flange', g)
        box(f'{fl}_back', (fw, Hb, lip_z), (x, 0, -D / 2 - lip_z / 2), 'galvanised_flange', g)
        box(f'{fl}_endplate', (0.0015, Hb + lip_t + lip_b, D + 2 * lip_z), (s * (L / 2 - 0.00075), (lip_t - lip_b) / 2, 0), 'galvanised_flange', g, 0.0005, 1)
        # corner cleats + bolts on the front and back faces, as on the logo
        for cyy, ly in ((1, lip_t), (-1, lip_b)):
            for czz in (1, -1):
                cy_ = cyy * (Hb / 2 + ly / 2); cz_ = czz * (D / 2 + lip_z / 2)
                box(f'fastener_{name}_{end}_cleat_{cyy}_{czz}', (fw * 0.62, ly * 1.08, lip_z * 1.08), (x, cy_, cz_), 'stainless_brushed', g, 0.0008)
                hex_bolt(f'fastener_{name}_{end}_bolt_{cyy}_{czz}', g, (x, cy_, czz * (D / 2 + lip_z * 1.04)), (0, 0, czz))
        # rivet rows on the duct body next to each flange
        xr = s * (L / 2 - fw - 0.009)
        nY = max(2, int(Hb / 0.032)); nZ = max(2, int(D / 0.032))
        for i in range(nY):
            yy = -Hb / 2 + Hb * (i + 0.5) / nY
            rivet(f'fastener_{name}_{end}_rv_f{i}', g, (xr, yy, D / 2 + 0.0016), (0, 0, 1))
            rivet(f'fastener_{name}_{end}_rv_b{i}', g, (xr, yy, -D / 2 - 0.0016), (0, 0, -1))
        for i in range(nZ):
            zz = -D / 2 + D * (i + 0.5) / nZ
            rivet(f'fastener_{name}_{end}_rv_t{i}', g, (xr, Hb / 2 + 0.0016, zz), (0, 1, 0))
            rivet(f'fastener_{name}_{end}_rv_u{i}', g, (xr, -Hb / 2 - 0.0016, zz), (0, -1, 0))
    return tag(g, name, dof, explode, [0, 1, 0])

top = rect_run('top_run', P['topRun'], 'slide', [0, 1.4, 0])
bottom = rect_run('bottom_run', P['bottomRun'], 'fixed', [0, -0.6, 0])

# ---------------------------------------------------------------- blue diffuser panel and wedge (painted sheet boxes)
DEPTH_BLUE = P['topRun']['depth'] * S

def blue_box(name, outline, pivot, dof, explode, axis):
    g = empty(name, (pivot[0] * S, pivot[1] * S, 0), root)
    bm = bmesh.new()
    vs = [bm.verts.new(((x - pivot[0]) * S, (y - pivot[1]) * S, 0)) for x, y in outline]
    f = bm.faces.new(vs)
    if f.normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=Vector((0, 0, -DEPTH_BLUE)), verts=[v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(f'{name}_sheet', bm, 'ral5017_coat', g)
    bevel(ob, 0.0025, 3, 30)
    ob.modifiers.new('Weighted', 'WEIGHTED_NORMAL')
    return tag(g, name, dof, explode, axis)

Pn, Wd = P['sidePanel'], P['wedge']
panel = blue_box('side_panel', Pn['outline'], (Pn['x'][1], (Pn['y'][0] + Pn['y'][1]) / 2), 'hinge', [-1.6, 0, 0.8], [0, 1, 0])
ph = (Pn['y'][1] - Pn['y'][0]) * S
for k, yy in enumerate((ph / 2 - 0.06, -ph / 2 + 0.07)):                 # piano-hinge knuckles on the hinge line
    mesh_obj(f'side_panel_hinge_{k + 1}', cyl_bm(0.0045, 0.034, 20, 'Y', (0.0005, yy, 0.0035)), 'stainless_brushed', panel, smooth=True)
    mesh_obj(f'side_panel_hinge_pin_{k + 1}', cyl_bm(0.0016, 0.038, 12, 'Y', (0.0005, yy, 0.0035)), 'stainless_brushed', panel, smooth=True)
wedge = blue_box('wedge', Wd['outline'], ((Wd['x'][0] + Wd['x'][1]) / 2, (Wd['y'][0] + Wd['y'][1]) / 2), 'slide', [-1.2, -0.9, 0.6], [-0.8, 0.6, 0])

# ---------------------------------------------------------------- elbow: 4 mitred gores, chained, rolled seam beads
E = P['elbow']; r = E['diameter'] / 2 * S
ZC = -P['topRun']['depth'] / 2 * S                     # round parts sit on the rectangular runs' centreline
TOPC = ((P['topRun']['x'][0] + P['topRun']['x'][1]) / 2 * S, (P['topRun']['body'][0] + P['topRun']['body'][1]) / 2 * S, ZC)

def gore_bm(L, half, mitre_start, mitre_end, n=96, rings=8):
    t = math.tan(half); bm = bmesh.new(); grid = []
    for j in range(rings + 1):
        u = j / rings; row = []
        for i in range(n):
            a = i / n * math.tau; y, z = r * math.cos(a), r * math.sin(a)
            x0 = -y * t if mitre_start else 0.0
            x1 = L + (y * t if mitre_end else 0.0)
            row.append(bm.verts.new((x0 + (x1 - x0) * u, y, z)))
        grid.append(row)
    for j in range(rings):
        for i in range(n):
            bm.faces.new((grid[j][i], grid[j][(i + 1) % n], grid[j + 1][(i + 1) % n], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def seam_points(x_at, half, sign, rr, n=96):
    t = math.tan(half)
    return [(x_at + sign * rr * math.cos(i / n * math.tau) * t, rr * math.cos(i / n * math.tau), rr * math.sin(i / n * math.tau)) for i in range(n)]

parent = top
at = Vector((E['start'][0] * S - TOPC[0], E['start'][1] * S - TOPC[1], 0.0))
gores = []
for k, L in enumerate(SEG):
    L *= S
    g = empty(f'elbow_gore_{k + 1}', at, parent)
    if k > 0:
        g.rotation_euler = (0, 0, -JOINT)
    ob = mesh_obj(f'elbow_gore_{k + 1}_sheet', gore_bm(L, JOINT / 2, k > 0, k < len(SEG) - 1), 'stainless_brushed', g, smooth=True)
    solidify(ob, 0.0008)
    inner = mesh_obj(f'elbow_gore_{k + 1}_inner', gore_bm(L, JOINT / 2, k > 0, k < len(SEG) - 1, 48, 2), 'interior', g, smooth=True)
    inner.scale = (1, 0.985, 0.985)
    if k > 0:                                                    # rolled bead on the seam with the previous gore
        mesh_obj(f'elbow_gore_{k + 1}_bead', sweep_bm(seam_points(0.0, JOINT / 2, -1, r + 0.0009), 0.0019, True, 10, False), 'stainless_brushed', g, smooth=True)
    tag(g, f'elbow_gore_{k + 1}', 'fixed' if k == 0 else 'hinge', [0.6, 0.3, 0] if k == 0 else [0.35, 0.25, 0], None if k == 0 else [0, 0, 1])
    gores.append(g); parent = g; at = Vector((L, 0, 0))
g1 = gores[0]

def annulus(name, r_in, r_out, w, x0, mat, parent, n=96, axis='X'):
    """Flat ring (flange / gasket) of width w along its axis, starting at x0."""
    bm = bmesh.new(); rings = []
    for x in (x0, x0 + w):
        for rad in (r_in, r_out):
            rings.append([bm.verts.new((x, rad * math.cos(i / n * math.tau), rad * math.sin(i / n * math.tau))) for i in range(n)])
    a_in, a_out, b_in, b_out = rings
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a_in[j], a_out[j], a_out[i], a_in[i]))
        bm.faces.new((b_in[i], b_out[i], b_out[j], b_in[j]))
        bm.faces.new((a_out[i], b_out[i], b_out[j], a_out[j]))
        bm.faces.new((a_in[j], b_in[j], b_in[i], a_in[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Z'))
    return bevel(mesh_obj(name, bm, mat, parent, smooth=True), 0.0006, 1, 50)

# gasket ring + spigot collar where gore 1 leaves the top run's end plate
annulus('elbow_gore_1_gasket', r - 0.0005, r + 0.003, 0.0022, 0.0, 'gasket', g1)
annulus('elbow_gore_1_spigot', r, r + 0.0028, 0.014, 0.0022, 'galvanised_flange', g1)
# outlet flange on gore 4 (the ring in the logo above the collar), 8 M5 bolts on its top face
g4 = gores[3]; L4 = SEG[3] * S
fl_w = (E['exitFlange']['y'][1] - E['exitFlange']['y'][0]) * S
fl_r = (E['exitFlange']['x'][1] - E['exitFlange']['x'][0]) / 2 * S
annulus('elbow_gore_4_flange', r - 0.0008, fl_r, fl_w, L4 - fl_w + 0.0004, 'galvanised_flange', g4)
for i in range(8):
    a = (i + 0.5) / 8 * math.tau; rb = (r + fl_r) / 2 + 0.0008
    hex_bolt(f'fastener_elbow_flange_bolt_{i}', g4, (L4 - fl_w + 0.0004, rb * math.cos(a), rb * math.sin(a)), (-1, 0, 0), af=0.008, head=0.0035, washer=0.0095)

# ---------------------------------------------------------------- collar (blue sleeve over the outlet)
Cl = P['collar']; cl_len = (Cl['y'][1] - Cl['y'][0]) * S; cr = Cl['radius'] * S
collar = empty('collar', (Cl['axisX'] * S, (Cl['y'][0] + Cl['y'][1]) / 2 * S, ZC), root)
sleeve = mesh_obj('collar_sleeve', cyl_bm(cr, cl_len, 128, 'Y', caps=False), 'ral5017_coat', collar, smooth=True)
solidify(sleeve, 0.001)
for k, yy in (('top', cl_len / 2 - 0.003), ('bottom', -cl_len / 2 + 0.003)):
    mesh_obj(f'collar_bead_{k}', sweep_bm([(cr * math.cos(i / 128 * math.tau), yy, cr * math.sin(i / 128 * math.tau)) for i in range(128)], 0.003, True, 12, False), 'ral5017_coat', collar, smooth=True)
mesh_obj('collar_rib', sweep_bm([(cr * math.cos(i / 128 * math.tau), 0.0, cr * math.sin(i / 128 * math.tau)) for i in range(128)], 0.0016, True, 10, False), 'ral5017_coat', collar, smooth=True)
tag(collar, 'collar', 'slide', [1.2, 0.4, 0], [0, 1, 0])

# ---------------------------------------------------------------- grille: plenum box + stainless louvred face
Gr = P['grille']
W, H, fr = (Gr['x'][1] - Gr['x'][0]) * S, (Gr['y'][1] - Gr['y'][0]) * S, Gr['frame'] * S
Z_FRONT, Z_BACK = ZC + 0.09, ZC - 0.09                # plenum 180 mm deep, centred on the round parts' axis
Dg = Z_FRONT - Z_BACK
grille = empty('grille', ((Gr['x'][0] + Gr['x'][1]) / 2 * S, (Gr['y'][0] + Gr['y'][1]) / 2 * S, (Z_FRONT + Z_BACK) / 2), root)
R = Matrix.Rotation
xbreak_panel('grille_plenum_top', W - 0.002, Dg - 0.002, 'galvanised', grille, Matrix.Translation((0, H / 2, 0)) @ R(-math.pi / 2, 4, 'X'), 0.001)
xbreak_panel('grille_plenum_bottom', W - 0.002, Dg - 0.002, 'galvanised', grille, Matrix.Translation((0, -H / 2, 0)) @ R(math.pi / 2, 4, 'X'), 0.001)
xbreak_panel('grille_plenum_left', Dg - 0.002, H - 0.002, 'galvanised', grille, Matrix.Translation((-W / 2, 0, 0)) @ R(-math.pi / 2, 4, 'Y'), 0.001)
xbreak_panel('grille_plenum_right', Dg - 0.002, H - 0.002, 'galvanised', grille, Matrix.Translation((W / 2, 0, 0)) @ R(math.pi / 2, 4, 'Y'), 0.001)
xbreak_panel('grille_plenum_back', W - 0.002, H - 0.002, 'galvanised', grille, Matrix.Translation((0, 0, -Dg / 2)) @ R(math.pi, 4, 'Y'), 0.001)
for k, (y, z) in enumerate(((1, -1), (-1, -1))):
    box(f'grille_seam_{k}', (W, 0.0034, 0.0034), (0, y * H / 2, z * Dg / 2), 'galvanised', grille, 0.0013, 3)
for k, (x, z) in enumerate(((1, -1), (-1, -1))):
    box(f'grille_seam_v{k}', (0.0034, H, 0.0034), (x * W / 2, 0, z * Dg / 2), 'galvanised', grille, 0.0013, 3)
box('grille_interior', (W - 0.006, H - 0.006, 0.002), (0, 0, -Dg / 2 + 0.006), 'interior', grille, 0)
fz = Dg / 2 + 0.004                                          # stainless face frame stands 10 mm proud
for nm, (w, h, x, y) in (('top', (W + 0.004, fr, 0, (H - fr) / 2)), ('bottom', (W + 0.004, fr, 0, -(H - fr) / 2)),
                         ('left', (fr, H - 2 * fr + 0.0002, -(W - fr) / 2, 0)), ('right', (fr, H - 2 * fr + 0.0002, (W - fr) / 2, 0))):
    box(f'grille_frame_{nm}', (w, h, 0.012), (x, y, fz), 'stainless_brushed', grille, 0.0016, 3)
for cx_ in (-1, 1):
    for cy_ in (-1, 1):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=6, radius=0.0036)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context='VERTS')
        bmesh.ops.scale(bm, vec=Vector((1, 1, 0.45)), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((cx_ * (W / 2 - fr / 2), cy_ * (H / 2 - fr / 2), fz + 0.006)), verts=bm.verts)
        mesh_obj(f'fastener_grille_screw_{cx_}_{cy_}', bm, 'stainless_brushed', grille, smooth=True)
pitch = (H - 2 * fr) / Gr['louvres']
LOUVRE_REST = math.radians(-35)
for i in range(Gr['louvres']):
    lv = empty(f'louvre_{i + 1}', (0, (H - 2 * fr) / 2 - pitch * (i + 0.5), fz - 0.004), grille, size=0.01)
    lv.rotation_euler = (LOUVRE_REST, 0, 0)
    blade = box(f'louvre_{i + 1}_blade', (W - 2 * fr - 0.003, pitch * 1.18, 0.0012), (0, 0, 0), 'stainless_brushed', lv, 0.0005, 2)
    box(f'louvre_{i + 1}_hem', (W - 2 * fr - 0.003, 0.0026, 0.0026), (0, -pitch * 0.59, 0.0007), 'stainless_brushed', lv, 0.0011, 3)
    tag(lv, f'louvre_{i + 1}', 'hinge', [0, 0, 0.25 + 0.06 * i], [1, 0, 0])
annulus('grille_spigot', cr - 0.004, cr + 0.002, 0.012, H / 2 - 0.001, 'galvanised_flange', grille, 128, 'Y')
tag(grille, 'grille', 'slide', [1.6, -0.5, 0], [1, 0, 0])

# ---------------------------------------------------------------- stage: floor, cyclorama, anti-vibration mounts
def logo_to_world(x, y, z):
    return Vector((x, -z, y))

floor_z = FLOOR_Y
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4.0)
fl = mesh_obj('stage_floor', bm, M_FLOOR, None, C_STAGE); fl.location = (0.6, 1.0, floor_z)
pts = [(-6, 3.0 - 1.0 * math.cos(a), floor_z + 1.0 - 1.0 * math.sin(a)) for a in [math.radians(d) for d in range(270, 361, 10)]]
bm = bmesh.new()
rows = [[bm.verts.new((x, y, z)) for (_, y, z) in pts] for x in (-6, 7)]
for i in range(len(pts) - 1):
    bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
top_y, top_z = pts[-1][1], pts[-1][2]
v0, v1 = rows[0][-1], rows[1][-1]
w0, w1 = bm.verts.new((-6, top_y, top_z + 4)), bm.verts.new((7, top_y, top_z + 4))
bm.faces.new((v0, v1, w1, w0))
mesh_obj('stage_cyc', bm, M_WALL, None, C_STAGE, smooth=True)
for k, (x, y, zl) in enumerate(((1.6, -5.09, -0.6), (4.1, -5.09, -0.6), (0.45, -5.09, -0.6), (4.85, -5.07, ZC / S), (6.35, -5.07, ZC / S))):
    h = (y - FLOOR_Y / S) * S
    w = logo_to_world(x * S, FLOOR_Y, zl * S)
    plate = mesh_obj(f'mount_{k}_base', bm_box((0.05, 0.05, 0.003), (0, 0, 0.0015)), M['galvanised_flange'], None, C_STAGE)
    rub = mesh_obj(f'mount_{k}_rubber', cyl_bm(0.014, h - 0.006, 24, 'Z', (0, 0, 0.003 + (h - 0.006) / 2)), M_RUBBER, None, C_STAGE, smooth=True)
    topp = mesh_obj(f'mount_{k}_top', bm_box((0.04, 0.04, 0.003), (0, 0, h - 0.0015)), M['galvanised_flange'], None, C_STAGE)
    for o in (plate, rub, topp):
        o.location = w; bevel(o, 0.0008, 2)
# background practicals: thin light strips far behind (defocused in the shots), mostly cool white, one blue
for k, (x, col) in enumerate(((-1.6, M_PRACT_W), (-0.5, M_PRACT_W), (1.9, M_PRACT_B), (2.9, M_PRACT_W))):
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=Vector((0.03, 1.0, 1.0)), verts=bm.verts)
    o = mesh_obj(f'practical_{k}', bm, col, None, C_STAGE)
    o.location = (x, 2.85, floor_z + 0.75); o.rotation_euler = (math.pi / 2, 0, 0); o.scale = (1, 1.3, 1)
    o.visible_glossy = True; o.visible_diffuse = False

# ---------------------------------------------------------------- lights (sized for a 0.66 m product)
CENTER = logo_to_world(3.3 * S, -2.65 * S, ZC)

def area(name, size, size_y, energy, loc, color=(1, 1, 1), target=CENTER, spread=180):
    d = bpy.data.lights.new(name, 'AREA'); d.shape = 'RECTANGLE'; d.size = size; d.size_y = size_y
    d.energy = energy; d.color = color; d.spread = math.radians(spread)
    o = link(bpy.data.objects.new(name, d), C_LIGHT); o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o

area('key_softbox', 2.0, 1.4, 42, (CENTER.x - 1.0, CENTER.y - 1.3, CENTER.z + 1.1), spread=70)
area('top_scrim', 2.0, 1.2, 30, (CENTER.x + 0.2, CENTER.y - 0.2, CENTER.z + 1.6), spread=60)
area('fill_card', 1.6, 1.2, 5, (CENTER.x + 1.4, CENTER.y - 1.4, CENTER.z + 1.25))
area('rim_left', 0.12, 1.6, 45, (CENTER.x - 1.0, CENTER.y + 1.0, CENTER.z + 0.95), (0.95, 0.97, 1.0), target=CENTER + Vector((0, 0, 0.32)), spread=24)
area('rim_right', 0.12, 1.6, 40, (CENTER.x + 1.2, CENTER.y + 0.9, CENTER.z + 0.95), (0.95, 0.97, 1.0), target=CENTER + Vector((0, 0, 0.32)), spread=24)
area('rim_blue', 0.10, 1.4, 22, (CENTER.x + 0.6, CENTER.y + 1.4, CENTER.z + 0.6), lin((40, 120, 255)), target=CENTER + Vector((0, 0, 0.25)), spread=26)
w = bpy.data.worlds.new('LIBALSTAL_V3_studio'); w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0025, 0.0028, 0.0033, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
scene.world = w

# ---------------------------------------------------------------- illustrative airflow (out of the louvres)
air_root = empty('airflow_root', (0, 0, 0), None, C_AIR); air_root.rotation_euler = (math.pi / 2, 0, 0)
gx = (Gr['x'][0] + Gr['x'][1]) / 2 * S; gy = (Gr['y'][0] + Gr['y'][1]) / 2 * S
import random
rnd = random.Random(5017)
for i in range(Gr['louvres']):
    y0 = gy + (H - 2 * fr) / 2 - pitch * (i + 0.5)
    for j in range(5):
        x0 = gx - (W - 2 * fr) / 2 + (W - 2 * fr) * (j + 0.5) / 5 + rnd.uniform(-0.01, 0.01)
        length = rnd.uniform(0.24, 0.44); spread = rnd.uniform(-0.45, 0.45)
        pts = []
        for k in range(36):
            s = k / 35 * length
            d = Vector((spread * 0.3 * s, -math.sin(math.radians(16)) * s - 0.12 * s * s, math.cos(math.radians(16)) * s))
            pts.append((x0 + d.x, y0 + d.y, Z_FRONT - 0.01 + d.z))
        rad = rnd.uniform(0.0006, 0.001)
        ob = mesh_obj(f'flow_{i}_{j}', sweep_bm(pts, rad, False, 8), M_FLOW, air_root, C_AIR, smooth=True)
        halo = mesh_obj(f'flow_{i}_{j}_halo', sweep_bm(pts, rad * 4.5, False, 10), M_FLOW_HALO, air_root, C_AIR, smooth=True)
        for o_ in (ob, halo):
            o_.visible_shadow = False
        # taper: radius shrinks to 35 % along the stream
        for o_, r0 in ((ob, rad), (halo, rad * 4.5)):
            me = o_.data; uv = me.uv_layers[0].data
            u_of = {}
            for poly in me.polygons:
                for li, vi in zip(poly.loop_indices, poly.vertices):
                    u_of[vi] = uv[li].uv[0]
            pts_v = [Vector(p) for p in pts]
            for vi, v in enumerate(me.vertices):
                u = u_of.get(vi, 0.0); k = min(len(pts_v) - 1, round(u * (len(pts_v) - 1)))
                c = pts_v[k]; v.co = c + (v.co - c) * (1.0 - 0.65 * u)
glow = bpy.data.lights.new('grille_inner_glow', 'POINT'); glow.energy = 1.2; glow.color = lin((60, 140, 255)); glow.shadow_soft_size = 0.05
go = link(bpy.data.objects.new('grille_inner_glow', glow), C_AIR); go.location = logo_to_world(gx, gy, Z_FRONT - 0.05)

# ---------------------------------------------------------------- cameras
def camera(name, lens, target, az, el, dist, fstop=None, focus=None, ortho=None):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.sensor_width = 36; cd.clip_start = 0.01; cd.clip_end = 50
    t = Vector(target)
    loc = t + Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)), -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el)))) * dist
    o = link(bpy.data.objects.new(name, cd), C_CAM); o.location = loc
    o.rotation_euler = (t - loc).to_track_quat('-Z', 'Y').to_euler()
    if fstop:
        cd.dof.use_dof = True; cd.dof.aperture_fstop = fstop; cd.dof.focus_distance = focus or (t - loc).length
        cd.dof.aperture_blades = 9
    if ortho:
        cd.type = 'ORTHO'; cd.ortho_scale = ortho
    return o

camera('CAM_1_hero', 40, CENTER + Vector((0.0, 0.0, -0.02)), -32, 7, 1.18, 8.0)
close_t = logo_to_world(4.22 * S, -0.55 * S, 0.0)
camera('CAM_2_detail', 100, close_t, 28, 16, 0.46, 5.6)
camera('CAM_3_transform', 45, CENTER + Vector((0.03, 0.0, 0.02)), -38, 13, 1.45, 8.0)
camera('CAM_4_airflow', 70, CENTER + Vector((0.07, 0.0, 0.0)), 22, 5, 2.05, 6.3)
fo = camera('CAM_front_ortho', 50, (1.038, -2.0, -0.3125), 0, 0, 0.0001, ortho=2.076)
fo.location = (1.038, -2.0, -0.3125); fo.rotation_euler = (math.pi / 2, 0, 0)
scene.camera = bpy.data.objects['CAM_1_hero']

# ---------------------------------------------------------------- render settings (stills; quality chosen after the benchmark)
rs = scene.render; cy = scene.cycles
rs.engine = 'CYCLES'; cy.device = 'CPU'
cy.samples = 256; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.015
cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
cy.max_bounces = 12; cy.glossy_bounces = 8; cy.diffuse_bounces = 4; cy.transmission_bounces = 4; cy.transparent_max_bounces = 16
cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.3
cy.use_light_tree = True
rs.resolution_x, rs.resolution_y, rs.resolution_percentage = 1920, 1080, 100
rs.use_persistent_data = True
rs.image_settings.file_format = 'PNG'; rs.image_settings.color_depth = '16'; rs.image_settings.color_mode = 'RGB'
scene.view_settings.view_transform = 'AgX'
for look in ('AgX - Medium High Contrast', 'AgX - Base Contrast', 'None'):
    try:
        scene.view_settings.look = look; break
    except Exception:
        pass
scene.view_settings.exposure = 0.0

if SAVE_TO:
    bpy.ops.wm.save_as_mainfile(filepath=SAVE_TO)
n_obj = len(C_EMBLEM.all_objects)
tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in C_EMBLEM.all_objects:
    if o.type == 'MESH':
        me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); tris += len(me.loop_triangles); o.evaluated_get(dg).to_mesh_clear()
print(f'LIBALSTAL_V3 built: {n_obj} emblem objects, {tris} triangles (evaluated), saved: {SAVE_TO}')
