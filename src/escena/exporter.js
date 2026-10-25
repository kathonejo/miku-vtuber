/* Exporta el loop cuadro por cuadro (no en tiempo real): H.264 en MP4 con WebCodecs; si no hay, WebM. */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { renderFrame } from './render.js';

const CODECS = ['avc1.640034', 'avc1.640033', 'avc1.4D0034', 'avc1.640028', 'avc1.42003E', 'avc1.42001F'];

export async function pickCodec(w, h, bitrate, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of CODECS) {
    try {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return r.config || cfg;
    } catch { /* siguiente */ }
  }
  return null;
}

export async function exportVideo({ scene, settings, baked, w, h, mbps, onProgress, isCancelled }) {
  const fps = settings.fps || 30;
  const D = settings.duration;
  const frames = Math.round(D * fps);
  const bitrate = Math.round(mbps * 1e6);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  const config = await pickCodec(w, h, bitrate, fps);
  if (!config) return exportWebm({ canvas, ctx, scene, settings, baked, w, h, bitrate, fps, frames, onProgress, isCancelled });

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  const usec = 1e6 / fps;
  for (let i = 0; i < frames; i += 1) {
    if (failure) throw failure;
    if (isCancelled?.()) { encoder.close(); throw new Error('cancelado'); }
    renderFrame(ctx, scene, settings, baked, i / fps, w, h);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * usec), duration: Math.round(usec) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 3 === 0) { onProgress?.((i + 1) / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4', codec: config.codec };
}

async function exportWebm({ canvas, ctx, scene, settings, baked, w, h, bitrate, fps, frames, onProgress, isCancelled }) {
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || 'video/webm';
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < frames; i += 1) {
    if (isCancelled?.()) break;
    renderFrame(ctx, scene, settings, baked, i / fps, w, h);
    track.requestFrame?.();
    onProgress?.((i + 1) / frames);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await done;
  const mp4 = type.startsWith('video/mp4');
  return { blob: new Blob(chunks, { type: mp4 ? 'video/mp4' : 'video/webm' }), ext: mp4 ? 'mp4' : 'webm', codec: type };
}
