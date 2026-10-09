import numpy as np, cv2, os, json
from PIL import Image, ImageDraw, ImageFilter
from masks2 import *
OUT = os.environ.get('OUT', 'out'); os.makedirs(OUT, exist_ok=True)
W = H = 900
rng = np.random.default_rng(7)
SRC = np.asarray(Image.open('work2.png').convert('RGBA')).astype(np.float32)
src = SRC[..., :3].copy()
al = SRC[..., 3] / 255.0
# de-fringe: semi-transparent pixels were matted on white; un-mix the white
aa = np.maximum(al, 1e-3)[..., None]
rgb = src.copy()  # keep the white paper fringe (cutout look)
rgb = np.where(al[..., None] > 0.02, rgb, 0)
RGBA = np.dstack([rgb, al * 255]).astype(np.float32)
src = np.where(al[..., None] > 0.5, src, 255.0)

def poly_mask(poly, feather=2.0):
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon(poly, fill=255)
    m = np.asarray(m).astype(np.float32) / 255
    if feather > 0: m = cv2.GaussianBlur(m, (0, 0), feather)
    return m

def save(name, arr):
    arr = arr.copy(); arr[arr[..., 3] < 1.5] = 0
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').save(f'{OUT}/{name}.png', optimize=True)

def masked(rgba, m):
    o = rgba.copy(); o[..., 3] = rgba[..., 3] * m; return o

_reg = src[400:540, 300:620].reshape(-1, 3)
_m = (_reg[:, 0] > 225) & (_reg[:, 1] > 110) & (_reg[:, 1] < 200) & (_reg[:, 2] > 90) & (_reg[:, 2] < 190)
skin_mean = np.median(_reg[_m], 0); skin_std = _reg[_m].std(0)
print('skin', skin_mean, skin_std)

def grain(shape, std, blur=0.8):
    n = rng.normal(0, 1, shape[:2]).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), blur); n /= (n.std() + 1e-6)
    streak = cv2.GaussianBlur(rng.normal(0, 1, shape[:2]).astype(np.float32), (0, 0), sigmaX=0.6, sigmaY=3.0)
    streak /= (streak.std() + 1e-6)
    t = 0.7 * n + 0.5 * streak
    return t[..., None] * std.mean() * 0.8

def inpaint_rgb(rgb, region, radius=6):
    img = np.clip(rgb, 0, 255).astype(np.uint8)
    m = (region > 0.5).astype(np.uint8) * 255
    return cv2.inpaint(img, m, radius, cv2.INPAINT_TELEA).astype(np.float32)

