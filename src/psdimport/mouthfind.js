/** Busca la boca pintada en la cara y separa la tinta del color de piel. */

function medianChannel(list, ch) {
  const arr = list.map((c) => c[ch]).sort((a, b) => a - b);
  return arr[arr.length >> 1] || 0;
}

function lum(r, g, b) {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

export function medianSkin(pixels) {
  const cols = [];
  const step = Math.max(1, Math.floor(pixels.length / 4 / 24000));
  for (let p = 0; p < pixels.length; p += 4 * step) {
    if (pixels[p + 3] < 220) continue;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    if (r > 150 && r + 8 > b && g > 80 && lum(r, g, b) > 110) cols.push([r, g, b]);
  }
  if (cols.length < 12) {
    for (let p = 0; p < pixels.length; p += 4 * step) {
      if (pixels[p + 3] > 200) cols.push([pixels[p], pixels[p + 1], pixels[p + 2]]);
    }
  }
  if (!cols.length) return [247, 186, 170];
  return [medianChannel(cols, 0), medianChannel(cols, 1), medianChannel(cols, 2)];
}

export function lashColor(pixels) {
  const cols = [];
  for (let p = 0; p < pixels.length; p += 4) {
    if (pixels[p + 3] < 240) continue;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    if (b > r + 60 && r + g + b < 330) cols.push([r, g, b]);
  }
  if (cols.length < 40) return [10, 74, 132];
  return [medianChannel(cols, 0), medianChannel(cols, 1), medianChannel(cols, 2)];
}

function dist(pixels, i, skin) {
  return Math.hypot(pixels[i] - skin[0], pixels[i + 1] - skin[1], pixels[i + 2] - skin[2]);
}

function components(pixels, w, h, x0, x1, y0, y1, skin, skinLum) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const dark = (i) => pixels[i + 3] > 170 && lum(pixels[i], pixels[i + 1], pixels[i + 2]) < skinLum - 42 && dist(pixels, i, skin) > 46;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = y * w + x;
      if (seen[p]) continue;
      const i = p * 4;
      if (!dark(i)) continue;
      let n = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      const stack = [p];
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop();
        n += 1;
        const qx = q % w;
        const qy = (q / w) | 0;
        if (qx < minX) minX = qx;
        if (qy < minY) minY = qy;
        if (qx > maxX) maxX = qx;
        if (qy > maxY) maxY = qy;
        const next = [q - 1, q + 1, q - w, q + w];
        for (let k = 0; k < 4; k += 1) {
          const r = next[k];
          if (r < 0 || r >= w * h || seen[r]) continue;
          const ry = (r / w) | 0;
          const rx = r - ry * w;
          if (rx < x0 || rx >= x1 || ry < y0 || ry >= y1) continue;
          if (!dark(r * 4)) continue;
          seen[r] = 1;
          stack.push(r);
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (n < 28 || bw < 8 || bh < 4) continue;
      if (bw > w * 0.5 || bh > h * 0.28) continue;
      out.push({ n, minX, minY, maxX, maxY, bw, bh, cy: (minY + maxY) / 2 });
    }
  }
  return out;
}

/** Caja de la boca en píxeles de la cara, o null. */
export function findMouthBox(pixels, w, h) {
  const skin = medianSkin(pixels);
  const skinLum = lum(skin[0], skin[1], skin[2]);
  const x0 = Math.floor(w * 0.32);
  const x1 = Math.floor(w * 0.72);
  const y0 = Math.floor(h * 0.66);
  const y1 = Math.floor(h * 0.92);
  let comps = components(pixels, w, h, x0, x1, y0, y1, skin, skinLum);
  if (!comps.length) {
    comps = components(pixels, w, h, Math.floor(w * 0.28), Math.floor(w * 0.75), Math.floor(h * 0.58), Math.floor(h * 0.92), skin, skinLum - 10);
  }
  if (!comps.length) return null;
  const inner = comps.filter((c) => c.maxY < h * 0.9 && c.minY > h * 0.62 && c.bw > c.bh * 1.15);
  const pool = inner.length ? inner : comps.filter((c) => c.maxY < h * 0.92);
  if (!pool.length) return null;
  pool.sort((a, b) => b.n * (b.bw / (b.bh + 2)) - a.n * (a.bw / (a.bh + 2)));
  return padBox(pool[0], w, h);
}

