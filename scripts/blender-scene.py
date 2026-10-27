"""Run after node scripts/blender-export.mjs, using Blender --background --python.
All dimensions are inherited demonstration values, not manufacturing specifications.
"""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
root = Path(__file__).resolve().parent.parent
out = root / 'brand' / 'blender'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
branches = '--branches' in args
suffix = '-branches' if branches else ''
data = json.loads((out / f'assembly{suffix}.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_zinc import detail_materials
# order = geometry.js MATERIALS; names = glb.js MATERIAL_SLOTS
MATERIALS = detail_materials(out)
SLOT = {k: i for i, k in enumerate(MATERIALS)}
objects = []
for part in data['parts']:
    mesh = bpy.data.meshes.new(part['id'])
    idx = part['indices']
    mesh.from_pydata(part['vertices'], [], [idx[i:i+3] for i in range(0, len(idx), 3)])
    mesh.update()
    for m in MATERIALS.values(): mesh.materials.append(m)
    for group in part['groups']:
        for i in range(group['start']//3, (group['start']+group['count'])//3):
            mesh.polygons[i].material_index = SLOT[group['material']]
    uv = mesh.uv_layers.new(name='UVMap')
    loop_vertex = [0] * len(mesh.loops); mesh.loops.foreach_get('vertex_index', loop_vertex)
    uv.data.foreach_set('uv', [c for v in loop_vertex for c in part['uvs'][v]])
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    mesh.normals_split_custom_set_from_vertices(part['normals'])  # keep the generator's normals (smooth elbow, flat facets)
    obj = bpy.data.objects.new(part['id'], mesh)
    bpy.context.collection.objects.link(obj)
    obj['demo'] = True
    objects.append(obj)
points = [v.co for obj in objects for v in obj.data.vertices]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (lo + hi) / 2
span = max(hi - lo)
scene = bpy.context.scene
scene['notice'] = 'LIBALSTAL demonstration assembly — dimensions unverified'
scene.unit_settings.system = 'METRIC'
bpy.ops.object.camera_add(location=center + Vector((.4, -1, .9))*span)
camera = bpy.context.object
camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
# Fit actual projected vertices, rather than the world-axis bounding box.
rotation_inv = camera.rotation_euler.to_matrix().transposed()
projected = [rotation_inv @ (p - center) for p in points]
xmin, xmax = min(p.x for p in projected), max(p.x for p in projected)
ymin, ymax = min(p.y for p in projected), max(p.y for p in projected)
shift = camera.rotation_euler.to_matrix() @ Vector(((xmin+xmax)/2, (ymin+ymax)/2, 0))
camera.location += shift
aspect = 1400 / 1000
camera.data.ortho_scale = max(xmax-xmin, (ymax-ymin)*aspect) * 1.16
scene.camera = camera
for name, offset, power, color in [
    ('Key', (0,-1,2), 420, (1,.96,.91)),
    ('Fill', (1,1,1), 160, (.78,.87,1)),
    ('Rim', (-1,0,1), 600, (.62,.77,1))]:
    bpy.ops.object.light_add(type='AREA', location=center+Vector(offset)*span)
    light = bpy.context.object
    light.name = name
    light.data.energy = power * span * span
    light.data.shape = 'DISK'
    light.data.size = span * 1.4
    light.data.color = color
    light.rotation_euler = (center-light.location).to_track_quat('-Z','Y').to_euler()
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get('Background')
background.inputs['Color'].default_value = (.28, .32, .4, 1)
background.inputs['Strength'].default_value = .35
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
# Avoid automatic .blend1 backups on repeated scripted builds.
bpy.context.preferences.filepaths.save_version = 0
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
bpy.ops.object.select_all(action='DESELECT')
for obj in objects: obj.select_set(True)
models = root / 'src' / 'assets' / 'models'
models.mkdir(parents=True, exist_ok=True)
# the 3D view generates its own zinc texture: no images in the GLB keeps it small
bpy.ops.export_scene.gltf(filepath=str(models/('duct-assembly-branches.glb' if branches else 'duct-assembly-demo.glb')), use_selection=True, export_format='GLB',
                          export_texcoords=True, export_normals=True, export_image_format='NONE')
# Keep all previous Blender scenes: save the next unused version.
stem = 'duct-assembly-branches' if branches else 'duct-assembly-demo'
version = 2
blend = out / f'{stem}-v{version}.blend'
while blend.exists():
    version += 1
    blend = out / f'{stem}-v{version}.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
scene.render.filepath = str(out/f'{stem}-v{version}-preview.png')
bpy.ops.render.render(write_still=True)
