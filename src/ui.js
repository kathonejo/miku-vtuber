import { createAvatar } from './avatar.js';
import {
  ACCESSORY_DEFS,
  BACKGROUNDS,
  HAIRSTYLES,
  OUTFITS,
  PALETTES,
  SKIN_PRESETS,
  applyPalette,
  loadSettings,
  randomizeSettings,
  resetSettings,
  saveSettings,
} from './settings.js';
import { MSG, createTracker, decorativeTargets } from './tracking.js';

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
  const panel = doc.getElementById('panel');
  const backdrop = doc.getElementById('backdrop');
  const toastEl = doc.getElementById('toast');

  const avatar = createAvatar(canvas);
  let toastTimer = 0;
  const demo = { active: false, x: 0.5, y: 0.42 };
  let last = performance.now();

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
    saveSettings(settings);
  }

  function syncPreview() {
    const show = settings.showPreview && tracker.isRunning();
    preview.hidden = !show;
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

  function refreshPressed() {
    const mark = (container, current) => {
      for (const btn of doc.querySelectorAll(`#${container} button`)) {
        const label = btn.textContent;
        const list = {
          'outfit-list': OUTFITS,
          'palette-list': PALETTES,
          'hair-list': HAIRSTYLES,
          'bg-list': BACKGROUNDS,
        }[container];
        const item = list?.find((entry) => entry.name === label);
        if (item) btn.setAttribute('aria-pressed', String(item.id === current));
      }
    };
    mark('outfit-list', settings.outfit);
    mark('palette-list', settings.palette);
    mark('hair-list', settings.hairstyle);
    mark('bg-list', settings.background);
    for (const btn of doc.querySelectorAll('#skin-list button')) {
      const preset = SKIN_PRESETS.find((s) => s.name === btn.textContent);
      const on = Boolean(preset && preset.color.toLowerCase() === settings.skinColor.toLowerCase());
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  function syncControls() {
    fillChoices(doc.getElementById('outfit-list'), OUTFITS, settings.outfit, (id) => {
      settings.outfit = id;
      persist();
      syncControls();
    });
    fillChoices(doc.getElementById('palette-list'), PALETTES, settings.palette, (id) => {
      applyPalette(settings, id);
      persist();
      syncControls();
    });
    fillChoices(doc.getElementById('hair-list'), HAIRSTYLES, settings.hairstyle, (id) => {
      settings.hairstyle = id;
      persist();
      syncControls();
    });
    fillChoices(doc.getElementById('bg-list'), BACKGROUNDS, settings.background, (id) => {
      settings.background = id;
      persist();
      syncControls();
    });
    fillChoices(doc.getElementById('skin-list'), SKIN_PRESETS, null, (id) => {
      const found = SKIN_PRESETS.find((s) => s.id === id);
      if (!found) return;
      settings.skinColor = found.color;
      persist();
      syncControls();
    });
    for (const btn of doc.querySelectorAll('#skin-list button')) {
      const preset = SKIN_PRESETS.find((s) => s.name === btn.textContent);
      if (preset && preset.color.toLowerCase() === settings.skinColor.toLowerCase()) {
        btn.setAttribute('aria-pressed', 'true');
      }
    }

    const acc = doc.getElementById('accessory-list');
    acc.replaceChildren();
    for (const item of ACCESSORY_DEFS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.textContent = item.name;
      btn.setAttribute('aria-pressed', String(Boolean(settings.accessories[item.id])));
      btn.addEventListener('click', () => {
        settings.accessories[item.id] = !settings.accessories[item.id];
        persist();
        syncControls();
      });
      acc.appendChild(btn);
    }

    const bindColor = (id, key) => {
      const input = doc.getElementById(id);
      input.value = settings[key];
      input.oninput = () => {
        settings[key] = input.value;
        if (key !== 'bgColor') settings.palette = 'custom';
        if (key === 'bgColor') settings.background = 'custom';
        doc.getElementById('bg-color-wrap').hidden = settings.background !== 'custom';
        persist();
        refreshPressed();
      };
    };
    bindColor('color-hair', 'hairColor');
    bindColor('color-eye', 'eyeColor');
    bindColor('color-skin', 'skinColor');
    bindColor('color-accent', 'accentColor');
    bindColor('color-bg', 'bgColor');
    doc.getElementById('bg-color-wrap').hidden = settings.background !== 'custom';

    const bindRange = (id, read, write) => {
      const input = doc.getElementById(id);
      const label = doc.getElementById(`${id}-val`);
      input.value = String(read());
      label.textContent = Number(read()).toFixed(2);
      input.oninput = () => {
        write(Number(input.value));
        label.textContent = Number(input.value).toFixed(2);
        persist();
      };
    };
    bindRange('sens-mouth', () => settings.sensitivity.mouth, (v) => { settings.sensitivity.mouth = v; });
    bindRange('sens-blink', () => settings.sensitivity.blink, (v) => { settings.sensitivity.blink = v; });
    bindRange('sens-arms', () => settings.sensitivity.arms, (v) => { settings.sensitivity.arms = v; });
    bindRange('sens-smooth', () => settings.smoothing, (v) => { settings.smoothing = v; });

    doc.getElementById('btn-preview').setAttribute('aria-pressed', String(settings.showPreview));
    doc.getElementById('btn-landmarks').setAttribute('aria-pressed', String(settings.showLandmarks));
    const open = layout.classList.contains('panel-open');
    doc.getElementById('btn-panel').setAttribute('aria-expanded', String(open));
  }

  function setPanel(open) {
    layout.classList.toggle('panel-open', open);
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    backdrop.hidden = !(open && mobile);
    doc.getElementById('btn-panel').setAttribute('aria-expanded', String(open));
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
    }
    syncCameraButtons();
  }

  function enterDemo() {
    startScreen.hidden = true;
    setStatus(tracker.isRunning() ? statusEl.textContent : MSG.demo);
    if (!tracker.isRunning()) setStatus(MSG.demo);
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
    syncPreview();
  });
  doc.getElementById('btn-landmarks').addEventListener('click', () => {
    settings.showLandmarks = !settings.showLandmarks;
    persist();
    syncControls();
  });
  doc.getElementById('btn-panel').addEventListener('click', () => {
    setPanel(!layout.classList.contains('panel-open'));
  });
  doc.getElementById('btn-close-panel').addEventListener('click', () => setPanel(false));
  backdrop.addEventListener('click', () => setPanel(false));

  doc.getElementById('btn-save').addEventListener('click', () => {
    persist();
    toast('Guardado');
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
    const alpha = settings.background === 'transparent';
    avatar.draw({ settings, exportAlpha: alpha });
    const url = canvas.toDataURL('image/png');
    const a = doc.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `miku-vtuber-${stamp}.png`;
    a.click();
    if (alpha) avatar.draw({ settings });
    toast('Captura descargada');
  });

  async function enterStream() {
    doc.body.classList.add('stream');
    doc.getElementById('btn-exit-stream').hidden = false;
    const target = doc.getElementById('app');
    try {
      if (!doc.fullscreenElement && target.requestFullscreen) await target.requestFullscreen();
    } catch {
      /* el modo stream sigue activo aunque el navegador bloquee la pantalla completa */
    }
    avatar.resize();
  }

  async function exitStream() {
    doc.body.classList.remove('stream');
    doc.getElementById('btn-exit-stream').hidden = true;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
    } catch {
      /* ignorar */
    }
    avatar.resize();
  }

  doc.getElementById('btn-stream').addEventListener('click', () => { void enterStream(); });
  doc.getElementById('btn-exit-stream').addEventListener('click', () => { void exitStream(); });
  doc.addEventListener('fullscreenchange', () => {
    if (!doc.fullscreenElement && doc.body.classList.contains('stream')) {
      doc.body.classList.remove('stream');
      doc.getElementById('btn-exit-stream').hidden = true;
    }
    avatar.resize();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && doc.body.classList.contains('stream')) void exitStream();
  });

  const stage = doc.getElementById('stage');
  stage.addEventListener('pointermove', (event) => {
    if (tracker.isRunning()) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    demo.x = (event.clientX - rect.left) / rect.width;
    demo.y = (event.clientY - rect.top) / rect.height;
    demo.active = true;
  });
  stage.addEventListener('pointerleave', () => { demo.active = false; });
  stage.addEventListener('pointerdown', (event) => {
    if (tracker.isRunning()) return;
    const rect = canvas.getBoundingClientRect();
    demo.x = (event.clientX - rect.left) / rect.width;
    demo.y = (event.clientY - rect.top) / rect.height;
    demo.active = true;
  });

  function currentTargets(now) {
    const sample = tracker.consumeFrame();
    if (tracker.isRunning() && sample?.targets?.face) return sample.targets;
    if (!tracker.isRunning()) return decorativeTargets(now / 1000, demo.active ? demo : null);
    return decorativeTargets(now / 1000, null);
  }

  function frame(now) {
    try {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const targets = currentTargets(now);
      avatar.update(dt, targets, settings);
      avatar.draw({ settings });
      tracker.drawDebug(overlay, settings.showLandmarks);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  }

  const mobile = window.matchMedia('(max-width: 900px)').matches;
  setPanel(!mobile);
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

  requestAnimationFrame(frame);
  return { settings, avatar, tracker };
}
