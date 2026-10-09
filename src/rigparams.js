/** Parámetros de cada pieza. Se guardan en localStorage y también viajan en rig.json. */

import { clamp } from './filters.js';

export const RIG_KEY = 'bunny-vtuber-rig-v1';

let activeId = 'bunny';
const saveListeners = new Set();

/** La conejita oficial sigue en la clave antigua. El resto, clave por id. */
export function rigStorageKey(id = activeId) {
  if (!id || id === 'bunny') return RIG_KEY;
  return `${RIG_KEY}:${id}`;
}

export function setRigCharacter(id) {
  activeId = id || 'bunny';
}

export function currentRigCharacter() {
  return activeId;
}

export function onRigSave(fn) {
  if (typeof fn !== 'function') return () => {};
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

function notifySave(flat, id) {
  for (const fn of saveListeners) {
    try { fn(flat, id); } catch { /* el oyente no puede romper el guardado */ }
  }
}

export const PART_LABELS = {
  hair_back: 'Pelo atrás',
  ear_r: 'Oreja conejo der.',
  ear_l: 'Oreja conejo izq.',
  lock_back_r: 'Mechón atrás der.',
  lock_back_l: 'Mechón atrás izq.',
  human_ears: 'Orejas',
  face: 'Cara',
  strand_l: 'Mechón largo izq.',
  curl_l: 'Mechón rizo izq.',
  body: 'Cuerpo',
  strand_r: 'Mechón largo der.',
  bangs: 'Flequillo',
  eye_l: 'Ojo izq.',
  eye_r: 'Ojo der.',
};

const PHASE = {
  hair_back: 0,
  lock_back_r: 0.15,
  lock_back_l: 0.6,
  strand_l: 0.3,
  curl_l: 0.45,
  strand_r: 0.8,
  ear_l: 0,
  ear_r: 0.25,
};

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function num(v, fb, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return clamp(n, lo, hi);
}

export function swings(part) {
  const id = part?.id || '';
  if (part?.role === 'ear') return { sway: 7, limit: 12 };
  if (id === 'hair_back') return { sway: 1.5, limit: 4 };
  return { sway: 3, limit: 6 };
}

/** Valores que reproducen el movimiento actual de orejas y pelo. */
export function motionDefaults(part) {
  const swing = swings(part);
  const ear = part?.role === 'ear';
  return {
    sway: swing.sway,
    speed: ear ? 0.35 : 0.26,
    stiffness: ear ? 130 : 95,
    damping: ear ? 13 : 12,
    phase: PHASE[part?.id] ?? 0,
    gravity: 0,
    follow: 1,
    limit: swing.limit,
  };
}

export function emptyRig(part) {
  return {
    dx: 0,
    dy: 0,
    scale: 1,
    rot: 0,
    visible: true,
    ...motionDefaults(part),
  };
}

export function sanitizeRig(raw, part) {
  const d = emptyRig(part);
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    dx: num(src.dx, d.dx, -40, 40),
    dy: num(src.dy, d.dy, -40, 40),
    scale: num(src.scale, d.scale, 0.7, 1.3),
    rot: num(src.rot, d.rot, -30, 30),
    visible: src.visible === false ? false : true,
    sway: num(src.sway, d.sway, 0, 20),
    speed: num(src.speed, d.speed, 0, 3),
    stiffness: num(src.stiffness, d.stiffness, 20, 400),
    damping: num(src.damping, d.damping, 2, 40),
    phase: num(src.phase, d.phase, 0, 1),
    gravity: num(src.gravity, d.gravity, -10, 10),
    follow: num(src.follow, d.follow, 0, 2),
    limit: num(src.limit, d.limit, 2, 30),
  };
}

function readOffset(part) {
  const off = part?.offset;
  if (Array.isArray(off)) return { dx: off[0], dy: off[1] };
  if (off && typeof off === 'object') return { dx: off.x ?? off.dx, dy: off.y ?? off.dy };
  return {};
}

/** Copia offset/scale/rotation/visible/motion del JSON a part.rig (grados). */
export function stampPart(part) {
  if (!part || typeof part !== 'object') return part;
  const baked = {
    ...readOffset(part),
    scale: part.scale,
    rot: part.rotation,
    visible: part.visible,
    ...(part.motion && typeof part.motion === 'object' ? part.motion : {}),
  };
  part.rig = sanitizeRig(baked, part);
  return part;
}

