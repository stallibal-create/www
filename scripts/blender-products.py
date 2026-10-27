"""Studio renders of the product families: ILLUSTRATIONS with demonstration dimensions, never specifications.
Run after `node scripts/blender-export.mjs` (it writes products.json and the zinc textures):
    blender --background --factory-startup --python scripts/blender-products.py [-- slug ...]
Writes src/assets/img/products/<slug>-1280.webp and <slug>-640.webp: transparent, with a soft contact shadow, so
they sit on the dark and the light theme. Rectangular parts come from geometry.js (same as the 3D view); round parts,
the grille and the brackets are modelled here.
"""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from blender_zinc import detail_materials, material

root = HERE.parent
folder = root / 'brand' / 'blender'
dest = root / 'src' / 'assets' / 'img' / 'products'
dest.mkdir(parents=True, exist_ok=True)
PARTS = {p['id']: p for p in json.loads((folder / 'products.json').read_text())['parts']}
if (folder / 'products-branches.json').exists():
    PARTS.update({p['id']: p for p in json.loads((folder / 'products-branches.json').read_text())['parts']})
MAT = detail_materials(folder)               # UV-mapped parts from geometry.js
BOX = detail_materials(folder, box=True)     # modelled parts (texture from object coordinates)
SLOT = {k: i for i, k in enumerate(MAT)}
ALU = material('Satin aluminium', (.80, .82, .84), .3)
DARK = material('Duct interior', (.04, .045, .05), .55, metallic=.3)
FLOOR = material('Studio floor', (.045, .05, .055), .7, metallic=0)
scene = bpy.context.scene


# ---------- helpers ----------
def link(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def mesh_obj(name, verts, faces, mat, smooth_deg=None, thickness=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    me.materials.append(mat)
    obj = link(bpy.data.objects.new(name, me))
    if thickness:
        mod = obj.modifiers.new('wall', 'SOLIDIFY')
        mod.thickness, mod.offset, mod.use_even_offset = thickness, 0, True
    if smooth_deg is not None:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_deg))
        obj.select_set(False)
    return obj


def bead(name, points, radius, mat, closed=True):
    """Rolled seam / bead: a bevelled curve through `points`."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions, cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps = '3D', radius, 3, True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (*p, 1)
    sp.use_cyclic_u = closed
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu))


def part_obj(p):
    """Mesh object from an exported geometry.js part (materials, uvs, normals as generated)."""
    me = bpy.data.meshes.new(p['id'])
    idx = p['indices']
    me.from_pydata(p['vertices'], [], [idx[i:i + 3] for i in range(0, len(idx), 3)])
    me.update()
    for m in MAT.values():
        me.materials.append(m)
    for g in p['groups']:
        for i in range(g['start'] // 3, (g['start'] + g['count']) // 3):
            me.polygons[i].material_index = SLOT[g['material']]
    uv = me.uv_layers.new(name='UVMap')
    lv = [0] * len(me.loops)
    me.loops.foreach_get('vertex_index', lv)
    uv.data.foreach_set('uv', [c for v in lv for c in p['uvs'][v]])
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.normals_split_custom_set_from_vertices(p['normals'])
    return link(bpy.data.objects.new(p['id'], me))


def part(pid, at=(0, 0, 0), rz=0.0, rx=0.0):
    """A geometry.js part (with details) from products.json, centred on `at`, turned rx about X then rz about Z."""
    p = PARTS[pid]
    obj = part_obj(p)
    lo = Vector([min(v[i] for v in p['vertices']) for i in range(3)])
    hi = Vector([max(v[i] for v in p['vertices']) for i in range(3)])
    obj.rotation_euler = (rx, 0, rz)
    obj.location = Vector(at) - obj.rotation_euler.to_matrix() @ ((lo + hi) / 2)
    return obj


def ring(c, u, v, ru, rv, n=64):
    return [c + u * (ru * math.cos(2 * math.pi * k / n)) + v * (rv * math.sin(2 * math.pi * k / n)) for k in range(n)]


def loft(rings, closed_rings=True):
    """Quads between consecutive rings of equal size → (verts, faces)."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for a in range(len(rings) - 1):
        for k in range(n if closed_rings else n - 1):
            k1 = (k + 1) % n
            faces.append((a * n + k, a * n + k1, (a + 1) * n + k1, (a + 1) * n + k))
    return verts, faces


