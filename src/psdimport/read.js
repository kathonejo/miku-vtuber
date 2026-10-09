/** Lee un PSD en un worker y devuelve el mapeo automático de capas. */

import { composeManifest } from './build.js';
import { flattenPsd } from './flatten.js';
import { mapLayers } from './geom.js';
import { paintPixels, thumbCanvas } from './raster.js';

function busy(on, text) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('psd-busy');
  if (!el && on) {
    el = document.createElement('div');
    el.id = 'psd-busy';
    document.body.appendChild(el);
  }
  if (!el) return;
  el.textContent = text || 'Leyendo PSD…';
  el.hidden = !on;
}

function hydrate(rawLayers) {
  return rawLayers.map((layer) => {
    const pixels = new Uint8ClampedArray(layer.buffer);
    return { ...layer, pixels, buffer: null };
  });
}

function finishMapping(parsed, filename) {
  const layers = hydrate(parsed.layers);
  const placed = mapLayers(layers, parsed.width || 1);
  if (!placed) {
    const error = new Error('No encontré capas con dibujo.');
    error.code = 'empty';
    throw error;
  }
  const mapping = {
    name: String(filename || 'Personaje').replace(/\.psd$/i, '') || 'Personaje',
    width: parsed.width,
    height: parsed.height,
    layers,
    meta: { scale: placed.scale, offset: placed.offset, pxPerUnit: placed.pxPerUnit },
  };
  const factor = Math.min(1, mapping.meta.pxPerUnit / mapping.meta.scale);
  for (const layer of layers) {
    layer.canvas = paintPixels(layer.pixels, layer.width, layer.height, factor);
    layer.thumb = thumbCanvas(layer.canvas);
  }
  mapping.summary = layers.map((layer) => ({
    name: layer.name,
    path: layer.path,
    role: layer.role,
    side: layer.side,
    hidden: layer.hidden,
  }));
  return mapping;
}

async function parseInWorker(arrayBuffer) {
  const copy = arrayBuffer.slice(0);
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El PSD tardó demasiado.')), 90000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        if (event.data?.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = (err) => {
        clearTimeout(timer);
        reject(err.error || err);
      };
      worker.postMessage({ buffer: copy }, [copy]);
    });
  } finally {
    worker.terminate();
  }
}

async function parseOnMain(arrayBuffer) {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(arrayBuffer, {
    skipThumbnail: true,
    skipCompositeImageData: true,
    skipLinkedFilesData: true,
    useImageData: true,
  });
  return { width: psd.width, height: psd.height, layers: flattenPsd(psd) };
}

export async function importPsd(arrayBuffer, filename = 'Personaje') {
  busy(true, 'Leyendo PSD…');
  try {
    let parsed;
    try {
      parsed = await parseInWorker(arrayBuffer);
    } catch (err) {
      console.warn('PSD en el hilo principal', err);
      const main = await parseOnMain(arrayBuffer);
      parsed = {
        width: main.width,
        height: main.height,
        layers: main.layers.map((layer) => ({ ...layer, buffer: layer.pixels.buffer })),
      };
    }
    const mapping = finishMapping(parsed, filename);
    busy(false);
    return mapping;
  } catch (err) {
    busy(false);
    throw err;
  }
}

export function buildMapping(mapping) {
  return composeManifest(mapping);
}

export { composeManifest };
