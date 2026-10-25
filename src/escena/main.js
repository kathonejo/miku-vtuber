import './escena.css';
import { importPngFiles, importPsdFile } from './importer.js';
import {
  BEHAVIORS, EASINGS, OUTPUTS, PRESETS, applyPreset, autoMbps, defaultPivot, defaultPose,
  guessBehavior, makeLayerSettings, makeSceneSettings, outputSize,
} from './model.js';
import { bake, cyclesFor, sample } from './anim.js';
import { renderFrame, viewMatrix } from './render.js';
import { exportVideo } from './exporter.js';
import * as store from './store.js';

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
  tool: 'capa',
  editPose: null,
  dirty: true,
  exporting: false,
};

/* ---------- estructura ---------- */
const app = $('#sc-app');
const statusEl = el('span', { class: 'sc-status', role: 'status' }, 'Importá tu ilustración por capas');
const fileInput = el('input', { type: 'file', multiple: true, accept: '.psd,.png,.webp,.json', hidden: true, id: 'sc-file' });
const playBtn = el('button', { type: 'button', class: 'sc-play', title: 'Reproducir o pausar (barra espaciadora)', onclick: () => setPlaying(!S.playing) }, '⏸ Pausa');
const exportTopBtn = el('button', { type: 'button', class: 'primary', title: 'Elegí tamaño y exportá el MP4', onclick: () => { setTab('exportar'); } }, 'Exportar video');
const top = el('header', { class: 'sc-top' },
  el('div', { class: 'sc-brand' },
    el('a', { href: './', class: 'sc-back', title: 'Volver a la marioneta VTuber' }, '← VTuber'),
    el('div', {}, el('strong', {}, 'Escena'), statusEl)),
  el('div', { class: 'sc-actions' },
    el('label', { class: 'btn', title: 'Un PSD con capas, o varios PNG (y su indice_capas.json si lo tenés)' }, 'Importar PSD o PNG', fileInput),
    playBtn, exportTopBtn));

const layerList = el('div', { class: 'sc-list', role: 'listbox', 'aria-label': 'Capas' });
const layersPane = el('aside', { class: 'sc-layers' },
  el('div', { class: 'sc-pane-head' }, el('h2', {}, 'Capas'), el('span', { class: 'sc-count' })),
  el('p', { class: 'sc-hint' }, 'Arriba = adelante, como en tu archivo.'),
  layerList);

const view = el('canvas', { class: 'sc-view', 'aria-label': 'Vista previa de la escena' });
const empty = el('div', { class: 'sc-empty' },
  el('div', { class: 'sc-card' },
    el('p', { class: 'eyebrow' }, 'Escena animada'),
    el('h1', {}, 'Tu ilustración, en movimiento'),
    el('p', { class: 'lead' }, 'Soltá acá tu PSD por capas o tus PNG sueltos (con su indice_capas.json). Cada capa queda tal cual la dibujaste: sólo le damos movimiento.'),
    el('div', { class: 'sc-card-actions' }, el('label', { class: 'btn primary' }, 'Elegir archivos', el('input', { type: 'file', multiple: true, accept: '.psd,.png,.webp,.json', hidden: true, onchange: (e) => handleFiles(e.target.files) }))),
    el('p', { class: 'sc-small' }, 'Todo queda en tu compu; nada se sube a internet.')));
const timeLabel = el('span', { class: 'sc-time' }, '0.0 s');
const scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'sc-scrub', 'aria-label': 'Tiempo', title: 'Mové para ver cualquier momento del loop' });
const toolCapa = el('button', { type: 'button', class: 'sc-seg on', title: 'Clic para elegir una capa; arrastrala para darle pose; arrastrá el punto para mover el pivote', onclick: () => setTool('capa') }, 'Mover capa');
const toolEnc = el('button', { type: 'button', class: 'sc-seg', title: 'Arrastrá para mover el encuadre; ruedita para zoom', onclick: () => setTool('encuadre') }, 'Mover encuadre');
const frameLabel = el('span', { class: 'sc-frame-label' });
const stage = el('section', { class: 'sc-stage' },
  el('div', { class: 'sc-canvas-wrap' }, view, empty),
  el('div', { class: 'sc-timeline' },
    el('div', { class: 'sc-segs' }, toolCapa, toolEnc),
    timeLabel, scrub, frameLabel));