# ---------- modelled parts ----------
def spiral_duct(name, r, length, at, pitch=0.137):
    """Spiral round duct along X: thin wall + helical lock seam."""
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    c0 = Vector(at) - X * (length / 2)
    rings = [ring(c0 + X * (length * i / 24), Y, Z, r, r, 96) for i in range(25)]
    v, f = loft(rings)
    mesh_obj(name, v, f, BOX['sheet'], smooth_deg=30, thickness=0.0009)
    turns = length / pitch
    pts = [c0 + X * (length * t) + (Y * math.cos(2 * math.pi * turns * t) + Z * math.sin(2 * math.pi * turns * t)) * (r + 0.0012)
           for t in [i / int(turns * 64) for i in range(int(turns * 64) + 1)]]
    bead(name + '-seam', pts, 0.0034, BOX['sheet'], closed=False)
    for e in (0, 1):  # dark inside, seen through the open ends
        mesh_obj(f'{name}-in{e}', *loft([ring(c0 + X * (length * (0.02 + 0.96 * e)), Y, Z, r - 0.002, r - 0.002, 96),
                                         ring(c0 + X * (length * (0.5)), Y, Z, r - 0.002, r - 0.002, 96)]), DARK)


def gored_elbow(name, r, R, at, gores=5):
    """Segmented round elbow (90°) in the XY plane, with rolled beads at each gore joint and at both ends."""
    Zu = Vector((0, 0, 1))
    half = math.pi / 2 / (2 * (gores - 1))
    dirs = [Vector((math.cos(k * 2 * half), math.sin(k * 2 * half), 0)) for k in range(gores)]
    lens = [R * math.tan(half) + 0.06] + [2 * R * math.tan(half)] * (gores - 2) + [R * math.tan(half) + 0.06]
    q = [Vector(at) - Vector((R * 0.55, R * 0.55, 0))]
    for d, L in zip(dirs, lens):
        q.append(q[-1] + d * L)
    rings = []
    for k, c in enumerate(q):
        if k in (0, len(q) - 1):
            n = dirs[0] if k == 0 else dirs[-1]
            rings.append(ring(c, Zu, n.cross(Zu), r, r))
        else:
            n = (dirs[k - 1] + dirs[k]).normalized()
            rings.append(ring(c, Zu, n.cross(Zu).normalized(), r, r / math.cos(half)))
    v, f = loft(rings)
    mesh_obj(name, v, f, BOX['sheet'], smooth_deg=15, thickness=0.0009)
    for k, rg in enumerate(rings[1:-1], 1):
        c = q[k]
        bead(f'{name}-joint{k}', [c + (p - c) * ((r + 0.001) / r) for p in rg], 0.0022, BOX['sheet'])
    for k, (c, d) in enumerate(((q[0] + dirs[0] * 0.035, dirs[0]), (q[-1] - dirs[-1] * 0.035, dirs[-1]))):
        bead(f'{name}-end{k}', ring(c, Zu, d.cross(Zu), r + 0.0015, r + 0.0015), 0.003, BOX['sheet'])


