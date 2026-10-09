import { clamp, themeFrom, withAlpha } from './settings.js';
import {
  RIG,
  drawOutfitHeadBack,
  drawOutfitHeadFront,
  drawOutfitTorso,
  drawOutfitArm,
  drawOutfitHand,
} from './outfits.js';

const VW = 900;
const VH = 1220;
const CX = 450;
const HEAD_BASE = 402;
const SHOULDER_Y = 628;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function blinkCurve(p) {
  if (p < 0.06) return p / 0.06;
  if (p < 0.11) return 1;
  if (p < 0.2) return 1 - (p - 0.11) / 0.09;
  return 0;
}

function traceFace(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -136);
  ctx.bezierCurveTo(86, -140, 128, -96, 126, -18);
  ctx.bezierCurveTo(124, 48, 96, 112, 54, 142);
  ctx.bezierCurveTo(32, 158, 14, 164, 0, 166);
  ctx.bezierCurveTo(-14, 164, -32, 158, -54, 142);
  ctx.bezierCurveTo(-96, 112, -124, 48, -126, -18);
  ctx.bezierCurveTo(-128, -96, -86, -140, 0, -136);
  ctx.closePath();
}

function paintLimb(ctx, len, w0, w1, colors) {
  ctx.beginPath();
  ctx.moveTo(-w0, 0);
  ctx.lineTo(-w1, len);
  ctx.quadraticCurveTo(0, len + w1 * 0.45, w1, len);
  ctx.lineTo(w0, 0);
  ctx.quadraticCurveTo(0, -w0 * 0.28, -w0, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(-w0, 0, w0, len);
  g.addColorStop(0, colors.skinShadow);
  g.addColorStop(0.42, colors.skin);
  g.addColorStop(1, colors.skinLight);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = withAlpha(colors.skinDeep, 0.55);
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawHand(ctx, colors, side) {
  const td = side === 'L' ? 1 : -1;
  ctx.save();
  ctx.fillStyle = colors.skin;
  ctx.strokeStyle = withAlpha(colors.skinDeep, 0.8);
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  const xs = [-12, -3, 6];
  for (let i = 0; i < xs.length; i++) {
    const len = 22 - Math.abs(i - 1) * 2;
    ctx.beginPath();
    ctx.roundRect(xs[i], 22, 10, len, 5);
    ctx.fill();
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(-16, 0, 16, 36);
  g.addColorStop(0, colors.skinLight);
  g.addColorStop(1, colors.skin);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-16, 2);
  ctx.bezierCurveTo(-22, 18, -16, 34, -6, 38);
  ctx.lineTo(12, 36);
  ctx.bezierCurveTo(20, 28, 18, 12, 13, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.skin;
  ctx.beginPath();
  ctx.ellipse(td * 15, 18, 8, 12, td * 0.65, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBackHair(ctx, colors, style, time, sway) {
  const cap = ctx.createLinearGradient(0, -180, 0, 220);
  cap.addColorStop(0, colors.hairLight);
  cap.addColorStop(0.4, colors.hair);
  cap.addColorStop(1, colors.hairDark);
  ctx.fillStyle = cap;
  ctx.strokeStyle = colors.hairLine;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -180);
  ctx.bezierCurveTo(128, -186, 176, -96, 158, 0);
  ctx.bezierCurveTo(146, 62, 96, 108, 48, 96);
  ctx.quadraticCurveTo(0, 118, -48, 96);
  ctx.bezierCurveTo(-96, 108, -146, 62, -158, 0);
  ctx.bezierCurveTo(-176, -96, -128, -186, 0, -180);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (style === 'ponytail') drawPonytail(ctx, colors, time, sway);
  else {
    const scale = style === 'short' ? 0.46 : 1;
    drawTail(ctx, -1, colors, time, sway, scale);
    drawTail(ctx, 1, colors, time, sway, scale);
  }
}

function hairStroke(ctx, colors, x0, y0, c1x, c1y, c2x, c2y, x3, y3, width) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = colors.hairLine;
  ctx.lineWidth = width + 12;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x3, y3);
  ctx.stroke();
  const grad = ctx.createLinearGradient(x0, y0, x3, y3);
  grad.addColorStop(0, colors.hairLight);
  grad.addColorStop(0.35, colors.hair);
  grad.addColorStop(1, colors.hairDark);
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x3, y3);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#ffffff', 0.32);
  ctx.lineWidth = Math.max(5, width * 0.12);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + 24);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y + 10, x3, y3 - 16);
  ctx.stroke();
}

