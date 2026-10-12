/**
 * Ventana de cámara para OBS: muestra SOLO la imagen real de la webcam, a pantalla completa,
 * con la misma rotación / volteo / espejo que la vista previa. Sin interfaz ni cursor.
 * Fuente de vídeo: el <video id="webcam"> de la ventana principal (window.opener, mismo origen),
 * así la cámara se abre una sola vez. Si no hay ventana principal con cámara activa, pide la
 * cámara aquí (mismo deviceId guardado) con getUserMedia.
 */
import { loadSettings } from './settings.js';

const DEVICE_KEY = 'bunny-vtuber-cam-device';

export function rememberCameraDevice(stream) {
  try {
    const id = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
    if (id) localStorage.setItem(DEVICE_KEY, id);
  } catch { /* sin almacenamiento */ }
}

function openerVideo() {
  try {
    const v = window.opener && !window.opener.closed
      ? window.opener.document.getElementById('webcam') : null;
    return v && v.srcObject && v.readyState >= 2 && v.videoWidth ? v : null;
  } catch { return null; }
}

export function mountCameraWindow(doc) {
  doc.title = 'Bunny VTuber · Cámara';
  doc.body.innerHTML = '';
  const st = doc.createElement('style');
  st.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}'
    + 'canvas{display:block;width:100vw;height:100vh}'
    + '#msg{position:fixed;inset:auto 0 16px;text-align:center;font:14px system-ui;color:#9cc;opacity:.8}';
  doc.head.appendChild(st);
  const canvas = doc.createElement('canvas');
  const msg = doc.createElement('div'); msg.id = 'msg';
  doc.body.append(canvas, msg);
  const ctx = canvas.getContext('2d');

  let settings = loadSettings();
  window.addEventListener('storage', () => { settings = loadSettings(); });
  let ownVideo = null; let ownStarting = false; let source = 'none';

  async function startOwnCamera() {
    if (ownStarting || ownVideo) return;
    ownStarting = true;
    msg.textContent = 'Abriendo cámara…';
    try {
      const id = localStorage.getItem(DEVICE_KEY);
      const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
      if (id) video.deviceId = { ideal: id };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const v = doc.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      ownVideo = v; msg.textContent = '';
    } catch (err) {
      msg.textContent = 'No se pudo abrir la cámara: ' + (err?.message || err);
    }
    ownStarting = false;
  }
  function stopOwnCamera() {
    if (!ownVideo) return;
    ownVideo.srcObject?.getTracks().forEach((t) => t.stop());
    ownVideo = null;
  }

  let noOpenerSince = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(innerWidth * dpr); const H = Math.round(innerHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    let v = openerVideo();
    if (v) { noOpenerSince = performance.now(); if (ownVideo) stopOwnCamera(); source = 'opener'; msg.textContent = ''; }
    else {
      if (performance.now() - noOpenerSince > 800) void startOwnCamera();
      v = ownVideo && ownVideo.videoWidth ? ownVideo : null;
      source = v ? 'own' : 'none';
      if (!v && !ownStarting && !msg.textContent) msg.textContent = 'Esperando la cámara…';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!v) return;
    const rot = [0, 90, 180, 270].includes(Number(settings.camRotate)) ? Number(settings.camRotate) : 0;
    const sw = v.videoWidth; const sh = v.videoHeight;
    const ow = rot % 180 ? sh : sw; const oh = rot % 180 ? sw : sh; // tamaño orientado
    const k = Math.min(W / ow, H / oh);
    ctx.translate(W / 2, H / 2);
    if (settings.mirror !== false) ctx.scale(-1, 1); // igual que la vista previa
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(settings.camFlipH ? -1 : 1, settings.camFlipV ? -1 : 1);
    ctx.drawImage(v, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
  }
  requestAnimationFrame(frame);
  window.__bunnyCam = { source: () => source, settings: () => settings };
}
