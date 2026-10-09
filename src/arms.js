/** Mangas largas. La mano va dentro de la manga: nunca hay dedos, palma ni piel. */

import { Spring1D, clamp, hash01 } from './filters.js';

const UPPER = 46;
const FORE = 40;
const PPU = 4;
const TEAL = '#3bbeab';
const TEAL_LIT = '#6fd8c6';
const TEAL_DIM = '#2a9a8c';
const NAVY = '#05588c';
const NAVY_2 = '#0e5797';
const ORANGE = '#f0703c';
const CREAM = '#fff5dc';

function dir(phi) {
  return { x: Math.sin(phi), y: Math.cos(phi) };
}

function droop(angle) {
  let d = -angle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return angle + clamp(d, -2.2, 2.2) * 0.14;
}

function makeBoard(bounds) {
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * PPU));
  c.height = Math.max(1, Math.ceil(h * PPU));
  const g = c.getContext('2d');
  g.setTransform(PPU, 0, 0, PPU, -bounds.x0 * PPU, -bounds.y0 * PPU);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return { c, g, w, h, bounds };
}

function strokeInk(g, seed, boil) {
  for (let i = 0; i < 3; i += 1) {
    g.save();
    const ox = (hash01(seed + i * 4 + boil * 1.7) - 0.5) * 1.15;
    const oy = (hash01(seed + i * 9 + 2 + boil) - 0.5) * 1.15;
    g.translate(ox, oy);
    g.strokeStyle = i === 1 ? NAVY_2 : NAVY;
    g.globalAlpha = 0.85;
    g.lineWidth = 2.6;
    g.stroke();
    g.restore();
  }
  g.globalAlpha = 1;
}

function streaks(g, y0, y1, seed) {
  g.save();
  g.strokeStyle = TEAL_LIT;
  g.globalAlpha = 0.72;
  g.lineWidth = 2.4;
  for (let i = 0; i < 3; i += 1) {
    const x = -4 + i * 4 + (hash01(seed + i) - 0.5) * 2;
    g.beginPath();
    g.moveTo(x, y0 + 4);
    g.quadraticCurveTo(x + (hash01(seed + i + 3) - 0.5) * 6, (y0 + y1) / 2, x - 1, y1 - 4);
    g.stroke();
  }
  g.restore();
}

function hatch(g, y0, y1, x0, x1, seed) {
  g.save();
  g.strokeStyle = TEAL_DIM;
  g.globalAlpha = 0.55;
  g.lineWidth = 1.15;
  const span = y1 - y0;
  for (let i = 0; i < 7; i += 1) {
    const y = y0 + 6 + (i / 7) * (span - 10);
    const x = x0 + hash01(seed + i) * (x1 - x0) * 0.35;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 7 + hash01(seed + i + 4) * 4, y + 4);
    g.stroke();
  }
  g.restore();
}

function folds(g, y, seed) {
  g.save();
  g.strokeStyle = NAVY;
  g.globalAlpha = 0.7;
  g.lineWidth = 1.35;
  for (let i = 0; i < 3; i += 1) {
    const yy = y + i * 3.2;
    g.beginPath();
    g.moveTo(-7 + i, yy);
    g.quadraticCurveTo(0, yy + 2.4 + hash01(seed + i), 7 - i, yy - 0.6);
    g.stroke();
  }
  g.restore();
}

function pathUpper(g) {
  g.beginPath();
  g.moveTo(-9, -7);
  g.bezierCurveTo(-12.5, 8, -13.5, 26, -11.5, 46);
  g.quadraticCurveTo(0, 53, 11.5, 46);
  g.bezierCurveTo(13.5, 26, 12.5, 8, 9, -7);
  g.quadraticCurveTo(0, -12, -9, -7);
  g.closePath();
}

function pathFore(g) {
  g.beginPath();
  g.moveTo(-11, -12);
  g.bezierCurveTo(-14, 4, -15, 20, -13.5, 38);
  g.quadraticCurveTo(0, 47, 13.5, 38);
  g.bezierCurveTo(15, 20, 14, 4, 11, -12);
  g.quadraticCurveTo(0, -17, -11, -12);
  g.closePath();
}

function pathRound(g) {
  g.beginPath();
  g.moveTo(-12, -8);
  g.bezierCurveTo(-16, 2, -17, 12, -11, 20);
  g.quadraticCurveTo(0, 28, 11, 20);
  g.bezierCurveTo(17, 12, 16, 2, 12, -8);
  g.quadraticCurveTo(0, -13, -12, -8);
  g.closePath();
}

