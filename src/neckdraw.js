/** Cuello: largo, estiramiento y el dibujo entre cuerpo y cabeza. */

import { clamp } from './filters.js';

export function neckLiftAmount(neck, view) {
  if (!neck?.enabled) return 0;
  const length = clamp(Number(neck.length) || 0, 0, 30);
  const stretch = clamp(Number(neck.stretch) || 0, 0, 1);
  const pitch = Number(view?.pitch) || 0;
  const up = Math.max(0, -pitch);
  const forward = Math.max(0, pitch);
  const jumpSquash = Math.max(0, 1 - (Number(view?.jumpSy) || 1));
  const bounceSquash = Math.max(0, -(Number(view?.bounce) || 0));
  const extra = stretch * (up * 10 + forward * 6 - (jumpSquash + bounceSquash) * 14);
  return clamp(length + extra, 0, 46);
}

/** Antes del cuerpo, o antes de la cara si el cuerpo se dibuja encima. */
export function neckAnchorId(parts) {
  const list = parts || [];
  const body = list.find((part) => part?.id === 'body');
  const face = list.find((part) => part?.id === 'face');
  if (body && face && list.indexOf(body) > list.indexOf(face)) return face.id;
  return body?.id || face?.id || null;
}

function skinCss(manifest) {
  const skin = manifest?.skin;
  if (Array.isArray(skin) && skin.length >= 3) {
    return `rgb(${skin[0] | 0},${skin[1] | 0},${skin[2] | 0})`;
  }
  return 'rgb(247,186,170)';
}

function neckPart(manifest) {
  return (manifest?.parts || []).find((part) => part && (part.role === 'neck' || part.id === 'neck') && part.file);
}

export function paintNeck(ctx, manifest, lift, getImage) {
  const pivot = manifest?.pivots?.neck;
  if (!pivot) return;
  const top = pivot.y - (lift || 0);
  const bot = pivot.y + 10;
  const height = Math.max(6, bot - top);
  const mapped = neckPart(manifest);
  const img = mapped && getImage ? getImage(mapped.file) : null;
  if (img && mapped.w > 0) {
    ctx.drawImage(img, mapped.x, top, mapped.w, height);
    return;
  }
  const face = manifest.byId?.face;
  const width = Math.max(16, (face?.w || 150) * 0.22);
  const topW = width * 0.82;
  const x = pivot.x;
  const y0 = top;
  const y1 = top + height;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - topW / 2, y0 + 3);
  ctx.quadraticCurveTo(x - topW / 2, y0, x, y0);
  ctx.quadraticCurveTo(x + topW / 2, y0, x + topW / 2, y0 + 3);
  ctx.lineTo(x + width / 2, y1);
  ctx.quadraticCurveTo(x, y1 + 3, x - width / 2, y1);
  ctx.closePath();
  ctx.fillStyle = skinCss(manifest);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(150,60,60,.25)';
  ctx.fillRect(x - width, y0, width * 2, Math.min(9, height * 0.28));
  ctx.restore();
  ctx.strokeStyle = '#0a4a84';
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - topW / 2 + 0.6, y0 + 4);
  ctx.quadraticCurveTo(x - width / 2 - 1, (y0 + y1) / 2, x - width / 2 + 0.4, y1 - 1);
  ctx.moveTo(x + topW / 2 - 0.6, y0 + 4);
  ctx.quadraticCurveTo(x + width / 2 + 1, (y0 + y1) / 2, x + width / 2 - 0.4, y1 - 1);
  ctx.stroke();
  ctx.restore();
}
