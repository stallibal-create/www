"""LIBALSTAL V4 — low-resolution motion test / animatic renders from libalstal-v4.blend (background Blender).
  blender -b libalstal-v4.blend --python render_v4_test.py -- --engine EEVEE|WORKBENCH --start 12 --end 102 --pct 50 --out DIR/name
Writes an H.264 MP4 (Blender's own FFmpeg). Prints RESULT: with the wall-clock time."""
import bpy, sys, time, json
a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
o = {'engine': 'EEVEE', 'start': '12', 'end': '102', 'pct': '50', 'out': '/tmp/v4test', 'samples': '16'}
i = 0
while i < len(a):
    k = a[i].lstrip('-')
    if k in o and i + 1 < len(a): o[k] = a[i + 1]; i += 2
    else: i += 1
sc = bpy.data.scenes['LIBALSTAL_V4']; r = sc.render
if o['engine'] == 'EEVEE':
    r.engine = 'BLENDER_EEVEE_NEXT'; sc.eevee.taa_render_samples = int(o['samples'])
    try:
        sc.eevee.use_raytracing = True
    except Exception: pass
elif o['engine'] == 'WORKBENCH':
    r.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
else:
    r.engine = 'CYCLES'; sc.cycles.samples = int(o['samples']); sc.cycles.device = 'CPU'
r.resolution_percentage = int(o['pct'])
sc.frame_start, sc.frame_end = int(o['start']), int(o['end'])
r.image_settings.file_format = 'FFMPEG'; r.ffmpeg.format = 'MPEG4'; r.ffmpeg.codec = 'H264'
r.ffmpeg.constant_rate_factor = 'HIGH'; r.ffmpeg.ffmpeg_preset = 'GOOD'
r.filepath = o['out']
t0 = time.time()
bpy.ops.render.render(animation=True, scene=sc.name)
print('RESULT:' + json.dumps({'engine': r.engine, 'frames': [sc.frame_start, sc.frame_end], 'res': [r.resolution_x * r.resolution_percentage // 100, r.resolution_y * r.resolution_percentage // 100], 'seconds': round(time.time() - t0, 1), 'out': r.frame_path()}))
