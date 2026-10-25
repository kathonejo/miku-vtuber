/* Guardado automático en el navegador (IndexedDB): capas una vez, ajustes en cada cambio. */
const DB = 'escena-v1';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(key, value) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function get(key) {
  const db = await open();
  const value = await new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));

export async function saveSceneImages(scene) {
  const layers = [];
  for (const l of scene.layers) {
    const { image, _levels, _glow, _hit, ...meta } = l;
    layers.push({ ...meta, blob: await toBlob(image) });
  }
  await put('scene', { name: scene.name, width: scene.width, height: scene.height, layers, savedAt: Date.now() });
}

export async function loadSceneImages() {
  const rec = await get('scene');
  if (!rec?.layers?.length) return null;
  const layers = [];
  for (const l of rec.layers) {
    const bmp = await createImageBitmap(l.blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    const { blob, ...meta } = l;
    layers.push({ ...meta, image: c });
  }
  return { name: rec.name, width: rec.width, height: rec.height, layers };
}
