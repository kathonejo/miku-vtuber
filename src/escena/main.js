import './escena.css';
import { importPngFiles, importPsdFile } from './importer.js';
import {
  BEHAVIORS, EASINGS, OUTPUTS, PRESETS, applyPreset, autoMbps, defaultBase, defaultPivot, defaultPose,
  guessBehavior, isFragile, makeLayerSettings, makeSceneSettings, outputSize,
} from './model.js';
import { bake, cyclesFor, frac, keyPose, orbitAngle, orbitCenterLocal, orbitsOther, sample, sortedKeys } from './anim.js';
import { renderFrame, viewMatrix } from './render.js';
import { ExportCancelled, exportVideo } from './exporter.js';
import * as store from './store.js';
import { listBuiltins, loadBuiltin } from './builtins.js';

/* ---------- utilidades de DOM ---------- */
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/* ---------- estado ---------- */
const S = {
  scene: null,
  settings: null,
  baked: null,
  t: 0,
  playing: true,
  sel: -1,
  tab: 'capa',
  tool: 'ubicar',
  editPose: null, // pose en borrador (modo Animar) de la capa elegida
  selKey: null, // clave elegida en la línea de tiempo
  autoKey: false,
  dirty: true,
  exporting: false,
  source: null, // { kind: 'builtin', id } o { kind: 'import' }
  builtinJson: null,
  fullReady: null,
  builtins: [],
  rec: null, // grabación de recorrido en curso
  recSlow: false,
  recOrient: false,
  pick: null, // eligiendo el centro de una órbita con un clic
};

let lastExport = null; // { blob, url, name, ext, realtime } — el último video, para volver a bajarlo

/* ---------- estructura ---------- */
const app = $('#sc-app');
const statusEl = el('span', { class: 'sc-status', role: 'status' }, 'Abriendo tu escena…');
const fileInput = el('input', { type: 'file', multiple: true, accept: '.psd,.png,.webp,.json', hidden: true, id: 'sc-file' });
const playBtn = el('button', { type: 'button', class: 'sc-play', title: 'Reproducir o pausar (barra espaciadora)', onclick: () => setPlaying(!S.playing) }, '⏸ Pausa');
const exportTopBtn = el('button', { type: 'button', class: 'primary', title: 'Elegí tamaño y exportá el MP4', onclick: () => { setTab('exportar'); } }, 'Exportar video');
const artMenu = el('div', { class: 'sc-art-menu', hidden: true, role: 'menu' });
const top = el('header', { class: 'sc-top' },
  el('div', { class: 'sc-brand' },
    el('a', { href: './', class: 'sc-back', title: 'Volver a la marioneta VTuber' }, '← VTuber'),
    el('div', {}, el('strong', {}, 'Escena'), statusEl)),
  el('div', { class: 'sc-actions' },
    el('div', { class: 'sc-menu-wrap' },
      el('button', { type: 'button', class: 'sc-art-btn', title: 'Ilustraciones listas para animar, con sus capas ya separadas', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); toggleArtMenu(); } }, '🖼 Arte disponible'),
      artMenu),
    el('label', { class: 'btn', title: 'Un PSD con capas, o varios PNG (y su indice_capas.json si lo tenés)' }, 'Importar PSD o PNG', fileInput),
    playBtn, exportTopBtn));

const layerList = el('div', { class: 'sc-list', role: 'listbox', 'aria-label': 'Capas' });
const layersPane = el('aside', { class: 'sc-layers' },
  el('div', { class: 'sc-pane-head' }, el('h2', {}, 'Capas'), el('span', { class: 'sc-count' })),
  el('p', { class: 'sc-hint' }, 'Arriba = adelante, como en tu archivo.'),
  layerList);

const view = el('canvas', { class: 'sc-view', 'aria-label': 'Vista previa de la escena' });
const emptyArt = el('div', { class: 'sc-art-grid' });
const loadBox = el('div', { class: 'sc-loading', hidden: true },
  el('p', { class: 'sc-loading-text' }, 'Cargando…'),
  el('div', { class: 'sc-bar' }, el('i')));
const empty = el('div', { class: 'sc-empty' },
  el('div', { class: 'sc-card' },
    el('p', { class: 'eyebrow' }, 'Escena animada'),
    el('h1', {}, 'Tu ilustración, en movimiento'),
    loadBox,
    el('p', { class: 'lead' }, 'Elegí un dibujo para empezar: ya viene con sus capas y movimientos listos.'),
    emptyArt,
    el('p', { class: 'sc-small' }, '¿Tenés otro? ',
      el('label', { class: 'sc-link', title: 'Un PSD con capas, o varios PNG sueltos (con su indice_capas.json)' }, 'Importá tu PSD o tus PNG', el('input', { type: 'file', multiple: true, accept: '.psd,.png,.webp,.json', hidden: true, onchange: (e) => handleFiles(e.target.files) })),
      ' (lo que importás queda sólo en tu compu).')));
const fullBadge = el('span', { class: 'sc-full-badge', hidden: true, title: 'Mientras tanto ya podés mirar y tocar todo; el video se exporta con las capas completas' });
const timeLabel = el('span', { class: 'sc-time' }, '0.0 s');
const scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'sc-scrub', 'aria-label': 'Tiempo', title: 'Mové para ver cualquier momento del loop' });
const toolCapa = el('button', { type: 'button', class: 'sc-seg on', title: 'Ubicar: arrastrá la capa a donde quieras. Esquinas = tamaño, bolita de arriba = girar, punto celeste = pivote. Queda guardado como su lugar.', onclick: () => setTool('ubicar') }, '✥ Ubicar');
const toolAnim = el('button', { type: 'button', class: 'sc-seg', title: 'Animar: mové la línea de tiempo, poné la capa en otra pose y tocá “+ Clave”', onclick: () => setTool('animar') }, '◆ Animar');
const toolEnc = el('button', { type: 'button', class: 'sc-seg', title: 'Arrastrá para mover el encuadre; ruedita para zoom', onclick: () => setTool('encuadre') }, 'Encuadre');
const frameLabel = el('span', { class: 'sc-frame-label' });
const undoBtn = el('button', { type: 'button', class: 'sc-icon-btn', title: 'Deshacer (Ctrl+Z)', onclick: () => undo() }, '↶');
const redoBtn = el('button', { type: 'button', class: 'sc-icon-btn', title: 'Rehacer (Ctrl+Y)', onclick: () => redo() }, '↷');
const addKeyBtn = el('button', { type: 'button', class: 'sc-addkey', title: 'Guarda la pose de la capa elegida en este momento de la línea de tiempo', onclick: () => addKeyNow() }, '+ Clave');
const recBtn = el('button', { type: 'button', class: 'sc-recbtn', title: 'Grabar recorrido (R): después del 3-2-1, arrastrá la capa con el mouse mientras corre el tiempo', onclick: () => toggleRecording() }, '● Grabar');
const keyRow = el('div', { class: 'sc-keyrow', 'aria-label': 'Claves de la capa elegida' });
const countEl = el('div', { class: 'sc-count', hidden: true, 'aria-live': 'assertive' });
const recBadge = el('div', { class: 'sc-recbadge', hidden: true }, el('i'), el('span', {}, ''));
const stage = el('section', { class: 'sc-stage' },
  el('div', { class: 'sc-canvas-wrap' }, view, empty, countEl, recBadge),
  el('div', { class: 'sc-timeline' },
    el('div', { class: 'sc-segs' }, toolCapa, toolAnim, toolEnc),
    el('div', { class: 'sc-undo' }, undoBtn, redoBtn),
    timeLabel, el('div', { class: 'sc-scrub-wrap' }, keyRow, scrub), addKeyBtn, recBtn, frameLabel, fullBadge));

const props = el('div', { class: 'sc-props-body' });
const tabs = el('div', { class: 'sc-tabs', role: 'tablist' },
  ...[['capa', 'Capa'], ['escena', 'Escena'], ['exportar', 'Exportar']].map(([id, label]) =>
    el('button', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => setTab(id) }, label)));
const propsPane = el('aside', { class: 'sc-props' }, tabs, props);

const layout = el('main', { class: 'sc-layout' }, layersPane, stage, propsPane);
const progress = el('div', { class: 'sc-progress', hidden: true },
  el('div', { class: 'sc-card', role: 'dialog', 'aria-live': 'polite' },
    el('h2', { class: 'sc-progress-title' }, 'Exportando…'),
    el('div', { class: 'sc-bar' }, el('i')),
    el('p', { class: 'sc-progress-text' }, ''),
    el('p', { class: 'sc-progress-note sc-hint', hidden: true }, ''),
    el('video', { class: 'sc-progress-video', controls: true, playsinline: true, muted: true, loop: true, hidden: true }),
    el('div', { class: 'sc-card-actions' },
      el('button', { type: 'button', class: 'sc-progress-cancel', onclick: () => { S.cancel = true; $('.sc-progress-text', progress).textContent = 'Cancelando…'; } }, 'Cancelar'),
      el('a', { class: 'btn primary big sc-progress-dl', hidden: true }, 'Descargar video'),
      el('button', { type: 'button', class: 'primary sc-progress-share', hidden: true, onclick: () => shareExport() }, 'Guardar en el dispositivo'),
      el('a', { class: 'btn sc-progress-open', hidden: true, target: '_blank', rel: 'noopener' }, 'Abrir video'),
      el('button', { type: 'button', class: 'sc-progress-close', hidden: true, onclick: () => { progress.hidden = true; $('.sc-progress-video', progress).pause(); } }, 'Cerrar'))));
app.append(top, layout, progress);

/* ---------- importación ---------- */
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('drop'); handleFiles(e.dataTransfer.files); });

function setStatus(text) { statusEl.textContent = text; }

async function handleFiles(list) {
  const files = [...(list || [])];
  if (!files.length) return;
  const psd = files.find((f) => /\.psd$/i.test(f.name));
  try {
    document.body.classList.add('busy');
    const scene = psd ? await importPsdFile(psd, setStatus) : await importPngFiles(files, setStatus);
    const settingsFile = files.find((f) => /\.escena\.json$/i.test(f.name));
    S.source = { kind: 'import' };
    S.builtinJson = null;
    S.fullReady = null;
    fullBadge.hidden = true;
    openScene(scene);
    store.put('last', S.source).catch(() => {});
    if (settingsFile) applySettingsJson(JSON.parse(await settingsFile.text()));
    const extra = [];
    if (scene.skipped) extra.push(`salteé ${scene.skipped} capas ocultas`);
    if (scene.unplaced) extra.push(`${scene.unplaced} PNG sin posición (quedaron centrados)`);
    setStatus(`${scene.name}: ${scene.layers.length} capas${extra.length ? ` · ${extra.join(' · ')}` : ''}`);
    store.saveSceneImages(scene).then(() => { saveSettingsSoon(); refreshArt(); }).catch((err) => console.warn('No pude guardar la escena', err));
  } catch (err) {
    console.error(err);
    setStatus(`No pude abrir eso: ${err.message || err}`);
  } finally {
    document.body.classList.remove('busy');
  }
}

function openScene(scene, saved = null) {
  S.scene = scene;
  const settings = makeSceneSettings(scene);
  settings.layers = scene.layers.map((l, i) => makeLayerSettings(l, scene, i));
  const ar = scene.width / scene.height;
  settings.out.preset = Math.abs(ar - 2 / 3) < 0.05 ? '1440x2160' : Math.abs(ar - 20 / 9) < 0.08 ? '2560x1152' : ar < 1 ? '1080x1920' : '1920x1080';
  S.settings = settings;
  if (saved) applySettingsJson(saved, true);
  S.sel = -1;
  S.editPose = null;
  S.selKey = null;
  S.t = 0;
  hist.length = 0;
  histAt = -1;
  empty.hidden = true;
  document.body.classList.add('has-scene');
  rebake();
  renderList();
  renderProps();
  resize();
  recordNow();
}

/* ---------- arte disponible (dibujos incluidos) ---------- */
const mb = (b) => `${Math.round(b / 1e6)} MB`;

function artCard(item, small = false) {
  const on = S.source?.kind === 'builtin' && S.source.id === item.id;
  return el('button', {
    type: 'button', class: `sc-art${on ? ' on' : ''}${small ? ' small' : ''}`, role: 'menuitem',
    title: `Abrir “${item.nombre}” con sus capas y movimientos listos`,
    onclick: () => { artMenu.hidden = true; openBuiltin(item.id); },
  },
  item.portada ? el('img', { src: `/escenas/${item.id}/${item.portada}`, alt: '' }) : el('span', { class: 'sc-art-ph' }, '🖼'),
  el('span', { class: 'sc-art-txt' },
    el('strong', {}, item.nombre),
    el('span', {}, `${item.proporcion} · ${item.detalle || ''}`),
    el('span', { class: 'sc-art-size' }, on ? 'Abierto ahora' : `Baja ~${mb(item.prevBytes || 0)} para empezar`)));
}

