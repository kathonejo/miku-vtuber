"""Build Bunny VTuber rig assets from Katherine's layered PSD.
Rig space: 600x600 units. rig = (psd - OFF) / 3.  Assets exported at 2 px per rig unit (psd * 2/3)."""
import json, os, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from psd_tools import PSDImage
import warnings; warnings.filterwarnings('ignore')

PSD = sys.argv[1] if len(sys.argv) > 1 else '/workspace/uploads/vtuber1.psd'
OUT = os.environ.get('OUT', 'out3'); os.makedirs(OUT, exist_ok=True)
OFF = (125.0, 39.0); K = 3.0; PX = 2.0   # rig = (psd-OFF)/K ; asset px per rig unit
rng = np.random.default_rng(11)
def R(x, y): return [round((x - OFF[0]) / K, 2), round((y - OFF[1]) / K, 2)]

psd = PSDImage.open(PSD)
# layers may live inside groups; keep bottom->top order. Duplicate names: the first visible one wins.
_all = [l for l in psd.descendants() if not l.is_group()]
layers = {}
for l in _all:
    if l.name not in layers or (l.visible and not layers[l.name].visible): layers[l.name] = l
order = [n for n in dict.fromkeys(l.name for l in _all)]

# name -> (rig id, parent group, pivot in psd px, role)
MAP = {
 'pelo atras':          ('hair_back',    'head', (1000, 720), 'hair'),
 'oreja derecha':       ('ear_r',        'head', (1160, 600), 'ear'),
 'oreja izquierda':     ('ear_l',        'head', (830, 610),  'ear'),
 'mechon atras':        ('lock_back_r',  'head', (1300, 790), 'hair'),
 'mechon atras copia':  ('lock_back_l',  'head', (790, 920),  'hair'),
 'orejas':              ('human_ears',   'head', (1008, 900), 'static'),
 'cabeza':              ('face',         'head', (1008, 1100),'static'),
 'mechon der arriba 2': ('strand_l',     'head', (600, 830),  'hair'),
 'mechon der arriba 1': ('curl_l',       'head', (760, 790),  'hair'),
 'cuerpo':              ('body',         'body', (1030, 1750),'static'),
 'mechon izq delante':  ('strand_r',     'head', (1330, 700), 'hair'),
 'cabeza flequillo':    ('bangs',        'head', (1008, 900), 'static'),
 # her A / B eye layers are two alternative eye STYLES (selectable in the app), not blink frames
 'ojo der A':           ('eye_l_A',      'head', (716, 942),  'eye'),
 'ojo der B':           ('eye_l_B',      'head', (716, 942),  'eye'),
 'ojo izq A':           ('eye_r_A',      'head', (1242, 862), 'eye'),
 'ojo izq B':           ('eye_r_B',      'head', (1242, 862), 'eye'),
}

def layer_full(l):
    a = np.zeros((2000, 2000, 4), np.float32)
    im = np.asarray(l.topil().convert('RGBA')).astype(np.float32)
    x0, y0 = l.left, l.top
    h, w = im.shape[:2]
    xs, ys = max(0, x0), max(0, y0); xe, ye = min(2000, x0 + w), min(2000, y0 + h)
    a[ys:ye, xs:xe] = im[ys - y0:ye - y0, xs - x0:xe - x0]
    return a

def export(name, arr, extra=None):
    """arr: 2000x2000 RGBA float in psd space -> trimmed, scaled PNG + manifest entry"""
    al = arr[..., 3]
    ys, xs = np.where(al > 1)
    if len(xs) == 0: return None
    pad = 3
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(2000, xs.max() + 1 + pad), min(2000, ys.max() + 1 + pad)
    crop = arr[y0:y1, x0:x1].copy(); crop[crop[..., 3] < 1] = 0
    im = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8), 'RGBA')
    sw = max(1, round((x1 - x0) * PX / K)); sh = max(1, round((y1 - y0) * PX / K))
    im = im.resize((sw, sh), Image.LANCZOS)
    im.save(f'{OUT}/{name}.png', optimize=True)
    e = dict(file=f'{name}.png', x=R(x0, y0)[0], y=R(x0, y0)[1], w=round((x1 - x0) / K, 2), h=round((y1 - y0) / K, 2), px=[sw, sh])
    if extra: e.update(extra)
    return e

