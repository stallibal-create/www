"""LIBALSTAL — Airflow Experience 3D, prototype v1: grey-shaded mechanical animatic.

The emblem's duct system as separate, named, pivoted parts: blue rectangular riser (telescoping) with a mitred
corner, round top duct with bolted flanges, 5-gore segmented elbow, blue twist-lock collar, grille box with six
hinged louvres, rectangular bottom duct. A deterministic assembly sequence moves each part only along its
mechanical degree of freedom (slide on its axis, hinge, twist-lock, louvre flip, nuts screwing in), then the ducts
turn translucent and blue streamlines run along the duct centrelines. Workbench animatic only (cheap, grey).

ILLUSTRATIVE geometry with demonstration proportions — not manufacturing data, not the official logo (the official
PNG stays the identity; this model is a construction inspired by it).

    blender --background --factory-startup --python scripts/blender-airflow-prototype.py [-- --stills-only]

Never overwrites: saves brand/blender/airflow-prototype-vN.blend with the next free N, and writes stills and the PNG
frame sequence to visual/airflow-prototype/vN/ (FFmpeg then encodes the animatic).
"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parent.parent
BLEND_DIR = ROOT / 'brand' / 'blender'
VISUAL_DIR = ROOT.parent / 'visual' / 'airflow-prototype'
FPS, END = 30, 240
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

# ---------- scene reset (factory startup scene only) ----------
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.unit_settings.system, scene.unit_settings.length_unit = 'METRIC', 'METERS'
scene.render.fps, scene.frame_start, scene.frame_end = FPS, 1, END


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(c)
    return c


ASM = collection('LIBALSTAL_assembly')
COL = {k: collection(k, ASM) for k in ('riser', 'top_duct', 'elbow', 'collar', 'grille_box', 'bottom_duct', 'fasteners')}
FLOW = collection('LIBALSTAL_airflow')
RIG = collection('LIBALSTAL_camera_rig')


def mat(name, rgb, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, alpha)
    m.roughness, m.metallic = 0.4, 0.0
    return m


STEEL = mat('steel_grey', (0.56, 0.58, 0.6))
FRAME = mat('flange_grey', (0.36, 0.38, 0.41))
BLUE = mat('libalstal_blue_RAL5017', (0.0, 0.133, 0.604))   # #0066CC in linear
BOLT = mat('fastener_grey', (0.7, 0.72, 0.74))
DARK = mat('louvre_grey', (0.28, 0.3, 0.32))
AIR = mat('airflow_blue', (0.18, 0.55, 1.0))
PULSE = mat('airflow_pulse', (0.75, 0.9, 1.0))
LABEL = mat('label_grey', (0.75, 0.78, 0.8))
DUCT_MATS = (STEEL, FRAME, BLUE, BOLT, DARK)


def obj_from_bm(name, bm, pivot, material, coll, bevel=0.0035, solidify=0.0):
    """Mesh object whose origin is the mechanical pivot (bmesh built in world coordinates)."""
    for v in bm.verts:
        v.co -= Vector(pivot)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    o.location = pivot
    coll.objects.link(o)
    if solidify:
        s = o.modifiers.new('wall', 'SOLIDIFY')
        s.thickness, s.offset = solidify, -1
    if bevel:
        b = o.modifiers.new('edge', 'BEVEL')
        b.width, b.segments, b.limit_method = bevel, 1, 'ANGLE'
    return o


def bm_box(lo, hi, drop_faces=()):
    """Axis-aligned box from lo to hi; drop_faces removes open ends: '+x', '-x', '+y', '-y', '+z', '-z'."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    lo, hi = Vector(lo), Vector(hi)
    for v in bm.verts:
        v.co = Vector([lo[i] + (v.co[i] + 0.5) * (hi[i] - lo[i]) for i in range(3)])
    centre = (lo + hi) / 2
    kill = []
    for f in bm.faces:
        n, c = f.normal, f.calc_center_median() - centre
        for d in drop_faces:
            axis, sign = 'xyz'.index(d[1]), 1 if d[0] == '+' else -1
            if n[axis] * sign > 0.9:
                kill.append(f)
    bmesh.ops.delete(bm, geom=list(set(kill)), context='FACES_ONLY')
    return bm


