/** Ensambla un manifiesto con el mismo esquema que rig.json, imágenes en memoria. */

import { nearestPoint } from './geom.js';
import { medianSkin } from './mouthfind.js';
import { nameGroup, pairInfo } from './names.js';
import { paintPixels } from './raster.js';
import { lumOf, pickClosedLine } from '../eyeline.js';

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

function stamp(id, canvas, x, y, w, h, extra) {
  return {
    file: `mem/${id}.png`,
    image: canvas,
    x: r2(x),
    y: r2(y),
    w: r2(w),
    h: r2(h),
    px: [canvas.width, canvas.height],
    ...extra,
  };
}

function eyeInfo(role) {
  const m = /^(eye|white|iris|pupil|highlight|lash|closed)_([lr])(?:_([AB]))?$/.exec(role || '');
  if (!m) return null;
  return { part: m[1] === 'eye' ? 'full' : m[1], side: m[2], style: m[3] || 'A' };
}

function armInfo(role) {
  const m = /^(upper|fore|sleeve)_([lr])$/.exec(role || '');
  return m ? { kind: m[1], side: m[2] } : null;
}

function uniqueId(used, base) {
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function ensureCanvas(layer, factor) {
  if (!layer.canvas) layer.canvas = paintPixels(layer.pixels, layer.width, layer.height, factor);
  return layer.canvas;
}

function toPsd(meta, x, y) {
  return [x * meta.scale + meta.offset[0], y * meta.scale + meta.offset[1]];
}

function toRig(meta, x, y) {
  return [(x - meta.offset[0]) / meta.scale, (y - meta.offset[1]) / meta.scale];
}

const PAIRABLE = new Set(['leg', 'tail', 'static', 'acc_head', 'acc_body', 'hair', 'hair_back', 'body', 'face', 'neck', 'bangs', 'human_ears', 'ear_l', 'ear_r']);

/** Une dos capas vecinas (línea + color) en una sola pieza, sin redibujar. */
function mergePair(a, b) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  const k = a.canvas.width / Math.max(1e-6, a.w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((x1 - x0) * k));
  canvas.height = Math.max(1, Math.round((y1 - y0) * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const layer of [a, b]) {
    ctx.drawImage(layer.canvas, (layer.x - x0) * k, (layer.y - y0) * k, layer.w * k, layer.h * k);
  }
  return {
    ...a,
    name: `${a.name} + ${b.name}`,
    canvas,
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    hidden: a.hidden && b.hidden,
    merged: [a, b],
  };
}

/**
 * Pares línea/color por nombre ('p der' + 'p der color', 'p4 l' + 'p4 color').
 * Vecinos en el orden del archivo: una pieza. Separados: la línea sigue al color.
 */
function pairLayers(layers) {
  for (const layer of layers) layer.pairOf = null;
  const out = [];
  for (let i = 0; i < layers.length; i += 1) {
    const a = layers[i];
    const b = layers[i + 1];
    if (b && PAIRABLE.has(a.role) && a.role === b.role) {
      const pa = pairInfo(a.name);
      const pb = pairInfo(b.name);
      if (pa.key && pa.key === pb.key && pa.color !== pb.color) {
        out.push(mergePair(a, b));
        i += 1;
        continue;
      }
    }
    out.push(a);
  }
  const leaders = new Map();
  for (const layer of out) {
    if (!PAIRABLE.has(layer.role) || layer.merged) continue;
    const info = pairInfo(layer.name);
    const key = `${layer.role}|${info.key}`;
    if (!leaders.has(key)) leaders.set(key, layer);
    else layer.pairOf = leaders.get(key);
  }
  return out;
}

/** A quién sigue una pieza suelta: por nombre primero, por altura si el nombre no dice. */
function groupParent(layer) {
  const group = nameGroup(layer.name);
  if (group === 'head') return 'head';
  if (group === 'body' || group === 'leg' || group === 'tail' || group === 'neck') return 'body';
  return null;
}

/** ¿La pieza va con la cabeza? (directo o colgada de otra pieza de la cabeza) */
function followsHead(part, byId) {
  let cur = part;
  for (let i = 0; cur && i < 16; i += 1) {
    if (cur.role === 'eye' || cur.role === 'mouth' || cur.parent === 'head') return true;
    if (cur.parent === 'body' || !cur.parent) return false;
    cur = byId.get(cur.parent);
  }
  return false;
}

/**
 * La cabeza gira como una sola pieza: una capa del cuerpo (línea del cuerpo, pata) que en el
 * archivo cae entre capas de la cara baja a justo debajo de la cara. Así la línea del cuerpo
 * queda separada de la de la cabeza y no cruza la cara al girar. Nada se corta ni se redibuja.
 */
function headAsOne(parts) {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const head = parts.map((part) => followsHead(part, byId));
  const first = parts.findIndex((part, i) => head[i] && part.role !== 'hair' && part.role !== 'ear');
  let last = -1;
  head.forEach((on, i) => { if (on) last = i; });
  if (first < 0 || last <= first) return;
  const lift = [];
  const keep = [];
  for (let i = first; i <= last; i += 1) (head[i] ? keep : lift).push(parts[i]);
  if (!lift.length) return;
  parts.splice(first, last - first + 1, ...lift, ...keep);
}

/** Huella corta de las piezas: ajustes guardados de otro armado no imponen orden/padres/pivotes. */
function buildStamp(parts) {
  const text = JSON.stringify(parts.map((p) => [p.id, p.parent, p.pivot, p.x, p.y, p.w, p.h, p.psdName]));
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `imp-${(h >>> 0).toString(16)}`;
}

function eyeEntries(slot) {
  const style = slot.styles.A || slot.styles.B || Object.values(slot.styles)[0] || {};
  return ['full', 'white', 'iris', 'pupil', 'highlight', 'lash'].map((k) => style[k]).filter((e) => e?.image);
}

/** Oscuro de su línea: lo más oscuro de la cara (o null). */
function lineDarkOf(part) {
  if (!part?.image) return null;
  const c = part.image;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2], lumOf(d[i], d[i + 1], d[i + 2])]);
  if (!px.length) return null;
  px.sort((a, b) => a[3] - b[3]);
  const k = Math.max(1, Math.floor(px.length / 20));
  const s = [0, 0, 0];
  for (const p of px.slice(0, k)) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
  return s.map((v) => v / k);
}

