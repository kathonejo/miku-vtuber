/*
 * Exporta el loop cuadro por cuadro (no en tiempo real): H.264 en MP4 con WebCodecs.
 * Si el navegador no puede (o el codificador falla), graba con MediaRecorder en el
 * formato que ese navegador soporte (MP4 en Safari, WebM en Firefox).
 */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { renderFrame } from './render.js';

const WEBM_CODECS = [['vp09.00.40.08', 'V_VP9'], ['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']];
const CODECS = ['avc1.640034', 'avc1.640033', 'avc1.4D0034', 'avc1.640028', 'avc1.42003E', 'avc1.42001F'];
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];

export class ExportCancelled extends Error {
  constructor() { super('cancelado'); this.name = 'ExportCancelled'; }
}

/* Cede el hilo sin depender de setTimeout (que el navegador frena si la pestaña queda atrás). */
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const waiting = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();
const tick = () => new Promise((r) => { if (channel) { waiting.push(r); channel.port2.postMessage(0); } else setTimeout(r, 0); });

export function hasWebCodecs() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Todas las configuraciones que el navegador dice soportar, en orden de preferencia:
 * H.264 (MP4) primero, con y sin aceleración por hardware; después VP9/VP8 (WebM).
 */
export async function pickCodecs(w, h, bitrate, fps) {
  if (!hasWebCodecs()) return [];
  const out = [];
  const tryOne = async (codec, extra) => {
    try {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, ...extra };
      const r = await VideoEncoder.isConfigSupported(cfg);
      return r.supported ? (r.config || cfg) : null;
    } catch { return null; }
  };
  for (const hw of ['no-preference', 'prefer-software']) {
    for (const codec of CODECS) {
      const cfg = await tryOne(codec, { avc: { format: 'avc' }, hardwareAcceleration: hw });
      if (cfg) { out.push({ config: cfg, container: 'mp4' }); break; }
    }
  }
  for (const [codec, webmId] of WEBM_CODECS) {
    const cfg = await tryOne(codec, {});
    if (cfg) { out.push({ config: cfg, container: 'webm', webmId }); break; }
  }
  return out;
}

export function recorderType() {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return RECORDER_TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || null;
}

export async function exportVideo({ scene, settings, baked, w, h, mbps, onProgress, onStage, isCancelled }) {
  const fps = settings.fps || 30;
  const frames = Math.round(settings.duration * fps);
  const bitrate = Math.round(mbps * 1e6);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error(`El navegador no pudo crear un lienzo de ${w}×${h}. Probá con un tamaño más chico.`);
  const job = { canvas, ctx, scene, settings, baked, w, h, bitrate, fps, frames, onProgress, isCancelled };

  const errors = [];
  for (const option of await pickCodecs(w, h, bitrate, fps)) {
    try {
      return await encodeFrames(job, option);
    } catch (err) {
      if (err instanceof ExportCancelled) throw err;
      console.warn('Falló el codificador', option.config.codec, option.config.hardwareAcceleration, err);
      errors.push(err);
      onStage?.('Probando otra forma de armar el video…');
    }
  }
  const type = recorderType();
  if (!type) {
    const why = errors.length ? ` (${errors[errors.length - 1].message || errors[errors.length - 1]})` : '';
    throw new Error(`Este navegador no puede armar videos${why}. Abrí la página en Chrome o Edge en una computadora.`);
  }
  onStage?.('Grabando en tiempo real (este navegador no arma MP4 cuadro por cuadro)…');
  return recordRealtime(job, type);
}

async function encodeFrames({ canvas, ctx, scene, settings, baked, w, h, fps, frames, onProgress, isCancelled }, { config, container, webmId }) {
  const mp4 = container === 'mp4';
  const target = mp4 ? new Mp4Target() : new WebmTarget();
  const muxer = mp4
    ? new Mp4Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' })
    : new WebmMuxer({ target, video: { codec: webmId, width: w, height: h, frameRate: fps } });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { failure = e; } },
    error: (e) => { failure = e; },
  });
  const close = () => { try { if (encoder.state !== 'closed') encoder.close(); } catch { /* ya cerrado */ } };
  try {
    encoder.configure(config);
    const usec = 1e6 / fps;
    for (let i = 0; i < frames; i += 1) {
      if (failure) throw failure;
      if (isCancelled?.()) throw new ExportCancelled();
      renderFrame(ctx, scene, settings, baked, i / fps, w, h);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * usec), duration: Math.round(usec) });
      try { encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 }); } finally { frame.close(); }
      while (encoder.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 4));
      onProgress?.((i + 1) / frames);
      await tick();
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    if (!target.buffer || target.buffer.byteLength < 1000) throw new Error('El video salió vacío.');
    onProgress?.(1);
    return { blob: new Blob([target.buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }), ext: mp4 ? 'mp4' : 'webm', codec: config.codec, realtime: false };
  } finally {
    close();
  }
}

/* Plan B: dibuja a la velocidad real del video y lo graba con MediaRecorder. */
async function recordRealtime({ canvas, ctx, scene, settings, baked, w, h, bitrate, fps, onProgress, isCancelled }, type) {
  renderFrame(ctx, scene, settings, baked, 0, w, h);
  // captureStream(fps): con (0)+requestFrame Firefox casi no guarda cuadros.
  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  let rec;
  try {
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
  } catch {
    rec = new MediaRecorder(stream);
  }
  const chunks = [];
  let recError = null;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onerror = (e) => { recError = e.error || new Error('Falló la grabación'); };
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(1000);
  // El reloj manda: si un cuadro tarda en dibujarse se saltea, pero el video dura lo justo.
  const D = settings.duration;
  const t0 = performance.now();
  let cancelled = false;
  for (;;) {
    const t = (performance.now() - t0) / 1000;
    if (t >= D) break;
    if (isCancelled?.()) { cancelled = true; break; }
    if (recError) break;
    renderFrame(ctx, scene, settings, baked, t, w, h);
    onProgress?.(t / D);
    const next = Math.floor(t * fps + 1) / fps;
    await new Promise((r) => setTimeout(r, Math.max(0, t0 + next * 1000 - performance.now())));
  }
  renderFrame(ctx, scene, settings, baked, D - 1e-3, w, h);
  await new Promise((r) => setTimeout(r, 1000 / fps));
  if (rec.state !== 'inactive') rec.stop();
  await done;
  track.stop();
  if (cancelled) throw new ExportCancelled();
  if (recError) throw recError;
  const real = (rec.mimeType || type).split(';')[0];
  const mp4 = real === 'video/mp4';
  const blob = new Blob(chunks, { type: mp4 ? 'video/mp4' : 'video/webm' });
  if (blob.size < 1000) throw new Error('La grabación salió vacía.');
  return { blob, ext: mp4 ? 'mp4' : 'webm', codec: rec.mimeType || type, realtime: true };
}
