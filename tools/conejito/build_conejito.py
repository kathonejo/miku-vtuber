"""Arma el Conejito del Diario de dibujo a partir del PSD por capas (v3: 6 capas, 2900x2400, sin máscaras).

Solo se usan los píxeles de sus capas: se recortan y se reducen de tamaño; nada se
dibuja ni se deforma. Escribe public/conejito/*.png y public/conejito/rig.json.

    python3 tools/conejito/build_conejito.py [carpeta/capas]

Lee los PNG de capas (mismo lienzo de 2900x2400, alineados) que salen de conejito_capas.psd; ni el PSD
(30 MB) ni los PNG grandes se guardan en el repositorio. Por defecto: /workspace/diario-redes/video/conejito/capas
(o CONEJITO_CAPAS).

Capas del PSD (de abajo hacia arriba) -> piezas del rig:
  cuerpo (con la cola)       -> body       quieto (respira con el cuerpo)
  cabeza                     -> head       gira / se inclina con la cabeza
  oreja_izq, oreja_der       -> ear_l/_r   con la cabeza + resorte con rebote
  ojo_abierto|cerrado    -> eye_r      parpadeo: cambio de golpe abierto/cerrado (único ojo)

Sin boca, sin cejas y con UN solo ojo (a pedido de Katherine): es el ojo del dibujo original (ref_conejo.png).

Los lados siguen la posición en pantalla (l = izquierda de la pantalla); el ojo único va como eye_r.
"""
import hashlib
import json
import os
import sys
import warnings

import cv2
import numpy as np
from PIL import Image

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'conejito')
os.makedirs(OUT, exist_ok=True)
CAPAS = (sys.argv[1] if len(sys.argv) > 1 else
         os.environ.get('CONEJITO_CAPAS', '/workspace/diario-redes/video/conejito/capas'))

# Se leen los PNG de capas/ (mismo lienzo, alineados), iguales a las capas del PSD.
W, H = 2900, 2400


def full(path):
    """Capa en el lienzo completo, RGBA float premultiplicado."""
    im = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    assert im.shape[:2] == (H, W), path
    a = np.zeros_like(im)
    a[..., :3] = im[..., :3] * im[..., 3:]
    a[..., 3:] = im[..., 3:]
    return a


NAMES = ['cuerpo', 'cabeza', 'oreja_izq', 'oreja_der', 'ojo_abierto', 'ojo_cerrado']
IMG = {n: full(os.path.join(CAPAS, n + '.png')) for n in NAMES}

# v3: el relleno blanco ya está extendido bajo la base de las orejas (sin muesca hasta ±30°) y sin halo a la
# izquierda de la cabeza, así que no se agrega ningún relleno: solo se usan los píxeles de las capas.

# ---- rig 600x600: el conejito es ancho, 500 unidades de ancho, centrado
BX0, BY0, BX1, BY1 = 214, 402, 2684, 1999      # encuadre fijo (todas las capas visibles)
RIG = 600
SCALE = 500.0 / (BX1 - BX0)
OX = (RIG - (BX1 - BX0) * SCALE) / 2 - BX0 * SCALE
OY = 190.0 - BY0 * SCALE
PPU = 3.0


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
    return {'file': f'/conejito/{name}', 'x': rx, 'y': ry,
            'w': round((x1 - x0) * SCALE, 2), 'h': round((y1 - y0) * SCALE, 2), 'px': [tw, th]}


def center(img):
    ys, xs = np.where(img[..., 3] > 0.3)
    return rig(xs.mean(), ys.mean())


# pivotes (en píxeles del PSD)
NECK = rig(800, 1450)        # eje de giro de la cabeza (bajo la mejilla): así la cuña de arriba casi no se abre
FEET = rig(1450, 1999)       # base del cuerpo: respira y se inclina desde aquí
EAR_L_BASE = rig(790, 700)   # oreja chica (izquierda de la pantalla): pivote que diseñó Teatro
EAR_R_BASE = rig(1215, 925)  # oreja grande: pivote que diseñó Teatro
EAR_MOTION = {'sway': 1.5, 'speed': 0.4, 'stiffness': 110, 'damping': 8, 'gravity': 0, 'follow': 1.4, 'limit': 9}   # las orejas se mueven en sentido contrario al girar: límite bajo para que no se abra la unión entre ellas

parts = []


