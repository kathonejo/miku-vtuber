import { createSleeves } from './arms.js';
import { createEyePainter, resolveStyle, stepEyeOpen, collectEyeFiles } from './eyes.js';
import { clamp, finite, hash01, Spring1D } from './filters.js';
import {
  applyOverrides as applyRigData,
  captureBase,
  loadOverrides,
  restoreBase,
  stampPart,
  strandTarget,
} from './rigparams.js';
import { isChroma, styleById } from './settings.js';

const MAX_ROLL = (10 * Math.PI) / 180;
const MAX_LEAN = (4 * Math.PI) / 180;
const EYE_FADE = 0.04;
const MOUTH_FADE = 0.06;

/** Parallax inside the head, in rig units, multiplied by normalized yaw/pitch. */
const PARALLAX = {
  hair_back: [-4, -2],
  ear_l: [-3, -2],
  ear_r: [-3, -2],
  lock_back_r: [-2, -1],
  lock_back_l: [-2, -1],
  human_ears: [-2, 0],
  face: [0, 0],
  mouth: [3, 2],
  strand_l: [1, 0],
  curl_l: [1, 0],
  strand_r: [1, 0],
  bangs: [2, 1],
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

function loadImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`No se pudo cargar ${file}`);
      resolve(img);
    };
    img.src = assetUrl(file);
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

function emptyManifest() {
  return {
    rigSize: [600, 600],
    pxPerUnit: 2,
    parts: [],
    mouths: {},
    extras: {},
    mouthCenter: { x: 290, y: 328 },
    pivots: {
      neck: { x: 294.33, y: 353.67 },
      feet: { x: 301.67, y: 570.33 },
      eye_l: { x: 197, y: 301 },
      eye_r: { x: 372.33, y: 274.33 },
      headTop: { x: 294.33, y: 200.33 },
    },
    bounds: { x0: 69.33, y0: 25, x1: 530.33, y1: 571 },
    byId: {},
    eyeSlot: { eye_l: null, eye_r: null },
    eyes: { l: null, r: null },
    eyeStyles: ['A', 'B'],
    arms: {
      parts: {},
      shoulders: {
        l: { x: 251.67, y: 383.67 },
        r: { x: 338.33, y: 383.67 },
      },
      hasCustom: false,
    },
  };
}

function normalizeManifest(json) {
  const m = emptyManifest();
  if (!json || typeof json !== 'object') return m;
  if (Array.isArray(json.rigSize) && json.rigSize.length >= 2) {
    m.rigSize = [finite(json.rigSize[0], 600), finite(json.rigSize[1], 600)];
  }
  m.pxPerUnit = finite(json.pxPerUnit, 2);
  const p = json.pivots || {};
  m.pivots.neck = xy(p.neck, m.pivots.neck);
  m.pivots.feet = xy(p.feet, m.pivots.feet);
  m.pivots.eye_l = xy(p.eye_l, m.pivots.eye_l);
  m.pivots.eye_r = xy(p.eye_r, m.pivots.eye_r);
  m.pivots.headTop = xy(p.headTop, m.pivots.headTop);
  if (json.bounds && typeof json.bounds === 'object') {
    m.bounds = {
      x0: finite(json.bounds.x0, m.bounds.x0),
      y0: finite(json.bounds.y0, m.bounds.y0),
      x1: finite(json.bounds.x1, m.bounds.x1),
      y1: finite(json.bounds.y1, m.bounds.y1),
    };
  }
  m.mouthCenter = xy(json.mouthCenter, m.mouthCenter);
  m.parts = Array.isArray(json.parts) ? json.parts.map((part) => ({ ...part })) : [];
  m.mouths = json.mouths && typeof json.mouths === 'object' ? json.mouths : {};
  m.extras = json.extras && typeof json.extras === 'object' ? json.extras : {};
  const byId = {};
  const eyeSlot = { eye_l: null, eye_r: null };
  for (const part of m.parts) {
    if (part?.id) byId[part.id] = part;
    if (part?.role === 'eye' && part.id) {
      const side = part.id.startsWith('eye_r') ? 'eye_r' : 'eye_l';
      if (!eyeSlot[side]) eyeSlot[side] = part;
    }
  }
  m.byId = byId;
  m.eyeSlot = eyeSlot;
  if (json.eyes && typeof json.eyes === 'object') {
    m.eyes = { l: json.eyes.l || null, r: json.eyes.r || null };
  }
  if (Array.isArray(json.eyeStyles) && json.eyeStyles.length) m.eyeStyles = json.eyeStyles.slice();
  if (json.arms && typeof json.arms === 'object') {
    const sh = json.arms.shoulders || {};
    m.arms.shoulders.l = xy(sh.l, m.arms.shoulders.l);
    m.arms.shoulders.r = xy(sh.r, m.arms.shoulders.r);
    if (json.arms.parts && typeof json.arms.parts === 'object') m.arms.parts = json.arms.parts;
    m.arms.hasCustom = Boolean(json.arms.hasCustom) && Object.keys(m.arms.parts).length > 0;
  }
  return m;
}

