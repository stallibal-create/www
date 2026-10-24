#!/usr/bin/env python3
"""LIBALSTAL V3 — emblem silhouette check (no Blender needed).

Scores how closely a 3D model's ASSEMBLED pose, seen straight from the front, covers the official emblem.
Truth = video-studio/v3/truth/emblem-parts.png: each pixel of the official PNG's emblem labelled with the part it
belongs to (from the vector guide's part outlines, clipped to the official artwork's alpha).

    python3 v3/tools/emblem_fit.py plan                      # the planned final layout (blender/logo_parts.json)
    python3 v3/tools/emblem_fit.py glb MODEL.glb [--map MAP.json] [--out overlay.png] [--register bbox|contract]

--register contract: the model is placed in glb-contract.json's logoFrame (1 logo px = 1 mm, origin at the PNG's
top-left, +Y up), so no fitting is done and any drift or scale error counts against it (use for V3 exports).
--register bbox (default): scale + offset are fitted from the bounding box (for models built in another frame).

`glb` mode reads a glTF 2.0 binary (node TRS hierarchy, rest pose = assembled), projects it orthographically onto
the XY plane (glTF +Y up, viewer on +Z), fits uniform scale + offset so the emblem's bounding box matches the
official one, rasterises each node and reports IoU per logo part (via --map: node-name prefix -> part) and overall.
Prints JSON; exit status 1 when any part scores below its threshold (used as a gate before rendering).
Needs: numpy, Pillow.
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
V3 = HERE.parent
STUDIO = V3.parent
TRUTH = V3 / 'truth'
W, H = 2076, 625
EMBLEM_X1 = 660                     # emblem occupies x < 660 px on the official artwork; the wordmark is never modelled
THRESHOLDS = {'topRun': 0.85, 'bottomRun': 0.85, 'sidePanel': 0.85, 'wedge': 0.75, 'elbow': 0.80, 'collar': 0.80, 'grille': 0.85, 'emblem': 0.88}


def truth():
    meta = json.loads((TRUTH / 'emblem-parts.json').read_text())
    lab = np.array(Image.open(TRUTH / 'emblem-parts.png'))
    return meta, lab


def iou(a, b):
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 0.0


# ------------------------------------------------------------------ plan mode: 2D outlines from logo_parts.json
def plan_masks():
    P = json.loads((STUDIO / 'blender' / 'logo_parts.json').read_text())['parts']
    px = lambda x, y: (x * 100.0, -y * 100.0)          # world units -> logo px
    masks = {}

    def new():
        im = Image.new('L', (W, H), 0)
        return im, ImageDraw.Draw(im)

    def rect(d, x0, x1, y0, y1):
        a, b = px(x0, y1), px(x1, y0)
        d.rectangle([a[0], a[1], b[0], b[1]], fill=255)

    for name in ('topRun', 'bottomRun'):
        p = P[name]
        im, d = new()
        rect(d, p['x'][0] + p['flange'], p['x'][1] - p['flange'], p['body'][0], p['body'][1])        # body
        for x0 in (p['x'][0], p['x'][1] - p['flange']):
            rect(d, x0, x0 + p['flange'], p['y'][0], p['y'][1])                                    # flange frames
        masks[name] = im
    for name in ('sidePanel', 'wedge'):
        p = P[name]
        im, d = new()
        poly = p.get('outline') or [[p['x'][0], p['y'][1]], [p['x'][1], p['y'][1]], [p['x'][1], p['y'][0]], [p['x'][0], p['y'][0]]]
        d.polygon([px(*q) for q in poly], fill=255)
        masks[name] = im
    e = P['elbow']
    im, d = new()
    r, R = e['diameter'] / 2, e['radius']
    cx, cy = e['start'][0], e['start'][1] - R                       # bend centre (turns from +X down to -Y)
    outer = [px(cx + (R + r) * math.sin(t), cy + (R + r) * math.cos(t)) for t in np.linspace(0, math.pi / 2, 64)]
    inner = [px(cx + (R - r) * math.sin(t), cy + (R - r) * math.cos(t)) for t in np.linspace(math.pi / 2, 0, 64)]
    d.polygon(outer + inner, fill=255)
    if 'exitFlange' in e:
        f = e['exitFlange']; rect(d, f['x'][0], f['x'][1], f['y'][0], f['y'][1])
    masks['elbow'] = im
    c = P['collar']
    im, d = new()
    rect(d, c['axisX'] - c['radius'], c['axisX'] + c['radius'], c['y'][0], c['y'][1])
    masks['collar'] = im
    g = P['grille']
    im, d = new()
    rect(d, g['x'][0], g['x'][1], g['y'][0], g['y'][1])
    masks['grille'] = im
    return {k: np.array(v) > 127 for k, v in masks.items()}


# ------------------------------------------------------------------ glb mode
def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    M = np.eye(4)
    S = np.diag(n.get('scale', [1, 1, 1]))
    M[:3, :3] = quat_mat(n.get('rotation', [0, 0, 0, 1])) @ S
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def read_glb(path):
    b = Path(path).read_bytes()
    if b[:4] != b'glTF':
        raise SystemExit('not a GLB file')
    jl = struct.unpack_from('<I', b, 12)[0]
    J = json.loads(b[20:20 + jl])
    bin0 = 20 + jl + 8
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(i):
        a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        off = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride', dt.itemsize * n)
        raw = np.frombuffer(b, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=off)
        out = np.lib.stride_tricks.as_strided(raw[:dt.itemsize * n].view(dt), shape=(a['count'], n), strides=(stride, dt.itemsize)) if stride != dt.itemsize * n else raw.view(dt).reshape(a['count'], n)
        return np.array(out, dtype=np.float64 if dt == np.float32 else np.int64)

    world = {}
    parents = {c: i for i, n in enumerate(J['nodes']) for c in n.get('children', [])}

    def wm(i):
        if i not in world:
            world[i] = (wm(parents[i]) if i in parents else np.eye(4)) @ node_matrix(J['nodes'][i])
        return world[i]

    tris = []
    for i, n in enumerate(J['nodes']):
        if 'mesh' not in n:
            continue
        M = wm(i)
        for p in J['meshes'][n['mesh']]['primitives']:
            if p.get('mode', 4) != 4:
                continue
            P = acc(p['attributes']['POSITION'])
            P = (M @ np.c_[P, np.ones(len(P))].T).T[:, :3]
            I = acc(p['indices']).ravel() if 'indices' in p else np.arange(len(P))
            tris.append((n.get('name', f'node{i}'), P[I.reshape(-1, 3)]))
    return J, tris


def glb_masks(tris, mapping, official_emblem, register='bbox'):
    allp = np.concatenate([t.reshape(-1, 3) for _, t in tris])
    x0, x1, y0, y1 = allp[:, 0].min(), allp[:, 0].max(), allp[:, 1].min(), allp[:, 1].max()
    ys, xs = np.where(official_emblem)
    tx0, tx1, ty0, ty1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    if register == 'contract':                                    # glb-contract logoFrame: 1 m = 1000 px, origin = PNG top-left
        s, ox, oy = 1000.0, 0.0, 0.0
    else:                                                         # foreign model: uniform scale from the height, centred
        s = (ty1 - ty0) / (y1 - y0)
        ox = (tx0 + tx1) / 2 - s * (x0 + x1) / 2
        oy = (ty0 + ty1) / 2 + s * (y0 + y1) / 2

    ims = {}
    for name, T in tris:
        part = next((v for k, v in mapping.items() if name.startswith(k)), 'unmapped')
        im = ims.setdefault(part, Image.new('L', (W, H), 0))
        d = ImageDraw.Draw(im)
        for t in T:
            d.polygon([(ox + s * v[0], oy - s * v[1]) for v in t], fill=255)
    return {k: np.array(v) > 127 for k, v in ims.items()}, {'scale_px_per_unit': s, 'model_aspect': (x1 - x0) / (y1 - y0), 'official_aspect': (tx1 - tx0) / (ty1 - ty0)}


# ------------------------------------------------------------------ scoring + overlay
def score(masks, meta, lab, out=None):
    ids = meta['ids']
    official = np.zeros(lab.shape, bool); official[:, :EMBLEM_X1] = lab[:, :EMBLEM_X1] > 0
    res = {}
    for part, pid in ids.items():
        if part in masks:
            res[part] = round(iou(masks[part], lab == pid), 3)
    union = np.zeros(lab.shape, bool)
    for m in masks.values():
        union |= m
    union[:, EMBLEM_X1:] = False
    res['emblem'] = round(iou(union, official), 3)
    fails = {k: v for k, v in res.items() if v < THRESHOLDS.get(k, 0.85)}
    if out:
        rgb = np.zeros((H, EMBLEM_X1, 3), np.uint8)
        o, m = official[:, :EMBLEM_X1], union[:, :EMBLEM_X1]
        rgb[o & m] = (150, 155, 160)       # both: grey
        rgb[o & ~m] = (230, 60, 60)        # missing from the model: red
        rgb[~o & m] = (60, 140, 255)       # model where the logo has nothing: blue
        Image.fromarray(rgb).save(out)
    return res, fails


def main(argv):
    if not argv or argv[0] not in ('plan', 'glb'):
        print(__doc__); return 2
    meta, lab = truth()
    out = argv[argv.index('--out') + 1] if '--out' in argv else None
    extra = {}
    if argv[0] == 'plan':
        masks = plan_masks()
    else:
        mapping = json.loads(Path(argv[argv.index('--map') + 1]).read_text()) if '--map' in argv else {}
        J, tris = read_glb(argv[1])
        official = np.zeros(lab.shape, bool); official[:, :EMBLEM_X1] = lab[:, :EMBLEM_X1] > 0
        reg = argv[argv.index('--register') + 1] if '--register' in argv else 'bbox'
        masks, extra = glb_masks(tris, mapping, official, reg)
        extra['register'] = reg
        extra['triangles'] = int(sum(len(t) for _, t in tris)); extra['nodes'] = len(J['nodes'])
    res, fails = score(masks, meta, lab, out)
    print(json.dumps({'mode': argv[0], 'iou': res, 'below_threshold': fails, **extra}, indent=1))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