def bm_prism(points_xz, y0, y1):
    """Extrude a convex polygon given in the XZ plane between y0 and y1 (closed solid)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y0, z)) for x, z in points_xz]
    back = [bm.verts.new((x, y1, z)) for x, z in points_xz]
    bm.faces.new(front[::-1]); bm.faces.new(back)
    n = len(points_xz)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_tube(rings, closed_ends=False):
    """Loft through rings (lists of Vectors of equal length), open-ended tube unless closed_ends."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a in range(len(vs) - 1):
        for k in range(n):
            bm.faces.new((vs[a][k], vs[a][(k + 1) % n], vs[a + 1][(k + 1) % n], vs[a + 1][k]))
    if closed_ends:
        bm.faces.new(vs[0][::-1]); bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ring(c, u, v, ru, rv, n=40):
    return [Vector(c) + u * (ru * math.cos(2 * math.pi * k / n)) + v * (rv * math.sin(2 * math.pi * k / n)) for k in range(n)]


def bm_annulus(c, axis, r_in, r_out, t, n=40):
    """Flat ring (flange) centred on c, perpendicular to axis, thickness t along axis."""
    axis = Vector(axis).normalized()
    u = axis.orthogonal().normalized(); v = axis.cross(u)
    bm = bmesh.new()
    layers = []
    for d in (-t / 2, t / 2):
        cc = Vector(c) + axis * d
        layers.append(([bm.verts.new(p) for p in ring(cc, u, v, r_out, r_out, n)], [bm.verts.new(p) for p in ring(cc, u, v, r_in, r_in, n)]))
    (o0, i0), (o1, i1) = layers
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((o0[k], o0[j], o1[j], o1[k]))      # outer rim
        bm.faces.new((i0[k], i1[k], i1[j], i0[j]))      # inner rim
        bm.faces.new((o0[k], i0[k], i0[j], o0[j]))      # back face
        bm.faces.new((o1[k], o1[j], i1[j], i1[k]))      # front face
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_rect_frame(x0, x1, ylo, yhi, zlo, zhi, w):
    """Rectangular flange frame between x0..x1 around the section y∈[ylo,yhi], z∈[zlo,zhi], frame width w."""
    bm = bmesh.new()
    for lo, hi in (((x0, ylo - w, zhi), (x1, yhi + w, zhi + w)), ((x0, ylo - w, zlo - w), (x1, yhi + w, zlo)),
                   ((x0, ylo - w, zlo), (x1, ylo, zhi)), ((x0, yhi, zlo), (x1, yhi + w, zhi))):
        part = bm_box(lo, hi)
        me = bpy.data.meshes.new('tmp'); part.to_mesh(me); part.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    return bm


def hex_nut(name, centre, axis, coll):
    """Hex nut seated on a face; its axis points away from the face (stored for the screw-in animation)."""
    axis = Vector(axis).normalized()
    u = axis.orthogonal().normalized(); v = axis.cross(u)
    c0, c1 = Vector(centre), Vector(centre) + axis * 0.012
    bm = bm_tube([ring(c0, u, v, 0.0095, 0.0095, 6), ring(c1, u, v, 0.0095, 0.0095, 6)], closed_ends=True)
    o = obj_from_bm(name, bm, centre, BOLT, coll, bevel=0.0012)
    o['axis'] = tuple(axis)
    return o


# ---------- geometry (metres, Z up, front = −Y) ----------
P = {}  # parts by name

