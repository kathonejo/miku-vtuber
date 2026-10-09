import {
  BUNNY_ID,
  BUNNY_NAME,
  deleteCharacter,
  getCharacter,
  lastCharacterId,
  listCharacters,
  mappingFromRecord,
  putCharacter,
  recordFromMapping,
  rememberCharacter,
} from './characters.js';
import { openMapper } from './mapmodal.js';
import { composeManifest } from './psdimport/build.js';
import { importPsd } from './psdimport/read.js';
import {
  currentRigCharacter,
  loadOverrides,
  onRigSave,
  saveOverrides,
  setRigCharacter,
} from './rigparams.js';
import { manifestThumb } from './sheetpreview.js';
function bunnyThumb() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#243a5c';
  ctx.fillRect(0, 0, 64, 80);
  ctx.fillStyle = '#c8e03c';
  ctx.beginPath(); ctx.ellipse(22, 22, 8, 16, 0, 0, 6.3); ctx.fill();
  ctx.beginPath(); ctx.ellipse(42, 20, 8, 16, 0, 0, 6.3); ctx.fill();
  ctx.fillStyle = '#f7a98f';
  ctx.beginPath(); ctx.arc(32, 50, 14, 0, 6.3); ctx.fill();
  return canvas.toDataURL('image/png');
}
const BUNNY_THUMB = bunnyThumb();
function busy(doc, on, text) {
  let el = doc.getElementById('psd-busy');
  if (!el && on) {
    el = doc.createElement('div');
    el.id = 'psd-busy';
    doc.body.appendChild(el);
  }
  if (!el) return;
  el.textContent = text || 'Leyendo PSD…';
  el.hidden = !on;
}
function hasStore(data) {
  return Boolean(data && ((data.order && data.order.length) || Object.keys(data.parts || {}).length));
}
export function createCharPanel(doc, hooks) {
  const toast = (message) => hooks.toast?.(message);
  const root = doc.createElement('div');
  root.id = 'char-panel';
  root.hidden = true;
  root.innerHTML = `
    <div class="char-card" role="dialog" aria-modal="true" aria-labelledby="char-title">
      <div class="panel-head">
        <h2 id="char-title">Personajes</h2>
        <button type="button" id="char-close">Cerrar</button>
      </div>
      <div id="char-list" class="char-list"></div>
      <div id="char-drop" class="char-drop">
        <p>Suelta un .psd aquí, o sobre el escenario</p>
        <button type="button" id="char-load" class="primary">Cargar personaje (PSD)</button>
        <input id="char-file" type="file" accept=".psd,image/vnd.adobe.photoshop" />
      </div>
    </div>`;
  doc.body.appendChild(root);
  const listEl = root.querySelector('#char-list');
  const fileInput = root.querySelector('#char-file');
  let pending = null;
  let timer = 0;
  onRigSave((flat, id) => {
    if (!id || id === BUNNY_ID) return;
    pending = { flat, id };
    clearTimeout(timer);
    timer = setTimeout(() => { void flushRig(); }, 280);
  });
  async function flushRig() {
    const job = pending;
    pending = null;
    if (!job) return;
    try {
      const rec = await getCharacter(job.id);
      if (!rec) return;
      rec.rigOverrides = job.flat;
      await putCharacter(rec);
    } catch { /* localStorage sigue siendo la copia de trabajo */ }
  }
  function open() {
    root.hidden = false;
    doc.getElementById('btn-chars')?.setAttribute('aria-expanded', 'true');
    void render();
  }
  function close() {
    root.hidden = true;
    doc.getElementById('btn-chars')?.setAttribute('aria-expanded', 'false');
  }
  async function render() {
    listEl.replaceChildren();
    listEl.appendChild(row({ id: BUNNY_ID, name: BUNNY_NAME, thumbnail: BUNNY_THUMB }, true));
    try {
      for (const item of await listCharacters()) listEl.appendChild(row(item, false));
    } catch (err) {
      toast(err.message || 'No pude leer la biblioteca');
    }
  }
  function row(item, builtin) {
    const card = doc.createElement('article');
    card.className = 'char-row';
    card.dataset.id = item.id;
    if (item.id === currentRigCharacter()) card.classList.add('is-on');
    const img = doc.createElement('img');
    img.alt = '';
    img.src = item.thumbnail || BUNNY_THUMB;
    const name = doc.createElement('strong');
    name.textContent = item.name;
    const actions = doc.createElement('div');
    actions.append(
      btn('Usar', () => { void (builtin ? useBunny() : useSaved(item.id)); }),
      btn('Renombrar', () => rename(item, name, builtin)),
    );
    if (!builtin) actions.append(btn('Borrar', (event) => { void remove(item, event.currentTarget); }));
    card.append(img, name, actions);
    return card;
  }
  function btn(label, onClick) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
  async function useBunny() {
    setRigCharacter(BUNNY_ID);
    try {
      await hooks.useBunny();
      rememberCharacter(BUNNY_ID);
      hooks.onUsed?.();
      toast(BUNNY_NAME);
      if (!root.hidden) await render();
    } catch (err) {
      toast(err.message || 'No pude volver a la conejita');
    }
  }
  async function useSaved(id, quiet) {
    const rec = await getCharacter(id);
    if (!rec) {
      if (quiet) rememberCharacter(BUNNY_ID);
      else toast('No encontré ese personaje');
      return;
    }
    setRigCharacter(id);
    const mapping = await mappingFromRecord(rec);
    const manifest = composeManifest(mapping);
    const local = loadOverrides(id);
    const overrides = hasStore(local) ? local : (rec.rigOverrides || { order: [] });
    if (!hasStore(local) && rec.rigOverrides) saveOverrides(rec.rigOverrides, id);
    await hooks.useManifest(manifest, overrides);
    rememberCharacter(id);
    hooks.onUsed?.();
    if (!quiet) toast(rec.name);
    if (!root.hidden) await render();
  }
  async function arm(mapping) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`;
    busy(doc, true, 'Guardando personaje…');
    try {
      setRigCharacter(id);
      const manifest = composeManifest(mapping);
      const overrides = { order: [] };
      await hooks.useManifest(manifest, overrides);
      saveOverrides(overrides, id);
      const record = await recordFromMapping(mapping, {
        id,
        name: mapping.name || 'Personaje',
        createdAt: Date.now(),
        thumbnail: manifestThumb(manifest),
        rigOverrides: overrides,
      });
      await putCharacter(record);
      rememberCharacter(id);
      hooks.onUsed?.();
      toast(`${record.name} listo`);
    } finally {
      busy(doc, false);
    }
  }
  async function ingest(file) {
    if (!file) return;
    close();
    try {
      const mapping = await importPsd(await file.arrayBuffer(), file.name);
      const chosen = await openMapper(doc, mapping);
      if (!chosen) return;
      await arm(chosen);
    } catch (err) {
      console.warn(err);
      toast(err?.message || 'No se pudo leer el PSD');
    }
  }
  function rename(item, nameEl, builtin) {
    if (builtin) { toast('La conejita oficial no se renombra'); return; }
    const input = doc.createElement('input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = item.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const rec = await getCharacter(item.id);
      if (rec) {
        rec.name = input.value.trim() || rec.name;
        await putCharacter(rec);
      }
      await render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void commit(); }
      if (event.key === 'Escape') { event.stopPropagation(); done = true; void render(); }
    });
    input.addEventListener('blur', () => { void commit(); });
  }
  async function remove(item, button) {
    if (button.dataset.arm !== '1') {
      button.dataset.arm = '1';
      button.textContent = '¿Borrar?';
      return;
    }
    await deleteCharacter(item.id);
    if (currentRigCharacter() === item.id || lastCharacterId() === item.id) await useBunny();
    else toast('Personaje borrado');
    await render();
  }
  function takeFiles(list) {
    const file = [...(list || [])].find((item) => /\.psd$/i.test(item.name || ''));
    if (!file) { toast('Suelta un archivo .psd'); return; }
    void ingest(file);
  }
  function bindDrop(el) {
    if (!el) return;
    el.addEventListener('dragover', (event) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      el.classList.add('drop-hot');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hot'));
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('drop-hot');
      takeFiles(event.dataTransfer?.files);
    });
  }
  root.querySelector('#char-close').addEventListener('click', close);
  root.addEventListener('click', (event) => { if (event.target === root) close(); });
  root.querySelector('#char-load').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void ingest(file);
  });
  doc.getElementById('btn-chars')?.addEventListener('click', () => (root.hidden ? open() : close()));
  bindDrop(root.querySelector('#char-drop'));
  bindDrop(hooks.stage);
  async function boot() {
    const id = lastCharacterId();
    if (!id || id === BUNNY_ID) {
      setRigCharacter(BUNNY_ID);
      return;
    }
    try {
      await useSaved(id, true);
    } catch (err) {
      console.warn(err);
      rememberCharacter(BUNNY_ID);
      await useBunny();
    }
  }
  return { open, close, boot, ingest };
}