function drawTail(ctx, side, colors, time, sway, lenScale) {
  const s = side;
  const wave = Math.sin(time * 1.45 + s) * 12 + sway * 22;
  const yEnd = 70 + 500 * lenScale;
  const x0 = s * 112;
  const y0 = 6;
  const c1x = s * 188 + wave * 0.25;
  const c1y = 90 + 80 * lenScale;
  const c2x = s * 150 + wave;
  const c2y = 180 + 180 * lenScale;
  const x3 = s * 124 + wave * 1.2;
  const y3 = yEnd;
  hairStroke(ctx, colors, x0, y0, c1x, c1y, c2x, c2y, x3, y3, 68);
}

function drawPonytail(ctx, colors, time, sway) {
  const wave = Math.sin(time * 1.35) * 14 + sway * 26;
  hairStroke(ctx, colors, 0, -158, 30 + wave * 0.2, 40, 55 + wave, 220, 36 + wave * 1.1, 520, 62);
}

function drawTies(ctx, style, colors) {
  if (style === 'ponytail') {
    drawRibbon(ctx, 6, -150, 0.2, colors);
    return;
  }
  const y = style === 'short' ? 8 : 28;
  drawRibbon(ctx, -116, y, -0.5, colors);
  drawRibbon(ctx, 116, y, 0.5, colors);
}

function drawRibbon(ctx, x, y, rot, colors) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = colors.accent;
  ctx.strokeStyle = colors.accentDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-20, 0, 18, 11, -0.45, 0, Math.PI * 2);
  ctx.ellipse(20, 0, 18, 11, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.accentDark;
  ctx.beginPath();
  ctx.roundRect(-14, -9, 28, 18, 7);
  ctx.fill();
  ctx.fillStyle = colors.accentLight;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(-5, 8);
  ctx.lineTo(-16, 40);
  ctx.lineTo(-2, 34);
  ctx.lineTo(0, 12);
  ctx.closePath();
  ctx.moveTo(5, 8);
  ctx.lineTo(18, 38);
  ctx.lineTo(3, 32);
  ctx.lineTo(0, 12);
  ctx.fill();
  ctx.restore();
}

function drawBangs(ctx, colors) {
  const g = ctx.createLinearGradient(0, -170, 0, -20);
  g.addColorStop(0, colors.hairLight);
  g.addColorStop(0.55, colors.hair);
  g.addColorStop(1, colors.hairDark);
  ctx.fillStyle = g;
  ctx.strokeStyle = colors.hairLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-130, -62);
  ctx.bezierCurveTo(-102, -178, 102, -178, 130, -62);
  ctx.bezierCurveTo(104, -48, 78, -72, 52, -54);
  ctx.bezierCurveTo(28, -42, -28, -42, -52, -54);
  ctx.bezierCurveTo(-78, -72, -104, -48, -130, -62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = withAlpha('#ffffff', 0.38);
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-46, -112);
  ctx.quadraticCurveTo(-24, -78, -38, -42);
  ctx.stroke();

  ctx.strokeStyle = colors.hair;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(6, -162);
  ctx.quadraticCurveTo(18, -188, 10, -206);
  ctx.stroke();
  ctx.strokeStyle = colors.hairLine;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawSideLock(ctx, side, colors, style) {
  const s = side;
  const len = style === 'ponytail' ? 200 : 250;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.hairLine;
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(s * 108, -10);
  ctx.quadraticCurveTo(s * 156, 90, s * 122, len);
  ctx.stroke();
  ctx.strokeStyle = colors.hair;
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(s * 108, -10);
  ctx.quadraticCurveTo(s * 156, 90, s * 122, len);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#ffffff', 0.22);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(s * 100, 10);
  ctx.quadraticCurveTo(s * 140, 90, s * 116, len - 16);
  ctx.stroke();
}