# Riser (blue, rectangular 300 × 260): lower body + telescoping upper section with end cap.
P['riser_lower'] = obj_from_bm('riser_lower', bm_box((0.0, -0.13, 0.45), (0.30, 0.13, 1.02), ('+z', '-z')), (0.15, 0, 0.45), BLUE, COL['riser'], solidify=0.008)
# upper section: its top is level with the top of the top duct, as in the emblem
P['riser_upper'] = obj_from_bm('riser_upper', bm_box((0.012, -0.118, 0.98), (0.288, 0.118, 1.50), ('-z',)), (0.15, 0, 0.98), BLUE, COL['riser'], solidify=0.008)
# Mitred corner joining the riser to the bottom duct: two blue wedges meeting on the mitre line.
P['mitre_upper'] = obj_from_bm('mitre_upper', bm_prism([(0, 0.45), (0.30, 0.45), (0.30, 0.41), (0, 0.19)], -0.13, 0.13), (0.15, 0, 0.45), BLUE, COL['riser'])
P['mitre_lower'] = obj_from_bm('mitre_lower', bm_prism([(0, 0.19), (0.30, 0.41), (0.30, 0.19)], -0.12, 0.12), (0.0, 0, 0.19), BLUE, COL['riser'])  # hinge on the outer corner

# Top round duct Ø240 at z 1.36, x 0.30 → 0.95, with bolted flanges at both ends.
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
R_DUCT, Z_TOP = 0.12, 1.36
P['top_duct'] = obj_from_bm('top_duct', bm_tube([ring((x, 0, Z_TOP), Y, Z, R_DUCT, R_DUCT, 48) for x in (0.32, 0.93)]), (0.625, 0, Z_TOP), STEEL, COL['top_duct'], bevel=0, solidify=0.004)
for tag, x in (('A', 0.31), ('B', 0.94)):
    P[f'top_flange_{tag}'] = obj_from_bm(f'top_flange_{tag}', bm_annulus((x, 0, Z_TOP), X, R_DUCT, 0.158, 0.02, 48), (x, 0, Z_TOP), FRAME, COL['top_duct'], bevel=0.002)
    for k in range(6):
        a = 2 * math.pi * k / 6 + math.pi / 6
        side = -1 if tag == 'A' else 1
        P[f'nut_top_{tag}{k}'] = hex_nut(f'nut_top_{tag}{k}', (x + side * 0.01, 0.139 * math.cos(a), Z_TOP + 0.139 * math.sin(a)), X * side, COL['fasteners'])

# 5-gore segmented elbow: centreline radius 0.30, bend centre (0.95, 0, 1.06), turning from +X down to −Z.
BEND_C, R_BEND, GORES = Vector((0.95, 0, Z_TOP - 0.30)), 0.30, 5
half = math.pi / 2 / (2 * (GORES - 1))
dirs = [Vector((math.cos(k * 2 * half), 0, -math.sin(k * 2 * half))) for k in range(GORES)]
lens = [R_BEND * math.tan(half)] + [2 * R_BEND * math.tan(half)] * (GORES - 2) + [R_BEND * math.tan(half)]
q = [Vector((0.95, 0, Z_TOP))]
for d, L in zip(dirs, lens):
    q.append(q[-1] + d * L)


def joint_ring(k):
    if k in (0, GORES):
        n = dirs[0] if k == 0 else dirs[-1]
        return ring(q[k], Y, n.cross(Y).normalized(), R_DUCT, R_DUCT, 48)
    n = (dirs[k - 1] + dirs[k]).normalized()
    return ring(q[k], Y, n.cross(Y).normalized(), R_DUCT, R_DUCT / math.cos(half), 48)


GORE_ANGLE = []  # centre angle of each gore, for the folding animation
for k in range(GORES):
    P[f'elbow_gore_{k + 1}'] = obj_from_bm(f'elbow_gore_{k + 1}', bm_tube([joint_ring(k), joint_ring(k + 1)]), tuple(BEND_C), STEEL, COL['elbow'], bevel=0, solidify=0.004)
    GORE_ANGLE.append(0 if k == 0 else (2 * k - 1) * half)  # start angle: folding stacks every gore on the first

