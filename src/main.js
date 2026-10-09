import './style.css';
import { mount } from './ui.js';

const proto = typeof CanvasRenderingContext2D === 'undefined' ? null : CanvasRenderingContext2D.prototype;
if (proto && typeof proto.roundRect !== 'function') {
  proto.roundRect = function roundRect(x, y, w, h, r = 0) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
  };
}

mount(document);
