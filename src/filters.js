/** Filtros de señal: One Euro (Casiez et al.), muelles, ataque/suelta y rechazo de saltos. */

export function clamp(v, a, b) {
  if (!Number.isFinite(v)) return (a + b) / 2;
  return Math.max(a, Math.min(b, v));
}

export function finite(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

export function smoothstep(edge0, edge1, x) {
  const span = edge1 - edge0;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-6) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

export function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function alphaFromCutoff(cutoff, dt) {
  const c = Math.max(1e-4, cutoff);
  const tau = 1 / (2 * Math.PI * c);
  return 1 / (1 + tau / Math.max(1e-4, dt));
}

class LowPass {
  constructor() {
    this.y = null;
  }

  reset() {
    this.y = null;
  }

  filter(x, a) {
    if (!Number.isFinite(x)) x = this.y ?? 0;
    if (this.y == null || !Number.isFinite(this.y)) this.y = x;
    else this.y = a * x + (1 - a) * this.y;
    return this.y;
  }
}

/**
 * Filtro One Euro (Casiez, Roussel, Vogel — CHI 2012).
 * minCutoff alto = menos suavizado en reposo. beta sube el corte cuando hay velocidad.
 */
export class OneEuroFilter {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.tPrev = null;
    this.xFilt = new LowPass();
    this.dxFilt = new LowPass();
  }

  reset() {
    this.xPrev = null;
    this.tPrev = null;
    this.xFilt.reset();
    this.dxFilt.reset();
  }

  filter(x, t) {
    if (!Number.isFinite(x)) x = this.xPrev ?? 0;
    if (!Number.isFinite(t)) t = this.tPrev ?? 0;
    if (this.tPrev == null || this.xPrev == null) {
      this.tPrev = t;
      this.xPrev = x;
      this.dxFilt.filter(0, 1);
      return this.xFilt.filter(x, 1);
    }
    let dt = t - this.tPrev;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25;
    const dx = (x - this.xPrev) / dt;
    const edx = this.dxFilt.filter(dx, alphaFromCutoff(this.dCutoff, dt));
    const cutoff = Math.max(1e-3, this.minCutoff + this.beta * Math.abs(edx));
    const out = this.xFilt.filter(x, alphaFromCutoff(cutoff, dt));
    this.xPrev = x;
    this.tPrev = t;
    return finite(out, x);
  }
}

/**
 * Rechaza hasta `maxReject` saltos seguidos mayores que `limit` (unidades normalizadas).
 * Al siguiente, acepta y marca reset para reiniciar el filtro.
 */
export class JumpRejector {
  constructor(limit = 0.25, maxReject = 3) {
    this.limit = limit;
    this.maxReject = maxReject;
    this.last = null;
    this.rejects = 0;
  }

  reset() {
    this.last = null;
    this.rejects = 0;
  }

  push(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (!this.last) return { x: 0, y: 0, accept: false, reset: false };
      return { x: this.last.x, y: this.last.y, accept: false, reset: false };
    }
    if (!this.last) {
      this.last = { x, y };
      this.rejects = 0;
      return { x, y, accept: true, reset: true };
    }
    const dist = Math.hypot(x - this.last.x, y - this.last.y);
    if (dist > this.limit) {
      this.rejects += 1;
      if (this.rejects <= this.maxReject) {
        return { x: this.last.x, y: this.last.y, accept: false, reset: false };
      }
      this.rejects = 0;
      this.last = { x, y };
      return { x, y, accept: true, reset: true };
    }
    this.rejects = 0;
    this.last = { x, y };
    return { x, y, accept: true, reset: false };
  }
}

/** Muelle subamortiguado. Integración semi-implícita en pasos cortos para no explotar. */
export class Spring1D {
  constructor(stiffness = 180, damping = 14) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }

  reset(x = 0) {
    this.x = finite(x, 0);
    this.v = 0;
  }

  update(target, dt) {
    const goal = finite(target, this.x);
    let left = finite(dt, 0);
    if (left <= 0) return this.x;
    if (left > 0.05) left = 0.05;
    const k = finite(this.k, 180);
    const c = finite(this.c, 14);
    let guard = 0;
    while (left > 1e-5 && guard < 8) {
      const h = Math.min(left, 1 / 120);
      const a = k * (goal - this.x) - c * this.v;
      this.v += a * h;
      this.x += this.v * h;
      if (Math.abs(this.v) > 80) this.v = Math.sign(this.v) * 80;
      left -= h;
      guard += 1;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) {
      this.x = goal;
      this.v = 0;
    }
    return this.x;
  }
}

/** Sube rápido y baja más despacio. El parpadeo usa ataque alto para sentirse instantáneo. */
export class AttackRelease {
  constructor(attack = 48, release = 10) {
    this.attack = attack;
    this.release = release;
    this.y = 0;
  }

  reset(v = 0) {
    this.y = finite(v, 0);
  }

  update(target, dt) {
    const goal = finite(target, this.y);
    const step = finite(dt, 0);
    if (step <= 0) return this.y;
    const rate = goal > this.y ? this.attack : this.release;
    const k = 1 - Math.exp(-Math.max(0, rate) * Math.min(step, 0.1));
    this.y += (goal - this.y) * k;
    if (!Number.isFinite(this.y)) this.y = 0;
    return this.y;
  }
}

export function expApproach(current, target, rate, dt) {
  const c = finite(current, 0);
  const g = finite(target, c);
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, finite(dt, 0)));
  const v = c + (g - c) * k;
  return Number.isFinite(v) ? v : g;
}