async function refreshArt() {
  const hasImport = !!(await store.get('scene').catch(() => null))?.layers?.length;
  const lastImport = hasImport ? await store.get('scene') : null;
  artMenu.textContent = '';
  emptyArt.textContent = '';
  artMenu.append(el('p', { class: 'sc-menu-title' }, 'Arte disponible'));
  for (const it of S.builtins) { artMenu.append(artCard(it, true)); emptyArt.append(artCard(it)); }
  if (!S.builtins.length) artMenu.append(el('p', { class: 'sc-hint' }, 'No pude cargar la lista. Revisá la conexión.'));
  if (lastImport) {
    const reopen = () => { artMenu.hidden = true; openLastImport(); };
    artMenu.append(el('button', { type: 'button', class: 'sc-art small', role: 'menuitem', title: 'Vuelve a abrir lo último que importaste, con tus cambios', onclick: reopen },
      el('span', { class: 'sc-art-ph' }, '📂'),
      el('span', { class: 'sc-art-txt' }, el('strong', {}, lastImport.name), el('span', {}, `Tu última importación · ${lastImport.layers.length} capas`))));
  }
  artMenu.append(el('label', { class: 'sc-art small', title: 'Un PSD con capas, o varios PNG sueltos' },
    el('span', { class: 'sc-art-ph' }, '⬆'),
    el('span', { class: 'sc-art-txt' }, el('strong', {}, 'Importar PSD o PNG…'), el('span', {}, 'Queda sólo en tu compu')),
    el('input', { type: 'file', multiple: true, accept: '.psd,.png,.webp,.json', hidden: true, onchange: (e) => { artMenu.hidden = true; handleFiles(e.target.files); } })));
}

function toggleArtMenu(force) {
  artMenu.hidden = force != null ? !force : !artMenu.hidden;
  if (!artMenu.hidden) refreshArt();
}
document.addEventListener('click', (e) => { if (!artMenu.hidden && !e.target.closest('.sc-menu-wrap')) artMenu.hidden = true; });

function showLoading(text, p) {
  empty.hidden = false;
  empty.classList.add('is-loading');
  loadBox.hidden = false;
  $('.sc-loading-text', loadBox).textContent = text;
  $('.sc-bar i', loadBox).style.width = `${Math.round(p * 100)}%`;
}
function hideLoading() {
  empty.classList.remove('is-loading');
  loadBox.hidden = true;
}

let openToken = 0;
async function openBuiltin(id) {
  const item = S.builtins.find((b) => b.id === id) || { id, nombre: id };
  const token = ++openToken;
  const hadScene = !!S.scene;
  try {
    if (!hadScene) showLoading(`Cargando “${item.nombre}”… 0%`, 0);
    setStatus(`Cargando “${item.nombre}”…`);
    const res = await loadBuiltin(id, {
      onPreview: (p) => {
        if (token !== openToken) return;
        if (!hadScene) showLoading(`Cargando “${item.nombre}”… ${Math.round(p * 100)}%`, p);
        else setStatus(`Cargando “${item.nombre}”… ${Math.round(p * 100)}%`);
      },
      onFull: (p) => {
        if (token !== openToken) return;
        fullBadge.textContent = `Calidad completa ${Math.round(p * 100)}%`;
      },
    });
    if (token !== openToken) return;
    S.source = { kind: 'builtin', id };
    S.builtinJson = res.json;
    const saved = await store.get(settingsKey()).catch(() => null);
    openScene(res.scene, saved || res.json.settings);
    hideLoading();
    store.put('last', S.source).catch(() => {});
    setStatus(`${item.nombre}: ${res.scene.layers.length} capas${saved ? ' · con tus cambios' : ''}`);
    fullBadge.hidden = false;
    fullBadge.textContent = 'Calidad completa 0%';
    S.fullReady = res.full.then(() => {
      if (token !== openToken) return;
      fullBadge.hidden = true;
      S.dirty = true;
      renderList();
    });
    S.fullReady.catch(() => { fullBadge.textContent = 'No pude bajar la calidad completa'; });
    refreshArt();
  } catch (err) {
    console.error(err);
    hideLoading();
    empty.hidden = !!S.scene;
    setStatus(`No pude abrir “${item.nombre}”: ${err.message || err}`);
  }
}

async function openLastImport() {
  const token = ++openToken;
  setStatus('Abriendo tu última importación…');
  const scene = await store.loadSceneImages();
  if (!scene || token !== openToken) return false;
  const saved = await store.get('settings');
  S.source = { kind: 'import' };
  S.builtinJson = null;
  S.fullReady = null;
  fullBadge.hidden = true;
  openScene(scene, saved && saved.escena?.nombre === scene.name ? saved : null);
  store.put('last', S.source).catch(() => {});
  setStatus(`Recuperé “${scene.name}” (${scene.layers.length} capas) de la última vez`);
  refreshArt();
  return true;
}

function resetBuiltin() {
  if (!S.builtinJson) return;
  const json = S.builtinJson;
  const settings = makeSceneSettings(S.scene);
  settings.layers = S.scene.layers.map((l, i) => makeLayerSettings(l, S.scene, i));
  S.settings = settings;
  applySettingsJson(json.settings, true);
  S.editPose = null;
  S.sel = -1;
  resize();
  changed(true);
  flash('Volvió a como venía original');
}

/* ---------- ajustes: guardar / cargar ---------- */
function settingsJson() {
  const s = S.settings;
  return {
    tipo: 'escena-bunny-vtuber', version: 2,
    escena: { nombre: S.scene.name, ancho: S.scene.width, alto: S.scene.height },
    duration: s.duration, loop: s.loop, fps: s.fps, effects: s.effects, out: s.out,
    layers: S.scene.layers.map((l, i) => ({ name: l.name, group: l.group, ...s.layers[i] })),
  };
}

function applySettingsJson(json, quiet = false) {
  if (!json || !Array.isArray(json.layers)) { if (!quiet) setStatus('Ese archivo no tiene ajustes de escena.'); return; }
  const s = S.settings;
  for (const k of ['duration', 'loop', 'fps']) if (json[k] != null) s[k] = json[k];
  if (json.effects) Object.assign(s.effects, json.effects);
  if (json.out) Object.assign(s.out, json.out);
  const used = new Set();
  let matched = 0;
  S.scene.layers.forEach((l, i) => {
    let j = json.layers.findIndex((x, k) => !used.has(k) && x.name === l.name && (x.group ?? '') === (l.group ?? ''));
    if (j < 0) j = json.layers.findIndex((x, k) => !used.has(k) && x.name === l.name);
    if (j < 0) return;
    used.add(j);
    const { name, group, ...rest } = json.layers[j];
    // Versión 1: "Mover poco" venía prendido en muchas capas; ahora arranca apagado (se sugiere con ⚠).
    if ((json.version || 1) < 2) rest.poco = false;
    s.layers[i] = {
      ...s.layers[i], ...rest,
      kf: { ...s.layers[i].kf, ...(rest.kf || {}) },
      base: { ...defaultBase(), ...(rest.base || {}) },
      keys: Array.isArray(rest.keys) ? rest.keys.map((k) => ({ ...k })) : [],
    };
    legacyToKeys(s.layers[i], s.duration, s.loop);
    matched += 1;
  });
  if (!quiet) setStatus(`Ajustes cargados en ${matched} de ${S.scene.layers.length} capas.`);
  changed(true);
}

/* Animación vieja inicio→fin: se pasa a claves (mismo movimiento, ahora editable en la línea de tiempo). */
function legacyToKeys(set, D, loop) {
  const kf = set.kf;
  if (!kf?.on || set.keys?.length) return;
  const c = Math.max(1, Math.round(cyclesFor(kf.period || D, D, loop)));
  const pattern = kf.hold ? [[0, 'a'], [0.4, 'b'], [0.5, 'b'], [0.9, 'a']] : [[0, 'a'], [0.5, 'b']];
  const keys = [];
  for (let n = 0; n < Math.min(c, 8); n += 1) {
    for (const [u, w] of pattern) keys.push({ t: round(frac((u - (set.phase || 0) + n) / c), 4), ...kf[w], ease: kf.ease || 'inout' });
  }
  set.keys = keys.sort((a, b) => a.t - b.t);
  kf.on = false;
}

/* ---------- deshacer / rehacer ---------- */
const hist = [];
let histAt = -1;
let histTimer = 0;
function snapshot() {
  const s = S.settings;
  return JSON.stringify({ layers: s.layers, effects: s.effects, duration: s.duration, loop: s.loop });
}
function recordNow() {
  if (!S.settings || S._restoring) return;
  clearTimeout(histTimer);
  const snap = snapshot();
  if (hist[histAt] === snap) return;
  hist.length = histAt + 1;
  hist.push(snap);
  if (hist.length > 120) hist.shift();
  histAt = hist.length - 1;
  updateUndo();
}
function recordSoon() { clearTimeout(histTimer); histTimer = setTimeout(recordNow, 450); }
function restore(snap) {
  const j = JSON.parse(snap);
  S._restoring = true;
  S.settings.layers = j.layers;
  Object.assign(S.settings.effects, j.effects);
  S.settings.duration = j.duration;
  S.settings.loop = j.loop;
  S.editPose = null;
  S.selKey = null;
  rebake();
  renderList();
  renderProps();
  saveSettingsSoon();
  S._restoring = false;
  updateUndo();
}
function undo() {
  if (S.rec) { cancelRecording(); return; }
  recordNow();
  if (histAt <= 0) { flash('No hay nada para deshacer'); return; }
  histAt -= 1;
  restore(hist[histAt]);
  flash('Deshecho');
}
function redo() {
  if (S.rec) return;
  if (histAt >= hist.length - 1) { flash('No hay nada para rehacer'); return; }
  histAt += 1;
  restore(hist[histAt]);
  flash('Rehecho');
}
function updateUndo() {
  undoBtn.disabled = histAt <= 0;
  redoBtn.disabled = histAt >= hist.length - 1;
}

let saveTimer = 0;
/* Lo que cambiás en un dibujo incluido se guarda aparte: tu importación nunca lo pisa (ni al revés). */
function settingsKey() {
  return S.source?.kind === 'builtin' ? `settings:builtin:${S.source.id}` : 'settings';
}
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (S.scene) store.put(settingsKey(), settingsJson()).catch(() => {}); }, 600);
}

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- horneado y cambios ---------- */
function rebake() {
  const edit = S.editPose && S.sel >= 0 ? { index: S.sel, pose: S.editPose } : null;
  S.baked = bake(S.scene, S.settings, edit);
  S.dirty = true;
}

let bakeTimer = 0;
function changed(full = false) {
  cancelAnimationFrame(bakeTimer);
  bakeTimer = requestAnimationFrame(() => rebake());
  saveSettingsSoon();
  recordSoon();
  if (full) { renderList(); renderProps(); }
}

/* ---------- lista de capas ---------- */
const ICON = { none: '·', flotar: '≈', balanceo: '〰', deriva: '→', brillo: '✦', orbitar: '◯', latido: '♥', aparecer: '◐', recorrido: '⤳' };

function thumbOf(layer) {
  if (layer._thumb) return layer._thumb;
  const c = document.createElement('canvas');
  c.width = 44; c.height = 44;
  const g = c.getContext('2d');
  const s = Math.min(40 / layer.w, 40 / layer.h);
  g.imageSmoothingQuality = 'high';
  let src = layer.image;
  while (src.width * s < src.width / 2 && src.width > 256) {
    const d = document.createElement('canvas');
    d.width = Math.ceil(src.width / 2); d.height = Math.ceil(src.height / 2);
    d.getContext('2d').drawImage(src, 0, 0, d.width, d.height);
    src = d;
  }
  g.drawImage(src, (44 - layer.w * s) / 2, (44 - layer.h * s) / 2, layer.w * s, layer.h * s);
  layer._thumb = c.toDataURL();
  return layer._thumb;
}

function renderList() {
  layerList.textContent = '';
  if (!S.scene) return;
  $('.sc-count', layersPane).textContent = String(S.scene.layers.length);
  let lastGroup = null;
  for (let i = S.scene.layers.length - 1; i >= 0; i -= 1) {
    const l = S.scene.layers[i];
    const s = S.settings.layers[i];
    if ((l.group || '') !== lastGroup) {
      lastGroup = l.group || '';
      if (lastGroup) layerList.append(el('div', { class: 'sc-group' }, '▾ ', lastGroup));
    }
    const beh = BEHAVIORS.find((b) => b[0] === s.beh.type);
    layerList.append(el('div', {
      class: `sc-item${i === S.sel ? ' sel' : ''}${s.visible ? '' : ' off'}${l.group ? ' in-group' : ''}`,
      role: 'option', 'aria-selected': String(i === S.sel), 'data-i': i,
      onclick: () => select(i),
    },
    el('img', { src: thumbOf(l), alt: '' }),
    el('span', { class: 'sc-name', title: l.name }, l.name),
    s.poco ? el('span', { class: 'sc-badge', title: 'Mover poco: limitado para que no se vea el hueco detrás' }, '🔒')
      : isFragile(l) ? el('span', { class: 'sc-badge warn', title: 'Puede que no tenga relleno detrás: si la movés mucho se puede ver el hueco. Si pasa, prendé “Mover poco” en la capa.' }, '⚠') : null,
    s.keys?.length ? el('span', { class: 'sc-badge', title: `${s.keys.length} claves de animación` }, '◆') : null,
    el('span', { class: `sc-chip b-${s.beh.type}`, title: beh?.[2] }, ICON[s.beh.type] || '·'),
    el('button', {
      type: 'button', class: 'sc-eye', title: s.visible ? 'Ocultar capa' : 'Mostrar capa',
      onclick: (e) => { e.stopPropagation(); s.visible = !s.visible; changed(true); },
    }, s.visible ? '👁' : '–')));
  }
}

