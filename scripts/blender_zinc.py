"""Shared Blender materials for LIBALSTAL renders: galvanised zinc (spangle textures written by
scripts/blender-export.mjs, same pattern and scale as the 3D view), frames, bolts, gasket, satin aluminium."""
import bpy

TILE_M = 0.3  # one texture tile per 300 mm, as UV_TILE_MM in geometry.js


def _image(folder, name, color):
    img = bpy.data.images.load(str(folder / name), check_existing=True)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return img


def material(name, color, roughness, metallic=1.0, zinc_folder=None, box=False):
    """Principled material. With zinc_folder: zinc spangle tinted by `color`, roughness = texture x roughness.
    box=True maps the texture from object coordinates (meshes without UVs), one tile per TILE_M."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    for n in [n for n in nodes if n.type != 'OUTPUT_MATERIAL']:
        nodes.remove(n)
    p = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(p.outputs['BSDF'], nodes['Material Output'].inputs['Surface'])
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if zinc_folder:
        tc, tr = nodes.new('ShaderNodeTexImage'), nodes.new('ShaderNodeTexImage')
        tc.image, tr.image = _image(zinc_folder, 'zinc-spangle.png', True), _image(zinc_folder, 'zinc-roughness.png', False)
        if box:
            coords, mapping = nodes.new('ShaderNodeTexCoord'), nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = (1 / TILE_M,) * 3
            links.new(coords.outputs['Object'], mapping.inputs['Vector'])
            for t in (tc, tr):
                t.projection, t.projection_blend = 'BOX', 0.25
                links.new(mapping.outputs['Vector'], t.inputs['Vector'])
        mix = nodes.new('ShaderNodeMix')
        mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1
        mix.inputs['A'].default_value = (*color, 1)
        links.new(tc.outputs['Color'], mix.inputs['B'])
        links.new(mix.outputs['Result'], p.inputs['Base Color'])
        scale = nodes.new('ShaderNodeMath')
        scale.operation = 'MULTIPLY'
        scale.inputs[1].default_value = roughness
        links.new(tr.outputs['Color'], scale.inputs[0])
        links.new(scale.outputs['Value'], p.inputs['Roughness'])
    return m


def detail_materials(zinc_folder, box=False):
    """The four geometry.js material groups (sheet, flange, hardware, gasket), named as glb.js MATERIAL_SLOTS."""
    suffix = ' (box)' if box else ''
    return {
        'sheet': material('Galvanised steel — illustrative' + suffix, (.68, .71, .74), 1.0, zinc_folder=zinc_folder, box=box),
        'flange': material('Connection frames' + suffix, (.5, .54, .58), 1.1, zinc_folder=zinc_folder, box=box),
        'hardware': material('Bolts and corner pieces', (.6, .63, .66), .3),
        'gasket': material('Gasket', (.02, .02, .025), .85, metallic=0),
    }
