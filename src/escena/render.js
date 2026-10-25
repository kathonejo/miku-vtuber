/* Dibuja un cuadro de la escena en cualquier tamaño de salida. */
import { sample } from './anim.js';
import { hashSeed } from './model.js';

const TAU = Math.PI * 2;

/** Copias reducidas de cada capa (1, 1/2, 1/4…) para que la vista previa vaya fluida. */
function levelFor(layer, scale) {
  layer._levels = layer._levels || [layer.image];
  let lv = 0;
  while (lv < 5 && scale * (layer.image.width / layer.w) <= 0.5 ** (lv + 1) * 1.05) lv += 1;
  for (let k = 1; k <= lv; k += 1) {
    if (layer._levels[k]) continue;
    const prev = layer._levels[k - 1];
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(prev.width / 2));
    c.height = Math.max(1, Math.round(prev.height / 2));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(prev, 0, 0, c.width, c.height);
    layer._levels[k] = c;
  }
  return layer._levels[lv];
}

/** Resplandor de la capa (su propio dibujo desenfocado), se arma una vez. */
function glowFor(layer) {
  if (layer._glow) return layer._glow;
  const src = levelFor(layer, 160 / Math.max(layer.w, layer.h));
  const pad = Math.ceil(Math.max(src.width, src.height) * 0.35) + 4;
  const c = document.createElement('canvas');
  c.width = src.width + pad * 2;
  c.height = src.height + pad * 2;
  const g = c.getContext('2d');
  g.filter = `blur(${Math.max(2, pad / 3)}px)`;
  g.drawImage(src, pad, pad);
  g.filter = 'none';
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.6;
  g.drawImage(c, 0, 0);
  const k = layer.w / src.width;
  layer._glow = { canvas: c, x: layer.x - pad * k, y: layer.y - pad * (layer.h / src.height), w: c.width * k, h: c.height * (layer.h / src.height) };
  return layer._glow;
}

export function viewMatrix(scene, out, W, H) {
  const sx = W / scene.width;
  const sy = H / scene.height;
  const base = out.fit === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy);
  const s = base * (out.zoom || 1);
  const tx = (W - scene.width * s) / 2 + (out.panX || 0) * W;
  const ty = (H - scene.height * s) / 2 + (out.panY || 0) * H;
  return [s, 0, 0, s, tx, ty];
}

function rng(seed) {
  let s = Math.floor(seed * 2 ** 31) || 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

function particles(scene, fx) {
  const key = `${fx.density}|${scene.width}|${scene.height}`;
  if (scene._pkey === key) return scene._parts;
  const r = rng(hashSeed(scene.name || 'escena') + 0.123);
  const n = Math.round(fx.density);
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    parts.push({ x: r(), y: r(), s: 0.4 + r() * r() * 1.6, c: 1 + Math.floor(r() * 3), p: r(), rise: 0.01 + r() * 0.03, star: r() < 0.35 });
  }
  scene._pkey = key;
  scene._parts = parts;
  return parts;
}

function drawSparkles(ctx, scene, fx, t, D, view) {
  const unit = Math.max(scene.width, scene.height) / 1000;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles(scene, fx)) {
    const u = ((p.c * t) / D + p.p) % 1;
    const a = Math.sin(Math.PI * u) ** 2;
    if (a < 0.02) continue;
    const x = p.x * scene.width;
    const y = (p.y - p.rise * u) * scene.height;
    const r = p.s * unit * 3.2 * (fx.size || 1) * (0.7 + 0.3 * a);
    ctx.setTransform(view[0], 0, 0, view[3], view[4] + x * view[0], view[5] + y * view[3]);
    ctx.globalAlpha = a * 0.9;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
    g.addColorStop(0, fx.color);
    g.addColorStop(0.25, fx.color + 'aa');
    g.addColorStop(1, fx.color + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.2, 0, TAU);
    ctx.fill();
    if (p.star) {
      ctx.globalAlpha = a * 0.7;
      ctx.fillStyle = fx.color;
      ctx.beginPath();
      const L = r * 4.5, w = r * 0.35;
      ctx.moveTo(-L, 0); ctx.quadraticCurveTo(0, -w, L, 0); ctx.quadraticCurveTo(0, w, -L, 0);
      ctx.moveTo(0, -L); ctx.quadraticCurveTo(w, 0, 0, L); ctx.quadraticCurveTo(-w, 0, 0, -L);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawHalo(ctx, scene, baked, fx, t, D, view) {
  const i = fx.haloLayer;
  const layer = scene.layers[i];
  if (!layer || !baked.layers[i]) return;
  const { m } = sample(baked, i, t);
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  const x = m[0] * cx + m[2] * cy + m[4];
  const y = m[1] * cx + m[3] * cy + m[5];
  const pulse = 0.5 - 0.5 * Math.cos((TAU * 2 * t) / D);
  const R = Math.max(layer.w, layer.h) * (0.75 + 0.06 * pulse);
  ctx.save();
  ctx.setTransform(view[0], 0, 0, view[3], view[4] + x * view[0], view[5] + y * view[3]);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, fx.haloStrength * (0.75 + 0.25 * pulse));
  const g = ctx.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
  g.addColorStop(0, fx.haloColor + 'cc');
  g.addColorStop(0.5, fx.haloColor + '44');
  g.addColorStop(1, fx.haloColor + '00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Dibuja el cuadro t. `W,H` = tamaño del lienzo destino. */
export function renderFrame(ctx, scene, settings, baked, t, W, H, opts = {}) {
  const out = settings.out;
  const view = opts.view || viewMatrix(scene, out, W, H);
  const D = settings.duration;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = out.bg || '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = opts.fast ? 'low' : 'high';
  const fx = settings.effects;
  scene.layers.forEach((layer, i) => {
    const set = settings.layers[i];
    if (!set.visible || !baked.layers[i]) return;
    const { m, op, glow, drift } = sample(baked, i, t);
    if (fx.halo && fx.haloLayer === i) drawHalo(ctx, scene, baked, fx, t, D, view);
    const a = op * (layer.opacity ?? 1);
    if (a <= 0.003) return;
    const scale = Math.hypot(m[0], m[1]) * view[0];
    const img = levelFor(layer, scale);
    const M = [
      view[0] * m[0], view[0] * m[1], view[0] * m[2], view[0] * m[3],
      view[0] * m[4] + view[4], view[3] * m[5] + view[5],
    ];
    const span = scene.width + layer.w;
    const shifts = set.beh?.type === 'deriva' ? [drift * span, drift * span - span] : [0];
    for (const sh of shifts) {
      ctx.setTransform(M[0], M[1], M[2], M[3], M[4] + sh * M[0], M[5] + sh * M[1]);
      ctx.globalCompositeOperation = layer.blend || 'source-over';
      ctx.globalAlpha = a;
      ctx.drawImage(img, layer.x, layer.y, layer.w, layer.h);
      if (glow > 0.01) {
        const gl = glowFor(layer);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, glow * a);
        ctx.drawImage(gl.canvas, gl.x, gl.y, gl.w, gl.h);
      }
    }
  });
  if (fx.sparkles && fx.density > 0) drawSparkles(ctx, scene, fx, t, D, view);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return view;
}
