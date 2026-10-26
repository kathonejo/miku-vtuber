"""Arma la Vaquita a partir del PSD por capas de Katherine (tools/vaquita/vaquita.psd).

Solo se usan los píxeles de sus capas: se agrupan, se recortan y se reducen de
tamaño; nada se dibuja ni se deforma. Escribe public/vaquita/*.png y rig.json.

    python3 tools/vaquita/build_vaquita.py

Capas del PSD (v5_cola, de abajo hacia arriba; mismas 23 capas que v4, sólo 'vaca cola color'
tiene más relleno en su base, escondido bajo el cuerpo, para que no se abra un hueco al mecerse): cada capa es su propia pieza, en el mismo
orden del archivo. Los pares color + línea comparten pivote y movimiento:
  ' cuerpo color'                          -> body                 (quieto)
  'vaca cola color' / 'vaca cola l'        -> tail_color / tail    (resorte que se mece)
  'p3 color' / 'p3 l' (y p der, p 2 der)   -> leg_*_color / leg_*  (giran en la cadera, con el cuerpo)
  'cabeza cuello'                          -> neck                 (pecho bajo la cabeza, con el cuerpo)
  'ore izq color' / 'orej izq l'           -> ear_color_l / ear_l  (oreja rosa, con la cabeza, resorte)
  'cabeza color'                           -> head_color
  'ojo izq' + 'ojo izq cerrado'            -> eye_l                (abierto / cerrado: cambio de golpe)
  'ojo der' + 'ojo der cerrado'            -> eye_r
  'vaca cuerpo'                            -> body_line            (línea del cuerpo)
  'p4 color' / 'p4 l'                      -> leg_p4_color / leg_p4
  'cabeza'                                 -> head_line
  'oreja der color' / 'oreja linea der'    -> ear_color_r / ear_r  (oreja negra, encima de todo)
Los lados de los ojos siguen los nombres de sus capas (izq = l, der = r).
"""
import hashlib
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


# ---- cada capa del PSD es su propia pieza (orden del archivo, de abajo hacia arriba)
ORDER = [l.name for l in psd if not l.is_group()]
IMG = {n: full(n) for n in ORDER}
body = IMG[' cuerpo color']
eye_l_img, eye_r_img = IMG['ojo izq'], IMG['ojo der']
eye_l_closed_img, eye_r_closed_img = IMG['ojo izq cerrado'], IMG['ojo der cerrado']
OPEN_ONLY = [n for n in ORDER if 'cerrado' not in n]

# ---- rig: 600x600, personaje de 546 de alto con el borde de arriba en 25
allm = over(*[IMG[n] for n in ORDER])[..., 3] > 0.02
ys, xs = np.where(allm)
BX0, BY0, BX1, BY1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
# Encuadre fijo del armado v3: los PSD corregidos (v4...) limpian manchitas del borde y eso
# movería el encuadre y la escala; así las coordenadas del rig (y los ajustes guardados) no cambian.
FRAME_PIN = (132, 389, 2185, 2652)
if FRAME_PIN:
    BX0, BY0, BX1, BY1 = FRAME_PIN
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


NECK = rig(700, 1330)      # unión de la cabeza con el pecho, debajo de la mancha negra
FEET = rig(1150, 2650)
TAIL_BASE = rig(1830, 1280)  # donde la cola sale del lomo
EAR_L_BASE = rig(495, 905)   # oreja de arriba (rosa): su base en la frente
EAR_R_BASE = rig(800, 1150)  # oreja negra: su base al costado de la cabeza
parts = []


def hip(img):
    """Cadera de una pata: centro de la franja de arriba (15 % del alto)."""
    ys, xs = np.where(img[..., 3] > 0.3)
    top, bot = ys.min(), ys.max()
    band = ys <= top + 0.15 * (bot - top)
    return rig(xs[band].mean(), ys[band].mean())


LEG_MOTION = {'sway': 0, 'speed': 0.3, 'stiffness': 90, 'damping': 12, 'gravity': 0, 'follow': 0, 'limit': 6}
TAIL_MOTION = {'sway': 4, 'speed': 0.35, 'stiffness': 55, 'damping': 5, 'gravity': 0, 'follow': 1, 'limit': 12}
# orejas: resorte con vaivén suave (como la Conejita azul); color y línea con los mismos valores
EAR_MOTION = {'sway': 5, 'speed': 0.4, 'stiffness': 130, 'damping': 13, 'gravity': 0, 'follow': 1, 'limit': 9}


def part(pid, name, role, parent, pivot, **kw):
    e = save(f'{pid}.png', IMG[name])
    e.update({'id': pid, 'role': role, 'parent': parent, 'pivot': pivot, 'psdName': [name]})
    e.update(kw)
    parts.append(e)
    return e


