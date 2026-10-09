import { initializeCanvas, readPsd } from 'ag-psd';
import { flattenPsd } from './flatten.js';

initializeCanvas((w, h) => new OffscreenCanvas(w, h));

self.onmessage = (event) => {
  try {
    const psd = readPsd(event.data.buffer, {
      skipThumbnail: true,
      skipCompositeImageData: true,
      skipLinkedFilesData: true,
      useImageData: true,
    });
    const layers = flattenPsd(psd).map((layer) => ({
      name: layer.name,
      path: layer.path,
      norm: layer.norm,
      hidden: layer.hidden,
      cls: layer.cls,
      pose: layer.pose,
      style: layer.style,
      eyePart: layer.eyePart,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      cx: layer.cx,
      cy: layer.cy,
      index: layer.index,
      buffer: layer.pixels.buffer,
    }));
    self.postMessage({ width: psd.width, height: psd.height, layers }, layers.map((layer) => layer.buffer));
  } catch (err) {
    self.postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