function select(i) {
  if (S.rec && i !== S.rec.i) cancelRecording();
  if (S.pick && i !== S.pick.i) { S.pick = null; view.style.cursor = ''; }
  if (i !== S.sel) { S.editPose = null; S.selKey = null; }
  S.sel = i;
  if (S.tab !== 'capa' && i >= 0) S.tab = 'capa';
  rebake();
  renderList();
  renderProps();
  const item = layerList.querySelector(`[data-i="${i}"]`);
  item?.scrollIntoView({ block: 'nearest' });
}

/* ---------- controles ---------- */
/* Deslizador + casillero para escribir el número (se puede escribir más allá del deslizador). */
function slider(label, tip, value, min, max, step, onInput, fmt = (v) => v) {
  const pct = /^50\s?%/.test(String(fmt(0.5)));
  const k = pct ? 100 : 1;
  const unitOf = (v) => String(fmt(v)).replace(/^[-−]?[\d.,]+\s?/, '');
  const unit = el('span', { class: 'sc-unit' }, unitOf(value));
  const shown = (v) => String(round(v * k, step * k < 1 ? 2 : 1));
  const num = el('input', { type: 'number', class: 'sc-num', step: String(step * k), value: shown(value), 'aria-label': label });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); num.value = shown(v); unit.textContent = unitOf(v); onInput(v); });
  num.addEventListener('change', () => {
    const v = Number(num.value) / k;
    if (!Number.isFinite(v)) return;
    input.value = String(v);
    unit.textContent = unitOf(v);
    onInput(v);
  });
  num.addEventListener('keydown', (e) => e.stopPropagation());
  return el('label', { class: 'sc-field', title: tip }, el('span', { class: 'sc-label' }, el('span', {}, label), el('span', { class: 'sc-val' }, num, unit)), input);
}
function toggle(label, tip, value, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = Boolean(value);
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'sc-toggle', title: tip }, input, el('span', {}, label));
}
function select_(label, tip, value, options, onChange) {
  const s = el('select', { onchange: (e) => onChange(e.target.value) },
    ...options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
  return el('label', { class: 'sc-field', title: tip }, el('span', { class: 'sc-label' }, label), s);
}
function color(label, tip, value, onInput) {
  const i = el('input', { type: 'color', value });
  i.addEventListener('input', () => onInput(i.value));
  return el('label', { class: 'sc-field sc-color', title: tip }, el('span', { class: 'sc-label' }, label), i);
}
const section = (title, ...kids) => el('section', { class: 'sc-sec' }, el('h3', {}, title), ...kids);
const row = (...kids) => el('div', { class: 'sc-row' }, ...kids);
const btn = (label, tip, onclick, cls = '') => el('button', { type: 'button', title: tip, class: cls, onclick }, label);

function setTab(id) {
  S.tab = id;
  renderProps();
}

function renderProps() {
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  props.textContent = '';
  if (!S.scene) {
    props.append(el('p', { class: 'sc-hint pad' }, 'Primero importá una escena.'));
    return;
  }
  if (S.tab === 'capa') renderLayerProps();
  else if (S.tab === 'escena') renderSceneProps();
  else renderExportProps();
  renderKeyRow();
  markPending();
}

function renderLayerProps() {
  const i = S.sel;
  if (i < 0) {
    props.append(el('div', { class: 'sc-empty-props' }, helpBox(),
      el('p', {}, 'Tocá una capa en la lista o en la vista para moverla o darle movimiento.'),
      el('p', { class: 'sc-hint' }, 'Con ✥ Ubicar la arrastrás a cualquier lugar. Con ◆ Animar le das claves en la línea de tiempo.'),
      el('p', { class: 'sc-hint' }, 'Consejo: empezá por un preset en la pestaña Escena y después ajustá de a una.')));
    return;
  }
  const l = S.scene.layers[i];
  const s = S.settings.layers[i];
  const W = S.scene.width, H = S.scene.height;
  const D = S.settings.duration;
  props.append(el('div', { class: 'sc-layer-title' }, helpBox(), el('strong', {}, l.name), l.group ? el('span', {}, l.group) : null));

  /* Ubicación: dónde vive la capa (se guarda), aparte de la animación. */
  const B = s.base || (s.base = defaultBase());
  const setB = (k, v) => { B[k] = v; changed(); };
  props.append(section('Ubicación',
    el('p', { class: 'sc-hint' }, 'Arrastrala en la vista con ✥ Ubicar. Esquinas = tamaño, bolita de arriba = girar. Flechas del teclado = de a poquito.'),
    slider('X', 'Correr a los costados', round(B.dx), -W, W, 1, (v) => setB('dx', v), (v) => `${Math.round(v)} px`),
    slider('Y', 'Subir o bajar', round(B.dy), -H, H, 1, (v) => setB('dy', v), (v) => `${Math.round(v)} px`),
    slider('Giro', 'Rotar desde el pivote', round(B.rot, 1), -180, 180, 0.5, (v) => setB('rot', v), (v) => `${v}°`),
    slider('Tamaño', 'Agrandar o achicar', B.sc ?? 1, 0.1, 4, 0.01, (v) => setB('sc', Math.max(0.02, v)), (v) => `${Math.round(v * 100)}%`),
    btn('↺ A su lugar original', 'Vuelve la capa a donde estaba en tu archivo', () => { s.base = defaultBase(); changed(true); })));

  const segs = el('div', { class: 'sc-behs' }, ...BEHAVIORS.map(([id, label, tip]) => btn(`${ICON[id]} ${label}`, tip, () => {
    const guess = guessBehavior(l, S.scene);
    const defaults = {
      flotar: { amp: 0.02 * H, period: 6, rot: 0.5, pulse: 0 },
      balanceo: { amp: 6, period: 4, stiff: 0.45 },
      deriva: { period: D, rot: 0, dir: 'der' },
      brillo: { depth: 0.5, glow: 0.7, period: 3 },
      orbitar: { rx: Math.round(0.08 * W), ry: Math.round(0.05 * H), period: 6, dir: 1, spin: false, center: 'self' },
      latido: { amount: 0.12, period: 2, heart: false },
      aparecer: { show: 0.5, soft: 0.7, min: 0, period: 4 },
      recorrido: { orient: false, period: D },
      none: {},
    }[id];
    s.beh = { ...defaults, ...(guess.type === id ? guess : {}), type: id };
    setPivot(s, defaultPivot(l, id));
    if (id === 'recorrido' && (s.keys?.length || 0) < 2) { setTool('animar'); flash('Recorrido: agregá 2 o más claves con “+ Clave”'); }
    changed(true);
  }, s.beh.type === id ? 'on' : '')));
  const b = s.beh;
  const cyc = (p) => `${round(p, 1)} s${S.settings.loop ? ` · ${cyclesFor(p, D, true)}×` : ''}`;
  const pc = (v) => `${Math.round(v * 100)}%`;
  const params = [];
  if (b.type === 'flotar') {
    params.push(slider('Altura', 'Cuánto sube y baja, en píxeles del archivo', round(b.amp), 0, Math.round(H * 0.25), 1, (v) => { b.amp = v; changed(); }, (v) => `${Math.round(v)} px`));
    params.push(slider('Ritmo', 'Segundos por vuelta (se ajusta para que el loop cierre perfecto)', b.period, 1, 20, 0.5, (v) => { b.period = v; changed(); }, cyc));
    params.push(slider('Giro', 'Cuánto se ladea al flotar, en grados', b.rot || 0, 0, 45, 0.1, (v) => { b.rot = v; changed(); }, (v) => `${v}°`));
    params.push(slider('Pulso de tamaño', 'Se agranda y achica un poco mientras flota', b.pulse || 0, 0, 0.5, 0.01, (v) => { b.pulse = v; changed(); }, pc));
  } else if (b.type === 'balanceo') {
    params.push(slider('Ángulo', 'Cuánto se mece, en grados', b.amp, 0, 45, 0.5, (v) => { b.amp = v; changed(); }, (v) => `${v}°`));
    params.push(slider('Ritmo', 'Segundos por vaivén', b.period, 1, 12, 0.5, (v) => { b.period = v; changed(); }, cyc));
    params.push(slider('Rigidez', 'Más bajo = más elástico y rebota más', b.stiff ?? 0.45, 0, 1, 0.05, (v) => { b.stiff = v; changed(); }, pc));
  } else if (b.type === 'deriva') {
    params.push(select_('Hacia', 'Para qué lado viaja', b.dir || 'der', [['der', '→ Derecha'], ['izq', '← Izquierda'], ['arriba', '↑ Arriba'], ['abajo', '↓ Abajo']], (v) => { b.dir = v; changed(); }));
    params.push(slider('Ritmo', 'Segundos en cruzar toda la escena', b.period, 2, Math.max(30, D), 0.5, (v) => { b.period = v; changed(); }, cyc));
    params.push(el('p', { class: 'sc-hint' }, 'Cruza toda la escena y vuelve a entrar por el otro lado.'));
  } else if (b.type === 'brillo') {
    params.push(slider('Titileo', 'Cuánto baja su luz al latir', b.depth ?? 0.5, 0, 1, 0.05, (v) => { b.depth = v; changed(); }, pc));
    params.push(slider('Resplandor', 'Brillo suave alrededor, hecho con su propio dibujo', b.glow ?? 0.6, 0, 1.5, 0.05, (v) => { b.glow = v; changed(); }, pc));
    params.push(slider('Ritmo', 'Segundos por latido', b.period, 0.5, 10, 0.25, (v) => { b.period = v; changed(); }, cyc));
  } else if (b.type === 'orbitar') {
    const mode = orbitsOther(b) ? b.center : 'self';
    params.push(select_('Alrededor de', 'Qué centro usa para dar vueltas', mode,
      [['self', 'Su propio lugar'], ['layer', 'Otra capa (ej.: la espada)'], ['point', 'Un punto que elijo']], (v) => {
        if (v === 'layer') setOrbitCenter(i, 'layer', b.centerLayer ?? defaultCenterLayer(i));
        else if (v === 'point') startPickCenter(i);
        else setOrbitCenter(i, 'self');
      }));
    if (mode === 'layer') {
      const opts = S.scene.layers.map((x, k) => [String(k), x.name]).filter(([k]) => Number(k) !== i);
      params.push(select_('Capa del centro', 'Da vueltas alrededor de esta capa. Si esa capa se mueve, la vuelta la sigue', String(b.centerLayer), opts, (v) => setOrbitCenter(i, 'layer', Number(v))));
      params.push(select_('Punto de esa capa', 'Desde dónde se mide el centro', b.centerUse || 'centro', [['centro', 'Su centro'], ['pivote', 'Su pivote (punto celeste)']], (v) => { b.centerUse = v; setOrbitCenter(i, 'layer', b.centerLayer); }));
    }
    if (mode === 'point') params.push(row(btn('📍 Elegir el punto', 'Tocá en la vista dónde va el centro de la vuelta', () => startPickCenter(i))));
    if (mode !== 'self') params.push(el('p', { class: 'sc-hint' }, 'Para acercarla o alejarla, arrastrá la capa o las bolitas rosas del óvalo.' + (mode === 'point' ? ' La cruz rosa es el centro: también se arrastra.' : '')));
    params.push(slider('Ancho', 'Qué tan ancha es la vuelta', round(b.rx ?? 0), 0, W, 1, (v) => { b.rx = v; changed(); }, (v) => `${Math.round(v)} px`));
    params.push(slider('Alto', 'Qué tan alta es la vuelta (igual al ancho = círculo)', round(b.ry ?? 0), 0, H, 1, (v) => { b.ry = v; changed(); }, (v) => `${Math.round(v)} px`));
    params.push(row(btn('◯ Círculo', 'Mismo ancho y alto', () => { b.ry = b.rx; changed(true); }), btn('⬭ Óvalo', 'Más ancho que alto', () => { b.ry = Math.round((b.rx || 0) * 0.5); changed(true); })));
    if (S.settings.loop) {
      const turns = b.turns || cyclesFor(b.period, D, true);
      params.push(slider('Vueltas por loop', 'Cuántas vueltas completas da en cada loop (siempre entero, así cierra perfecto)', turns, 1, 12, 1, (v) => { b.turns = Math.round(v); changed(); }, (v) => `${v} · ${round(D / v, 1)} s c/u`));
    } else {
      params.push(slider('Ritmo', 'Segundos por vuelta', b.period, 1, 30, 0.5, (v) => { b.period = v; b.turns = null; changed(); }, cyc));
    }
    params.push(select_('Sentido', 'Para qué lado gira', String(b.dir || 1), [['1', '↻ Como el reloj'], ['-1', '↺ Al revés del reloj']], (v) => { b.dir = Number(v); changed(); }));
    params.push(toggle('Girar con la vuelta', 'La capa también rota mientras orbita', b.spin, (v) => { b.spin = v; changed(); }));
  } else if (b.type === 'latido') {
    params.push(slider('Cuánto', 'Cuánto se agranda en cada latido', b.amount ?? 0.15, 0, 1, 0.01, (v) => { b.amount = v; changed(); }, pc));
    params.push(slider('Ritmo', 'Segundos por latido', b.period, 0.5, 10, 0.25, (v) => { b.period = v; changed(); }, cyc));
    params.push(toggle('Como corazón', 'Doble golpe: pum-pum… pausa', b.heart, (v) => { b.heart = v; changed(); }));
  } else if (b.type === 'aparecer') {
    params.push(slider('Tiempo visible', 'Qué parte de cada vuelta se ve', b.show ?? 0.5, 0.1, 0.9, 0.05, (v) => { b.show = v; changed(); }, pc));
    params.push(slider('Suavidad', 'Más alto = se desvanece más lento', b.soft ?? 0.7, 0.1, 1, 0.05, (v) => { b.soft = v; changed(); }, pc));
    params.push(slider('Mínimo', 'Cuánto se sigue viendo cuando “desaparece”', b.min ?? 0, 0, 1, 0.05, (v) => { b.min = v; changed(); }, pc));
    params.push(slider('Ritmo', 'Segundos por aparición', b.period, 1, 20, 0.5, (v) => { b.period = v; changed(); }, cyc));
  } else if (b.type === 'recorrido') {
    params.push(el('p', { class: 'sc-hint' }, 'Sigue una curva suave que pasa por todas tus claves (la línea punteada en la vista).'));
    if ((s.keys?.length || 0) < 2 && !S.rec) params.push(el('p', { class: 'sc-warn' }, '⚠ Necesita 2 o más claves. Pasá a ◆ Animar, mové la línea de tiempo, arrastrá la capa y tocá “+ Clave”.'));
    params.push(toggle('Mirar hacia adelante', 'La capa gira para apuntar hacia donde va', b.orient, (v) => { b.orient = v; changed(); }));
  }
  props.append(section('Movimiento', segs, ...params));

  props.append(section('Grabar recorrido',
    el('p', { class: 'sc-hint' }, 'Después del 3-2-1, arrastrá la capa con el mouse mientras corre el tiempo: el camino queda guardado como claves.'),
    btn(S.rec ? '■ Terminar' : '● Grabar recorrido (R)', 'Graba lo que arrastres durante una vuelta del loop. Grabar de nuevo reemplaza el anterior (Ctrl+Z deshace)', () => toggleRecording(), 'sc-rec-go'),
    toggle('Grabar más lento', 'El tiempo corre a mitad de velocidad mientras grabás: más fácil ser preciso. El video queda a velocidad normal', S.recSlow, (v) => { S.recSlow = v; }),
    toggle('Girar mirando el recorrido', 'La capa gira para apuntar hacia donde va', S.recOrient, (v) => { S.recOrient = v; })));

  props.append(keySection(i, l, s));

  props.append(section('Ritmo propio',
    row(slider('Desfase', 'Corre su movimiento en el tiempo para que no vaya igual que las demás', s.phase, 0, 1, 0.01, (v) => { s.phase = v; changed(); }, pc),
      btn('🎲', 'Desfase aleatorio para esta capa', () => { s.phase = round(Math.random(), 2); changed(true); }, 'sc-icon'))));

  props.append(section('Pivote',
    row(btn('Pivote abajo', 'Para pasto, flores, orejas: se mece desde la base', () => { setPivot(s, defaultPivot(l, 'balanceo')); changed(); }),
      btn('Pivote al centro', 'Gira desde el medio', () => { setPivot(s, defaultPivot(l, 'flotar')); changed(); })),
    el('p', { class: 'sc-hint' }, 'O arrastrá el punto celeste en la vista.')));

  const maxPoco = Math.round(Math.max(W, H) * 0.05);
  props.append(section('Cuidado con los huecos',
    isFragile(l) && !s.poco ? el('p', { class: 'sc-hint' }, '⚠ Esta capa puede no tener relleno detrás. Si al moverla se ve un hueco, prendé “Mover poco”.') : null,
    toggle('Mover poco', 'Para capas sin relleno detrás: limita cuánto se puede mover la animación (no su ubicación)', s.poco, (v) => { s.poco = v; changed(true); }),
    s.poco ? slider('Máximo', 'Lo más que se puede correr, en píxeles del archivo', s.maxMove, 1, maxPoco, 1, (v) => { s.maxMove = v; changed(); }, (v) => `${v} px`) : null));

  const parentOpts = [['', 'Ninguna (se mueve sola)'], ...S.scene.layers.map((x, k) => [String(k), x.name]).filter(([k]) => Number(k) !== i)];
  props.append(section('Seguir a otra capa',
    select_('Sigue a', 'Se mueve junto con esa capa, como pegada', s.parent ?? '', parentOpts, (v) => {
      s.parent = v === '' ? null : Number(v);
      if (s.parent != null && !s.follow) s.follow = 0.6;
      changed(true);
    }),
    s.parent != null ? slider('Rebote al seguir', 'Física secundaria: se queda atrás y rebota cuando la otra se mueve', s.follow || 0, 0, 2, 0.05, (v) => { s.follow = v; changed(); }, pc) : null));
}

/* ---------- claves ---------- */
const fmtT = (t) => `${round(t * S.settings.duration, 1)} s`;

/** Pose de la capa en el momento actual según sus claves (o la que estás editando). */
function poseNow(i) {
  if (S.editPose && S.sel === i) return S.editPose;
  const set = S.settings.layers[i];
  const p = keyPose(sortedKeys(set), frac(S.t / S.settings.duration), S.settings.loop, set.beh?.type === 'recorrido');
  return p ? { ...p } : defaultPose();
}
function startDraft() {
  if (!S.editPose) S.editPose = { ...poseNow(S.sel) };
  setPlaying(false);
  return S.editPose;
}
function keyAtNow(set) {
  const D = S.settings.duration;
  const u = frac(S.t / D);
  const tol = 0.6 / (D * (S.settings.fps || 30));
  return (set.keys || []).find((k) => Math.min(Math.abs(k.t - u), 1 - Math.abs(k.t - u)) < tol) || null;
}
function addKeyNow() {
  if (S.sel < 0) { flash('Primero elegí una capa'); return; }
  const set = S.settings.layers[S.sel];
  set.keys = set.keys || [];
  const pose = { ...poseNow(S.sel) };
  let k = keyAtNow(set);
  const fresh = !k;
  if (k) Object.assign(k, pose);
  else { k = { t: round(frac(S.t / S.settings.duration), 4), ...pose, ease: 'inout' }; set.keys.push(k); }
  set.keys.sort((a, b) => a.t - b.t);
  S.selKey = k;
  S.editPose = null;
  changed(true);
  recordNow();
  flash(fresh ? `◆ Clave en ${fmtT(k.t)}${set.keys.length === 1 ? ' · mové el tiempo y agregá otra' : ''}` : `◆ Clave de ${fmtT(k.t)} actualizada`);
}
function deleteKey(set, k) {
  set.keys = (set.keys || []).filter((x) => x !== k);
  if (S.selKey === k) S.selKey = null;
  S.editPose = null;
  changed(true);
  recordNow();
  flash('Clave borrada');
}

function keySection(i, l, s) {
  const keys = sortedKeys(s);
  s.keys = keys;
  const d = S.editPose && S.sel === i ? S.editPose : poseNow(i);
  const W = S.scene.width, H = S.scene.height;
  const setD = (k, v) => { const p = startDraft(); p[k] = v; if (S.tool !== 'animar') setTool('animar'); rebake(); markPending(); };
  const kids = [
    el('p', { class: 'sc-hint' }, '1) Mové la línea de tiempo. 2) Con ◆ Animar, arrastrá, girá o agrandá la capa. 3) Tocá “+ Clave”. Con 2 o más claves se mueve sola; con Loop perfecto la última vuelve a la primera.'),
    toggle('Auto-clave', 'Cada vez que soltás la capa en modo Animar, se guarda la clave sola', S.autoKey, (v) => { S.autoKey = v; flash(v ? 'Auto-clave prendida' : 'Auto-clave apagada'); }),
    row(btn(`+ Clave en ${fmtT(frac(S.t / S.settings.duration))}`, 'Guarda la pose de ahora en este momento', addKeyNow, 'primary'),
      keys.length ? btn('Borrar todas', 'Saca todas las claves de esta capa', () => { s.keys = []; S.selKey = null; S.editPose = null; changed(true); recordNow(); }) : null),
  ];
  if (keys.length) {
    kids.push(el('div', { class: 'sc-keys' }, ...keys.map((k, n) => el('div', { class: `sc-key${k === S.selKey ? ' sel' : ''}` },
      btn(`◆ ${fmtT(k.t)}`, 'Ir a esta clave', () => { S.selKey = k; S.editPose = null; setPlaying(false); S.t = k.t * S.settings.duration; S.dirty = true; renderProps(); renderKeyRow(); }, 'sc-key-go'),
      select_('', n === keys.length - 1 && !S.settings.loop ? 'Última clave: se queda quieta acá' : 'Cómo va desde esta clave hasta la siguiente', k.ease || 'inout', EASINGS, (v) => { k.ease = v; changed(); }),
      btn('🗑', 'Borrar esta clave', () => deleteKey(s, k), 'sc-icon')))));
  }
  kids.push(el('details', { class: 'sc-pose', open: !!S.editPose },
    el('summary', {}, 'Pose en este momento (con números)'),
    slider('X', 'Correr a los costados', round(d.dx), -W, W, 1, (v) => setD('dx', v), (v) => `${Math.round(v)} px`),
    slider('Y', 'Subir o bajar', round(d.dy), -H, H, 1, (v) => setD('dy', v), (v) => `${Math.round(v)} px`),
    slider('Giro', 'Rotar desde el pivote', round(d.rot, 1), -360, 360, 0.5, (v) => setD('rot', v), (v) => `${v}°`),
    slider('Tamaño', 'Agrandar o achicar', d.sc, 0.05, 4, 0.01, (v) => setD('sc', v), (v) => `${Math.round(v * 100)}%`),
    slider('Opacidad', 'Transparencia', d.op, 0, 1, 0.01, (v) => setD('op', Math.max(0, Math.min(1, v))), (v) => `${Math.round(v * 100)}%`)));
  return section('Animación con claves', ...kids);
}

/** Cambia el pivote sin que la capa salte de lugar (compensa giro y tamaño de su ubicación). */
function setPivot(set, p) {
  const B = set.base || (set.base = defaultBase());
  const old = set.pivot || p;
  const r = (B.rot || 0) * Math.PI / 180, k = B.sc ?? 1;
  const ex = p.x - old.x, ey = p.y - old.y;
  B.dx = (B.dx || 0) + (k * (Math.cos(r) * ex - Math.sin(r) * ey) - ex);
  B.dy = (B.dy || 0) + (k * (Math.sin(r) * ex + Math.cos(r) * ey) - ey);
  set.pivot = { x: p.x, y: p.y };
}

function markPending() {
  addKeyBtn.classList.toggle('pending', !!S.editPose && S.sel >= 0);
}

function renderSceneProps() {
  const s = S.settings;
  const fx = s.effects;
  props.append(section('Presets de un clic',
    el('div', { class: 'sc-presets' }, ...PRESETS.map(([id, label, tip]) => btn(label, tip, () => {
      applyPreset(id, S.scene, s);
      S.editPose = null;
      changed(true);
      flash(`Preset: ${label}`);
    }))),
    el('p', { class: 'sc-hint' }, 'Eligen movimientos según el nombre de cada capa (nube, pasto, estrella…). Después podés retocar cada una.'),
    btn('🎲 Desfase aleatorio a todo', 'Cada capa arranca en otro momento: se ve más natural', () => {
      s.layers.forEach((x) => { x.phase = round(Math.random(), 2); });
      changed(true);
    })));
  props.append(section('Loop',
    slider('Duración', 'Largo del video (y del loop)', s.duration, 4, 30, 1, (v) => { s.duration = v; changed(); renderTimeline(); }, (v) => `${v} s`),
    toggle('Loop perfecto', 'El último cuadro empalma con el primero: todos los ritmos se ajustan a vueltas enteras', s.loop, (v) => { s.loop = v; changed(true); })));
  props.append(section('Efectos',
    toggle('Chispitas', 'Puntitos de luz que aparecen y se apagan (no tocan tu dibujo)', fx.sparkles, (v) => { fx.sparkles = v; changed(true); }),
    fx.sparkles ? slider('Cantidad', 'Cuántas chispitas', fx.density, 5, 200, 1, (v) => { fx.density = v; S.dirty = true; saveSettingsSoon(); }) : null,
    fx.sparkles ? slider('Tamaño', 'Tamaño de las chispitas', fx.size, 0.3, 3, 0.1, (v) => { fx.size = v; S.dirty = true; saveSettingsSoon(); }, (v) => `${Math.round(v * 100)}%`) : null,
    fx.sparkles ? color('Color', 'Color de las chispitas', fx.color, (v) => { fx.color = v; S.dirty = true; saveSettingsSoon(); }) : null,
    toggle('Halo', 'Resplandor suave que late detrás de una capa', fx.halo, (v) => { fx.halo = v; changed(true); }),
    fx.halo ? select_('Alrededor de', 'Qué capa tiene el halo', fx.haloLayer, S.scene.layers.map((l, k) => [k, l.name]), (v) => { fx.haloLayer = Number(v); S.dirty = true; saveSettingsSoon(); }) : null,
    fx.halo ? color('Color', 'Color del halo', fx.haloColor, (v) => { fx.haloColor = v; S.dirty = true; saveSettingsSoon(); }) : null,
    fx.halo ? slider('Intensidad', 'Qué tan fuerte brilla', fx.haloStrength, 0, 1, 0.05, (v) => { fx.haloStrength = v; S.dirty = true; saveSettingsSoon(); }, (v) => `${Math.round(v * 100)}%`) : null));
  const loadInput = el('input', { type: 'file', accept: '.json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (f) applySettingsJson(JSON.parse(await f.text()));
  } });
  props.append(section('Guardar',
    el('p', { class: 'sc-hint' }, 'Se guarda solo en este navegador. Para llevarlo a otra compu, bajá los ajustes.'),
    S.source?.kind === 'builtin' ? btn('↺ Volver al original', 'Deshace tus cambios en este dibujo y vuelve a los movimientos con los que viene', resetBuiltin) : null,
    row(btn('Bajar ajustes', 'Descarga un .escena.json con todos los movimientos', () => {
      download(new Blob([JSON.stringify(settingsJson(), null, 1)], { type: 'application/json' }), `${S.scene.name}.escena.json`);
    }), el('label', { class: 'btn', title: 'Carga un .escena.json guardado antes' }, 'Cargar ajustes', loadInput))));
}

