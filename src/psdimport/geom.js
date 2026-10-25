/** Heurísticos, pivotes y paso a espacio de rig 600×600. Sin canvas. */

import { nameGroup, roleValue } from './names.js';

const ALPHA = 8;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function contentY(pixels, width, height) {
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (pixels[row + x * 4 + 3] <= ALPHA) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      break;
    }
  }
  return { minY, maxY };
}

/** Centro de las filas más bajas (frac del alto con alfa). Coordenadas del PSD. */
export function bandCenter(layer, frac, fromBottom) {
  const { pixels, width, height, left, top } = layer;
  const span = contentY(pixels, width, height);
  if (span.maxY < 0) return { x: layer.cx, y: layer.cy };
  const rows = Math.max(1, (span.maxY - span.minY + 1) * frac);
  const y0 = fromBottom ? span.maxY - rows : span.minY;
  const y1 = fromBottom ? span.maxY : span.minY + rows;
  const hist = new Uint32Array(width);
  let sy = 0;
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(height - 1, Math.ceil(y1)); y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (pixels[row + x * 4 + 3] <= ALPHA) continue;
      hist[x] += 1;
      sy += y;
      n += 1;
    }
  }
  if (!n) return { x: layer.cx, y: layer.cy };
  let seen = 0;
  let mx = 0;
  const half = n / 2;
  for (let x = 0; x < width; x += 1) {
    seen += hist[x];
    if (seen >= half) { mx = x; break; }
  }
  return { x: left + mx, y: top + sy / n };
}

export function nearestPoint(layer, tx, ty) {
  const { pixels, width, height, left, top } = layer;
  const step = width * height > 280000 ? 2 : 1;
  let best = Infinity;
  let bx = tx;
  let by = ty;
  for (let y = 0; y < height; y += step) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += step) {
      if (pixels[row + x * 4 + 3] <= ALPHA) continue;
      const px = left + x;
      const py = top + y;
      const d = (px - tx) ** 2 + (py - ty) ** 2;
      if (d < best) {
        best = d;
        bx = px;
        by = py;
      }
    }
  }
  return { x: bx, y: by };
}

/** Centro de lo que la capa tapa de las capas de cuerpo (raíz de la cola). */
function overlapCentroid(layer, bodies) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const step = layer.width * layer.height > 280000 ? 2 : 1;
  for (const body of bodies) {
    if (body === layer) continue;
    const x0 = Math.max(layer.left, body.left);
    const y0 = Math.max(layer.top, body.top);
    const x1 = Math.min(layer.left + layer.width, body.left + body.width);
    const y1 = Math.min(layer.top + layer.height, body.top + body.height);
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const a = layer.pixels[((y - layer.top) * layer.width + (x - layer.left)) * 4 + 3];
        if (a <= ALPHA) continue;
        const b = body.pixels[((y - body.top) * body.width + (x - body.left)) * 4 + 3];
        if (b <= ALPHA) continue;
        sx += x;
        sy += y;
        n += 1;
      }
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/** Dos ojos que cayeron del mismo lado sin que el nombre lo diga: se reparten por posición. */
function spreadEyes(layers) {
  for (const style of ['A', 'B']) {
    for (const side of ['l', 'r']) {
      const same = layers.filter((layer) => layer.role === `eye_${side}_${style}`);
      if (same.length < 2) continue;
      const other = side === 'l' ? 'r' : 'l';
      if (layers.some((layer) => layer.role === `eye_${other}_${style}`)) continue;
      const free = same.filter((layer) => !layer.cls?.side);
      if (!free.length) continue;
      const sorted = same.slice().sort((a, b) => a.cx - b.cx);
      const left = sorted[0];
      const right = sorted[sorted.length - 1];
      if (side === 'l' && free.includes(right)) { right.role = `eye_r_${style}`; right.side = 'r'; }
      if (side === 'r' && free.includes(left)) { left.role = `eye_l_${style}`; left.side = 'l'; }
    }
  }
}

