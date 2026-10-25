/**
 * Botonera del modo stream / showcase: botones de ojos A/B, accesorios, estilos y gestos
 * del personaje actual. Se puede elegir qué botones se ven, ordenarlos arrastrando, mover el
 * panel, plegarlo u ocultarlo (tecla B). El diseño se guarda por personaje en localStorage.
 */
import { ACTIONS } from './actions.js';
import { ACCESSORY_DEFS, STYLES } from './settings.js';

export const BOTONERA_KEY = 'bunny-vtuber-botonera-v1';
const ACC_ICON = { bow: '🎀', glasses: '👓', flowerCrown: '🌸', star: '⭐', headphones: '🎧', blush: '😊', sparkles: '✨' };
const ACC_SHORT = { bow: 'Moño', glasses: 'Gafas', flowerCrown: 'Corona', star: 'Estrella', headphones: 'Auriculares', blush: 'Rubor', sparkles: 'Pecas' };
const STYLE_DOT = { original: '#f4f1ea', menta: '#7fe0b8', atardecer: '#f2a65a', lavanda: '#b9a2f0', algodon: '#f6c9d8', papel: '#c9b9a0', neon: '#ff4fd8' };

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Qué ofrece de verdad el personaje cargado. */
export function capabilities(manifest, charId) {
  const m = manifest || {};
  const byId = m.byId || {};
  const file = (side, st) => m.eyes?.[side]?.styles?.[st]?.full?.file || m.eyes?.[side]?.styles?.[st]?.white?.file || null;
  const eyesAB = ['l', 'r'].some((s) => file(s, 'A') && file(s, 'B') && file(s, 'A') !== file(s, 'B'));
  const acc = {};
  for (const def of ACCESSORY_DEFS) acc[def.id] = true;
  acc.bow = Boolean(byId.ear_r);
  acc.headphones = Boolean(byId.human_ears);
  // los gestos dibujan las mangas de la conejita oficial: solo para ella
  const gestures = charId === 'bunny';
  return { eyesAB, acc, gestures };
}

/** Catálogo de botones posibles para el personaje. */
export function catalog(caps) {
  const items = [];
  if (caps.eyesAB) {
    items.push({ id: 'eye:A', kind: 'eye', value: 'A', label: 'Ojos A', icon: '👁', group: 'Ojos' });
    items.push({ id: 'eye:B', kind: 'eye', value: 'B', label: 'Ojos B', icon: '👀', group: 'Ojos' });
  }
  for (const def of ACCESSORY_DEFS) {
    if (!caps.acc[def.id]) continue;
    items.push({ id: `acc:${def.id}`, kind: 'acc', value: def.id, label: ACC_SHORT[def.id] || def.name, title: def.name, icon: ACC_ICON[def.id] || '•', group: 'Accesorios' });
  }
  for (const st of STYLES) {
    items.push({ id: `style:${st.id}`, kind: 'style', value: st.id, label: st.name, dot: STYLE_DOT[st.id] || '#ccc', group: 'Estilos' });
  }
  items.push({ id: 'do:jump', kind: 'jump', label: 'Saltar', icon: '⤴', group: 'Gestos' });
  if (caps.gestures) {
    for (const a of ACTIONS) items.push({ id: `act:${a.id}`, kind: 'act', value: a.id, label: a.name, icon: a.emoji, group: 'Gestos' });
  }
  return items;
}

function defaultLayout(items) {
  const show = items.filter((it) => it.kind !== 'style' || ['style:original', 'style:menta', 'style:neon'].includes(it.id));
  return { order: items.map((it) => it.id), shown: show.map((it) => it.id), x: 0.02, y: 0.12, collapsed: false, hidden: false };
}

export function loadLayout(charId, items) {
  const base = defaultLayout(items);
  const ids = new Set(items.map((it) => it.id));
  let saved = null;
  try {
    saved = JSON.parse(storage()?.getItem(`${BOTONERA_KEY}:${charId}`) || 'null');
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== 'object') return base;
  const order = Array.isArray(saved.order) ? saved.order.filter((id) => ids.has(id)) : [];
  for (const id of base.order) if (!order.includes(id)) order.push(id);
  const shown = Array.isArray(saved.shown) ? saved.shown.filter((id) => ids.has(id)) : base.shown;
  const num = (v, d) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : d);
  return { order, shown, x: num(saved.x, base.x), y: num(saved.y, base.y), collapsed: saved.collapsed === true, hidden: saved.hidden === true };
}