function padBox(box, w, h) {
  const pad = Math.max(4, Math.round(Math.min(box.bw, box.bh) * 0.18));
  return {
    x0: Math.max(0, box.minX - pad),
    y0: Math.max(0, box.minY - pad),
    x1: Math.min(w - 1, box.maxX + pad),
    y1: Math.min(h - 1, box.maxY + pad),
  };
}

function ringSkin(pixels, w, h, box, skin) {
  const cols = [];
  const grow = 14;
  const x0 = Math.max(0, box.x0 - grow);
  const y0 = Math.max(0, box.y0 - grow);
  const x1 = Math.min(w - 1, box.x1 + grow);
  const y1 = Math.min(h - 1, box.y1 + grow);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
      const i = (y * w + x) * 4;
      if (pixels[i + 3] < 230) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (Math.hypot(r - skin[0], g - skin[1], b - skin[2]) > 80) continue;
      cols.push([r, g, b]);
    }
  }
  if (cols.length < 8) return skin;
  return [medianChannel(cols, 0), medianChannel(cols, 1), medianChannel(cols, 2)];
}

/**
 * Recorta la tinta de la boca y rellena la cara con la piel.
 * Devuelve { mouth: Uint8ClampedArray, mw, mh, box, skin } y modifica pixels.
 */
export function extractMouth(pixels, w, h) {
  const skin0 = medianSkin(pixels);
  const box = findMouthBox(pixels, w, h);
  if (!box) return null;
  const skin = ringSkin(pixels, w, h, box, skin0);
  const mw = box.x1 - box.x0 + 1;
  const mh = box.y1 - box.y0 + 1;
  const mouth = new Uint8ClampedArray(mw * mh * 4);
  const mask = new Uint8Array(w * h);
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(pixels[i] - skin[0], pixels[i + 1] - skin[1], pixels[i + 2] - skin[2]);
      const ink = Math.max(0, Math.min(1, (d - 45) / 60));
      const di = ((y - box.y0) * mw + (x - box.x0)) * 4;
      mouth[di] = pixels[i];
      mouth[di + 1] = pixels[i + 1];
      mouth[di + 2] = pixels[i + 2];
      mouth[di + 3] = Math.round(pixels[i + 3] * ink);
      if (ink > 0.18) mask[y * w + x] = 1;
    }
  }
  // dilata un poco la máscara para tapar el trazo
  const grown = mask.slice();
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (!mask[y * w + x]) continue;
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          grown[yy * w + xx] = 1;
        }
      }
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!grown[y * w + x]) continue;
      const i = (y * w + x) * 4;
      if (pixels[i + 3] < 8) continue;
      pixels[i] = skin[0];
      pixels[i + 1] = skin[1];
      pixels[i + 2] = skin[2];
    }
  }
  blurRegion(pixels, w, h, box, grown, 3);
  return { mouth, mw, mh, box, skin };
}

function blurRegion(pixels, w, h, box, mask, radius) {
  const x0 = Math.max(0, box.x0 - radius - 2);
  const y0 = Math.max(0, box.y0 - radius - 2);
  const x1 = Math.min(w - 1, box.x1 + radius + 2);
  const y1 = Math.min(h - 1, box.y1 + radius + 2);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const copy = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y += 1) {
    const src = ((y + y0) * w + x0) * 4;
    copy.set(pixels.subarray(src, src + bw * 4), y * bw * 4);
  }
  const tmp = new Uint8ClampedArray(copy.length);
  const rad = radius;
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let k = -rad; k <= rad; k += 1) {
        const xx = Math.min(bw - 1, Math.max(0, x + k));
        const i = (y * bw + xx) * 4;
        r += copy[i];
        g += copy[i + 1];
        b += copy[i + 2];
        n += 1;
      }
      const o = (y * bw + x) * 4;
      tmp[o] = r / n;
      tmp[o + 1] = g / n;
      tmp[o + 2] = b / n;
      tmp[o + 3] = copy[o + 3];
    }
  }
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let k = -rad; k <= rad; k += 1) {
        const yy = Math.min(bh - 1, Math.max(0, y + k));
        const i = (yy * bw + x) * 4;
        r += tmp[i];
        g += tmp[i + 1];
        b += tmp[i + 2];
        n += 1;
      }
      const gx = x + x0;
      const gy = y + y0;
      if (!mask[gy * w + gx]) continue;
      const o = (gy * w + gx) * 4;
      pixels[o] = r / n;
      pixels[o + 1] = g / n;
      pixels[o + 2] = b / n;
    }
  }
}
