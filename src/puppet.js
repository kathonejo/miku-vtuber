import { clamp, finite, hash01, smoothstep, Spring1D } from './filters.js';
import { isChroma, styleById } from './settings.js';

const RIG_SIZE = 600;
const MAX_ROLL = (10 * Math.PI) / 180;
const MAX_EAR = (7 * Math.PI) / 180;
const MAX_HAIR = (2.5 * Math.PI) / 180;
const MAX_LEAN = (4 * Math.PI) / 180;
const FIT = { x0: 100, y0: 25, x1: 500, y1: 570 };

const LAYER_NAMES = [
  'base', 'hair_l', 'hair_r', 'heart',
  'ear_l', 'ear_r', 'head',
  'eye_l_white', 'eye_r_white',
  'eye_l_iris', 'eye_r_iris',
  'eye_l_mask', 'eye_r_mask',
  'eye_l_closed', 'eye_r_closed',
  'mouth_neutral', 'mouth_small', 'mouth_a', 'mouth_o', 'mouth_smile',
];

const SHADOW_NAMES = ['base', 'hair_l', 'hair_r', 'heart', 'ear_l', 'ear_r', 'head'];
const PAPER_NAMES = ['ear_l', 'ear_r', 'head'];
const TINT_NAMES = LAYER_NAMES.filter((name) => !name.endsWith('mask'));

const MOUTH_LAYER = {
  neutral: 'mouth_neutral',
  small: 'mouth_small',
  a: 'mouth_a',
  o: 'mouth_o',
  smile: 'mouth_smile',
};

const INK = '#1c2430';
const PAL = {
  lash: '#0e5797',
  hair: '#c8e03c',
  green: '#3f6a1c',
  skin: '#f7a98f',
  orange: '#f0703c',
  dress: '#49c6d6',
  white: '#fff5dc',
};

/** Corona sobre el flequillo, y≈205, entre los mechones (x 160..470). */
function flowerList() {
  const spec = [
    [220, 212, 11, PAL.orange],
    [268, 204, 13, PAL.dress],
    [316, 198, 12, PAL.white],
    [364, 198, 14, PAL.hair],
    [412, 204, 12, PAL.orange],
    [458, 212, 11, PAL.dress],
  ];
  return spec.map(([x, y, r, c], i) => ({ x, y, r, c, s: i + 1 }));
}

const PARAPPA_DOTS = Array.from({ length: 16 }, (_, i) => ({
  x: ((i * 137) % 100) / 100,
  y: (8 + ((i * 53) % 62)) / 100,
  r: 9 + (i % 4) * 4,
  fill: ['#fff5dc', '#ff3b4e', '#ffe14a', '#fff5dc'][i % 4],
}));

const NIGHT_STARS = Array.from({ length: 42 }, (_, i) => ({
  x: ((i * 97) % 100) / 100,
  y: ((i * 53) % 72) / 100,
  r: i % 8 === 0 ? 3.1 : i % 3 === 0 ? 1.8 : 1.15,
  phase: (i % 11) * 0.55,
}));

function assetUrl(file) {
  const base = import.meta.env?.BASE_URL || './';
  return `${base}bunny/${file}`;
}

function loadImage(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`No se pudo cargar ${name}`);
      resolve(img);
    };
    img.src = assetUrl(`${name}.png`);
  });
}

function drawable(src) {
  if (!src) return false;
  if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) return src.width > 0;
  return Boolean(src.complete && src.naturalWidth > 0);
}