export function saveLayout(charId, layout) {
  try {
    storage()?.setItem(`${BOTONERA_KEY}:${charId}`, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

/**
 * host: { stage, settings, persist(), onChange(), getManifest(), getCharId(), jump(), action(id), toast(msg) }
 */
export function createBotonera(doc, host) {
  const el = doc.createElement('div');
  el.id = 'botonera';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Botonera');
  el.hidden = true;
  el.innerHTML = `
    <div class="bt-head">
      <span class="bt-grip" title="Arrastra para mover la botonera" aria-hidden="true">⠿</span>
      <span class="bt-title">Botonera</span>
      <button type="button" class="bt-ico bt-edit" title="Elegir y ordenar botones" aria-pressed="false">✎</button>
      <button type="button" class="bt-ico bt-fold" title="Plegar" aria-expanded="true">▾</button>
      <button type="button" class="bt-ico bt-hide" title="Ocultar botonera (B)">✕</button>
    </div>
    <div class="bt-body"></div>
    <div class="bt-hint">Arrastra para ordenar · marca los que quieres ver</div>`;
  host.stage.appendChild(el);
  const body = el.querySelector('.bt-body');
  const head = el.querySelector('.bt-head');
  let charId = null;
  let manifestRef = null;
  let items = [];
  let layout = null;
  let editing = false;
  let active = false;

  const byId = (id) => items.find((it) => it.id === id);
  const save = () => saveLayout(charId, layout);

  function isOn(it) {
    const s = host.settings;
    if (it.kind === 'eye') return (s.eyeStyle === 'B' ? 'B' : 'A') === it.value;
    if (it.kind === 'acc') return Boolean(s.accessories?.[it.value]);
    if (it.kind === 'style') return s.style === it.value;
    return false;
  }

  function press(it) {
    const s = host.settings;
    if (it.kind === 'eye') s.eyeStyle = it.value;
    else if (it.kind === 'acc') s.accessories[it.value] = !s.accessories[it.value];
    else if (it.kind === 'style') s.style = it.value;
    else if (it.kind === 'jump') host.jump();
    else if (it.kind === 'act') host.action(it.value);
    if (it.kind === 'eye' || it.kind === 'acc' || it.kind === 'style') {
      host.persist();
      host.onChange();
    }
    sync();
  }

  function visibleIds() {
    return layout.order.filter((id) => layout.shown.includes(id));
  }

  function render() {
    body.replaceChildren();
    const ids = editing ? layout.order : visibleIds();
    let n = 0;
    for (const id of ids) {
      const it = byId(id);
      if (!it) continue;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = `bt-btn bt-${it.kind}`;
      btn.dataset.id = id;
      btn.title = it.title || it.label;
      const shown = layout.shown.includes(id);
      if (!editing && n < 9) {
        n += 1;
        btn.dataset.key = String(n);
        btn.title += ` (tecla ${n})`;
      }
      if (editing) {
        btn.classList.add('bt-editing');
        btn.classList.toggle('bt-off', !shown);
      }
      const mark = editing ? `<span class="bt-check" aria-hidden="true">${shown ? '✓' : ''}</span>` : '';
      const icon = it.dot ? `<span class="bt-dot" style="background:${it.dot}"></span>` : `<span class="bt-icon">${it.icon || ''}</span>`;
      const key = btn.dataset.key ? `<kbd>${btn.dataset.key}</kbd>` : '';
      btn.innerHTML = `${mark}${icon}<span class="bt-label">${it.label}</span>${key}`;
      body.appendChild(btn);
    }
    if (!ids.length) {
      const empty = doc.createElement('p');
      empty.className = 'bt-empty';
      empty.textContent = 'Toca ✎ para elegir botones';
      body.appendChild(empty);
    }
    el.classList.toggle('editing', editing);
    el.querySelector('.bt-edit').setAttribute('aria-pressed', String(editing));
    sync();
  }

  function sync() {
    if (!layout) return;
    for (const btn of body.querySelectorAll('.bt-btn')) {
      const it = byId(btn.dataset.id);
      if (it && !editing) btn.setAttribute('aria-pressed', String(isOn(it)));
      else btn.removeAttribute('aria-pressed');
    }
    el.classList.toggle('collapsed', layout.collapsed);
    const fold = el.querySelector('.bt-fold');
    fold.textContent = layout.collapsed ? '▸' : '▾';
    fold.title = layout.collapsed ? 'Desplegar' : 'Plegar';
    fold.setAttribute('aria-expanded', String(!layout.collapsed));
    el.hidden = !active || layout.hidden;
    place();
  }

  function place() {
    if (el.hidden) return;
    const sw = host.stage.clientWidth;
    const sh = host.stage.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.round(Math.min(Math.max(0, layout.x * sw), Math.max(0, sw - w)));
    const y = Math.round(Math.min(Math.max(0, layout.y * sh), Math.max(0, sh - h)));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  /** Recarga si cambió el personaje (o se reconstruyó su rig). */
  function refresh() {
    const id = host.getCharId() || 'bunny';
    const man = host.getManifest();
    if (id === charId && man === manifestRef && layout) return;
    charId = id;
    manifestRef = man;
    items = catalog(capabilities(man, id));
    layout = loadLayout(id, items);
    editing = false;
    render();
  }

  function setActive(on) {
    active = Boolean(on);
    refresh();
    sync();
  }

  function toggleHidden(force) {
    if (!layout) refresh();
    layout.hidden = force == null ? !layout.hidden : Boolean(force);
    save();
    sync();
    if (active) host.toast(layout.hidden ? 'Botonera oculta (B para mostrarla)' : 'Botonera visible');
  }

  // --- mover el panel arrastrando la cabecera
  let move = null;
  head.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    move = { id: event.pointerId, dx: event.clientX - r.left, dy: event.clientY - r.top };
    head.setPointerCapture?.(event.pointerId);
    el.classList.add('moving');
    event.preventDefault();
  });
  head.addEventListener('pointermove', (event) => {
    if (!move || event.pointerId !== move.id) return;
    const s = host.stage.getBoundingClientRect();
    layout.x = Math.min(1, Math.max(0, (event.clientX - move.dx - s.left) / Math.max(1, s.width)));
    layout.y = Math.min(1, Math.max(0, (event.clientY - move.dy - s.top) / Math.max(1, s.height)));
    place();
  });
  const endMove = () => {
    if (!move) return;
    move = null;
    el.classList.remove('moving');
    // guarda la posición ya ajustada a los bordes
    const sw = Math.max(1, host.stage.clientWidth);
    const sh = Math.max(1, host.stage.clientHeight);
    layout.x = parseFloat(el.style.left) / sw;
    layout.y = parseFloat(el.style.top) / sh;
    save();
  };
  head.addEventListener('pointerup', endMove);
  head.addEventListener('pointercancel', endMove);

  // --- botones: clic = acción; en modo edición clic = mostrar/ocultar y arrastre = ordenar
  let drag = null;
  body.addEventListener('pointerdown', (event) => {
    const btn = event.target.closest('.bt-btn');
    if (!btn || event.button !== 0) return;
    drag = { id: btn.dataset.id, btn, x: event.clientX, y: event.clientY, moved: false, pid: event.pointerId };
    btn.setPointerCapture?.(event.pointerId);
  });
  body.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pid) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.btn.classList.add('bt-dragging');
      el.classList.add('sorting');
    }
    const over = doc.elementsFromPoint(event.clientX, event.clientY).find((n) => n.classList?.contains('bt-btn') && n !== drag.btn);
    if (!over) return;
    const r = over.getBoundingClientRect();
    const after = (r.width > r.height * 2.2 ? event.clientY > r.top + r.height / 2 : event.clientX > r.left + r.width / 2);
    body.insertBefore(drag.btn, after ? over.nextSibling : over);
  });
  const endDrag = (event, cancel) => {
    if (!drag || (event && event.pointerId !== drag.pid)) return;
    const d = drag;
    drag = null;
    d.btn.classList.remove('bt-dragging');
    el.classList.remove('sorting');
    if (d.moved && !cancel) {
      const domIds = [...body.querySelectorAll('.bt-btn')].map((b) => b.dataset.id);
      // en vista normal solo se ven los marcados: los ocultos conservan su sitio relativo
      const rest = layout.order.filter((id) => !domIds.includes(id));
      const next = [];
      let k = 0;
      for (const id of layout.order) next.push(domIds.includes(id) ? domIds[k++] : id);
      layout.order = editing ? domIds.concat(rest) : next;
      save();
      render();
      return;
    }
    if (cancel || d.moved) return;
    const it = byId(d.id);
    if (!it) return;
    if (editing) {
      layout.shown = layout.shown.includes(it.id) ? layout.shown.filter((x) => x !== it.id) : [...layout.shown, it.id];
      save();
      render();
    } else {
      press(it);
    }
  };
  body.addEventListener('pointerup', (event) => endDrag(event, false));
  body.addEventListener('pointercancel', (event) => endDrag(event, true));
  // el clic lo maneja pointerup (así arrastrar no dispara la acción); teclado: Enter/Espacio
  body.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    const btn = event.target.closest('.bt-btn');
    const it = btn && byId(btn.dataset.id);
    if (!it) return;
    if (editing) {
      layout.shown = layout.shown.includes(it.id) ? layout.shown.filter((x) => x !== it.id) : [...layout.shown, it.id];
      save();
      render();
    } else press(it);
  });

  el.querySelector('.bt-edit').addEventListener('click', () => {
    editing = !editing;
    if (editing) layout.collapsed = false;
    save();
    render();
  });
  el.querySelector('.bt-fold').addEventListener('click', () => {
    layout.collapsed = !layout.collapsed;
    if (layout.collapsed) editing = false;
    save();
    render();
  });
  el.querySelector('.bt-hide').addEventListener('click', () => toggleHidden(true));
  // que el escenario (modo demo, rigging, doble clic) no reciba los clics del panel
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick', 'click', 'wheel']) {
    el.addEventListener(type, (event) => event.stopPropagation());
  }

  /** Teclas 1–9: botones visibles en orden. Devuelve true si la usó. */
  function key(event) {
    if (!active || !layout || layout.hidden || layout.collapsed || editing) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const m = /^Digit([1-9])$/.exec(event.code || '') || /^([1-9])$/.exec(event.key || '');
    if (!m) return false;
    const btn = body.querySelector(`.bt-btn[data-key="${m[1]}"]`);
    const it = btn && byId(btn.dataset.id);
    if (!it) return false;
    if (!event.repeat) press(it);
    return true;
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  ro?.observe(host.stage);

  return {
    el,
    setActive,
    refresh,
    sync,
    key,
    toggleHidden,
    isActive: () => active,
    isHidden: () => Boolean(layout?.hidden),
    layout: () => layout && { ...layout },
  };
}