/** Capa chica encima de un ojo (p. ej. el aro blanco 'cabeza - copia'): pieza de ese ojo. */
function findRings(layers) {
  const eyes = layers.filter((layer) => /^eye_[lr]_[AB]$/.test(layer.role));
  if (!eyes.length) return;
  const free = new Set(['static', 'face', 'unknown', 'hair', 'acc_head']);
  for (const layer of layers) {
    if (!free.has(layer.role) || layer.hidden) continue;
    const area = layer.width * layer.height;
    for (const eye of eyes) {
      const ew = eye.width;
      const eh = eye.height;
      if (area > ew * eh * 2.5) continue;
      const inside = layer.cx > eye.left - ew * 0.25 && layer.cx < eye.left + ew * 1.25
        && layer.cy > eye.top - eh * 0.25 && layer.cy < eye.top + eh * 1.25;
      if (!inside) continue;
      const side = eye.role[4];
      layer.role = `ring_${side}`;
      layer.side = side;
      break;
    }
  }
}

function sideOf(cx, mid) {
  return cx < mid ? 'l' : 'r';
}

function boxOf(layer) {
  return { x0: layer.left, y0: layer.top, x1: layer.left + layer.width, y1: layer.top + layer.height };
}

function unionOf(layers) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const layer of layers) {
    x0 = Math.min(x0, layer.left);
    y0 = Math.min(y0, layer.top);
    x1 = Math.max(x1, layer.left + layer.width);
    y1 = Math.max(y1, layer.top + layer.height);
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function applyHeuristics(layers, charBox, face) {
  const unknown = layers.filter((layer) => layer.role === 'unknown');
  const faceIndex = face ? face.index : 1e9;
  const faceBox = face ? boxOf(face) : null;
  const pending = [];
  for (const layer of unknown) {
    const b = boxOf(layer);
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const cy = (b.y0 + b.y1) / 2;
    const relY = (cy - charBox.y0) / charBox.h;
    const relTop = (b.y0 - charBox.y0) / charBox.h;
    const tall = bh > bw * 1.35 && bh > charBox.h * 0.16;
    const aboveFace = !faceBox || b.y1 < faceBox.y0 + (faceBox.y1 - faceBox.y0) * 0.45;
    if (relTop < 0.3 && tall && aboveFace) {
      layer.role = layer.side === 'l' ? 'ear_l' : 'ear_r';
      continue;
    }
    const small = bw < charBox.w * 0.28 && bh < charBox.h * 0.18 && bw * bh < charBox.w * charBox.h * 0.06;
    const mid = relY > 0.28 && relY < 0.62;
    if (small && mid) {
      pending.push(layer);
      continue;
    }
    const large = bw > charBox.w * 0.32 && bh > charBox.h * 0.22;
    if (relY > 0.55 && large) {
      layer.role = 'body';
      continue;
    }
    const wide = bw > charBox.w * 0.45 && bh > charBox.h * 0.18;
    if (wide && layer.index < faceIndex) {
      layer.role = 'hair_back';
      continue;
    }
    if (relY < 0.55) layer.role = 'hair';
    else layer.role = 'static';
  }
  pairEyes(pending, charBox, layers);
  const eyes = layers.filter((layer) => layer.role.startsWith('eye_'));
  const eyeY = eyes.length ? eyes.reduce((s, layer) => s + layer.cy, 0) / eyes.length : charBox.y0 + charBox.h * 0.45;
  for (const layer of pending) {
    if (layer.role !== 'unknown') continue;
    const b = boxOf(layer);
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const small = bw < charBox.w * 0.28 && bh < charBox.h * 0.16;
    const near = Math.abs(layer.cx - charBox.cx) < charBox.w * 0.16;
    if (small && near && layer.cy > eyeY && layer.cy < charBox.y0 + charBox.h * 0.78) {
      layer.role = 'mouth_neutral';
    } else if ((layer.cy - charBox.y0) / charBox.h < 0.55) layer.role = 'hair';
    else layer.role = 'static';
  }
}

function pairEyes(pending, charBox, layers) {
  const named = layers.some((layer) => layer.role.startsWith('eye_'));
  if (named || pending.length < 2) {
    for (const layer of pending) layer.role = 'unknown';
    return;
  }
  const used = new Set();
  const pairs = [];
  for (let i = 0; i < pending.length; i += 1) {
    for (let j = i + 1; j < pending.length; j += 1) {
      const a = pending[i];
      const b = pending[j];
      const aw = a.width;
      const ah = a.height;
      const bw = b.width;
      const bh = b.height;
      if (Math.max(aw, bw) / Math.max(1, Math.min(aw, bw)) > 1.7) continue;
      if (Math.max(ah, bh) / Math.max(1, Math.min(ah, bh)) > 1.7) continue;
      if (Math.abs(a.cy - b.cy) > charBox.h * 0.08) continue;
      if (Math.abs((a.cx + b.cx) / 2 - charBox.cx) > charBox.w * 0.12) continue;
      if ((a.cx - charBox.cx) * (b.cx - charBox.cx) >= 0) continue;
      pairs.push([a, b]);
    }
  }
  for (const [a, b] of pairs) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    const left = a.cx < b.cx ? a : b;
    const right = left === a ? b : a;
    left.role = 'eye_l_A';
    right.role = 'eye_r_A';
    left.side = 'l';
    right.side = 'r';
  }
}