const props = el('div', { class: 'sc-props-body' });
const tabs = el('div', { class: 'sc-tabs', role: 'tablist' },
  ...[['capa', 'Capa'], ['escena', 'Escena'], ['exportar', 'Exportar']].map(([id, label]) =>
    el('button', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => setTab(id) }, label)));
const propsPane = el('aside', { class: 'sc-props' }, tabs, props);

const layout = el('main', { class: 'sc-layout' }, layersPane, stage, propsPane);
const progress = el('div', { class: 'sc-progress', hidden: true },
  el('div', { class: 'sc-card' },
    el('h2', { class: 'sc-progress-title' }, 'Exportando…'),
    el('div', { class: 'sc-bar' }, el('i')),
    el('p', { class: 'sc-progress-text' }, ''),
    el('div', { class: 'sc-card-actions' },
      el('button', { type: 'button', class: 'sc-progress-cancel', onclick: () => { S.cancel = true; } }, 'Cancelar'),
      el('a', { class: 'btn primary sc-progress-dl', hidden: true }, 'Descargar'),
      el('button', { type: 'button', class: 'sc-progress-close', hidden: true, onclick: () => { progress.hidden = true; } }, 'Cerrar'))));
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
    openScene(scene);
    if (settingsFile) applySettingsJson(JSON.parse(await settingsFile.text()));
    const extra = [];
    if (scene.skipped) extra.push(`salteé ${scene.skipped} capas ocultas`);
    if (scene.unplaced) extra.push(`${scene.unplaced} PNG sin posición (quedaron centrados)`);
    setStatus(`${scene.name}: ${scene.layers.length} capas${extra.length ? ` · ${extra.join(' · ')}` : ''}`);
    store.saveSceneImages(scene).then(() => saveSettingsSoon()).catch((err) => console.warn('No pude guardar la escena', err));
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
  S.t = 0;
  empty.hidden = true;
  document.body.classList.add('has-scene');
  rebake();
  renderList();
  renderProps();
  resize();
}

/* ---------- ajustes: guardar / cargar ---------- */
function settingsJson() {
  const s = S.settings;
  return {
    tipo: 'escena-bunny-vtuber', version: 1,
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
    s.layers[i] = { ...s.layers[i], ...rest, kf: { ...s.layers[i].kf, ...(rest.kf || {}) } };
    matched += 1;
  });
  if (!quiet) setStatus(`Ajustes cargados en ${matched} de ${S.scene.layers.length} capas.`);
  changed(true);
}

let saveTimer = 0;
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (S.scene) store.put('settings', settingsJson()).catch(() => {}); }, 600);
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
  if (full) { renderList(); renderProps(); }
}

/* ---------- lista de capas ---------- */
const ICON = { none: '·', flotar: '≈', balanceo: '〰', deriva: '→', brillo: '✦' };

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
    s.poco ? el('span', { class: 'sc-badge', title: 'Mover poco: limitado para que no se vea el hueco detrás' }, '🔒') : null,
    el('span', { class: `sc-chip b-${s.beh.type}`, title: beh?.[2] }, ICON[s.beh.type] || '·'),
    el('button', {
      type: 'button', class: 'sc-eye', title: s.visible ? 'Ocultar capa' : 'Mostrar capa',
      onclick: (e) => { e.stopPropagation(); s.visible = !s.visible; changed(true); },
    }, s.visible ? '👁' : '–')));
  }
}

