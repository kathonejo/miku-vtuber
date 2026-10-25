/* Lee un PSD de escena: aplana grupos en orden (atrás → adelante), salta lo oculto y recorta al dibujo. */
import { initializeCanvas, readPsd } from 'ag-psd';

initializeCanvas((w, h) => new OffscreenCanvas(w, h));

const BLENDS = {
  normal: 'source-over', lighten: 'lighten', darken: 'darken', multiply: 'multiply', screen: 'screen',
  overlay: 'overlay', 'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light',
  'soft light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue',
  saturation: 'saturation', color: 'color', luminosity: 'luminosity', 'linear dodge': 'lighter',
};

function trim(img, left, top) {
  const { width, height, data } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] > 2) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const s = ((y + minY) * width + minX) * 4;
    px.set(data.subarray(s, s + w * 4), y * w * 4);
  }
  return { x: left + minX, y: top + minY, w, h, px };
}

/* Las máscaras de capa (y de grupo) definen qué se ve: sin aplicarlas aparecen los rellenos de fondo. */
function applyMask(img, left, top, mask) {
  if (!mask || mask.disabled) return;
  const md = mask.imageData;
  const def = mask.defaultColor ?? 255;
  const mL = mask.left ?? 0, mT = mask.top ?? 0;
  const mW = md ? md.width : 0, mH = md ? md.height : 0;
  const { width, height, data } = img;
  for (let y = 0; y < height; y += 1) {
    const my = top + y - mT;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4 + 3;
      if (!data[i]) continue;
      const mx = left + x - mL;
      const m = md && mx >= 0 && my >= 0 && mx < mW && my < mH ? md.data[(my * mW + mx) * 4] : def;
      if (m !== 255) data[i] = (data[i] * m + 127) / 255;
    }
  }
}

self.onmessage = (ev) => {
  try {
    const psd = readPsd(ev.data.buffer, {
      skipThumbnail: true, skipCompositeImageData: true, skipLinkedFilesData: true, useImageData: true,
    });
    const layers = [];
    let skipped = 0;
    const walk = (nodes, path, masks) => {
      for (const n of nodes || []) {
        const name = n.name || 'Capa';
        if (n.hidden) { skipped += n.children ? n.children.length : 1; continue; }
        if (n.children) { walk(n.children, path.concat(name), n.mask ? masks.concat(n.mask) : masks); continue; }
        if (!n.imageData) continue;
        for (const m of n.mask ? masks.concat(n.mask) : masks) applyMask(n.imageData, n.left || 0, n.top || 0, m);
        if (n.clipping) clipped += 1;
        const t = trim(n.imageData, n.left || 0, n.top || 0);
        if (!t) continue;
        layers.push({
          name, group: path.join(' / '), x: t.x, y: t.y, w: t.w, h: t.h,
          opacity: n.opacity == null ? 1 : n.opacity,
          blend: BLENDS[n.blendMode] || 'source-over',
          buffer: t.px.buffer,
        });
      }
    };
    let clipped = 0;
    walk(psd.children, [], []);
    self.postMessage({ width: psd.width, height: psd.height, layers, skipped, clipped }, layers.map((l) => l.buffer));
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
