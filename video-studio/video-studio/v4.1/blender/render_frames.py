"""LIBALSTAL V4.1 — Cycles frame sequence for the Remotion composition (background Blender).
  blender -b libalstal-v4.1.blend --python render_frames.py -- --start 0 --end 179 --pct 100 --samples 32 --out DIR/
Skips frames that already exist (resumable). Prints FRAME n seconds for every frame."""
import bpy, sys, os, time
a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
o = {'start': '0', 'end': '179', 'pct': '100', 'samples': '32', 'out': '/tmp/v41/', 'step': '1', 'threshold': '0.03', 'w': '', 'h': ''}
i = 0
while i < len(a):
    k = a[i].lstrip('-')
    if k in o and i + 1 < len(a): o[k] = a[i + 1]; i += 2
    else: i += 1
sc = bpy.data.scenes['LIBALSTAL_V4_1']; r = sc.render; cy = sc.cycles
r.engine = 'CYCLES'; cy.device = 'CPU'; cy.samples = int(o['samples']); cy.use_adaptive_sampling = True
cy.adaptive_threshold = float(o['threshold']); cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'
cy.seed = 0; cy.use_animated_seed = False                 # fixed noise pattern: less shimmer between frames
r.use_persistent_data = True; r.resolution_percentage = int(o['pct'])
if o['w']:
    r.resolution_x, r.resolution_y, r.resolution_percentage = int(o['w']), int(o['h']), 100
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGB'; r.image_settings.color_depth = '8'
os.makedirs(o['out'], exist_ok=True)
for f in range(int(o['start']), int(o['end']) + 1, int(o['step'])):
    path = os.path.join(o['out'], f'{f:04d}.png')
    if os.path.exists(path): continue
    sc.frame_set(f); r.filepath = path; t0 = time.time()
    bpy.ops.render.render(write_still=True, scene=sc.name)
    print(f'FRAME {f} {time.time() - t0:.1f}', flush=True)
print('ALL_DONE')