function select(i) {
  S.sel = i;
  if (i >= 0) {
    const kf = S.settings.layers[i].kf;
    S.editPose = null;
    S._poseDraft = kf.on ? { ...kf.a } : defaultPose();
  }
  if (S.tab !== 'capa' && i >= 0) S.tab = 'capa';
  rebake();
  renderList();
  renderProps();
  const item = layerList.querySelector(`[data-i="${i}"]`);
  item?.scrollIntoView({ block: 'nearest' });
}

/* ---------- controles ---------- */
function slider(label, tip, value, min, max, step, onInput, fmt = (v) => v) {
  const out = el('output', {}, fmt(value));
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); onInput(v); });
  return el('label', { class: 'sc-field', title: tip }, el('span', { class: 'sc-label' }, label, out), input);
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
}

function renderLayerProps() {
  const i = S.sel;
  if (i < 0) {
    props.append(el('div', { class: 'sc-empty-props' },
      el('p', {}, 'Tocá una capa en la lista o en la vista para darle movimiento.'),
      el('p', { class: 'sc-hint' }, 'Consejo: empezá por un preset en la pestaña Escena y después ajustá de a una.')));
    return;
  }
  const l = S.scene.layers[i];
  const s = S.settings.layers[i];
  const unit = Math.max(S.scene.width, S.scene.height) / 1000;
  const D = S.settings.duration;
  props.append(el('div', { class: 'sc-layer-title' }, el('strong', {}, l.name), l.group ? el('span', {}, l.group) : null));

  const segs = el('div', { class: 'sc-behs' }, ...BEHAVIORS.map(([id, label, tip]) => btn(`${ICON[id]} ${label}`, tip, () => {
    const guess = guessBehavior(l, S.scene);
    const defaults = {
      flotar: { amp: 4 * unit, period: 6, rot: 0.5 },
      balanceo: { amp: 4, period: 4, stiff: 0.45 },
      deriva: { period: D, rot: 0 },
      brillo: { depth: 0.5, glow: 0.7, period: 3 },
      none: {},
    }[id];
    s.beh = { ...defaults, ...(guess.type === id ? guess : {}), type: id };
    s.pivot = defaultPivot(l, id);
    changed(true);
  }, s.beh.type === id ? 'on' : '')));
  const b = s.beh;
  const cyc = (p) => `${round(p, 1)} s${S.settings.loop ? ` · ${cyclesFor(p, D, true)}×` : ''}`;
  const params = [];
  if (b.type === 'flotar') {
    params.push(slider('Altura', 'Cuánto sube y baja', round(b.amp / unit, 1), 0, 30, 0.5, (v) => { b.amp = v * unit; changed(); }));
    params.push(slider('Ritmo', 'Segundos por vuelta (se ajusta para que el loop cierre perfecto)', b.period, 1, 20, 0.5, (v) => { b.period = v; changed(); }, cyc));
    params.push(slider('Giro', 'Cuánto se ladea al flotar, en grados', b.rot || 0, 0, 6, 0.1, (v) => { b.rot = v; changed(); }, (v) => `${v}°`));
  } else if (b.type === 'balanceo') {
    params.push(slider('Ángulo', 'Cuánto se mece, en grados', b.amp, 0, 25, 0.5, (v) => { b.amp = v; changed(); }, (v) => `${v}°`));
    params.push(slider('Ritmo', 'Segundos por vaivén', b.period, 1, 12, 0.5, (v) => { b.period = v; changed(); }, cyc));
    params.push(slider('Rigidez', 'Más bajo = más elástico y rebota más', b.stiff ?? 0.45, 0, 1, 0.05, (v) => { b.stiff = v; changed(); }, (v) => `${Math.round(v * 100)}%`));
  } else if (b.type === 'deriva') {
    params.push(slider('Ritmo', 'Segundos en cruzar toda la escena', b.period, 2, Math.max(30, D), 0.5, (v) => { b.period = v; changed(); }, cyc));
    params.push(el('p', { class: 'sc-hint' }, 'Sale por un costado y vuelve a entrar por el otro.'));
  } else if (b.type === 'brillo') {
    params.push(slider('Titileo', 'Cuánto baja su luz al latir', b.depth ?? 0.5, 0, 1, 0.05, (v) => { b.depth = v; changed(); }, (v) => `${Math.round(v * 100)}%`));
    params.push(slider('Resplandor', 'Brillo suave alrededor, hecho con su propio dibujo', b.glow ?? 0.6, 0, 1.5, 0.05, (v) => { b.glow = v; changed(); }, (v) => `${Math.round(v * 100)}%`));
    params.push(slider('Ritmo', 'Segundos por latido', b.period, 0.5, 10, 0.25, (v) => { b.period = v; changed(); }, cyc));
  }
  props.append(section('Movimiento', segs, ...params));

  props.append(section('Ritmo propio',
    row(slider('Desfase', 'Corre su movimiento en el tiempo para que no vaya igual que las demás', s.phase, 0, 1, 0.01, (v) => { s.phase = v; changed(); }, (v) => `${Math.round(v * 100)}%`),
      btn('🎲', 'Desfase aleatorio para esta capa', () => { s.phase = round(Math.random(), 2); changed(true); }, 'sc-icon'))));

  const pivotKids = [
    row(btn('Pivote abajo', 'Para pasto, flores, orejas: se mece desde la base', () => { s.pivot = defaultPivot(l, 'balanceo'); changed(); }),
      btn('Pivote al centro', 'Gira desde el medio', () => { s.pivot = defaultPivot(l, 'flotar'); changed(); })),
    el('p', { class: 'sc-hint' }, 'O arrastrá el punto celeste en la vista.'),
  ];
  props.append(section('Pivote', ...pivotKids));

  props.append(section('Cuidado con los huecos',
    toggle('Mover poco', 'Para capas sin relleno detrás: limita cuánto se puede mover', s.poco, (v) => { s.poco = v; changed(true); }),
    s.poco ? slider('Máximo', 'Lo más que se puede correr, en píxeles del archivo', s.maxMove, 1, Math.round(unit * 20), 1, (v) => { s.maxMove = v; changed(); }, (v) => `${v} px`) : null));

  const parentOpts = [['', 'Ninguna (se mueve sola)'], ...S.scene.layers.map((x, k) => [String(k), x.name]).filter(([k]) => Number(k) !== i)];
  props.append(section('Seguir a otra capa',
    select_('Sigue a', 'Se mueve junto con esa capa, como pegada', s.parent ?? '', parentOpts, (v) => {
      s.parent = v === '' ? null : Number(v);
      if (s.parent != null && !s.follow) s.follow = 0.6;
      changed(true);
    }),
    s.parent != null ? slider('Rebote al seguir', 'Física secundaria: se queda atrás y rebota cuando la otra se mueve', s.follow || 0, 0, 2, 0.05, (v) => { s.follow = v; changed(); }, (v) => `${Math.round(v * 100)}%`) : null));

  props.append(keyframeSection(i, l, s, unit));
}