# Blue collar (twist-lock) below the elbow, then the grille box.
X_OUT = 0.95 + R_BEND  # 1.25
P['collar'] = obj_from_bm('collar', bm_tube([ring((X_OUT, 0, z), X, Y, R_DUCT + 0.004, R_DUCT + 0.004, 48) for z in (BEND_C.z, BEND_C.z - 0.14)]), (X_OUT, 0, BEND_C.z), BLUE, COL['collar'], bevel=0, solidify=0.006)
for k in range(4):  # bayonet lugs: show the twist
    a = math.pi / 2 * k + math.pi / 4
    c = Vector((X_OUT + 0.131 * math.cos(a), 0.131 * math.sin(a), BEND_C.z - 0.03))
    lug = bm_box(c - Vector((0.012, 0.012, 0.012)), c + Vector((0.012, 0.012, 0.012)))
    P[f'collar_lug_{k}'] = obj_from_bm(f'collar_lug_{k}', lug, (X_OUT, 0, BEND_C.z), BLUE, COL['collar'], bevel=0.002)

BOX_Z0, BOX_Z1, BOX_X0, BOX_X1, BOX_Y = 0.19, BEND_C.z - 0.14, 1.10, 1.40, 0.14
P['grille_box'] = obj_from_bm('grille_box', bm_box((BOX_X0, -BOX_Y, BOX_Z0), (BOX_X1, BOX_Y, BOX_Z1), ('-y',)), (X_OUT, 0, BOX_Z0), STEEL, COL['grille_box'], solidify=0.008)
frame = bmesh.new()
for lo, hi in (((BOX_X0 - 0.01, -BOX_Y - 0.03, BOX_Z1 - 0.035), (BOX_X1 + 0.01, -BOX_Y, BOX_Z1 + 0.01)),
               ((BOX_X0 - 0.01, -BOX_Y - 0.03, BOX_Z0 - 0.01), (BOX_X1 + 0.01, -BOX_Y, BOX_Z0 + 0.035)),
               ((BOX_X0 - 0.01, -BOX_Y - 0.03, BOX_Z0 + 0.035), (BOX_X0 + 0.025, -BOX_Y, BOX_Z1 - 0.035)),
               ((BOX_X1 - 0.025, -BOX_Y - 0.03, BOX_Z0 + 0.035), (BOX_X1 + 0.01, -BOX_Y, BOX_Z1 - 0.035))):
    part = bm_box(lo, hi); me = bpy.data.meshes.new('tmp'); part.to_mesh(me); part.free(); frame.from_mesh(me); bpy.data.meshes.remove(me)
P['grille_frame'] = obj_from_bm('grille_frame', frame, (X_OUT, -BOX_Y, BOX_Z0), FRAME, COL['grille_box'], bevel=0.003)
LOUVRES, inner0, inner1 = 6, BOX_Z0 + 0.035, BOX_Z1 - 0.035
pitch = (inner1 - inner0) / LOUVRES
for k in range(LOUVRES):  # blade chord vertical = closed; hinge along X through the blade centre
    zc = inner0 + pitch * (k + 0.5)
    blade = bm_box((BOX_X0 + 0.03, -BOX_Y - 0.018, zc - pitch * 0.55), (BOX_X1 - 0.03, -BOX_Y - 0.012, zc + pitch * 0.55))
    P[f'louvre_{k + 1}'] = obj_from_bm(f'louvre_{k + 1}', blade, (X_OUT, -BOX_Y - 0.015, zc), DARK, COL['grille_box'], bevel=0.0015)
for k, (x, z) in enumerate(((BOX_X0 + 0.0075, BOX_Z0 + 0.012), (BOX_X1 - 0.0075, BOX_Z0 + 0.012), (BOX_X0 + 0.0075, BOX_Z1 - 0.012), (BOX_X1 - 0.0075, BOX_Z1 - 0.012))):
    P[f'nut_grille_{k}'] = hex_nut(f'nut_grille_{k}', (x, -BOX_Y - 0.03, z), -Y, COL['fasteners'])

