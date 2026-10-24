"""LIBALSTAL V4.1 — low-res motion tests (background Blender).
  blender -b libalstal-v4.1.blend --python render_v4_1_test.py -- --engine EEVEE|WORKBENCH --camera CINE|ENG --start 0 --end 108 --pct 50 --out DIR/name
CINE = the animated CAM_V4_1; ENG = a fixed 3/4 engineering camera that sees the whole assembly (for inspection)."""
import bpy, sys, time, json, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
o = {'engine': 'EEVEE', 'camera': 'CINE', 'start': '0', 'end': '108', 'pct': '50', 'out': '/tmp/v41', 'samples': '16'}
i = 0
while i < len(a):
    k = a[i].lstrip('-')
    if k in o and i + 1 < len(a): o[k] = a[i + 1]; i += 2
    else: i += 1
sc = bpy.data.scenes['LIBALSTAL_V4_1']; r = sc.render
if o['camera'] == 'ENG':
    cd = bpy.data.cameras.new('CAM_ENG'); cd.lens = 32; cd.sensor_width = 36
    cam = bpy.data.objects.new('CAM_ENG', cd); sc.collection.objects.link(cam)
    t = Vector((0.40, 0.06, -0.24)); cam.location = t + Vector((-0.55, -1.25, 0.55))
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler(); sc.camera = cam
if o['engine'] == 'EEVEE':
    r.engine = 'BLENDER_EEVEE_NEXT'; sc.eevee.taa_render_samples = int(o['samples'])
elif o['engine'] == 'WORKBENCH':
    r.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True
    for nme in ('LIGHTS',):
        pass
r.resolution_percentage = int(o['pct'])
sc.frame_start, sc.frame_end = int(o['start']), int(o['end'])
r.image_settings.file_format = 'FFMPEG'; r.ffmpeg.format = 'MPEG4'; r.ffmpeg.codec = 'H264'
r.ffmpeg.constant_rate_factor = 'HIGH'; r.ffmpeg.ffmpeg_preset = 'GOOD'
r.filepath = o['out']
t0 = time.time()
bpy.ops.render.render(animation=True, scene=sc.name)
print('RESULT:' + json.dumps({'engine': r.engine, 'camera': sc.camera.name, 'frames': [sc.frame_start, sc.frame_end], 'seconds': round(time.time() - t0, 1), 'out': r.frame_path()}))