function keyframeSection(i, l, s, unit) {
  const kf = s.kf;
  const draft = S._poseDraft || (S._poseDraft = kf.on ? { ...kf.a } : defaultPose());
  const setDraft = (k, v) => { draft[k] = v; S.editPose = { ...draft }; setPlaying(false); rebake(); };
  const range = Math.round(unit * 150);
  const kids = [
    el('p', { class: 'sc-hint' }, 'Poné la capa como querés que empiece (arrastrala en la vista o con estos controles) y tocá “Marcar inicio”. Después llevala al final y tocá “Marcar fin”. Va y vuelve sola.'),
    slider('X', 'Correr a los costados', round(draft.dx), -range, range, 1, (v) => setDraft('dx', v), (v) => `${Math.round(v)} px`),
    slider('Y', 'Subir o bajar', round(draft.dy), -range, range, 1, (v) => setDraft('dy', v), (v) => `${Math.round(v)} px`),
    slider('Giro', 'Rotar desde el pivote', draft.rot, -45, 45, 0.5, (v) => setDraft('rot', v), (v) => `${v}°`),
    slider('Tamaño', 'Agrandar o achicar', draft.sc, 0.5, 1.5, 0.01, (v) => setDraft('sc', v), (v) => `${Math.round(v * 100)}%`),
    slider('Opacidad', 'Transparencia', draft.op, 0, 1, 0.01, (v) => setDraft('op', v), (v) => `${Math.round(v * 100)}%`),
    row(btn('Marcar inicio', 'Guarda esta pose como el comienzo', () => { kf.a = { ...draft }; kf.on = true; S.editPose = null; changed(true); flash('Inicio marcado'); }, 'primary'),
      btn('Marcar fin', 'Guarda esta pose como el final', () => { kf.b = { ...draft }; kf.on = true; S.editPose = null; changed(true); flash('Fin marcado'); }, 'primary')),
    kf.on ? row(btn('Ver inicio', 'Muestra la pose de inicio para retocarla', () => { S._poseDraft = { ...kf.a }; S.editPose = { ...kf.a }; setPlaying(false); rebake(); renderProps(); }),
      btn('Ver fin', 'Muestra la pose de fin para retocarla', () => { S._poseDraft = { ...kf.b }; S.editPose = { ...kf.b }; setPlaying(false); rebake(); renderProps(); }),
      btn('Borrar', 'Saca la animación inicio → fin', () => { kf.on = false; kf.a = defaultPose(); kf.b = defaultPose(); S._poseDraft = defaultPose(); S.editPose = null; changed(true); })) : null,
    kf.on ? select_('Curva', 'Cómo acelera y frena entre inicio y fin', kf.ease, EASINGS, (v) => { kf.ease = v; changed(); }) : null,
    kf.on ? slider('Ida y vuelta', 'Segundos que tarda en ir y volver', kf.period || S.settings.duration, 1, Math.max(30, S.settings.duration), 0.5, (v) => { kf.period = v; changed(); }, (v) => `${round(v, 1)} s${S.settings.loop ? ` · ${cyclesFor(v, S.settings.duration, true)}×` : ''}`) : null,
    kf.on ? toggle('Pausa en los extremos', 'Se queda un ratito en el inicio y en el fin', kf.hold, (v) => { kf.hold = v; changed(); }) : null,
    kf.on ? el('p', { class: 'sc-ok' }, '✓ Animación activa. Tocá ▶ para verla.') : null,
  ];
  return section('Animar de inicio a fin', ...kids);
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
  el('div', { class: 'sc-export-go' }, btn('Exportar MP4', 'Arma el video cuadro por cuadro (puede tardar unos minutos)', startExport, 'primary big')));
  void mb;
}

