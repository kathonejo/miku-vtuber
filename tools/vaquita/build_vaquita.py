"""Arma la Vaquita a partir del PSD por capas de Katherine (tools/vaquita/vaquita.psd).

Solo se usan los píxeles de sus capas: se agrupan, se recortan y se reducen de
tamaño; nada se dibuja ni se deforma. Escribe public/vaquita/*.png y rig.json.

    python3 tools/vaquita/build_vaquita.py

Capas del PSD (de abajo hacia arriba) y a qué pieza van:
  ' cuerpo color'                      -> body        (cuerpo, quieto)
  'vaca cola color', 'vaca cola l'     -> tail        (cola con flor, se mece)
  'p3 *', 'p der *', 'p 2 der l *'     -> legs        (tres patas, quietas)
  'cabeza cuello' + sombra de 'cabeza vaca' que queda fuera de la cabeza
                                       -> neck        (relleno del cuello, quieto)
  'cabeza vaca' (dentro de la cabeza), 'cabeza color'
                                       -> head_color  (color y mancha negra de la cabeza)
  'ojo der'                            -> ojo de la izquierda de la pantalla
  'ojo izq' + 'cabeza - copia'         -> ojo de la derecha de la pantalla (punto y aro blanco)
  'vaca cuerpo', 'p4 color', 'p4 l'    -> body_line   (contorno y manchas del cuerpo, pata de atrás)
  'cabeza'                             -> head_line   (contorno de la cabeza, cuerno, nariz y boca)
  'Capa 5' está vacía.
No hay capas de ojos cerrados ni de boca abierta.
"""
import json
import os
import warnings

import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage
from scipy import ndimage as ndi

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'vaquita')
os.makedirs(OUT, exist_ok=True)
DBG = os.environ.get('DBG', '/workspace/newchar/vaca')

psd = PSDImage.open(os.path.join(HERE, 'vaquita.psd'))
W, H = psd.size
LAYERS = {l.name: l for l in psd if not l.is_group()}


def full(name):
    """Capa en el lienzo completo, RGBA float premultiplicado."""
    l = LAYERS[name]
    a = np.zeros((H, W, 4), np.float32)
    if l.bbox == (0, 0, 0, 0):
        return a
    im = np.asarray(l.topil().convert('RGBA')).astype(np.float32) / 255
    op = l.opacity / 255
    x0, y0 = l.left, l.top
    h, w = im.shape[:2]
    xs, ys, xe, ye = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    sub = im[ys - y0:ye - y0, xs - x0:xe - x0]
    al = sub[..., 3:] * op
    a[ys:ye, xs:xe, :3] = sub[..., :3] * al
    a[ys:ye, xs:xe, 3:] = al
    return a


def over(*imgs):
    out = np.zeros((H, W, 4), np.float32)
    for im in imgs:
        out = im + out * (1 - im[..., 3:])
    return out


def masked(img, m):
    return img * m[..., None].astype(np.float32)


# ---- cabeza: el contorno 'cabeza' cerrado y relleno marca lo que es cabeza
head_line = full('cabeza')
line_m = head_line[..., 3] > 0.25
filled = ndi.binary_fill_holes(cv2.dilate(line_m.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
head_zone = cv2.dilate(filled.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61))) > 0
# borde suave entre lo que se va con la cabeza y lo que queda en el cuello
soft = cv2.GaussianBlur(head_zone.astype(np.float32), (0, 0), 6)
head_vaca = full('cabeza vaca')
head_color = over(masked(head_vaca, soft), full('cabeza color'))
neck = over(full('cabeza cuello'), masked(head_vaca, 1 - soft))

body = full(' cuerpo color')
tail = over(full('vaca cola color'), full('vaca cola l'))
legs = over(full('p3 color'), full('p3 l'), full('p der color'), full('p der'), full('p 2 der l color'), full('p 2 der l'))
eye_scr_l = full('ojo der')
eye_scr_r = over(full('ojo izq'), full('cabeza - copia'))
body_line = over(full('vaca cuerpo'), full('p4 color'), full('p4 l'))
# El contorno del cuerpo pasa por encima de la mancha negra de la cabeza (negro sobre
# negro). Esa parte se dibuja debajo de la cabeza: quieta se ve igual, y al girar la
# cabeza no deja una línea gris suelta encima de la mancha.
_hc = over(head_color, head_line)
_dark = np.clip((0.25 - _hc[..., :3].max(2)) / 0.15, 0, 1)   # solo donde la cabeza es negra
head_cover = np.clip((_hc[..., 3] - 0.85) / 0.15, 0, 1) * _dark
body_line_under = body_line * head_cover[..., None]
body_line = body_line * (1 - head_cover[..., None])

# ---- rig: 600x600, personaje de 546 de alto con el borde de arriba en 25
allm = over(body, tail, legs, neck, head_color, eye_scr_l, eye_scr_r, body_line, head_line)[..., 3] > 0.02
ys, xs = np.where(allm)
BX0, BY0, BX1, BY1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
RIG = 600
SCALE = 546.0 / (BY1 - BY0)          # rig por píxel del PSD
OX = (RIG - (BX1 - BX0) * SCALE) / 2 - BX0 * SCALE
OY = 25.0 - BY0 * SCALE
PPU = 3.0                             # píxeles de imagen por unidad de rig


def rig(x, y):
    return [round(OX + x * SCALE, 2), round(OY + y * SCALE, 2)]


