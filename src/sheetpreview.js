/** Miniatura estática del manifiesto: ojos abiertos (estilo A) y boca normal. */

function paintEntry(ctx, entry) {
  const img = entry?.image;
  if (!img || !(entry.w > 0) || !(entry.h > 0)) return;
  ctx.drawImage(img, entry.x, entry.y, entry.w, entry.h);
}

function paintEye(ctx, eye) {
  const styles = eye?.styles || {};
  const style = styles.A || styles.B || Object.values(styles)[0];
  if (!style) return;
  if (style.full?.image) {
    paintEntry(ctx, style.full);
    return;
  }
  for (const key of ['white', 'iris', 'pupil', 'highlight', 'lash']) paintEntry(ctx, style[key]);
}

export function drawManifest(canvas, manifest) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width || 1;
  const h = canvas.height || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#24160f';
  ctx.fillRect(0, 0, w, h);
  const rays = ctx.createLinearGradient(0, 0, w, h);
  rays.addColorStop(0, '#f0a030');
  rays.addColorStop(1, '#e23b2f');
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = rays;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  if (!manifest) return;
  const b = manifest.bounds || { x0: 40, y0: 20, x1: 560, y1: 580 };
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const scale = Math.min((w * 0.92) / bw, (h * 0.92) / bh);
  const ox = w / 2 - ((b.x0 + b.x1) / 2) * scale;
  const oy = h / 2 - ((b.y0 + b.y1) / 2) * scale;
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const part of manifest.parts || []) {
    if (!part || part.rig?.visible === false) continue;
    if (part.role === 'mouth' || part.id === 'mouth') {
      paintEntry(ctx, manifest.mouths?.neutral || manifest.mouths?.smile);
      continue;
    }
    if (part.role === 'eye') {
      const side = String(part.id).includes('eye_r') ? 'r' : 'l';
      paintEye(ctx, manifest.eyes?.[side]);
      continue;
    }
    paintEntry(ctx, part);
  }
}

export function manifestThumb(manifest, width = 160, height = 200) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawManifest(canvas, manifest);
  return canvas.toDataURL('image/jpeg', 0.82);
}