function sizeText(mbps) {
  const mb = (mbps * S.settings.duration) / 8;
  return `Peso aproximado: ${Math.round(mb)} MB${mb > 250 ? ' — ¡pasa de 250 MB! bajá la calidad' : ' (límite 250 MB ✓)'}`;
}

/* ---------- exportar ---------- */
async function startExport() {
  if (S.exporting) return;
  const s = S.settings;
  const { w, h } = outputSize(s.out.preset, S.scene);
  const mbps = s.out.mbps || autoMbps(w, h);
  S.exporting = true;
  S.cancel = false;
  const wasPlaying = S.playing;
  setPlaying(false);
  S.editPose = null;
  rebake();
  progress.hidden = false;
  const bar = $('.sc-bar i', progress);
  const txt = $('.sc-progress-text', progress);
  const dl = $('.sc-progress-dl', progress);
  $('.sc-progress-title', progress).textContent = 'Exportando video…';
  $('.sc-progress-cancel', progress).hidden = false;
  $('.sc-progress-close', progress).hidden = true;
  dl.hidden = true;
  const t0 = performance.now();
  try {
    const res = await exportVideo({
      scene: S.scene, settings: s, baked: S.baked, w, h, mbps,
      isCancelled: () => S.cancel,
      onProgress: (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        const el2 = (performance.now() - t0) / 1000;
        const left = p > 0.02 ? Math.max(0, el2 / p - el2) : 0;
        txt.textContent = `${Math.round(p * 100)}% · cuadro ${Math.round(p * s.duration * s.fps)} de ${Math.round(s.duration * s.fps)}${left ? ` · faltan ~${Math.ceil(left)} s` : ''}`;
      },
    });
    const name = `${S.scene.name}_${w}x${h}_${s.duration}s.${res.ext}`;
    dl.href = URL.createObjectURL(res.blob);
    dl.download = name;
    dl.hidden = false;
    dl.textContent = `Descargar ${res.ext.toUpperCase()} (${(res.blob.size / 1e6).toFixed(1)} MB)`;
    $('.sc-progress-title', progress).textContent = '¡Listo!';
    txt.textContent = `${name}${res.ext === 'webm' ? ' · este navegador no arma MP4; probá con Chrome o Edge' : ''}`;
    dl.click();
  } catch (err) {
    $('.sc-progress-title', progress).textContent = S.cancel ? 'Cancelado' : 'No se pudo exportar';
    txt.textContent = S.cancel ? '' : String(err.message || err);
  } finally {
    S.exporting = false;
    $('.sc-progress-cancel', progress).hidden = true;
    $('.sc-progress-close', progress).hidden = false;
    if (wasPlaying) setPlaying(true);
  }
}