def part(pid, name, role, parent, pivot, **kw):
    e = save(f'{pid}.png', IMG[name])
    e.update({'id': pid, 'role': role, 'parent': parent, 'pivot': pivot, 'psdName': [name]})
    e.update(kw)
    parts.append(e)
    return e


part('body', 'cuerpo', 'static', 'body', FEET)
part('head', 'cabeza', 'static', 'head', NECK, parallax=[0, 0])
part('ear_l', 'oreja_izq', 'ear', 'head', EAR_L_BASE, parallax=[0, 0],
     motion=dict(EAR_MOTION, phase=0), earKick=1)
part('ear_r', 'oreja_der', 'ear', 'head', EAR_R_BASE, parallax=[0, 0],
     motion=dict(EAR_MOTION, phase=0.25, speed=0.36), earKick=1)
# un solo ojo: el del dibujo original
EYE = {'r': ('ojo_abierto', 'ojo_cerrado')}
eyes = {}
for side, (op, cl) in EYE.items():
    eo = save(f'eye_{side}_open.png', IMG[op])
    ec = dict(save(f'eye_{side}_closed.png', IMG[cl]), patch=True)   # cambio de golpe, sin seguir la mirada
    c = center(IMG[op])
    parts.append({'id': f'eye_{side}', 'role': 'eye', 'parent': 'head', 'side': side, 'pivot': c,
                  'parallax': [0, 0], 'psdName': [op, cl]})
    eyes[side] = {'center': c, 'styles': {'A': {'full': eo}, 'B': {'full': eo}}, 'closed': ec}

comp = np.zeros((H, W, 4), np.float32)
for n in ['cuerpo', 'cabeza', 'oreja_izq', 'oreja_der', 'ojo_abierto']:
    comp = IMG[n] + comp * (1 - IMG[n][..., 3:])
cx0, cy0, cx1, cy1 = 150, 330, 1350, 1530
th = cv2.resize(comp[cy0:cy1, cx0:cx1], (64, 64), interpolation=cv2.INTER_AREA)
bg = np.zeros((64, 64, 3), np.float32) + np.array([1.0, 0.95, 0.8], np.float32)
rgb = th[..., :3] + bg * (1 - th[..., 3:])
Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'thumb.png'))

manifest = {
    'name': 'Conejito del Diario',
    'rigSize': [RIG, RIG],
    'pxPerUnit': PPU,
    'source': 'conejito_capas.psd (v3, 6 capas)',
    'id': 'conejito',
    'headMotion': 0.8,
    'headRigid': True,
    'headRoll': 1.8,   # inclinación máx. ~18° (10° de cámara × 1.8)
    'paperEdge': False,
    'squashBlink': False,
    'accessories': [],
    'swap': {
        'eyes': {'close': 0.55, 'open': 0.35},
    },
    'parts': parts,
    'mouths': {},
    'extras': {},
    'arms': {'parts': {}, 'shoulders': {'l': rig(900, 1750), 'r': rig(1300, 1750)}, 'hasCustom': False},
    'eyes': eyes,
    'eyeStyles': ['A', 'B'],
    'pivots': {
        'neck': NECK, 'feet': FEET,
        'eye_l': eyes['r']['center'], 'eye_r': eyes['r']['center'],
        'headTop': rig(1000, 480),
    },
    # con un margen alrededor para que al inclinarse y rebotar no toque el borde del escenario
    'bounds': dict(zip(['x0', 'y0'], rig(BX0 - 200, BY0 - 150))) | dict(zip(['x1', 'y1'], rig(BX1 + 200, BY1 + 100))),
    'drawOrder': [p['id'] for p in parts],
}
manifest['build'] = hashlib.sha1(json.dumps(
    [[p['id'], p['parent'], p.get('pivot'), p.get('x'), p.get('y'), p.get('w'), p.get('h')] for p in parts]).encode()).hexdigest()[:12]
_h = hashlib.sha1()
for fn in sorted(os.listdir(OUT)):
    if fn.endswith('.png'):
        with open(os.path.join(OUT, fn), 'rb') as g:
            _h.update(fn.encode() + g.read())
manifest['art'] = _h.hexdigest()[:12]
with open(os.path.join(OUT, 'rig.json'), 'w') as f:
    json.dump(manifest, f, indent=1, ensure_ascii=False)
print('wrote', OUT, 'scale', round(SCALE, 4), 'build', manifest['build'], 'art', manifest['art'])