function pathV(g) {
  g.beginPath();
  g.moveTo(-13, -8);
  g.bezierCurveTo(-17, 2, -15, 12, -8, 23);
  g.quadraticCurveTo(-4, 15, 0, 8);
  g.quadraticCurveTo(4, 15, 8, 23);
  g.bezierCurveTo(15, 12, 17, 2, 13, -8);
  g.quadraticCurveTo(0, -14, -13, -8);
  g.closePath();
}

function pathPoint(g) {
  g.beginPath();
  g.moveTo(-12, -8);
  g.quadraticCurveTo(-9, 4, -2.2, 16);
  g.quadraticCurveTo(0, 26, 2.2, 16);
  g.quadraticCurveTo(9, 4, 12, -8);
  g.quadraticCurveTo(0, -13, -12, -8);
  g.closePath();
}

function pathFlat(g) {
  g.beginPath();
  g.moveTo(-15, -8);
  g.quadraticCurveTo(-17, 4, -15, 12);
  g.quadraticCurveTo(-8, 18, 0, 17);
  g.quadraticCurveTo(8, 18, 15, 12);
  g.quadraticCurveTo(17, 4, 15, -8);
  g.quadraticCurveTo(0, -14, -15, -8);
  g.closePath();
}

function pathHeart(g) {
  g.beginPath();
  g.moveTo(0, 10);
  g.bezierCurveTo(-34, 10, -42, -8, -26, -28);
  g.bezierCurveTo(-16, -42, -4, -30, 0, -16);
  g.bezierCurveTo(4, -30, 16, -42, 26, -28);
  g.bezierCurveTo(42, -8, 34, 10, 0, 10);
  g.closePath();
}

const PIECES = {
  upper: { bounds: { x0: -22, y0: -18, x1: 22, y1: 60 }, path: pathUpper, kind: 'tube' },
  fore: { bounds: { x0: -24, y0: -22, x1: 24, y1: 54 }, path: pathFore, kind: 'fore' },
  round: { bounds: { x0: -24, y0: -18, x1: 24, y1: 36 }, path: pathRound, kind: 'round' },
  v: { bounds: { x0: -24, y0: -18, x1: 24, y1: 32 }, path: pathV, kind: 'v' },
  point: { bounds: { x0: -22, y0: -18, x1: 22, y1: 34 }, path: pathPoint, kind: 'point' },
  flat: { bounds: { x0: -26, y0: -18, x1: 26, y1: 26 }, path: pathFlat, kind: 'flat' },
  heart: { bounds: { x0: -48, y0: -58, x1: 48, y1: 16 }, path: pathHeart, kind: 'heart' },
};

