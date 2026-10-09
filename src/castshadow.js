/** Una sola sombra de la marioneta, teñida y mezclada sobre el fondo. */

import { clamp, finite } from './filters.js';
import { BACKGROUNDS, SHADOW_BLENDS, isHex } from './settings.js';

function channel(v) {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb) {
  if (!rgb) return 1;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function rgbToHsl(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h / 6, s, l];
}

function hue(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s <= 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(clamp(v, 0, 1) * 255));
}

/** Oscurece y satura el color medio del fondo. */
export function adaptShadow(rgb) {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const [r, g, b] = hslToRgb(h, Math.min(1, s * 1.1), clamp(l * 0.45, 0, 0.75));
  return `rgb(${r},${g},${b})`;
}

export function sampleAverage(ctx, x, y, rx, ry, canvasW, canvasH) {
  const x0 = Math.max(0, Math.floor(x - rx));
  const y0 = Math.max(0, Math.floor(y - ry));
  const x1 = Math.min(canvasW, Math.ceil(x + rx));
  const y1 = Math.min(canvasH, Math.ceil(y + ry));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return null;
  let data;
  try {
    data = ctx.getImageData(x0, y0, w, h).data;
  } catch {
    return null;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  if (!n) return null;
  return [r / n, g / n, b / n];
}

export function shadowLook(settings, sample) {
  const intensity = clamp(finite(settings?.shadowIntensity, 1), 0, 1.5);
  const auto = settings?.shadowAuto === true;
  const bg = BACKGROUNDS.find((item) => item.id === settings?.background);
  const manual = isHex(settings?.shadowColor) ? settings.shadowColor : '#2b4cc4';
  const blend = SHADOW_BLENDS.some((item) => item.id === settings?.shadowBlend) ? settings.shadowBlend : 'multiply';
  if (!auto) {
    return {
      color: manual,
      blend,
      alpha: Math.min(1, 0.7 * intensity),
      ground: 0.18 * intensity,
    };
  }
  const scale = finite(bg?.shadowAlpha, 1);
  let color = manual;
  if (typeof bg?.shadow === 'string' && bg.shadow) color = bg.shadow;
  else if (sample) color = adaptShadow(sample);
  return {
    color,
    blend: 'source-over',
    alpha: 0.22 * intensity * scale,
    ground: 0.18 * intensity * scale,
  };
}

let shade = null;

function shadeContext(w, h) {
  if (!shade) shade = document.createElement('canvas');
  if (shade.width !== w || shade.height !== h) {
    shade.width = w;
    shade.height = h;
  }
  return shade.getContext('2d');
}

/** Silueta borrosa teñida. ox/oy y blurPx están en píxeles de dispositivo. */
export function paintCastShadow(ctx, source, opts) {
  const w = source?.width || 0;
  const h = source?.height || 0;
  if (!(w > 0 && h > 0) || !(opts?.alpha > 0.001)) return;
  const g = shadeContext(w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  g.filter = `blur(${Math.max(0.5, opts.blurPx || 0)}px)`;
  g.drawImage(source, 0, 0);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = opts.color || '#2b4cc4';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opts.alpha;
  ctx.globalCompositeOperation = opts.blend || 'source-over';
  ctx.drawImage(shade, opts.ox || 0, opts.oy || 0);
  ctx.restore();
}

let ground = null;

/** Elipse de contacto en píxeles CSS. El contexto ya está escalado por dpr. */
export function paintGroundShadow(ctx, spec) {
  if (!(spec?.alpha > 0.001) || !(spec.rx > 1) || !(spec.ry > 1)) return;
  const blur = Math.max(1, spec.blur || 1);
  const pad = Math.ceil(blur * 3);
  const w = Math.max(2, Math.ceil(spec.rx * 2 + pad * 2));
  const h = Math.max(2, Math.ceil(spec.ry * 2 + pad * 2));
  if (!ground) ground = document.createElement('canvas');
  if (ground.width !== w || ground.height !== h) {
    ground.width = w;
    ground.height = h;
  }
  const g = ground.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.filter = `blur(${blur}px)`;
  g.fillStyle = spec.color || '#2b4cc4';
  g.beginPath();
  g.ellipse(w / 2, h / 2, Math.max(1, spec.rx), Math.max(1, spec.ry), 0, 0, Math.PI * 2);
  g.fill();
  g.filter = 'none';
  ctx.save();
  ctx.globalAlpha = spec.alpha;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(ground, spec.x - w / 2, spec.y - h / 2);
  ctx.restore();
}
