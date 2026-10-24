"""LIBALSTAL V3 — render one still from libalstal-v3.blend (run in a background Blender process).

  blender -b libalstal-v3.blend --python render_v3.py -- --shot 1 --pct 100 --samples 256 --device CPU --out FILE.png

Shots: 1 hero (3/4), 2 detail (100 mm close-up), 3 transformation in progress, 4 completed emblem with airflow.
Shot 3 poses the parts from their contract pivots (no new geometry). Airflow is shown on shot 4 only.
Prints one JSON line starting with RESULT: (settings + wall-clock render time).
"""
import json
import math
import sys
import time

import bpy

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
o = {'shot': '1', 'pct': '100', 'samples': '256', 'device': 'CPU', 'out': '/tmp/out.png', 'threshold': '0.015', 'border': ''}
i = 0
while i < len(a):
    k = a[i].lstrip('-')
    if k in o and i + 1 < len(a):
        o[k] = a[i + 1]; i += 2
    else:
        i += 1

sc = bpy.data.scenes['LIBALSTAL_V3']
if bpy.context.window_manager.windows:
    bpy.context.window_manager.windows[0].scene = sc
cams = {'1': 'CAM_1_hero', '2': 'CAM_2_detail', '3': 'CAM_3_transform', '4': 'CAM_4_airflow'}
sc.camera = bpy.data.objects[cams[o['shot']]]
bpy.data.collections['AIRFLOW'].hide_render = o['shot'] != '4'

# ---- device
cy = sc.cycles
if o['device'] != 'CPU':
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = o['device']; prefs.refresh_devices()
    for d in prefs.devices:
        d.use = d.type == o['device']
    cy.device = 'GPU'
else:
    cy.device = 'CPU'
cy.samples = int(o['samples']); cy.adaptive_threshold = float(o['threshold'])
r = sc.render
r.resolution_percentage = int(o['pct'])
r.threads_mode = 'AUTO'
if o['border']:                                   # x0,y0,x1,y1 in 0..1 (benchmark crops)
    x0, y0, x1, y1 = (float(v) for v in o['border'].split(','))
    r.use_border = True; r.use_crop_to_border = True
    r.border_min_x, r.border_min_y, r.border_max_x, r.border_max_y = x0, y0, x1, y1

# ---- shot 3: transformation in progress, posed on the contract pivots
if o['shot'] == '3':
    ob = bpy.data.objects
    ob['top_run'].location.y += 0.075                                  # rising on its rails
    ob['top_run'].location.z += 0.018
    ob['side_panel'].rotation_euler.y += math.radians(52)              # swinging on its inner hinge
    ob['side_panel'].location.z += 0.02
    ob['wedge'].location.x += -0.8 * 0.065; ob['wedge'].location.y += 0.6 * 0.065; ob['wedge'].location.z += 0.05
    for k, f in ((2, 0.55), (3, 0.75), (4, 0.9)):                     # elbow seams un-bending in sequence
        ob[f'elbow_gore_{k}'].rotation_euler.z += math.radians(30) * f
    ob['collar'].location.x += 0.11; ob['collar'].location.z += 0.05              # rides on the grille's spigot
    ob['grille'].location.x += 0.11; ob['grille'].location.z += 0.05
    for k in range(1, 7):                                              # louvres flipping, staggered
        ob[f'louvre_{k}'].rotation_euler.x = math.radians(-35 - 50 * (k / 6))
    # telescopic guide rails that carry the rising top run (3 stainless stages, from the bottom run's top face)
    import bmesh
    from mathutils import Vector
    root = ob['LIBALSTAL_emblem']; mat = bpy.data.materials['stainless_brushed']
    y_lo, y_hi = -3.632 * 0.1, -1.816 * 0.1 + 0.075
    for side, x in (('l', 0.215), ('r', 0.36)):
        for st, (w, f0, f1) in enumerate(((0.016, 0.0, 0.42), (0.012, 0.36, 0.74), (0.009, 0.68, 1.0))):
            h = (y_hi - y_lo) * (f1 - f0)
            bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=Vector((w, h, w)), verts=bm.verts)
            me = bpy.data.meshes.new(f'rail_{side}{st}'); bm.to_mesh(me); bm.free(); me.materials.append(mat)
            o2 = bpy.data.objects.new(f'rail_{side}_{st}', me); sc.collection.objects.link(o2)
            o2.parent = root; o2.location = (x, y_lo + (y_hi - y_lo) * (f0 + f1) / 2, -0.06)
            bv = o2.modifiers.new('b', 'BEVEL'); bv.width = 0.0012; bv.segments = 2

r.filepath = o['out']
t0 = time.time()
bpy.ops.render.render(write_still=True, scene=sc.name)
dt = time.time() - t0
print('RESULT:' + json.dumps({'shot': o['shot'], 'camera': sc.camera.name, 'lens_mm': sc.camera.data.lens,
      'fstop': sc.camera.data.dof.aperture_fstop if sc.camera.data.dof.use_dof else None,
      'res': [r.resolution_x * r.resolution_percentage // 100, r.resolution_y * r.resolution_percentage // 100],
      'border': o['border'], 'samples': cy.samples, 'adaptive_threshold': cy.adaptive_threshold, 'device': o['device'],
      'denoiser': cy.denoiser, 'seconds': round(dt, 1), 'out': o['out']}))
