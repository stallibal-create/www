"""Headless Blender authoring for the PhotoHero title motion lookdev.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python scripts/blender-photo-hero-motion.py

Produces (no overwrite):
  brand/blender/photo-hero-motion-vN.blend
  brand/blender/photo-hero-motion-vN-preview.png   (still, frame 50)
  brand/blender/photo-hero-motion-vN.json          (motion contract)
  src/assets/js/photo-hero-timing.js               (timing contract)

Uses bpy only. No external deps.
"""
import bpy
import json
import math
import os

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)  # script parent's parent
BRAND_BLEND = os.path.join(ROOT, "brand", "blender")
SRC_JS = os.path.join(ROOT, "src", "assets", "js")
os.makedirs(BRAND_BLEND, exist_ok=True)
os.makedirs(SRC_JS, exist_ok=True)

PREFIX = "photo-hero-motion-v"


def next_free_version(directory, prefix):
    n = 1
    while True:
        blend = os.path.join(directory, f"{prefix}{n}.blend")
        if not os.path.exists(blend):
            return n
        n += 1


VERSION = next_free_version(BRAND_BLEND, PREFIX)
BASE = os.path.join(BRAND_BLEND, f"{PREFIX}{VERSION}")
BLEND_PATH = BASE + ".blend"
PREVIEW_PATH = BASE + "-preview.png"
JSON_PATH = BASE + ".json"

# ---------------------------------------------------------------------------
# Timing contract (single source of truth)
# ---------------------------------------------------------------------------
FPS = 30
HOLD_MS = 7000
TRANSITION_MS = 800
TITLE_DURATION_MS = 1000
TITLE_STAGGER_MS = 100

FRAME_START = 1
FRAME_END = 50  # preview still

# Slide animation frames (30fps)
LINE1_START = 1
LINE1_END = 31
LINE2_START = 4
LINE2_END = 34

SLIDE_DISTANCE = 0.18  # scene units below final position
START_ROT_X_DEG = -5.0

