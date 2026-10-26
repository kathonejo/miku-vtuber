/* Arte incluido en la app: capas ya separadas (WebP con su posición) + ajustes afinados. */
const BASE = '/escenas/';

export async function listBuiltins() {
  const r = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No encontré la lista de arte disponible.');
  return r.json();
}

async function loadImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No pude bajar ${url}`);
  return createImageBitmap(await r.blob());
}

/* Baja una tanda de imágenes de a varias por vez, avisando el progreso en bytes aproximados. */
async function loadAll(urls, weights, onProgress, parallel = 6) {
  const out = new Array(urls.length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      out[i] = await loadImage(urls[i]);
      done += weights[i];
      onProgress(done / total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker));
  return out;
}

/**
 * Abre una escena incluida: primero copias chicas (rápido, para ver y jugar), y después
 * las capas en calidad completa en segundo plano (`full`), que se usan para exportar.
 */
export async function loadBuiltin(id, { onPreview = () => {}, onFull = () => {} } = {}) {
  const dir = `${BASE}${id}/`;
  const r = await fetch(`${dir}escena.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No encontré esa escena.');
  const json = await r.json();
  const files = json.layers.map((l) => l.file);
  const weights = json.layers.map((l) => l.bytes || l.w * l.h);
  const prev = await loadAll(files.map((f) => `${dir}prev/${f}`), weights, onPreview, 8);
  const scene = {
    name: json.nombre,
    width: json.width,
    height: json.height,
    builtin: id,
    layers: json.layers.map((l, i) => ({
      name: l.name, group: l.group || '', x: l.x, y: l.y, w: l.w, h: l.h,
      opacity: l.opacity ?? 1, blend: l.blend || 'source-over', image: prev[i], preview: true,
    })),
  };
  const own = scene.layers; // las copias (Duplicar) heredan de estas, así también pasan a calidad completa
  const full = loadAll(files.map((f) => `${dir}full/${f}`), weights, onFull, 6).then((imgs) => {
    own.forEach((l, i) => {
      l.image = imgs[i];
      l.preview = false;
      delete l._levels;
      delete l._glow;
      delete l._hit;
    });
    return scene;
  });
  return { scene, json, full };
}
