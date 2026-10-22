"""Corta la conejita azul en láminas a partir de sus 4 dibujos de expresión.

Los cuatro PNG tienen la misma pose y están alineados píxel a píxel; solo
cambian los ojos y la boca (y un poco el temblor del trazo). La base sale del
dibujo D (ojos abiertos, boca cerrada). Los parches salen de A (ojos cerrados)
y B (boca abierta). Escribe public/azul/*.png y public/azul/rig.json.

    python3 tools/azul/build_azul.py
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'azul')
os.makedirs(OUT, exist_ok=True)


def load(name):
    return np.array(Image.open(os.path.join(HERE, name)).convert('RGBA'))


A = load('frame_A_ojos_cerrados_boca_cerrada.png')
B = load('frame_B_ojos_abiertos_boca_abierta.png')
D = load('frame_D_ojos_abiertos_boca_cerrada.png')
H, W = D.shape[:2]
alpha = D[..., 3]
solid = alpha > 100

# ---- rig placement: 600x600 rig, character 546 tall, top at 25, centered
RIG = 600
SCALE = 546.0 / H
OX = (RIG - W * SCALE) / 2
OY = 25.0


def rig(x, y):
    return [round(OX + x * SCALE, 2), round(OY + y * SCALE, 2)]


# ---- regions from the ink lines
rgb = D[..., :3].astype(int)
lum = (rgb * [0.3, 0.59, 0.11]).sum(2)
line = cv2.dilate(((lum < 110) & solid).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
_, lab = cv2.connectedComponents(((~line) & solid).astype(np.uint8), connectivity=4)


def comps(ids):
    return np.isin(lab, ids)


# Picked by hand from the component map (see README of this folder).
EAR_L = [1]
EAR_R = [2]
TAIL = [72, 73, 78, 82]
FRONT = [67, 83, 84, 86, 88]
HEAD = [6, 8, 9, 15, 16, 20, 22, 23, 24, 25, 30, 31, 39, 44, 49, 52, 53, 55, 57, 59, 60, 61, 62, 63]

# Anything else above the neck line (stray hair strands, ear shading) joins the
# closest of head / ears / tail so it moves with them.
_cy = ndi.mean(np.mgrid[0:H, 0:W][0], lab, index=np.arange(lab.max() + 1))
_cand = {'head': HEAD, 'ear_l': EAR_L, 'ear_r': EAR_R, 'tail': TAIL}
_dist = {k: ndi.distance_transform_edt(~np.isin(lab, v)) for k, v in _cand.items()}
_listed = set(EAR_L + EAR_R + TAIL + FRONT + HEAD)
for _i in range(1, lab.max() + 1):
    if _i in _listed or _cy[_i] >= 300:
        continue
    _m = lab == _i
    best = min(_cand, key=lambda k: _dist[k][_m].mean())
    _cand[best].append(_i)

# Small leftovers inside the head silhouette (glasses glints etc.) go to the head.
yy, xx = np.mgrid[0:H, 0:W]
assigned = comps(EAR_L + EAR_R + TAIL + FRONT + HEAD)
areas = np.bincount(lab.ravel())
small = (lab > 0) & ~assigned & (areas[lab] < 60)
groups_seed = {
    'front': comps(FRONT),
    'tail': comps(TAIL),
    'head': comps(HEAD),
    'ear_l': comps(EAR_L),
    'ear_r': comps(EAR_R),
}
body_seed = solid & ~line & ~assigned & ~small
groups_seed['body'] = body_seed
# small comps: nearest seed group decides
dist = {k: ndi.distance_transform_edt(~v) for k, v in groups_seed.items()}
order = ['front', 'tail', 'head', 'ear_l', 'ear_r', 'body']
stack = np.stack([dist[k] for k in order])
nearest = np.argmin(stack, axis=0)
for i, k in enumerate(order):
    groups_seed[k] = groups_seed[k] | (small & (nearest == i))
dist = {k: ndi.distance_transform_edt(~v) for k, v in groups_seed.items()}

# Ink pixels: the nearest group owns the line; on a shared line the layer on top wins.
BIAS = {'front': -1.5, 'tail': -1.0, 'head': -1.0, 'ear_l': 0.0, 'ear_r': 0.0, 'body': 0.5}
stack = np.stack([dist[k] + BIAS[k] for k in order])
owner = np.argmin(stack, axis=0)
fill_mask = {k: groups_seed[k] | ((line | ~solid) & (owner == i)) for i, k in enumerate(order)}
for k in fill_mask:
    fill_mask[k] &= alpha > 0
# every visible pixel belongs to exactly one group
taken = np.zeros((H, W), bool)
for k in order:
    fill_mask[k] &= ~taken
    taken |= fill_mask[k]
left = (alpha > 0) & ~taken
fill_mask['body'] |= left


def extend(src_mask, band, fill_from=None):
    """Copy the nearest pixel of src into band (hidden underlay, no seam when parts move).

    fill_from limits which source pixels get copied (e.g. skip ink so the
    underlay is flat colour instead of a smeared outline)."""
    seed = src_mask if fill_from is None else (src_mask & fill_from)
    if not seed.any():
        seed = src_mask
    _, (iy, ix) = ndi.distance_transform_edt(~seed, return_indices=True)
    out = np.zeros((H, W, 4), np.uint8)
    out[src_mask] = D[src_mask]
    b = band & ~src_mask & (alpha >= 250)
    out[b, :3] = D[iy[b], ix[b], :3]
    out[b, 3] = 255
    return out


def grow(mask, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0


head_m = fill_mask['head']
front_m = fill_mask['front']
body_m = fill_mask['body']
tail_m = fill_mask['tail']
ear_l_m = fill_mask['ear_l']
ear_r_m = fill_mask['ear_r']
inside = solid | grow(solid, 1)

# Head: underlay behind the star/hand (where the chin continues), only inside the silhouette.
head_img = extend(head_m, front_m & grow(head_m, 14) & (yy < 345))
# Body: underlay under the head where the body continues (collar, shoulders).
body_img = extend(body_m, head_m & grow(body_m, 26) & inside, fill_from=~line & solid)
# Ears: continue behind the hair so a swaying ear never shows a gap at its base.
ear_l_img = extend(ear_l_m, head_m & grow(ear_l_m, 12) & inside)
ear_r_img = extend(ear_r_m, head_m & grow(ear_r_m, 12) & inside)
# Hair tail: continues behind the ring.
tail_img = extend(tail_m, head_m & grow(tail_m, 10) & inside)
front_img = np.zeros((H, W, 4), np.uint8)
front_img[front_m] = D[front_m]


manifest_parts = []
files = {}


def crop_save(name, img):
    a = img[..., 3]
    ys, xs = np.where(a > 0)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    # 1px transparent margin keeps canvas smoothing from clipping edges
    x0, y0 = max(0, x0 - 1), max(0, y0 - 1)
    x1, y1 = min(W, x1 + 1), min(H, y1 + 1)
    Image.fromarray(img[y0:y1, x0:x1]).save(os.path.join(OUT, name), optimize=True)
    rx, ry = rig(x0, y0)
    return {
        'file': f'/azul/{name}',
        'x': rx, 'y': ry,
        'w': round((x1 - x0) * SCALE, 2), 'h': round((y1 - y0) * SCALE, 2),
        'px': [int(x1 - x0), int(y1 - y0)],
    }


# ---- face patches (feathered, opaque inside)
def patch(src, diff_ref, box, name, grow_px=3, feather=1.6, extra=None):
    x0, y0, x1, y1 = box
    d = np.abs(src[..., :3].astype(int) - diff_ref[..., :3].astype(int)).max(2) > 40
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = d[y0:y1, x0:x1]
    # keep only the real change (closed lids / open mouth), not the trace jitter
    m = ndi.binary_closing(m, iterations=2)
    l, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, l, range(1, n + 1))
        m = np.isin(l, [i + 1 for i, sz in enumerate(sizes) if sz >= 0.15 * sizes.max()])
    if extra is not None:
        m |= extra
    m = ndi.binary_closing(m, iterations=2)
    m = ndi.binary_fill_holes(m)
    m = grow(m, grow_px)
    m &= ~grow(front_m, 1)
    soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), feather)
    soft[~grow(m, 3)] = 0
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = src[..., :3]
    out[..., 3] = (np.clip(soft, 0, 1) * (src[..., 3] / 255.0) * 255).astype(np.uint8)
    return crop_save(name, out), m


EYE_L_BOX = (100, 200, 190, 292)
EYE_R_BOX = (198, 192, 302, 282)
MOUTH_BOX = (160, 272, 250, 326)

eye_l_closed, ml = patch(A, D, EYE_L_BOX, 'eye_l_closed.png')
eye_r_closed, mr = patch(A, D, EYE_R_BOX, 'eye_r_closed.png')
# open = the same area from D (the base already shows it; drawn so blink fades are clean)
def same_area(src, m, name):
    soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.6)
    soft[~grow(m, 3)] = 0
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = src[..., :3]
    out[..., 3] = (np.clip(soft, 0, 1) * (src[..., 3] / 255.0) * 255).astype(np.uint8)
    return crop_save(name, out)

eye_l_open = same_area(D, ml, 'eye_l_open.png')
eye_r_open = same_area(D, mr, 'eye_r_open.png')
mouth_open, mm = patch(B, D, MOUTH_BOX, 'mouth_open.png')
mouth_closed = same_area(D, mm, 'mouth_closed.png')
for e in (eye_l_closed, eye_r_closed, eye_l_open, eye_r_open, mouth_open, mouth_closed):
    e['patch'] = True

def center(m):
    ys, xs = np.where(m)
    return rig(xs.mean(), ys.mean())

# ---- parts
NECK = rig(214, 322)
FEET = rig(205, 545)
parts = []

def part(pid, img, role, parent, pivot, **kw):
    e = crop_save(f'{pid}.png', img)
    e.update({'id': pid, 'role': role, 'parent': parent, 'pivot': pivot})
    e.update(kw)
    parts.append(e)
    return e

part('body', body_img, 'static', 'body', FEET)
part('ear_l', ear_l_img, 'ear', 'head', rig(150, 104), motion={'sway': 5, 'limit': 9, 'speed': 0.4})
part('ear_r', ear_r_img, 'ear', 'head', rig(312, 118), motion={'sway': 5, 'limit': 9, 'speed': 0.36, 'phase': 0.25})
part('tail_r', tail_img, 'hair', 'head', rig(342, 300), motion={'sway': 3, 'limit': 6})
part('head', head_img, 'static', 'head', NECK, parallax=[0, 0])
parts.append({'id': 'eye_l', 'role': 'eye', 'parent': 'head', 'side': 'l', 'pivot': center(ml), 'parallax': [0, 0]})
parts.append({'id': 'eye_r', 'role': 'eye', 'parent': 'head', 'side': 'r', 'pivot': center(mr), 'parallax': [0, 0]})
parts.append({'id': 'mouth', 'role': 'mouth', 'parent': 'head', 'parallax': [0, 0]})
part('front', front_img, 'static', 'body', FEET)

thumb = Image.fromarray(D).crop((20, 0, 400, 380)).resize((64, 64), Image.LANCZOS)
bg = Image.new('RGBA', (64, 64), (36, 58, 92, 255))
bg.alpha_composite(thumb)
bg.convert('RGB').save(os.path.join(OUT, 'thumb.png'))

mouth_c = center(mm)
manifest = {
    'name': 'Conejita azul',
    'rigSize': [RIG, RIG],
    'pxPerUnit': round(1 / SCALE, 4),
    'source': 'tools/azul/frame_*.png (4 expresiones)',
    'headMotion': 0.55,
    'parts': parts,
    'mouths': {
        'neutral': mouth_closed,
        'small': mouth_open,
        'a': mouth_open,
        'o': mouth_open,
        'smile': mouth_open,
    },
    'mouthCenter': mouth_c,
    'extras': {},
    'arms': {'parts': {}, 'shoulders': {'l': rig(150, 350), 'r': rig(270, 350)}, 'hasCustom': False},
    'eyes': {
        'l': {'center': center(ml), 'styles': {'A': {'full': eye_l_open}, 'B': {'full': eye_l_open}}, 'closed': eye_l_closed},
        'r': {'center': center(mr), 'styles': {'A': {'full': eye_r_open}, 'B': {'full': eye_r_open}}, 'closed': eye_r_closed},
    },
    'eyeStyles': ['A', 'B'],
    'pivots': {
        'neck': NECK, 'feet': FEET,
        'eye_l': center(ml), 'eye_r': center(mr),
        'headTop': rig(210, 12),
    },
    'bounds': dict(zip(['x0', 'y0'], rig(0, 0))) | dict(zip(['x1', 'y1'], rig(W, H))),
    'drawOrder': [p['id'] for p in parts],
}
with open(os.path.join(OUT, 'rig.json'), 'w') as f:
    json.dump(manifest, f, indent=1, ensure_ascii=False)

# debug: recomposite must equal D
comp = Image.new('RGBA', (W, H), (0, 0, 0, 0))
for img in (body_img, ear_l_img, ear_r_img, tail_img, head_img, front_img):
    comp.alpha_composite(Image.fromarray(img))
c = np.array(comp).astype(float); d0 = D.astype(float)
c[..., :3] *= c[..., 3:] / 255; d0[..., :3] *= d0[..., 3:] / 255
diff = np.abs(c - d0).max(2)
Image.fromarray(np.array(comp)).save('/workspace/newchar/recomp.png')
print('recomposite max diff', diff.max(), 'pixels >8:', int((diff > 8).sum()))
print('wrote', OUT)