# Rectangular bottom duct 220 × 240, x 0.30 → 1.10 at z 0.19..0.41, flange frames at both ends.
B_Y, B_Z0, B_Z1 = 0.12, 0.19, 0.41
P['bottom_duct'] = obj_from_bm('bottom_duct', bm_box((0.32, -B_Y, B_Z0), (1.08, B_Y, B_Z1), ('+x', '-x')), (0.70, 0, B_Z0), STEEL, COL['bottom_duct'], solidify=0.004)
for tag, (x0, x1) in (('A', (0.30, 0.32)), ('B', (1.08, 1.10))):
    P[f'bottom_flange_{tag}'] = obj_from_bm(f'bottom_flange_{tag}', bm_rect_frame(x0, x1, -B_Y, B_Y, B_Z0, B_Z1, 0.03), ((x0 + x1) / 2, 0, B_Z0), FRAME, COL['bottom_duct'], bevel=0.002)
    side = -1 if tag == 'A' else 1
    for k, (y, z) in enumerate(((-B_Y - 0.015, B_Z0 - 0.015), (B_Y + 0.015, B_Z0 - 0.015), (-B_Y - 0.015, B_Z1 + 0.015), (B_Y + 0.015, B_Z1 + 0.015))):
        P[f'nut_bottom_{tag}{k}'] = hex_nut(f'nut_bottom_{tag}{k}', ((x0 + x1) / 2 + side * 0.01, y, z), X * side, COL['fasteners'])

# ---------- airflow streamlines along the duct centrelines ----------


def fillet_path(points, radius=0.08, seg=8):
    """Polyline with rounded corners (quadratic Bézier fillets), returned as dense points."""
    pts = [Vector(p) for p in points]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, p, b = pts[i - 1], pts[i], pts[i + 1]
        r = min(radius, (p - a).length / 2, (b - p).length / 2)
        t0, t1 = p + (a - p).normalized() * r, p + (b - p).normalized() * r
        out.append(t0)
        for s in range(1, seg):
            u = s / seg
            out.append((1 - u) ** 2 * t0 + 2 * u * (1 - u) * p + u * u * t1)
        out.append(t1)
    out.append(pts[-1])
    dense = [out[0]]
    for a, b in zip(out, out[1:]):  # resample to ≤ 2 cm steps for smooth tubes and even pulses
        n = max(1, int((b - a).length / 0.02))
        dense += [a.lerp(b, s / n) for s in range(1, n + 1)]
    return dense


elbow_arc = [BEND_C + Vector((R_BEND * math.cos(t), 0, R_BEND * math.sin(t))) for t in [math.pi / 2 - (math.pi / 2) * s / 12 for s in range(13)]]
PATHS = {
    'upper': fillet_path([(0.15, 0, 0.62), (0.15, 0, Z_TOP), (0.95, 0, Z_TOP)] + [tuple(p) for p in elbow_arc[1:]] + [(X_OUT, 0, 0.62), (X_OUT, -0.55, 0.52)]),
    'lower': fillet_path([(0.15, 0, 0.80), (0.15, 0, 0.30), (1.10, 0, 0.30), (1.18, 0, 0.36), (1.18, -0.55, 0.36)]),
}


def offset_path(pts, d_plane, d_y):
    """Shift a path sideways in its XZ plane by d_plane and in depth by d_y."""
    out = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        t2 = Vector((t.x, t.z)).normalized() if Vector((t.x, t.z)).length > 1e-9 else Vector((1, 0))
        n = Vector((-t2.y, 0, t2.x))
        out.append(p + n * d_plane + Vector((0, d_y, 0)))
    return out


def curve_obj(name, pts, material, radius):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions, cu.bevel_depth, cu.bevel_resolution = '3D', radius, 2
    cu.bevel_factor_mapping_start = cu.bevel_factor_mapping_end = 'SPLINE'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    cu.materials.append(material)
    o = bpy.data.objects.new(name, cu)
    FLOW.objects.link(o)
    return o