function renderExportProps() {
  const s = S.settings;
  const o = s.out;
  const { w, h } = outputSize(o.preset, S.scene);
  const mbps = o.mbps || autoMbps(w, h);
  const mb = (mbps * s.duration) / 8;
  props.append(section('Tamaño del video',
    select_('Formato', 'Proporción y resolución del MP4', o.preset, OUTPUTS.map(([id, label]) => [id, label]), (v) => { o.preset = v; o.mbps = 0; resize(); changed(true); })),
  section('Encuadre',
    el('div', { class: 'sc-segs wide' },
      btn('Encajar', 'Entra todo el dibujo; lo que sobra se pinta con el color de fondo', () => { o.fit = 'fit'; resize(); changed(true); }, `sc-seg${o.fit === 'fit' ? ' on' : ''}`),
      btn('Llenar', 'Llena el video; recorta lo que no entra', () => { o.fit = 'fill'; resize(); changed(true); }, `sc-seg${o.fit === 'fill' ? ' on' : ''}`)),
    slider('Zoom', 'Acercar o alejar el encuadre', o.zoom, 0.5, 3, 0.01, (v) => { o.zoom = v; S.dirty = true; saveSettingsSoon(); }, (v) => `${Math.round(v * 100)}%`),
    row(btn('Centrar', 'Vuelve el encuadre al medio', () => { o.panX = 0; o.panY = 0; o.zoom = 1; changed(true); }),
      btn('Mover encuadre', 'Arrastrá la vista para elegir qué parte se ve', () => setTool('encuadre'))),
    color('Fondo', 'Color para los bordes cuando el dibujo no llena el video', o.bg, (v) => { o.bg = v; S.dirty = true; saveSettingsSoon(); })),
  section('Calidad',
    slider('Calidad', 'Megabits por segundo: más = más nítido y más pesado', mbps, 4, 60, 1, (v) => {
      o.mbps = v; $('.sc-size', props).textContent = sizeText(v); saveSettingsSoon();
    }, (v) => `${v} Mbps`),
    el('p', { class: 'sc-size sc-hint' }, sizeText(mbps)),
    el('p', { class: 'sc-hint' }, `${w}×${h} · ${s.fps} cuadros/s · ${s.duration} s${s.loop ? ' · loop perfecto' : ''}`)),
  el('div', { class: 'sc-export-go' }, btn('Exportar MP4', 'Arma el video cuadro por cuadro (puede tardar unos minutos)', startExport, 'primary big'),
    lastExport ? btn(`⬇ Ver y descargar el último (${lastExport.name})`, 'Vuelve a mostrar el último video que armaste', showExportResult, 'sc-last-export') : null));
  void mb;
}