# capa del PSD -> (id, rol, padre, pivote, extra). Los pares color/línea comparten pivote y
# movimiento, así se mueven juntos pero siguen siendo capas separadas. 'pairOf' marca la línea
# de un par: la app la deja siempre hija de su color, con su mismo pivote y sin pose propia
# (aunque haya ajustes guardados viejos), así nunca se abre un corte entre línea y color.
LEGS = {'p3': ('p3 color', 'p3 l'), 'p_der': ('p der color', 'p der'),
        'p2_der': ('p 2 der l color', 'p 2 der l'), 'p4': ('p4 color', 'p4 l')}
leg_hip = {k: hip(over(IMG[c], IMG[l])) for k, (c, l) in LEGS.items()}
eye_l_c, eye_r_c = center(eye_l_img), center(eye_r_img)
SPEC = {
    ' cuerpo color': ('body', 'static', 'body', FEET, {}),
    'vaca cola color': ('tail_color', 'tail', 'body', TAIL_BASE, {'motion': dict(TAIL_MOTION)}),
    'vaca cola l': ('tail', 'static', 'tail_color', TAIL_BASE, {'pairOf': 'tail_color'}),
    'cabeza cuello': ('neck', 'static', 'body', FEET, {}),
    'ore izq color': ('ear_color_l', 'ear', 'head', EAR_L_BASE, {'parallax': [0, 0], 'motion': dict(EAR_MOTION, phase=0)}),
    'orej izq l': ('ear_l', 'static', 'ear_color_l', EAR_L_BASE, {'parallax': [0, 0], 'pairOf': 'ear_color_l'}),
    'cabeza color': ('head_color', 'static', 'head', NECK, {'parallax': [0, 0]}),
    'vaca cuerpo': ('body_line', 'static', 'body', FEET, {}),
    'cabeza': ('head_line', 'static', 'head', NECK, {'parallax': [0, 0]}),
    'oreja der color': ('ear_color_r', 'ear', 'head', EAR_R_BASE, {'parallax': [0, 0], 'motion': dict(EAR_MOTION, phase=0.25)}),
    'oreja linea der': ('ear_r', 'static', 'ear_color_r', EAR_R_BASE, {'parallax': [0, 0], 'pairOf': 'ear_color_r'}),
}
for k, (c, l) in LEGS.items():
    SPEC[c] = (f'leg_{k}_color', 'limb', 'body', leg_hip[k], {'motion': dict(LEG_MOTION)})
    SPEC[l] = (f'leg_{k}', 'static', f'leg_{k}_color', leg_hip[k], {'pairOf': f'leg_{k}_color'})

eye_l = save('eye_l_open.png', eye_l_img)
eye_r = save('eye_r_open.png', eye_r_img)
# ojos cerrados dibujados por ella: cambio de golpe por ojo (sin seguir la mirada)
eye_l_closed = dict(save('eye_l_closed.png', eye_l_closed_img), patch=True)
eye_r_closed = dict(save('eye_r_closed.png', eye_r_closed_img), patch=True)
for name in ORDER:
    if name == 'ojo izq':
        parts.append({'id': 'eye_l', 'role': 'eye', 'parent': 'head', 'side': 'l', 'pivot': eye_l_c, 'parallax': [0, 0],
                      'psdName': ['ojo izq', 'ojo izq cerrado']})
    elif name == 'ojo der':
        parts.append({'id': 'eye_r', 'role': 'eye', 'parent': 'head', 'side': 'r', 'pivot': eye_r_c, 'parallax': [0, 0],
                      'psdName': ['ojo der', 'ojo der cerrado']})
    elif 'cerrado' in name:
        continue
    else:
        pid, role, parent, pivot, kw = SPEC[name]
        part(pid, name, role, parent, pivot, **kw)

comp = over(*[IMG[n] for n in OPEN_ONLY])


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def hexc(rgb):
    return '#' + ''.join(f'{int(round(float(v) * 255)):02x}' for v in np.clip(rgb, 0, 1))


