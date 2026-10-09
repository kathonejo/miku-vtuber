/** Bocas y ojos cerrados generados, al estilo del rotulador del rig. */

export const MOUTH_SHAPES = {
  neutral: [14, 0.8, 3.4, 1.5],
  small: [11, 1.0, 5.0, 1.0],
  a: [15, 2.5, 13.0, 0.5],
  o: [8, 7.0, 9.0, -1.0],
  smile: [19, -1.5, 9.0, 4.0],
};

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = img;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, x: minX, y: minY };
}

function soften(canvas, radius) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  return out;
}

function curve(fn, a, b, n = 42) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const x = a + ((b - a) * i) / (n - 1);
    pts.push([x, fn(x)]);
  }
  return pts;
}

function poly(ctx, pts, ox, oy, ppu) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const x = ox + pts[i][0] * ppu;
    const y = oy + pts[i][1] * ppu;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
}

function stroke(ctx, pts, ox, oy, ppu, rand, jolt) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const x = ox + (pts[i][0] + (rand() - 0.5) * jolt) * ppu;
    const y = oy + (pts[i][1] + (rand() - 0.5) * jolt) * ppu;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

/** Dibuja una boca. El origen del diseño queda en (ox, oy) del canvas. */
export function drawMouth(shape, scale, lash, ppu) {
  const w = Math.max(0.8, shape[0] * scale);
  const top = shape[1] * scale;
  const bot = shape[2] * scale;
  const tw = shape[3] * scale;
  const pad = 8 + Math.abs(tw);
  const topExt = Math.max(4, -Math.min(0, top) + Math.abs(tw) + 6);
  const botExt = Math.max(6, Math.max(0, bot) + 14);
  const width = Math.max(8, Math.ceil((w * 2 + pad * 2) * ppu));
  const height = Math.max(8, Math.ceil((topExt + botExt) * ppu));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const ox = width / 2;
  const oy = topExt * ppu;
  const upper = curve((x) => -top * (1 - (x / w) ** 2) - (Math.abs(x) / w) ** 2 * 1.5 * tw, -w, w);
  const lower = curve((x) => bot * (1 - (x / w) ** 2) - (Math.abs(x) / w) ** 2 * 1.5 * tw, w, -w);
  poly(ctx, upper.concat(lower), ox, oy, ppu);
  ctx.closePath();
  ctx.fillStyle = '#80203a';
  ctx.fill();
  if (bot > 3.5) {
    const tg = curve((x) => bot * (1 - (x / (w * 0.75)) ** 2) * 0.95, -w * 0.7, w * 0.7);
    const back = tg.slice().reverse().map(([x]) => [x, bot * 0.22 + 0.12 * Math.abs(x)]);
    poly(ctx, tg.concat(back), ox, oy, ppu);
    ctx.closePath();
    ctx.fillStyle = '#ee7076';
    ctx.fill();
  }
  const rand = mulberry(11 + Math.round(w * 10));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(240,110,60,0.45)';
  ctx.lineWidth = Math.max(1.2, 1.15 * ppu);
  for (let k = 0; k < 3; k += 1) {
    const sh = curve((x) => bot * (1 - (x / w) ** 2) + (2.2 + k * 0.8) * scale, -w * 0.8, w * 0.8);
    stroke(ctx, sh, ox, oy, ppu, rand, 0.35);
  }
  const rgb = lash || [10, 74, 132];
  ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.85)`;
  ctx.lineWidth = Math.max(1.4, 1.5 * ppu);
  stroke(ctx, upper, ox, oy, ppu, rand, 0.4);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1, 0.9 * ppu);
  stroke(ctx, lower, ox, oy, ppu, rand, 0.35);
  ctx.globalAlpha = 1;
  const soft = soften(canvas, 0.7);
  const trimmed = trimCanvas(soft);
  if (!trimmed) return null;
  return { canvas: trimmed.canvas, ax: (ox - trimmed.x) / ppu, ay: (oy - trimmed.y) / ppu };
}

export function placeMouth(drawn, center, ppu) {
  if (!drawn) return null;
  return {
    canvas: drawn.canvas,
    x: center[0] - drawn.ax,
    y: center[1] - drawn.ay,
    w: drawn.canvas.width / ppu,
    h: drawn.canvas.height / ppu,
  };
}

/** Ojo cerrado: arco de pestañas con caída, tres pestañas y un trazo naranja. */
export function drawClosedEye(eye, lash, ppu, tailLeft) {
  const ew = Math.max(8, eye.w);
  const eh = Math.max(6, eye.h);
  const width = Math.max(8, Math.round(ew * ppu));
  const height = Math.max(8, Math.round(eh * 0.85 * ppu));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const rgb = lash || [10, 74, 132];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.82)`;
  ctx.lineWidth = Math.max(1.6, 1.7 * ppu);
  const a0 = width * (tailLeft ? 0.1 : 0.06);
  const a1 = width * (tailLeft ? 0.94 : 0.9);
  const yc = height * 0.38;
  const sag = height * 0.42;
  const rand = mulberry(tailLeft ? 3 : 9);
  for (let k = 0; k < 4; k += 1) {
    ctx.beginPath();
    for (let i = 0; i < 56; i += 1) {
      const t = i / 55;
      const x = a0 + (a1 - a0) * t;
      const y = yc + sag * 4 * t * (1 - t) * 0.55 + (k - 1.5) * (0.45 * ppu) + (rand() - 0.5) * 0.6;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(1.3, 1.25 * ppu);
  for (let j = 0; j < 3; j += 1) {
    const bx = tailLeft ? a0 + 6 + j * (10 * ppu) / 2.5 : a1 - 6 - j * (10 * ppu) / 2.5;
    const t = (bx - a0) / (a1 - a0);
    const by = yc + sag * 4 * t * (1 - t) * 0.55;
    const dx = tailLeft ? -7 * ppu / 2.2 : 7 * ppu / 2.2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + dx, by + 5 + j * 2.2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(240,110,60,0.47)';
  ctx.lineWidth = Math.max(1.2, 1.2 * ppu);
  ctx.beginPath();
  for (let i = 4; i < 36; i += 1) {
    const t = i / 39;
    const x = a0 + (a1 - a0) * t;
    const y = yc + 5 * ppu / 2 + sag * 4 * t * (1 - t) * 0.55;
    if (i === 4) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const soft = soften(canvas, 0.8);
  const trimmed = trimCanvas(soft);
  if (!trimmed) return null;
  return {
    canvas: trimmed.canvas,
    x: eye.x + (trimmed.x / ppu),
    y: eye.y + eye.h * 0.28 + trimmed.y / ppu,
    w: trimmed.canvas.width / ppu,
    h: trimmed.canvas.height / ppu,
  };
}
