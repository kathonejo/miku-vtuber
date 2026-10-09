/** Ensambla un manifiesto con el mismo esquema que rig.json, imágenes en memoria. */

import { nearestPoint } from './geom.js';
import { MOUTH_SHAPES, drawClosedEye, drawMouth, placeMouth } from './gen.js';
import { extractMouth, lashColor, medianSkin } from './mouthfind.js';
import { paintPixels } from './raster.js';

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

  const putMouthSlot = () => {
    if (mouthSlot) return;
    parts.push({ id: 'mouth', role: 'mouth', parent: 'head', pivot: neckPoint.slice() });
    mouthSlot = true;
  };

  for (const layer of layers) {
    ensureCanvas(layer, factor);
    const eye = eyeInfo(layer.role);
    const arm = armInfo(layer.role);
    if (eye) {
      const slot = eyes[eye.side];
      const entry = stamp(`eye_${eye.side}_${eye.part}${eye.part === 'closed' ? '' : `_${eye.style}`}`, layer.canvas, layer.x, layer.y, layer.w, layer.h, { psdName: layer.name });
      if (eye.part === 'closed') slot.closed = entry;
      else {
        slot.styles[eye.style] = slot.styles[eye.style] || {};
        slot.styles[eye.style][eye.part] = entry;
      }
      if (eye.part === 'full') slot.center = [r2(layer.x + layer.w / 2), r2(layer.y + layer.h / 2)];
      if (!parts.some((part) => part.id === `eye_${eye.side}`)) {
        parts.push({ id: `eye_${eye.side}`, role: 'eye', parent: 'head', side: eye.side, pivot: slot.center.slice() });
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
    if (layer.role === 'hair_back') { id = uniqueId(used, 'hair_back'); role = 'hair'; }
    else if (layer.role === 'hair') {
      const side = layer.side === 'r' ? 'r' : 'l';
      hairN[side] += 1;
      id = uniqueId(used, hairN[side] === 1 ? `strand_${side}` : `strand_${side}_${hairN[side]}`);
      role = 'hair';
    } else if (layer.role === 'ear_l' || layer.role === 'ear_r') {
      id = uniqueId(used, layer.role);
      role = 'ear';
    } else if (layer.role === 'face') { id = uniqueId(used, 'face'); role = 'static'; }
    else if (layer.role === 'bangs') { id = uniqueId(used, 'bangs'); }
    else if (layer.role === 'human_ears') { id = uniqueId(used, 'human_ears'); }
    else if (layer.role === 'body') { id = uniqueId(used, 'body'); parent = 'body'; }
    else if (layer.role === 'neck') { id = uniqueId(used, 'neck'); parent = 'body'; role = 'neck'; }
    else if (layer.role === 'acc_head') { id = uniqueId(used, `acc_${++accN}`); }
    else if (layer.role === 'acc_body') { id = uniqueId(used, `acc_${++accN}`); parent = 'body'; }
    else {
      id = uniqueId(used, `part_${++accN}`);
      parent = layer.y + layer.h / 2 > 360 ? 'body' : 'head';
    }
    const pivot = layer.role === 'face' || layer.role === 'bangs' || layer.role === 'human_ears'
      ? neckPoint.slice()
      : (layer.pivot || [r2(layer.x + layer.w / 2), r2(layer.y + layer.h / 2)]);
    const part = stamp(id, layer.canvas, layer.x, layer.y, layer.w, layer.h, {
      psdName: layer.name, parent, role, pivot, visibleInPsd: !layer.hidden, id,
    });
    parts.push(part);
    if (layer.role === 'face' && !facePart) {
      facePart = part;
      putMouthSlot();
    }
    if (layer.role === 'body' && !bodyPart) bodyPart = part;
    if (layer.role === 'neck') extras.neck = part;
  }
  if (!mouthSlot) putMouthSlot();

  const faceLayer = mapping.layers.find((layer) => layer.role === 'face');
  const hasBoca = mapping.layers.some((layer) => layer.role.startsWith('mouth_'));
  let skin = faceLayer ? medianSkin(faceLayer.pixels) : [247, 186, 170];
  if (faceLayer && !hasBoca && !mouths.neutral) {
    const copy = faceLayer.pixels.slice();
    const cut = extractMouth(copy, faceLayer.width, faceLayer.height);
    if (cut) {
      const filled = paintPixels(copy, faceLayer.width, faceLayer.height, factor);
      if (facePart) facePart.image = filled;
      facePart && (facePart.mouthErased = true);
      const k = meta.scale;
      const x = faceLayer.x + cut.box.x0 / k;
      const y = faceLayer.y + cut.box.y0 / k;
      const w = cut.mw / k;
      const h = cut.mh / k;
      mouths.neutral = stamp('mouth_neutral', paintPixels(cut.mouth, cut.mw, cut.mh, factor), x, y, w, h, { psdName: 'boca' });
      skin = cut.skin || skin;
      mapping._cut = cut;
    }
  }

  const neutral = mouths.neutral;
  const face = facePart;
  let center;
  let foundW;
  if (neutral) {
    center = [neutral.x + neutral.w / 2, neutral.y + neutral.h / 2];
    foundW = neutral.w;
  } else if (face) {
    center = [face.x + face.w / 2, face.y + face.h * 0.62];
    foundW = face.w * 0.16;
  } else {
    center = [300, 340];
    foundW = 36;
  }
  const lashSrc = mapping.layers.find((layer) => layer.role === 'eye_l_A' || layer.role === 'eye_r_A' || /^eye_[lr]_/.test(layer.role));
  const lash = lashSrc ? lashColor(lashSrc.pixels) : [10, 74, 132];
  const scale = Math.max(0.45, foundW / 40);
  for (const key of ['neutral', 'small', 'a', 'o', 'smile']) {
    if (mouths[key]) continue;
    const drawn = drawMouth(MOUTH_SHAPES[key], scale, lash, ppu);
    const placed = placeMouth(drawn, center, ppu);
    if (placed) mouths[key] = stamp(`mouth_${key}`, placed.canvas, placed.x, placed.y, placed.w, placed.h, { generated: true });
  }

  for (const side of ['l', 'r']) {
    const slot = eyes[side];
    const full = slot.styles.A?.full || slot.styles.B?.full || Object.values(slot.styles)[0]?.full;
    if (!full) continue;
    slot.center = [r2(full.x + full.w / 2), r2(full.y + full.h / 2)];
    const part = parts.find((item) => item.id === `eye_${side}`);
    if (part) part.pivot = slot.center.slice();
    if (!slot.closed) {
      const closed = drawClosedEye({ x: full.x, y: full.y, w: full.w, h: full.h }, lash, ppu, side === 'l');
      if (closed) {
        slot.closed = stamp(`eye_${side}_closed`, closed.canvas, closed.x, closed.y, closed.w, closed.h, { parent: 'head', role: 'eye', generated: true });
      }
    }
    extras[`eye_${side}_closed`] = slot.closed;
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
    blink: { frames: ['open', 'closed'], note: 'open = estilo de ojo; closed = capa o arco generado' },
  };
}
