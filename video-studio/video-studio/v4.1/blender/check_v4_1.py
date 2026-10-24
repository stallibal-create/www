"""LIBALSTAL V4.1 — frame-by-frame mechanical inspection (background Blender).
  blender -b libalstal-v4.1.blend --python check_v4_1.py -- OUT.json
* seam gaps: every elbow seam, every frame: distance from the child gore's cut rim to the parent gore's cut rim
* jumps: per part (and camera), per-frame speed and acceleration; the largest spikes are listed
* intersections: triangle-level overlaps between parts (BVH), every 2nd frame up to 4.2 s, compared with the
  assembled pose (contacts that exist when assembled are by design: pins in receivers, sleeves over spigots)
"""
import bpy, json, math, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
OUT = sys.argv[sys.argv.index('--') + 1]
sc = bpy.data.scenes['LIBALSTAL_V4_1']; O = bpy.data.objects
SEG = [0.034297496631183705, 0.06859499326236741, 0.06859499326236741, 0.034297496631183705]
r = 0.0825; h = math.radians(15); n = 96
def rim(x0, sign):
    return [Vector((x0 + sign * r * math.cos(i / n * math.tau) * math.tan(h), r * math.cos(i / n * math.tau), r * math.sin(i / n * math.tau))) for i in range(n)]
child_rim = rim(0.0, -1)
PARTS = ['top_run', 'bottom_run', 'side_panel', 'wedge', 'collar', 'grille'] + [f'elbow_gore_{k}' for k in range(1, 5)] + [f'louvre_{k}' for k in range(1, 7)]
TRACK = PARTS + ['CAM_V4_1']
def group_of(o):
    if o.name.startswith('rail_'): return o.name[:6]
    p = o
    while p:
        if p.name in PARTS: return p.name
        p = p.parent
    return None
meshes = [o for o in sc.objects if o.type == 'MESH' and group_of(o) and o.name not in ('pulse_ring',)]
groups = sorted(set(group_of(o) for o in meshes))
dg = bpy.context.evaluated_depsgraph_get()
def bvhs():
    out = {}
    verts = {g: [] for g in groups}; polys = {g: [] for g in groups}
    for o in meshes:
        if o.hide_render: continue
        ev = o.evaluated_get(dg); me = ev.to_mesh()
        mw = np.array(o.matrix_world)
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        me.calc_loop_triangles()
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get('vertices', tri)
        g = group_of(o); base = len(verts[g])
        verts[g].extend(map(tuple, co)); polys[g].extend(map(tuple, (tri.reshape(-1, 3) + base)))
        ev.to_mesh_clear()
    for g in groups:
        if polys[g]:
            v = np.array(verts[g]); out[g] = (BVHTree.FromPolygons(verts[g], polys[g], epsilon=0.0), v.min(0), v.max(0))
    return out
def overlaps(B):
    res = {}
    keys = sorted(B)
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            (ta, amin, amax), (tb, bmin, bmax) = B[a], B[b]
            if np.any(amax < bmin) or np.any(bmax < amin): continue
            c = len(ta.overlap(tb))
            if c: res[f'{a}|{b}'] = c
    return res
# baseline: assembled pose (frame 179)
sc.frame_set(179); dg = bpy.context.evaluated_depsgraph_get(); base = overlaps(bvhs())
report = {'baseline_contacts': base, 'seam_gap_mm': {}, 'unexpected_contacts': {}, 'jumps': {}}
pos = {k: [] for k in TRACK}
worst_gap = {2: (0, 0), 3: (0, 0), 4: (0, 0)}
for f in range(180):
    sc.frame_set(f)
    for k in TRACK: pos[k].append(O[k].matrix_world.translation.copy())
    for k in (2, 3, 4):
        pm = O[f'elbow_gore_{k - 1}'].matrix_world; cm = O[f'elbow_gore_{k}'].matrix_world
        prim = [pm @ p for p in rim(SEG[k - 2], +1)]
        g = max(min((cm @ c - q).length for q in prim) for c in child_rim[::4])
        if g > worst_gap[k][0]: worst_gap[k] = (g, f)
    if f % 2 == 0 and f <= 126:
        dg = bpy.context.evaluated_depsgraph_get()
        ov = overlaps(bvhs())
        for pair, c in ov.items():
            if 'rail_' in pair:                                # rail heads bear on the run bodies by design
                report.setdefault('designed_contacts', {}).setdefault(pair, 0); report['designed_contacts'][pair] += 1; continue
            if pair not in base or c > 3 * base[pair] + 20:
                report['unexpected_contacts'].setdefault(pair, []).append([f, c])
report['seam_gap_mm'] = {f'seam_{k - 1}_{k}': {'max_mm': round(v[0] * 1000, 2), 'frame': v[1]} for k, v in worst_gap.items()}
for k, P in pos.items():
    v = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    a = [abs(v[i + 1] - v[i]) for i in range(len(v) - 1)]
    report['jumps'][k] = {'max_speed_mm_per_frame': round(max(v) * 1000, 2), 'at': v.index(max(v)),
                          'max_accel_mm_per_frame2': round(max(a) * 1000, 2), 'accel_at': a.index(max(a)) + 1}
json.dump(report, open(OUT, 'w'), indent=1)
print('CHECK:' + json.dumps({'seam_gap_mm': report['seam_gap_mm'], 'unexpected_pairs': {p: len(v) for p, v in report['unexpected_contacts'].items()}}))