/**
 * Color de la rayita del ojo cerrado: compone lo que está debajo del ojo (las capas anteriores
 * en el orden de dibujo) dentro de su recuadro y lo compara con el ojo.
 */
function detectClosedLine(side, parts, eyes, rings, ppu, lineDark) {
  const own = [...eyeEntries(eyes[side]), ...rings.filter((r) => r.side === side).map((r) => r.part)];
  if (!own.length) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const e of own) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
  const w = Math.max(1, Math.round((x1 - x0) * ppu));
  const h = Math.max(1, Math.round((y1 - y0) * ppu));
  const canvas = (draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.setTransform(ppu, 0, 0, ppu, -x0 * ppu, -y0 * ppu);
    draw(g);
    return g.getImageData(0, 0, w, h).data;
  };
  const blit = (g, e) => g.drawImage(e.image, e.x, e.y, e.w, e.h);
  const eyeId = `eye_${side}`;
  const at = parts.findIndex((p) => p.id === eyeId);
  const ringSet = new Set(rings.filter((r) => r.side === side).map((r) => r.part));
  const eye = canvas((g) => own.forEach((e) => blit(g, e)));
  const below = canvas((g) => {
    for (let i = 0; i < (at < 0 ? parts.length : at); i += 1) {
      const p = parts[i];
      if (ringSet.has(p) || p.visibleInPsd === false) continue;
      if (p.role === 'eye') { eyeEntries(eyes[p.id === 'eye_r' ? 'r' : 'l']).forEach((e) => blit(g, e)); continue; }
      if (p.image) blit(g, p);
    }
  });
  return pickClosedLine(eye, below, lineDark);
}

