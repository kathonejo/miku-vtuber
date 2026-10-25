/**
 * Ojo cerrado por aplastado: la silueta del propio ojo queda como una rayita.
 * Su color contrasta con lo que hay debajo del ojo (se decide al armar o al importar):
 * fondo claro -> el negro de su línea; fondo oscuro -> el color claro del ojo (o blanco).
 */

const HEX = /^#[0-9a-f]{6}$/i;

export function lumOf(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

function rgbOf(color) {
  if (!HEX.test(color || '')) return null;
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

function lumHex(color) {
  const c = rgbOf(color);
  return c ? lumOf(c[0], c[1], c[2]) : 0;
}

function meanOf(list) {
  if (!list.length) return [0, 0, 0];
  const s = [0, 0, 0];
  for (const c of list) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
  return s.map((v) => v / list.length);
}

/**
 * eye, below: RGBA sin premultiplicar del mismo recuadro (el ojo solo / lo de abajo ya compuesto).
 * lineDark: [r,g,b] oscuro de su línea, o null.
 */
export function pickClosedLine(eye, below, lineDark) {
  let wSum = 0;
  let eyeL = 0;
  let bgL = 0;
  const solid = [];
  for (let i = 0; i < eye.length; i += 4) {
    const w = eye[i + 3] / 255;
    if (w <= 0.004) continue;
    const ba = below[i + 3] / 255;
    const br = below[i] * ba + 255 * (1 - ba);
    const bg = below[i + 1] * ba + 255 * (1 - ba);
    const bb = below[i + 2] * ba + 255 * (1 - ba);
    const el = lumOf(eye[i], eye[i + 1], eye[i + 2]);
    wSum += w;
    eyeL += el * w;
    bgL += lumOf(br, bg, bb) * w;
    if (w > 0.5) solid.push([eye[i], eye[i + 1], eye[i + 2], el]);
  }
  if (!wSum) return null;
  eyeL /= wSum;
  bgL /= wSum;
  solid.sort((a, b) => a[3] - b[3]);
  const k = Math.max(1, Math.floor(solid.length / 10));
  const dark = meanOf(solid.slice(0, k));
  const light = meanOf(solid.slice(-k));
  let color;
  let why;
  if (bgL >= 0.5) {
    color = lineDark ? hex(lineDark) : '#000000';
    why = 'fondo claro: negro de su línea';
    if (lumHex(color) > bgL - 0.4) { color = '#000000'; why = 'fondo claro: negro'; }
  } else {
    color = hex(light);
    why = 'fondo oscuro: color claro del ojo';
    if (lumHex(color) < bgL + 0.4) { color = '#ffffff'; why = 'fondo oscuro: blanco'; }
  }
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return { color, eyeLum: r3(eyeL), bgLum: r3(bgL), eye: { dark: hex(dark), light: hex(light) }, why };
}

/** 'auto' | 'invert' | '#rrggbb' */
export function eyeLineMode(raw) {
  if (raw === 'invert') return 'invert';
  if (typeof raw === 'string' && HEX.test(raw)) return raw.toLowerCase();
  return 'auto';
}

/** Color final de la rayita con la opción del editor. */
export function closedLineColor(info, mode) {
  const m = eyeLineMode(mode);
  if (m !== 'auto' && m !== 'invert') return m;
  const auto = HEX.test(info?.color || '') ? info.color : null;
  const bg = Number.isFinite(+info?.bgLum) ? +info.bgLum : null;
  const base = auto || (bg != null && bg < 0.5 ? '#ffffff' : '#000000');
  if (m === 'auto') return base;
  // invertir: el lado opuesto (claro <-> oscuro), con los colores del propio ojo si sirven
  if (lumHex(base) >= 0.5) {
    const d = info?.eye?.dark;
    return HEX.test(d || '') && lumHex(d) < 0.35 ? d : '#000000';
  }
  const l = info?.eye?.light;
  return HEX.test(l || '') && lumHex(l) > 0.65 ? l : '#ffffff';
}
