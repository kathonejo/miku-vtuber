/** Ojos A/B y parpadeo abierto↔cerrado. Sin fotograma intermedio. */

import { clamp } from './filters.js';

const LAYERS = ['full', 'white', 'iris', 'pupil', 'highlight', 'lash'];

function sideKey(side) {
  const id = String(side || '');
  if (id === 'r' || id === 'eye_r' || id.endsWith('_r')) return 'r';
  return 'l';
}

function box(src) {
  if (!src || typeof src.file !== 'string' || !src.file) return null;
  const w = +src.w;
  const h = +src.h;
  if (!(w > 0 && h > 0)) return null;
  return { file: src.file, x: +src.x || 0, y: +src.y || 0, w, h };
}

export function stepEyeOpen(current, blink) {
  const b = clamp(+blink || 0, 0, 1);
  const closed = current === 'closed';
  if (!closed && b > 0.6) return 'closed';
  if (closed && b < 0.4) return 'open';
  return closed ? 'closed' : 'open';
}

export function resolveStyle(manifest, side, styleId) {
  const eye = manifest?.eyes?.[sideKey(side)] || null;
  const styles = eye?.styles || {};
  const id = styleId === 'B' ? 'B' : 'A';
  const style = styles[id] || styles.A || styles.B || null;
  return { eye, style };
}

export function collectEyeFiles(manifest, add) {
  const eyes = manifest?.eyes;
  if (!eyes || typeof add !== 'function') return;
  for (const key of ['l', 'r']) {
    const eye = eyes[key];
    if (!eye) continue;
    add(eye.closed?.file);
    for (const style of Object.values(eye.styles || {})) {
      if (!style) continue;
      for (const name of LAYERS) add(style[name]?.file);
    }
  }
}

function blit(ctx, getImage, entry, ox, oy) {
  const img = entry && getImage(entry.file);
  if (!img || !(entry.w > 0)) return;
  const w = img.naturalWidth || img.width || 0;
  if (!w) return;
  ctx.drawImage(img, entry.x + ox, entry.y + oy, entry.w, entry.h);
}

function paintLayers(ctx, scratch, style, gazeX, gazeY, getImage) {
  const white = box(style.white);
  if (!white) return false;
  const bits = [white, box(style.iris), box(style.pupil), box(style.highlight), box(style.lash)].filter(Boolean);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bits) {
    x0 = Math.min(x0, b.x - 8);
    y0 = Math.min(y0, b.y - 8);
    x1 = Math.max(x1, b.x + b.w + 8);
    y1 = Math.max(y1, b.y + b.h + 8);
  }
  const ppu = 2;
  const cw = Math.max(1, Math.ceil((x1 - x0) * ppu));
  const ch = Math.max(1, Math.ceil((y1 - y0) * ppu));
  if (!scratch.c || scratch.c.width !== cw || scratch.c.height !== ch) {
    scratch.c = document.createElement('canvas');
    scratch.c.width = cw;
    scratch.c.height = ch;
    scratch.g = scratch.c.getContext('2d');
  }
  const g = scratch.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.setTransform(ppu, 0, 0, ppu, -x0 * ppu, -y0 * ppu);
  g.globalCompositeOperation = 'source-over';
  blit(g, getImage, white, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  blit(g, getImage, box(style.iris), gazeX * 4, gazeY * 2.5);
  blit(g, getImage, box(style.pupil), gazeX * 4.5, gazeY * 3);
  g.globalCompositeOperation = 'source-over';
  blit(g, getImage, box(style.highlight), gazeX * 2, gazeY * 2);
  blit(g, getImage, box(style.lash), 0, 0);
  ctx.drawImage(scratch.c, x0, y0, x1 - x0, y1 - y0);
  return true;
}

function paintSprite(ctx, getImage, entry, gazeX, gazeY, shift) {
  const b = box(entry);
  if (!b) return;
  ctx.save();
  if (shift) ctx.translate(gazeX * 3, gazeY * 2);
  blit(ctx, getImage, b, 0, 0);
  ctx.restore();
}

export function createEyePainter() {
  const scratch = { c: null, g: null };
  function paintFrame(ctx, opt, closed) {
    const { eye, style } = resolveStyle(opt.manifest, opt.side, opt.styleId);
    const getImage = opt.getImage || (() => null);
    if (closed) {
      paintSprite(ctx, getImage, eye?.closed, opt.gazeX, opt.gazeY, true);
      return;
    }
    if (style?.white && paintLayers(ctx, scratch, style, opt.gazeX || 0, opt.gazeY || 0, getImage)) return;
    paintSprite(ctx, getImage, style?.full, opt.gazeX, opt.gazeY, true);
  }
  return {
    paint(ctx, opt) {
      if (!ctx || !opt) return;
      const fade = clamp(+opt.fade || 0, 0, 1);
      const showPrev = opt.prevClosed !== opt.closed && fade < 0.999;
      if (showPrev) {
        ctx.save();
        ctx.globalAlpha *= 1 - fade;
        paintFrame(ctx, opt, Boolean(opt.prevClosed));
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha *= showPrev ? fade : 1;
      paintFrame(ctx, opt, Boolean(opt.closed));
      ctx.restore();
    },
  };
}
