/**
 * Cara por recortes (personajes con dibujos sueltos, p. ej. la Conejita azul).
 *
 * La boca y los ojos no se deforman ni se funden: se cambia de un recorte al
 * otro de golpe. Este módulo solo decide CUÁNDO cambiar.
 *
 * Boca: umbral sensible con histéresis, tiempo mínimo en cada estado y cierre
 * rápido entre sílabas (si la mandíbula baja bastante desde el pico, se cierra
 * aunque no llegue a cero; vuelve a abrir cuando sube de nuevo).
 *
 * Ojos: usa la calibración del rastreo (línea base de ojo abierto por ojo, que
 * mide «Calibrar» y la calibración automática al activar la cámara) y aprende
 * el valor de ojo cerrado de cada ojo. Umbrales relativos a esa línea base, con
 * histéresis. Los valores aprendidos se guardan por personaje.
 */

import { clamp, finite } from './filters.js';

export const SWAP_DEFAULTS = {
  mouth: { on: 0.07, off: 0.04, holdMs: 70, drop: 0.6, minDrop: 0.03, rise: 0.03 },
  eyes: { close: 0.55, open: 0.35, closedRef: 0.75, minSpan: 0.22 },
};

const CAL_PREFIX = 'bunny-vtuber-eyecal-v1:';

function num(v, d) {
  return finite(v, d);
}

export function normalizeSwap(json) {
  if (!json || typeof json !== 'object') return null;
  const mo = json.mouth || {};
  const ey = json.eyes || {};
  const d = SWAP_DEFAULTS;
  return {
    mouth: {
      on: clamp(num(mo.on, d.mouth.on), 0.005, 1),
      off: clamp(num(mo.off, d.mouth.off), 0, 1),
      holdMs: clamp(num(mo.holdMs, d.mouth.holdMs), 0, 400),
      drop: clamp(num(mo.drop, d.mouth.drop), 0.1, 0.95),
      minDrop: clamp(num(mo.minDrop, d.mouth.minDrop), 0, 0.5),
      rise: clamp(num(mo.rise, d.mouth.rise), 0, 0.5),
      openId: typeof mo.openId === 'string' ? mo.openId : 'a',
      closedId: typeof mo.closedId === 'string' ? mo.closedId : 'neutral',
    },
    eyes: {
      close: clamp(num(ey.close, d.eyes.close), 0.1, 0.95),
      open: clamp(num(ey.open, d.eyes.open), 0.05, 0.9),
      closedRef: clamp(num(ey.closedRef, d.eyes.closedRef), 0.2, 1),
      minSpan: clamp(num(ey.minSpan, d.eyes.minSpan), 0.05, 0.9),
    },
  };
}

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function loadEyeCal(id) {
  const store = storage();
  if (!store || !id) return null;
  try {
    const raw = JSON.parse(store.getItem(CAL_PREFIX + id) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const k of ['openL', 'openR', 'closedL', 'closedR']) {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = clamp(v, 0, 1);
    }
    return out;
  } catch {
    return null;
  }
}

export function saveEyeCal(id, cal) {
  const store = storage();
  if (!store || !id) return;
  try { store.setItem(CAL_PREFIX + id, JSON.stringify({ ...cal, at: Date.now() })); } catch { /* lleno */ }
}

export function clearEyeCal(id) {
  const store = storage();
  if (!store || !id) return;
  try { store.removeItem(CAL_PREFIX + id); } catch { /* noop */ }
}

/** Puerta de boca: entra la apertura (0..1.5), sale abierta o cerrada. */
export function createMouthGate(cfg) {
  const st = { open: false, t: 1, peak: 0, valley: 0 };
  return {
    state: st,
    reset() {
      st.open = false;
      st.t = 1;
      st.peak = 0;
      st.valley = 0;
    },
    step(s, dt) {
      const c = cfg();
      const x = Math.max(0, finite(s, 0));
      st.t += Math.max(0, finite(dt, 0));
      const held = st.t * 1000 >= c.holdMs;
      if (st.open) {
        st.peak = Math.max(st.peak, x);
        const fell = x < c.off;
        const dipped = st.peak - x >= c.minDrop && x < st.peak * c.drop;
        if (held && (fell || dipped)) {
          st.open = false;
          st.t = 0;
          st.valley = x;
        }
      } else {
        st.valley = Math.min(st.valley, x);
        const rose = x > c.on && x >= st.valley + c.rise;
        if (held && rose) {
          st.open = true;
          st.t = 0;
          st.peak = x;
        }
      }
      return st.open;
    },
  };
}

