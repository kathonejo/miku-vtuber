import { createActions } from './actions.js';
import { createCharPanel } from './charpanel.js';
import { finite } from './filters.js';
import { composeManifest, importPsd } from './psdimport/read.js';
import { createPuppet } from './puppet.js';
import { createRigEditor } from './rigeditor.js';
import { loadOverrides, shakeTargets } from './rigparams.js';
import {
  ACCESSORY_DEFS,
  BACKGROUNDS,
  STYLES,
  TOGGLE_DEFS,
  loadSettings,
  randomizeSettings,
  resetSettings,
  saveSettings,
} from './settings.js';
import { MSG, createTracker, decorativeTargets } from './tracking.js';

const SLIDERS = [
  ['sens-mouth', (s) => s.sensitivity.mouth, (s, v) => { s.sensitivity.mouth = v; }],
  ['sens-blink', (s) => s.sensitivity.blink, (s, v) => { s.sensitivity.blink = v; }],
  ['sens-head', (s) => s.sensitivity.head, (s, v) => { s.sensitivity.head = v; }],
  ['sens-bounce', (s) => s.sensitivity.bounce, (s, v) => { s.sensitivity.bounce = v; }],
  ['sens-smooth', (s) => s.smoothing, (s, v) => { s.smoothing = v; }],
];

function coerceDebug(obj) {
  const n = (key) => finite(obj?.[key], 0);
  return {
    mode: 'debug',
    face: true,
    pose: false,
    yaw: n('yaw'),
    pitch: n('pitch'),
    roll: n('roll'),
    blinkL: n('blinkL'),
    blinkR: n('blinkR'),
    gazeX: n('gazeX'),
    gazeY: n('gazeY'),
    jaw: n('jaw'),
    funnel: n('funnel'),
    pucker: n('pucker'),
    smile: n('smile'),
    wristUp: n('wristUp'),
    heartRot: 0,
    shoulderTilt: 0,
  };
}