def skin_fill(rgba, region_poly, grow=3, pull=0.55):
    """Replace the area with inpainted skin + pencil grain."""
    m = poly_mask(region_poly, 0)
    m = cv2.dilate(m, np.ones((grow * 2 + 1, grow * 2 + 1), np.uint8))
    filled = inpaint_rgb(rgba[..., :3], m, 9)
    ring = cv2.dilate(m, np.ones((15, 15), np.uint8)) - m
    px = rgba[..., :3][ring > 0.5]
    ok = (px[:, 0] > 215) & (px[:, 1] > 100) & (px[:, 1] < 200) & (px[:, 2] < 185)
    local = np.median(px[ok], 0) if ok.sum() > 30 else skin_mean
    # pull toward average skin so dark lines don't bleed in, then add grain
    g = grain(filled.shape, np.array([1.0], np.float32))[..., 0:1] / max(1e-6, 0.8)
    # texture transfer: tile a clean skin patch (mirrored) and match it to the local tone
    patch = rgba[400:470, 430:490, :3]
    tile = np.concatenate([patch, patch[:, ::-1]], 1); tile = np.concatenate([tile, tile[::-1]], 0)
    reps = (H // tile.shape[0] + 2, W // tile.shape[1] + 2, 1)
    tex = np.tile(tile, reps)
    oy, ox = rng.integers(0, tile.shape[0]), rng.integers(0, tile.shape[1])
    tex = tex[oy:oy + H, ox:ox + W]
    tex = tex - patch.reshape(-1, 3).mean(0) + local
    low = cv2.GaussianBlur(filled, (0, 0), 6)
    lowtex = cv2.GaussianBlur(tex, (0, 0), 6)
    filled = (tex - lowtex) + (low * (1 - pull) + local * pull)
    soft = cv2.GaussianBlur(m, (0, 0), 2.5)[..., None]
    out = rgba.copy()
    out[..., :3] = rgba[..., :3] * (1 - soft) + filled * soft
    return out

# ---------- 2. layers ----------
mHead = poly_mask(HEAD, 1.5)
mEarL = poly_mask(EAR_L, 1.5); mEarR = poly_mask(EAR_R, 1.5)
mHairL = poly_mask(HAIR_L, 2.0); mHairR = poly_mask(HAIR_R, 2.0)
mHeart = poly_mask(HEART, 2.0)

# base: everything, with moving parts removed (inner area) and filled
base = RGBA.copy()
def hole(m, erode=5):
    return cv2.erode((m > 0.5).astype(np.uint8), np.ones((erode * 2 + 1,) * 2, np.uint8)).astype(np.float32)
# head interior
hHead = hole(mHead, 4)
fillH = inpaint_rgb(base[..., :3], hHead, 12)
yy = np.arange(H)[:, None].repeat(W, 1)
neckband = np.clip((yy - 480) / 40, 0, 1)
dHead = cv2.dilate((mHead > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
base[..., :3] = np.where(hHead[..., None] > 0, fillH, base[..., :3])
mDress = poly_mask(DRESS, 2.0)
mBehind = poly_mask(BEHIND_HEAD, 3.0)
keepA = np.maximum(mBehind, mDress)
base[..., 3] = np.where(dHead > 0, np.where(hHead > 0, base[..., 3] * keepA, base[..., 3] * np.maximum(mBehind, mDress)), base[..., 3])
for m in (mEarL, mEarR):
    dm = cv2.dilate((m > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    base[..., 3] *= (1 - dm * (1 - mHead))
for m in (mHairL, mHairR):
    hm = hole(m, 4)
    f = inpaint_rgb(base[..., :3], hm, 14)
    base[..., :3] = np.where(hm[..., None] > 0, f, base[..., :3])
    dm = cv2.dilate((m > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    # under the hair only the dress (and the neck area) stays opaque
    base[..., 3] = np.where(dm > 0, base[..., 3] * np.maximum(mDress, mHead * 0), base[..., 3])
hH = hole(mHeart, 3)
f = inpaint_rgb(base[..., :3], hH, 10)
base[..., :3] = np.where(hH[..., None] > 0, f, base[..., :3])

save('base', base)
save('hair_l', masked(RGBA, mHairL))
save('hair_r', masked(RGBA, mHairR))
save('ear_l', masked(RGBA, mEarL))
save('ear_r', masked(RGBA, mEarR))
save('heart', masked(RGBA, mHeart))

# head with eyes + mouth removed (skin)
head = RGBA.copy()
for poly in (EYE_L, EYE_R): head = skin_fill(head, poly, 5, 0.93)
head = skin_fill(head, MOUTH, 1)
save('head', masked(head, mHead))

# ---------- 3. eyes ----------
lash = src[(np.linalg.norm(src - np.array([25, 75, 160]), axis=2) < 40)].mean(0)
print('lash colour', lash)
CREAM = np.array([252, 238, 205], np.float32)

def eye_sprites(name, poly, inner):
    mE = poly_mask(poly, 1.2); mI = poly_mask(inner, 0.8)
    # open (full original) - kept for reference/fallback
    save(f'{name}_open', masked(RGBA, mE))
    # white: original ring + cream interior
    wh = RGBA.copy()
    cream = CREAM + grain(wh.shape, np.array([6, 6, 6], np.float32))
    wh[..., :3] = wh[..., :3] * (1 - mI[..., None]) + cream * mI[..., None]
    save(f'{name}_white', masked(wh, mE))
    save(f'{name}_iris', masked(RGBA, poly_mask(inner, 0.6)))
    save(f'{name}_mask', np.dstack([np.full((H, W, 3), 255, np.float32), mI * 255]))
    # closed: skin + lash curve
    cl = skin_fill(RGBA.copy(), poly, 5, 0.93)
    S = 4
    big = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0)); dr = ImageDraw.Draw(big)
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    x0, x1 = min(xs) + 3, max(xs) - 3
    yc = (min(ys) + max(ys)) / 2 + 3
    sag = (max(ys) - min(ys)) * 0.28
    col = tuple(int(c) for c in lash)
    for k in range(4):
        pts = []
        for i in range(40):
            t = i / 39; x = x0 + (x1 - x0) * t
            y = yc + sag * (4 * t * (1 - t)) + rng.normal(0, 0.25) + (k - 1.5) * 0.35
            pts.append((x * S, y * S))
        dr.line(pts, fill=col + (200,), width=int(S * 3.2), joint='curve')
    # lashes at the outer corner
    outer_left = name.endswith('_l')
    for j in range(3):
        bx = x0 + 4 + j * 4 if outer_left else x1 - 4 - j * 4
        t = (bx - x0) / (x1 - x0); by = yc + sag * (4 * t * (1 - t))
        dx = -5 if outer_left else 5
        dr.line([(bx * S, by * S), ((bx + dx) * S, (by + 3 + j) * S)], fill=col + (190,), width=int(S * 1.2))
    big = big.filter(ImageFilter.GaussianBlur(S * 0.35)).resize((W, H), Image.LANCZOS)
    L = np.asarray(big).astype(np.float32)
    la = L[..., 3:4] / 255
    cl[..., :3] = cl[..., :3] * (1 - la) + L[..., :3] * la
    save(f'{name}_closed', masked(cl, mE))
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2
    return dict(cx=cx, cy=cy, x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys))

meta = {}
meta['eye_l'] = eye_sprites('eye_l', EYE_L, EYE_L_IN)
meta['eye_r'] = eye_sprites('eye_r', EYE_R, EYE_R_IN)

# ---------- 4. mouths ----------
mM = poly_mask(MOUTH, 1.0)
save('mouth_neutral', masked(RGBA, mM))
MCX, MCY = MOUTH_C
LINE = tuple(int(c) for c in lash)
INSIDE = (128, 32, 58); TONGUE = (238, 112, 118); ORANGE = (240, 110, 60)

def draw_mouth(name, shape):
    S = 6; big = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0)); dr = ImageDraw.Draw(big)
    def P(pts): return [((MCX + x) * S, (MCY + y) * S) for x, y in pts]
    def curve(f, x0, x1, n=40):
        return [(x0 + (x1 - x0) * i / (n - 1), f(x0 + (x1 - x0) * i / (n - 1))) for i in range(n)]
    w, top, bot, tw = shape
    upper = curve(lambda x: top * (1 - (x / w) ** 2) * -1 + 0.0 * x - (abs(x) / w) ** 2 * 1.5 * (tw), -w, w)
    lower = curve(lambda x: bot * (1 - (x / w) ** 2) - (abs(x) / w) ** 2 * 1.5 * tw, w, -w)
    outline = upper + lower
    dr.polygon(P(outline), fill=INSIDE + (255,))
    # tongue
    if bot > 4:
        tg = curve(lambda x: bot * (1 - (x / (w * 0.75)) ** 2) * 0.95, -w * 0.7, w * 0.7)
        tgu = [(x, bot * 0.25 + 0.15 * abs(x)) for x, _ in tg[::-1]]
        dr.polygon(P(tg + tgu), fill=TONGUE + (255,))
    # orange pencil under-shade like her drawing
    for k in range(3):
        sh = curve(lambda x: bot * (1 - (x / w) ** 2) + 3.2 + k * 0.9 + rng.normal(0, .2), -w * 0.8, w * 0.8)
        dr.line(P(sh), fill=ORANGE + (120,), width=int(S * 1.9), joint='curve')
    for k in range(3):
        jit = lambda pts: [(x + rng.normal(0, .15), y + rng.normal(0, .2)) for x, y in pts]
        dr.line(P(jit(upper)), fill=LINE + (210,), width=int(S * 2.4), joint='curve')
        dr.line(P(jit(lower)), fill=LINE + (150,), width=int(S * 1.6), joint='curve')
    big = big.filter(ImageFilter.GaussianBlur(S * 0.3)).resize((W, H), Image.LANCZOS)
    L = np.asarray(big).astype(np.float32)
    # pencil grain on the fill
    g = grain(L.shape, np.array([10, 10, 10], np.float32))
    L[..., :3] = np.clip(L[..., :3] + g, 0, 255)
    save(name, L)

#           half-width, upper bulge, lower depth, corner lift
SC = 1.5
draw_mouth('mouth_small', tuple(v * SC for v in (11, 1.0, 5.0, 1.0)))
draw_mouth('mouth_a', tuple(v * SC for v in (15, 2.5, 13.0, 0.5)))
draw_mouth('mouth_o', tuple(v * SC for v in (8, 7.0, 9.0, -1.0)))
draw_mouth('mouth_smile', tuple(v * SC for v in (19, -1.5, 9.0, 4.0)))
R = lambda v: round(v / 1.5, 1)
for k in ('eye_l', 'eye_r'):
    meta[k] = {kk: R(vv) for kk, vv in meta[k].items()}
meta['mouth'] = dict(cx=R(MCX), cy=R(MCY))
meta['pivots'] = {k: [R(v[0]), R(v[1])] for k, v in PIVOTS.items()}
meta['size'] = [600, 600]
meta['assetSize'] = [W, H]
meta['note'] = 'All coordinates are rig units (600x600). PNGs are 900x900: draw them with drawImage(img, 0, 0, 600, 600).'
json.dump(meta, open(f'{OUT}/rig.json', 'w'), indent=1)
print('done')