function detail(g, kind, seed) {
  g.save();
  if (kind === 'tube') {
    streaks(g, 0, 44, seed);
    hatch(g, 8, 42, -8, 6, seed);
    folds(g, 36, seed);
  } else if (kind === 'fore') {
    streaks(g, -4, 34, seed);
    hatch(g, 0, 30, -8, 6, seed + 2);
    folds(g, 2, seed + 1);
    folds(g, 28, seed + 5);
    g.save();
    g.fillStyle = TEAL_DIM;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.ellipse(0, 33, 12, 4.2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ORANGE;
    g.globalAlpha = 0.9;
    g.lineWidth = 1.7;
    g.beginPath();
    g.moveTo(-10, 33);
    g.quadraticCurveTo(0, 36, 10, 32.5);
    g.stroke();
    g.restore();
  } else if (kind === 'round') {
    streaks(g, -2, 16, seed);
    g.fillStyle = NAVY;
    g.globalAlpha = 0.28;
    g.beginPath();
    g.ellipse(0, 12, 7.5, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ORANGE;
    g.globalAlpha = 0.85;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-8, 6);
    g.quadraticCurveTo(0, 9, 8, 5);
    g.stroke();
  } else if (kind === 'v') {
    streaks(g, -2, 12, seed);
    g.fillStyle = NAVY;
    g.globalAlpha = 0.32;
    g.beginPath();
    g.moveTo(0, 7);
    g.quadraticCurveTo(-4, 14, -6, 19);
    g.quadraticCurveTo(0, 13, 6, 19);
    g.quadraticCurveTo(4, 14, 0, 7);
    g.fill();
    g.strokeStyle = ORANGE;
    g.globalAlpha = 0.8;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-6, 4);
    g.quadraticCurveTo(0, 7, 6, 4);
    g.stroke();
  } else if (kind === 'point') {
    streaks(g, -2, 14, seed);
    g.strokeStyle = TEAL_DIM;
    g.globalAlpha = 0.8;
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(0, 2);
    g.quadraticCurveTo(0.6, 12, 0, 20);
    g.stroke();
    g.strokeStyle = ORANGE;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.moveTo(-5, 2);
    g.quadraticCurveTo(0, 5, 5, 2);
    g.stroke();
  } else if (kind === 'flat') {
    streaks(g, -4, 12, seed);
    g.fillStyle = NAVY;
    g.globalAlpha = 0.22;
    g.beginPath();
    g.ellipse(0, 8, 8, 3.2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ORANGE;
    g.globalAlpha = 0.85;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-10, 4);
    g.quadraticCurveTo(0, 7, 10, 4);
    g.stroke();
  } else if (kind === 'heart') {
    streaks(g, -40, -4, seed);
    g.strokeStyle = NAVY;
    g.globalAlpha = 0.55;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -18);
    g.quadraticCurveTo(-2, -8, 0, 2);
    g.stroke();
    g.strokeStyle = ORANGE;
    g.globalAlpha = 0.8;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-8, -2);
    g.quadraticCurveTo(0, 4, 8, -2);
    g.stroke();
    g.fillStyle = NAVY;
    g.globalAlpha = 0.18;
    g.beginPath();
    g.ellipse(-16, -28, 6, 4, -0.5, 0, Math.PI * 2);
    g.ellipse(16, -28, 6, 4, 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function bakeOne(name, def, boil, pattern) {
  const boards = {
    paper: makeBoard(def.bounds),
    sil: makeBoard(def.bounds),
    art: makeBoard(def.bounds),
  };
  const { path } = def;
  boards.paper.g.save();
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    boards.paper.g.save();
    boards.paper.g.translate(Math.cos(a) * 3, Math.sin(a) * 3);
    path(boards.paper.g);
    boards.paper.g.fillStyle = CREAM;
    boards.paper.g.fill();
    boards.paper.g.restore();
  }
  boards.paper.g.restore();

  path(boards.sil.g);
  boards.sil.g.fillStyle = '#000';
  boards.sil.g.fill();

  const g = boards.art.g;
  path(g);
  g.fillStyle = TEAL;
  g.fill();
  g.save();
  path(g);
  g.clip();
  detail(g, def.kind, name.length * 3 + 1);
  if (pattern) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.18;
    g.fillStyle = pattern;
    g.fillRect(def.bounds.x0 - 2, def.bounds.y0 - 2, def.w || 80, def.h || 80);
    const bw = def.bounds.x1 - def.bounds.x0;
    const bh = def.bounds.y1 - def.bounds.y0;
    g.fillRect(def.bounds.x0, def.bounds.y0, bw, bh);
  }
  g.restore();
  path(g);
  strokeInk(g, name.length * 13 + 4, boil);
  return {
    art: boards.art.c,
    sil: boards.sil.c,
    paper: boards.paper.c,
    bounds: def.bounds,
    w: def.bounds.x1 - def.bounds.x0,
    h: def.bounds.y1 - def.bounds.y0,
  };
}

function applyFilter(src, filter) {
  if (!filter || filter === 'none') return src;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  try {
    g.filter = filter;
    g.drawImage(src, 0, 0);
    g.filter = 'none';
  } catch {
    g.filter = 'none';
    g.drawImage(src, 0, 0);
  }
  return c;
}