STREAMS = []
for pname, pts in PATHS.items():
    for i, (dp, dy) in enumerate(((-0.05, -0.04), (0.0, -0.04), (0.05, -0.04), (-0.05, 0.04), (0.0, 0.04), (0.05, 0.04))):
        sp = offset_path(pts, dp, dy)
        line = curve_obj(f'airflow_{pname}_{i}', sp, AIR, 0.0035)
        pulse = curve_obj(f'airflow_{pname}_{i}_pulse', sp, PULSE, 0.0065)
        STREAMS.append((line, pulse, i))

# ---------- animation: deterministic assembly from the exploded state ----------


def pose(o, waypoints):
    """Keyframe a part through (frame, offset, rotation) waypoints relative to its assembled pose; the last waypoint
    should be (f, (0, 0, 0), (0, 0, 0)). Offsets and rotations are absolute per waypoint, never accumulated."""
    home_loc, home_rot = o.location.copy(), o.rotation_euler.copy()
    for f, off, rot in waypoints:
        o.location = home_loc + Vector(off)
        o.rotation_euler = [home_rot[i] + rot[i] for i in range(3)]
        o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_euler', frame=f)
    o.location, o.rotation_euler = home_loc, home_rot


def move(o, f0, f1, offset=(0, 0, 0), rot=(0, 0, 0)):
    """Exploded pose (offset, rot) until f0, assembled from f1."""
    pose(o, [(1, offset, rot), (f0, offset, rot), (f1, (0, 0, 0), (0, 0, 0))])
    return [(1, offset, rot), (f0, offset, rot), (f1, (0, 0, 0), (0, 0, 0))]


R = math.radians
O = (0, 0, 0)
WAY = {}
# Riser: body docks from the left with the upper mitre wedge; the upper section rides inside, then telescopes up;
# the lower mitre wedge rides along folded down on its hinge, then swings shut.
WAY['riser_lower'] = move(P['riser_lower'], 18, 52, offset=(-0.55, 0, 0))
WAY['mitre_upper'] = move(P['mitre_upper'], 18, 52, offset=(-0.55, 0, 0))
pose(P['riser_upper'], [(1, (-0.55, 0, -0.5), O), (18, (-0.55, 0, -0.5), O), (52, (0, 0, -0.5), O), (82, O, O)])
pose(P['mitre_lower'], [(1, (-0.55, 0, 0), (0, R(80), 0)), (18, (-0.55, 0, 0), (0, R(80), 0)), (52, O, (0, R(80), 0)), (88, O, O)])
# Bottom duct rises into line; its rectangular flange frames slide on along the duct axis (no twist: a square frame
# only fits one way).
WAY['bottom_duct'] = move(P['bottom_duct'], 60, 96, offset=(0, 0, -0.42))
for tag, side in (('A', -1), ('B', 1)):
    pose(P[f'bottom_flange_{tag}'], [(1, (side * 0.18, 0, -0.42), O), (60, (side * 0.18, 0, -0.42), O), (96, (side * 0.18, 0, 0), O), (112, O, O)])
    WAY[f'bottom_flange_{tag}'] = 112
# Top duct lowers onto the riser spigot; flanges slide in along the duct axis and rotate onto the bolt pattern.
move(P['top_duct'], 84, 118, offset=(0, 0, 0.42))
for tag, side in (('A', -1), ('B', 1)):
    pose(P[f'top_flange_{tag}'], [(1, (side * 0.16, 0, 0.42), (R(30), 0, 0)), (84, (side * 0.16, 0, 0.42), (R(30), 0, 0)),
                                  (118, (side * 0.16, 0, 0), (R(30), 0, 0)), (134, O, O)])
    WAY[f'top_flange_{tag}'] = 134
# Elbow: the five gores unfold like a fan about the bend axis (Y through the bend centre), one after another.
for k in range(GORES):
    f0 = 124 + 6 * k
    move(P[f'elbow_gore_{k + 1}'], f0, f0 + 22, rot=(0, -GORE_ANGLE[k], 0))