function placeRig(layers, charBox) {
  const k = charBox.h / 546;
  const offX = charBox.cx - 300 * k;
  const offY = charBox.y0 - 25 * k;
  const toX = (px) => (px - offX) / k;
  const toY = (py) => (py - offY) / k;
  for (const layer of layers) {
    layer.x = toX(layer.left);
    layer.y = toY(layer.top);
    layer.w = layer.width / k;
    layer.h = layer.height / k;
    layer.rigPivot = [toX(layer.pivotPsd.x), toY(layer.pivotPsd.y)];
  }
  return {
    scale: k,
    offset: [offX, offY],
    pxPerUnit: Math.min(2.5, k),
    toX,
    toY,
  };
}

function assignPivots(layers, face) {
  const faceBox = face ? boxOf(face) : null;
  const head = faceBox
    ? { x: (faceBox.x0 + faceBox.x1) / 2, y: (faceBox.y0 + faceBox.y1) / 2 }
    : null;
  const neck = face ? bandCenter(face, 0.08, true) : { x: 0, y: 0 };
  for (const layer of layers) {
    const role = layer.role;
    if (role === 'ear_l' || role === 'ear_r') {
      // base de la oreja: donde se apoya en la cabeza (sirve para orejas paradas y caídas de costado)
      const heads = layers.filter((item) => item !== layer && !item.hidden
        && (item === face || item.role === 'face' || nameGroup(item.name) === 'head'));
      layer.pivotPsd = overlapCentroid(layer, heads) || bandCenter(layer, 0.1, true);
    }
    else if (role === 'leg') layer.pivotPsd = bandCenter(layer, 0.15, false);
    else if (role === 'tail') {
      const bodies = layers.filter((item) => item !== layer && !item.hidden
        && (item.role === 'body' || nameGroup(item.name) === 'body'));
      const root = overlapCentroid(layer, bodies);
      const bodyBox = unionOf(bodies);
      layer.pivotPsd = root || (bodyBox ? nearestPoint(layer, bodyBox.cx, bodyBox.cy) : { x: layer.cx, y: layer.cy });
    }
    else if (role === 'hair') layer.pivotPsd = head ? nearestPoint(layer, head.x, head.y) : { x: layer.cx, y: layer.top };
    else if (role === 'hair_back') {
      layer.pivotPsd = faceBox ? { x: (faceBox.x0 + faceBox.x1) / 2, y: faceBox.y0 } : { x: layer.cx, y: layer.top };
    } else if (role === 'body') layer.pivotPsd = { x: (layer.left + layer.left + layer.width) / 2, y: layer.top + layer.height };
    else if (role === 'face' || role === 'bangs' || role === 'human_ears' || role.startsWith('mouth')
      || role.startsWith('eye_') || role.startsWith('white_') || role.startsWith('iris_')
      || role.startsWith('pupil_') || role.startsWith('highlight_') || role.startsWith('lash_')
      || role.startsWith('closed_') || role.startsWith('ring_') || role === 'acc_head') {
      layer.pivotPsd = neck;
    } else layer.pivotPsd = { x: layer.cx, y: layer.cy };
  }
  return { neck, head, faceBox };
}