def poly_mask(poly, feather=2.0):
    m = Image.new('L', (2000, 2000), 0); ImageDraw.Draw(m).polygon(poly, fill=255)
    m = np.asarray(m).astype(np.float32) / 255
    return cv2.GaussianBlur(m, (0, 0), feather) if feather else m

manifest = dict(rigSize=[600, 600], pxPerUnit=PX, psdOffset=OFF, psdScale=K, source=os.path.basename(PSD), parts=[], extras={})
full = {n: layer_full(layers[n]) for n in order if n in MAP}

# ---------- face: erase her mouth (we animate mouths) ----------
face = full['cabeza'].copy()
MOUTH_BOX = [(922, 996), (1068, 996), (1068, 1052), (922, 1052)]
mm = poly_mask(MOUTH_BOX, 0)
mouth_neutral = face.copy(); mouth_neutral[..., 3] *= poly_mask(MOUTH_BOX, 2.0)
# local skin colour from a ring around the mouth
ring = cv2.dilate(mm, np.ones((31, 31), np.uint8)) - mm
px_ = face[..., :3][(ring > 0.5) & (face[..., 3] > 250)]
ok = (px_[:, 0] > 200) & (px_[:, 2] < 190) & (px_[:, 1] > 100)
local = np.median(px_[ok], 0)
# keep only her ink strokes of the mouth (no rectangular skin backing)
d = np.linalg.norm(mouth_neutral[..., :3] - local, axis=-1)
ink = np.clip((d - 45) / 60, 0, 1)
ink = cv2.GaussianBlur(cv2.dilate(ink, np.ones((3, 3), np.uint8)), (0, 0), 1.0)
mouth_neutral[..., 3] *= ink
img8 = np.clip(face[..., :3], 0, 255).astype(np.uint8)
grow = cv2.dilate(mm, np.ones((9, 9), np.uint8))
filled = cv2.inpaint(img8, (grow * 255).astype(np.uint8), 15, cv2.INPAINT_TELEA).astype(np.float32)
patch = face[900:980, 1090:1160, :3]   # clean skin patch for texture
tile = np.concatenate([patch, patch[:, ::-1]], 1); tile = np.concatenate([tile, tile[::-1]], 0)
tex = np.tile(tile, (2000 // tile.shape[0] + 2, 2000 // tile.shape[1] + 2, 1))[:2000, :2000]
tex = tex - patch.reshape(-1, 3).mean(0)
tex = tex - cv2.GaussianBlur(tex, (0, 0), 8)
filled = cv2.GaussianBlur(filled, (0, 0), 6) * 0.4 + local * 0.6 + tex
soft = cv2.GaussianBlur(grow, (0, 0), 4)[..., None]
face[..., :3] = face[..., :3] * (1 - soft) + filled * soft
full['cabeza'] = face

LASH = np.array([20, 80, 160], np.float32)
lash_px = full['ojo der A'][..., :3][(full['ojo der A'][..., 3] > 250)]
dark = lash_px[(lash_px[:, 2] > lash_px[:, 0] + 60) & (lash_px.sum(1) < 330)]
if len(dark) > 50: LASH = np.median(dark, 0)
print('lash', LASH, 'skin', local)

# ---------- parts in PSD order ----------
for n in order:
    if n not in MAP: continue
    rid, parent, piv, role = MAP[n]
    l = layers[n]
    e = export(rid, full[n], dict(psdName=n, parent=parent, role=role, pivot=R(*piv), visibleInPsd=bool(l.visible)))
    if rid == 'face':
        e['mouthErased'] = True
    manifest['parts'].append(e)
    if rid == 'face':
        # mouth goes right above the face
        manifest['parts'].append(dict(id_placeholder='mouth', parent='head', role='mouth'))
for p in manifest['parts']:
    if 'file' in p: p['id'] = p['file'][:-4]
    else: p['id'] = 'mouth'; del p['id_placeholder']

# ---------- mouths ----------
MC = (995, 1022)
def save_rgba(name, arr):
    return export(name, arr)
mouths = {'neutral': export('mouth_neutral', mouth_neutral)}
INSIDE = (128, 32, 58); TONGUE = (238, 112, 118); ORANGE = (240, 110, 60); LINE = tuple(int(c) for c in LASH)
def draw_mouth(name, shape, S=2):
    w, top, bot, tw = [v * 3 for v in shape]
    big = Image.new('RGBA', (2000 * S // 4, 2000 * S // 4), (0, 0, 0, 0))  # work at half-res*S... simpler: draw in psd space
    big = Image.new('RGBA', (2000, 2000), (0, 0, 0, 0)); dr = ImageDraw.Draw(big)
    def P(pts): return [(MC[0] + x, MC[1] + y) for x, y in pts]
    def curve(f, a, b, n=60): return [(a + (b - a) * i / (n - 1), f(a + (b - a) * i / (n - 1))) for i in range(n)]
    upper = curve(lambda x: -top * (1 - (x / w) ** 2) - (abs(x) / w) ** 2 * 1.5 * tw, -w, w)
    lower = curve(lambda x: bot * (1 - (x / w) ** 2) - (abs(x) / w) ** 2 * 1.5 * tw, w, -w)
    dr.polygon(P(upper + lower), fill=INSIDE + (255,))
    if bot > 12:
        tg = curve(lambda x: bot * (1 - (x / (w * 0.75)) ** 2) * 0.95, -w * 0.7, w * 0.7)
        tgu = [(x, bot * 0.25 + 0.15 * abs(x)) for x, _ in tg[::-1]]
        dr.polygon(P(tg + tgu), fill=TONGUE + (255,))
    for k in range(3):
        sh = curve(lambda x: bot * (1 - (x / w) ** 2) + 7 + k * 2.5 + rng.normal(0, .5), -w * 0.8, w * 0.8)
        dr.line(P(sh), fill=ORANGE + (110,), width=5, joint='curve')
    for k in range(3):
        jit = lambda pts: [(x + rng.normal(0, .4), y + rng.normal(0, .5)) for x, y in pts]
        dr.line(P(jit(upper)), fill=LINE + (215,), width=7, joint='curve')
        dr.line(P(jit(lower)), fill=LINE + (150,), width=4, joint='curve')
    big = big.filter(ImageFilter.GaussianBlur(0.9))
    arr = np.asarray(big).astype(np.float32)
    n = cv2.GaussianBlur(rng.normal(0, 1, (2000, 2000)).astype(np.float32), (0, 0), 1.2); n /= n.std()
    arr[..., :3] = np.clip(arr[..., :3] + n[..., None] * 8, 0, 255)
    return export(name, arr)
mouths['small'] = draw_mouth('mouth_small', (11, 1.0, 5.0, 1.0))
mouths['a'] = draw_mouth('mouth_a', (15, 2.5, 13.0, 0.5))
mouths['o'] = draw_mouth('mouth_o', (8, 7.0, 9.0, -1.0))
mouths['smile'] = draw_mouth('mouth_smile', (19, -1.5, 9.0, 4.0))
manifest['mouths'] = mouths
manifest['mouthCenter'] = R(*MC)

# ---------- closed eyes (lash arcs; the face layer has skin under the eyes) ----------
def closed_eye(name, src_layer, tail_left):
    a = full[src_layer][..., 3]
    ys, xs = np.where(a > 128)
    x0, x1 = xs.min(), xs.max(); 
    # vertical centre of the eye opening per column -> use lower 60% of the shape
    yc = np.median(ys) + (ys.max() - np.median(ys)) * 0.15
    w = x1 - x0; sag = (ys.max() - ys.min()) * 0.32
    big = Image.new('RGBA', (2000, 2000), (0, 0, 0, 0)); dr = ImageDraw.Draw(big)
    col = tuple(int(c) for c in LASH)
    a0 = x0 + w * (0.12 if tail_left else 0.08); a1 = x1 - w * (0.08 if tail_left else 0.12)
    for k in range(4):
        pts = []
        for i in range(60):
            t = i / 59; x = a0 + (a1 - a0) * t
            pts.append((x, yc + sag * 4 * t * (1 - t) + rng.normal(0, .6) + (k - 1.5) * 1.2))
        dr.line(pts, fill=col + (205,), width=9, joint='curve')
    # small lashes at the outer corner + orange under-stroke like her lids
    for j in range(3):
        bx = a0 + 8 + j * 12 if tail_left else a1 - 8 - j * 12
        t = (bx - a0) / (a1 - a0); by = yc + sag * 4 * t * (1 - t)
        dx = -16 if tail_left else 16
        dr.line([(bx, by), (bx + dx, by + 10 + 3 * j)], fill=col + (190,), width=6)
    pts = [(a0 + (a1 - a0) * i / 39, yc + 12 + sag * 4 * (i / 39) * (1 - i / 39)) for i in range(4, 36)]
    dr.line(pts, fill=(240, 110, 60, 120), width=6, joint='curve')
    big = big.filter(ImageFilter.GaussianBlur(1.0))
    return export(name, np.asarray(big).astype(np.float32), dict(parent='head', role='eye'))
manifest['extras']['eye_l_closed'] = closed_eye('eye_l_closed', 'ojo der A', True)
manifest['extras']['eye_r_closed'] = closed_eye('eye_r_closed', 'ojo izq A', False)

# ---------- heart pulse overlay (crop of her body layer) ----------
HEART = [(948, 1150), (1082, 1150), (1082, 1268), (948, 1268)]
hm = poly_mask(HEART, 0); hm = cv2.GaussianBlur(cv2.erode(hm, np.ones((5, 5), np.uint8)), (0, 0), 6)
heart = full['cuerpo'].copy(); heart[..., 3] *= hm
manifest['extras']['heart'] = export('heart', heart, dict(parent='body', role='heart', pivot=R(1012, 1210)))

# ---------- optional arm / hand layers (picked up automatically when she adds them) ----------
import re, unicodedata
def norm(t):
    t = unicodedata.normalize('NFKD', t.lower()).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', t.replace('_', ' ')).strip()
SHOULDER = {'l': (880, 1190), 'r': (1140, 1190)}       # screen-left / screen-right shoulder (psd px)
POSES = {'saludo': 'wave', 'saludar': 'wave', 'corazon': 'heart', 'paz': 'peace', 'v': 'peace',
         'aplauso': 'clap', 'aplaudir': 'clap', 'senala': 'point', 'senalar': 'point', 'apunta': 'point',
         'arriba': 'up', 'celebra': 'up', 'celebrar': 'up', 'reposo': 'rest'}
KINDS = {'brazo': 'upper', 'antebrazo': 'fore', 'manga': 'sleeve', 'mangas': 'sleeve', 'puno': 'sleeve', 'mano': 'sleeve', 'manos': 'sleeve'}
# 'manga' = sleeve tip / cuff with the hand hidden inside (her design); 'mano' accepted as an alias
overrides = {}
ov_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pivots.json')
if os.path.exists(ov_path): overrides = json.load(open(ov_path))
arms = {}
all_layers = [l for l in psd.descendants() if not l.is_group()]
for l in all_layers:
    nm = norm(l.name); words = nm.split(' ')
    if not words or words[0] not in KINDS: continue
    kind = KINDS[words[0]]
    pose = next((POSES[w] for w in words[1:] if w in POSES), 'rest')
    arr = layer_full(l)
    ys, xs = np.where(arr[..., 3] > 8)
    if len(xs) == 0: continue
    cx = xs.mean()
    if 'izq' in words or 'izquierda' in words: side = 'l'
    elif 'der' in words or 'derecha' in words: side = 'r'
    else: side = 'l' if cx < 1008 else 'r'
    # her naming is not always screen-based, so trust the position when it clearly disagrees
    if (side == 'l' and cx > 1150) or (side == 'r' and cx < 870): side = 'l' if cx < 1008 else 'r'
    if pose == 'heart' and kind == 'sleeve' and abs(cx - 1008) < 120 and not ({'izq','der','izquierda','derecha'} & set(words)): side = 'both'
    rid = f"{kind}_{side}" + ('' if pose == 'rest' else f"_{pose}")
    # pivot: shoulder for upper arm, nearest end to the shoulder for forearm/hand
    sh = SHOULDER['l' if side == 'both' else side]
    if kind == 'upper': piv = sh
    else:
        d = (xs - sh[0]) ** 2 + (ys - sh[1]) ** 2; k = int(np.argmin(d)); piv = (int(xs[k]), int(ys[k]))
    if l.name in overrides: piv = tuple(overrides[l.name])
    e = export(rid, arr, dict(psdName=l.name, kind=kind, side=side, pose=pose, parent='body', pivot=R(*piv), visibleInPsd=bool(l.visible)))
    if e: arms[rid] = e; print('arm layer', repr(l.name), '->', rid)
manifest['arms'] = dict(parts=arms, shoulders={k: R(*v) for k, v in SHOULDER.items()}, hasCustom=bool(arms))
# ---------- eyes: styles A/B + optional detailed sub-layers ----------
# Supported names (case/accent-insensitive, may live in groups; side izq/der corrected by position):
#   'ojo izq A' / 'ojo izq B'           full eye drawing for style A / B
#   'ojo izq blanco [A|B]'              eye white (sclera)
#   'iris izq [A|B]'                    iris (moves with gaze, clipped to the white if present)
#   'pupila izq [A|B]'                  pupil (moves with gaze, a bit more than the iris)
#   'brillo izq [A|B]'                  highlight (moves slightly less)
#   'pestanas izq [A|B]' / 'parpado izq [A|B]' / 'linea ojo izq [A|B]'   upper lid / lashes line
#   'ojo izq cerrado'                   closed eye (replaces the generated lash arc)
import re as _re, unicodedata as _ud
def _norm(t):
    t = _ud.normalize('NFKD', t.lower()).encode('ascii', 'ignore').decode()
    return _re.sub(r'\s+', ' ', t.replace('_', ' ')).strip()
EYE_C = {'l': (716, 942), 'r': (1242, 862)}
eyes = {sd: dict(center=R(*EYE_C[sd]), styles={}, closed=None) for sd in 'lr'}
for p in manifest['parts']:
    if p.get('role') == 'eye' and 'file' in p:
        sd, st = p['id'].split('_')[1], p['id'].split('_')[2]
        eyes[sd]['styles'].setdefault(st, {})['full'] = {k: p[k] for k in ('file', 'x', 'y', 'w', 'h', 'px', 'psdName')}
SUB = {'blanco': 'white', 'iris': 'iris', 'pupila': 'pupil', 'brillo': 'highlight', 'pestanas': 'lash',
       'parpado': 'lash', 'linea': 'lash', 'cerrado': 'closed'}
for l in psd.descendants():
    if l.is_group() or l.name in MAP: continue
    words = _norm(l.name).split(' ')
    if not ({'ojo', 'iris', 'pupila', 'brillo', 'pestanas', 'parpado'} & set(words[:1]) or words[:2] == ['linea', 'ojo']): continue
    kind = next((SUB[w] for w in words if w in SUB), None)
    if kind is None: continue
    arr = layer_full(l); ys, xs = np.where(arr[..., 3] > 8)
    if len(xs) == 0: continue
    sd = 'l' if xs.mean() < 1008 else 'r'
    st = 'B' if 'b' in words[1:] else 'A'
    rid = f'eye_{sd}_{kind}' + ('' if kind == 'closed' else f'_{st}')
    e = export(rid, arr, dict(psdName=l.name))
    if not e: continue
    if kind == 'closed': eyes[sd]['closed'] = e
    else: eyes[sd]['styles'].setdefault(st, {})[kind] = e
    print('eye layer', repr(l.name), '->', rid)
for sd in 'lr':
    if eyes[sd]['closed'] is None: eyes[sd]['closed'] = manifest['extras'][f'eye_{sd}_closed']
    else: eyes[sd]['closedFromPsd'] = True
manifest['eyes'] = eyes
manifest['eyeStyles'] = sorted(set(eyes['l']['styles']) | set(eyes['r']['styles']))
# collapse the per-style eye entries in the draw order into one slot per side
newparts, seen = [], set()
for p in manifest['parts']:
    if p.get('role') == 'eye' and 'file' in p:
        sd = p['id'].split('_')[1]
        if sd in seen: continue
        seen.add(sd); newparts.append(dict(id=f'eye_{sd}', role='eye', parent='head', side=sd, pivot=R(*EYE_C[sd])))
    else: newparts.append(p)
manifest['parts'] = newparts
manifest['pivots'] = dict(neck=R(1008, 1100), feet=R(1030, 1750), eye_l=R(716, 942), eye_r=R(1242, 862), headTop=R(1008, 640))
manifest['bounds'] = dict(x0=R(333, 114)[0], y0=R(333, 114)[1], x1=R(1716, 1752)[0], y1=R(1716, 1752)[1])
manifest['drawOrder'] = [p['id'] for p in manifest['parts']]
manifest['blink'] = dict(frames=['open', 'closed'], note='open = selected eye style (A/B); closed = eyes.<side>.closed (her ojo cerrado layer or the generated lash arc)')
json.dump(manifest, open(f'{OUT}/rig.json', 'w'), indent=1, ensure_ascii=False)
print('order', manifest['drawOrder'])
print('done')
