"""Dev helper (run inside the open Blender, V3 file only): rebuild LIBALSTAL_V3 from build_v3.py, save the V3 file,
then start a background benchmark render of the shots given in BENCH = [(shot, pct, samples), ...]."""
import bpy, os, subprocess, shlex, traceback
base = os.path.expanduser('~/Desktop/libalstal/v3-claude')
out = os.path.join(base, 'libalstal-v3.blend')
assert bpy.data.filepath == out, 'open file is not the V3 file: ' + bpy.data.filepath
sc = bpy.data.scenes.get('LIBALSTAL_V3')
if sc:
    other = [s for s in bpy.data.scenes if s != sc][0]
    bpy.context.window_manager.windows[0].scene = other
    for o in list(sc.collection.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(sc.collection.children_recursive):
        bpy.data.collections.remove(c)
    w = sc.world
    bpy.data.scenes.remove(sc)
    if w: bpy.data.worlds.remove(w)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.node_groups):
        for d in list(coll):
            if d.users == 0: coll.remove(d)
f = os.path.join(base, 'blender', 'build_v3.py')
g = {'__name__': '__main__', 'PARTS_JSON': open(os.path.join(base, 'blender', 'logo_parts.json')).read(),
     'SEG': [0.34297496631183705, 0.6859499326236741, 0.6859499326236741, 0.34297496631183705], 'SAVE_TO': out}
exec(compile(open(f).read(), f, 'exec'), g)
rd = os.path.join(base, 'renders'); os.makedirs(rd, exist_ok=True)
log = os.path.join(rd, globals().get('LOG', 'bench.log'))
rs = os.path.join(base, 'blender', 'render_v3.py')
cmds = []
for shot, pct, spp, tag in globals().get('BENCH', []):
    cmds.append(' '.join(shlex.quote(x) for x in [bpy.app.binary_path, '-b', out, '--python', rs, '--', '--shot', str(shot), '--pct', str(pct), '--samples', str(spp), '--device', 'CPU', '--out', os.path.join(rd, f'{tag}.png')]) + f' >> {shlex.quote(log)} 2>&1')
if cmds:
    open(log, 'a').write('\n=== batch ' + ', '.join(b[3] for b in BENCH) + '\n')
    subprocess.Popen(['/bin/sh', '-c', ' ; '.join(cmds) + f' ; echo BATCH_DONE >> {shlex.quote(log)}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    print('started', len(cmds), 'renders ->', log)