function sizeText(mbps) {
  const mb = (mbps * S.settings.duration) / 8;
  return `Peso aproximado: ${Math.round(mb)} MB${mb > 250 ? ' — ¡pasa de 250 MB! bajá la calidad' : ' (límite 250 MB ✓)'}`;
}

/* ---------- exportar ---------- */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function exportFileName(ext, w, h) {
  const base = String(S.scene?.name || 'escena').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'escena';
  return `${base}_${w}x${h}_${S.settings.duration}s.${ext}`;
}

function canShareFile(file) {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch { return false; }
}

async function shareExport() {
  if (!lastExport) return;
  const file = new File([lastExport.blob], lastExport.name, { type: lastExport.blob.type });
  try {
    await navigator.share({ files: [file], title: lastExport.name });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    $('.sc-progress-note', progress).hidden = false;
    $('.sc-progress-note', progress).textContent = 'No pude abrir el menú para guardar. Probá con “Abrir video” y mantené apretado el video para guardarlo.';
  }
}

/** Muestra el video terminado con botones visibles para bajarlo (no depende de una descarga automática). */
function showExportResult() {
  const r = lastExport;
  const dl = $('.sc-progress-dl', progress);
  const share = $('.sc-progress-share', progress);
  const open = $('.sc-progress-open', progress);
  const video = $('.sc-progress-video', progress);
  const note = $('.sc-progress-note', progress);
  progress.hidden = false;
  $('.sc-bar i', progress).style.width = '100%';
  $('.sc-progress-title', progress).textContent = '¡Listo! Tu video está armado';
  $('.sc-progress-text', progress).textContent = `${r.name} · ${(r.blob.size / 1e6).toFixed(1)} MB`;
  dl.href = r.url;
  dl.download = r.name;
  dl.textContent = `⬇ Descargar ${r.ext.toUpperCase()} (${(r.blob.size / 1e6).toFixed(1)} MB)`;
  dl.hidden = false;
  open.href = r.url;
  const file = new File([r.blob], r.name, { type: r.blob.type });
  share.hidden = !(IS_IOS && canShareFile(file));
  open.hidden = !IS_IOS;
  video.src = r.url;
  video.hidden = false;
  const notes = [];
  if (r.ext === 'webm') notes.push('Este navegador sólo arma WebM. Para MP4 abrí la página en Chrome o Edge en una computadora.');
  if (r.realtime) notes.push('Se grabó en tiempo real: si se ve a saltos, exportalo en Chrome o Edge.');
  if (IS_IOS && !share.hidden) notes.push('En iPad/iPhone: tocá “Guardar en el dispositivo” y elegí “Guardar video” o “Guardar en Archivos”.');
  else if (IS_IOS) notes.push('En iPad/iPhone: tocá “Descargar” (queda en Archivos › Descargas) o “Abrir video” y usá el botón compartir › “Guardar video”.');
  else notes.push('Se guarda en tu carpeta de Descargas. Si no aparece, tocá el botón de nuevo.');
  note.textContent = notes.join(' ');
  note.hidden = false;
  $('.sc-progress-cancel', progress).hidden = true;
  $('.sc-progress-close', progress).hidden = false;
}

function exportErrorText(err) {
  const msg = String(err?.message || err || '');
  if (err?.name === 'QuotaExceededError' || /memory|memoria|allocation|out of/i.test(msg)) {
    return 'Se quedó sin memoria. Elegí un tamaño más chico (por ejemplo 16:9 · 1920×1080), cerrá otras pestañas y probá de nuevo.';
  }
  if (/NotSupported|not supported|codec/i.test(msg)) {
    return `Este navegador no pudo codificar el video (${msg}). Probá con Chrome o Edge en una computadora, o con un tamaño más chico.`;
  }
  return `Algo falló al armar el video: ${msg || 'error desconocido'}. Probá de nuevo; si sigue, elegí un tamaño más chico o usá Chrome.`;
}

async function startExport() {
  if (S.exporting) return;
  const s = S.settings;
  const { w, h } = outputSize(s.out.preset, S.scene);
  const mbps = s.out.mbps || autoMbps(w, h);
  S.exporting = true;
  S.cancel = false;
  const wasPlaying = S.playing;
  const bar = $('.sc-bar i', progress);
  const title = $('.sc-progress-title', progress);
  const txt = $('.sc-progress-text', progress);
  const note = $('.sc-progress-note', progress);
  const video = $('.sc-progress-video', progress);
  for (const sel of ['.sc-progress-dl', '.sc-progress-share', '.sc-progress-open', '.sc-progress-close']) $(sel, progress).hidden = true;
  video.hidden = true;
  video.removeAttribute('src');
  $('.sc-progress-cancel', progress).hidden = false;
  bar.style.width = '0%';
  note.hidden = false;
  note.textContent = 'Dejá esta pestaña abierta y al frente mientras se arma.';
  progress.hidden = false;
  if (lastExport) { URL.revokeObjectURL(lastExport.url); lastExport = null; }
  const t0 = performance.now();
  try {
    if (S.fullReady && S.scene.layers.some((l) => l.preview)) {
      title.textContent = 'Preparando las capas…';
      txt.textContent = 'Termino de bajar el dibujo en calidad completa y arranco.';
      try { await S.fullReady; } catch { note.textContent = 'No pude bajar todo en calidad completa; exporto con lo que hay.'; }
      if (S.cancel) throw new ExportCancelled();
    }
    setPlaying(false);
    S.editPose = null;
    rebake();
    title.textContent = 'Exportando video…';
    const res = await exportVideo({
      scene: S.scene, settings: s, baked: S.baked, w, h, mbps,
      isCancelled: () => S.cancel,
      onStage: (t) => { note.textContent = t; },
      onProgress: (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        const el2 = (performance.now() - t0) / 1000;
        const left = p > 0.02 ? Math.max(0, el2 / p - el2) : 0;
        txt.textContent = `${Math.round(p * 100)}% · cuadro ${Math.round(p * s.duration * s.fps)} de ${Math.round(s.duration * s.fps)}${left ? ` · faltan ~${Math.ceil(left)} s` : ''}`;
      },
    });
    const name = exportFileName(res.ext, w, h);
    lastExport = { blob: res.blob, url: URL.createObjectURL(res.blob), name, ext: res.ext, realtime: res.realtime };
    showExportResult();
    renderProps();
    if (!IS_IOS) {
      // Intento de descarga automática; si el navegador la frena, queda el botón visible.
      try { $('.sc-progress-dl', progress).click(); } catch { /* queda el botón */ }
    }
  } catch (err) {
    const cancelled = S.cancel || err instanceof ExportCancelled;
    if (!cancelled) console.error('Exportar', err);
    title.textContent = cancelled ? 'Cancelado' : 'No se pudo exportar';
    txt.textContent = cancelled ? 'No se guardó nada.' : exportErrorText(err);
    note.hidden = true;
    $('.sc-progress-cancel', progress).hidden = true;
    $('.sc-progress-close', progress).hidden = false;
  } finally {
    S.exporting = false;
    if (wasPlaying) setPlaying(true);
  }
}

