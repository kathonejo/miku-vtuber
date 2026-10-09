import { shade, withAlpha } from './settings.js';

export const RIG = {
  shoulderHalf: 168,
  shoulderDrop: 34,
  upperLen: 138,
  foreLen: 122,
};

function tube(ctx, y0, y1, w, radius) {
  const h = Math.max(2, y1 - y0);
  const r = Math.min(radius ?? Math.min(16, w * 0.7), w, h / 2);
  ctx.beginPath();
  ctx.roundRect(-w, y0, w * 2, h, r);
}

function strokeFill(ctx, fill, stroke, width = 3) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function spark(ctx, x, y, s, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fffef8';
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(0, 0, s, 0);
  ctx.quadraticCurveTo(0, 0, 0, s);
  ctx.quadraticCurveTo(0, 0, -s, 0);
  ctx.quadraticCurveTo(0, 0, 0, -s);
  ctx.fill();
  ctx.restore();
}

function scallopBand(ctx, x0, x1, y, amp, n, fill) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const mx = x0 + w * (i + 0.5);
    const x = x0 + w * (i + 1);
    ctx.quadraticCurveTo(mx, y + amp, x, y);
  }
  ctx.lineTo(x1, y + amp + 10);
  ctx.lineTo(x0, y + amp + 10);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawOutfitHeadBack(ctx, outfit, colors) {
  if (outfit !== 'casual') return;
  const outer = shade(colors.accent, -0.12);
  const inner = shade(colors.accent, -0.38);
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.ellipse(0, 24, 198, 214, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(colors.accent, -0.45);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.ellipse(0, 36, 150, 168, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawOutfitHeadFront(ctx, outfit, colors) {
  if (outfit !== 'invierno') return;
  ctx.save();
  ctx.strokeStyle = colors.accentDark;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, -6, 148, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
  for (const x of [-116, 116]) {
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.ellipse(x, 14, 30, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha('#fffaf4', 0.85);
    ctx.beginPath();
    ctx.ellipse(x - 4, 10, 14, 18, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.accentDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, 14, 30, 36, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawOutfitTorso(ctx, outfit, colors, time) {
  if (outfit === 'clasico') drawClassic(ctx, colors);
  else if (outfit === 'casual') drawCasual(ctx, colors);
  else if (outfit === 'idol') drawIdol(ctx, colors, time);
  else if (outfit === 'invierno') drawWinter(ctx, colors);
  else drawSailor(ctx, colors);
}

function drawClassic(ctx, colors) {
  const g = ctx.createLinearGradient(-150, 0, 160, 420);
  g.addColorStop(0, '#aeb6c0');
  g.addColorStop(0.45, '#7d868f');
  g.addColorStop(1, '#5d656e');
  ctx.beginPath();
  ctx.moveTo(-34, -8);
  ctx.lineTo(-34, 18);
  ctx.bezierCurveTo(-120, 28, -158, 48, -150, 92);
  ctx.lineTo(-132, 168);
  ctx.bezierCurveTo(-124, 250, -112, 320, -104, 400);
  ctx.lineTo(104, 400);
  ctx.bezierCurveTo(112, 320, 124, 250, 132, 168);
  ctx.lineTo(150, 92);
  ctx.bezierCurveTo(158, 48, 120, 28, 34, 18);
  ctx.lineTo(34, -8);
  ctx.quadraticCurveTo(0, 16, -34, -8);
  ctx.closePath();
  strokeFill(ctx, g, '#3c434b', 4);

  ctx.fillStyle = '#eceff3';
  ctx.beginPath();
  ctx.moveTo(-36, 6);
  ctx.lineTo(-18, 34);
  ctx.lineTo(0, 18);
  ctx.lineTo(18, 34);
  ctx.lineTo(36, 6);
  ctx.quadraticCurveTo(0, 20, -36, 6);
  ctx.fill();

  const tie = ctx.createLinearGradient(0, 24, 0, 196);
  tie.addColorStop(0, colors.accentLight);
  tie.addColorStop(0.5, colors.accent);
  tie.addColorStop(1, colors.accentDark);
  ctx.beginPath();
  ctx.moveTo(-8, 30);
  ctx.lineTo(8, 30);
  ctx.lineTo(14, 52);
  ctx.lineTo(11, 150);
  ctx.lineTo(0, 188);
  ctx.lineTo(-11, 150);
  ctx.lineTo(-14, 52);
  ctx.closePath();
  strokeFill(ctx, tie, colors.accentDark, 2);

  ctx.fillStyle = colors.accentDark;
  ctx.beginPath();
  ctx.moveTo(-16, 28);
  ctx.lineTo(0, 48);
  ctx.lineTo(16, 28);
  ctx.lineTo(8, 24);
  ctx.lineTo(0, 34);
  ctx.lineTo(-8, 24);
  ctx.closePath();
  ctx.fill();
}

function drawCasual(ctx, colors) {
  const main = shade(colors.accent, -0.08);
  const dark = shade(colors.accent, -0.32);
  const light = shade(colors.accent, 0.18);
  const g = ctx.createLinearGradient(-180, 0, 180, 460);
  g.addColorStop(0, light);
  g.addColorStop(0.4, main);
  g.addColorStop(1, dark);
  ctx.beginPath();
  ctx.moveTo(-48, -20);
  ctx.quadraticCurveTo(-20, 8, 0, -6);
  ctx.quadraticCurveTo(20, 8, 48, -20);
  ctx.lineTo(70, 8);
  ctx.bezierCurveTo(150, 20, 186, 70, 176, 120);
  ctx.lineTo(158, 250);
  ctx.lineTo(150, 390);
  ctx.quadraticCurveTo(0, 430, -150, 390);
  ctx.lineTo(-158, 250);
  ctx.lineTo(-176, 120);
  ctx.bezierCurveTo(-186, 70, -150, 20, -70, 8);
  ctx.closePath();
  strokeFill(ctx, g, dark, 4);

  ctx.fillStyle = dark;
  tube(ctx, 368, 418, 156, 18);
  ctx.fill();

  ctx.fillStyle = shade(colors.accent, -0.22);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-78, 168, 156, 110, 28);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#ffffff', 0.25);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-78, 190);
  ctx.lineTo(78, 190);
  ctx.stroke();

  ctx.strokeStyle = light;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10, 10);
  ctx.bezierCurveTo(-18, 70, -8, 120, -16, 160);
  ctx.moveTo(10, 10);
  ctx.bezierCurveTo(18, 70, 8, 120, 16, 160);
  ctx.stroke();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(-16, 164, 5, 0, Math.PI * 2);
  ctx.arc(16, 164, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawIdol(ctx, colors, time) {
  const g = ctx.createLinearGradient(0, -10, 0, 460);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.55, '#f7f2ff');
  g.addColorStop(1, shade(colors.accent, 0.35));
  ctx.beginPath();
  ctx.moveTo(-78, 36);
  ctx.bezierCurveTo(-130, 48, -150, 80, -136, 130);
  ctx.lineTo(-112, 230);
  ctx.lineTo(-150, 250);
  ctx.lineTo(-176, 455);
  ctx.lineTo(176, 455);
  ctx.lineTo(150, 250);
  ctx.lineTo(112, 230);
  ctx.lineTo(136, 130);
  ctx.bezierCurveTo(150, 80, 130, 48, 78, 36);
  ctx.quadraticCurveTo(0, 78, -78, 36);
  ctx.closePath();
  strokeFill(ctx, g, shade(colors.accent, -0.25), 3);

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(-70, 40);
  ctx.quadraticCurveTo(0, 8, 70, 40);
  ctx.quadraticCurveTo(0, 62, -70, 40);
  ctx.fill();

  scallopBand(ctx, -120, 120, 48, 16, 7, '#fff');
  scallopBand(ctx, -150, 150, 236, 22, 8, withAlpha(colors.accentLight, 0.95));
  scallopBand(ctx, -176, 176, 430, 18, 9, '#fff');

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(0, 70);
  ctx.lineTo(16, 92);
  ctx.lineTo(0, 150);
  ctx.lineTo(-16, 92);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.accentLight;
  ctx.beginPath();
  ctx.arc(0, 86, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#f3d48a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-112, 228);
  ctx.quadraticCurveTo(0, 248, 112, 228);
  ctx.stroke();

  const sparks = [
    [-48, 100], [62, 130], [-90, 190], [36, 210], [96, 280],
    [-30, 300], [70, 360], [-110, 340], [10, 160], [-60, 390],
  ];
  for (let i = 0; i < sparks.length; i++) {
    const tw = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 3.2 + i * 1.3));
    spark(ctx, sparks[i][0], sparks[i][1], 5 + (i % 3) * 2, tw);
  }
}

function drawWinter(ctx, colors) {
  const coat = shade(colors.accent, -0.42);
  const coatL = shade(colors.accent, -0.22);
  const g = ctx.createLinearGradient(-160, 0, 170, 480);
  g.addColorStop(0, coatL);
  g.addColorStop(0.5, coat);
  g.addColorStop(1, shade(coat, -0.2));
  ctx.beginPath();
  ctx.moveTo(-40, -16);
  ctx.lineTo(-78, 20);
  ctx.lineTo(-168, 70);
  ctx.lineTo(-156, 200);
  ctx.lineTo(-170, 455);
  ctx.lineTo(170, 455);
  ctx.lineTo(156, 200);
  ctx.lineTo(168, 70);
  ctx.lineTo(78, 20);
  ctx.lineTo(40, -16);
  ctx.quadraticCurveTo(0, 10, -40, -16);
  ctx.closePath();
  strokeFill(ctx, g, shade(coat, -0.35), 4);

  ctx.fillStyle = shade(colors.skin, 0.05);
  ctx.beginPath();
  ctx.moveTo(-28, 48);
  ctx.lineTo(0, 150);
  ctx.lineTo(28, 48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.accentLight;
  ctx.beginPath();
  ctx.moveTo(-22, 52);
  ctx.lineTo(0, 130);
  ctx.lineTo(22, 52);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e8e0d4';
  ctx.beginPath();
  ctx.moveTo(-168, 70);
  ctx.quadraticCurveTo(-120, 86, -78, 36);
  ctx.lineTo(-40, -8);
  ctx.quadraticCurveTo(-90, 8, -150, 48);
  ctx.closePath();
  ctx.moveTo(168, 70);
  ctx.quadraticCurveTo(120, 86, 78, 36);
  ctx.lineTo(40, -8);
  ctx.quadraticCurveTo(90, 8, 150, 48);
  ctx.closePath();
  ctx.fill();

  for (const y of [120, 190, 260, 330]) {
    ctx.fillStyle = '#f0d78c';
    ctx.beginPath();
    ctx.arc(-16, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade(coat, -0.2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-16, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(-46, -8);
  ctx.quadraticCurveTo(-20, 36, -8, 78);
  ctx.lineTo(8, 78);
  ctx.quadraticCurveTo(20, 36, 46, -8);
  ctx.quadraticCurveTo(0, 16, -46, -8);
  ctx.fill();
  ctx.fillStyle = colors.accentLight;
  ctx.beginPath();
  ctx.moveTo(-34, 70);
  ctx.lineTo(-18, 210);
  ctx.lineTo(-2, 78);
  ctx.closePath();
  ctx.moveTo(34, 70);
  ctx.lineTo(22, 230);
  ctx.lineTo(6, 78);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = colors.accentDark;
  ctx.lineWidth = 2;
  for (const x of [-18, 22]) {
    const len = x < 0 ? 200 : 220;
    ctx.beginPath();
    ctx.moveTo(x, len);
    for (let i = -3; i <= 3; i++) {
      ctx.moveTo(x + i * 4, len);
      ctx.lineTo(x + i * 5, len + 14);
    }
    ctx.stroke();
  }
}

function drawSailor(ctx, colors) {
  const navy = '#24315f';
  const g = ctx.createLinearGradient(0, 0, 0, 280);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e7eef8');
  ctx.beginPath();
  ctx.moveTo(-36, -6);
  ctx.bezierCurveTo(-130, 24, -156, 60, -140, 110);
  ctx.lineTo(-124, 250);
  ctx.lineTo(124, 250);
  ctx.lineTo(140, 110);
  ctx.bezierCurveTo(156, 60, 130, 24, 36, -6);
  ctx.quadraticCurveTo(0, 22, -36, -6);
  ctx.closePath();
  strokeFill(ctx, g, navy, 4);

  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(-38, -4);
  ctx.lineTo(-156, 78);
  ctx.lineTo(-124, 112);
  ctx.lineTo(-22, 70);
  ctx.lineTo(0, 132);
  ctx.lineTo(22, 70);
  ctx.lineTo(124, 112);
  ctx.lineTo(156, 78);
  ctx.lineTo(38, -4);
  ctx.quadraticCurveTo(0, 18, -38, -4);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#f7fbff';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-132, 86);
  ctx.lineTo(-28, 62);
  ctx.lineTo(0, 108);
  ctx.lineTo(28, 62);
  ctx.lineTo(132, 86);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-118, 96);
  ctx.lineTo(-30, 74);
  ctx.lineTo(0, 112);
  ctx.lineTo(30, 74);
  ctx.lineTo(118, 96);
  ctx.stroke();

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(26, 46);
  ctx.lineTo(0, 118);
  ctx.lineTo(-26, 46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.accentDark;
  ctx.beginPath();
  ctx.arc(0, 40, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(-128, 248);
  ctx.lineTo(128, 248);
  ctx.lineTo(168, 455);
  ctx.lineTo(-168, 455);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  for (let i = -5; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 22, 252);
    ctx.lineTo(i * 30, 452);
    ctx.stroke();
  }
  ctx.fillStyle = '#f7fbff';
  ctx.fillRect(-166, 430, 332, 10);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(-166, 418, 332, 8);
}

export function drawOutfitArm(ctx, outfit, colors, segment, len, _side) {
  if (outfit === 'clasico') {
    ctx.fillStyle = '#17191e';
    ctx.strokeStyle = '#0d0e12';
    ctx.lineWidth = 3;
    if (segment === 'upper') {
      tube(ctx, 30, len + 8, 27, 14);
      strokeFill(ctx, '#17191e', '#0d0e12', 3);
      ctx.fillStyle = colors.accent;
      ctx.fillRect(-27, 30, 54, 9);
      ctx.fillStyle = colors.accentDark;
      ctx.fillRect(-27, len - 6, 54, 8);
    } else {
      tube(ctx, -6, len - 8, 23, 12);
      strokeFill(ctx, '#17191e', '#0d0e12', 3);
      ctx.fillStyle = colors.accent;
      ctx.fillRect(-23, len - 20, 46, 9);
    }
    return;
  }
  if (outfit === 'casual') {
    const main = shade(colors.accent, -0.12);
    const dark = shade(colors.accent, -0.36);
    if (segment === 'upper') {
      tube(ctx, -16, len + 10, 36, 18);
      strokeFill(ctx, main, dark, 3);
    } else {
      tube(ctx, -8, len - 4, 28, 14);
      strokeFill(ctx, main, dark, 3);
      ctx.fillStyle = dark;
      tube(ctx, len - 28, len + 2, 30, 10);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.25);
      ctx.lineWidth = 2;
      for (const y of [len - 20, len - 12, len - 4]) {
        ctx.beginPath();
        ctx.moveTo(-26, y);
        ctx.lineTo(26, y);
        ctx.stroke();
      }
    }
    return;
  }
  if (outfit === 'idol') {
    if (segment === 'upper') {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, len * 0.42, 46, 40, 0, 0, Math.PI * 2);
      strokeFill(ctx, '#fff', colors.accent, 3);
      scallopBand(ctx, -40, 40, len * 0.62, 12, 4, colors.accentLight);
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(0, len * 0.28, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      tube(ctx, -4, len - 2, 20, 12);
      strokeFill(ctx, '#fffefb', colors.accent, 3);
      ctx.fillStyle = colors.accent;
      ctx.fillRect(-20, 0, 40, 8);
    }
    return;
  }
  if (outfit === 'invierno') {
    const coat = shade(colors.accent, -0.38);
    const edge = shade(colors.accent, -0.55);
    const w = segment === 'upper' ? 38 : 30;
    tube(ctx, segment === 'upper' ? -14 : -8, len + 4, w, 16);
    strokeFill(ctx, coat, edge, 3);
    if (segment === 'fore') {
      ctx.fillStyle = '#f6f1e8';
      ctx.beginPath();
      ctx.ellipse(0, len - 2, w + 2, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e0d5c4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    return;
  }
  if (segment === 'upper') {
    tube(ctx, 4, len * 0.62, 28, 14);
    strokeFill(ctx, '#f7fbff', '#24315f', 3);
    ctx.fillStyle = '#24315f';
    ctx.fillRect(-28, len * 0.62 - 8, 56, 10);
    ctx.fillStyle = '#f7fbff';
    ctx.fillRect(-28, len * 0.62 - 4, 56, 3);
  } else {
    ctx.fillStyle = '#24315f';
    ctx.fillRect(-20, len - 18, 40, 12);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(-20, len - 18, 40, 4);
  }
}

export function drawOutfitHand(ctx, outfit, colors, side) {
  if (outfit !== 'idol') return false;
  const td = side === 'L' ? 1 : -1;
  ctx.save();
  ctx.fillStyle = '#fffefb';
  ctx.strokeStyle = colors.accentDark;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  const xs = [-12, -3, 6];
  for (let i = 0; i < xs.length; i++) {
    const len = 20 - Math.abs(i - 1);
    ctx.beginPath();
    ctx.roundRect(xs[i], 22, 10, len, 5);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.bezierCurveTo(-22, 16, -16, 32, -6, 36);
  ctx.lineTo(12, 34);
  ctx.bezierCurveTo(20, 26, 18, 10, 12, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(td * 15, 18, 8, 11, td * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-14, 6);
  ctx.quadraticCurveTo(0, 12, 12, 6);
  ctx.stroke();
  ctx.restore();
  return true;
}
