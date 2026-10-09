/** Exportar e importar el rig (rig.json horneado o JSON de overrides). */

import { emptyRig } from './rigparams.js';

function readOffset(part) {
  const off = part?.offset;
  if (Array.isArray(off)) return { dx: +off[0] || 0, dy: +off[1] || 0 };
  if (off && typeof off === 'object') return { dx: +(off.x ?? off.dx) || 0, dy: +(off.y ?? off.dy) || 0 };
  return {};
}

export function bakePart(part) {
  const rig = part._rig || part.rig || emptyRig(part);
  const out = { ...part };
  delete out.rig;
  if (Array.isArray(part.pivot)) out.pivot = [+part.pivot[0], +part.pivot[1]];
  out.offset = [rig.dx, rig.dy];
  out.scale = rig.scale;
  out.rotation = rig.rot;
  out.visible = rig.visible !== false;
  if (part.role === 'hair' || part.role === 'ear') {
    out.motion = {
      sway: rig.sway,
      speed: rig.speed,
      stiffness: rig.stiffness,
      damping: rig.damping,
      phase: rig.phase,
      gravity: rig.gravity,
      follow: rig.follow,
      limit: rig.limit,
    };
  }
  return out;
}

export function exportManifest(raw, manifest) {
  const base = raw && typeof raw === 'object' ? structuredClone(raw) : {};
  base.parts = manifest.parts.map((part) => bakePart(part));
  if (manifest.neck) {
    base.neck = {
      enabled: Boolean(manifest.neck.enabled),
      length: Number(manifest.neck.length) || 0,
      stretch: Number(manifest.neck.stretch) || 0,
    };
  }
  if (manifest.pivots?.neck) {
    base.pivots = base.pivots || {};
    base.pivots.neck = [manifest.pivots.neck.x, manifest.pivots.neck.y];
  }
  return base;
}

export function parseRigImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'El archivo no es un JSON de rig.' };
  }
  if (Array.isArray(data.parts)) {
    const overrides = { order: [] };
    for (const part of data.parts) {
      if (!part?.id) continue;
      overrides.order.push(part.id);
      overrides[part.id] = {
        ...readOffset(part),
        scale: part.scale,
        rot: part.rotation,
        visible: part.visible,
        pivot: part.pivot,
        parent: part.parent,
        ...(part.motion && typeof part.motion === 'object' ? part.motion : {}),
      };
    }
    if (data.neck && typeof data.neck === 'object') {
      overrides._neck = {
        ...data.neck,
        pivot: data.pivots?.neck || data.neck.pivot || null,
      };
    }
    if (!overrides.order.length) return { ok: false, error: 'El rig no tiene piezas.' };
    return { ok: true, overrides };
  }
  const order = Array.isArray(data.order) ? data.order.filter((id) => typeof id === 'string') : [];
  const overrides = { order };
  let n = 0;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'order' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    overrides[key] = value;
    n += 1;
  }
  if (!n && !order.length) return { ok: false, error: 'No reconocí piezas ni un orden.' };
  return { ok: true, overrides };
}