/* ---------- reproducción, vista y herramientas ---------- */
function setPlaying(on) {
  if (S.rec) return;
  S.playing = on;
  if (on && S.editPose) { dropDraft(); }
  playBtn.textContent = on ? '⏸ Pausa' : '▶ Reproducir';
  S.last = performance.now();
}
/** Descarta la pose en borrador (la que no se guardó como clave). */
function dropDraft(say = false) {
  if (!S.editPose || S.rec) return;
  S.editPose = null;
  rebake();
  markPending();
  if (say) flash('Pose sin guardar descartada · usá “+ Clave” para guardarla');
}
function setTool(t) {
  if (t !== 'animar') dropDraft();
  S.tool = t;
  toolCapa.classList.toggle('on', t === 'ubicar');
  toolAnim.classList.toggle('on', t === 'animar');
  toolEnc.classList.toggle('on', t === 'encuadre');
  view.classList.toggle('pan', t === 'encuadre');
  addKeyBtn.hidden = t !== 'animar';
  document.body.classList.toggle('tool-animar', t === 'animar');
  S.dirty = true;
}
let flashTimer = 0;
function flash(text) {
  let f = $('.sc-flash');
  if (!f) { f = el('div', { class: 'sc-flash' }); stage.append(f); }
  f.textContent = text;
  f.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.remove('on'), 1400);
}

function renderTimeline() {
  const D = S.settings?.duration || 1;
  timeLabel.textContent = `${(S.t % D).toFixed(1)} s / ${D} s`;
  scrub.value = String(Math.round(((S.t % D) / D) * 1000));
}
scrub.addEventListener('input', () => {
  if (!S.scene) return;
  if (S.rec) cancelRecording();
  setPlaying(false);
  dropDraft(true);
  S.t = (Number(scrub.value) / 1000) * S.settings.duration;
  S.dirty = true;
});
scrub.addEventListener('change', () => { if (S.tab === 'capa' && S.sel >= 0) renderProps(); });

/* Rombos de las claves de la capa elegida, arriba de la línea de tiempo: se arrastran para moverlas. */
function renderKeyRow() {
  keyRow.textContent = '';
  if (!S.scene || S.sel < 0) return;
  const set = S.settings.layers[S.sel];
  for (const k of sortedKeys(set)) {
    const d = el('button', { type: 'button', class: `sc-dia${k === S.selKey ? ' sel' : ''}`, title: `Clave en ${fmtT(k.t)} · arrastrá para moverla en el tiempo · Supr para borrarla` });
    d.style.left = `calc(8px + ${k.t} * (100% - 16px))`;
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      const rect = keyRow.getBoundingClientRect();
      const x0 = e.clientX;
      let moved = false;
      S.selKey = k;
      setPlaying(false);
      dropDraft();
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        k.t = round(clamp((ev.clientX - rect.left - 8) / (rect.width - 16), 0, 0.9999), 4);
        d.style.left = `calc(8px + ${k.t} * (100% - 16px))`;
        S.t = k.t * S.settings.duration;
        rebake();
      };
      const up = () => {
        d.removeEventListener('pointermove', move);
        d.removeEventListener('pointerup', up);
        S.t = k.t * S.settings.duration;
        S.dirty = true;
        set.keys.sort((a, b) => a.t - b.t);
        changed(true);
        if (moved) recordNow();
      };
      d.addEventListener('pointermove', move);
      d.addEventListener('pointerup', up);
    });
    keyRow.append(d);
  }
}

function resize() {
  const wrap = view.parentElement;
  const W = wrap.clientWidth - 24;
  const H = wrap.clientHeight - 24;
  if (!S.scene || W <= 0 || H <= 0) return;
  const { w, h } = outputSize(S.settings.out.preset, S.scene);
  const s = Math.min(W / w, H / h);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.style.width = `${Math.round(w * s)}px`;
  view.style.height = `${Math.round(h * s)}px`;
  view.width = Math.round(w * s * dpr);
  view.height = Math.round(h * s * dpr);
  frameLabel.textContent = `${w}×${h}`;
  S.dirty = true;
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);

const vctx = view.getContext('2d');
function frame(now) {
  requestAnimationFrame(frame);
  if (!S.scene || !S.baked) return;
  const dt = Math.min(0.1, (now - (S.last || now)) / 1000);
  S.last = now;
  const r = S.rec;
  if (r?.phase === 'rec') {
    const D = S.settings.duration;
    r.elapsed += dt * (r.slow ? 0.5 : 1);
    S.t = Math.min(r.elapsed, D - 1e-4);
    if (r.down) {
      r.samples.push({ u: S.t / D, dx: S.editPose.dx, dy: S.editPose.dy });
      const s = S.settings.layers[r.i], B = s.base || {};
      r.trail.push([s.pivot.x + (B.dx || 0) + S.editPose.dx, s.pivot.y + (B.dy || 0) + S.editPose.dy]);
    }
    S.dirty = true;
    if (r.elapsed >= D) { finishRecording(); return; }
  } else if (S.playing && !S.exporting && !r) { S.t = (S.t + dt) % S.settings.duration; S.dirty = true; }
  if (r?.need) { r.need = false; rebake(); }
  if (!S.dirty) return;
  S.dirty = false;
  S.view = renderFrame(vctx, S.scene, S.settings, S.baked, S.t, view.width, view.height, { fast: S.playing });
  drawOverlay();
  renderTimeline();
}
requestAnimationFrame(frame);

function worldOf(i) { return sample(S.baked, i, S.t).m; }
function toView(m, x, y) {
  const v = S.view;
  const wx = m[0] * x + m[2] * y + m[4];
  const wy = m[1] * x + m[3] * y + m[5];
  return [v[0] * wx + v[4], v[3] * wy + v[5]];
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
/** Punto de la vista (px del canvas) → coordenadas propias de la capa. */
function toLocal(m, vx, vy) {
  const v = S.view;
  const wx = (vx - v[4]) / v[0];
  const wy = (vy - v[5]) / v[3];
  const n = invert(m);
  return [n[0] * wx + n[2] * wy + n[4], n[1] * wx + n[3] * wy + n[5]];
}

/** Manijas de la capa elegida, en px del canvas. */
function handlesOf(i) {
  const l = S.scene.layers[i];
  const s = S.settings.layers[i];
  const m = worldOf(i);
  const dpr = view.width / view.clientWidth;
  const corners = [[l.x, l.y], [l.x + l.w, l.y], [l.x + l.w, l.y + l.h], [l.x, l.y + l.h]].map(([x, y]) => toView(m, x, y));
  const c = toView(m, l.x + l.w / 2, l.y + l.h / 2);
  const tm = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
  let ux = tm[0] - c[0], uy = tm[1] - c[1];
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const rot = [tm[0] + ux * 30 * dpr, tm[1] + uy * 30 * dpr];
  const pivot = toView(m, s.pivot.x, s.pivot.y);
  return { m, corners, tm, rot, pivot, dpr };
}

function drawPath(i, dpr) {
  const L = S.baked.layers[i];
  const s = S.settings.layers[i];
  if (!L) return;
  const N = S.baked.N;
  const steps = Math.min(N, 180);
  const pts = [];
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let k = 0; k <= steps; k += 1) {
    const j = (Math.round((k / steps) * N) % N) * 6;
    const m = [L.mats[j], L.mats[j + 1], L.mats[j + 2], L.mats[j + 3], L.mats[j + 4], L.mats[j + 5]];
    const p = toView(m, s.pivot.x, s.pivot.y);
    pts.push(p);
    minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
  }
  if (Math.max(maxx - minx, maxy - miny) < 4 * dpr) return;
  vctx.save();
  vctx.strokeStyle = 'rgba(255, 227, 163, 0.85)';
  vctx.lineWidth = 2 * dpr;
  vctx.setLineDash([2 * dpr, 5 * dpr]);
  vctx.lineCap = 'round';
  vctx.beginPath();
  pts.forEach(([x, y], k) => (k ? vctx.lineTo(x, y) : vctx.moveTo(x, y)));
  vctx.stroke();
  vctx.setLineDash([]);
  // Las claves, como rombitos sobre el camino.
  for (const key of sortedKeys(s)) {
    const r = sample(S.baked, i, key.t * S.settings.duration);
    const [x, y] = toView(r.m, s.pivot.x, s.pivot.y);
    const z = (key === S.selKey ? 7 : 5) * dpr;
    vctx.fillStyle = key === S.selKey ? '#ffe3a3' : '#f0b35a';
    vctx.strokeStyle = '#2a1a05';
    vctx.lineWidth = 1.5 * dpr;
    vctx.beginPath();
    vctx.moveTo(x, y - z); vctx.lineTo(x + z, y); vctx.lineTo(x, y + z); vctx.lineTo(x - z, y);
    vctx.closePath();
    vctx.fill(); vctx.stroke();
  }
  vctx.restore();
}

function drawOverlay() {
  const i = S.sel;
  if (i < 0 || !S.baked.layers[i] || S.tool === 'encuadre') return;
  const h = handlesOf(i);
  const { dpr } = h;
  vctx.save();
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!S.editPose) drawPath(i, dpr);
  if (!S.rec) drawOrbit(i, dpr); else S._orbitH = null;
  if (S.rec?.trail.length > 1) {
    vctx.strokeStyle = 'rgba(255, 92, 92, 0.95)';
    vctx.lineWidth = 3 * dpr;
    vctx.lineCap = 'round';
    vctx.lineJoin = 'round';
    vctx.beginPath();
    S.rec.trail.forEach(([x, y], k) => { const [a, b] = W2V(x, y); if (k) vctx.lineTo(a, b); else vctx.moveTo(a, b); });
    vctx.stroke();
  }
  const anim = S.tool === 'animar';
  const col = anim ? '#ffb86b' : 'rgba(122, 215, 228, 0.95)';
  vctx.strokeStyle = col;
  vctx.lineWidth = 1.5 * dpr;
  vctx.setLineDash([6 * dpr, 4 * dpr]);
  vctx.beginPath();
  h.corners.forEach(([x, y], k) => (k ? vctx.lineTo(x, y) : vctx.moveTo(x, y)));
  vctx.closePath();
  vctx.stroke();
  vctx.setLineDash([]);
  // Manija de giro.
  vctx.beginPath();
  vctx.moveTo(h.tm[0], h.tm[1]);
  vctx.lineTo(h.rot[0], h.rot[1]);
  vctx.stroke();
  vctx.fillStyle = '#fff';
  vctx.strokeStyle = '#062028';
  vctx.lineWidth = 2 * dpr;
  vctx.beginPath();
  vctx.arc(h.rot[0], h.rot[1], 6.5 * dpr, 0, Math.PI * 2);
  vctx.fill(); vctx.stroke();
  // Esquinas para el tamaño.
  for (const [x, y] of h.corners) {
    const z = 5.5 * dpr;
    vctx.fillStyle = '#fff';
    vctx.fillRect(x - z, y - z, z * 2, z * 2);
    vctx.strokeRect(x - z, y - z, z * 2, z * 2);
  }
  // Pivote.
  vctx.fillStyle = '#49c6d6';
  vctx.beginPath();
  vctx.arc(h.pivot[0], h.pivot[1], 7 * dpr, 0, Math.PI * 2);
  vctx.fill(); vctx.stroke();
  vctx.beginPath();
  vctx.moveTo(h.pivot[0] - 11 * dpr, h.pivot[1]); vctx.lineTo(h.pivot[0] + 11 * dpr, h.pivot[1]);
  vctx.moveTo(h.pivot[0], h.pivot[1] - 11 * dpr); vctx.lineTo(h.pivot[0], h.pivot[1] + 11 * dpr);
  vctx.lineWidth = 1.2 * dpr;
  vctx.stroke();
  if (anim && S.editPose) {
    vctx.font = `${12 * dpr}px Outfit, system-ui, sans-serif`;
    vctx.fillStyle = '#ffb86b';
    vctx.fillText('Pose sin guardar · “+ Clave”', h.corners[3][0], h.corners[3][1] + 18 * dpr);
  }
  vctx.restore();
}


/* ---------- ayuda rápida ---------- */
function helpBox() {
  const how = (title, steps) => el('div', { class: 'sc-help-item' }, el('strong', {}, title), el('ol', {}, ...steps.map((t) => el('li', {}, t))));
  return el('details', { class: 'sc-help' },
    el('summary', { title: 'Ayuda: cómo mover, grabar y orbitar' }, '?'),
    el('div', { class: 'sc-help-card' },
      how('Mover a otro lugar', ['Elegí ✥ Ubicar (abajo).', 'Arrastrá la capa. Esquinas = tamaño, bolita de arriba = girar.', 'Listo: queda guardada en ese lugar.']),
      how('Grabar un recorrido', ['Elegí la capa.', 'Tocá ● Grabar (o la tecla R) y esperá el 3-2-1.', 'Arrastrala por donde quieras hasta que termine la vuelta. Ctrl+Z deshace.']),
      how('Orbitar alrededor de otra capa', ['Elegí la capa que va a girar y tocá ◯ Orbitar.', 'En “Alrededor de” elegí Otra capa → por ejemplo, la espada.', 'Arrastrá la capa (o las bolitas rosas) para cambiar la distancia.'])));
}