# Grille box (body, frame, louvres) slides in from the right; louvres flip open in sequence (55° about their hinge).
for name in ['grille_box', 'grille_frame'] + [f'louvre_{k + 1}' for k in range(LOUVRES)]:
    move(P[name], 120, 154, offset=(0.6, 0, 0))
WAY['grille_frame'] = 154
for k in range(LOUVRES):
    f = 192 + 3 * k
    P[f'louvre_{k + 1}'].keyframe_insert('rotation_euler', index=0, frame=f)
    P[f'louvre_{k + 1}'].rotation_euler[0] = R(55)
    P[f'louvre_{k + 1}'].keyframe_insert('rotation_euler', index=0, frame=f + 14)
# Collar drops onto the elbow outlet, then twist-locks (bayonet, 40° about its axis).
for name in ['collar'] + [f'collar_lug_{k}' for k in range(4)]:
    pose(P[name], [(1, (0, 0, 0.32), (0, 0, R(40))), (150, (0, 0, 0.32), (0, 0, R(40))), (170, O, (0, 0, R(40))), (184, O, O)])
# Nuts: travel with their flange or frame, then screw in (two turns while seating 12 mm along their axis).
PARENT = {'nut_top_A': 'top_flange_A', 'nut_top_B': 'top_flange_B', 'nut_bottom_A': 'bottom_flange_A',
          'nut_bottom_B': 'bottom_flange_B', 'nut_grille': 'grille_frame'}
for name, o in P.items():
    if not name.startswith('nut_'):
        continue
    parent = P[PARENT[next(k for k in PARENT if name.startswith(k))]]
    fc = parent.animation_data.action.fcurves
    off1 = Vector([fc.find('location', index=i).evaluate(1) for i in range(3)]) - parent.location
    axis = Vector(o['axis'])
    idx = max(range(3), key=lambda i: abs(axis[i]))
    spin = [0, 0, 0]; spin[idx] = -4 * math.pi * (1 if axis[idx] > 0 else -1)
    back = axis * 0.012
    f_docked = WAY[PARENT[next(k for k in PARENT if name.startswith(k))]]
    seat = max(f_docked + 4, 196) + int(abs(hash(name)) % 8)
    pose(o, [(1, tuple(off1 + back), spin), (f_docked, tuple(back), spin), (seat, tuple(back), spin), (seat + 14, O, O)])

# Easing: Bézier with auto-clamped handles reads as precise machinery; no overshoot.
for o in list(P.values()):
    if o.animation_data and o.animation_data.action:
        for fc in o.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation, kp.easing = 'BEZIER', 'AUTO'
                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'

# Airflow: ducts turn translucent, streamlines grow along the paths, then pulses travel (looping, deterministic).
for m in DUCT_MATS:
    m.diffuse_color[3] = 1.0; m.keyframe_insert('diffuse_color', index=3, frame=200)
    m.diffuse_color[3] = 0.28; m.keyframe_insert('diffuse_color', index=3, frame=214)
for line, pulse, i in STREAMS:
    line.data.bevel_factor_end = 0.0; line.data.keyframe_insert('bevel_factor_end', frame=204 + i)
    line.data.bevel_factor_end = 1.0; line.data.keyframe_insert('bevel_factor_end', frame=226 + i)
    cu = pulse.data
    cu.bevel_factor_start, cu.bevel_factor_end = 0.0, 0.0
    cu.keyframe_insert('bevel_factor_start', frame=1); cu.keyframe_insert('bevel_factor_end', frame=1)
    phase = (i * 4) % 16
    cu.bevel_factor_start, cu.bevel_factor_end = 0.0, 0.0
    cu.keyframe_insert('bevel_factor_start', frame=220 + phase); cu.keyframe_insert('bevel_factor_end', frame=220 + phase)
    cu.bevel_factor_start, cu.bevel_factor_end = 0.88, 1.0
    cu.keyframe_insert('bevel_factor_start', frame=250 + phase); cu.keyframe_insert('bevel_factor_end', frame=250 + phase)
    for fc in cu.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'

