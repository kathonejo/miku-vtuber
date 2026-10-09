/** "Sigue a" y la sección Cuello del panel de rigging. */

import { wouldCycle } from './rigchain.js';
import { emptyRig, partTitle } from './rigparams.js';

export function attachRigLinks(opts) {
  const { doc, body, puppet, say, getSelected, commit, store, isOpen } = opts;
  let drag = false;

  function mount() {
    if (body.querySelector('#rig-parent')) return;
    const follow = doc.createElement('label');
    follow.className = 'slider-row';
    follow.innerHTML = 'Sigue a<select id="rig-parent"></select>';
    const partLabel = body.querySelector('#rig-part')?.parentElement;
    if (partLabel) partLabel.after(follow);
    else body.prepend(follow);
    const section = doc.createElement('section');
    section.id = 'rig-neck';
    section.innerHTML = `
      <h3>Cuello</h3>
      <label class="color-row">Tiene cuello<input id="neck-on" type="checkbox" /></label>
      <label class="slider-row">Largo del cuello <b id="neck-length-val">0</b>
        <input id="neck-length" type="range" min="0" max="30" step="1" value="0" />
      </label>
      <label class="slider-row">Estirar al moverse <b id="neck-stretch-val">0.00</b>
        <input id="neck-stretch" type="range" min="0" max="1" step="0.01" value="0" />
      </label>
      <p class="fine">Punto del cuello: arrastra el asa naranja.</p>`;
    body.appendChild(section);
    follow.querySelector('#rig-parent').addEventListener('change', onParent);
    section.querySelector('#neck-on').addEventListener('change', onNeckInput);
    section.querySelector('#neck-length').addEventListener('input', onNeckInput);
    section.querySelector('#neck-stretch').addEventListener('input', onNeckInput);
  }

  function readNeck() {
    const manifest = puppet.getManifest();
    const neck = manifest?.neck || {};
    const pivot = manifest?.pivots?.neck;
    return {
      enabled: Boolean(neck.enabled),
      length: Number(neck.length) || 0,
      stretch: Number(neck.stretch) || 0,
      pivot: pivot ? [pivot.x, pivot.y] : [294, 354],
    };
  }

  function writeNeck(partial) {
    const next = store();
    next.neck = { ...readNeck(), ...partial };
    commit(next);
  }

  function onNeckInput() {
    writeNeck({
      enabled: body.querySelector('#neck-on').checked,
      length: Number(body.querySelector('#neck-length').value),
      stretch: Number(body.querySelector('#neck-stretch').value),
    });
    sync();
  }

  function onParent(event) {
    const id = getSelected();
    const manifest = puppet.getManifest();
    const part = manifest?.byId?.[id];
    const value = event.target.value;
    if (!part) return;
    if (wouldCycle(id, value, manifest.byId)) {
      say('Esa pieza ya depende de esta');
      sync();
      return;
    }
    const next = store();
    const prev = next.parts[id] || { ...(part.rig || emptyRig(part)) };
    if (Array.isArray(part.pivot)) prev.pivot = [+part.pivot[0], +part.pivot[1]];
    prev.parent = value;
    next.parts[id] = prev;
    commit(next);
  }

  function fillParent() {
    const select = body.querySelector('#rig-parent');
    const manifest = puppet.getManifest();
    const id = getSelected();
    if (!select || !manifest) return;
    const part = manifest.byId?.[id];
    select.replaceChildren();
    const add = (value, label) => {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    };
    add('body', 'Cuerpo');
    add('head', 'Cabeza');
    for (const item of manifest.parts || []) {
      if (!item?.id || item.id === id || item.id === 'body' || item.role === 'mouth' || item.id === 'mouth') continue;
      if (wouldCycle(id, item.id, manifest.byId)) continue;
      add(item.id, partTitle(item));
    }
    let current = part?.parent;
    if (current !== 'head' && current !== 'body' && !manifest.byId?.[current]) {
      current = part?.role === 'eye' || part?.role === 'mouth' ? 'head' : 'body';
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function sync() {
    if (!body.querySelector('#rig-parent')) return;
    fillParent();
    const neck = readNeck();
    const on = body.querySelector('#neck-on');
    const length = body.querySelector('#neck-length');
    const stretch = body.querySelector('#neck-stretch');
    if (doc.activeElement !== on) on.checked = neck.enabled;
    if (doc.activeElement !== length) length.value = String(Math.round(neck.length));
    if (doc.activeElement !== stretch) stretch.value = String(neck.stretch);
    body.querySelector('#neck-length-val').textContent = String(Math.round(neck.length));
    body.querySelector('#neck-stretch-val').textContent = neck.stretch.toFixed(2);
    puppet.setNeckHandle?.(Boolean(isOpen() && neck.enabled));
  }

  function point(event) {
    const rect = doc.getElementById('avatar').getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  return {
    mount,
    sync,
    dragging: () => drag,
    wants(event) {
      if (!isOpen() || !readNeck().enabled) return false;
      const at = point(event);
      return Boolean(puppet.nearNeckHandle?.(at.x, at.y));
    },
    begin() { drag = true; },
    move(event) {
      if (!drag) return;
      const at = point(event);
      const pos = puppet.neckFromCss?.(at.x, at.y);
      if (!pos) return;
      writeNeck({ pivot: [pos.x, pos.y] });
    },
    end() { drag = false; },
  };
}