export function composeManifest(mapping) {
  const meta = mapping.meta;
  const factor = Math.min(1, meta.pxPerUnit / meta.scale);
  const ppu = meta.pxPerUnit;
  const layers = mapping.layers.filter((layer) => layer.role && layer.role !== 'ignore');
  const faceSrc = mapping.layers.find((layer) => layer.role === 'face');
  const bodySrc = layers.find((layer) => layer.role === 'body');
  const neckPoint = (mapping.neckRig || faceSrc?.pivot || [300, 360]).map(r2);
  const shoulderRig = {
    l: [bodySrc ? bodySrc.x + bodySrc.w * 0.22 : 250, bodySrc ? bodySrc.y + bodySrc.h * 0.12 : 384],
    r: [bodySrc ? bodySrc.x + bodySrc.w * 0.78 : 350, bodySrc ? bodySrc.y + bodySrc.h * 0.12 : 384],
  };
  const used = new Set(['mouth']);
  const parts = [];
  const mouths = {};
  const eyes = {
    l: { center: [220, 300], styles: {}, closed: null },
    r: { center: [380, 300], styles: {}, closed: null },
  };
  const arms = {};
  const extras = {};
  let facePart = null;
  let bodyPart = null;
  let mouthSlot = false;
  const hairN = { l: 0, r: 0 };
  let accN = 0;
  let legN = 0;

  const putMouthSlot = () => {
    if (mouthSlot) return;
    parts.push({ id: 'mouth', role: 'mouth', parent: 'head', pivot: neckPoint.slice() });
    mouthSlot = true;
  };

  for (const layer of layers) ensureCanvas(layer, factor);
  const pieces = pairLayers(layers);
  const partOf = new Map();
  const rings = [];

  for (const layer of pieces) {
    const eye = eyeInfo(layer.role);
    const arm = armInfo(layer.role);
    if (eye) {
      const slot = eyes[eye.side];
      const key = `eye_${eye.side}_${eye.part}${eye.part === 'closed' ? '' : `_${eye.style}`}`;
      const prev = eye.part === 'closed' ? slot.closed : slot.styles[eye.style]?.[eye.part];
      // dos capas para la misma pieza del mismo ojo: se juntan, ninguna pisa a la otra
      const src = prev ? mergePair({ ...prev, canvas: prev.image, name: prev.psdName }, layer) : layer;
      const entry = stamp(key, src.canvas, src.x, src.y, src.w, src.h, { psdName: src.name });
      if (eye.part === 'closed') slot.closed = entry;
      else {
        slot.styles[eye.style] = slot.styles[eye.style] || {};
        slot.styles[eye.style][eye.part] = entry;
      }
      if (eye.part === 'full') slot.center = [r2(entry.x + entry.w / 2), r2(entry.y + entry.h / 2)];
      if (!parts.some((part) => part.id === `eye_${eye.side}`)) {
        // la cabeza gira como una sola pieza: los ojos no se corren respecto del contorno
        parts.push({ id: `eye_${eye.side}`, role: 'eye', parent: 'head', side: eye.side, pivot: slot.center.slice(), parallax: [0, 0] });
        used.add(`eye_${eye.side}`);
      }
      continue;
    }
    if (layer.role.startsWith('mouth_')) {
      const key = layer.role.slice(6);
      mouths[key] = stamp(`mouth_${key}`, layer.canvas, layer.x, layer.y, layer.w, layer.h, { psdName: layer.name });
      continue;
    }
    if (arm) {
      const side = layer.side === 'both' ? 'both' : arm.side;
      const pose = layer.pose && layer.pose !== 'rest' ? layer.pose : null;
      const id = `${arm.kind}_${side}${arm.kind === 'sleeve' && pose ? `_${pose}` : ''}`;
      const anchor = side === 'r' ? shoulderRig.r : shoulderRig.l;
      let pivot = [r2(anchor[0]), r2(anchor[1])];
      if (arm.kind !== 'upper') {
        const [sx, sy] = toPsd(meta, anchor[0], anchor[1]);
        const near = nearestPoint(layer, sx, sy);
        const rig = toRig(meta, near.x, near.y);
        pivot = [r2(rig[0]), r2(rig[1])];
      }
      arms[id] = stamp(id, layer.canvas, layer.x, layer.y, layer.w, layer.h, {
        psdName: layer.name, kind: arm.kind, side, pose: pose || 'rest', parent: 'body', pivot, visibleInPsd: !layer.hidden,
      });
      continue;
    }
    let id;
    let role = 'static';
    let parent = 'head';
    const named = groupParent(layer);
    if (layer.role === 'hair_back') { id = uniqueId(used, 'hair_back'); role = 'hair'; }
    else if (layer.role === 'hair') {
      const side = layer.side === 'r' ? 'r' : 'l';
      hairN[side] += 1;
      id = uniqueId(used, hairN[side] === 1 ? `strand_${side}` : `strand_${side}_${hairN[side]}`);
      role = 'hair';
    } else if (layer.role === 'ear_l' || layer.role === 'ear_r') {
      id = uniqueId(used, layer.role);
      role = 'ear';
    } else if (layer.role === 'tail') {
      id = uniqueId(used, 'tail');
      role = 'tail';
      parent = 'body';
    } else if (layer.role === 'leg') {
      id = uniqueId(used, `leg_${++legN}`);
      role = 'limb';
      parent = 'body';
    } else if (layer.role === 'ring_l' || layer.role === 'ring_r') {
      id = uniqueId(used, `eye_ring_${layer.role.slice(5)}`);
      role = 'static';
    } else if (layer.role === 'face') { id = uniqueId(used, 'face'); role = 'static'; }
    else if (layer.role === 'bangs') { id = uniqueId(used, 'bangs'); }
    else if (layer.role === 'human_ears') { id = uniqueId(used, 'human_ears'); }
    else if (layer.role === 'body') { id = uniqueId(used, 'body'); parent = 'body'; }
    else if (layer.role === 'neck') { id = uniqueId(used, 'neck'); parent = 'body'; role = 'neck'; }
    else if (layer.role === 'acc_head') { id = uniqueId(used, `acc_${++accN}`); }
    else if (layer.role === 'acc_body') { id = uniqueId(used, `acc_${++accN}`); parent = 'body'; }
    else {
      id = uniqueId(used, `part_${++accN}`);
      parent = named || (layer.y + layer.h / 2 > 360 ? 'body' : 'head');
    }
    // la línea de un par separado sigue a su color (mismo pivote, se mueven juntas)
    const leader = layer.pairOf ? partOf.get(layer.pairOf) : null;
    if (leader) {
      parent = leader.id;
      if (role === 'tail' || role === 'limb' || role === 'hair') role = 'static';
    }
    const pivot = leader
      ? leader.pivot.slice()
      : layer.role === 'face' || layer.role === 'bangs' || layer.role === 'human_ears'
        ? neckPoint.slice()
        : (layer.pivot || [r2(layer.x + layer.w / 2), r2(layer.y + layer.h / 2)]);
    const extra = { psdName: layer.name, parent, role, pivot, visibleInPsd: !layer.hidden, id };
    if (parent === 'head' && role === 'static') extra.parallax = [0, 0];
    if (role === 'tail') extra.motion = { sway: 4, speed: 0.35, stiffness: 55, damping: 5, gravity: 0, follow: 1, limit: 12 };
    if (role === 'limb') extra.motion = { sway: 0, speed: 0.3, stiffness: 90, damping: 12, gravity: 0, follow: 0, limit: 6 };
    const part = stamp(id, layer.canvas, layer.x, layer.y, layer.w, layer.h, extra);
    parts.push(part);
    partOf.set(layer, part);
    if (layer.role === 'ring_l' || layer.role === 'ring_r') rings.push({ part, side: layer.role.slice(5) });
    if (layer.role === 'face' && !facePart) {
      facePart = part;
      putMouthSlot();
    }
    if (layer.role === 'body' && !bodyPart) bodyPart = part;
    if (layer.role === 'neck') extras.neck = part;
  }
  if (!mouthSlot) putMouthSlot();
  headAsOne(parts);

  // nada inventado: sin capas de boca, la boca queda como está dibujada en la cara
  const faceLayer = mapping.layers.find((layer) => layer.role === 'face');
  const skin = faceLayer ? medianSkin(faceLayer.pixels) : [247, 186, 170];
  const neutral = mouths.neutral || Object.values(mouths)[0] || null;
  const face = facePart;
  let center;
  if (neutral) center = [neutral.x + neutral.w / 2, neutral.y + neutral.h / 2];
  else if (face) center = [face.x + face.w / 2, face.y + face.h * 0.62];
  else center = [300, 340];

  // sin capas de ojo cerrado: parpadeo aplastando el ojo abierto (sin dibujar líneas nuevas)
  let squash = false;
  for (const side of ['l', 'r']) {
    const slot = eyes[side];
    const full = slot.styles.A?.full || slot.styles.B?.full || Object.values(slot.styles)[0]?.full;
    if (!full) continue;
    slot.center = [r2(full.x + full.w / 2), r2(full.y + full.h / 2)];
    const part = parts.find((item) => item.id === `eye_${side}`);
    if (part) part.pivot = slot.center.slice();
    if (!slot.closed) squash = true;
    extras[`eye_${side}_closed`] = slot.closed;
  }
  // el aro del ojo va con su ojo: mismo pivote, mismo corrimiento al girar, se aplasta con él
  for (const { part, side } of rings) {
    const eyePart = parts.find((item) => item.id === `eye_${side}`);
    part.blinkWith = side;
    part.pivot = eyes[side].center.slice();
    part.parallax = eyePart?.parallax ? eyePart.parallax.slice() : [0, 0];
  }
  // al cerrarse, el ojo queda como rayita de su silueta, del color que contrasta con lo de abajo
  if (squash) {
    const lineDark = lineDarkOf(facePart);
    for (const side of ['l', 'r']) {
      if (eyes[side].closed) continue;
      const info = detectClosedLine(side, parts, eyes, rings, ppu, lineDark);
      if (info) eyes[side].closedLine = info;
    }
  }
  const shoulders = {
    l: [r2(shoulderRig.l[0]), r2(shoulderRig.l[1])],
    r: [r2(shoulderRig.r[0]), r2(shoulderRig.r[1])],
  };

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (e) => {
    if (!e || !(e.w > 0)) return;
    x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h);
  };
  parts.forEach(grow);
  Object.values(mouths).forEach(grow);
  if (!Number.isFinite(x0)) { x0 = 70; y0 = 25; x1 = 530; y1 = 571; }

  const styles = new Set();
  for (const side of ['l', 'r']) Object.keys(eyes[side].styles).forEach((id) => styles.add(id));
  if (!styles.size) styles.add('A');

  return {
    rigSize: [600, 600],
    pxPerUnit: ppu,
    psdOffset: meta.offset.map(r2),
    psdScale: r2(meta.scale),
    source: mapping.name || 'personaje.psd',
    skin,
    neck: { enabled: false, length: 0, stretch: 0.45 },
    parts,
    extras,
    mouths,
    mouthCenter: [r2(center[0]), r2(center[1])],
    arms: { parts: arms, shoulders, hasCustom: Object.keys(arms).length > 0 },
    eyes,
    eyeStyles: [...styles].sort(),
    pivots: {
      neck: (facePart?.pivot || neckPoint).slice(),
      feet: (bodyPart?.pivot || [300, 570]).slice(),
      eye_l: eyes.l.center.slice(),
      eye_r: eyes.r.center.slice(),
      headTop: facePart ? [r2(facePart.x + facePart.w / 2), r2(facePart.y)] : [300, 40],
    },
    bounds: { x0: r2(x0), y0: r2(y0), x1: r2(x1), y1: r2(y1) },
    drawOrder: parts.map((part) => part.id),
    build: buildStamp(parts),
    // dibujo por capas: sin el borde de papel al girar (no se agregan líneas que no están en el archivo)
    paperEdge: false,
    squashBlink: squash,
    blink: { frames: ['open', 'closed'], note: squash ? 'sin capas de ojo cerrado: el ojo abierto se aplasta' : 'open = estilo de ojo; closed = capa del PSD' },
  };
}
