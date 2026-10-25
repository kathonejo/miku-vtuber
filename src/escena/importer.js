/* Importa la escena: PSD por capas, o PNG sueltos (lienzo completo o recortados con indice_capas.json). */

function toCanvas(px, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  return c;
}

export async function importPsdFile(file, onStatus = () => {}) {
  onStatus('Leyendo el PSD…');
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('./psd-worker.js', import.meta.url), { type: 'module' });
  const data = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El PSD tardó demasiado en leerse.')), 180000);
    worker.onmessage = (e) => { clearTimeout(timer); e.data?.error ? reject(new Error(e.data.error)) : resolve(e.data); };
    worker.onerror = (e) => { clearTimeout(timer); reject(e.error || new Error('No pude leer el PSD.')); };
    worker.postMessage({ buffer }, [buffer]);
  }).finally(() => worker.terminate());
  onStatus('Armando capas…');
  const layers = data.layers.map((l) => ({
    name: l.name, group: l.group, x: l.x, y: l.y, w: l.w, h: l.h,
    opacity: l.opacity, blend: l.blend, image: toCanvas(l.buffer, l.w, l.h),
  }));
  if (!layers.length) throw new Error('No encontré capas visibles con dibujo en el PSD.');
  return { name: file.name.replace(/\.psd$/i, ''), width: data.width, height: data.height, layers, skipped: data.skipped };
}

const natural = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No pude abrir ${file.name}`));
    img.src = url;
  });
}

function trimCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 2) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, -minX, -minY);
  return { x: minX, y: minY, image: out };
}

function plainCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/** Lee los formatos de índice que usamos (lista con nombre/x/y, dict por capa, o colocación del PSD con escala). */
function readIndex(idx) {
  const place = new Map();
  let order = Array.isArray(idx.orden_atras_a_adelante) ? idx.orden_atras_a_adelante.slice() : null;
  const scale = Number(idx.escala_capas_en_psd) || 1;
  if (Array.isArray(idx.psd_colocacion)) {
    order = order || [];
    for (const row of idx.psd_colocacion) {
      const [name, x, y] = row;
      place.set(String(name), { x: Number(x) || 0, y: Number(y) || 0, s: scale });
      if (!order.includes(name)) order.push(name);
    }
  } else if (Array.isArray(idx.capas)) {
    idx.capas.forEach((c, i) => {
      const name = String(c.nombre ?? c.name ?? `capa_${i}`);
      const w = Number(c.ancho ?? c.w ?? c.width) || 0;
      place.set(name, { x: Number(c.x) || 0, y: Number(c.y) || 0, w, s: 1, z: c.z ?? i });
    });
  } else if (idx.capas && typeof idx.capas === 'object') {
    for (const [name, c] of Object.entries(idx.capas)) {
      if (c && Number.isFinite(Number(c.x))) place.set(name, { x: Number(c.x), y: Number(c.y), s: 1, z: c.z });
    }
  }
  const size = Array.isArray(idx.lienzo) ? idx.lienzo : null;
  return { place, order, size };
}

export async function importPngFiles(fileList, onStatus = () => {}) {
  const files = [...fileList];
  const jsonFile = files.find((f) => /\.json$/i.test(f.name));
  const pngs = files.filter((f) => /\.(png|webp)$/i.test(f.name) && !/hoja_de_contactos/i.test(f.name));
  if (!pngs.length) throw new Error('No encontré PNG para armar la escena.');
  let index = null;
  if (jsonFile) {
    try { index = readIndex(JSON.parse(await jsonFile.text())); } catch { index = null; }
  }
  onStatus(`Abriendo ${pngs.length} PNG…`);
  const items = [];
  for (const f of pngs) items.push({ name: f.name.replace(/\.(png|webp)$/i, ''), img: await loadImage(f) });
  let width = index?.size?.[0] || 0;
  let height = index?.size?.[1] || 0;
  if (!width) {
    width = Math.max(...items.map((i) => i.img.naturalWidth));
    height = Math.max(...items.map((i) => i.img.naturalHeight));
  }
  const order = index?.order;
  items.sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    }
    const za = index?.place.get(a.name)?.z, zb = index?.place.get(b.name)?.z;
    if (za != null && zb != null && za !== zb) return za - zb;
    return natural.compare(a.name, b.name);
  });
  const layers = [];
  let unplaced = 0;
  for (const it of items) {
    const p = index?.place.get(it.name);
    const iw = it.img.naturalWidth, ih = it.img.naturalHeight;
    if (p) {
      const s = iw === width && ih === height ? 1 : p.s || 1;
      layers.push({ name: it.name, group: '', x: p.x, y: p.y, w: iw * s, h: ih * s, opacity: 1, blend: 'source-over', image: plainCanvas(it.img) });
    } else if (iw === width && ih === height) {
      const t = trimCanvas(it.img);
      if (t) layers.push({ name: it.name, group: '', x: t.x, y: t.y, w: t.image.width, h: t.image.height, opacity: 1, blend: 'source-over', image: t.image });
    } else {
      unplaced += 1;
      layers.push({ name: it.name, group: '', x: (width - iw) / 2, y: (height - ih) / 2, w: iw, h: ih, opacity: 1, blend: 'source-over', image: plainCanvas(it.img) });
    }
  }
  const base = jsonFile ? jsonFile.name.replace(/\.json$/i, '') : 'Escena';
  return { name: base === 'indice_capas' ? 'Escena PNG' : base, width, height, layers, unplaced };
}