/**
 * Ojos por recorte. `sample` trae blinkRawL/R (ya en lados de pantalla),
 * blinkOpenL/R (línea base de ojo abierto del rastreo), calibReady (el rastreo
 * ya midió la cara relajada) y calibEpoch (veces que se pulsó «Calibrar»).
 */
export function createEyeGate(cfg) {
  const st = {
    id: null,
    closedL: false,
    closedR: false,
    openL: null,
    openR: null,
    refL: null,
    refR: null,
    evL: null,
    evR: null,
    epoch: null,
    dirty: false,
    saveT: 0,
    nL: 0,
    nR: 0,
  };

  function bind(id) {
    if (st.id === id) return;
    st.id = id;
    const saved = loadEyeCal(id) || {};
    st.openL = saved.openL ?? null;
    st.openR = saved.openR ?? null;
    st.refL = saved.closedL ?? null;
    st.refR = saved.closedR ?? null;
    st.evL = null;
    st.evR = null;
    st.closedL = false;
    st.closedR = false;
    st.epoch = null;
    st.savedOnce = false;
  }

  /** Valor de ojo cerrado: media de los picos de los últimos parpadeos. */
  function learn(key, evKey, raw, base, c) {
    const floor = base + c.minSpan;
    let ref = st[key] == null ? Math.max(c.closedRef, floor) : Math.max(st[key], floor);
    const inBlink = raw > base + 0.6 * c.minSpan;
    if (inBlink) st[evKey] = Math.max(st[evKey] ?? 0, raw);
    else if (st[evKey] != null) {
      const peak = st[evKey];
      st[evKey] = null;
      if (peak > floor) {
        ref = Math.min(1, ref * 0.7 + peak * 0.3);
        st.dirty = true;
      }
    }
    st[key] = ref;
    return ref;
  }

  function side(raw, base, ref, wasClosed, c, amt) {
    const span = Math.max(c.minSpan, ref - base);
    const n = clamp(((raw - base) / span) * amt, 0, 1.5);
    return { n, closed: wasClosed ? n >= c.open : n > c.close };
  }

  return {
    state: st,
    bind,
    /** Devuelve { closedL, closedR } o null si no hay datos crudos de la cámara. */
    step(sample, opts, dt) {
      const c = cfg();
      const rawL = Number(sample?.blinkRawL);
      const rawR = Number(sample?.blinkRawR);
      if (!Number.isFinite(rawL) || !Number.isFinite(rawR) || !sample?.face) return null;
      const epoch = finite(sample.calibEpoch, 0);
      if (st.epoch != null && epoch !== st.epoch) {
        // «Calibrar»: el ojo cerrado se vuelve a aprender con la nueva línea base
        st.refL = null;
        st.refR = null;
        st.dirty = true;
      }
      st.epoch = epoch;
      const trackL = Number(sample.blinkOpenL);
      const trackR = Number(sample.blinkOpenR);
      const ready = sample.calibReady === true;
      if (Number.isFinite(trackL) && (ready || st.openL == null)) st.openL = clamp(trackL, 0, 0.9);
      if (Number.isFinite(trackR) && (ready || st.openR == null)) st.openR = clamp(trackR, 0, 0.9);
      const baseL = st.openL ?? 0.08;
      const baseR = st.openR ?? 0.08;
      const refL = learn('refL', 'evL', rawL, baseL, c);
      const refR = learn('refR', 'evR', rawR, baseR, c);
      const amt = clamp(finite(opts?.blinkAmt, 1), 0.2, 2);
      const l = side(rawL, baseL, refL, st.closedL, c, amt);
      const r = side(rawR, baseR, refR, st.closedR, c, amt);
      st.nL = l.n;
      st.nR = r.n;
      if (opts?.independentWink) {
        st.closedL = l.closed;
        st.closedR = r.closed;
      } else {
        // sin guiño independiente, los dos ojos van juntos
        const avg = (l.n + r.n) / 2;
        const was = st.closedL && st.closedR;
        const both = was ? avg >= c.open : avg > c.close;
        st.closedL = both;
        st.closedR = both;
      }
      if (ready && !st.savedOnce) {
        st.savedOnce = true;
        st.dirty = true;
      }
      st.saveT += Math.max(0, finite(dt, 0));
      if (st.dirty && st.saveT > 1.5 && st.id) {
        st.dirty = false;
        st.saveT = 0;
        saveEyeCal(st.id, { openL: baseL, openR: baseR, closedL: refL, closedR: refR });
      }
      return { closedL: st.closedL, closedR: st.closedR };
    },
  };
}
