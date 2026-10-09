/** Píxeles → canvas, con reducción para no pasar de 2.5 px por unidad. */

export function pixelsToCanvas(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  const data = pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels);
  ctx.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  return canvas;
}

export function scaleCanvas(canvas, factor) {
  if (!canvas || factor >= 0.999) return canvas;
  const dw = Math.max(1, Math.round(canvas.width * factor));
  const dh = Math.max(1, Math.round(canvas.height * factor));
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, dw, dh);
  return out;
}

export function paintPixels(pixels, width, height, factor) {
  return scaleCanvas(pixelsToCanvas(pixels, width, height), factor);
}

/** Miniatura sobre damero, para la tabla de capas. */
export function thumbCanvas(canvas, size = 42) {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  const cell = 6;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#d7e4e2' : '#8aa8a4';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  if (!canvas) return out;
  const scale = Math.min(size / canvas.width, size / canvas.height);
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}