function collectFiles(manifest) {
  const files = [];
  const add = (file) => {
    if (typeof file === 'string' && file && !files.includes(file)) files.push(file);
  };
  for (const part of manifest.parts) add(part.file);
  for (const mouth of Object.values(manifest.mouths || {})) add(mouth?.file);
  for (const extra of Object.values(manifest.extras || {})) add(extra?.file);
  for (const arm of Object.values(manifest.arms?.parts || {})) add(arm?.file);
  collectEyeFiles(manifest, add);
  return files;
}

function parallaxOf(part) {
  if (!part) return [0, 0];
  if (part.role === 'eye' || (part.id && String(part.id).startsWith('eye_'))) return [4, 3];
  if (part.id && PARALLAX[part.id]) return PARALLAX[part.id];
  if (part.role === 'hair') return [1, 0];
  if (part.role === 'ear') return [-3, -2];
  if (part.role === 'mouth') return [3, 2];
  return [0, 0];
}

function pivotOf(part) {
  if (Array.isArray(part?.pivot) && part.pivot.length >= 2) {
    return { x: +part.pivot[0], y: +part.pivot[1] };
  }
  return {
    x: finite(part?.x, 0) + finite(part?.w, 0) / 2,
    y: finite(part?.y, 0) + finite(part?.h, 0) / 2,
  };
}