/* ---------- órbitas alrededor de otra capa o de un punto ---------- */
const V2W = (vx, vy) => [(vx - S.view[4]) / S.view[0], (vy - S.view[5]) / S.view[3]];
const W2V = (x, y) => [S.view[0] * x + S.view[4], S.view[3] * y + S.view[5]];
function pivotWorld(i) {
  const m = worldOf(i), p = S.settings.layers[i].pivot;
  return [m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]];
}
/** Centro de la vuelta en este momento, en coordenadas del archivo. */
function orbitCenterNow(i) {
  const s = S.settings.layers[i], b = s.beh;
  const D = S.settings.duration, loop = S.settings.loop;
  if (!orbitsOther(b)) {
    const [qx, qy] = pivotWorld(i);
    const a = orbitAngle(s, S.t, D, loop);
    return [qx - (b.rx || 0) * Math.cos(a), qy - (b.ry || 0) * Math.sin(a)];
  }
  const [lx, ly] = orbitCenterLocal(S.scene, S.settings, s);
  if (b.center === 'layer' && b.centerLayer !== i && S.baked.layers[b.centerLayer]) {
    const m = worldOf(b.centerLayer);
    return [m[0] * lx + m[2] * ly + m[4], m[1] * lx + m[3] * ly + m[5]];
  }
  return [lx, ly];
}
/** Ajusta tamaño y arranque de la vuelta para que la capa pase por (qx, qy) en este momento. */
function fitOrbit(i, qx, qy) {
  const s = S.settings.layers[i], b = s.beh;
  const [cx, cy] = orbitCenterNow(i);
  const q = (b.rx || 0) > 0.5 ? (b.ry || 0) / b.rx : 1;
  const ex = qx - cx, ey = qy - cy;
  const rx = q > 0.02 ? Math.hypot(ex, ey / q) : Math.abs(ex);
  b.rx = Math.max(1, Math.round(rx));
  b.ry = Math.max(0, Math.round(b.rx * q));
  const ang = Math.atan2(b.ry ? ey / b.ry : 0, ex / b.rx);
  b.a0 = round(ang - orbitAngle(s, S.t, S.settings.duration, S.settings.loop), 4);
}
function defaultCenterLayer(i) {
  const L = S.scene.layers;
  const k = L.findIndex((l, j) => j !== i && /espada|sword/i.test(l.name));
  return k >= 0 ? k : (i === 0 ? 1 : 0);
}
function setOrbitCenter(i, mode, layerIdx, point) {
  const s = S.settings.layers[i], b = s.beh;
  if (mode === 'layer') {
    const cb = S.settings.layers[layerIdx]?.beh;
    if (orbitsOther(cb) && cb.center === 'layer' && cb.centerLayer === i) { flash('Esa capa ya gira alrededor de esta: elegí otra'); renderProps(); return; }
  }
  const [qx, qy] = pivotWorld(i); // donde está ahora: la vuelta arranca desde acá
  b.center = mode;
  if (mode === 'layer') b.centerLayer = layerIdx;
  if (mode === 'point' && point) { b.cx = round(point[0]); b.cy = round(point[1]); }
  if (s.poco) s.poco = false;
  if (mode !== 'self') {
    b.rx = 1; b.ry = 1; // círculo, con el radio a la distancia actual
    fitOrbit(i, qx, qy);
    if (b.rx < 8) flash('Está casi en el centro: arrastrala para alejarla');
    else flash(mode === 'layer' ? `◯ Gira alrededor de “${S.scene.layers[layerIdx].name}”` : '◯ Gira alrededor del punto');
  } else b.a0 = 0;
  rebake();
  changed(true);
  recordNow();
}
function startPickCenter(i) {
  S.pick = { i };
  view.style.cursor = 'crosshair';
  flash('Tocá en la vista dónde va el centro de la vuelta');
  renderProps();
}
function drawOrbit(i, dpr) {
  const b = S.settings.layers[i].beh;
  S._orbitH = null;
  if (b?.type !== 'orbitar') return;
  const C = orbitCenterNow(i);
  const [cx, cy] = W2V(C[0], C[1]);
  const rx = (b.rx || 0) * S.view[0], ry = (b.ry || 0) * S.view[3];
  const hx = [cx + rx, cy], hy = [cx, cy - ry];
  vctx.save();
  vctx.strokeStyle = 'rgba(255, 143, 199, 0.9)';
  vctx.lineWidth = 1.5 * dpr;
  vctx.setLineDash([7 * dpr, 6 * dpr]);
  vctx.beginPath();
  vctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  vctx.stroke();
  vctx.setLineDash([]);
  // Centro: cruz rosa.
  vctx.lineWidth = 2 * dpr;
  vctx.beginPath();
  vctx.moveTo(cx - 9 * dpr, cy); vctx.lineTo(cx + 9 * dpr, cy);
  vctx.moveTo(cx, cy - 9 * dpr); vctx.lineTo(cx, cy + 9 * dpr);
  vctx.stroke();
  vctx.beginPath();
  vctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
  vctx.stroke();
  for (const [x, y] of [hx, hy]) {
    vctx.fillStyle = '#ff8fc7';
    vctx.strokeStyle = '#3a0820';
    vctx.beginPath();
    vctx.arc(x, y, 6.5 * dpr, 0, Math.PI * 2);
    vctx.fill(); vctx.stroke();
  }
  vctx.restore();
  S._orbitH = { C, c: [cx, cy], hx, hy, point: b.center === 'point' };
}

/* ---------- grabar recorrido con el mouse ---------- */
let countTimer = 0;
function toggleRecording() {
  if (S.rec) { if (S.rec.phase === 'rec') finishRecording(); else cancelRecording(); return; }
  startRecording();
}
function startRecording(opts = {}) {
  if (!S.scene) return false;
  if (S.sel < 0) { flash('Primero elegí una capa (tocala en la vista o en la lista)'); return false; }
  if (S.exporting) return false;
  if (S.tool === 'encuadre') setTool('ubicar');
  dropDraft();
  recordNow();
  const i = S.sel, s = S.settings.layers[i];
  S.playing = false;
  S.t = 0;
  const pose = { ...poseNow(i) };
  S.rec = {
    i, phase: 'count', n: 3, slow: opts.slow ?? S.recSlow, orient: opts.orient ?? S.recOrient,
    samples: [], trail: [], down: false, elapsed: 0, pose,
    prevBeh: JSON.parse(JSON.stringify(s.beh || { type: 'none' })), prevPoco: s.poco,
  };
  s.beh = { type: 'recorrido', orient: false, period: S.settings.duration };
  s.poco = false;
  S.editPose = pose;
  rebake();
  recBtn.textContent = '■ Cancelar';
  recBtn.classList.add('on');
  const tick = () => {
    if (!S.rec) return;
    if (S.rec.n > 0) {
      countEl.hidden = false;
      countEl.textContent = String(S.rec.n);
      countEl.classList.remove('pop'); void countEl.offsetWidth; countEl.classList.add('pop');
      S.rec.n -= 1;
      countTimer = setTimeout(tick, opts.fast ? 120 : 750);
      return;
    }
    countEl.textContent = '¡Ya!';
    countTimer = setTimeout(() => { countEl.hidden = true; }, 500);
    S.rec.phase = 'rec';
    S.last = performance.now();
    recBtn.textContent = '■ Terminar';
    recBadge.hidden = false;
    recBadge.querySelector('span').textContent = `Grabando${S.rec.slow ? ' (lento)' : ''} · arrastrá la capa · Esc cancela`;
    renderProps();
  };
  tick();
  flash('Agarrá la capa con el mouse: arranca en 3…');
  renderProps();
  return true;
}
function endRecordingUi() {
  clearTimeout(countTimer);
  countEl.hidden = true;
  recBadge.hidden = true;
  recBtn.textContent = '● Grabar';
  recBtn.classList.remove('on');
}
function cancelRecording(msg = 'Grabación cancelada') {
  const r = S.rec;
  if (!r) return;
  S.rec = null;
  endRecordingUi();
  const s = S.settings.layers[r.i];
  s.beh = r.prevBeh;
  s.poco = r.prevPoco;
  S.editPose = null;
  rebake();
  setPlaying(false);
  renderProps();
  flash(msg);
}
function finishRecording() {
  const r = S.rec;
  if (!r) return;
  if (r.samples.length < 3) { cancelRecording('No se grabó nada: apretá y arrastrá la capa mientras corre el tiempo'); return; }
  S.rec = null;
  endRecordingUi();
  const s = S.settings.layers[r.i];
  s.keys = pathToKeys(r.samples, r.pose, S.settings.loop, S.settings.duration);
  s.beh = { type: 'recorrido', orient: !!r.orient, period: S.settings.duration };
  S.editPose = null;
  S.selKey = null;
  S.t = 0;
  rebake();
  changed(true);
  recordNow();
  setPlaying(true);
  flash(`⤳ Recorrido grabado · ${s.keys.length} claves (Ctrl+Z deshace)`);
}
/** Muestras del mouse → camino suave → pocas claves editables. */
function pathToKeys(samples, pose, loop, D) {
  const n = Math.max(12, Math.round(D * 30));
  const pts = samples.slice().sort((a, b) => a.u - b.u).filter((p, k, a) => !k || p.u > a[k - 1].u + 1e-6);
  const ext = loop ? [{ ...pts[pts.length - 1], u: pts[pts.length - 1].u - 1 }, ...pts, { ...pts[0], u: pts[0].u + 1 }] : pts;
  const gx = new Float64Array(n), gy = new Float64Array(n);
  let p = 0;
  for (let j = 0; j < n; j += 1) {
    const u = j / n;
    while (p < ext.length - 2 && ext[p + 1].u <= u) p += 1;
    const a = ext[p], b = ext[Math.min(p + 1, ext.length - 1)];
    const w = b.u > a.u ? clamp((u - a.u) / (b.u - a.u), 0, 1) : 0;
    gx[j] = a.dx + (b.dx - a.dx) * w;
    gy[j] = a.dy + (b.dy - a.dy) * w;
  }
  const at = (k) => (loop ? ((k % n) + n) % n : clamp(k, 0, n - 1));
  const smooth = (r) => {
    const tx = Float64Array.from(gx), ty = Float64Array.from(gy);
    for (let j = 0; j < n; j += 1) {
      let sx = 0, sy = 0, sw = 0;
      for (let d = -r; d <= r; d += 1) { const w = r + 1 - Math.abs(d); sx += tx[at(j + d)] * w; sy += ty[at(j + d)] * w; sw += w; }
      gx[j] = sx / sw; gy[j] = sy / sw;
    }
  };
  smooth(3); smooth(3);
  if (loop) {
    // Cierra la vuelta: el final se acerca suave al principio.
    const ex = gx[0] - (2 * gx[n - 1] - gx[n - 2]), ey = gy[0] - (2 * gy[n - 1] - gy[n - 2]);
    for (let j = Math.floor(n * 0.75); j < n; j += 1) {
      const x = (j / n - 0.75) / 0.25, w = x * x * (3 - 2 * x);
      gx[j] += ex * w; gy[j] += ey * w;
    }
    smooth(2);
  }
  const M = loop ? n : n - 1;
  const X = (j) => gx[j % n], Y = (j) => gy[j % n];
  let eps = Math.max(2, 0.006 * Math.max(S.scene.width, S.scene.height));
  let keep;
  for (let tries = 0; tries < 12; tries += 1) {
    keep = new Set([0, M]);
    const rdp = (a, b) => {
      let best = -1, bi = -1;
      for (let j = a + 1; j < b; j += 1) {
        const w = (j - a) / (b - a);
        const d = Math.hypot(X(j) - (X(a) + (X(b) - X(a)) * w), Y(j) - (Y(a) + (Y(b) - Y(a)) * w));
        if (d > best) { best = d; bi = j; }
      }
      if (best > eps) { keep.add(bi); rdp(a, bi); rdp(bi, b); }
    };
    rdp(0, M);
    if (keep.size <= 25) break;
    eps *= 1.4;
  }
  let idx = [...keep].filter((j) => !loop || j < n).sort((a, b) => a - b);
  if (loop && idx.length < 3) idx = [0, Math.round(n / 3), Math.round((2 * n) / 3)];
  return idx.map((j) => ({
    t: round(j / n, 4), dx: round(gx[j], 1), dy: round(gy[j], 1),
    rot: pose.rot ?? 0, sc: pose.sc ?? 1, op: pose.op ?? 1, ease: 'fluido',
  }));
}
function recPointer(vx, vy) {
  const r = S.rec;
  const s = S.settings.layers[r.i];
  const B = s.base || defaultBase();
  const [wx, wy] = V2W(vx, vy);
  S.editPose.dx = wx - r.grab[0] - (s.pivot.x + (B.dx || 0));
  S.editPose.dy = wy - r.grab[1] - (s.pivot.y + (B.dy || 0));
  r.need = true;
}

