/** Modal "Asignar capas": rol por capa y vista previa en vivo. */

import { composeManifest } from './psdimport/build.js';
import { refreshPivots } from './psdimport/geom.js';
import { ROLE_OPTIONS, sideFromRole } from './psdimport/names.js';
import { thumbCanvas } from './psdimport/raster.js';
import { drawManifest } from './sheetpreview.js';

const KNOWN = new Set(ROLE_OPTIONS.map(([id]) => id));

function shownRole(layer) {
  return KNOWN.has(layer.role) ? layer.role : 'static';
}

function applyChoice(mapping, layer, value, prev) {
  layer.role = value;
  const side = sideFromRole(value);
  const keepBoth = layer.side === 'both' && prev.startsWith('sleeve_') && value.startsWith('sleeve_') && value === prev;
  if (side && !keepBoth) layer.side = side;
  refreshPivots(mapping.layers, mapping.meta);
}

export function openMapper(doc, mapping) {
  doc.getElementById('map-modal')?.remove();
  for (const layer of mapping.layers || []) {
    if (layer.role !== 'ignore' && !KNOWN.has(layer.role)) layer.role = 'static';
  }
  const root = doc.createElement('div');
  root.id = 'map-modal';
  root.innerHTML = `
    <div class="map-card" role="dialog" aria-modal="true" aria-labelledby="map-title">
      <h2 id="map-title">Asignar capas</h2>
      <label class="map-name">Nombre <input id="map-name" type="text" maxlength="60" /></label>
      <div class="map-grid">
        <div class="map-scroll"><table><tbody id="map-rows"></tbody></table></div>
        <canvas id="map-preview" width="280" height="380" aria-label="Vista previa"></canvas>
      </div>
      <div class="map-actions">
        <button type="button" id="map-cancel">Cancelar</button>
        <button type="button" id="map-build" class="primary">Armar</button>
      </div>
    </div>`;
  doc.body.appendChild(root);
  const input = root.querySelector('#map-name');
  input.value = mapping.name || 'Personaje';
  const body = root.querySelector('#map-rows');
  const canvas = root.querySelector('#map-preview');
  let frame = 0;

  const paint = () => {
    try {
      drawManifest(canvas, composeManifest(mapping));
    } catch (err) {
      console.warn(err);
    }
  };
  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  };

  for (const layer of mapping.layers || []) {
    const tr = doc.createElement('tr');
    const thumbCell = doc.createElement('td');
    const thumb = layer.thumb || thumbCanvas(layer.canvas);
    thumb.className = 'map-thumb';
    thumbCell.appendChild(thumb);
    const nameCell = doc.createElement('td');
    const title = doc.createElement('strong');
    title.textContent = layer.name || 'Capa';
    nameCell.appendChild(title);
    if (layer.hidden) {
      const tag = doc.createElement('em');
      tag.textContent = ' oculta';
      nameCell.appendChild(tag);
    }
    if (layer.path) {
      const path = doc.createElement('small');
      path.textContent = layer.path;
      nameCell.appendChild(path);
    }
    const roleCell = doc.createElement('td');
    const select = doc.createElement('select');
    for (const [id, label] of ROLE_OPTIONS) {
      const option = doc.createElement('option');
      option.value = id;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = shownRole(layer);
    select.addEventListener('change', () => {
      const prev = layer.role;
      applyChoice(mapping, layer, select.value, prev);
      schedule();
    });
    roleCell.appendChild(select);
    tr.append(thumbCell, nameCell, roleCell);
    body.appendChild(tr);
  }

  return new Promise((resolve) => {
    const finish = (value) => {
      doc.removeEventListener('keydown', onKey, true);
      if (frame) cancelAnimationFrame(frame);
      root.remove();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    root.querySelector('#map-cancel').addEventListener('click', () => finish(null));
    root.querySelector('#map-build').addEventListener('click', () => {
      mapping.name = input.value.trim() || 'Personaje';
      finish(mapping);
    });
    root.addEventListener('click', (event) => {
      if (event.target === root) finish(null);
    });
    doc.addEventListener('keydown', onKey, true);
    schedule();
  });
}