def save(name, img):
    al = img[..., 3]
    ys, xs = np.where(al > 0.004)
    pad = 6
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(W, xs.max() + 1 + pad), min(H, ys.max() + 1 + pad)
    sub = img[y0:y1, x0:x1]
    tw = max(1, round((x1 - x0) * SCALE * PPU))
    th = max(1, round((y1 - y0) * SCALE * PPU))
    small = cv2.resize(sub, (tw, th), interpolation=cv2.INTER_AREA)
    a = np.clip(small[..., 3:], 0, 1)
    rgb = np.where(a > 1e-4, small[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), a], 2)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name), optimize=True)
    rx, ry = rig(x0, y0)
    return {'file': f'/vaquita/{name}', 'x': rx, 'y': ry,
            'w': round((x1 - x0) * SCALE, 2), 'h': round((y1 - y0) * SCALE, 2), 'px': [tw, th]}


def center(img):
    ys, xs = np.where(img[..., 3] > 0.3)
    return rig(xs.mean(), ys.mean())


NECK = rig(640, 1310)      # entre el mentón y la mancha, más cerca del mentón (la unión con el pecho casi no se abre)
FEET = rig(1150, 2650)
TAIL_BASE = rig(1790, 1200)
parts = []


def part(pid, img, role, parent, pivot, **kw):
    e = save(f'{pid}.png', img)
    e.update({'id': pid, 'role': role, 'parent': parent, 'pivot': pivot})
    e.update(kw)
    parts.append(e)
    return e


part('body', body, 'static', 'body', FEET)
part('tail', tail, 'hair', 'body', TAIL_BASE, motion={'sway': 4, 'limit': 7, 'speed': 0.35})
part('legs', legs, 'static', 'body', FEET)
part('neck', neck, 'static', 'body', FEET)
part('body_line_under', body_line_under, 'static', 'body', FEET)
part('head_color', head_color, 'static', 'head', NECK, parallax=[0, 0])
eye_l = save('eye_l_open.png', eye_scr_l)
eye_r = save('eye_r_open.png', eye_scr_r)
parts.append({'id': 'eye_l', 'role': 'eye', 'parent': 'head', 'side': 'l', 'pivot': center(eye_scr_l), 'parallax': [0, 0]})
parts.append({'id': 'eye_r', 'role': 'eye', 'parent': 'head', 'side': 'r', 'pivot': center(eye_scr_r), 'parallax': [0, 0]})
part('body_line', body_line, 'static', 'body', FEET)
part('head_line', head_line, 'static', 'head', NECK, parallax=[0, 0])

comp = over(body, tail, legs, neck, body_line_under, head_color, eye_scr_l, eye_scr_r, body_line, head_line)
ref = psd.composite()
ref = np.asarray(ref).astype(np.float32) / 255
ref[..., :3] *= ref[..., 3:]
print('recomposite vs PSD: max diff', float(np.abs(comp - ref).max()), 'px > 3/255:', int((np.abs(comp - ref).max(2) > 3 / 255).sum()))

# miniatura: la cabeza
cx0, cy0, cx1, cy1 = 140, 560, 1180, 1600
th = comp[cy0:cy1, cx0:cx1]
th = cv2.resize(th, (64, 64), interpolation=cv2.INTER_AREA)
bg = np.zeros((64, 64, 3), np.float32) + np.array([1.0, 0.86, 0.9], np.float32)
rgb = th[..., :3] + bg * (1 - th[..., 3:])
Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'thumb.png'))

manifest = {
    'name': 'Vaquita',
    'rigSize': [RIG, RIG],
    'pxPerUnit': PPU,
    'source': 'tools/vaquita/vaquita.psd (capas)',
    'id': 'vaquita',
    'headMotion': 0.35,
    'headRigid': True,
    'headRoll': 0.4,
    'paperEdge': False,
    'swap': {
        # no hay boca abierta en el PSD: la boca dibujada en 'cabeza' queda fija
        'mouth': {'on': 0.07, 'off': 0.04, 'holdMs': 70, 'drop': 0.6, 'openId': 'a', 'closedId': 'neutral'},
        'eyes': {'close': 0.55, 'open': 0.35},
    },
    'parts': parts,
    'mouths': {},
    'mouthCenter': rig(400, 1180),
    'extras': {},
    'arms': {'parts': {}, 'shoulders': {'l': rig(500, 1500), 'r': rig(800, 1500)}, 'hasCustom': False},
    'eyes': {
        'l': {'center': center(eye_scr_l), 'styles': {'A': {'full': eye_l}, 'B': {'full': eye_l}}, 'closed': None},
        'r': {'center': center(eye_scr_r), 'styles': {'A': {'full': eye_r}, 'B': {'full': eye_r}}, 'closed': None},
    },
    'eyeStyles': ['A', 'B'],
    'pivots': {
        'neck': NECK, 'feet': FEET,
        'eye_l': center(eye_scr_l), 'eye_r': center(eye_scr_r),
        'headTop': rig(480, 625),
    },
    'bounds': dict(zip(['x0', 'y0'], rig(BX0, BY0))) | dict(zip(['x1', 'y1'], rig(BX1, BY1))),
    'drawOrder': [p['id'] for p in parts],
}
with open(os.path.join(OUT, 'rig.json'), 'w') as f:
    json.dump(manifest, f, indent=1, ensure_ascii=False)
if DBG and os.path.isdir(DBG):
    Image.fromarray((np.clip(soft, 0, 1) * 255).astype(np.uint8)).resize((W // 4, H // 4)).save(os.path.join(DBG, 'head_zone.png'))
print('wrote', OUT, 'scale', round(SCALE, 4))
if os.environ.get('DIFFMAP'):
    d = np.abs(comp - ref).max(2) > 3 / 255
    ys, xs = np.where(d & (np.abs(comp - ref).max(2) > 0.2))
    print('big diffs', len(xs), xs.min() if len(xs) else None, xs.max() if len(xs) else None, ys.min() if len(xs) else None, ys.max() if len(xs) else None)