function drawEye(ctx, x, y, spec, colors) {
  const blink = clamp(spec.blink, 0, 1);
  const gx = clamp(spec.gx, -1.2, 1.2);
  const gy = clamp(spec.gy, -1.2, 1.2);
  const flip = spec.flip ? -1 : 1;
  const ew = 58;
  const eh = 36;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);

  const almond = () => {
    ctx.beginPath();
    ctx.moveTo(-ew, 1);
    ctx.bezierCurveTo(-ew * 0.45, -eh * 1.28, ew * 0.28, -eh * 1.32, ew * 0.96, -1);
    ctx.bezierCurveTo(ew * 0.55, eh * 0.95, -ew * 0.15, eh * 0.98, -ew, 1);
    ctx.closePath();
  };

  const lidY = lerp(-eh * 1.2, eh * 0.22, blink);
  ctx.save();
  almond();
  ctx.clip();
  ctx.beginPath();
  ctx.rect(-160, lidY, 320, 220);
  ctx.clip();

  ctx.fillStyle = '#fbfcff';
  ctx.fillRect(-160, -120, 320, 240);
  const sg = ctx.createRadialGradient(16, 10, 4, 0, 4, 48);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(1, 'rgba(214, 176, 186, 0.35)');
  ctx.fillStyle = sg;
  ctx.fillRect(-160, -120, 320, 240);

  const ix = gx * flip * 14;
  const iy = -gy * 10 + 2;
  const iR = 22;
  const ig = ctx.createRadialGradient(ix - 6, iy - 7, 2, ix, iy, iR);
  ig.addColorStop(0, colors.eyeLight);
  ig.addColorStop(0.5, colors.eye);
  ig.addColorStop(1, colors.eyeDark);
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(ix, iy, iR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(colors.eyeDark, 0.85);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#17151c';
  ctx.beginPath();
  ctx.ellipse(ix, iy + 1, 9, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(ix - 7, iy - 8, 5, 7, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix + 7, iy + 5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (blink > 0.03) {
    ctx.save();
    almond();
    ctx.clip();
    ctx.fillStyle = colors.skin;
    ctx.fillRect(-160, -140, 320, lidY + 140);
    ctx.strokeStyle = withAlpha(colors.skinDeep, 0.4);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-ew + 8, lidY);
    ctx.quadraticCurveTo(8, lidY - 5, ew - 6, lidY + 1);
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = '#2c2632';
  ctx.lineWidth = 3.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (blink < 0.22) {
    ctx.moveTo(-ew, 1);
    ctx.bezierCurveTo(-ew * 0.45, -eh * 1.28, ew * 0.28, -eh * 1.32, ew * 0.96, -1);
  } else {
    ctx.moveTo(-ew + 6, lidY);
    ctx.quadraticCurveTo(8, lidY - 2, ew - 4, lidY + 1);
  }
  ctx.stroke();

  if (blink < 0.55) {
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const t = 0.18 + i * 0.2;
      const px = lerp(-ew * 0.7, ew * 0.85, t);
      const py = -Math.sin(t * Math.PI) * eh * (1 - blink);
      ctx.beginPath();
      ctx.moveTo(px, py + 1);
      ctx.lineTo(px + 5, py - 8);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(44,38,50,0.5)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-ew + 12, 4);
  ctx.bezierCurveTo(-8, eh * 0.82, ew * 0.4, eh * 0.7, ew * 0.8, 2);
  ctx.stroke();
  ctx.restore();
}

function drawBrow(ctx, side, browIn, browDown, color) {
  const raise = browIn * 14 - browDown * 12;
  ctx.save();
  ctx.translate(side * 56, -70 - raise);
  ctx.scale(side, 1);
  ctx.rotate(-0.12 - browDown * 0.18);
  ctx.strokeStyle = color;
  ctx.lineWidth = 7.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4, 5);
  ctx.quadraticCurveTo(30, -14, 54, browDown * 4);
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#ffffff', 0.28);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(10, 3);
  ctx.quadraticCurveTo(30, -10, 48, 0);
  ctx.stroke();
  ctx.restore();
}

function drawMouth(ctx, jaw, pucker, smileL, smileR, colors) {
  const open = clamp(jaw, 0, 1);
  const puck = clamp(pucker, 0, 1);
  const sL = clamp(smileL, 0, 1);
  const sR = clamp(smileR, 0, 1);
  const smile = (sL + sR) / 2;
  const w = (40 + smile * 14) * (1 - puck * 0.42);
  const h = 6 + open * 34 * (1 - puck * 0.25) + puck * 14;
  const liftL = sL * 14;
  const liftR = sR * 14;

  ctx.save();
  ctx.translate(0, 70);
  ctx.fillStyle = colors.lip;
  ctx.beginPath();
  ctx.moveTo(-w, -2 - liftL * 0.15);
  ctx.quadraticCurveTo(-w * 0.4, -10 - smile * 6, 0, -13 - puck * 3);
  ctx.quadraticCurveTo(w * 0.4, -10 - smile * 6, w, -2 - liftR * 0.15);
  ctx.quadraticCurveTo(w * 0.55, 4, 0, 6);
  ctx.quadraticCurveTo(-w * 0.55, 4, -w, -2 - liftL * 0.15);
  ctx.fill();

  if (open > 0.08 || puck > 0.4) {
    const mw = w * (0.62 + puck * 0.12);
    const mh = Math.max(7, h * 0.62);
    ctx.beginPath();
    ctx.ellipse(0, 5, mw, mh * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#431824';
    ctx.fill();
    ctx.strokeStyle = colors.lipDeep;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (open > 0.16 && puck < 0.72) {
      ctx.fillStyle = '#fff7f5';
      ctx.beginPath();
      ctx.ellipse(0, 2, mw * 0.72, Math.min(7, 3 + open * 8), 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    if (open > 0.25) {
      ctx.fillStyle = '#ee8b98';
      ctx.beginPath();
      ctx.ellipse(0, 6 + mh * 0.15, mw * 0.55, mh * 0.28, 0, 0, Math.PI);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = colors.lipDeep;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.95, -liftL * 0.25);
    ctx.quadraticCurveTo(0, 10 + smile * 16, w * 0.95, -liftR * 0.25);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(colors.lip, 0.9);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.7, -6 - smile * 2);
    ctx.quadraticCurveTo(0, -12 - smile * 4, w * 0.7, -6 - smile * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStar(ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const b = a + Math.PI / 5;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    const qx = Math.cos(b) * r * 0.42;
    const qy = Math.sin(b) * r * 0.42;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    ctx.lineTo(qx, qy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAccessories(ctx, settings, colors) {
  const a = settings.accessories;
  if (a.blush) {
    ctx.save();
    ctx.fillStyle = withAlpha(colors.blush, 0.45);
    ctx.beginPath();
    ctx.ellipse(-74, 48, 30, 14, -0.25, 0, Math.PI * 2);
    ctx.ellipse(74, 48, 30, 14, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(colors.blush, 0.7);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const sx of [-74, 74]) {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * 8 - 6, 46);
        ctx.lineTo(sx + i * 8 + 6, 50);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  if (a.beautyMark) drawStar(ctx, 66, 52, 7, shadeSafe(colors.skinDeep));
  if (a.catEars) drawCatEars(ctx, colors);
  if (a.tiara) drawTiara(ctx, colors);
  if (a.glasses) drawGlasses(ctx, colors);
  if (a.headset) drawHeadset(ctx, colors);
}

function shadeSafe(hex) {
  return hex;
}

function drawCatEars(ctx, colors) {
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 78, -148);
    ctx.rotate(s * -0.18);
    ctx.fillStyle = colors.hair;
    ctx.strokeStyle = colors.hairLine;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-22, 26);
    ctx.lineTo(0, -36);
    ctx.lineTo(24, 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb4c8';
    ctx.beginPath();
    ctx.moveTo(-10, 20);
    ctx.lineTo(0, -14);
    ctx.lineTo(12, 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawTiara(ctx, colors) {
  ctx.save();
  ctx.translate(0, -146);
  const g = ctx.createLinearGradient(-54, 0, 54, 0);
  g.addColorStop(0, colors.accentDark);
  g.addColorStop(0.5, '#fff6d4');
  g.addColorStop(1, colors.accentDark);
  ctx.fillStyle = g;
  ctx.strokeStyle = colors.accentDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-54, 18);
  ctx.lineTo(-34, -4);
  ctx.lineTo(-16, 14);
  ctx.lineTo(0, -24);
  ctx.lineTo(16, 14);
  ctx.lineTo(34, -4);
  ctx.lineTo(54, 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.arc(0, -2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGlasses(ctx, colors) {
  ctx.save();
  ctx.strokeStyle = 'rgba(28, 32, 38, 0.92)';
  ctx.lineWidth = 5;
  ctx.fillStyle = withAlpha(colors.eyeLight, 0.16);
  for (const x of [-50, 50]) {
    ctx.beginPath();
    ctx.roundRect(x - 38, -30, 76, 58, 20);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-12, -4);
  ctx.quadraticCurveTo(0, -14, 12, -4);
  ctx.moveTo(-88, -6);
  ctx.lineTo(-124, -22);
  ctx.moveTo(88, -6);
  ctx.lineTo(124, -22);
  ctx.stroke();
  ctx.restore();
}

function drawHeadset(ctx, colors) {
  ctx.save();
  ctx.strokeStyle = '#2a2e33';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, -8, 136, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  for (const x of [-114, 114]) {
    ctx.fillStyle = '#2c3136';
    ctx.beginPath();
    ctx.ellipse(x, 10, 22, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = colors.accentDark;
    ctx.beginPath();
    ctx.ellipse(x, 10, 10, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3a4046';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-102, 30);
  ctx.quadraticCurveTo(-68, 74, -18, 80);
  ctx.stroke();
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.arc(-16, 80, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintBackground(ctx, w, h, settings, time, exporting) {
  const mode = settings.background;
  if (mode === 'transparent') {
    if (exporting) return;
    const s = 18;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        const odd = ((x / s) | 0) + ((y / s) | 0);
        ctx.fillStyle = odd % 2 ? '#2a3338' : '#1b2226';
        ctx.fillRect(x, y, s, s);
      }
    }
    return;
  }
  if (mode === 'green') {
    ctx.fillStyle = '#00FF00';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (mode === 'blue') {
    ctx.fillStyle = '#0000FF';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (mode === 'custom') {
    ctx.fillStyle = settings.bgColor || '#141a22';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (mode === 'studio') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a3c44');
    g.addColorStop(1, '#0d1418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (mode === 'sunset') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a1458');
    g.addColorStop(0.5, '#c4556e');
    g.addColorStop(1, '#f2b56b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (mode === 'stars') {
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = hash(i) * w;
      const y = hash(i + 19) * h * 0.92;
      const r = 0.5 + hash(i + 41) * 1.7;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2 + i));
      ctx.fillStyle = `rgba(255,255,255,${tw})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (mode === 'room') {
    const wall = ctx.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, '#2c3548');
    wall.addColorStop(0.7, '#3c4a62');
    wall.addColorStop(0.7, '#6d5342');
    wall.addColorStop(1, '#4a382c');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    const wx = w * 0.58;
    const wy = h * 0.1;
    const ww = w * 0.3;
    const wh = h * 0.34;
    const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, '#8fd4ff');
    sky.addColorStop(1, '#e7f6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = '#e7eef8';
    ctx.lineWidth = Math.max(6, w * 0.008);
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy);
    ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.moveTo(wx, wy + wh / 2);
    ctx.lineTo(wx + ww, wy + wh / 2);
    ctx.stroke();
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#140816');
  g.addColorStop(0.5, '#1b1030');
  g.addColorStop(1, '#090b10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const lights = [
    { x: w * 0.22, c0: 'rgba(62,207,196,0.45)' },
    { x: w * 0.5, c0: 'rgba(255,255,255,0.18)' },
    { x: w * 0.78, c0: 'rgba(255,110,180,0.36)' },
  ];
  for (const L of lights) {
    const lx = L.x + Math.sin(time * 0.65 + L.x) * 24;
    const rg = ctx.createRadialGradient(lx, 0, 8, lx, h * 0.2, h * 0.85);
    rg.addColorStop(0, L.c0);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawArm(ctx, side, upper, fore, colors, outfit) {
  const x = (side === 'L' ? -1 : 1) * RIG.shoulderHalf;
  ctx.save();
  ctx.translate(x, RIG.shoulderDrop);
  ctx.rotate(upper);
  if (outfit === 'clasico') {
    ctx.fillStyle = colors.skin;
    ctx.beginPath();
    ctx.arc(0, 8, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  paintLimb(ctx, RIG.upperLen, 30, 23, colors);
  drawOutfitArm(ctx, outfit, colors, 'upper', RIG.upperLen, side);
  ctx.translate(0, RIG.upperLen);
  ctx.rotate(fore);
  paintLimb(ctx, RIG.foreLen, 22, 16, colors);
  drawOutfitArm(ctx, outfit, colors, 'fore', RIG.foreLen, side);
  ctx.translate(0, RIG.foreLen - 4);
  if (!drawOutfitHand(ctx, outfit, colors, side)) drawHand(ctx, colors, side);
  ctx.restore();
}

function drawNeck(ctx, colors) {
  const g = ctx.createLinearGradient(0, -120, 0, 24);
  g.addColorStop(0, colors.skinShadow);
  g.addColorStop(0.4, colors.skin);
  g.addColorStop(1, colors.skinShadow);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-26, -118);
  ctx.lineTo(26, -118);
  ctx.lineTo(40, 18);
  ctx.lineTo(-40, 18);
  ctx.closePath();
  ctx.fill();
}

export function createAvatar(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const state = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    blinkL: 0,
    blinkR: 0,
    gazeLX: 0,
    gazeLY: 0,
    gazeRX: 0,
    gazeRY: 0,
    jaw: 0,
    pucker: 0,
    smileL: 0.12,
    smileR: 0.12,
    browIn: 0,
    browDL: 0,
    browDR: 0,
    armLU: 0.28,
    armLF: 0.42,
    armRU: -0.28,
    armRF: -0.42,
    hairSway: 0,
    time: 0,
    blinkClock: 1.6,
    blinkHold: 0,
  };
  let cssW = 2;
  let cssH = 2;
  let dpr = 1;
  let exporting = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cssW = Math.max(2, rect.width);
    cssH = Math.max(2, rect.height);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function update(dt, targets, settings) {
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0.016;
    state.time += step;
    const sens = settings.sensitivity;
    const smooth = clamp(settings.smoothing, 0, 1);
    const k = 3.2 + (1 - smooth) * 22;
    const a = 1 - Math.exp(-k * step);
    const aFast = 1 - Math.exp(-k * 2.3 * step);

    let blinkL = clamp(targets.blinkL * sens.blink, 0, 1);
    let blinkR = clamp(targets.blinkR * sens.blink, 0, 1);
    if (targets.mode !== 'track') {
      state.blinkClock -= step;
      if (state.blinkClock <= 0 && state.blinkHold <= 0) {
        state.blinkHold = 0.2;
        state.blinkClock = 2.3 + Math.random() * 3.4;
      }
      let auto = 0;
      if (state.blinkHold > 0) {
        const p = 0.2 - state.blinkHold;
        auto = blinkCurve(p);
        state.blinkHold -= step;
      }
      blinkL = auto;
      blinkR = auto;
    }

    state.yaw = lerp(state.yaw, clamp(targets.yaw, -1.05, 1.05), a);
    state.pitch = lerp(state.pitch, clamp(targets.pitch, -0.85, 0.85), a);
    state.roll = lerpAngle(state.roll, clamp(targets.roll, -0.8, 0.8), a);
    state.blinkL = lerp(state.blinkL, blinkL, aFast);
    state.blinkR = lerp(state.blinkR, blinkR, aFast);
    const gazeGain = 1.7;
    state.gazeLX = lerp(state.gazeLX, clamp(targets.gazeLX * gazeGain, -1.25, 1.25), aFast);
    state.gazeLY = lerp(state.gazeLY, clamp(targets.gazeLY * gazeGain, -1.25, 1.25), aFast);
    state.gazeRX = lerp(state.gazeRX, clamp(targets.gazeRX * gazeGain, -1.25, 1.25), aFast);
    state.gazeRY = lerp(state.gazeRY, clamp(targets.gazeRY * gazeGain, -1.25, 1.25), aFast);
    state.jaw = lerp(state.jaw, clamp(targets.jaw * sens.mouth, 0, 1), aFast);
    state.pucker = lerp(state.pucker, clamp(targets.pucker * sens.mouth, 0, 1), aFast);
    state.smileL = lerp(state.smileL, clamp(targets.smileL * sens.mouth, 0, 1), a);
    state.smileR = lerp(state.smileR, clamp(targets.smileR * sens.mouth, 0, 1), a);
    state.browIn = lerp(state.browIn, clamp(targets.browIn, 0, 1), a);
    state.browDL = lerp(state.browDL, clamp(targets.browDL, 0, 1), a);
    state.browDR = lerp(state.browDR, clamp(targets.browDR, 0, 1), a);

    const armK = sens.arms;
    const restLU = 0.28;
    const restLF = 0.42;
    const restRU = -0.28;
    const restRF = -0.42;
    const tLU = targets.armLOk ? restLU + (targets.armLU - restLU) * armK : restLU;
    const tLF = targets.armLOk ? restLF + (targets.armLF - restLF) * armK : restLF;
    const tRU = targets.armROk ? restRU + (targets.armRU - restRU) * armK : restRU;
    const tRF = targets.armROk ? restRF + (targets.armRF - restRF) * armK : restRF;
    state.armLU = lerpAngle(state.armLU, clamp(tLU, -2.8, 2.8), a);
    state.armLF = lerpAngle(state.armLF, clamp(tLF, -2.4, 2.4), a);
    state.armRU = lerpAngle(state.armRU, clamp(tRU, -2.8, 2.8), a);
    state.armRF = lerpAngle(state.armRF, clamp(tRF, -2.4, 2.4), a);
    state.hairSway = lerp(state.hairSway, state.yaw, 1 - Math.exp(-2.4 * step));
  }

  function draw(options = {}) {
    exporting = Boolean(options.exportAlpha);
    resize();
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const settings = options.settings;
    if (!settings) return;
    const plain = exporting && settings.background === 'transparent';
    if (!plain) paintBackground(ctx, cssW, cssH, settings, state.time, exporting);

    const scale = Math.min(cssW / VW, cssH / VH);
    const ox = (cssW - VW * scale) / 2;
    const oy = (cssH - VH * scale) / 2;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    paintCharacter(ctx, settings, plain);
    exporting = false;
  }

  function paintCharacter(ctx2, settings, plain) {
    const colors = themeFrom(settings);
    const time = state.time;
    const chroma = settings.background === 'green' || settings.background === 'blue' || settings.background === 'transparent';
    if (!plain && !chroma) {
      ctx2.save();
      ctx2.fillStyle = 'rgba(0,0,0,0.28)';
      ctx2.beginPath();
      ctx2.ellipse(CX, 1145, 180, 22, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.restore();
    }

    const headX = CX + state.yaw * 46;
    const headY = HEAD_BASE - state.pitch * 28 + Math.sin(time * 1.8) * 2.2;
    const sway = state.yaw - state.hairSway;

    const withHead = (fn) => {
      ctx2.save();
      ctx2.translate(headX, headY);
      ctx2.rotate(state.roll);
      ctx2.translate(state.yaw * 10, 0);
      ctx2.scale(1 - Math.min(0.14, Math.abs(state.yaw) * 0.16), 1 + Math.abs(state.pitch) * 0.03);
      fn();
      ctx2.restore();
    };

    withHead(() => {
      drawOutfitHeadBack(ctx2, settings.outfit, colors);
      drawBackHair(ctx2, colors, settings.hairstyle, time, sway);
    });

    const breath = Math.sin(time * 1.75);
    const bodyRot = state.yaw * 0.11 + Math.sin(time * 0.8) * 0.012;
    const pivotY = SHOULDER_Y + 250;
    ctx2.save();
    ctx2.translate(CX, pivotY);
    ctx2.rotate(bodyRot);
    ctx2.scale(1 + breath * 0.008, 1 + breath * 0.016);
    ctx2.translate(-CX, -pivotY);
    ctx2.translate(CX, SHOULDER_Y);

    const frontL = Math.abs(state.armLU) > 1.05;
    const frontR = Math.abs(state.armRU) > 1.05;
    if (!frontL) drawArm(ctx2, 'L', state.armLU - bodyRot, state.armLF, colors, settings.outfit);
    if (!frontR) drawArm(ctx2, 'R', state.armRU - bodyRot, state.armRF, colors, settings.outfit);
    drawNeck(ctx2, colors);
    drawOutfitTorso(ctx2, settings.outfit, colors, time);
    if (frontL) drawArm(ctx2, 'L', state.armLU - bodyRot, state.armLF, colors, settings.outfit);
    if (frontR) drawArm(ctx2, 'R', state.armRU - bodyRot, state.armRF, colors, settings.outfit);
    ctx2.restore();

    withHead(() => {
      ctx2.fillStyle = colors.skinShadow;
      ctx2.beginPath();
      ctx2.ellipse(-116, 8, 18, 28, -0.2, 0, Math.PI * 2);
      ctx2.ellipse(116, 8, 18, 28, 0.2, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.fillStyle = colors.skin;
      ctx2.beginPath();
      ctx2.ellipse(-112, 6, 16, 26, -0.15, 0, Math.PI * 2);
      ctx2.ellipse(112, 6, 16, 26, 0.15, 0, Math.PI * 2);
      ctx2.fill();

      const fg = ctx2.createRadialGradient(-30, -50, 20, 10, 20, 180);
      fg.addColorStop(0, colors.skinLight);
      fg.addColorStop(0.55, colors.skin);
      fg.addColorStop(1, colors.skinShadow);
      traceFace(ctx2);
      ctx2.fillStyle = fg;
      ctx2.fill();
      ctx2.strokeStyle = withAlpha(colors.skinDeep, 0.45);
      ctx2.lineWidth = 3;
      ctx2.stroke();

      ctx2.save();
      ctx2.translate(state.yaw * 16, state.pitch * -6);
      drawEye(ctx2, -56, -4, { blink: state.blinkL, gx: state.gazeLX, gy: state.gazeLY, flip: true }, colors);
      drawEye(ctx2, 56, -4, { blink: state.blinkR, gx: state.gazeRX, gy: state.gazeRY, flip: false }, colors);

      ctx2.strokeStyle = withAlpha(colors.skinDeep, 0.35);
      ctx2.lineWidth = 3;
      ctx2.lineCap = 'round';
      ctx2.beginPath();
      ctx2.moveTo(2, 28);
      ctx2.quadraticCurveTo(12, 40, 2, 48);
      ctx2.stroke();

      drawMouth(ctx2, state.jaw, state.pucker, state.smileL, state.smileR, colors);
      drawBangs(ctx2, colors);
      drawBrow(ctx2, -1, state.browIn, state.browDL, colors.hairDark);
      drawBrow(ctx2, 1, state.browIn, state.browDR, colors.hairDark);
      ctx2.restore();

      drawSideLock(ctx2, -1, colors, settings.hairstyle);
      drawSideLock(ctx2, 1, colors, settings.hairstyle);
      if (settings.accessories.ties) drawTies(ctx2, settings.hairstyle, colors);
      drawAccessories(ctx2, settings, colors);
      drawOutfitHeadFront(ctx2, settings.outfit, colors);
    });
  }

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas.parentElement || canvas);

  return {
    update,
    draw,
    resize,
    get time() {
      return state.time;
    },
    destroy() {
      observer.disconnect();
    },
  };
}