# ---------- camera, label, look ----------
target = bpy.data.objects.new('camera_target', None)
target.location = (0.72, 0, 0.88)
RIG.objects.link(target)
cam = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
cam.data.lens = 40
RIG.objects.link(cam)
track = cam.constraints.new('TRACK_TO')
track.target, track.track_axis, track.up_axis = target, 'TRACK_NEGATIVE_Z', 'UP_Y'
for f, loc in ((1, (3.4, -3.3, 2.7)), (110, (2.6, -3.7, 1.9)), (190, (1.3, -4.0, 1.25)), (240, (0.8, -4.2, 1.0))):
    cam.location = loc; cam.keyframe_insert('location', frame=f)
scene.camera = cam

label = bpy.data.objects.new('label_airflow', bpy.data.curves.new('label_airflow', 'FONT'))
label.data.body = "Visualisation illustrative du flux d'air — géométrie de démonstration"
label.data.size = 0.03
label.data.materials.append(LABEL)
label.parent = cam
label.location = (-0.86, -0.46, -2.0)
RIG.objects.link(label)
label.hide_render = True; label.keyframe_insert('hide_render', frame=1)
label.hide_render = False; label.keyframe_insert('hide_render', frame=206)

scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light, sh.color_type, sh.show_cavity, sh.cavity_type = 'STUDIO', 'MATERIAL', True, 'BOTH'
sh.show_object_outline, sh.object_outline_color = True, (0.05, 0.06, 0.08)
scene.display.render_aa = '8'
scene.world = scene.world or bpy.data.worlds.new('World')
scene.world.color = (0.012, 0.016, 0.028)  # deep navy-graphite
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 720, 75

# ---------- save as a new file (never overwrite) and render the animatic ----------
BLEND_DIR.mkdir(parents=True, exist_ok=True)
n = 1
while (BLEND_DIR / f'airflow-prototype-v{n}.blend').exists():
    n += 1
blend = BLEND_DIR / f'airflow-prototype-v{n}.blend'
out = VISUAL_DIR / f'v{n}'
out.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
print(f'SAVED {blend}')

# Web export (Three.js / React Three Fiber): the assembly parts as separate named nodes with their mechanical pivots,
# modifiers applied, one 'Scene' animation (exploded → assembled); airflow centrelines as JSON (the site draws them
# with a shader instead of shipping tube meshes).
import json
scene.frame_set(END)  # node rest pose = assembled; the animation plays exploded → assembled from there
bpy.ops.object.select_all(action='DESELECT')
for o in ASM.all_objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out / f'airflow-prototype-v{n}.glb'), export_format='GLB', use_selection=True, export_apply=True,
                          export_animations=True, export_animation_mode='SCENE', export_frame_range=True, export_force_sampling=True,
                          export_image_format='NONE', export_materials='EXPORT', export_yup=True, export_current_frame=True)
to_web = lambda p: [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]  # Blender Z-up → glTF Y-up
(out / f'airflow-paths-v{n}.json').write_text(json.dumps({'note': "Illustrative airflow centrelines (metres, glTF axes). Not a CFD result.",
                                                           'paths': {k: [to_web(p) for p in v] for k, v in PATHS.items()}}))
print(f'WEB {out}')

scene.render.image_settings.file_format = 'PNG'
for f in (1, 40, 90, 130, 160, 200, 240):
    scene.frame_set(f)
    scene.render.filepath = str(out / f'still-{f:03d}.png')
    bpy.ops.render.render(write_still=True)
print(f'STILLS {out}')
if '--stills-only' not in ARGS:  # PNG frames; FFmpeg assembles and inspects the animatic (scripts/animatic-encode.sh)
    scene.render.filepath = str(out / 'frames' / 'f_####')
    bpy.ops.render.render(animation=True)
    print(f'FRAMES {out / "frames"}')