# ---------------------------------------------------------------------------
# Reset scene
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = FRAME_START
scene.frame_end = FRAME_END

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def make_material(name, base_color, metallic=0.0, roughness=0.5,
                  emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return mat
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        # Blender 4.x emission socket names
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = (*emission, 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


mat_graphite = make_material("Graphite", (0.03, 0.03, 0.035), 0.0, 0.85)
mat_silver = make_material("SilverMetal", (0.72, 0.74, 0.78), 1.0, 0.28)
mat_blue = make_material("BlueEdge", (0.05, 0.25, 0.85), 0.2, 0.4,
                         emission=(0.05, 0.3, 1.0), emission_strength=2.5)

# ---------------------------------------------------------------------------
# Backdrop plane (graphite)
# ---------------------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.5))
backdrop = bpy.context.active_object
backdrop.name = "Backdrop"
backdrop.data.materials.append(mat_graphite)

# ---------------------------------------------------------------------------
# Text objects
# ---------------------------------------------------------------------------
def make_text(name, body, size, location):
    curve = bpy.data.curves.new(name=name + "Curve", type="FONT")
    curve.body = body
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.02
    curve.bevel_depth = 0.006
    curve.bevel_resolution = 2
    obj = bpy.data.objects.new(name, curve)
    obj.location = location
    scene.collection.objects.link(obj)
    obj.data.materials.append(mat_silver)
    # Blue edge light via a second material slot on bevel is not trivial;
    # approximate with a thin blue rim plane behind text instead.
    return obj


LINE1_TEXT = "L\u2019AIR"
LINE2_TEXT = "PREND FORME."

line1 = make_text("TitleLine1", LINE1_TEXT, 0.55, (0.0, 0.55, 0.0))
line2 = make_text("TitleLine2", LINE2_TEXT, 0.55, (0.0, -0.15, 0.0))

# Blue edge-light rim planes (thin, behind text, emissive blue)
def make_rim(name, location, scale):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    rim = bpy.context.active_object
    rim.name = name
    rim.scale = scale
    rim.rotation_euler = (math.radians(90), 0, 0)
    rim.data.materials.append(mat_blue)
    return rim


rim1 = make_rim("Rim1", (0.0, 0.55, -0.05), (3.2, 0.02, 1.0))
rim2 = make_rim("Rim2", (0.0, -0.15, -0.05), (3.6, 0.02, 1.0))

# ---------------------------------------------------------------------------
# Camera (orthographic, full title with padding)
# ---------------------------------------------------------------------------
bpy.ops.object.camera_add(location=(0, 0, 8))
cam = bpy.context.active_object
cam.name = "Camera"
cam.data.type = "ORTHO"
cam.data.ortho_scale = 4.6  # generous padding around title
cam.rotation_euler = (0, 0, 0)
scene.camera = cam

# ---------------------------------------------------------------------------
# Lights (soft)
# ---------------------------------------------------------------------------
def add_area(name, location, energy, size, rot):
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.active_object
    light.name = name
    light.data.energy = energy
    light.data.size = size
    light.rotation_euler = rot
    return light


add_area("KeyLight", (-3, 3, 5), 400, 6, (math.radians(45), 0, math.radians(-30)))
add_area("FillLight", (3, -2, 4), 150, 8, (math.radians(60), 0, math.radians(30)))
add_area("RimLight", (0, 4, 3), 200, 5, (math.radians(70), 0, 0))

# ---------------------------------------------------------------------------
# Render settings (Eevee, few samples, fast)
# ---------------------------------------------------------------------------
scene.render.resolution_x = 960
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = PREVIEW_PATH

try:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.device = "CPU"
except TypeError:
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 16
        scene.cycles.device = "CPU"

if scene.render.engine.startswith("BLENDER_EEVEE"):
    try:
        scene.eevee.taa_render_samples = 8
    except AttributeError:
        pass

# ---------------------------------------------------------------------------
# Animation: Y slide with Bezier easing
# ---------------------------------------------------------------------------
def animate_slide(obj, start_frame, end_frame, final_y):
    start_y = final_y - SLIDE_DISTANCE
    obj.location.y = start_y
    obj.rotation_euler.x = math.radians(START_ROT_X_DEG)
    obj.keyframe_insert(data_path="location", index=1, frame=start_frame)
    obj.keyframe_insert(data_path="rotation_euler", index=0, frame=start_frame)

    obj.location.y = final_y
    obj.rotation_euler.x = 0.0
    obj.keyframe_insert(data_path="location", index=1, frame=end_frame)
    obj.keyframe_insert(data_path="rotation_euler", index=0, frame=end_frame)

    # Bezier easing on all fcurves of this object
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"


animate_slide(line1, LINE1_START, LINE1_END, 0.55)
animate_slide(line2, LINE2_START, LINE2_END, -0.15)

# F-curves hold the last value automatically after frame 31/34.

# ---------------------------------------------------------------------------
# Save .blend (no overwrite guaranteed by next_free_version)
# ---------------------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

# ---------------------------------------------------------------------------
# Render preview still at frame 50
# ---------------------------------------------------------------------------
scene.frame_set(FRAME_END)
bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------------------
# Export timing JS
# ---------------------------------------------------------------------------
timing_js = (
    "export const PHOTO_HERO_TIMING = Object.freeze({"
    f"fps:{FPS},holdMs:{HOLD_MS},transitionMs:{TRANSITION_MS},"
    f"titleDurationMs:{TITLE_DURATION_MS},titleStaggerMs:{TITLE_STAGGER_MS}"
    "});\n"
)
with open(os.path.join(SRC_JS, "photo-hero-timing.js"), "w", encoding="utf-8") as f:
    f.write(timing_js)

# ---------------------------------------------------------------------------
# Export motion contract JSON
# ---------------------------------------------------------------------------
def fcurve_summary(obj):
    curves = []
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            kps = [
                {"frame": kp.co[0], "value": kp.co[1],
                 "interpolation": kp.interpolation}
                for kp in fc.keyframe_points
            ]
            curves.append({
                "dataPath": fc.data_path,
                "arrayIndex": fc.array_index,
                "keyframes": kps,
            })
    return curves


contract = {
    "version": VERSION,
    "fps": FPS,
    "resolution": {"width": 960, "height": 540},
    "timing": {
        "fps": FPS,
        "holdMs": HOLD_MS,
        "transitionMs": TRANSITION_MS,
        "titleDurationMs": TITLE_DURATION_MS,
        "titleStaggerMs": TITLE_STAGGER_MS,
    },
    "motion": {
        "slideDistance": SLIDE_DISTANCE,
        "startRotXDeg": START_ROT_X_DEG,
        "line1": {"startFrame": LINE1_START, "endFrame": LINE1_END},
        "line2": {"startFrame": LINE2_START, "endFrame": LINE2_END},
        "easing": "bezier-auto-clamped",
    },
    "objects": {
        "TitleLine1": {
            "text": LINE1_TEXT,
            "curves": fcurve_summary(line1),
        },
        "TitleLine2": {
            "text": LINE2_TEXT,
            "curves": fcurve_summary(line2),
        },
    },
    "description": (
        "Blender-authored typography motion lookdev. The website uses native DOM "
        "text (not this raster) which preserves Arabic shaping; this contract "
        "documents the intended slide/easing feel for the Remotion composition."
    ),
}

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(contract, f, indent=2, ensure_ascii=False)

print(f"[photo-hero] blend:   {BLEND_PATH}")
print(f"[photo-hero] preview: {PREVIEW_PATH}")
print(f"[photo-hero] json:    {JSON_PATH}")
print(f"[photo-hero] timing:  {os.path.join(SRC_JS, 'photo-hero-timing.js')}")