export function mount(doc) {
  const settings = loadSettings();
  const canvas = doc.getElementById('avatar');
  const video = doc.getElementById('webcam');
  const overlay = doc.getElementById('landmarks');
  const statusEl = doc.getElementById('status');
  const startStatus = doc.getElementById('start-status');
  const startScreen = doc.getElementById('start-screen');
  const preview = doc.getElementById('preview');
  const layout = doc.getElementById('layout');
  const backdrop = doc.getElementById('backdrop');
  const toastEl = doc.getElementById('toast');
  const stage = doc.getElementById('stage');

  const puppet = createPuppet(canvas);
  const actions = createActions();
  const rig = createRigEditor(doc, puppet, (message) => toast(message));
  let debugTargets = null;
  let toastTimer = 0;
  let wasCalibrating = false;
  const demo = { active: false, x: 0.5, y: 0.42, down: false };
  let dragging = false;
  let last = performance.now();

  function setDebugTargets(obj) {
    debugTargets = obj && typeof obj === 'object' ? obj : null;
  }

  let psdMapping = null;
  const api = {
    setDebugTargets,
    ready: puppet.ready,
    async importPsd(arrayBuffer, filename) {
      psdMapping = await importPsd(arrayBuffer, filename);
      return psdMapping;
    },
    async buildFromMapping(next) {
      const mapping = next || psdMapping;
      if (!mapping) return null;
      psdMapping = mapping;
      await puppet.ready;
      return puppet.loadManifest(composeManifest(mapping));
    },
    getPsdMapping() {
      return psdMapping;
    },
    action(name) {
      return actions.trigger(name);
    },
    freezeAction(name, t) {
      actions.freeze(name, t);
    },
    rig: {
      open() { rig.open(); },
      select(id) { rig.open(); rig.select(id); },
      set(id, params) { rig.set(id, params); },
      preview(flag) { rig.preview(flag); },
    },
  };
  const root = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (root) root.__bunny = api;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function setStatus(message) {
    statusEl.textContent = message;
    if (!startScreen.hidden) startStatus.textContent = message;
  }

  const tracker = createTracker(video, setStatus);

  function persist() {
    return saveSettings(settings);
  }

  function syncPreview() {
    const show = settings.showPreview && tracker.isRunning();
    preview.hidden = !show;
    preview.classList.toggle('unmirrored', !settings.mirror);
    if (video.videoWidth) preview.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  }

  function syncCameraButtons() {
    const on = tracker.isRunning();
    doc.getElementById('btn-stop').hidden = !on;
    doc.getElementById('btn-start-top').hidden = on;
    syncPreview();
  }

  function fillChoices(container, items, current, onPick) {
    container.replaceChildren();
    for (const item of items) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.textContent = item.name;
      btn.setAttribute('aria-pressed', String(item.id === current));
      btn.addEventListener('click', () => onPick(item.id));
      container.appendChild(btn);
    }
  }

  function renderChoices() {
    fillChoices(doc.getElementById('style-list'), STYLES, settings.style, (id) => {
      settings.style = id;
      persist();
      renderChoices();
    });
    fillChoices(doc.getElementById('bg-list'), BACKGROUNDS, settings.background, (id) => {
      settings.background = id;
      persist();
      renderChoices();
      syncChrome();
    });
    fillChoices(doc.getElementById('accessory-list'), ACCESSORY_DEFS, null, (id) => {
      settings.accessories[id] = !settings.accessories[id];
      persist();
      renderChoices();
    });
    for (const btn of doc.querySelectorAll('#accessory-list button')) {
      const item = ACCESSORY_DEFS.find((entry) => entry.name === btn.textContent);
      if (item) btn.setAttribute('aria-pressed', String(Boolean(settings.accessories[item.id])));
    }
    fillChoices(doc.getElementById('toggle-list'), TOGGLE_DEFS, null, (id) => {
      settings[id] = !settings[id];
      persist();
      renderChoices();
      syncChrome();
    });
    for (const btn of doc.querySelectorAll('#toggle-list button')) {
      const item = TOGGLE_DEFS.find((entry) => entry.name === btn.textContent);
      if (item) btn.setAttribute('aria-pressed', String(Boolean(settings[item.id])));
    }
    for (const btn of doc.querySelectorAll('#eye-style-list button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.eye === (settings.eyeStyle === 'B' ? 'B' : 'A')));
    }
  }

  function syncSliderValues() {
    for (const [id, read] of SLIDERS) {
      const input = doc.getElementById(id);
      const label = doc.getElementById(`${id}-val`);
      if (!input || !label) continue;
      const value = read(settings);
      if (doc.activeElement !== input) input.value = String(value);
      label.textContent = Number(value).toFixed(2);
    }
  }

  function syncChrome() {
    const bgInput = doc.getElementById('color-bg');
    doc.getElementById('bg-color-wrap').hidden = settings.background !== 'custom';
    if (bgInput && doc.activeElement !== bgInput) bgInput.value = settings.bgColor;
    doc.getElementById('btn-preview').setAttribute('aria-pressed', String(settings.showPreview));
    doc.getElementById('btn-landmarks').setAttribute('aria-pressed', String(settings.showLandmarks));
    const winkBtn = doc.getElementById('btn-wink');
    if (winkBtn) winkBtn.setAttribute('aria-pressed', String(settings.independentWink === true));
    const bar = doc.getElementById('action-bar');
    if (bar) {
      bar.hidden = !startScreen.hidden;
      const active = actions.currentId();
      for (const btn of bar.querySelectorAll('button[data-action]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.action === active));
      }
    }
    const open = layout.classList.contains('panel-open');
    doc.getElementById('btn-panel').setAttribute('aria-expanded', String(open));
    syncPreview();
    syncSliderValues();
  }

  function syncControls() {
    renderChoices();
    syncChrome();
  }

  function bindSliders() {
    for (const [id, read, write] of SLIDERS) {
      const input = doc.getElementById(id);
      const label = doc.getElementById(`${id}-val`);
      input.value = String(read(settings));
      label.textContent = Number(read(settings)).toFixed(2);
      input.addEventListener('input', () => {
        write(settings, Number(input.value));
        label.textContent = Number(input.value).toFixed(2);
        persist();
      });
    }
    const bgInput = doc.getElementById('color-bg');
    bgInput.value = settings.bgColor;
    bgInput.addEventListener('input', () => {
      settings.bgColor = bgInput.value;
      settings.background = 'custom';
      persist();
      renderChoices();
      syncChrome();
    });
  }

  function setPanel(open) {
    if (open) rig.close();
    layout.classList.toggle('panel-open', open);
    const mobile = root?.matchMedia?.('(max-width: 900px)')?.matches ?? false;
    backdrop.hidden = !(open && mobile);
    doc.getElementById('btn-panel').setAttribute('aria-expanded', String(open));
  }

  function hideUi(hidden) {
    doc.body.classList.toggle('ui-hidden', hidden);
  }

  async function activateCamera() {
    const startBtn = doc.getElementById('btn-start');
    const topBtn = doc.getElementById('btn-start-top');
    startBtn.disabled = true;
    topBtn.disabled = true;
    const result = await tracker.start();
    startBtn.disabled = false;
    topBtn.disabled = false;
    if (result.ok) {
      startScreen.hidden = true;
      demo.active = false;
      demo.down = false;
    }
    syncCameraButtons();
    syncChrome();
  }

  function enterDemo() {
    startScreen.hidden = true;
    if (!tracker.isRunning()) setStatus(MSG.demo);
    syncChrome();
  }

  async function enterStream() {
    doc.body.classList.add('stream');
    hideUi(true);
    doc.getElementById('btn-exit-stream').hidden = false;
    const target = doc.getElementById('app');
    try {
      if (!doc.fullscreenElement && target.requestFullscreen) await target.requestFullscreen();
    } catch {
      /* el modo stream sigue activo aunque el navegador bloquee la pantalla completa */
    }
    puppet.resize();
  }

  async function exitStream() {
    doc.body.classList.remove('stream');
    hideUi(false);
    doc.getElementById('btn-exit-stream').hidden = true;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
    } catch {
      /* ignorar */
    }
    puppet.resize();
  }

  function placeDemo(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    demo.x = (event.clientX - rect.left) / rect.width;
    demo.y = (event.clientY - rect.top) / rect.height;
    demo.active = true;
  }

  function isControl(event) {
    const el = event.target;
    return Boolean(el?.closest?.('button, a, input, textarea, select, label'));
  }

  function currentTargets(now) {
    const sample = tracker.isRunning() ? tracker.consumeFrame(settings) : null;
    if (debugTargets) return coerceDebug(debugTargets);
    if (tracker.isRunning() && sample?.face) return sample;
    if (tracker.isRunning()) {
      const idle = decorativeTargets(now / 1000, null, settings);
      return {
        ...idle,
        wristUp: sample?.wristUp ?? idle.wristUp,
        heartRot: sample?.heartRot ?? idle.heartRot,
        shoulderTilt: sample?.shoulderTilt ?? idle.shoulderTilt,
      };
    }
    return decorativeTargets(now / 1000, demo.active ? demo : null, settings);
  }

  function syncActionPressed(id) {
    const bar = doc.getElementById('action-bar');
    if (!bar) return;
    for (const btn of bar.querySelectorAll('button[data-action]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.action === id));
    }
  }

  function watchCalibration() {
    const calibrating = tracker.isCalibrating();
    if (calibrating && !wasCalibrating) setStatus(MSG.calibrating);
    if (!calibrating && wasCalibrating && tracker.isRunning()) {
      setStatus(tracker.getDelegate() === 'CPU' ? MSG.cpu : MSG.camera);
      toast('Calibración lista');
    }
    wasCalibrating = calibrating;
  }

  function frame(now) {
    try {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      watchCalibration();
      const raw = currentTargets(now);
      const fx = actions.step(dt, raw);
      if (fx.jump) puppet.triggerJump();
      let targets = actions.merge(raw, fx);
      if (rig.previewing()) targets = shakeTargets(targets, now / 1000);
      syncActionPressed(fx.id);
      puppet.update(dt, targets, settings);
      puppet.draw(settings);
      tracker.drawDebug(overlay, settings.showLandmarks);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  }

  doc.getElementById('btn-start').addEventListener('click', () => { void activateCamera(); });
  doc.getElementById('btn-start-top').addEventListener('click', () => { void activateCamera(); });
  doc.getElementById('btn-demo').addEventListener('click', enterDemo);
  doc.getElementById('btn-stop').addEventListener('click', () => {
    tracker.stop();
    syncCameraButtons();
    setStatus(MSG.stopped);
  });
  doc.getElementById('btn-preview').addEventListener('click', () => {
    settings.showPreview = !settings.showPreview;
    persist();
    syncControls();
  });
  doc.getElementById('btn-landmarks').addEventListener('click', () => {
    settings.showLandmarks = !settings.showLandmarks;
    persist();
    syncControls();
  });
  doc.getElementById('btn-panel').addEventListener('click', () => {
    setPanel(!layout.classList.contains('panel-open'));
  });
  doc.getElementById('btn-rig').addEventListener('click', () => {
    if (rig.isOpen()) rig.close();
    else rig.open();
    doc.getElementById('btn-rig').setAttribute('aria-expanded', String(rig.isOpen()));
  });
  for (const btn of doc.querySelectorAll('#eye-style-list button')) {
    btn.addEventListener('click', () => {
      settings.eyeStyle = btn.dataset.eye === 'B' ? 'B' : 'A';
      persist();
      renderChoices();
    });
  }
  doc.getElementById('btn-close-panel').addEventListener('click', () => setPanel(false));
  doc.getElementById('btn-close-rig').addEventListener('click', () => rig.close());
  backdrop.addEventListener('click', () => {
    setPanel(false);
    if (rig.isOpen()) rig.close();
  });

  doc.getElementById('btn-save').addEventListener('click', () => {
    toast(persist() ? 'Guardado' : 'No se pudo guardar');
  });
  doc.getElementById('btn-reset').addEventListener('click', () => {
    resetSettings(settings);
    persist();
    syncControls();
    toast('Ajustes restablecidos');
  });
  doc.getElementById('btn-random').addEventListener('click', () => {
    randomizeSettings(settings);
    persist();
    syncControls();
    toast('¡Look aleatorio!');
  });
  doc.getElementById('btn-capture').addEventListener('click', () => {
    puppet.draw(settings);
    const url = canvas.toDataURL('image/png');
    const a = doc.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `bunny-vtuber-${stamp}.png`;
    a.click();
    toast('Captura descargada');
  });
  doc.getElementById('btn-calibrate').addEventListener('click', () => {
    if (!tracker.calibrate()) toast('Activa la cámara para calibrar');
  });
  doc.getElementById('btn-wink').addEventListener('click', () => {
    settings.independentWink = !settings.independentWink;
    persist();
    syncChrome();
  });
  doc.getElementById('action-bar').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    actions.trigger(btn.dataset.action);
  });
  doc.getElementById('btn-stream').addEventListener('click', () => { void enterStream(); });
  doc.getElementById('btn-exit-stream').addEventListener('click', () => { void exitStream(); });

  doc.addEventListener('fullscreenchange', () => {
    if (!doc.fullscreenElement && doc.body.classList.contains('stream')) {
      doc.body.classList.remove('stream');
      hideUi(false);
      doc.getElementById('btn-exit-stream').hidden = true;
    }
    puppet.resize();
  });

  doc.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (event.key === 'Escape' && doc.body.classList.contains('stream')) {
      void exitStream();
      return;
    }
    if (typing) return;
    if (event.key === 'h' || event.key === 'H') {
      if (event.repeat) return;
      hideUi(!doc.body.classList.contains('ui-hidden'));
    }
    if (event.code === 'Space' || event.key === ' ') {
      if (event.repeat) return;
      event.preventDefault();
      puppet.triggerJump();
      return;
    }
    const gesture = {
      1: 'wave',
      2: 'heart',
      3: 'peace',
      4: 'clap',
      5: 'point',
      6: 'up',
    }[event.key];
    if (gesture) {
      if (event.repeat) return;
      actions.trigger(gesture);
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (rig.isOpen()) {
      rig.onPointerMove(event);
      return;
    }
    if (tracker.isRunning()) return;
    placeDemo(event);
    if (!dragging) demo.down = event.buttons > 0;
  });
  stage.addEventListener('pointerdown', (event) => {
    if (rig.isOpen()) {
      if (event.button !== 0 || isControl(event)) return;
      if (rig.onPointerDown(event)) {
        dragging = true;
        try { stage.setPointerCapture(event.pointerId); } catch { /* sin captura */ }
      }
      return;
    }
    if (tracker.isRunning() || event.button !== 0 || isControl(event)) return;
    dragging = true;
    demo.down = true;
    placeDemo(event);
    try { stage.setPointerCapture(event.pointerId); } catch { /* el puntero puede no admitir captura */ }
  });
  stage.addEventListener('pointerup', (event) => {
    if (rig.isOpen()) {
      rig.onPointerUp();
      dragging = false;
      return;
    }
    dragging = false;
    demo.down = false;
    const rect = canvas.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) demo.active = false;
  });
  stage.addEventListener('pointercancel', () => {
    dragging = false;
    demo.down = false;
  });
  stage.addEventListener('pointerleave', () => {
    if (!dragging) demo.active = false;
  });
  stage.addEventListener('dblclick', () => {
    if (doc.body.classList.contains('ui-hidden')) hideUi(false);
  });

  const mobile = root?.matchMedia?.('(max-width: 900px)')?.matches ?? false;
  setPanel(!mobile);
  bindSliders();
  syncControls();
  syncCameraButtons();
  setStatus(MSG.loading);
  tracker.ensureModels()
    .then(() => {
      const current = statusEl.textContent;
      if (!tracker.isRunning() && (current === MSG.loading || current === 'Iniciando…')) {
        setStatus(MSG.ready);
      }
    })
    .catch(() => {
      if (!tracker.isRunning()) setStatus(MSG.modelsFail);
    });

  const chars = createCharPanel(doc, {
    toast,
    stage,
    async useManifest(manifest, overrides) {
      await puppet.ready;
      return puppet.loadManifest(manifest, { overrides });
    },
    async useBunny() {
      await puppet.ready;
      const base = import.meta.env?.BASE_URL || './';
      const res = await fetch(`${base}bunny/rig.json`);
      if (!res.ok) throw new Error('No pude cargar la conejita');
      return puppet.loadManifest(await res.json(), { overrides: loadOverrides('bunny') });
    },
    onUsed() {
      if (!rig.isOpen()) return;
      const first = puppet.getManifest()?.parts?.find((part) => part && part.role !== 'mouth' && part.id !== 'mouth');
      if (first) rig.select(first.id);
    },
  });
  puppet.ready.then(() => chars.boot()).catch((err) => console.warn(err));

  requestAnimationFrame(frame);
  return { settings, puppet, tracker };
}
