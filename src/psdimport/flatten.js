/** Aplana el PSD (grupos incluidos, de abajo arriba) y recorta al alfa. */

import { classifyName, isKnownRole, normName } from './names.js';

const ALPHA = 8;

function trimPixels(imageData, left, top, opacity) {
  const width = imageData?.width || 0;
  const height = imageData?.height || 0;
  const data = imageData?.data;
  if (!width || !height || !data) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] <= ALPHA) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      count += 1;
    }
  }
  if (!count) return null;
  const pad = 2;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const pixels = new Uint8ClampedArray(w * h * 4);
  const op = opacity == null || opacity >= 0.999 ? 1 : opacity;
  for (let y = 0; y < h; y += 1) {
    const src = ((y + y0) * width + x0) * 4;
    const dst = y * w * 4;
    pixels.set(data.subarray(src, src + w * 4), dst);
    if (op < 1) {
      for (let x = 0; x < w; x += 1) pixels[dst + x * 4 + 3] = Math.round(pixels[dst + x * 4 + 3] * op);
    }
  }
  return {
    left: (left || 0) + x0,
    top: (top || 0) + y0,
    width: w,
    height: h,
    cx: (left || 0) + sumX / count,
    cy: (top || 0) + sumY / count,
    pixels,
  };
}

function keepLayer(name, hidden, groupHidden) {
  if (!hidden && !groupHidden) return true;
  if (groupHidden && normName(name).startsWith('capa')) return false;
  return isKnownRole(name);
}

/**
 * @param {object} psd resultado de readPsd
 * @returns {Array} capas recortadas, orden de dibujo
 */
export function flattenPsd(psd) {
  const out = [];
  const walk = (nodes, path, groupHidden) => {
    for (const layer of nodes || []) {
      const name = layer?.name || 'Capa';
      const hidden = Boolean(layer?.hidden);
      if (layer?.children?.length) {
        walk(layer.children, path.concat(name), groupHidden || hidden);
        continue;
      }
      if (!keepLayer(name, hidden, groupHidden)) continue;
      const trimmed = trimPixels(layer.imageData, layer.left || 0, layer.top || 0, layer.opacity);
      if (!trimmed) continue;
      const cls = classifyName(name);
      out.push({
        name,
        path: path.join(' / '),
        norm: cls.name,
        hidden: hidden || groupHidden,
        cls,
        pose: cls.pose || 'rest',
        style: cls.style || null,
        eyePart: cls.eyePart || null,
        ...trimmed,
      });
    }
  };
  walk(psd?.children, [], false);
  out.forEach((layer, index) => { layer.index = index; });
  return out;
}