function pixelSize(img, fallbackW = 2, fallbackH = 2) {
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

function bakeSoft(sil, pxPerUnit) {
  const w = sil.width;
  const h = sil.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const blur = 4.5 * Math.max(0.5, finite(pxPerUnit, 2));
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

function drawBow(ctx, ear) {
  const x = ear.x + ear.w * 0.55;
  const y = ear.y + 12;
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

function flowerList(bangs, headTop) {
  const y = headTop.y + 10;
  const x0 = bangs?.x ?? 120;
  const span = bangs?.w ?? 360;
  const spec = [
    [0.12, 8, 11, PAL.orange],
    [0.28, 2, 13, PAL.dress],
    [0.44, -4, 12, PAL.white],
    [0.60, -4, 14, PAL.hair],
    [0.76, 2, 12, PAL.orange],
    [0.90, 8, 11, PAL.dress],
  ];
  return spec.map(([t, dy, r, c], i) => ({
    x: x0 + span * t,
    y: y + dy,
    r,
    c,
    s: i + 1,
  }));
}

function drawFlowerCrown(ctx, bangs, headTop) {
  const flowers = flowerList(bangs, headTop);
  ctx.save();
  const a = flowers[0];
  const b = flowers[flowers.length - 1];
  markerLine(ctx, a.x - 10, a.y + 2, b.x + 8, b.y + 2, PAL.green, 3.2, 70);
  for (const flower of flowers) drawFlower(ctx, flower);
  ctx.restore();
}

function drawGlasses(ctx, pivots, eyeL, eyeR) {
  const rL = 0.4 * (eyeL?.w || 140);
  const rR = 0.4 * (eyeR?.w || 135);
  const eyes = [
    { x: pivots.eye_l.x, y: pivots.eye_l.y, r: rL },
    { x: pivots.eye_r.x, y: pivots.eye_r.y, r: rR },
  ];
  const ang = Math.atan2(pivots.eye_r.y - pivots.eye_l.y, pivots.eye_r.x - pivots.eye_l.x);
  ctx.save();
  for (let n = 0; n < eyes.length; n += 1) {
    const eye = eyes[n];
    const rx = eye.r;
    const ry = eye.r * 0.72;
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
  markerLine(ctx, eyes[0].x + rL * 0.75, eyes[0].y, eyes[1].x - rR * 0.75, eyes[1].y, PAL.lash, 3.4, 90);
  markerLine(ctx, eyes[0].x - rL, eyes[0].y, eyes[0].x - rL - 22, eyes[0].y + 6, INK, 3, 94);
  markerLine(ctx, eyes[1].x + rR, eyes[1].y, eyes[1].x + rR + 22, eyes[1].y + 4, INK, 3, 98);
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

function drawHeadphones(ctx, pivots, ears) {
  const left = { x: ears.x, y: ears.y + ears.h / 2 };
  const right = { x: ears.x + ears.w, y: ears.y + ears.h / 2 };
  const topY = pivots.headTop.y;
  ctx.save();
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineWidth = i === 0 ? 14 : 8;
    ctx.strokeStyle = i === 0 ? PAL.green : i === 1 ? PAL.dress : PAL.white;
    ctx.globalAlpha = i === 2 ? 0.35 : 0.92;
    const o = (i - 1) * 1.3;
    // cubic arc whose apex sits on the crown of the hair (~topY - 35), above the bangs
    const peak = topY - 35 + o;
    const c = (peak - 0.25 * (left.y - 6)) / 0.75;
    ctx.moveTo(left.x, left.y - 6 + o);
    ctx.bezierCurveTo(left.x - 8, c, right.x + 8, c, right.x, right.y - 6 + o);
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

function drawBlush(ctx, pivots) {
  const spots = [
    { x: pivots.eye_l.x - 8, y: pivots.eye_l.y + 28, rx: 22, ry: 12 },
    { x: pivots.eye_r.x + 10, y: pivots.eye_r.y + 28, rx: 20, ry: 11 },
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

function sparkList(pivots) {
  const l = { x: pivots.eye_l.x - 8, y: pivots.eye_l.y + 28 };
  const r = { x: pivots.eye_r.x + 10, y: pivots.eye_r.y + 28 };
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

function drawSparkles(ctx, time, pivots) {
  ctx.save();
  for (const spark of sparkList(pivots)) {
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
  const sleeves = createSleeves();
  const eyePainter = createEyePainter();

  const yawS = new Spring1D(180, 14);
  const pitchS = new Spring1D(180, 14);
  const rollS = new Spring1D(180, 14);
  const bounceS = new Spring1D(180, 14);
  const heartScaleS = new Spring1D(200, 14);
  heartScaleS.reset(1);

  const partSprings = {};

  const state = {
    loaded: false,
    time: 0,
    images: {},
    soft: {},
    paper: {},
    baked: null,
    bakedStyle: 'original',
    manifest: emptyManifest(),
    source: null,
    baseParts: [],
    rigStore: { order: null, parts: {} },
    highlight: null,
    eyeStyle: 'A',
    delay: {},
    alpha: new Map(),
    place: { scale: 1, ox: 0, oy: 0 },
    useShadow: true,
    useEdge: true,
    edgeOx: 0,
    edgeAlpha: 0,
    grain: null,
    jumpT: null,
    prevJaw: 0,
    prevPitch: 0,
    prevWrist: 0,
    mouthId: 'neutral',
    mouthPrev: 'neutral',
    mouthFade: 1,
    pending: null,
    pendingN: 0,
    nextBlink: 1.7,
    blinkT: null,
    blinkIndex: 1,
    eye: {
      eye_l: { id: 'open', prev: 'open', fade: 1 },
      eye_r: { id: 'open', prev: 'open', fade: 1 },
    },
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
      wristUp: 0,
      bounce: 0,
      mouthId: 'neutral',
      mouthPrev: 'neutral',
      mouthFade: 1,
      partRot: {},
      bodySx: 1,
      bodySy: 1,
      lean: 0,
      heartScale: 1,
      jumpY: 0,
      jumpSy: 1,
      face: false,
    },
  };

  function num(targets, key, fallback = 0) {
    return finite(targets?.[key], fallback);
  }

  function sourceOf(file) {
    if (!file) return null;
    if (state.baked && state.baked[file]) return state.baked[file];
    return state.images[file];
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
    for (const [file, img] of Object.entries(state.images)) {
      if (!drawable(img)) continue;
      baked[file] = bakeFiltered(img, style.filter);
    }
    state.baked = baked;
    state.bakedStyle = style.id;
  }

  function initSprings() {
    const keep = new Set();
    for (const part of state.manifest.parts) {
      if (part.role !== 'ear' && part.role !== 'hair') continue;
      keep.add(part.id);
      if (!partSprings[part.id]) {
        const rig = part.rig;
        partSprings[part.id] = new Spring1D(rig?.stiffness || 110, rig?.damping || 12);
      }
    }
    for (const key of Object.keys(partSprings)) {
      if (!keep.has(key)) delete partSprings[key];
    }
  }

  function bakeCaches() {
    const ppu = state.manifest.pxPerUnit || 2;
    state.soft = {};
    state.paper = {};
    for (const [file, img] of Object.entries(state.images)) {
      if (!drawable(img)) continue;
      const sil = bakeSilhouette(img);
      state.soft[file] = bakeSoft(sil, ppu);
      state.paper[file] = bakePaper(img);
    }
  }

  function sampleDelay(id, phase, pose) {
    const buf = state.delay[id] || (state.delay[id] = []);
    buf.push({ t: state.time, yaw: pose.yaw, rollRad: pose.rollRad, lean: pose.lean });
    const horizon = state.time - 0.3;
    while (buf.length > 2 && buf[0].t < horizon) buf.shift();
    const want = state.time - clamp(phase, 0, 1) * 0.25;
    let chosen = buf[0];
    for (const sample of buf) {
      if (sample.t <= want) chosen = sample;
    }
    return chosen || pose;
  }

  function reindex() {
    const byId = {};
    const eyeSlot = { eye_l: null, eye_r: null };
    for (const part of state.manifest.parts) {
      if (part?.id) byId[part.id] = part;
      if (part?.role === 'eye' && part.id) {
        const side = part.id.startsWith('eye_r') ? 'eye_r' : 'eye_l';
        if (!eyeSlot[side]) eyeSlot[side] = part;
      }
    }
    state.manifest.byId = byId;
    state.manifest.eyeSlot = eyeSlot;
  }

  function installOverrides(store) {
    restoreBase(state.manifest, state.base);
    if (store) applyRigData(state.manifest, store);
    state.rigStore = store || null;
    reindex();
    initSprings();
  }

  function update(dtIn, targets, settings) {
    let dt = finite(dtIn, 0);
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    state.time += dt;
    const tune = springTune(settings?.smoothing);
    for (const spring of [yawS, pitchS, rollS, bounceS, heartScaleS]) {
      spring.k = tune.k;
      spring.c = tune.c;
    }
    state.eyeStyle = settings?.eyeStyle === 'B' ? 'B' : 'A';

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
    const wristUp = clamp(num(targets, 'wristUp'), 0, 1);
    const bounceAmt = clamp(settings?.sensitivity?.bounce ?? 1, 0, 1.8);
    const bounceOn = settings?.bounce !== false;
    if (dt > 0 && bounceOn) {
      const dJaw = Math.max(0, jaw - state.prevJaw);
      const dPitch = Math.abs(pitch - state.prevPitch);
      const dWrist = Math.max(0, wristUp - state.prevWrist);
      bounceS.v += clamp(dJaw * 0.85 + dPitch * 0.4 + dWrist * 0.55, 0, 0.25) * bounceAmt;
      bounceS.v += clamp(num(targets, 'exprBounce'), 0, 0.2);
    }
    let sustain = 0;
    if (bounceOn) {
      sustain = clamp(jaw, 0, 1) * 0.022 * bounceAmt;
      sustain += wristUp * 0.018 * bounceAmt;
      if (!face) sustain += Math.max(0, Math.sin(state.time * 3.1)) * 0.012 * bounceAmt;
    }
    bounceS.update(clamp(sustain, 0, 0.04), dt);
    const bounce = bounceOn ? clamp(bounceS.x, -0.03, 0.04) : 0;
    let bodySy = 1 + 0.012 * Math.sin(state.time * 2.2);
    bodySy *= 1 + bounce;
    bodySy = clamp(bodySy, 0.88, 1.04);
    bodySy *= 1 + 0.05 * wristUp;
    bodySy = clamp(bodySy, 0.88, 1.05);
    const bodySx = clamp(1 / Math.sqrt(Math.max(0.6, bodySy)), 0.9, 1.12);
    const shoulder = clamp(num(targets, 'shoulderTilt'), -0.2, 0.2);
    const exprLean = clamp(num(targets, 'exprLean'), -1.5, 1.5);
    const lean = clamp(0.35 * rollRad + shoulder + exprLean * 0.12, -0.22, 0.22);

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

    const partRot = {};
    const pose = { yaw, rollRad, lean };
    for (const part of state.manifest.parts) {
      const rig = part.rig;
      if (!rig || (part.role !== 'hair' && part.role !== 'ear')) continue;
      let spr = partSprings[part.id];
      if (!spr) {
        spr = new Spring1D(rig.stiffness, rig.damping);
        partSprings[part.id] = spr;
      }
      spr.k = rig.stiffness;
      spr.c = rig.damping;
      const delayed = sampleDelay(part.id, rig.phase, pose);
      let target = strandTarget(part, rig, delayed, state.time);
      if (part.role === 'ear') {
        const left = String(part.id).endsWith('_l');
        const lim = (rig.limit || 7) * (Math.PI / 180);
        target = clamp(target + wiggle * (left ? 1 : -0.85), -lim, lim);
      }
      partRot[part.id] = spr.update(target, dt);
    }

    const beat = bounceOn ? 0.5 * Math.max(0, bounce) : 0;
    const exprHeart = clamp(num(targets, 'exprHeart'), 0, 0.25);
    const heartTarget = clamp(1 + 0.06 * wristUp + 0.04 * smile + beat + exprHeart, 1, 1.18);
    heartScaleS.update(heartTarget, dt);

    const exprSmile = clamp(num(targets, 'exprSmile'), 0, 1);
    let choice = pickViseme(jaw, funnel, pucker, smile);
    if (exprSmile > 0.15 && jaw < 0.22 && (choice.id === 'neutral' || choice.id === 'small')) {
      choice = {
        id: 'smile',
        scores: { ...choice.scores, smile: Math.max(exprSmile, smile), neutral: 0, small: 0 },
      };
    }
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
    state.mouthFade = Math.min(1, state.mouthFade + dt / MOUTH_FADE);

    for (const side of ['eye_l', 'eye_r']) {
      const slot = state.eye[side];
      const blink = side === 'eye_l' ? blinkL : blinkR;
      const next = stepEyeOpen(slot.id, blink);
      if (next !== slot.id) {
        slot.prev = slot.id;
        slot.id = next;
        slot.fade = 0;
      }
      slot.fade = Math.min(1, slot.fade + dt / EYE_FADE);
    }

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
    view.wristUp = wristUp;
    view.bounce = bounce;
    view.mouthId = state.mouthId;
    view.mouthPrev = state.mouthPrev;
    view.mouthFade = state.mouthFade;
    view.partRot = partRot;
    view.bodySx = bodySx;
    view.bodySy = bodySy;
    view.lean = lean;
    view.heartScale = clamp(heartScaleS.x, 1, 1.18);
    sleeves.update(dt, targets?.sleeve || null);
    view.jumpY = finite(jumpY, 0);
    view.jumpSy = clamp(finite(jumpSy, 1), 0.75, 1.25);
    view.face = face;
    state.prevJaw = jaw;
    state.prevPitch = pitch;
    state.prevWrist = wristUp;
  }

  function blitEntry(img, entry, ox = 0, oy = 0) {
    if (!drawable(img) || !entry) return;
    const x = finite(entry.x, 0);
    const y = finite(entry.y, 0);
    const w = finite(entry.w, 0);
    const h = finite(entry.h, 0);
    if (!(w > 0 && h > 0)) return;
    ctx.drawImage(img, x + ox, y + oy, w, h);
  }

  function applyBody() {
    const { feet } = state.manifest.pivots;
    const view = state.view;
    ctx.translate(feet.x, feet.y);
    ctx.rotate(view.lean);
    ctx.scale(view.bodySx, view.bodySy);
    ctx.translate(-feet.x, -feet.y);
  }

  function applyHead() {
    const { neck } = state.manifest.pivots;
    const view = state.view;
    const sx = clamp(1 - 0.14 * Math.abs(view.yaw), 0.86, 1);
    const sy = clamp(1 - 0.06 * Math.abs(view.pitch), 0.94, 1);
    const skew = clamp(view.yaw * 0.06, -0.06, 0.06);
    const offX = clamp(view.yaw * 9, -9, 9);
    const offY = clamp(view.pitch * 9, -9, 9);
    ctx.translate(neck.x + offX, neck.y + offY);
    ctx.rotate(view.rollRad);
    ctx.transform(sx, skew, 0, sy, 0, 0);
    ctx.translate(-neck.x, -neck.y);
  }

  function applyLocal(part, extraX = 0, extraY = 0) {
    const view = state.view;
    const rig = part?.rig || {};
    const [px, py] = parallaxOf(part);
    const tx = px * view.yaw + extraX + (rig.dx || 0);
    const ty = py * view.pitch + extraY + (rig.dy || 0);
    const rot = (view.partRot[part?.id] || 0) + (rig.rot || 0) * (Math.PI / 180);
    const sc = rig.scale > 0 ? rig.scale : 1;
    const pivot = pivotOf(part);
    if (rot || tx || ty || sc !== 1) {
      ctx.translate(pivot.x + tx, pivot.y + ty);
      if (rot) ctx.rotate(rot);
      if (sc !== 1) ctx.scale(sc, sc);
      ctx.translate(-pivot.x, -pivot.y);
    }
  }

  function paintShadow(entry) {
    const img = state.soft[entry?.file];
    if (!drawable(img)) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    blitEntry(img, entry, 5, 7);
    ctx.restore();
  }

  function paintEdge(entry, ox, alpha) {
    const img = state.paper[entry?.file];
    if (!drawable(img) || alpha < 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    blitEntry(img, entry, ox, 0);
    ctx.restore();
  }

  function paintImage(entry) {
    blitEntry(sourceOf(entry?.file), entry);
  }

  function eyeGraphic(side, closed) {
    const { eye, style } = resolveStyle(state.manifest, side, state.eyeStyle);
    if (closed) return eye?.closed || null;
    if (style?.white) return style.white;
    return style?.full || null;
  }

  function paintEye(side) {
    const slot = state.eye[side];
    const view = state.view;
    const closed = slot.id === 'closed';
    const graphic = eyeGraphic(side, closed);
    const layered = !closed && Boolean(resolveStyle(state.manifest, side, state.eyeStyle).style?.white);
    if (graphic && !layered) {
      ctx.save();
      ctx.translate(view.gazeX * 3, view.gazeY * 2);
      if (state.useShadow) paintShadow(graphic);
      if (state.useEdge) paintEdge(graphic, state.edgeOx, state.edgeAlpha);
      ctx.restore();
    }
    eyePainter.paint(ctx, {
      manifest: state.manifest,
      side,
      styleId: state.eyeStyle,
      closed,
      prevClosed: slot.prev === 'closed',
      fade: slot.fade,
      gazeX: view.gazeX,
      gazeY: view.gazeY,
      getImage: (file) => sourceOf(file),
      paintImage,
    });
  }

  function paintMouth() {
    const view = state.view;
    const mouths = state.manifest.mouths;
    const cur = mouths[view.mouthId] || mouths.neutral;
    const prev = mouths[view.mouthPrev] || mouths.neutral;
    const fade = clamp(view.mouthFade, 0, 1);
    if (fade < 0.999 && prev && prev !== cur) {
      ctx.save();
      ctx.globalAlpha = 1 - fade;
      paintImage(prev);
      ctx.restore();
    }
    if (cur) {
      ctx.save();
      ctx.globalAlpha = fade < 0.999 && prev && prev !== cur ? fade : 1;
      paintImage(cur);
      ctx.restore();
    }
  }

  function paintHeart() {
    const heart = state.manifest.extras.heart;
    if (!heart) return;
    const view = state.view;
    const sc = clamp(view.heartScale, 1, 1.18);
    const pivot = pivotOf(heart);
    ctx.save();
    applyBody();
    ctx.translate(pivot.x, pivot.y);
    ctx.scale(sc, sc);
    ctx.translate(-pivot.x, -pivot.y);
    paintImage(heart);
    ctx.restore();
  }

  function wrapPart(part, draw) {
    ctx.save();
    applyBody();
    if (part.parent === 'head' || part.role === 'eye' || part.role === 'mouth') applyHead();
    draw();
    ctx.restore();
  }

  function drawGizmo(part) {
    if (state.highlight !== part.id) return;
    const box = part.role === 'eye' ? eyeGraphic(part.id, state.eye[part.id]?.id === 'closed') : part;
    const piv = pivotOf(part);
    ctx.save();
    ctx.strokeStyle = '#49c6d6';
    ctx.lineWidth = 1.7;
    if (box && box.w > 0 && box.h > 0) {
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(piv.x, piv.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(73, 198, 214, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#062028';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(piv.x - 12, piv.y);
    ctx.lineTo(piv.x + 12, piv.y);
    ctx.moveTo(piv.x, piv.y - 12);
    ctx.lineTo(piv.x, piv.y + 12);
    ctx.stroke();
    ctx.restore();
  }

  function onHead(part) {
    return part?.parent === 'head' || part?.role === 'eye' || part?.role === 'mouth';
  }

  function headScale() {
    const view = state.view;
    return {
      sx: clamp(1 - 0.14 * Math.abs(view.yaw), 0.86, 1),
      sy: clamp(1 - 0.06 * Math.abs(view.pitch), 0.94, 1),
      skew: clamp(view.yaw * 0.06, -0.06, 0.06),
      offX: clamp(view.yaw * 9, -9, 9),
      offY: clamp(view.pitch * 9, -9, 9),
    };
  }

  function invJump(p) {
    const feet = state.manifest.pivots.feet;
    const view = state.view;
    if (!(view.jumpY !== 0 || Math.abs(view.jumpSy - 1) > 0.001)) return p;
    const sy = view.jumpSy;
    const sx = 1 / Math.sqrt(Math.max(0.6, sy));
    return {
      x: feet.x + (p.x - feet.x) / sx,
      y: feet.y + (p.y - (feet.y + view.jumpY)) / sy,
    };
  }

  function invBody(p) {
    const feet = state.manifest.pivots.feet;
    const view = state.view;
    const co = Math.cos(view.lean);
    const si = Math.sin(view.lean);
    const dx = p.x - feet.x;
    const dy = p.y - feet.y;
    return {
      x: feet.x + (co * dx + si * dy) / (view.bodySx || 1),
      y: feet.y + (-si * dx + co * dy) / (view.bodySy || 1),
    };
  }

  function invHead(p) {
    const neck = state.manifest.pivots.neck;
    const view = state.view;
    const h = headScale();
    const co = Math.cos(view.rollRad);
    const si = Math.sin(view.rollRad);
    const dx = p.x - neck.x - h.offX;
    const dy = p.y - neck.y - h.offY;
    const rx = co * dx + si * dy;
    const ry = -si * dx + co * dy;
    const lx = rx / (h.sx || 1);
    return { x: lx + neck.x, y: (ry - h.skew * lx) / (h.sy || 1) + neck.y };
  }

  function parentFromCss(cssX, cssY, part) {
    const place = state.place || { scale: 1, ox: 0, oy: 0 };
    let p = invJump({ x: (cssX - place.ox) / place.scale, y: (cssY - place.oy) / place.scale });
    p = invBody(p);
    if (onHead(part)) p = invHead(p);
    return p;
  }

  function invLocal(p, part) {
    const rig = part?.rig || {};
    const piv = pivotOf(part);
    const [px, py] = parallaxOf(part);
    const tx = px * state.view.yaw + (rig.dx || 0);
    const ty = py * state.view.pitch + (rig.dy || 0);
    const rot = (state.view.partRot[part?.id] || 0) + (rig.rot || 0) * (Math.PI / 180);
    const sc = rig.scale > 0 ? rig.scale : 1;
    const co = Math.cos(rot);
    const si = Math.sin(rot);
    const dx = p.x - piv.x - tx;
    const dy = p.y - piv.y - ty;
    return { x: piv.x + (co * dx + si * dy) / sc, y: piv.y + (-si * dx + co * dy) / sc };
  }

  function alphaHit(entry, x, y) {
    if (!(entry?.w > 0 && entry?.h > 0)) return false;
    if (x < entry.x || y < entry.y || x > entry.x + entry.w || y > entry.y + entry.h) return false;
    const img = state.images[entry.file];
    if (!drawable(img)) return true;
    let data = state.alpha.get(entry.file);
    if (!data) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      data = g.getImageData(0, 0, c.width, c.height);
      state.alpha.set(entry.file, data);
    }
    const u = Math.min(data.width - 1, Math.max(0, Math.floor(((x - entry.x) / entry.w) * data.width)));
    const v = Math.min(data.height - 1, Math.max(0, Math.floor(((y - entry.y) / entry.h) * data.height)));
    return data.data[(v * data.width + u) * 4 + 3] > 20;
  }

  function hitTest(cssX, cssY) {
    const parts = state.manifest.parts;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (!part || part.role === 'mouth' || part.id === 'mouth') continue;
      if (part.rig && part.rig.visible === false) continue;
      const entry = part.role === 'eye' ? eyeGraphic(part.id, false) : part;
      if (!entry?.file) continue;
      const local = invLocal(parentFromCss(cssX, cssY, part), part);
      if (alphaHit(entry, local.x, local.y)) return part.id;
    }
    return null;
  }

  function drawCharacter(settings) {
    const view = state.view;
    const m = state.manifest;
    const chroma = isChroma(settings?.background);
    const useShadow = settings?.paperShadow !== false && !chroma;
    const useEdge = settings?.paperThickness !== false;
    const edgeAmt = clamp((Math.abs(view.yaw) - 0.05) / 0.25, 0, 1);
    const edgeOx = -Math.sign(view.yaw || 0) * (2 + clamp(Math.abs(view.yaw), 0, 1));
    const edgeAlpha = 0.9 * edgeAmt;
    state.useShadow = useShadow;
    state.useEdge = useEdge;
    state.edgeOx = edgeOx;
    state.edgeAlpha = edgeAlpha;
    const acc = settings?.accessories || {};
    const { feet, bounds } = { feet: m.pivots.feet, bounds: m.bounds };

    if (useShadow) {
      const lift = clamp(-view.jumpY / 50, 0, 1);
      const squash = view.jumpSy < 1 ? (1 - view.jumpSy) * 1.8 : 0;
      const span = Math.max(80, bounds.x1 - bounds.x0);
      const rx = span * 0.32 * (1 - 0.22 * lift) * (1 + squash);
      const ry = 16 * (1 - 0.4 * lift);
      ctx.save();
      ctx.fillStyle = `rgba(24, 16, 28, ${0.26 * (1 - 0.55 * lift)})`;
      ctx.beginPath();
      ctx.ellipse(feet.x + view.lean * 30, bounds.y1 + 8, rx, Math.max(6, ry), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (view.jumpY !== 0 || Math.abs(view.jumpSy - 1) > 0.001) {
      const sy = view.jumpSy;
      const sx = 1 / Math.sqrt(Math.max(0.6, sy));
      ctx.translate(feet.x, feet.y + view.jumpY);
      ctx.scale(sx, sy);
      ctx.translate(-feet.x, -feet.y);
    }

    const drawnEyes = { eye_l: false, eye_r: false };
    for (const part of m.parts) {
      const hidden = part.rig && part.rig.visible === false;
      if (hidden && state.highlight !== part.id) continue;
      if (part.role === 'mouth') {
        if (hidden) continue;
        wrapPart(part, () => {
          const center = m.mouthCenter;
          applyLocal({ ...part, id: 'mouth', role: 'mouth', pivot: [center.x, center.y] });
          const sy = clamp(0.85 + 0.35 * clamp(view.jaw, 0, 1.2), 0.7, 1.35);
          const sx = clamp(1 + 0.1 * clamp(view.smile, 0, 1.5), 0.85, 1.3);
          ctx.translate(center.x, center.y);
          ctx.scale(sx, sy);
          ctx.translate(-center.x, -center.y);
          const cur = m.mouths[view.mouthId] || m.mouths.neutral;
          if (useShadow && cur) paintShadow(cur);
          if (useEdge && cur) paintEdge(cur, edgeOx, edgeAlpha);
          paintMouth();
        });
        continue;
      }
      if (part.role === 'eye') {
        const side = part.id?.startsWith('eye_r') ? 'eye_r' : 'eye_l';
        if (drawnEyes[side]) continue;
        drawnEyes[side] = true;
        wrapPart(part, () => {
          applyLocal(part);
          if (!hidden) paintEye(side);
          drawGizmo(part);
        });
        continue;
      }
      if (!part.file && state.highlight !== part.id) continue;
      wrapPart(part, () => {
        applyLocal(part);
        if (!hidden && part.file) {
          if (useShadow) paintShadow(part);
          if (useEdge && part.parent === 'head') paintEdge(part, edgeOx, edgeAlpha);
          paintImage(part);
          if (part.id === 'ear_r' && acc.bow) drawBow(ctx, part);
        }
        drawGizmo(part);
      });
      if (part.id === 'body') paintHeart();
    }

    ctx.save();
    applyBody();
    applyHead();
    if (acc.glasses) {
      const left = resolveStyle(m, 'l', state.eyeStyle).style;
      const right = resolveStyle(m, 'r', state.eyeStyle).style;
      drawGlasses(ctx, m.pivots, left?.full || left?.white, right?.full || right?.white);
    }
    if (acc.flowerCrown) drawFlowerCrown(ctx, m.byId.bangs, m.pivots.headTop);
    if (acc.star) drawStarSticker(ctx, m.pivots.eye_r.x + 40, m.pivots.eye_r.y + 30, 14);
    if (acc.headphones && m.byId.human_ears) drawHeadphones(ctx, m.pivots, m.byId.human_ears);
    if (acc.blush) drawBlush(ctx, m.pivots);
    if (acc.sparkles) drawSparkles(ctx, state.time, m.pivots);
    ctx.restore();

    ctx.save();
    applyBody();
    sleeves.draw(ctx, {
      shadow: useShadow,
      edge: useEdge,
      filter: styleById(settings?.style).filter,
      time: state.time,
      getImage: (file) => sourceOf(file),
    });
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

    const { bounds } = state.manifest;
    const charW = bounds.x1 - bounds.x0;
    const charH = bounds.y1 - bounds.y0;
    const cx = (bounds.x0 + bounds.x1) / 2;
    const cy = (bounds.y0 + bounds.y1) / 2;
    let scale = (cssH * 0.88) / Math.max(1, charH);
    if (charW * scale > cssW * 0.94) scale = (cssW * 0.94) / Math.max(1, charW);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    const ox = cssW / 2 - cx * scale;
    const oy = cssH / 2 - cy * scale;
    state.place = { scale, ox, oy, dpr };
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawCharacter(settings || {});
  }

  const ready = (async () => {
    let json = null;
    try {
      const res = await fetch(assetUrl('rig.json'));
      if (res.ok) json = await res.json();
    } catch {
      json = null;
    }
    state.source = json;
    state.manifest = normalizeManifest(json);
    for (const part of state.manifest.parts) stampPart(part);
    state.base = captureBase(state.manifest);
    state.rigStore = loadOverrides();
    if (state.rigStore) applyRigData(state.manifest, state.rigStore);
    reindex();
    sleeves.bind(state.manifest);
    const files = collectFiles(state.manifest);
    const images = {};
    await Promise.all(files.map(async (file) => {
      images[file] = await loadImage(file);
    }));
    state.images = images;
    bakeCaches();
    initSprings();
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
    installOverrides,
    hitTest,
    parentPoint(cssX, cssY, partId) {
      const part = state.manifest.byId[partId];
      if (!part) return null;
      return parentFromCss(cssX, cssY, part);
    },
    resetPart(id) {
      const part = state.manifest.byId[id];
      const saved = state.base?.parts?.[id];
      if (!part || !saved) return;
      part.rig = { ...saved.rig };
      if (saved.pivot) part.pivot = [saved.pivot[0], saved.pivot[1]];
    },
    resetAll() {
      installOverrides(null);
    },
    setHighlight(id) {
      state.highlight = id || null;
    },
    getManifest() {
      return state.manifest;
    },
    getSource() {
      return state.source;
    },
    getStore() {
      return state.rigStore;
    },
  };
}