function makeGrain() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let i = 0; i < 64 * 64; i += 1) {
    const n = hash01(i * 1.7 + 0.3);
    const v = 80 + Math.floor(n * 150);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function restAngle(part) {
  const px = +part.pivot[0];
  const py = +part.pivot[1];
  const w = +part.w;
  const h = +part.h;
  const x = +part.x;
  const y = +part.y;
  const pts = [
    [x + w / 2, y],
    [x + w / 2, y + h],
    [x, y + h / 2],
    [x + w, y + h / 2],
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  let best = -1;
  let far = pts[0];
  for (const c of pts) {
    const d = (c[0] - px) ** 2 + (c[1] - py) ** 2;
    if (d > best) {
      best = d;
      far = c;
    }
  }
  return Math.atan2(far[0] - px, far[1] - py);
}

function drawPap(ctx, x, y, seed) {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 7; i += 1) {
    const a = -Math.PI / 2 + (i - 3) * 0.42 + (hash01(seed + i) - 0.5) * 0.12;
    const len = 7 + hash01(seed + i + 2) * 9;
    const x2 = Math.cos(a) * len;
    const y2 = Math.sin(a) * len;
    for (let k = 0; k < 2; k += 1) {
      ctx.beginPath();
      ctx.strokeStyle = k === 0 ? CREAM : NAVY;
      ctx.globalAlpha = k === 0 ? 0.9 : 0.75;
      ctx.lineWidth = k === 0 ? 2.4 : 1.5;
      const jx = (hash01(seed + i + k * 5) - 0.5) * 1.2;
      ctx.moveTo(jx, 0);
      ctx.lineTo(x2 + jx, y2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSpark(ctx, x, y, time) {
  const tw = 0.6 + 0.4 * Math.sin(time * 7);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(time * 1.6) * 0.3);
  ctx.globalAlpha *= tw;
  ctx.beginPath();
  const r = 7;
  for (let i = 0; i < 8; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.4;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = NAVY_2;
  ctx.stroke();
  ctx.globalAlpha *= 0.9;
  ctx.fillStyle = '#ffe566';
  ctx.beginPath();
  ctx.arc(-10, -6, 1.6, 0, Math.PI * 2);
  ctx.arc(9, 4, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawJoint(ctx, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = CREAM;
  ctx.arc(0, 0, radius + 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = TEAL;
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = NAVY;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.restore();
}

export function createSleeves() {
  const springs = {
    l: { sh: new Spring1D(220, 18), el: new Spring1D(220, 18), tip: new Spring1D(150, 11) },
    r: { sh: new Spring1D(220, 18), el: new Spring1D(220, 18), tip: new Spring1D(150, 11) },
  };
  springs.l.sh.reset(-0.28);
  springs.l.el.reset(-0.1);
  springs.l.tip.reset(0.2);
  springs.r.sh.reset(0.28);
  springs.r.el.reset(0.1);
  springs.r.tip.reset(-0.1);

  let man = null;
  let shoulders = {
    l: { x: 251.67, y: 383.67 },
    r: { x: 338.33, y: 383.67 },
  };
  let pose = null;
  let grain = null;
  let pattern = null;
  let cacheBoil = -1;
  let cache = null;
  let filtered = new Map();
  let imgBakes = new Map();

  function bind(manifest) {
    man = manifest;
    const sh = manifest?.arms?.shoulders;
    if (sh?.l) shoulders = { l: sh.l, r: sh.r || shoulders.r };
    if (sh?.r) shoulders.r = sh.r;
    cacheBoil = -1;
    cache = null;
    filtered = new Map();
    imgBakes = new Map();
  }

  function ensure(boil) {
    if (!grain) {
      grain = makeGrain();
      pattern = null;
    }
    if (cache && cacheBoil === boil) return;
    const probe = makeBoard({ x0: 0, y0: 0, x1: 4, y1: 4 });
    if (!pattern) pattern = probe.g.createPattern(grain, 'repeat');
    cache = {};
    for (const [name, def] of Object.entries(PIECES)) {
      cache[name] = bakeOne(name, def, boil, pattern);
    }
    cacheBoil = boil;
    filtered = new Map();
  }

  function artOf(name, filter) {
    const piece = cache[name];
    if (!piece) return null;
    if (!filter || filter === 'none') return piece.art;
    const key = `${name}|${filter}|${cacheBoil}`;
    if (!filtered.has(key)) filtered.set(key, applyFilter(piece.art, filter));
    return filtered.get(key);
  }

  function update(dt, sleeve) {
    pose = sleeve || null;
    if (!sleeve?.visible) return;
    const loop = sleeve.loop ?? 1;
    for (const side of ['l', 'r']) {
      const spec = sleeve[side];
      if (!spec) continue;
      const s = springs[side];
      s.sh.k = 220;
      s.sh.c = 18;
      s.el.k = 220;
      s.el.c = 18;
      s.tip.k = 150;
      s.tip.c = 11;
      const shownEl = spec.baseEl + (spec.oscEl || 0) * (sleeve.snap ? 1 : loop);
      if (sleeve.snap) {
        s.sh.reset(spec.baseSh);
        s.el.reset(spec.baseEl);
        s.tip.reset(droop(shownEl) - (spec.oscEl || 0) * 0.45);
      } else {
        s.sh.update(spec.baseSh, dt);
        s.el.update(spec.baseEl, dt);
        const live = s.el.x + (spec.oscEl || 0) * loop;
        s.tip.update(droop(live), dt);
      }
    }
  }

  function angles(side) {
    const spec = pose?.[side];
    if (!spec) return null;
    const s = springs[side];
    const loop = pose.snap ? 1 : (pose.loop ?? 1);
    return {
      sh: s.sh.x + (spec.oscSh || 0) * loop,
      el: s.el.x + (spec.oscEl || 0) * loop,
      tip: s.tip.x,
      shape: spec.tip || 'round',
    };
  }

  function pieceName(parts, kind, side, shape) {
    if (!parts) return null;
    if (kind === 'sleeve') {
      return parts[`sleeve_${side}_${shape}`] || parts[`sleeve_${side}_${pose?.pose}`] || parts[`sleeve_${side}`] || null;
    }
    return parts[`${kind}_${side}`] || null;
  }

  function bakeCustom(file, img, part) {
    let rec = imgBakes.get(file);
    if (rec && rec.img === img) return rec;
    const pw = Math.max(1, img.naturalWidth || img.width);
    const ph = Math.max(1, img.naturalHeight || img.height);
    const ppu = pw / Math.max(0.001, part.w || 1);
    const padU = 3;
    const pad = Math.max(1, Math.ceil(padU * ppu));
    const paper = document.createElement('canvas');
    paper.width = pw + pad * 2;
    paper.height = ph + pad * 2;
    const g = paper.getContext('2d');
    const rad = padU * ppu;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      g.drawImage(img, pad + Math.cos(a) * rad, pad + Math.sin(a) * rad);
    }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = CREAM;
    g.fillRect(0, 0, paper.width, paper.height);
    const sil = document.createElement('canvas');
    sil.width = pw;
    sil.height = ph;
    const sg = sil.getContext('2d');
    sg.drawImage(img, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = '#000';
    sg.fillRect(0, 0, pw, ph);
    rec = { img, paper, sil };
    imgBakes.set(file, rec);
    return rec;
  }

  function drawCustom(ctx, img, part, joint, angle, env) {
    if (!img || !part) return;
    const pivot = Array.isArray(part.pivot) ? { x: +part.pivot[0], y: +part.pivot[1] } : joint;
    const rest = restAngle(part);
    const baked = bakeCustom(part.file || 'arm', img, part);
    ctx.save();
    ctx.translate(joint.x, joint.y);
    ctx.rotate(-(angle - rest));
    ctx.translate(-pivot.x, -pivot.y);
    if (env.shadow && baked.sil) {
      ctx.save();
      ctx.globalAlpha *= 0.22;
      ctx.drawImage(baked.sil, part.x + 5, part.y + 7, part.w, part.h);
      ctx.restore();
    }
    if (env.edge && baked.paper) {
      ctx.drawImage(baked.paper, part.x - 3, part.y - 3, part.w + 6, part.h + 6);
    }
    ctx.drawImage(img, part.x, part.y, part.w, part.h);
    ctx.restore();
  }

  function blit(ctx, name, angle, env) {
    const piece = cache?.[name];
    if (!piece) return;
    const art = artOf(name, env.filter);
    ctx.save();
    ctx.rotate(-angle);
    if (env.mirror) ctx.scale(-1, 1);
    if (env.shadow) {
      ctx.save();
      ctx.globalAlpha *= 0.22;
      ctx.drawImage(piece.sil, piece.bounds.x0 + 5, piece.bounds.y0 + 7, piece.w, piece.h);
      ctx.restore();
    }
    if (env.edge) ctx.drawImage(piece.paper, piece.bounds.x0, piece.bounds.y0, piece.w, piece.h);
    if (art) ctx.drawImage(art, piece.bounds.x0, piece.bounds.y0, piece.w, piece.h);
    ctx.restore();
  }

  function draw(ctx, env) {
    if (!pose?.visible || !ctx) return;
    const boil = Math.floor((env.time || 0) * 4);
    ensure(boil);
    const parts = man?.arms?.parts || {};
    const bothHeart = pose.pose === 'heart' ? parts.sleeve_both_heart : null;
    const getImage = env.getImage || (() => null);
    ctx.save();
    ctx.globalAlpha *= clamp(pose.alpha ?? 1, 0, 1);
    const wrists = {};
    const drawEnv = {
      shadow: Boolean(env.shadow),
      edge: env.edge !== false,
      filter: env.filter || 'none',
    };
    for (const side of ['l', 'r']) {
      const ang = angles(side);
      if (!ang) continue;
      const shoulder = shoulders[side];
      const shDir = dir(ang.sh);
      const elDir = dir(ang.el);
      const elbow = { x: shoulder.x + shDir.x * UPPER, y: shoulder.y + shDir.y * UPPER };
      const wrist = { x: elbow.x + elDir.x * FORE, y: elbow.y + elDir.y * FORE };
      wrists[side] = wrist;
      ctx.save();
      ctx.translate(shoulder.x, shoulder.y);
      ctx.scale(pose.scaleX || 1, 1);
      ctx.translate(-shoulder.x, -shoulder.y);

      const upperPart = parts[`upper_${side}`];
      const forePart = parts[`fore_${side}`];
      const upperImg = upperPart ? getImage(upperPart.file) : null;
      const foreImg = forePart ? getImage(forePart.file) : null;
      if (upperImg && upperImg.width) drawCustom(ctx, upperImg, upperPart, shoulder, ang.sh, drawEnv);
      else {
        ctx.save();
        ctx.translate(shoulder.x, shoulder.y);
        drawJoint(ctx, 8);
        blit(ctx, 'upper', ang.sh, { ...drawEnv, mirror: side === 'r' });
        ctx.restore();
      }
      if (!(foreImg && foreImg.width)) {
        ctx.save();
        ctx.translate(elbow.x, elbow.y);
        if (env.shadow) {
          ctx.save();
          ctx.globalAlpha *= 0.22;
          ctx.translate(5, 7);
          drawJoint(ctx, 11);
          ctx.restore();
        }
        drawJoint(ctx, 11);
        blit(ctx, 'fore', ang.el, { ...drawEnv, mirror: side === 'r' });
        ctx.restore();
      } else {
        drawCustom(ctx, foreImg, forePart, elbow, ang.el, drawEnv);
      }

      const skipTip = pose.pose === 'heart' && (bothHeart || (!parts[`sleeve_${side}_heart`] && !parts[`sleeve_${side}`]));
      if (!skipTip) {
        const tipPart = pieceName(parts, 'sleeve', side, ang.shape);
        const tipImg = tipPart ? getImage(tipPart.file) : null;
        if (tipImg && tipImg.width) drawCustom(ctx, tipImg, tipPart, wrist, ang.tip, drawEnv);
        else if (ang.shape !== 'heart') {
          ctx.save();
          ctx.translate(wrist.x, wrist.y);
          blit(ctx, ang.shape, ang.tip, { ...drawEnv, mirror: side === 'r' });
          ctx.restore();
        }
      }
      ctx.restore();
    }

    if (pose.pose === 'heart' && wrists.l && wrists.r) {
      const mid = { x: (wrists.l.x + wrists.r.x) / 2, y: (wrists.l.y + wrists.r.y) / 2 };
      if (bothHeart) {
        const img = getImage(bothHeart.file);
        if (img && img.width) {
          const avg = ((angles('l')?.el || 0) + (angles('r')?.el || 0)) / 2;
          drawCustom(ctx, img, bothHeart, mid, avg, drawEnv);
        }
      } else if (!parts.sleeve_l_heart && !parts.sleeve_r_heart) {
        const sc = pose.tipScale || 1;
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.translate(0, -18);
        ctx.scale(sc * 1.45, sc * 1.45);
        ctx.translate(0, 18);
        blit(ctx, 'heart', 0, drawEnv);
        ctx.restore();
      }
    }

    if (pose.sparkle && wrists.r) {
      const ang = angles('r');
      const d = dir(ang?.tip ?? ang?.el ?? -1);
      drawSpark(ctx, wrists.r.x + d.x * 20 + 8, wrists.r.y + d.y * 20 - 6, env.time || 0);
    }
    if ((pose.clapClose || 0) > 0.82 && wrists.l && wrists.r) {
      drawPap(ctx, (wrists.l.x + wrists.r.x) / 2, (wrists.l.y + wrists.r.y) / 2, boil + 3);
    }
    ctx.restore();
  }

  return { bind, update, draw };
}
