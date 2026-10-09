/** Biblioteca de personajes en IndexedDB. La conejita oficial no se guarda aquí. */

import { pixelsToCanvas } from './psdimport/raster.js';

export const DB_NAME = 'bunny-vtuber';
export const STORE = 'characters';
export const BUNNY_ID = 'bunny';
export const LAST_KEY = 'bunny-vtuber-character';
export const BUNNY_NAME = 'Conejita (oficial)';

function memory() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function lastCharacterId() {
  const store = memory();
  if (!store) return BUNNY_ID;
  try {
    return store.getItem(LAST_KEY) || BUNNY_ID;
  } catch {
    return BUNNY_ID;
  }
}

export function rememberCharacter(id) {
  const store = memory();
  if (!store) return;
  try { store.setItem(LAST_KEY, id || BUNNY_ID); } catch { /* privado */ }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no guarda personajes.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir la biblioteca.'));
  });
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    let failed = null;
    try {
      Promise.resolve(fn(tx.objectStore(STORE))).then(
        (value) => { result = value; },
        (err) => { failed = err || new Error('Error al guardar.'); },
      );
    } catch (err) {
      failed = err;
    }
    tx.oncomplete = () => {
      db.close();
      if (failed) reject(failed);
      else resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || failed || new Error('Error al guardar.'));
    };
  }));
}

export function listCharacters() {
  return run('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result || []).map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt || 0,
        thumbnail: row.thumbnail || '',
      }));
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  }));
}

export function getCharacter(id) {
  return run('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export function putCharacter(record) {
  return run('readwrite', (store) => store.put(record));
}

export function deleteCharacter(id) {
  if (!id || id === BUNNY_ID) return Promise.resolve(false);
  return run('readwrite', (store) => store.delete(id)).then(() => true);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png');
  });
}

function blobImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer una capa.')); };
    img.src = url;
  });
}

function imagePixels(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: data.data, width: canvas.width, height: canvas.height };
}

/** Guarda las capas con dibujo (PNG sin pérdida) y la geometría ya en espacio de rig. */
export async function recordFromMapping(mapping, extra) {
  const layers = [];
  for (const layer of mapping.layers || []) {
    if (!layer || !layer.role || layer.role === 'ignore' || !layer.pixels) continue;
    const canvas = pixelsToCanvas(layer.pixels, layer.width, layer.height);
    const blob = await canvasToBlob(canvas);
    layers.push({
      name: layer.name || 'Capa',
      path: layer.path || '',
      role: layer.role,
      side: layer.side || null,
      pose: layer.pose || 'rest',
      hidden: Boolean(layer.hidden),
      x: layer.x, y: layer.y, w: layer.w, h: layer.h,
      pivot: Array.isArray(layer.pivot) ? [layer.pivot[0], layer.pivot[1]] : null,
      left: layer.left || 0,
      top: layer.top || 0,
      width: layer.width,
      height: layer.height,
      blob,
    });
  }
  return {
    id: extra.id,
    name: extra.name,
    createdAt: extra.createdAt || Date.now(),
    thumbnail: extra.thumbnail || '',
    layers,
    meta: {
      scale: mapping.meta?.scale,
      offset: mapping.meta?.offset,
      pxPerUnit: mapping.meta?.pxPerUnit,
    },
    rigOverrides: extra.rigOverrides || { order: [] },
  };
}

/** Reconstruye el mapeo para volver a armar el manifiesto. */
export async function mappingFromRecord(record) {
  const layers = [];
  for (const row of record?.layers || []) {
    if (!row?.blob) continue;
    const img = await blobImage(row.blob);
    const pix = imagePixels(img);
    const left = +row.left || 0;
    const top = +row.top || 0;
    layers.push({
      name: row.name,
      path: row.path || '',
      role: row.role,
      side: row.side,
      pose: row.pose || 'rest',
      hidden: Boolean(row.hidden),
      x: +row.x || 0,
      y: +row.y || 0,
      w: +row.w || 0,
      h: +row.h || 0,
      pivot: Array.isArray(row.pivot) ? [+row.pivot[0], +row.pivot[1]] : null,
      left,
      top,
      width: pix.width,
      height: pix.height,
      pixels: pix.pixels,
      cx: left + pix.width / 2,
      cy: top + pix.height / 2,
      index: layers.length,
    });
  }
  return {
    name: record.name || 'Personaje',
    layers,
    meta: {
      scale: record.meta?.scale || 1,
      offset: record.meta?.offset || [0, 0],
      pxPerUnit: record.meta?.pxPerUnit || 2,
    },
  };
}