export function glueMouth(parts) {
  const list = parts.slice();
  const mouth = list.find((p) => p && (p.role === 'mouth' || p.id === 'mouth'));
  if (!mouth) return list;
  const rest = list.filter((p) => p !== mouth);
  const faceAt = rest.findIndex((p) => p.id === 'face');
  if (faceAt >= 0) rest.splice(faceAt + 1, 0, mouth);
  else rest.push(mouth);
  return rest;
}

export function applyOrder(parts, order) {
  if (!Array.isArray(order) || !order.length) return glueMouth(parts);
  const map = new Map(parts.map((p) => [p.id, p]));
  const used = new Set();
  const out = [];
  for (const id of order) {
    if (typeof id !== 'string' || !map.has(id) || used.has(id)) continue;
    out.push(map.get(id));
    used.add(id);
  }
  for (const part of parts) {
    if (!used.has(part.id)) out.push(part);
  }
  return glueMouth(out);
}

export function movePart(parts, id, dir) {
  const step = dir < 0 ? -1 : 1;
  const mouth = parts.find((p) => p.role === 'mouth' || p.id === 'mouth');
  const rest = parts.filter((p) => p !== mouth);
  const moving = id === 'mouth' ? 'face' : id;
  const idx = rest.findIndex((p) => p.id === moving);
  const next = idx + step;
  if (idx < 0 || next < 0 || next >= rest.length) return glueMouth(parts);
  const copy = rest.slice();
  const [item] = copy.splice(idx, 1);
  copy.splice(next, 0, item);
  if (mouth) {
    const faceAt = copy.findIndex((p) => p.id === 'face');
    if (faceAt >= 0) copy.splice(faceAt + 1, 0, mouth);
    else copy.push(mouth);
  }
  return copy;
}

function pivotOf(raw) {
  if (Array.isArray(raw) && Number.isFinite(+raw[0]) && Number.isFinite(+raw[1])) {
    return [+raw[0], +raw[1]];
  }
  return null;
}

export function applyPartOverride(part, raw) {
  if (!part || !raw || typeof raw !== 'object') return;
  const pivot = pivotOf(raw.pivot);
  if (pivot) part.pivot = pivot;
  part.rig = sanitizeRig({ ...part.rig, ...raw }, part);
}

export function normalizeStore(data) {
  const empty = { order: null, parts: {} };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
  if (data.parts && typeof data.parts === 'object' && !Array.isArray(data.parts)) {
    return { order: Array.isArray(data.order) ? data.order : null, parts: { ...data.parts } };
  }
  const parts = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'order' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    parts[key] = value;
  }
  return { order: Array.isArray(data.order) ? data.order : null, parts };
}

export function loadOverrides(id) {
  const store = storage();
  if (!store) return { order: null, parts: {} };
  try {
    const raw = store.getItem(rigStorageKey(id));
    if (!raw) return { order: null, parts: {} };
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { order: null, parts: {} };
  }
}

export function packOverrides(data) {
  const norm = normalizeStore(data);
  const flat = { order: norm.order || [] };
  for (const [id, row] of Object.entries(norm.parts)) flat[id] = row;
  return flat;
}

export function saveOverrides(data, id) {
  const store = storage();
  const who = id === undefined ? activeId : (id || 'bunny');
  const flat = packOverrides(data);
  if (!store) {
    notifySave(flat, who);
    return false;
  }
  try {
    store.setItem(rigStorageKey(who), JSON.stringify(flat));
    notifySave(flat, who);
    return true;
  } catch {
    return false;
  }
}

export function clearOverrides(id) {
  const store = storage();
  const who = id === undefined ? activeId : (id || 'bunny');
  if (store) {
    try { store.removeItem(rigStorageKey(who)); } catch { /* sin almacenamiento */ }
  }
  notifySave({ order: [] }, who);
}

export function collectOverrides(parts) {
  const out = { order: parts.map((p) => p.id) };
  for (const part of parts) {
    const rig = part.rig || emptyRig(part);
    const row = { ...rig };
    if (Array.isArray(part.pivot)) row.pivot = [+part.pivot[0], +part.pivot[1]];
    out[part.id] = row;
  }
  return out;
}

export function applyOverrides(manifest, data) {
  if (!manifest || !data) return manifest;
  const norm = normalizeStore(data);
  manifest.parts = applyOrder(manifest.parts, norm.order);
  for (const part of manifest.parts) {
    const raw = norm.parts[part.id];
    if (raw && typeof raw === 'object') applyPartOverride(part, raw);
  }
  return manifest;
}

