/** Ajustes de Bunny VTuber. Se guardan en localStorage. */

import { clamp, finite } from './filters.js';

export const STORAGE_KEY = 'bunny-vtuber-settings-v1';

export const STYLES = [
  { id: 'original', name: 'Original', filter: 'none' },
  { id: 'menta', name: 'Menta', filter: 'hue-rotate(110deg) saturate(1.05)' },
  { id: 'atardecer', name: 'Atardecer', filter: 'sepia(0.6) saturate(1.2) hue-rotate(-15deg)' },
  { id: 'lavanda', name: 'Lavanda', filter: 'hue-rotate(265deg) saturate(0.8) brightness(1.08)' },
  { id: 'algodon', name: 'Algodón', filter: 'saturate(0.55) brightness(1.14) contrast(0.92)' },
  { id: 'papel', name: 'Papel', filter: 'grayscale(1) sepia(0.35) contrast(1.05)' },
  { id: 'neon', name: 'Neón', filter: 'saturate(1.6) contrast(1.1)' },
];

export const ACCESSORY_DEFS = [
  { id: 'bow', name: 'Moño en la oreja' },
  { id: 'glasses', name: 'Gafas redondas' },
  { id: 'flowerCrown', name: 'Corona de flores' },
  { id: 'star', name: 'Estrella en la mejilla' },
  { id: 'headphones', name: 'Auriculares' },
  { id: 'blush', name: 'Rubor extra' },
  { id: 'sparkles', name: 'Pecas brillitos' },
];

export const BACKGROUNDS = [
  { id: 'parappa', name: 'Escenario PaRappa', shadow: 'rgb(150,50,20)' },
  { id: 'azul', name: 'Azul original' },
  { id: 'crema', name: 'Papel crema' },
  { id: 'cuarto', name: 'Cuarto', shadow: 'rgb(150,90,70)' },
  { id: 'estrellas', name: 'Noche estrellada', shadow: 'rgb(10,15,45)', shadowAlpha: 0.6 },
  { id: 'green', name: 'Pantalla verde' },
  { id: 'blue', name: 'Pantalla azul' },
  { id: 'custom', name: 'Color personalizado' },
];

export const SHADOW_BLENDS = [
  { id: 'multiply', name: 'Multiplicar' },
  { id: 'overlay', name: 'Superposición' },
  { id: 'soft-light', name: 'Luz suave' },
  { id: 'color-burn', name: 'Color subexpuesto' },
];

export const TOGGLE_DEFS = [
  { id: 'paperShadow', name: 'Sombra de papel' },
  { id: 'paperThickness', name: 'Grosor de papel' },
  { id: 'bounce', name: 'Rebote' },
  { id: 'showPreview', name: 'Vista previa cámara' },
  { id: 'showLandmarks', name: 'Puntos' },
  { id: 'mirror', name: 'Espejo' },
];

export const DEFAULT_SETTINGS = {
  style: 'original',
  accessories: {
    bow: false,
    glasses: false,
    flowerCrown: false,
    star: false,
    headphones: false,
    blush: false,
    sparkles: false,
  },
  sensitivity: {
    mouth: 1,
    blink: 1,
    head: 1,
    bounce: 1,
  },
  smoothing: 0.35,
  background: 'parappa',
  bgColor: '#243a5c',
  showPreview: true,
  showLandmarks: false,
  mirror: true,
  paperShadow: true,
  paperThickness: true,
  shadowIntensity: 1,
  shadowColor: '#2b4cc4',
  shadowBlend: 'multiply',
  shadowAuto: false,
  bounce: true,
  independentWink: false,
  eyeStyle: 'A',
};

export function isHex(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function isChroma(background) {
  return background === 'green' || background === 'blue';
}

export function styleById(id) {
  return STYLES.find((s) => s.id === id) || STYLES[0];
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
  if (!STYLES.some((s) => s.id === out.style)) out.style = base.style;
  if (!BACKGROUNDS.some((b) => b.id === out.background)) out.background = base.background;
  if (!isHex(out.bgColor)) out.bgColor = base.bgColor;
  out.sensitivity.mouth = clamp(Number(out.sensitivity.mouth), 0.2, 2);
  out.sensitivity.blink = clamp(Number(out.sensitivity.blink), 0.2, 2);
  out.sensitivity.head = clamp(Number(out.sensitivity.head), 0.2, 1.8);
  out.sensitivity.bounce = clamp(Number(out.sensitivity.bounce), 0, 1.8);
  out.smoothing = clamp(Number(out.smoothing), 0, 1);
  for (const item of ACCESSORY_DEFS) out.accessories[item.id] = Boolean(out.accessories[item.id]);
  out.showPreview = Boolean(out.showPreview);
  out.showLandmarks = Boolean(out.showLandmarks);
  out.mirror = out.mirror !== false;
  out.paperShadow = out.paperShadow !== false;
  out.paperThickness = out.paperThickness !== false;
  out.shadowIntensity = clamp(finite(Number(out.shadowIntensity), 1), 0, 1.5);
  if (!isHex(out.shadowColor)) out.shadowColor = base.shadowColor;
  if (!SHADOW_BLENDS.some((item) => item.id === out.shadowBlend)) out.shadowBlend = base.shadowBlend;
  out.shadowAuto = out.shadowAuto === true;
  out.bounce = out.bounce !== false;
  out.independentWink = out.independentWink === true;
  out.eyeStyle = out.eyeStyle === 'B' ? 'B' : 'A';
  return out;
}

export function loadSettings() {
  const fresh = structuredClone(DEFAULT_SETTINGS);
  const store = storage();
  if (!store) return fresh;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    return mergeSettings(fresh, JSON.parse(raw));
  } catch {
    return fresh;
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

export function resetSettings(settings) {
  const fresh = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, fresh);
  settings.accessories = fresh.accessories;
  settings.sensitivity = fresh.sensitivity;
  return settings;
}

export function randomizeSettings(settings) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  settings.style = pick(STYLES).id;
  const backgrounds = BACKGROUNDS.filter((b) => b.id !== 'custom' && b.id !== 'green' && b.id !== 'blue');
  settings.background = pick(backgrounds).id;
  for (const item of ACCESSORY_DEFS) {
    settings.accessories[item.id] = Math.random() > 0.55;
  }
  return settings;
}
