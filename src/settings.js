/** Ajustes persistentes, paletas y utilidades de color. */

export const STORAGE_KEY = 'miku-vtuber-settings-v1';

export const PALETTES = [
  { id: 'original', name: 'Original', hair: '#39c5bb', eyes: '#1fb5b0', accent: '#2ec4b6' },
  { id: 'sakura', name: 'Sakura rosa', hair: '#ff7aa2', eyes: '#e84393', accent: '#ff5c9a' },
  { id: 'medianoche', name: 'Medianoche', hair: '#7c6cff', eyes: '#a78bfa', accent: '#6d5efc' },
  { id: 'dorado', name: 'Dorado', hair: '#f0c14a', eyes: '#d4a017', accent: '#e3b341' },
  { id: 'pastel', name: 'Pastel', hair: '#9be7d8', eyes: '#f2a7c3', accent: '#c4b5fd' },
];

export const SKIN_PRESETS = [
  { id: 'porcelain', name: 'Porcelana', color: '#ffe8dc' },
  { id: 'light', name: 'Clara', color: '#ffd2b8' },
  { id: 'medium', name: 'Media', color: '#e8b48a' },
  { id: 'olive', name: 'Oliva', color: '#c9a06a' },
  { id: 'tan', name: 'Morena', color: '#a86b3c' },
  { id: 'deep', name: 'Ébano', color: '#6b3e26' },
];

export const OUTFITS = [
  { id: 'clasico', name: 'Clásico' },
  { id: 'casual', name: 'Casual' },
  { id: 'idol', name: 'Idol' },
  { id: 'invierno', name: 'Invierno' },
  { id: 'marinera', name: 'Marinera' },
];

export const HAIRSTYLES = [
  { id: 'long', name: 'Coletas largas' },
  { id: 'short', name: 'Coletas cortas' },
  { id: 'ponytail', name: 'Cola única' },
];

export const BACKGROUNDS = [
  { id: 'stage', name: 'Escenario' },
  { id: 'room', name: 'Habitación' },
  { id: 'stars', name: 'Noche estrellada' },
  { id: 'studio', name: 'Estudio' },
  { id: 'sunset', name: 'Atardecer' },
  { id: 'green', name: 'Pantalla verde' },
  { id: 'blue', name: 'Pantalla azul' },
  { id: 'transparent', name: 'Transparente' },
  { id: 'custom', name: 'Color' },
];

export const ACCESSORY_DEFS = [
  { id: 'headset', name: 'Auriculares' },
  { id: 'ties', name: 'Lazos' },
  { id: 'glasses', name: 'Gafas' },
  { id: 'catEars', name: 'Orejas de gato' },
  { id: 'tiara', name: 'Corona' },
  { id: 'blush', name: 'Rubor' },
  { id: 'beautyMark', name: 'Lunar' },
];

export const DEFAULT_SETTINGS = {
  outfit: 'clasico',
  palette: 'original',
  hairColor: '#39c5bb',
  eyeColor: '#1fb5b0',
  skinColor: '#ffd2b8',
  accentColor: '#2ec4b6',
  accessories: {
    headset: true,
    ties: true,
    glasses: false,
    catEars: false,
    tiara: false,
    blush: true,
    beautyMark: true,
  },
  hairstyle: 'long',
  sensitivity: {
    mouth: 1,
    blink: 1,
    arms: 1,
  },
  smoothing: 0.4,
  background: 'stage',
  bgColor: '#141a22',
  showPreview: true,
  showLandmarks: false,
};

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return { r: 255, g: 210, b: 190 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r, g, b) {
  const c = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** amt > 0 aclara, amt < 0 oscurece. amt está en [-1, 1]. */
export function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => (amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return rgbToHex(f(r), f(g), f(b));
}

export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t,
  );
}

export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function isHex(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function mergeSettings(base, saved) {
  const out = {
    ...base,
    ...saved,
    accessories: { ...base.accessories, ...(saved?.accessories || {}) },
    sensitivity: { ...base.sensitivity, ...(saved?.sensitivity || {}) },
  };
  if (!OUTFITS.some((o) => o.id === out.outfit)) out.outfit = base.outfit;
  if (!HAIRSTYLES.some((h) => h.id === out.hairstyle)) out.hairstyle = base.hairstyle;
  if (!BACKGROUNDS.some((b) => b.id === out.background)) out.background = base.background;
  for (const key of ['hairColor', 'eyeColor', 'skinColor', 'accentColor', 'bgColor']) {
    if (!isHex(out[key])) out[key] = base[key];
  }
  out.sensitivity.mouth = clamp(Number(out.sensitivity.mouth) || 1, 0.2, 2);
  out.sensitivity.blink = clamp(Number(out.sensitivity.blink) || 1, 0.2, 2);
  out.sensitivity.arms = clamp(Number(out.sensitivity.arms) || 1, 0.2, 1.8);
  out.smoothing = clamp(Number(out.smoothing) || 0, 0, 1);
  for (const a of ACCESSORY_DEFS) {
    out.accessories[a.id] = Boolean(out.accessories[a.id]);
  }
  return out;
}

export function loadSettings() {
  const store = storage();
  if (!store) return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function applyPalette(settings, paletteId) {
  const p = PALETTES.find((x) => x.id === paletteId);
  if (!p) return;
  settings.palette = p.id;
  settings.hairColor = p.hair;
  settings.eyeColor = p.eyes;
  settings.accentColor = p.accent;
}

export function resetSettings(settings) {
  const fresh = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, fresh);
  settings.accessories = fresh.accessories;
  settings.sensitivity = fresh.sensitivity;
  return settings;
}

export function randomizeSettings(settings) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const outfit = pick(OUTFITS).id;
  const palette = pick(PALETTES);
  const hair = pick(HAIRSTYLES).id;
  const bg = pick(BACKGROUNDS.filter((b) => b.id !== 'custom')).id;
  const skin = pick(SKIN_PRESETS).color;
  settings.outfit = outfit;
  settings.palette = palette.id;
  settings.hairColor = palette.hair;
  settings.eyeColor = palette.eyes;
  settings.accentColor = palette.accent;
  settings.skinColor = skin;
  settings.hairstyle = hair;
  settings.background = bg;
  for (const a of ACCESSORY_DEFS) {
    if (a.id === 'blush') settings.accessories[a.id] = Math.random() > 0.25;
    else if (a.id === 'ties') settings.accessories[a.id] = Math.random() > 0.3;
    else settings.accessories[a.id] = Math.random() > 0.55;
  }
  return settings;
}

export function themeFrom(settings) {
  const hair = settings.hairColor;
  const eye = settings.eyeColor;
  const accent = settings.accentColor;
  const skin = settings.skinColor;
  return {
    hair,
    hairLight: shade(hair, 0.34),
    hairDark: shade(hair, -0.32),
    hairLine: shade(hair, -0.5),
    eye,
    eyeLight: shade(eye, 0.42),
    eyeDark: shade(eye, -0.38),
    accent,
    accentLight: shade(accent, 0.3),
    accentDark: shade(accent, -0.34),
    skin,
    skinLight: shade(skin, 0.16),
    skinShadow: shade(skin, -0.2),
    skinDeep: shade(skin, -0.38),
    blush: mix(skin, '#ff5d7a', 0.4),
    lip: mix('#d1546a', skin, 0.18),
    lipDeep: mix('#8e3144', skin, 0.12),
  };
}