/* ---------- reproducción, vista y herramientas ---------- */
function setPlaying(on) {
  S.playing = on;
  if (on && S.editPose) { S.editPose = null; rebake(); }
  playBtn.textContent = on ? '⏸ Pausa' : '▶ Reproducir';
  S.last = performance.now();
}
function setTool(t) {
  S.tool = t;
  toolCapa.classList.toggle('on', t === 'capa');
  toolEnc.classList.toggle('on', t === 'encuadre');
  view.classList.toggle('pan', t === 'encuadre');
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
  setPlaying(false);
  S.t = (Number(scrub.value) / 1000) * S.settings.duration;
  S.dirty = true;
});

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
  if (S.playing && !S.exporting) { S.t = (S.t + dt) % S.settings.duration; S.dirty = true; }
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

function drawOverlay() {
  const i = S.sel;
  if (i < 0 || !S.baked.layers[i]) return;
  const l = S.scene.layers[i];
  const s = S.settings.layers[i];
  const m = worldOf(i);
  const dpr = view.width / view.clientWidth;
  vctx.save();
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  const pts = [[l.x, l.y], [l.x + l.w, l.y], [l.x + l.w, l.y + l.h], [l.x, l.y + l.h]].map(([x, y]) => toView(m, x, y));
  vctx.strokeStyle = 'rgba(122, 215, 228, 0.9)';
  vctx.lineWidth = 1.5 * dpr;
  vctx.setLineDash([6 * dpr, 4 * dpr]);
  vctx.beginPath();
  pts.forEach(([x, y], k) => (k ? vctx.lineTo(x, y) : vctx.moveTo(x, y)));
  vctx.closePath();
  vctx.stroke();
  vctx.setLineDash([]);
  const [px, py] = toView(m, s.pivot.x, s.pivot.y);
  vctx.fillStyle = '#49c6d6';
  vctx.strokeStyle = '#062028';
  vctx.lineWidth = 2 * dpr;
  vctx.beginPath();
  vctx.arc(px, py, 7 * dpr, 0, Math.PI * 2);
  vctx.fill();
  vctx.stroke();
  vctx.restore();
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

function hitTest(vx, vy) {
  const big = S.scene.width * S.scene.height * 0.5;
  let fallback = -1;
  for (let i = S.scene.layers.length - 1; i >= 0; i -= 1) {
    const l = S.scene.layers[i];
    if (!S.settings.layers[i].visible) continue;
    const m = worldOf(i);
    const v = S.view;
    const wx = (vx - v[4]) / v[0];
    const wy = (vy - v[5]) / v[3];
    const det = m[0] * m[3] - m[1] * m[2];
    const x = (m[3] * (wx - m[4]) - m[2] * (wy - m[5])) / det;
    const y = (-m[1] * (wx - m[4]) + m[0] * (wy - m[5])) / det;
    if (x < l.x || y < l.y || x >= l.x + l.w || y >= l.y + l.h) continue;
    const hm = hitMap(l);
    const a = hm.a[Math.floor(((y - l.y) / l.h) * hm.h) * hm.w + Math.floor(((x - l.x) / l.w) * hm.w)];
    if (a < 40) continue;
    if (l.w * l.h > big) { if (fallback < 0) fallback = i; continue; }
    return i;
  }
  return fallback;
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
  if (S.sel >= 0) {
    const s = S.settings.layers[S.sel];
    const [px, py] = toView(worldOf(S.sel), s.pivot.x, s.pivot.y);
    if (Math.hypot(px - vx, py - vy) < 14 * dpr) {
      drag = { kind: 'pivot', x: e.clientX, y: e.clientY, px: s.pivot.x, py: s.pivot.y };
      return;
    }
  }
  const hit = hitTest(vx, vy);
  if (hit < 0) return;
  if (hit !== S.sel) select(hit);
  const draft = S._poseDraft || (S._poseDraft = defaultPose());
  drag = { kind: 'pose', x: e.clientX, y: e.clientY, dx: draft.dx, dy: draft.dy, moved: false };
});
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = (view.width / view.clientWidth) / S.view[0];
  const ddx = (e.clientX - drag.x) * k;
  const ddy = (e.clientY - drag.y) * k;
  if (drag.kind === 'pan') {
    S.settings.out.panX = drag.panX + (e.clientX - drag.x) / view.clientWidth;
    S.settings.out.panY = drag.panY + (e.clientY - drag.y) / view.clientHeight;
    S.dirty = true;
  } else if (drag.kind === 'pivot') {
    const s = S.settings.layers[S.sel];
    s.pivot = { x: drag.px + ddx, y: drag.py + ddy };
    rebake();
  } else if (drag.kind === 'pose') {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    setPlaying(false);
    const d = S._poseDraft;
    d.dx = drag.dx + ddx;
    d.dy = drag.dy + ddy;
    S.editPose = { ...d };
    rebake();
  }
});
view.addEventListener('pointerup', () => {
  if (drag && (drag.kind === 'pivot' || drag.kind === 'pan')) saveSettingsSoon();
  if (drag?.kind === 'pose' && drag.moved) { renderProps(); flash('Pose movida · tocá “Marcar inicio” o “Marcar fin”'); }
  drag = null;
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
  if (e.code === 'Space' && S.scene) { e.preventDefault(); setPlaying(!S.playing); }
  if (e.key === 'Escape') { select(-1); }
});

/* ---------- arranque: recuperar la última escena ---------- */
renderProps();
setTool('capa');
(async () => {
  try {
    const scene = await store.loadSceneImages();
    if (!scene) return;
    const saved = await store.get('settings');
    openScene(scene, saved && saved.escena?.nombre === scene.name ? saved : null);
    setStatus(`Recuperé “${scene.name}” (${scene.layers.length} capas) de la última vez`);
  } catch (err) {
    console.warn('Sin escena guardada', err);
  }
})();

window.__escena = { S, handleFiles, startExport, setTab, select, applySettingsJson, settingsJson };