function jitter(seed) {
  const x = Math.sin(seed * 91.17 + 0.37) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

function xy(v, fb) {
  if (Array.isArray(v) && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) {
    return { x: +v[0], y: +v[1] };
  }
  return fb;
}

function defaultRig() {
  return {
    neck: { x: 310, y: 366.7 },
    earL: { x: 240, y: 200 },
    earR: { x: 383.3, y: 194.7 },
    hairL: { x: 193.3, y: 356.7 },
    hairR: { x: 426.7, y: 300 },
    heart: { x: 312, y: 400 },
    feet: { x: 310, y: 560 },
    eyeL: { x: 236, y: 305, x0: 188.7, y0: 282, x1: 283.3, y1: 328 },
    eyeR: { x: 372.3, y: 286, x0: 330, y0: 265.3, x1: 414.7, y1: 306.7 },
    mouth: { x: 308.7, y: 334.7 },
    assetW: 900,
    assetH: 900,
  };
}

function normalizeRig(json) {
  const rig = defaultRig();
  if (!json || typeof json !== 'object') return rig;
  const p = json.pivots || {};
  rig.neck = xy(p.neck, rig.neck);
  rig.earL = xy(p.ear_l, rig.earL);
  rig.earR = xy(p.ear_r, rig.earR);
  rig.hairL = xy(p.hair_l, rig.hairL);
  rig.hairR = xy(p.hair_r, rig.hairR);
  rig.heart = xy(p.heart, rig.heart);
  rig.feet = xy(p.feet, rig.feet);
  if (Array.isArray(json.assetSize) && json.assetSize.length >= 2) {
    const w = Math.round(finite(json.assetSize[0], rig.assetW));
    const h = Math.round(finite(json.assetSize[1], rig.assetH));
    if (w > 0 && h > 0) {
      rig.assetW = w;
      rig.assetH = h;
    }
  }
  if (json.eye_l) {
    rig.eyeL = {
      x: finite(json.eye_l.cx, rig.eyeL.x),
      y: finite(json.eye_l.cy, rig.eyeL.y),
      x0: finite(json.eye_l.x0, rig.eyeL.x0),
      y0: finite(json.eye_l.y0, rig.eyeL.y0),
      x1: finite(json.eye_l.x1, rig.eyeL.x1),
      y1: finite(json.eye_l.y1, rig.eyeL.y1),
    };
  }
  if (json.eye_r) {
    rig.eyeR = {
      x: finite(json.eye_r.cx, rig.eyeR.x),
      y: finite(json.eye_r.cy, rig.eyeR.y),
      x0: finite(json.eye_r.x0, rig.eyeR.x0),
      y0: finite(json.eye_r.y0, rig.eyeR.y0),
      x1: finite(json.eye_r.x1, rig.eyeR.x1),
      y1: finite(json.eye_r.y1, rig.eyeR.y1),
    };
  }
  if (json.mouth) {
    rig.mouth = {
      x: finite(json.mouth.cx, rig.mouth.x),
      y: finite(json.mouth.cy, rig.mouth.y),
    };
  }
  return rig;
}

function pixelSize(img, fallbackW = 900, fallbackH = 900) {
  const w = Math.round(img?.naturalWidth || img?.width || fallbackW);
  const h = Math.round(img?.naturalHeight || img?.height || fallbackH);
  return { w: w > 0 ? w : fallbackW, h: h > 0 ? h : fallbackH };
}

function bakeSilhouette(img) {
  const { w, h } = pixelSize(img);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  return c;
}

function bakePaper(img) {
  const { w, h } = pixelSize(img);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgb(250,240,220)';
  g.fillRect(0, 0, w, h);
  return c;
}

function bakeSoft(sil) {
  const w = sil.width;
  const h = sil.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const blur = 4.5 * (w / RIG_SIZE);
  try {
    g.filter = `blur(${blur}px)`;
    g.drawImage(sil, 0, 0);
    g.filter = 'none';
  } catch {
    g.filter = 'none';
    g.clearRect(0, 0, w, h);
    g.drawImage(sil, 0, 0);
  }
  return c;
}

function bakeFiltered(img, filter) {
  const { w, h } = pixelSize(img);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  try {
    if (filter && filter !== 'none') g.filter = filter;
    g.drawImage(img, 0, 0);
    g.filter = 'none';
  } catch {
    g.filter = 'none';
    g.clearRect(0, 0, w, h);
    g.drawImage(img, 0, 0);
  }
  return c;
}

function makeGrain() {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const g = c.getContext('2d');
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 118 + ((Math.sin(i * 12.989) * 43758.5453) % 1) * 90;
    img.data[i] = n;
    img.data[i + 1] = n;
    img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Elige el sprite de la boca. jaw < 0.1 siempre es la sonrisa original. */
export function pickViseme(jaw, funnel, pucker, smile) {
  const j = finite(jaw, 0);
  const f = finite(funnel, 0);
  const p = finite(pucker, 0);
  const s = finite(smile, 0);
  const scores = { neutral: 0, a: -1, small: -1, o: 0, smile: 0 };
  if (j < 0.1) {
    scores.neutral = 1;
    return { id: 'neutral', scores };
  }
  const aa = j * (1 - 0.6 * f) * (1 - 0.5 * p);
  const oh = f * (0.5 + j);
  const ou = p * (1 - 0.6 * Math.min(j, 1.5));
  const smileOpen = (j > 0.12 ? s : 0) * 1.1;
  scores.a = j > 0.38 ? aa : -1;
  scores.small = j <= 0.38 ? aa : -1;
  scores.o = Math.max(oh, ou);
  scores.smile = smileOpen;
  let id = j > 0.38 ? 'a' : 'small';
  let best = -Infinity;
  for (const key of ['a', 'small', 'o', 'smile']) {
    if (scores[key] > best) {
      best = scores[key];
      id = key;
    }
  }
  if (!(best > 0)) {
    id = j > 0.38 ? 'a' : 'small';
    scores[id] = Math.max(j, 0.01);
  }
  return { id, scores };
}

export function jumpPose(t) {
  const time = finite(t, 0);
  if (time < 0.09) {
    const k = time / 0.09;
    return { y: 5 * k, sy: 1 - 0.09 * k };
  }
  if (time < 0.26) {
    const k = (time - 0.09) / 0.17;
    const e = Math.sin(k * Math.PI * 0.5);
    return { y: 5 * (1 - e) - 50 * e, sy: 0.91 + 0.22 * e };
  }
  if (time < 0.46) {
    const k = (time - 0.26) / 0.2;
    return { y: -50 - 8 * Math.sin(k * Math.PI), sy: 1.13 - 0.05 * k };
  }
  if (time < 0.58) {
    const k = (time - 0.46) / 0.12;
    return { y: -50 * (1 - k), sy: 1.08 - 0.24 * k };
  }
  const k = clamp((time - 0.58) / 0.18, 0, 1);
  return { y: 4 * (1 - k), sy: 0.84 + 0.16 * k };
}

function springTune(smoothing) {
  const s = clamp(finite(smoothing, 0.35), 0, 1);
  return {
    k: 180 * (1.25 - 0.7 * s),
    c: 14 * (0.8 + 0.55 * s),
  };
}

function neckFollow(neck, feet, sx, sy, lean) {
  const dx = neck.x - feet.x;
  const dy = neck.y - feet.y;
  const x1 = dx * sx;
  const y1 = dy * sy;
  const c = Math.cos(lean);
  const s = Math.sin(lean);
  return {
    x: c * x1 - s * y1 - dx,
    y: s * x1 + c * y1 - dy,
  };
}

function roundBox(ctx, x, y, w, h, r) {
  ctx.beginPath();
  const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}

function markerLine(ctx, x1, y1, x2, y2, color, width, seed) {
  for (let i = 0; i < 3; i += 1) {
    const ox = jitter(seed + i) * 1.1;
    const oy = jitter(seed + i + 5) * 1.1;
    const mx = (x1 + x2) / 2 + jitter(seed + 11 + i) * 2.2;
    const my = (y1 + y2) / 2 + jitter(seed + 17 + i) * 2.2;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(x1 + ox, y1 + oy);
    ctx.quadraticCurveTo(mx, my, x2 - ox * 0.4, y2 - oy * 0.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function markerEllipse(ctx, x, y, rx, ry, fill, stroke, seed, rot = 0) {
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.78;
    ctx.ellipse(
      x + jitter(seed + i) * 0.8,
      y + jitter(seed + i + 3) * 0.8,
      rx,
      ry,
      rot,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 2.2;
    ctx.ellipse(
      x + jitter(seed + 6 + i) * 0.7,
      y + jitter(seed + 9 + i) * 0.7,
      rx,
      ry,
      rot + jitter(seed + i) * 0.04,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawBow(ctx, rig) {
  const x = rig.earR.x + 11.7;
  const y = rig.earR.y - 154.7;
  markerEllipse(ctx, x - 14, y + 2, 15, 11, PAL.orange, PAL.green, 21, -0.4);
  markerEllipse(ctx, x + 14, y + 1, 15, 11, PAL.hair, PAL.green, 28, 0.35);
  markerEllipse(ctx, x, y + 4, 6.5, 5.5, PAL.orange, INK, 33);
  markerLine(ctx, x - 3, y + 8, x - 18, y + 30, PAL.orange, 4, 40);
  markerLine(ctx, x + 4, y + 8, x + 20, y + 28, PAL.hair, 4, 46);
  markerLine(ctx, x - 6, y + 10, x - 14, y + 26, PAL.white, 1.6, 52);
}

function drawFlower(ctx, flower) {
  const { x, y, r, c, s } = flower;
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5 + jitter(s + i) * 0.08;
    ctx.beginPath();
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.92;
    ctx.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.5, r * 0.46, r * 0.32, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAL.green;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.fillStyle = PAL.orange;
  ctx.arc(x, y, Math.max(2.5, r * 0.28), 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = PAL.green;
  ctx.stroke();
}

function drawFlowerCrown(ctx) {
  const flowers = flowerList();
  ctx.save();
  const a = flowers[0];
  const b = flowers[flowers.length - 1];
  markerLine(ctx, a.x - 10, a.y + 2, b.x + 8, b.y + 2, PAL.green, 3.2, 70);
  for (const flower of flowers) drawFlower(ctx, flower);
  ctx.restore();
}

function drawGlasses(ctx, rig) {
  const eyes = [rig.eyeL, rig.eyeR];
  const ang = Math.atan2(rig.eyeR.y - rig.eyeL.y, rig.eyeR.x - rig.eyeL.x);
  ctx.save();
  for (let n = 0; n < eyes.length; n += 1) {
    const eye = eyes[n];
    const rx = Math.max((eye.x1 - eye.x0) * 0.55, (eye.x1 - eye.x0) * 0.5 + 4);
    const ry = Math.max((eye.y1 - eye.y0) * 0.7, (eye.y1 - eye.y0) * 0.5 + 4);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.lineWidth = i === 0 ? 5 : 2.6;
      ctx.strokeStyle = i === 0 ? INK : PAL.lash;
      ctx.globalAlpha = i === 0 ? 0.45 : 0.8;
      ctx.ellipse(
        eye.x + jitter(80 + n + i) * 0.5,
        eye.y + jitter(84 + n + i) * 0.5,
        rx,
        ry,
        ang * 0.35,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = PAL.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(eye.x - rx * 0.28, eye.y - ry * 0.28, rx * 0.28, Math.PI * 1.05, Math.PI * 1.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const rxL = Math.max((rig.eyeL.x1 - rig.eyeL.x0) * 0.55, 20);
  const rxR = Math.max((rig.eyeR.x1 - rig.eyeR.x0) * 0.55, 20);
  markerLine(ctx, rig.eyeL.x + rxL * 0.75, rig.eyeL.y, rig.eyeR.x - rxR * 0.75, rig.eyeR.y, PAL.lash, 3.4, 90);
  markerLine(ctx, rig.eyeL.x0 - 2, rig.eyeL.y, rig.eyeL.x0 - 22, rig.eyeL.y + 6, INK, 3, 94);
  markerLine(ctx, rig.eyeR.x1 + 2, rig.eyeR.y, rig.eyeR.x1 + 22, rig.eyeR.y + 4, INK, 3, 98);
  ctx.restore();
}

function drawStarSticker(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.46;
    const px = Math.cos(ang) * rad + jitter(120 + i) * 0.6;
    const py = Math.sin(ang) * rad + jitter(130 + i) * 0.6;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = PAL.hair;
  ctx.globalAlpha = 0.95;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = PAL.green;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = PAL.white;
  ctx.globalAlpha = 0.85;
  ctx.arc(-r * 0.18, -r * 0.22, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHeadphones(ctx, rig) {
  const left = { x: rig.neck.x - 160, y: 300 };
  const right = { x: rig.neck.x + 170, y: 300 };
  const y0 = left.y - 28;
  const y1 = right.y - 28;
  const ctrlY = 2 * (200 - 0.25 * (y0 + y1));
  ctx.save();
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineWidth = i === 0 ? 14 : 8;
    ctx.strokeStyle = i === 0 ? PAL.green : i === 1 ? PAL.dress : PAL.white;
    ctx.globalAlpha = i === 2 ? 0.35 : 0.92;
    const o = (i - 1) * 1.3;
    ctx.moveTo(left.x, y0 + o);
    ctx.quadraticCurveTo(rig.neck.x, ctrlY + o, right.x, y1 + o);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawCup(ctx, left.x, left.y);
  drawCup(ctx, right.x, right.y);
  ctx.restore();
}

function drawCup(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  roundBox(ctx, -22, -28, 44, 56, 16);
  ctx.fillStyle = PAL.green;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = PAL.dress;
  ctx.ellipse(0, 2, 13, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAL.lash;
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = PAL.orange;
  ctx.lineWidth = 3;
  ctx.arc(0, 2, 8, Math.PI * 0.9, Math.PI * 1.8);
  ctx.stroke();
  ctx.restore();
}

function drawBlush(ctx, rig) {
  const spots = [
    { x: rig.eyeL.x - 8, y: rig.eyeL.y1 + 22, rx: 22, ry: 12 },
    { x: rig.eyeR.x + 10, y: rig.eyeR.y1 + 24, rx: 20, ry: 11 },
  ];
  ctx.save();
  for (const spot of spots) {
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.fillStyle = PAL.orange;
      ctx.globalAlpha = 0.16;
      ctx.ellipse(
        spot.x + jitter(150 + i) * 1.4,
        spot.y + jitter(160 + i) * 1.1,
        spot.rx,
        spot.ry,
        jitter(170 + i) * 0.15,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    markerLine(ctx, spot.x - 10, spot.y + 1, spot.x + 9, spot.y - 1, PAL.orange, 2, spot.x);
  }
  ctx.restore();
}

function sparkList(rig) {
  const l = { x: rig.eyeL.x - 8, y: rig.eyeL.y1 + 22 };
  const r = { x: rig.eyeR.x + 10, y: rig.eyeR.y1 + 24 };
  return [
    { x: l.x - 16, y: l.y - 10, s: 5, p: 0.2 },
    { x: l.x + 12, y: l.y + 8, s: 4, p: 1.1 },
    { x: l.x - 2, y: l.y + 16, s: 6, p: 2.0 },
    { x: r.x - 14, y: r.y + 10, s: 5, p: 0.6 },
    { x: r.x + 14, y: r.y - 4, s: 4, p: 1.7 },
    { x: l.x + 4, y: l.y - 22, s: 4, p: 2.4 },
    { x: r.x - 6, y: r.y - 18, s: 5, p: 0.9 },
  ];
}

function drawSparkles(ctx, time, rig) {
  ctx.save();
  for (const spark of sparkList(rig)) {
    const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3.2 + spark.p));
    ctx.save();
    ctx.translate(spark.x, spark.y);
    ctx.rotate(Math.sin(time * 1.4 + spark.p) * 0.2);
    ctx.globalAlpha = clamp(tw, 0, 1);
    ctx.fillStyle = PAL.white;
    ctx.strokeStyle = PAL.lash;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    const s = spark.s;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(1.3, -1.2, s, 0);
    ctx.quadraticCurveTo(1.2, 1.3, 0, s);
    ctx.quadraticCurveTo(-1.3, 1.2, -s, 0);
    ctx.quadraticCurveTo(-1.2, -1.3, 0, -s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawParappa(ctx, w, h, time) {
  ctx.fillStyle = '#ff4d2a';
  ctx.fillRect(0, 0, w + 2, h + 2);
  const cx = w * 0.5;
  const cy = h * 0.4;
  const radius = Math.hypot(w, h);
  const rays = 16;
  const rot = time * 0.12;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  for (let i = 0; i < rays; i += 1) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 0.5) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, a0, a1);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#ffe566' : '#ff8a1c';
    ctx.fill();
  }
  ctx.restore();

  for (const dot of PARAPPA_DOTS) {
    const x = dot.x * w;
    const y = dot.y * h * 0.72;
    ctx.beginPath();
    ctx.fillStyle = dot.fill;
    ctx.arc(x, y, dot.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#1a1020';
    ctx.stroke();
  }

  const floorY = h * 0.78;
  const cell = Math.max(24, Math.round(Math.min(w, h) / 28));
  for (let y = floorY; y < h + cell; y += cell) {
    for (let x = 0; x < w + cell; x += cell) {
      const odd = ((Math.floor(x / cell) + Math.floor((y - floorY) / cell)) % 2) === 0;
      ctx.fillStyle = odd ? '#241433' : '#fff3cf';
      ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
    }
  }
  ctx.fillStyle = '#1a1020';
  ctx.fillRect(0, floorY - 7, w, 10);
  ctx.fillStyle = '#ffe566';
  ctx.fillRect(0, floorY - 7, w, 3);
}

function drawRoom(ctx, w, h) {
  const ink = '#2c241c';
  ctx.fillStyle = '#f6d3b4';
  ctx.fillRect(0, 0, w + 2, h + 2);
  const floorY = h * 0.74;
  ctx.fillStyle = '#e7b56a';
  ctx.fillRect(0, floorY, w, h - floorY + 2);
  ctx.strokeStyle = 'rgba(140, 78, 32, 0.45)';
  ctx.lineWidth = 3;
  const gap = Math.max(36, w / 18);
  for (let x = gap; x < w; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.fillStyle = ink;
  ctx.fillRect(0, floorY - 6, w, 8);

  const ww = Math.min(w * 0.3, 260);
  const wh = h * 0.3;
  const wx = w * 0.08;
  const wy = h * 0.1;
  roundBox(ctx, wx, wy, ww, wh, 12);
  ctx.fillStyle = PAL.dress;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.strokeStyle = PAL.white;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy + 6);
  ctx.lineTo(wx + ww / 2, wy + wh - 6);
  ctx.moveTo(wx + 6, wy + wh / 2);
  ctx.lineTo(wx + ww - 6, wy + wh / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = '#ffe566';
  ctx.arc(wx + ww * 0.72, wy + wh * 0.32, Math.min(ww, wh) * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = ink;
  ctx.stroke();

  const px = w * 0.62;
  const py = h * 0.12;
  roundBox(ctx, px, py, Math.min(140, w * 0.22), h * 0.24, 8);
  ctx.fillStyle = PAL.white;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = PAL.orange;
  ctx.moveTo(px + 28, py + h * 0.13);
  ctx.arc(px + 46, py + h * 0.1, 16, 0, Math.PI * 2);
  ctx.arc(px + 68, py + h * 0.1, 16, 0, Math.PI * 2);
  ctx.fill();

  const bedW = Math.min(w * 0.42, 340);
  const bedH = h * 0.2;
  const bx = w * 0.5;
  const by = floorY - bedH + 8;
  roundBox(ctx, bx, by, bedW, bedH, 14);
  ctx.fillStyle = PAL.dress;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = ink;
  ctx.stroke();
  roundBox(ctx, bx + 12, by - 18, bedW * 0.36, 28, 8);
  ctx.fillStyle = PAL.white;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = PAL.green;
  roundBox(ctx, w * 0.08, floorY - 18, 36, 22, 4);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = PAL.green;
  ctx.lineWidth = 4;
  ctx.moveTo(w * 0.08 + 18, floorY - 18);
  ctx.quadraticCurveTo(w * 0.08 + 4, floorY - 48, w * 0.08 + 20, floorY - 58);
  ctx.moveTo(w * 0.08 + 18, floorY - 18);
  ctx.quadraticCurveTo(w * 0.08 + 34, floorY - 46, w * 0.08 + 28, floorY - 62);
  ctx.stroke();
}

function drawNight(ctx, w, h, time) {
  ctx.fillStyle = '#121a33';
  ctx.fillRect(0, 0, w + 2, h + 2);
  ctx.fillStyle = '#1d2c52';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.84);
  ctx.quadraticCurveTo(w * 0.45, h * 0.7, w, h * 0.86);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#0b1020';
  ctx.stroke();

  const mx = w * 0.78;
  const my = h * 0.2;
  const mr = Math.min(w, h) * 0.09;
  ctx.beginPath();
  ctx.fillStyle = PAL.white;
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = PAL.hair;
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = '#121a33';
  ctx.arc(mx + mr * 0.35, my - mr * 0.1, mr * 0.72, 0, Math.PI * 2);
  ctx.fill();

  for (const star of NIGHT_STARS) {
    const tw = 0.55 + 0.45 * Math.sin(time * 1.7 + star.phase);
    ctx.globalAlpha = clamp(tw, 0.25, 1);
    ctx.fillStyle = star.r > 2.4 ? PAL.hair : PAL.white;
    ctx.beginPath();
    ctx.arc(star.x * w, star.y * h * 0.75 + h * 0.04, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBackground(ctx, w, h, time, settings, grain) {
  const id = settings?.background || 'parappa';
  if (id === 'green') {
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, w + 2, h + 2);
    return;
  }
  if (id === 'blue') {
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, w + 2, h + 2);
    return;
  }
  if (id === 'custom') {
    ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(settings?.bgColor || '') ? settings.bgColor : '#243a5c';
    ctx.fillRect(0, 0, w + 2, h + 2);
    return;
  }
  if (id === 'parappa') {
    drawParappa(ctx, w, h, time);
    return;
  }
  if (id === 'cuarto') {
    drawRoom(ctx, w, h);
    return;
  }
  if (id === 'estrellas') {
    drawNight(ctx, w, h, time);
    return;
  }
  ctx.fillStyle = id === 'crema' ? '#f3e6c8' : '#243a5c';
  ctx.fillRect(0, 0, w + 2, h + 2);
  if (grain) {
    ctx.save();
    ctx.globalAlpha = id === 'crema' ? 0.22 : 0.14;
    const pattern = ctx.createPattern(grain, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w + 2, h + 2);
    }
    ctx.restore();
  }
}

export function createPuppet(canvas) {
  const ctx = canvas.getContext('2d');
  const eyeLBuf = document.createElement('canvas');
  const eyeRBuf = document.createElement('canvas');
  eyeLBuf.width = 900;
  eyeLBuf.height = 900;
  eyeRBuf.width = 900;
  eyeRBuf.height = 900;
  const eyeLCtx = eyeLBuf.getContext('2d');
  const eyeRCtx = eyeRBuf.getContext('2d');

  const yawS = new Spring1D(180, 14);
  const pitchS = new Spring1D(180, 14);
  const rollS = new Spring1D(180, 14);
  const earLS = new Spring1D(130, 12);
  const earRS = new Spring1D(130, 12);
  const hairLS = new Spring1D(110, 11);
  const hairRS = new Spring1D(110, 11);
  const bounceS = new Spring1D(180, 14);
  const heartLiftS = new Spring1D(170, 13);
  const heartRotS = new Spring1D(160, 13);
  const heartScaleS = new Spring1D(200, 14);
  heartScaleS.reset(1);

  const state = {
    loaded: false,
    time: 0,
    images: {},
    soft: {},
    paper: {},
    baked: null,
    bakedStyle: 'original',
    rig: defaultRig(),
    grain: null,
    grainPatternKey: '',
    jumpT: null,
    prevJaw: 0,
    prevPitch: 0,
    mouthId: 'neutral',
    mouthPrev: 'neutral',
    mouthFade: 1,
    pending: null,
    pendingN: 0,
    nextBlink: 1.7,
    blinkT: null,
    blinkIndex: 1,
    view: {
      yaw: 0,
      pitch: 0,
      roll: 0,
      rollRad: 0,
      blinkL: 0,
      blinkR: 0,
      gazeX: 0,
      gazeY: 0,
      jaw: 0,
      smile: 0,
      mouthId: 'neutral',
      mouthPrev: 'neutral',
      mouthFade: 1,
      earL: 0,
      earR: 0,
      hairL: 0,
      hairR: 0,
      bodySx: 1,
      bodySy: 1,
      lean: 0,
      followX: 0,
      followY: 0,
      heartLift: 0,
      heartRot: 0,
      heartScale: 1,
      jumpY: 0,
      jumpSy: 1,
      face: false,
    },
  };

  function num(targets, key, fallback = 0) {
    return finite(targets?.[key], fallback);
  }

  function ensureBake(settings) {
    const style = styleById(settings?.style);
    if (!style.filter || style.filter === 'none') {
      state.baked = null;
      state.bakedStyle = 'original';
      return;
    }
    if (state.bakedStyle === style.id && state.baked) return;
    const baked = {};
    for (const name of TINT_NAMES) {
      const img = state.images[name];
      if (!drawable(img)) continue;
      baked[name] = bakeFiltered(img, style.filter);
    }
    state.baked = baked;
    state.bakedStyle = style.id;
  }

  function sourceOf(name) {
    if (state.baked && state.baked[name]) return state.baked[name];
    return state.images[name];
  }

  function update(dtIn, targets, settings) {
    let dt = finite(dtIn, 0);
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    state.time += dt;
    const tune = springTune(settings?.smoothing);
    const springs = [yawS, pitchS, rollS, bounceS, heartLiftS, heartRotS, heartScaleS];
    for (const spring of springs) {
      spring.k = tune.k;
      spring.c = tune.c;
    }
    earLS.k = tune.k * 0.72;
    earRS.k = tune.k * 0.72;
    earLS.c = tune.c * 0.95;
    earRS.c = tune.c * 0.95;
    hairLS.k = tune.k * 0.58;
    hairRS.k = tune.k * 0.58;
    hairLS.c = tune.c * 0.9;
    hairRS.c = tune.c * 0.9;

    const face = Boolean(targets?.face);
    const yawT = clamp(num(targets, 'yaw'), -1.5, 1.5);
    const pitchT = clamp(num(targets, 'pitch'), -1.5, 1.5);
    const rollT = clamp(num(targets, 'roll'), -1.5, 1.5);
    yawS.update(yawT, dt);
    pitchS.update(pitchT, dt);
    rollS.update(rollT, dt);
    const yaw = clamp(yawS.x, -1.35, 1.35);
    const pitch = clamp(pitchS.x, -1.35, 1.35);
    const rollNorm = clamp(rollS.x, -1.35, 1.35);
    const rollRad = clamp(rollNorm, -1, 1) * MAX_ROLL;

    const jaw = clamp(num(targets, 'jaw'), 0, 1.5);
    const funnel = clamp(num(targets, 'funnel'), 0, 1.5);
    const pucker = clamp(num(targets, 'pucker'), 0, 1.5);
    const smile = clamp(num(targets, 'smile'), 0, 1.5);
    const bounceAmt = clamp(settings?.sensitivity?.bounce ?? 1, 0, 1.8);
    const bounceOn = settings?.bounce !== false;
    if (dt > 0 && bounceOn) {
      const dJaw = Math.max(0, jaw - state.prevJaw);
      const dPitch = Math.abs(pitch - state.prevPitch);
      bounceS.v += clamp(dJaw * 0.85 + dPitch * 0.4, 0, 0.22) * bounceAmt;
    }
    let sustain = 0;
    if (bounceOn) {
      sustain = clamp(jaw, 0, 1) * 0.028 * bounceAmt;
      if (!face) sustain += Math.max(0, Math.sin(state.time * 3.1)) * 0.016 * bounceAmt;
    }
    bounceS.update(clamp(sustain, 0, 0.05), dt);
    const bounce = bounceOn ? clamp(bounceS.x, -0.035, 0.05) : 0;
    let bodySy = (1 + 0.012 * Math.sin(state.time * 2.2)) * (1 + bounce);
    bodySy = clamp(bodySy, 0.88, 1.12);
    const bodySx = clamp(1 / Math.sqrt(bodySy), 0.9, 1.12);
    const shoulder = clamp(num(targets, 'shoulderTilt'), -0.2, 0.2);
    const lean = clamp(0.35 * rollRad + shoulder, -MAX_LEAN, MAX_LEAN);
    const follow = neckFollow(state.rig.neck, state.rig.feet, bodySx, bodySy, lean);

    let auto = 0;
    if (!face) {
      if (state.blinkT == null && state.time >= state.nextBlink) state.blinkT = 0;
      if (state.blinkT != null) {
        state.blinkT += dt;
        const dur = 0.16;
        if (state.blinkT >= dur) {
          state.blinkIndex += 1;
          state.nextBlink = state.time + 2.5 + hash01(state.blinkIndex + 2) * 3;
          state.blinkT = null;
        } else {
          const k = state.blinkT / dur;
          auto = clamp(k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6, 0, 1);
        }
      }
    } else {
      state.blinkT = null;
    }
    const blinkL = clamp(Math.max(num(targets, 'blinkL'), face ? 0 : auto), 0, 1);
    const blinkR = clamp(Math.max(num(targets, 'blinkR'), face ? 0 : auto), 0, 1);

    let wiggle = 0;
    if (!face) {
      const period = 5.4;
      const local = ((state.time % period) + period) % period;
      if (local > period - 0.7) {
        const k = (local - (period - 0.7)) / 0.7;
        wiggle = Math.sin(k * Math.PI * 2.5) * (1 - k) * 0.1;
      }
    }
    earLS.update(clamp(-yaw * 0.09 + wiggle, -MAX_EAR, MAX_EAR), dt);
    earRS.update(clamp(yaw * 0.08 - wiggle * 0.85, -MAX_EAR, MAX_EAR), dt);
    const sway = Math.sin(state.time * 1.65) * 0.018 + lean * 0.22;
    hairLS.update(clamp(sway, -MAX_HAIR, MAX_HAIR), dt);
    hairRS.update(clamp(-sway * 0.85, -MAX_HAIR, MAX_HAIR), dt);

    const wristUp = clamp(num(targets, 'wristUp'), 0, 1);
    heartLiftS.update(-14 * wristUp, dt);
    heartRotS.update(clamp(num(targets, 'heartRot'), -0.45, 0.45), dt);
    heartScaleS.update(smile > 0.55 ? 1.05 : 1, dt);

    const choice = pickViseme(jaw, funnel, pucker, smile);
    if (choice.id !== state.mouthId) {
      if (state.pending !== choice.id) {
        state.pending = choice.id;
        state.pendingN = 1;
      } else {
        state.pendingN += 1;
      }
      const currentScore = choice.scores[state.mouthId] ?? 0;
      const nextScore = choice.scores[choice.id] ?? 0;
      if (state.pendingN >= 2 && nextScore >= currentScore + 0.08) {
        state.mouthPrev = state.mouthId;
        state.mouthId = choice.id;
        state.mouthFade = 0;
        state.pending = null;
        state.pendingN = 0;
      }
    } else {
      state.pending = null;
      state.pendingN = 0;
    }
    state.mouthFade = Math.min(1, state.mouthFade + dt / 0.06);

    let jumpY = 0;
    let jumpSy = 1;
    if (state.jumpT != null) {
      state.jumpT += dt;
      if (state.jumpT > 0.8) state.jumpT = null;
      else {
        const pose = jumpPose(state.jumpT);
        jumpY = pose.y;
        jumpSy = pose.sy;
      }
    }

    const view = state.view;
    view.yaw = yaw;
    view.pitch = pitch;
    view.roll = rollNorm;
    view.rollRad = rollRad;
    view.blinkL = blinkL;
    view.blinkR = blinkR;
    view.gazeX = clamp(num(targets, 'gazeX'), -1.5, 1.5);
    view.gazeY = clamp(num(targets, 'gazeY'), -1.5, 1.5);
    view.jaw = jaw;
    view.smile = smile;
    view.mouthId = state.mouthId;
    view.mouthPrev = state.mouthPrev;
    view.mouthFade = state.mouthFade;
    view.earL = clamp(earLS.x, -MAX_EAR, MAX_EAR);
    view.earR = clamp(earRS.x, -MAX_EAR, MAX_EAR);
    view.hairL = clamp(hairLS.x, -MAX_HAIR, MAX_HAIR);
    view.hairR = clamp(hairRS.x, -MAX_HAIR, MAX_HAIR);
    view.bodySx = bodySx;
    view.bodySy = bodySy;
    view.lean = lean;
    view.followX = finite(follow.x, 0);
    view.followY = finite(follow.y, 0);
    view.heartLift = clamp(heartLiftS.x, -18, 4);
    view.heartRot = clamp(heartRotS.x, -0.5, 0.5);
    view.heartScale = clamp(heartScaleS.x, 0.9, 1.12);
    view.jumpY = finite(jumpY, 0);
    view.jumpSy = clamp(finite(jumpSy, 1), 0.75, 1.25);
    view.face = face;
    state.prevJaw = jaw;
    state.prevPitch = pitch;
  }

  function syncEyeBuffers() {
    const w = Math.max(1, Math.round(state.rig.assetW || 900));
    const h = Math.max(1, Math.round(state.rig.assetH || 900));
    if (eyeLBuf.width !== w || eyeLBuf.height !== h) {
      eyeLBuf.width = w;
      eyeLBuf.height = h;
    }
    if (eyeRBuf.width !== w || eyeRBuf.height !== h) {
      eyeRBuf.width = w;
      eyeRBuf.height = h;
    }
  }

  /** Dibuja una lámina (caché a assetSize) dentro del espacio de rig 600. */
  function blit(img, x = 0, y = 0) {
    ctx.drawImage(img, x, y, RIG_SIZE, RIG_SIZE);
  }

  function paintShadow(name) {
    const img = state.soft[name];
    if (!drawable(img)) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    blit(img, 5, 7);
    ctx.restore();
  }

  function paintEdge(name, ox, alpha) {
    const img = state.paper[name];
    if (!drawable(img) || alpha < 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    blit(img, ox, 0);
    ctx.restore();
  }

  function paintLayer(name) {
    const img = sourceOf(name);
    if (!drawable(img)) return;
    blit(img, 0, 0);
  }

  function about(px, py, rot, extraX, extraY, draw) {
    ctx.save();
    ctx.translate(px + extraX, py + extraY);
    if (rot) ctx.rotate(rot);
    ctx.translate(-px, -py);
    draw();
    ctx.restore();
  }

  function withHeart(draw) {
    const p = state.rig.heart;
    ctx.save();
    ctx.translate(p.x, p.y + state.view.heartLift);
    ctx.rotate(state.view.heartRot);
    const sc = state.view.heartScale;
    ctx.scale(sc, sc);
    ctx.translate(-p.x, -p.y);
    draw();
    ctx.restore();
  }

  function paintEye(side) {
    const prefix = side === 'l' ? 'eye_l' : 'eye_r';
    const white = sourceOf(`${prefix}_white`);
    const iris = sourceOf(`${prefix}_iris`);
    const mask = state.images[`${prefix}_mask`];
    const closed = sourceOf(`${prefix}_closed`);
    const buf = side === 'l' ? eyeLBuf : eyeRBuf;
    const bctx = side === 'l' ? eyeLCtx : eyeRCtx;
    const blink = side === 'l' ? state.view.blinkL : state.view.blinkR;
    if (drawable(white)) blit(white, 0, 0);
    syncEyeBuffers();
    const ratio = (buf.width || RIG_SIZE) / RIG_SIZE;
    const ox = clamp(state.view.gazeX, -1, 1) * 3 * ratio;
    const oy = clamp(state.view.gazeY, -1, 1) * 2 * ratio;
    if (bctx && drawable(iris) && drawable(mask)) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.globalCompositeOperation = 'source-over';
      bctx.globalAlpha = 1;
      bctx.clearRect(0, 0, buf.width, buf.height);
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(iris, ox, oy);
      bctx.globalCompositeOperation = 'destination-in';
      bctx.drawImage(mask, 0, 0);
      bctx.globalCompositeOperation = 'source-over';
      blit(buf, 0, 0);
    }
    const lid = smoothstep(0.35, 0.7, clamp(blink, 0, 1));
    if (lid > 0.015 && drawable(closed)) {
      ctx.save();
      ctx.globalAlpha = lid;
      blit(closed, 0, 0);
      ctx.restore();
    }
  }

  function paintMouth() {
    const view = state.view;
    const cur = sourceOf(MOUTH_LAYER[view.mouthId] || 'mouth_neutral');
    const prev = sourceOf(MOUTH_LAYER[view.mouthPrev] || 'mouth_neutral');
    const m = state.rig.mouth;
    const sy = clamp(0.85 + 0.35 * clamp(view.jaw, 0, 1.2), 0.7, 1.35);
    const sx = clamp(1 + 0.1 * clamp(view.smile, 0, 1.5), 0.85, 1.3);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(sx, sy);
    ctx.translate(-m.x, -m.y);
    const fade = clamp(view.mouthFade, 0, 1);
    if (fade < 0.999 && drawable(prev) && prev !== cur) {
      ctx.globalAlpha = 1 - fade;
      blit(prev, 0, 0);
    }
    if (drawable(cur)) {
      ctx.globalAlpha = fade < 0.999 && prev !== cur ? fade : 1;
      blit(cur, 0, 0);
    }
    ctx.restore();
  }

  function drawCharacter(settings) {
    const view = state.view;
    const rig = state.rig;
    const chroma = isChroma(settings?.background);
    const useShadow = settings?.paperShadow !== false && !chroma;
    const useEdge = settings?.paperThickness !== false;
    const edgeAmt = clamp((Math.abs(view.yaw) - 0.05) / 0.25, 0, 1);
    const edgeOx = -Math.sign(view.yaw || 0) * (2 + clamp(Math.abs(view.yaw), 0, 1));
    const edgeAlpha = 0.9 * edgeAmt;
    const acc = settings?.accessories || {};

    if (useShadow) {
      const lift = clamp(-view.jumpY / 50, 0, 1);
      const squash = view.jumpSy < 1 ? (1 - view.jumpSy) * 1.8 : 0;
      const rx = 148 * (1 - 0.22 * lift) * (1 + squash);
      const ry = 16 * (1 - 0.4 * lift);
      ctx.save();
      ctx.fillStyle = `rgba(24, 16, 28, ${0.26 * (1 - 0.55 * lift)})`;
      ctx.beginPath();
      ctx.ellipse(rig.feet.x + view.lean * 30, rig.feet.y + 8, rx, Math.max(6, ry), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (view.jumpY !== 0 || Math.abs(view.jumpSy - 1) > 0.001) {
      const sy = view.jumpSy;
      const sx = 1 / Math.sqrt(Math.max(0.6, sy));
      ctx.translate(rig.feet.x, rig.feet.y + view.jumpY);
      ctx.scale(sx, sy);
      ctx.translate(-rig.feet.x, -rig.feet.y);
    }

    ctx.save();
    ctx.translate(rig.feet.x, rig.feet.y);
    ctx.rotate(view.lean);
    ctx.scale(view.bodySx, view.bodySy);
    ctx.translate(-rig.feet.x, -rig.feet.y);
    if (useShadow) {
      paintShadow('base');
      about(rig.hairL.x, rig.hairL.y, view.hairL, 0, 0, () => paintShadow('hair_l'));
      about(rig.hairR.x, rig.hairR.y, view.hairR, 0, 0, () => paintShadow('hair_r'));
      withHeart(() => paintShadow('heart'));
    }
    paintLayer('base');
    about(rig.hairL.x, rig.hairL.y, view.hairL, 0, 0, () => paintLayer('hair_l'));
    about(rig.hairR.x, rig.hairR.y, view.hairR, 0, 0, () => paintLayer('hair_r'));
    withHeart(() => paintLayer('heart'));
    ctx.restore();

    const sx = clamp(1 - 0.14 * Math.abs(view.yaw), 0.86, 1);
    const sy = clamp(1 - 0.05 * Math.abs(view.pitch), 0.92, 1);
    const skew = clamp(view.yaw * 0.06, -0.06, 0.06);
    const offX = clamp(view.yaw * 9, -9, 9) + view.followX;
    const offY = clamp(view.pitch * 7, -9, 9) + view.followY;
    ctx.save();
    ctx.translate(rig.neck.x + offX, rig.neck.y + offY);
    ctx.rotate(view.rollRad);
    ctx.transform(sx, skew, 0, sy, 0, 0);
    ctx.translate(-rig.neck.x, -rig.neck.y);

    const earShiftX = -view.yaw * 3;
    const earShiftY = -view.pitch * 2;
    if (useShadow) {
      about(rig.earL.x, rig.earL.y, view.earL, earShiftX, earShiftY, () => paintShadow('ear_l'));
      about(rig.earR.x, rig.earR.y, view.earR, earShiftX, earShiftY, () => paintShadow('ear_r'));
      paintShadow('head');
    }
    about(rig.earL.x, rig.earL.y, view.earL, earShiftX, earShiftY, () => {
      if (useEdge) paintEdge('ear_l', edgeOx, edgeAlpha);
      paintLayer('ear_l');
    });
    about(rig.earR.x, rig.earR.y, view.earR, earShiftX, earShiftY, () => {
      if (useEdge) paintEdge('ear_r', edgeOx, edgeAlpha);
      paintLayer('ear_r');
      if (acc.bow) drawBow(ctx, rig);
    });
    if (useEdge) paintEdge('head', edgeOx, edgeAlpha);
    paintLayer('head');

    ctx.save();
    ctx.translate(view.yaw * 4, view.pitch * 3);
    paintEye('l');
    paintEye('r');
    paintMouth();
    if (acc.glasses) drawGlasses(ctx, rig);
    ctx.restore();

    if (acc.flowerCrown) drawFlowerCrown(ctx);
    if (acc.star) drawStarSticker(ctx, rig.eyeR.x1 + 5, rig.eyeR.y1 + 30, 14);
    if (acc.headphones) drawHeadphones(ctx, rig);
    if (acc.blush) drawBlush(ctx, rig);
    if (acc.sparkles) drawSparkles(ctx, state.time, rig);
    ctx.restore();
    ctx.restore();
  }

  function resize() {
    if (!ctx) return;
    const cssW = Math.max(1, canvas.clientWidth || 1);
    const cssH = Math.max(1, canvas.clientHeight || 1);
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function draw(settings) {
    if (!ctx) return;
    resize();
    const cssW = Math.max(1, canvas.clientWidth || 1);
    const cssH = Math.max(1, canvas.clientHeight || 1);
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cssW + 2, cssH + 2);
    if (!state.grain) state.grain = makeGrain();
    drawBackground(ctx, cssW, cssH, state.time, settings, state.grain);
    if (!state.loaded) return;
    ensureBake(settings);

    const charW = FIT.x1 - FIT.x0;
    const charH = FIT.y1 - FIT.y0;
    const cx = (FIT.x0 + FIT.x1) / 2;
    const cy = (FIT.y0 + FIT.y1) / 2;
    let scale = (cssH * 0.85) / charH;
    if (charW * scale > cssW * 0.94) scale = (cssW * 0.94) / charW;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    const ox = cssW / 2 - cx * scale;
    const oy = cssH / 2 - cy * scale;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawCharacter(settings || {});
  }

  const ready = (async () => {
    const images = {};
    await Promise.all(LAYER_NAMES.map(async (name) => {
      images[name] = await loadImage(name);
    }));
    state.images = images;
    let json = null;
    try {
      const res = await fetch(assetUrl('rig.json'));
      if (res.ok) json = await res.json();
    } catch {
      json = null;
    }
    state.rig = normalizeRig(json);
    syncEyeBuffers();
    for (const name of SHADOW_NAMES) {
      const img = images[name];
      if (!drawable(img)) continue;
      const sil = bakeSilhouette(img);
      state.soft[name] = bakeSoft(sil);
      if (PAPER_NAMES.includes(name)) state.paper[name] = bakePaper(img);
    }
    state.grain = makeGrain();
    state.loaded = true;
  })().catch((err) => {
    console.warn(err);
    state.loaded = true;
  });

  return {
    ready,
    update,
    draw,
    resize,
    triggerJump() {
      state.jumpT = 0;
    },
  };
}