export function captureBase(manifest) {
  return {
    order: manifest.parts.map((p) => p.id),
    parts: Object.fromEntries(manifest.parts.map((p) => [p.id, {
      pivot: Array.isArray(p.pivot) ? [+p.pivot[0], +p.pivot[1]] : null,
      rig: { ...(p.rig || emptyRig(p)) },
    }])),
  };
}

export function restoreBase(manifest, base) {
  if (!base) return manifest;
  const map = new Map(manifest.parts.map((p) => [p.id, p]));
  const ordered = [];
  for (const id of base.order || []) {
    if (map.has(id)) ordered.push(map.get(id));
  }
  for (const part of manifest.parts) {
    if (!ordered.includes(part)) ordered.push(part);
  }
  manifest.parts = glueMouth(ordered);
  for (const part of manifest.parts) {
    const saved = base.parts?.[part.id];
    if (!saved) continue;
    part.rig = { ...saved.rig };
    if (saved.pivot) part.pivot = [saved.pivot[0], saved.pivot[1]];
  }
  return manifest;
}

export function partTitle(part) {
  const name = PART_LABELS[part?.id] || part?.id || 'Pieza';
  const psd = part?.psdName ? ` — ${part.psdName}` : '';
  return `${name}${psd}`;
}

function hairSign(id) {
  if (id === 'hair_back') return 0.35;
  if (id.includes('_l')) return 1;
  if (id.includes('_r')) return -1;
  return 0.5;
}

/** Empuje de la cabeza, en radianes, con follow = 1. */
export function headCoupling(part, head) {
  const id = part?.id || '';
  if (part?.role === 'ear') {
    if (id.endsWith('_l')) return -head.yaw * 0.09 + head.rollRad * 0.25;
    return head.yaw * 0.08 - head.rollRad * 0.25;
  }
  const sign = hairSign(id);
  return -head.rollRad * 0.45 * sign - head.yaw * 0.07 * sign + head.lean * 0.18 * sign;
}

/** Objetivo del resorte: balanceo + gravedad + cabeza, limitado en grados. */
export function strandTarget(part, rig, head, time) {
  const sway = (rig.sway || 0) * (Math.PI / 180);
  const limit = Math.max(0.01, (rig.limit || 3) * (Math.PI / 180));
  const phase = (rig.phase || 0) * Math.PI * 2;
  const idle = Math.sin(time * (rig.speed || 0) * Math.PI * 2 + phase) * sway;
  const droop = (rig.gravity || 0) * (Math.PI / 180);
  const rollLean = -head.rollRad * ((rig.gravity || 0) / 10);
  const drive = headCoupling(part, head) * (rig.follow ?? 1);
  return clamp(idle + droop + rollLean + drive, -limit, limit);
}

export function shakeTargets(targets, timeSec) {
  const w = Math.sin(timeSec * 0.7 * Math.PI * 2) * 0.8;
  return { ...(targets || {}), yaw: w, roll: w };
}

function bakedInto(part) {
  const off = Array.isArray(part?.offset)
    ? { dx: +part.offset[0] || 0, dy: +part.offset[1] || 0 }
    : {};
  return sanitizeRig({
    ...off,
    scale: part?.scale,
    rot: part?.rotation,
    visible: part?.visible,
    ...(part?.motion && typeof part.motion === 'object' ? part.motion : {}),
  }, part);
}

/** Devuelve piezas nuevas con _rig. `store` puede ser {order, parts} o el JSON plano. */
export function applyRig(baseParts, store) {
  const norm = normalizeStore(store);
  const list = (Array.isArray(baseParts) ? baseParts : []).map((part) => {
    const copy = { ...part };
    const extra = norm.parts[part.id];
    copy._rig = extra ? sanitizeRig({ ...bakedInto(part), ...extra }, part) : bakedInto(part);
    const piv = extra && pivotOf(extra.pivot);
    if (piv) copy.pivot = piv;
    return copy;
  });
  return applyOrder(list, norm.order);
}

export function strandAngle(part, rig, time, pose, delayed) {
  const head = delayed || pose || { yaw: 0, rollRad: 0, lean: 0 };
  return strandTarget(part, rig || emptyRig(part), head, time || 0);
}