/** Rellena role, side, x/y/w/h y pivote de cada capa. */
export function mapLayers(layers, psdWidth) {
  const mid = (psdWidth || 1) / 2;
  const visible = layers.filter((layer) => !layer.hidden);
  const charBox = unionOf(visible.length ? visible : layers);
  if (!charBox) return null;
  for (const layer of layers) {
    // el nombre manda ('ojo der' / 'ojo izq'); la posición solo si el nombre no dice el lado
    layer.side = layer.cls?.side || sideOf(layer.cx, mid);
    if (layer.cls?.role === 'sleeve' && layer.pose === 'heart' && Math.abs(layer.cx - mid) < (psdWidth || 1) * 0.08) {
      layer.side = 'both';
    }
    const value = roleValue(layer.cls, layer.side);
    layer.role = value === 'unknown' ? 'unknown' : value;
  }
  const faces = layers.filter((layer) => layer.role === 'face' && !layer.hidden);
  const face = faces.sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
  if (faces.length > 1) {
    for (const extra of faces) if (extra !== face) extra.role = 'static';
  }
  applyHeuristics(layers, charBox, face);
  spreadEyes(layers);
  findRings(layers);
  for (const layer of layers) {
    if (layer.role === 'ear_l' || layer.role === 'ear_r') layer.side = layer.role.endsWith('_l') ? 'l' : 'r';
    else if (!layer.side) layer.side = sideOf(layer.cx, mid);
  }
  const bodies = layers.filter((layer) => layer.role === 'body');
  if (bodies.length > 1) {
    const main = bodies.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    for (const extra of bodies) if (extra !== main) extra.role = 'static';
  }
  const backs = layers.filter((layer) => layer.role === 'hair_back');
  if (backs.length > 1) {
    const main = backs.sort((a, b) => a.index - b.index)[0];
    for (const extra of backs) if (extra !== main) extra.role = 'hair';
  }
  const pivots = assignPivots(layers, face);
  const placed = placeRig(layers, charBox);
  for (const layer of layers) {
    layer.x = round2(layer.x);
    layer.y = round2(layer.y);
    layer.w = round2(layer.w);
    layer.h = round2(layer.h);
    layer.pivot = [round2(layer.rigPivot[0]), round2(layer.rigPivot[1])];
  }
  return {
    charBox,
    face,
    neck: pivots.neck,
    head: pivots.head,
    ...placed,
  };
}

/** Recalcula pivotes tras un cambio de rol, sin tocar la posición. */
export function refreshPivots(layers, meta) {
  const face = layers.find((layer) => layer.role === 'face' && !layer.hidden)
    || layers.find((layer) => layer.role === 'face')
    || null;
  assignPivots(layers, face);
  const scale = meta?.scale || 1;
  const off = meta?.offset || [0, 0];
  for (const layer of layers) {
    if (!layer.pivotPsd) continue;
    layer.pivot = [
      round2((layer.pivotPsd.x - off[0]) / scale),
      round2((layer.pivotPsd.y - off[1]) / scale),
    ];
  }
}
