/** Panel de rigging: pivote, pose y movimiento del pelo. */

import { exportManifest, parseRigImport } from './rigio.js';
import {
  clearOverrides,
  emptyRig,
  movePart,
  normalizeStore,
  partTitle,
  saveOverrides,
} from './rigparams.js';

const POSE = [
  ['dx', 'Posición X', -40, 40, 1],
  ['dy', 'Posición Y', -40, 40, 1],
  ['scale', 'Escala', 0.7, 1.3, 0.01],
  ['rot', 'Rotación base', -30, 30, 1],
];
const MOTION = [
  ['sway', 'Balanceo', 0, 20, 0.1],
  ['speed', 'Velocidad', 0, 3, 0.01],
  ['stiffness', 'Rigidez del resorte', 20, 400, 1],
  ['damping', 'Amortiguación', 2, 40, 0.5],
  ['phase', 'Retraso / fase', 0, 1, 0.01],
  ['gravity', 'Gravedad / caída', -10, 10, 0.5],
  ['follow', 'Seguir cabeza', 0, 2, 0.05],
  ['limit', 'Límite de giro', 2, 30, 0.5],
];

export function createRigEditor(doc, puppet, toast) {
  const layout = doc.getElementById('layout');
  const panel = doc.getElementById('rig-panel');
  const body = doc.getElementById('rig-body');
  const canvas = doc.getElementById('avatar');
  const backdrop = doc.getElementById('backdrop');
  let opened = false;
  let previewOn = false;
  let selected = 'strand_r';
  let dragging = false;
  let built = false;

  function say(message) {
    if (typeof toast === 'function' && message) toast(message);
  }

  function parts() {
    return (puppet.getManifest()?.parts || []).filter((part) => part && part.role !== 'mouth' && part.id !== 'mouth');
  }

  function part() {
    return puppet.getManifest()?.byId?.[selected] || null;
  }

  function store() {
    const norm = normalizeStore(puppet.getStore());
    if (!norm.order?.length) norm.order = (puppet.getManifest()?.parts || []).map((item) => item.id);
    return norm;
  }

  function commit(next) {
    puppet.installOverrides(next);
    saveOverrides(next);
  }

  function set(id, params) {
    const current = puppet.getManifest()?.byId?.[id];
    if (!current) return false;
    const next = store();
    const prev = next.parts[id] || { ...(current.rig || emptyRig(current)) };
    if (Array.isArray(current.pivot)) prev.pivot = [+current.pivot[0], +current.pivot[1]];
    next.parts[id] = { ...prev, ...params };
    commit(next);
    if (id === selected) sync();
    return true;
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearPivot(pt) {
    const item = part();
    if (!item || !Array.isArray(item.pivot)) return false;
    const parent = puppet.parentPoint(pt.x, pt.y, item.id);
    if (!parent) return false;
    const rig = item.rig || {};
    const cx = +item.pivot[0] + (rig.dx || 0);
    const cy = +item.pivot[1] + (rig.dy || 0);
    return Math.hypot(parent.x - cx, parent.y - cy) < 18;
  }

  function field(key, label, min, max, step) {
    const row = doc.createElement('label');
    row.className = 'slider-row';
    row.innerHTML = `<span>${label} <b data-val="${key}"></b></span><input data-key="${key}" type="range" min="${min}" max="${max}" step="${step}" />`;
    return row;
  }

  function build() {
    body.replaceChildren();
    const pick = doc.createElement('label');
    pick.className = 'slider-row';
    pick.innerHTML = 'Pieza<select id="rig-part"></select>';
    body.appendChild(pick);
    for (const spec of POSE) body.appendChild(field(...spec));
    const visible = doc.createElement('label');
    visible.className = 'color-row';
    visible.innerHTML = 'Visible<input id="rig-visible" type="checkbox" />';
    body.appendChild(visible);
    const order = doc.createElement('div');
    order.className = 'actions';
    order.innerHTML = '<button type="button" id="rig-up">Subir</button><button type="button" id="rig-down">Bajar</button>';
    body.appendChild(order);
    const motion = doc.createElement('div');
    motion.id = 'rig-motion';
    const title = doc.createElement('h3');
    title.textContent = 'Movimiento';
    motion.appendChild(title);
    for (const spec of MOTION) motion.appendChild(field(...spec));
    body.appendChild(motion);
    const preview = doc.createElement('button');
    preview.type = 'button';
    preview.id = 'rig-preview';
    preview.textContent = 'Probar movimiento';
    body.appendChild(preview);
    const files = doc.createElement('div');
    files.className = 'actions';
    files.innerHTML = '<button type="button" id="rig-export">Exportar rig.json</button><button type="button" id="rig-import-btn">Importar</button><button type="button" id="rig-reset-one">Restablecer parte</button><button type="button" id="rig-reset-all" class="wide">Restablecer todo</button>';
    body.appendChild(files);
    const input = doc.createElement('input');
    input.id = 'rig-import';
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    body.appendChild(input);
    body.addEventListener('input', onInput);
    body.addEventListener('change', onInput);
    body.addEventListener('click', onClick);
    built = true;
  }

  function onInput(event) {
    const key = event.target?.dataset?.key;
    if (key) {
      set(selected, { [key]: Number(event.target.value) });
      return;
    }
    if (event.target?.id === 'rig-visible') set(selected, { visible: event.target.checked });
    if (event.target?.id === 'rig-part') select(event.target.value);
  }

  function onClick(event) {
    const id = event.target?.id;
    if (id === 'rig-up') shift(-1);
    if (id === 'rig-down') shift(1);
    if (id === 'rig-preview') preview(!previewOn);
    if (id === 'rig-export') download();
    if (id === 'rig-import-btn') body.querySelector('#rig-import')?.click();
    if (id === 'rig-reset-one') resetOne();
    if (id === 'rig-reset-all') resetAll();
  }

  function shift(dir) {
    const next = store();
    const ordered = movePart(puppet.getManifest().parts, selected, dir);
    next.order = ordered.map((item) => item.id);
    commit(next);
    sync();
  }

  function download() {
    const json = exportManifest(puppet.getSource(), puppet.getManifest());
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    a.download = 'rig.json';
    a.click();
    say('rig.json descargado');
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = parseRigImport(JSON.parse(await file.text()));
      if (!parsed.ok) { say(parsed.error); return; }
      commit(normalizeStore(parsed.overrides));
      sync();
      say('Rig importado');
    } catch {
      say('No se pudo leer el archivo');
    }
  }

  function resetOne() {
    const next = store();
    delete next.parts[selected];
    commit(next);
    sync();
    say('Pieza restablecida');
  }

  function resetAll() {
    if (!doc.defaultView?.confirm('¿Restablecer todo el rigging?')) return;
    clearOverrides();
    puppet.resetAll();
    sync();
    say('Rigging restablecido');
  }

  function refreshOptions() {
    const selectEl = body.querySelector('#rig-part');
    if (!selectEl) return;
    const current = selected;
    selectEl.replaceChildren();
    for (const item of parts()) {
      const option = doc.createElement('option');
      option.value = item.id;
      option.textContent = partTitle(item);
      selectEl.appendChild(option);
    }
    if ([...selectEl.options].some((option) => option.value === current)) selectEl.value = current;
  }

  function sync() {
    const item = part();
    if (!item || !built) return;
    const rig = item.rig || emptyRig(item);
    const selectEl = body.querySelector('#rig-part');
    if (selectEl && selectEl.value !== item.id) selectEl.value = item.id;
    for (const input of body.querySelectorAll('input[data-key]')) {
      const key = input.dataset.key;
      const value = Number(rig[key] ?? 0);
      if (doc.activeElement !== input) input.value = String(value);
      const label = body.querySelector(`[data-val="${key}"]`);
      if (label) label.textContent = value.toFixed(Math.abs(value) >= 10 || Number.isInteger(value) ? 0 : 2);
    }
    const box = body.querySelector('#rig-visible');
    if (box) box.checked = rig.visible !== false;
    const motion = body.querySelector('#rig-motion');
    if (motion) motion.hidden = !(item.role === 'hair' || item.role === 'ear');
    const preview = body.querySelector('#rig-preview');
    if (preview) preview.setAttribute('aria-pressed', String(previewOn));
    puppet.setHighlight(opened ? item.id : null);
  }

  function select(id) {
    if (!puppet.getManifest()?.byId?.[id]) return;
    selected = id;
    refreshOptions();
    sync();
  }

  function preview(flag) {
    previewOn = Boolean(flag);
    const button = body.querySelector('#rig-preview');
    if (button) button.setAttribute('aria-pressed', String(previewOn));
  }

  function mobile() {
    return doc.defaultView?.matchMedia?.('(max-width: 900px)')?.matches ?? false;
  }

  function open() {
    opened = true;
    layout.classList.add('rig-open');
    layout.classList.remove('panel-open');
    if (panel) panel.hidden = false;
    if (backdrop) backdrop.hidden = !mobile();
    doc.getElementById('btn-rig')?.setAttribute('aria-expanded', 'true');
    doc.getElementById('btn-panel')?.setAttribute('aria-expanded', 'false');
    if (!built) {
      build();
      body.querySelector('#rig-import')?.addEventListener('change', (event) => { void onFile(event); });
    }
    const known = puppet.getManifest()?.byId?.[selected];
    selected = known ? selected : (parts()[0]?.id || 'strand_r');
    select(selected);
  }

  function close() {
    opened = false;
    previewOn = false;
    dragging = false;
    layout.classList.remove('rig-open');
    if (panel) panel.hidden = true;
    if (backdrop && !layout.classList.contains('panel-open')) backdrop.hidden = true;
    doc.getElementById('btn-rig')?.setAttribute('aria-expanded', 'false');
    puppet.setHighlight(null);
  }

  function onPointerDown(event) {
    if (!opened) return false;
    const pt = point(event);
    if (selected && nearPivot(pt)) {
      dragging = true;
      return true;
    }
    const hit = puppet.hitTest(pt.x, pt.y);
    if (hit) select(hit);
    return false;
  }

  function onPointerMove(event) {
    if (!dragging || !selected) return;
    const pt = point(event);
    const parent = puppet.parentPoint(pt.x, pt.y, selected);
    if (!parent) return;
    const rig = part()?.rig || {};
    set(selected, { pivot: [parent.x - (rig.dx || 0), parent.y - (rig.dy || 0)] });
  }

  function onPointerUp() {
    dragging = false;
  }

  return {
    open,
    close,
    select,
    set,
    preview,
    isOpen: () => opened,
    previewing: () => previewOn && opened,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