/* Detección de clic por transparencia (mapa chiquito de alfa por capa). */
function hitMap(l) {
  if (l._hit) return l._hit;
  const s = Math.min(1, 128 / Math.max(l.image.width, l.image.height));
  const w = Math.max(1, Math.round(l.image.width * s));
  const h = Math.max(1, Math.round(l.image.height * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(l._levels?.[l._levels.length - 1] || l.image, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const a = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k += 1) a[k] = d[k * 4 + 3];
  l._hit = { w, h, a };
  return l._hit;
}

function insideBox(i, vx, vy) {
  const l = S.scene.layers[i];
  const [x, y] = toLocal(worldOf(i), vx, vy);
  return x >= l.x && y >= l.y && x < l.x + l.w && y < l.y + l.h;
}

function hitTest(vx, vy) {
  const big = S.scene.width * S.scene.height * 0.5;
  let fallback = -1;
  for (let i = S.scene.layers.length - 1; i >= 0; i -= 1) {
    const l = S.scene.layers[i];
    if (!S.settings.layers[i].visible) continue;
    const [x, y] = toLocal(worldOf(i), vx, vy);
    if (x < l.x || y < l.y || x >= l.x + l.w || y >= l.y + l.h) continue;
    const hm = hitMap(l);
    const a = hm.a[Math.floor(((y - l.y) / l.h) * hm.h) * hm.w + Math.floor(((x - l.x) / l.w) * hm.w)];
    if (a < 40) continue;
    if (l.w * l.h > big) { if (fallback < 0) fallback = i; continue; }
    return i;
  }
  return fallback;
}

/** Qué se edita al arrastrar: la ubicación (✥ Ubicar) o la pose en borrador (◆ Animar). */
function editTarget() {
  const s = S.settings.layers[S.sel];
  if (S.tool === 'animar') return startDraft();
  return s.base || (s.base = defaultBase());
}

let drag = null;
view.addEventListener('pointerdown', (e) => {
  if (!S.scene || !S.view) return;
  const dpr = view.width / view.clientWidth;
  const vx = e.offsetX * dpr, vy = e.offsetY * dpr;
  view.setPointerCapture(e.pointerId);
  if (S.tool === 'encuadre') {
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, panX: S.settings.out.panX, panY: S.settings.out.panY };
    return;
  }
  const near = (p, r) => Math.hypot(p[0] - vx, p[1] - vy) < r * dpr;
  if (S.rec) {
    // Grabando: agarrás la capa desde donde toques, y la seguís arrastrando.
    const [wx, wy] = V2W(vx, vy);
    const [qx, qy] = pivotWorld(S.rec.i);
    S.rec.grab = [wx - qx, wy - qy];
    S.rec.down = true;
    drag = { kind: 'rec' };
    return;
  }
  if (S.pick && S.sel === S.pick.i) {
    S.pick = null;
    view.style.cursor = '';
    setOrbitCenter(S.sel, 'point', null, V2W(vx, vy));
    return;
  }
  let kind = null;
  const oh = S.sel >= 0 ? S._orbitH : null;
  if (oh && near(oh.hx, 12)) kind = 'orx';
  else if (oh && near(oh.hy, 12)) kind = 'ory';
  else if (oh && oh.point && near(oh.c, 14)) kind = 'octr';
  if (kind) { drag = { kind, C: oh.C, moved: false }; setPlaying(false); return; }
  if (S.sel >= 0) {
    const h = handlesOf(S.sel);
    // En capas chiquitas el pivote tapa todo: ahí se agarra con Alt, y si no, se mueve la capa.
    const xs = h.corners.map((c) => c[0]), ys = h.corners.map((c) => c[1]);
    const tiny = Math.max(...xs) - Math.min(...xs) < 48 * dpr && Math.max(...ys) - Math.min(...ys) < 48 * dpr;
    if (near(h.pivot, 12) && (!tiny || e.altKey)) kind = 'pivot';
    else if (near(h.rot, 13)) kind = 'rotate';
    else if (h.corners.some((c) => near(c, 12))) kind = 'scale';
    else if (insideBox(S.sel, vx, vy)) {
      // Dentro del recuadro de la elegida: se mueve ella, salvo que toques otra capa chica encima.
      const ht = hitTest(vx, vy);
      const big = (k) => { const L = S.scene.layers[k]; return L.w * L.h > S.scene.width * S.scene.height * 0.5; };
      if (ht === S.sel || ht < 0 || big(ht)) kind = 'move';
    }
  }
  if (!kind) {
    const hit = hitTest(vx, vy);
    if (hit < 0) { if (S.sel >= 0 && !insideBox(S.sel, vx, vy)) select(-1); return; }
    if (hit !== S.sel) select(hit);
    kind = 'move';
  }
  const s = S.settings.layers[S.sel];
  const h = handlesOf(S.sel);
  if (kind === 'pivot') {
    drag = { kind, pid: e.pointerId };
    return;
  }
  const T = editTarget();
  drag = {
    kind, x: e.clientX, y: e.clientY, vx, vy, moved: false, shift: e.shiftKey,
    start: { dx: T.dx || 0, dy: T.dy || 0, rot: T.rot || 0, sc: T.sc ?? 1 },
    pv: h.pivot, set: s, q0: pivotWorld(S.sel),
  };
});
view.addEventListener('pointermove', (e) => {
  if (!drag) {
    // Cursor según lo que hay abajo.
    if (S.sel >= 0 && S.tool !== 'encuadre' && S.view) {
      const dpr = view.width / view.clientWidth;
      const vx = e.offsetX * dpr, vy = e.offsetY * dpr;
      const h = handlesOf(S.sel);
      const near = (p, r) => Math.hypot(p[0] - vx, p[1] - vy) < r * dpr;
      const oh = S._orbitH;
      if (S.pick || S.rec) { view.style.cursor = S.rec ? 'grab' : 'crosshair'; return; }
      if (oh && (near(oh.hx, 12) || near(oh.hy, 12))) { view.style.cursor = 'ew-resize'; return; }
      if (oh && oh.point && near(oh.c, 14)) { view.style.cursor = 'move'; return; }
      view.style.cursor = near(h.pivot, 12) ? 'crosshair' : near(h.rot, 13) ? 'alias' : h.corners.some((c) => near(c, 12)) ? 'nwse-resize' : insideBox(S.sel, vx, vy) ? 'move' : '';
    } else view.style.cursor = '';
    return;
  }
  const dpr = view.width / view.clientWidth;
  const k = dpr / S.view[0];
  const ddx = (e.clientX - drag.x) * k;
  const ddy = (e.clientY - drag.y) * k;
  if (drag.kind === 'pan') {
    S.settings.out.panX = drag.panX + (e.clientX - drag.x) / view.clientWidth;
    S.settings.out.panY = drag.panY + (e.clientY - drag.y) / view.clientHeight;
    S.dirty = true;
    return;
  }
  if (drag.kind === 'rec') {
    if (S.rec) recPointer(e.offsetX * dpr, e.offsetY * dpr);
    return;
  }
  if (drag.kind === 'orx' || drag.kind === 'ory' || drag.kind === 'octr') {
    const b = S.settings.layers[S.sel].beh;
    const [wx, wy] = V2W(e.offsetX * dpr, e.offsetY * dpr);
    if (drag.kind === 'octr') { b.cx = round(wx); b.cy = round(wy); } else {
      const d = drag.kind === 'orx' ? Math.abs(wx - drag.C[0]) : Math.abs(wy - drag.C[1]);
      if (e.shiftKey) { b.rx = round(d); b.ry = round(d); } else b[drag.kind === 'orx' ? 'rx' : 'ry'] = round(d);
    }
    drag.moved = true;
    rebake();
    return;
  }
  if (drag.kind === 'pivot') {
    const s = S.settings.layers[S.sel];
    const [x, y] = toLocal(worldOf(S.sel), e.offsetX * dpr, e.offsetY * dpr);
    setPivot(s, { x, y });
    drag.moved = true;
    rebake();
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
  drag.moved = true;
  setPlaying(false);
  const T = editTarget();
  const vx = e.offsetX * dpr, vy = e.offsetY * dpr;
  if (drag.kind === 'move' && S.tool === 'ubicar' && orbitsOther(drag.set.beh)) {
    // Gira alrededor de otra cosa: arrastrarla cambia la distancia y desde dónde arranca la vuelta.
    fitOrbit(S.sel, drag.q0[0] + ddx, drag.q0[1] + ddy);
  } else if (drag.kind === 'move') {
    T.dx = drag.start.dx + ddx;
    T.dy = drag.start.dy + ddy;
    if (e.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) T.dy = drag.start.dy; else T.dx = drag.start.dx; }
  } else if (drag.kind === 'scale') {
    const d0 = Math.hypot(drag.vx - drag.pv[0], drag.vy - drag.pv[1]) || 1;
    const d1 = Math.hypot(vx - drag.pv[0], vy - drag.pv[1]);
    T.sc = clamp(drag.start.sc * (d1 / d0), 0.05, 20);
    if (e.shiftKey) T.sc = Math.round(T.sc * 10) / 10;
  } else if (drag.kind === 'rotate') {
    const a0 = Math.atan2(drag.vy - drag.pv[1], drag.vx - drag.pv[0]);
    const a1 = Math.atan2(vy - drag.pv[1], vx - drag.pv[0]);
    let deg = ((a1 - a0) * 180) / Math.PI;
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    T.rot = drag.start.rot + deg;
    if (e.shiftKey) T.rot = Math.round(T.rot / 15) * 15;
  }
  rebake();
  markPending();
});
view.addEventListener('pointerup', () => {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === 'rec') { if (S.rec) S.rec.down = false; return; }
  if (d.kind === 'pan') { saveSettingsSoon(); return; }
  if (!d.moved) return;
  if (d.kind === 'orx' || d.kind === 'ory' || d.kind === 'octr') { changed(true); recordNow(); return; }
  if (S.tool === 'animar' && d.kind !== 'pivot') {
    if (S.autoKey) addKeyNow();
    else { renderProps(); flash('Pose lista · tocá “+ Clave” para guardarla en este momento'); }
    return;
  }
  changed(true);
  recordNow();
});
view.addEventListener('wheel', (e) => {
  if (S.tool !== 'encuadre' || !S.scene) return;
  e.preventDefault();
  const o = S.settings.out;
  o.zoom = clamp(o.zoom * Math.exp(-e.deltaY * 0.0015), 0.5, 3);
  S.dirty = true;
  saveSettingsSoon();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (S.rec) {
    if (e.key === 'Escape') { e.preventDefault(); cancelRecording(); }
    else if ((e.key === 'r' || e.key === 'R') && !mod) { e.preventDefault(); toggleRecording(); }
    else if (e.code === 'Space') e.preventDefault();
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && !mod && S.scene) { e.preventDefault(); toggleRecording(); return; }
  if (e.key === 'Escape' && S.pick) { S.pick = null; view.style.cursor = ''; flash('Listo, no se cambió el centro'); renderProps(); return; }
  if (e.code === 'Space' && S.scene) { e.preventDefault(); setPlaying(!S.playing); }
  if (e.key === 'Escape') { if (S.editPose) dropDraft(true); else select(-1); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selKey && S.sel >= 0) { e.preventDefault(); deleteKey(S.settings.layers[S.sel], S.selKey); }
  if ((e.key === 'k' || e.key === 'K') && !mod && S.sel >= 0) { e.preventDefault(); addKeyNow(); }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && S.sel >= 0 && S.tool !== 'encuadre') {
    e.preventDefault();
    const step = Math.max(1, Math.round(Math.max(S.scene.width, S.scene.height) / 1000)) * (e.shiftKey ? 10 : 1);
    const T = editTarget();
    T.dx = (T.dx || 0) + arrows[e.key][0] * step;
    T.dy = (T.dy || 0) + arrows[e.key][1] * step;
    rebake();
    markPending();
    if (S.tool !== 'animar') { saveSettingsSoon(); recordSoon(); }
    clearTimeout(S._nudgeT);
    S._nudgeT = setTimeout(() => renderProps(), 250);
  }
});

/* ---------- arranque: recuperar la última escena ---------- */
renderProps();
setTool('ubicar');
updateUndo();
/* Nunca arranca vacío: abre lo último que usaste, o el primer dibujo incluido. */
(async () => {
  showLoading('Abriendo tu escena…', 0);
  try { S.builtins = await listBuiltins(); } catch (err) { console.warn(err); S.builtins = []; }
  refreshArt();
  const last = await store.get('last').catch(() => null);
  if (last?.kind === 'import') {
    try { if (await openLastImport()) { hideLoading(); return; } } catch (err) { console.warn('Sin escena guardada', err); }
  }
  const id = (last?.kind === 'builtin' && S.builtins.some((b) => b.id === last.id)) ? last.id : S.builtins[0]?.id;
  if (id) { openBuiltin(id); return; }
  hideLoading();
  setStatus('Importá tu ilustración por capas');
})();

window.__escena = { S, handleFiles, startExport, setTab, select, applySettingsJson, settingsJson, openBuiltin, openLastImport, resetBuiltin, setTool, addKeyNow, undo, redo, handlesOf, renderProps, startRecording, finishRecording, cancelRecording, setOrbitCenter, pivotWorld, orbitCenterNow, V2W, W2V };