def closed_line(eye, below, line):
    """Color de la rayita del ojo cerrado: contrasta con lo que hay debajo del ojo.

    Se mira el compuesto de las capas de abajo dentro del recuadro del ojo (pesado por
    la silueta del ojo) y la luminancia media del propio ojo. Fondo claro -> el negro
    de su línea; fondo oscuro -> el color claro del ojo (o blanco si no contrasta)."""
    a = eye[..., 3]
    ys, xs = np.where(a > 0.004)
    sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    w = a[sl]
    ea = np.maximum(w, 1e-4)[..., None]
    erg = eye[sl][..., :3] / ea
    ba = below[sl][..., 3:]
    brg = below[sl][..., :3] + (1 - ba) * 1.0          # sin nada debajo: papel blanco
    el = lum(erg)
    bl = lum(brg)
    eye_l = float((el * w).sum() / w.sum())
    bg_l = float((bl * w).sum() / w.sum())
    solid = w > 0.5
    order = np.argsort(el[solid])
    k = max(1, len(order) // 10)
    dark_eye = erg[solid][order[:k]].mean(0)
    light_eye = erg[solid][order[-k:]].mean(0)
    la = line[..., 3] > 0.8
    lrg = line[..., :3][la] / line[..., 3:][la]
    lo = np.argsort(lum(lrg))
    line_dark = lrg[lo[:max(1, len(lo) // 2)]].mean(0)
    if bg_l >= 0.5:
        pick, why = line_dark, 'fondo claro: negro de su línea'
        if lum(pick) > bg_l - 0.4:
            pick, why = np.zeros(3), 'fondo claro: negro'
    else:
        pick, why = light_eye, 'fondo oscuro: color claro del ojo'
        if lum(pick) < bg_l + 0.4:
            pick, why = np.ones(3), 'fondo oscuro: blanco'
    return {'color': hexc(pick), 'eyeLum': round(eye_l, 3), 'bgLum': round(bg_l, 3),
            'eye': {'dark': hexc(dark_eye), 'light': hexc(light_eye)}, 'why': why}


below_l = over(*[IMG[n] for n in ORDER[:ORDER.index('ojo izq')]])
below_r = over(below_l, eye_l_img)
CLOSED = {'l': closed_line(eye_l_img, below_l, IMG['cabeza']), 'r': closed_line(eye_r_img, below_r, IMG['cabeza'])}
ref = over(*[IMG[n] for n in ORDER])   # el PSD tiene visibles los ojos abiertos y cerrados
print('recomposite vs capas: max diff', float(np.abs(over(comp, eye_l_closed_img, eye_r_closed_img) - ref).max()))

# miniatura: la cabeza
cx0, cy0, cx1, cy1 = 120, 560, 1020, 1460
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
    'squashBlink': False,   # tiene ojos cerrados dibujados: cambio de golpe
    # accesorios que le quedan bien (los otros se dibujan pensando en la conejita)
    'accessories': ['flowerCrown', 'sparkles'],
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
        'l': {'center': center(eye_l_img), 'styles': {'A': {'full': eye_l}, 'B': {'full': eye_l}}, 'closed': eye_l_closed, 'closedLine': CLOSED['l']},
        'r': {'center': center(eye_r_img), 'styles': {'A': {'full': eye_r}, 'B': {'full': eye_r}}, 'closed': eye_r_closed, 'closedLine': CLOSED['r']},
    },
    'eyeStyles': ['A', 'B'],
    'pivots': {
        'neck': NECK, 'feet': FEET,
        'eye_l': eye_l_c, 'eye_r': eye_r_c,
        'headTop': rig(560, 885),
    },
    'bounds': dict(zip(['x0', 'y0'], rig(BX0, BY0))) | dict(zip(['x1', 'y1'], rig(BX1, BY1))),
    'drawOrder': [p['id'] for p in parts],
}
# huella del armado: si cambian las piezas, los ajustes guardados de un armado viejo
# no imponen su orden, padres ni pivotes
manifest['build'] = hashlib.sha1(json.dumps(
    [[p['id'], p['parent'], p['pivot'], p.get('x'), p.get('y'), p.get('w'), p.get('h')] for p in parts]).encode()).hexdigest()[:12]
# mismo armado que v3/v4 (mismas piezas, padres y orden; sólo cambiaron píxeles): se conserva su
# huella para no descartar los ajustes guardados de la usuaria
BUILD_PIN = ('dae8e8cc505c', '5711e0c5b937')
_struct = hashlib.sha1(json.dumps([[p['id'], p['parent']] for p in parts]).encode()).hexdigest()[:12]
if BUILD_PIN and _struct == BUILD_PIN[1]:
    manifest['build'] = BUILD_PIN[0]
# huella del dibujo: cambia cuando cambian los píxeles aunque las piezas sean las mismas
# (no toca 'build', así los ajustes guardados de la usuaria se conservan)
_h = hashlib.sha1()
for fn in sorted(os.listdir(OUT)):
    if fn.endswith('.png'):
        with open(os.path.join(OUT, fn), 'rb') as g:
            _h.update(fn.encode() + g.read())
manifest['art'] = _h.hexdigest()[:12]
with open(os.path.join(OUT, 'rig.json'), 'w') as f:
    json.dump(manifest, f, indent=1, ensure_ascii=False)
print('wrote', OUT, 'scale', round(SCALE, 4), 'build', manifest['build'], 'art', manifest['art'])