def square_to_round(name, w, h, r, height, at):
    """Square-to-round transition standing on a rectangular collar with a frame flange: four flat triangles and
    four conical corners (the classic layout), round collar with a rolled bead on top."""
    base = Vector(at)
    N = 64
    circle = [base + Vector((r * math.cos(2 * math.pi * k / N), r * math.sin(2 * math.pi * k / N), height)) for k in range(N)]
    corners = [base + Vector((sx * w / 2, sy * h / 2, 0)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    verts = corners + circle
    faces = []
    for q in range(4):  # corner q fans the arc between the two side directions around it
        k0, k1 = q * N // 4, (q + 1) * N // 4
        for k in range(k0, k1):
            faces.append((q, 4 + k, 4 + (k + 1) % N))
        faces.append((q, 4 + k1 % N, (q + 1) % 4))  # flat side triangle
    mesh_obj(name, verts, faces, BOX['sheet'], smooth_deg=25, thickness=0.0009)
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    collar = loft([ring(base + Z * (height + t), X, Y, r, r) for t in (0, 0.07)])
    mesh_obj(name + '-collar', *collar, BOX['sheet'], smooth_deg=30, thickness=0.0009)
    bead(name + '-bead', ring(base + Z * (height + 0.035), X, Y, r + 0.0015, r + 0.0015), 0.003, BOX['sheet'])
    rect = lambda z, g: [base + Vector((sx * (w / 2 + g), sy * (h / 2 + g), z)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    v, f = loft([rect(0, 0), rect(-0.06, 0)])
    mesh_obj(name + '-rect', v, f, BOX['sheet'], thickness=0.0009)
    v, f = loft([rect(-0.06, 0), rect(-0.06, 0.03), rect(-0.09, 0.03), rect(-0.09, 0)])
    mesh_obj(name + '-flange', v, f, BOX['flange'])


def grille(name, w, h, at, blades=12):
    """Supply grille with fixed angled blades in a bevelled frame, seen from the front (−Y)."""
    c = Vector(at)
    def box(n, size, pos, mat, rx=0.0, bevel=0.0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=pos, rotation=(rx, 0, 0))
        o = bpy.context.object
        o.name, o.scale = n, size
        o.data.materials.append(mat)
        if bevel:
            mod = o.modifiers.new('bevel', 'BEVEL')
            mod.width, mod.segments = bevel, 3
        return o
    b, d = 0.042, 0.026
    for i, (sx, sz, px, pz) in enumerate(((w, b, 0, h / 2 - b / 2), (w, b, 0, -h / 2 + b / 2), (b, h - 2 * b, w / 2 - b / 2, 0), (b, h - 2 * b, -w / 2 + b / 2, 0))):
        box(f'{name}-frame{i}', (sx, d, sz), c + Vector((px, 0, pz)), ALU, bevel=0.004)
    inner_w, inner_h = w - 2 * b, h - 2 * b
    for k in range(blades):
        z = -inner_h / 2 + inner_h * (k + 0.5) / blades
        box(f'{name}-blade{k}', (inner_w, 0.022, 0.0018), c + Vector((0, 0.004, z)), ALU, rx=math.radians(-38))
    box(f'{name}-back', (inner_w, 0.004, inner_h), c + Vector((0, 0.03, 0)), DARK)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0045, depth=0.002, location=c + Vector((sx * (w / 2 - b / 2), -d / 2 - 0.0005, 0)), rotation=(math.pi / 2, 0, 0))
        bpy.context.object.data.materials.append(DARK)


def coupling(name, r, length, at):
    """Round coupling (manchon) along X with a centre stop bead and rolled ends."""
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    c0 = Vector(at) - X * (length / 2)
    mesh_obj(name, *loft([ring(c0 + X * (length * i / 4), Y, Z, r, r) for i in range(5)]), BOX['sheet'], smooth_deg=30, thickness=0.0009)
    for t, rad in ((0.5, 0.0045), (0.04, 0.003), (0.96, 0.003)):
        bead(f'{name}-b{t}', ring(c0 + X * (length * t), Y, Z, r + 0.0015, r + 0.0015), rad, BOX['sheet'])


def bent_part(name, profile, width, at, holes=(), thickness=0.003, bend=0.008):
    """Sheet part: polyline profile (x, z) with filleted bends, extruded along Y, holes punched (x, y offsets on the
    face whose segment index is given)."""
    pts = [Vector((x, 0, z)) for x, z in profile]
    path = [pts[0]]
    for i in range(1, len(pts) - 1):  # fillet each bend
        a, p, b = pts[i - 1], pts[i], pts[i + 1]
        da, db = (a - p).normalized(), (b - p).normalized()
        t0, t1 = p + da * bend, p + db * bend
        for s in range(5):
            u = s / 4
            path.append((t0 * (1 - u) + p * u) * (1 - u) + (p * (1 - u) + t1 * u) * u)
    path.append(pts[-1])
    off = Vector(at)
    v, f = loft([[off + q + Vector((0, -width / 2, 0)) for q in path], [off + q + Vector((0, width / 2, 0)) for q in path]], closed_rings=False)
    obj = mesh_obj(name, v, f, BOX['sheet'], thickness=thickness)
    for i, (seg, u, y, rad) in enumerate(holes):  # cutter cylinders across face `seg`, at fraction u along it
        a, b = pts[seg], pts[seg + 1]
        p, n = off + a + (b - a) * u + Vector((0, y, 0)), (b - a).normalized().cross(Vector((0, 1, 0)))
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=rad, depth=0.05, location=p)
        cutter = bpy.context.object
        cutter.rotation_euler = n.to_track_quat('Z', 'Y').to_euler()
        cutter.hide_render, cutter.display_type, cutter['cutter'] = True, 'WIRE', True
        mod = obj.modifiers.new(f'hole{i}', 'BOOLEAN')
        mod.operation, mod.solver, mod.object = 'DIFFERENCE', 'EXACT', cutter
    # smoothing evaluated after the holes: hole walls stay sharp, flat faces stay flat, bends stay round
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    obj.select_set(False)
    return obj


# ---------- products: each entry is a list of builders; each builder's objects are set down on the floor ----------
ASSEMBLY = json.loads((folder / 'assembly.json').read_text())['parts']  # installed positions, as in the 3D view
# material variants (v5.3 brochure families): same illustrative parts, other metal; demonstration only
VARIANTS = {
    'stainless': (material('Brushed stainless — illustrative', (.80, .81, .82), .18), material('Stainless frames', (.70, .71, .72), .25)),
    'aluminium': (material('Aluminium sheet — illustrative', (.88, .89, .90), .38), material('Aluminium frames', (.78, .79, .80), .42)),
    'black-steel': (material('Black steel — illustrative', (.03, .032, .036), .68, metallic=1.0), material('Black steel frames', (.022, .023, .026), .72, metallic=1.0)),  # mill-scale black: dark, low sheen
}
ZINC = {MAT['sheet'].name: 0, BOX['sheet'].name: 0, MAT['flange'].name: 1, BOX['flange'].name: 1}


def variant(kind, builders):
    """Run the builders, then swap the galvanised sheet and frame materials for the `kind` metal."""
    def build():
        before = set(scene.objects)
        for b in builders:
            b()
        for o in set(scene.objects) - before:
            for slot in o.material_slots:
                if slot.material and slot.material.name in ZINC:
                    slot.material = VARIANTS[kind][ZINC[slot.material.name]]
    return build


def duct_pair(kind):
    return [variant(kind, [lambda: part('duct-1', (0, -0.2, 0)), lambda: spiral_duct(f'spiral-{kind}', 0.1, 0.8, (0.05, 0.5, 0))])]


PRODUCTS = {
    'assembly': [lambda: [part_obj(p) for p in ASSEMBLY]],
    'spiral-round-duct': [lambda: spiral_duct('spiral-315', 0.1575, 1.25, (0, 0, 0)), lambda: spiral_duct('spiral-200', 0.1, 0.8, (0.05, 0.45, 0))],
    'rectangular-duct': [lambda: part('duct-1')],
    'elbows': [lambda: part('elbow-1', (-0.3, 0.2, 0), rz=0.35, rx=math.pi / 2), lambda: gored_elbow('gored-250', 0.125, 0.3125, (0.5, -0.35, 0))],
    'reducers-transitions': [lambda: part('reducer-1', (-0.45, 0.25, 0)), lambda: square_to_round('str', 0.4, 0.3, 0.125, 0.32, (0.45, -0.2, 0))],
    'tees-branches': [lambda: part('tee-1', (-.85, .45, 0)), lambda: part('family-y', (.1, -.25, 0))],
    'flanges-connectors': [lambda: part('flange-1', (-0.18, 0, 0), rz=math.pi / 2), lambda: coupling('coupling-200', 0.1, 0.16, (0.28, -0.18, 0))],
    'grilles-dampers': [lambda: grille('grille', 0.62, 0.32, (0, 0, 0))],
    'custom-assemblies': [
        lambda: bent_part('z-bracket', [(-0.16, 0.06), (-0.07, 0.06), (-0.04, -0.06), (0.16, -0.06)], 0.22, (0, 0, 0),
                          holes=[(2, 0.25, -0.06, 0.007), (2, 0.25, 0.06, 0.007), (2, 0.75, 0, 0.011), (0, 0.4, 0, 0.006)]),
        lambda: bent_part('channel', [(0.0, 0.07), (0.0, 0.0), (0.16, 0.0), (0.16, 0.07)], 0.3, (0.02, 0.5, 0),
                          holes=[(1, 0.3, -0.08, 0.008), (1, 0.7, 0.08, 0.008)])],
    'stainless-ducts': duct_pair('stainless'),
    'aluminium-ducts': duct_pair('aluminium'),
    'black-steel-ducts': duct_pair('black-steel'),
}


def world_points(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type not in ('MESH', 'CURVE') or o.hide_render:
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    return pts


def ground(objs):
    bpy.context.view_layer.update()
    z = min(p.z for p in world_points(objs))
    for o in objs:
        o.location.z -= z


def setup_render():
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 960, 100
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.3
    s = scene.render.image_settings
    s.file_format, s.color_mode, s.quality = 'WEBP', 'RGBA', 88
    # studio environment seen in the metal: dark floor, grey horizon, light sky (flat panels reflect a gradient)
    w = scene.world
    w.use_nodes = True
    nodes, links = w.node_tree.nodes, w.node_tree.links
    for n in [n for n in nodes if n.type != 'OUTPUT_WORLD']:
        nodes.remove(n)
    tc, sep, rng, ramp, bg = (nodes.new(t) for t in ('ShaderNodeTexCoord', 'ShaderNodeSeparateXYZ', 'ShaderNodeMapRange', 'ShaderNodeValToRGB', 'ShaderNodeBackground'))
    rng.inputs['From Min'].default_value, rng.inputs['From Max'].default_value = -1, 1
    stops = ((0.0, (.008, .009, .011)), (0.47, (.035, .04, .046)), (0.53, (.26, .29, .32)), (1.0, (.6, .64, .68)))
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = stops[0][0], (*stops[0][1], 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = ramp.color_ramp.elements.new(pos)
        e.color = (*col, 1)
    bg.inputs['Strength'].default_value = 1.0
    links.new(tc.outputs['Generated'], sep.inputs[0])
    links.new(sep.outputs['Z'], rng.inputs['Value'])
    links.new(rng.outputs['Result'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bg.inputs['Color'])
    links.new(bg.outputs['Background'], nodes['World Output'].inputs['Surface'])
    bpy.context.preferences.filepaths.save_version = 0


def frame_and_light():
    bpy.context.view_layer.update()
    pts = world_points(scene.objects)
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    center, span = (lo + hi) / 2, max(hi - lo)
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam = link(bpy.data.objects.new('cam', cam_data))
    cam.location = center + Vector((1.2, -1.6, 1.0)) * span * 3
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    inv = cam.rotation_euler.to_matrix().transposed()
    proj = [inv @ (p - center) for p in pts]
    xmin, xmax = min(p.x for p in proj), max(p.x for p in proj)
    ymin, ymax = min(p.y for p in proj), max(p.y for p in proj)
    cam.location += cam.rotation_euler.to_matrix() @ Vector(((xmin + xmax) / 2, (ymin + ymax) / 2, 0))
    cam_data.ortho_scale = max(xmax - xmin, (ymax - ymin) * 4 / 3) * 1.12
    cam_data.clip_end = span * 20
    scene.camera = cam
    # narrow softboxes: long highlights along the panels instead of a mirror image of a large lamp
    for name, offset, power, color in (('Key', (-0.4, -1.2, 1.6), 140, (1, .97, .93)), ('Rim', (-1.2, 0.8, 0.9), 220, (.7, .82, 1)), ('Fill', (1.4, -0.3, 0.6), 45, (.85, .9, 1))):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy, ld.shape, ld.size, ld.size_y, ld.color = power * span * span, 'RECTANGLE', span * 0.35, span * 1.6, color
        lamp = link(bpy.data.objects.new(name, ld))
        lamp.location = center + Vector(offset) * span
        lamp.rotation_euler = (center - lamp.location).to_track_quat('-Z', 'Y').to_euler()
    # shadow catcher: transparent in the image, but still reflected by the metal, so it gets a dark matte floor
    bpy.ops.mesh.primitive_plane_add(size=span * 6, location=(center.x, center.y, lo.z - 0.0005))
    floor = bpy.context.object
    floor.is_shadow_catcher = True
    floor.data.materials.append(FLOOR)


def fade_edges(img, band=0.06):
    """Fade alpha to 0 near the borders so a long contact shadow never ends in a hard line (the parts sit
    inside the camera margin, so only the shadow is affected)."""
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    ramp = lambda n: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / (band * n), 0, 1)
    rx, ry = ramp(w), ramp(h)
    m = np.outer(ry * ry * (3 - 2 * ry), rx * rx * (3 - 2 * rx))
    px[:, :, 3] *= m
    img.pixels.foreach_set(px.ravel())


def render(slug):
    for o in list(scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for build in PRODUCTS[slug]:
        before = set(scene.objects)
        build()
        ground([o for o in scene.objects if o not in before])
    frame_and_light()
    big = dest / f'{slug}-1280.webp'
    scene.render.filepath = str(big)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(big))
    fade_edges(img)
    img.file_format = 'WEBP'
    img.save(filepath=str(big), quality=88)
    img.scale(640, 480)
    img.save(filepath=str(dest / f'{slug}-640.webp'), quality=86)
    bpy.data.images.remove(img)
    print(f'rendered {slug}')


setup_render()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for slug in argv or PRODUCTS:  # 'assembly' (home page band) is rendered with the products
    render(slug)
