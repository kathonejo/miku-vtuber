/* Movimiento determinista: cada capa se "hornea" en una tabla de 60 muestras/s para un loop.
   Todo es periódico con el largo del loop, así el último cuadro empalma con el primero. */

export const RATE = 60;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const EASE = {
  linear: (x) => x,
  fluido: (x) => x,
  sine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
  inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  back: (x) => {
    const c1 = 1.70158 * 1.2;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  },
  bounce: (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }
    if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; }
    x -= 2.625 / d; return n * x * x + 0.984375;
  },
  step: (x) => (x < 1 ? 0 : 1),
};

export const POSE_KEYS = ['dx', 'dy', 'rot', 'sc', 'op'];

/** Claves ordenadas por tiempo (0..1 del loop). */
export function sortedKeys(set) {
  const keys = Array.isArray(set.keys) ? set.keys.filter((k) => Number.isFinite(k.t)) : [];
  return keys.slice().sort((a, b) => a.t - b.t);
}

/* Catmull-Rom: curva suave que pasa por todos los puntos. */
function cr(p0, p1, p2, p3, s) {
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

/**
 * Pose en el momento u (0..1) según las claves. Con loop, la última empalma con la primera.
 * `curve` = recorrido suave (la posición sigue una curva por todas las claves).
 */
export function keyPose(keys, u, loop, curve = false) {
  const n = keys.length;
  if (!n) return null;
  const pose = (k) => ({ dx: k.dx ?? 0, dy: k.dy ?? 0, rot: k.rot ?? 0, sc: k.sc ?? 1, op: k.op ?? 1 });
  if (n === 1) return pose(keys[0]);
  let i, local;
  if (u >= keys[n - 1].t || u < keys[0].t) {
    if (!loop) return pose(u < keys[0].t ? keys[0] : keys[n - 1]);
    i = n - 1;
    const span = 1 - keys[n - 1].t + keys[0].t;
    local = span <= 1e-6 ? 0 : frac(u - keys[n - 1].t) / span;
  } else {
    i = 0;
    while (i < n - 2 && u >= keys[i + 1].t) i += 1;
    const span = keys[i + 1].t - keys[i].t;
    local = span <= 1e-6 ? 1 : (u - keys[i].t) / span;
  }
  const j = (i + 1) % n;
  const a = pose(keys[i]), b = pose(keys[j]);
  const s = (EASE[keys[i].ease] || EASE.inout)(Math.max(0, Math.min(1, local)));
  const out = {};
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * s;
  if (curve && n >= 3) {
    const at = (k) => (loop ? keys[((k % n) + n) % n] : keys[Math.max(0, Math.min(n - 1, k))]);
    const p0 = pose(at(i - 1)), p3 = pose(at(i + 2));
    out.dx = cr(p0.dx, a.dx, b.dx, p3.dx, s);
    out.dy = cr(p0.dy, a.dy, b.dy, p3.dy, s);
  }
  return out;
}

const frac = (x) => x - Math.floor(x);

/** Ciclos por loop: con loop perfecto se redondea a entero. */
export function cyclesFor(period, duration, loop) {
  const p = Math.max(0.2, Number(period) || 1);
  const c = duration / p;
  return loop ? Math.max(1, Math.round(c)) : c;
}

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function localMatrix(px, py, dx, dy, rot, sc) {
  const c = Math.cos(rot) * sc;
  const s = Math.sin(rot) * sc;
  // T(p+d) · R · S · T(-p)
  return [c, s, -s, c, px + dx - (c * px - s * py), py + dy - (s * px + c * py)];
}

function kfPose(set, t, D, loop) {
  const kf = set.kf;
  if (!kf?.on) return null;
  const c = cyclesFor(kf.period || D, D, loop);
  const u = frac((c * t) / D + set.phase);
  const ease = EASE[kf.ease] || EASE.inout;
  let s;
  if (kf.hold) s = u < 0.4 ? ease(u / 0.4) : u < 0.5 ? 1 : u < 0.9 ? 1 - ease((u - 0.5) / 0.4) : 0;
  else s = u < 0.5 ? ease(u * 2) : 1 - ease((u - 0.5) * 2);
  const a = kf.a, b = kf.b;
  const L = (k) => a[k] + (b[k] - a[k]) * s;
  return { dx: L('dx'), dy: L('dy'), rot: L('rot'), sc: L('sc'), op: L('op') };
}

/** ¿Orbita alrededor de otra cosa (otra capa o un punto) en vez de su propio lugar? */
export function orbitsOther(b) {
  return b?.type === 'orbitar' && (b.center === 'layer' || b.center === 'point');
}
/** Vueltas por loop de una órbita (entero con loop perfecto). */
export function orbitCycles(b, D, loop) {
  if (loop && b.turns) return Math.max(1, Math.round(b.turns));
  return cyclesFor(b.period, D, loop);
}
/** Ángulo de la órbita en el tiempo t (sin el ángulo de arranque), en radianes. */
export function orbitAngle(set, t, D, loop) {
  const b = set.beh || {};
  const u = frac((orbitCycles(b, D, loop) * t) / D + (set.phase || 0));
  return (b.dir === -1 ? -1 : 1) * TAU * u;
}
/** Punto (en coordenadas del archivo) que usa una capa como centro de su órbita. */
export function orbitCenterPoint(scene, set) {
  const b = set.beh || {};
  if (b.center === 'point') return [b.cx ?? scene.width / 2, b.cy ?? scene.height / 2];
  const L = scene.layers[b.centerLayer];
  if (!L) return [scene.width / 2, scene.height / 2];
  return [L.x + L.w / 2, L.y + L.h / 2];
}
export function orbitCenterLocal(scene, settings, set) {
  const b = set.beh || {};
  if (b.center === 'layer' && b.centerUse === 'pivote') {
    const cs = settings.layers[b.centerLayer];
    if (cs?.pivot) return [cs.pivot.x, cs.pivot.y];
  }
  return orbitCenterPoint(scene, set);
}

/** Parte sin resorte: pose (claves o la que se está editando) + comportamiento. */
function baseAt(layer, set, t, D, loop, edit, keys) {
  const b = set.beh || { type: 'none' };
  const curve = b.type === 'recorrido';
  const pose = edit || keyPose(keys, frac(t / D), loop, curve) || kfPose(set, t, D, loop) || { dx: 0, dy: 0, rot: 0, sc: 1, op: 1 };
  const c = b.type === 'orbitar' ? orbitCycles(b, D, loop) : cyclesFor(b.period, D, loop);
  const u = frac((c * t) / D + set.phase);
  const w = TAU * u;
  const out = { dx: pose.dx, dy: pose.dy, rot: pose.rot * DEG, sc: pose.sc, op: pose.op, glow: 0, wind: 0, drift: 0 };
  if (b.type === 'flotar') {
    out.dy += -b.amp * (Math.sin(w) * 0.85 + Math.sin(2 * w + 1.3) * 0.15);
    out.dx += b.amp * 0.3 * Math.cos(w + 0.7);
    out.rot += (b.rot || 0) * DEG * Math.sin(w + 1.1);
    if (b.pulse) out.sc *= 1 + b.pulse * Math.sin(w + 0.4);
  } else if (b.type === 'orbitar' && orbitsOther(b)) {
    // la posición la pone bake(), que conoce dónde está el centro en cada momento
    if (b.spin) out.rot += (b.dir === -1 ? -1 : 1) * w;
  } else if (b.type === 'orbitar') {
    const dir = b.dir === -1 ? -1 : 1;
    out.dx += (b.rx || 0) * Math.cos(dir * w);
    out.dy += (b.ry || 0) * Math.sin(dir * w);
    if (b.spin) out.rot += dir * w;
  } else if (b.type === 'latido') {
    const bump = (c, wd) => Math.exp(-(((u - c) / wd) ** 2));
    const p = b.heart ? Math.min(1, bump(0.1, 0.05) + 0.7 * bump(0.28, 0.05)) : 0.5 - 0.5 * Math.cos(w);
    out.sc *= 1 + (b.amount ?? 0.15) * p;
  } else if (b.type === 'aparecer') {
    const show = Math.max(0.05, Math.min(0.9, b.show ?? 0.5));
    const fade = Math.max(0.02, (1 - show) / 2 * (b.soft ?? 0.6));
    let v;
    if (u < show) v = 1;
    else if (u < show + fade) v = 1 - EASE.sine((u - show) / fade);
    else if (u < 1 - fade) v = 0;
    else v = EASE.sine((u - (1 - fade)) / fade);
    const lo = Math.max(0, Math.min(1, b.min ?? 0));
    out.op *= lo + (1 - lo) * v;
  } else if (b.type === 'recorrido') {
    if (b.orient && keys.length >= 2 && !edit) {
      const e = 0.002;
      const p1 = keyPose(keys, frac(t / D - e), loop, true), p2 = keyPose(keys, frac(t / D + e), loop, true);
      const ang = Math.atan2(p2.dy - p1.dy, p2.dx - p1.dx);
      if (Math.hypot(p2.dy - p1.dy, p2.dx - p1.dx) > 1e-4) out.rot += ang;
    }
  } else if (b.type === 'balanceo') {
    out.wind = Math.sin(w) * 0.8 + Math.sin(2 * w + 0.9) * 0.2;
  } else if (b.type === 'deriva') {
    out.drift = u;
  } else if (b.type === 'brillo') {
    const p = 0.5 - 0.5 * Math.cos(w);
    out.op *= 1 - (b.depth ?? 0.5) * (1 - p);
    out.glow = (b.glow ?? 0.6) * p;
    out.sc *= 1 + 0.03 * p;
  }
  return out;
}

/* "Mover poco": ningún borde de la capa se aleja más de maxMove px (límite suave, sin topes bruscos). */
function clampPoco(layer, set, v) {
  if (!set.poco) return v;
  const m = Math.max(0, set.maxMove || 0);
  const px = set.pivot?.x ?? layer.x + layer.w / 2;
  const py = set.pivot?.y ?? layer.y + layer.h / 2;
  let radius = 8;
  for (const [x, y] of [[layer.x, layer.y], [layer.x + layer.w, layer.y], [layer.x, layer.y + layer.h], [layer.x + layer.w, layer.y + layer.h]]) {
    radius = Math.max(radius, Math.hypot(x - px, y - py));
  }
  const total = Math.hypot(v.dx, v.dy) + radius * (Math.abs(v.rot) + Math.abs(v.sc - 1));
  if (total <= 1e-9) return v;
  const k = m <= 0 ? 0 : (m * Math.tanh(total / m)) / total;
  v.dx *= k; v.dy *= k; v.rot *= k; v.sc = 1 + (v.sc - 1) * k;
  return v;
}

function order(layers, sets) {
  const done = new Set();
  const out = [];
  const visit = (i, depth) => {
    if (done.has(i) || depth > layers.length) return;
    const p = sets[i].parent;
    if (p != null && p !== i && sets[p]) visit(p, depth + 1);
    const ob = sets[i].beh;
    if (orbitsOther(ob) && ob.center === 'layer' && ob.centerLayer !== i && sets[ob.centerLayer]) visit(ob.centerLayer, depth + 1);
    done.add(i);
    out.push(i);
  };
  layers.forEach((_, i) => visit(i, 0));
  return out;
}

/**
 * Hornea la escena. Devuelve { N, mats: Float32Array por capa (N*6), op, glow, drift }.
 * `edit` = { index, pose } para mostrar la pose que se está editando.
 */
export function bake(scene, settings, edit = null) {
  const D = Math.max(1, settings.duration);
  const loop = settings.loop;
  const N = Math.max(2, Math.round(D * RATE));
  const sets = settings.layers;
  const out = scene.layers.map(() => null);
  for (const i of order(scene.layers, sets)) {
    const layer = scene.layers[i];
    const set = sets[i];
    const mats = new Float32Array(N * 6);
    const op = new Float32Array(N);
    const glow = new Float32Array(N);
    const drift = new Float32Array(N);
    const pose = edit && edit.index === i ? edit.pose : null;
    const keys = sortedKeys(set);
    const B = set.base || {};
    const parent = set.parent != null && set.parent !== i ? out[set.parent] : null;
    const base = new Array(N);
    for (let k = 0; k < N; k += 1) base[k] = baseAt(layer, set, (k / N) * D, D, loop, pose, keys);
    const b = set.beh || {};
    if (orbitsOther(b)) {
      // Órbita alrededor de otra capa (que puede moverse) o de un punto fijo.
      const [lx, ly] = orbitCenterLocal(scene, settings, set);
      const C = b.center === 'layer' && b.centerLayer !== i ? out[b.centerLayer] : null;
      const rx = b.rx || 0, ry = b.ry || 0, a0 = b.a0 || 0;
      const restX = set.pivot.x + (B.dx || 0), restY = set.pivot.y + (B.dy || 0);
      for (let k = 0; k < N; k += 1) {
        let cx = lx, cy = ly;
        if (C) {
          const j = k * 6, m = C.mats;
          cx = m[j] * lx + m[j + 2] * ly + m[j + 4];
          cy = m[j + 1] * lx + m[j + 3] * ly + m[j + 5];
        }
        const ang = a0 + orbitAngle(set, (k / N) * D, D, loop);
        base[k].dx += cx + rx * Math.cos(ang) - restX;
        base[k].dy += cy + ry * Math.sin(ang) - restY;
      }
    }
    const isSway = b.type === 'balanceo';
    const follow = parent ? Math.max(0, set.follow || 0) : 0;
    // Resorte: se simula 3 loops para llegar al régimen estable y se guarda el último.
    const rot = new Float32Array(N);
    const offx = new Float32Array(N);
    const offy = new Float32Array(N);
    if (isSway || follow > 0) {
      const ax = new Float32Array(N);
      const ay = new Float32Array(N);
      if (!parent) {
        const h = D / N;
        for (let k = 0; k < N; k += 1) {
          const p0 = base[(k - 1 + N) % N], p1 = base[k], p2 = base[(k + 1) % N];
          ax[k] = (p2.dx - 2 * p1.dx + p0.dx) / (h * h);
        }
      } else {
        const pos = (k) => {
          const m = parent.mats;
          const j = ((k % N) + N) % N * 6;
          return [m[j] * set.pivot.x + m[j + 2] * set.pivot.y + m[j + 4], m[j + 1] * set.pivot.x + m[j + 3] * set.pivot.y + m[j + 5]];
        };
        const h = D / N;
        for (let k = 0; k < N; k += 1) {
          const p0 = pos(k - 1), p1 = pos(k), p2 = pos(k + 1);
          ax[k] = (p2[0] - 2 * p1[0] + p0[0]) / (h * h);
          ay[k] = (p2[1] - 2 * p1[1] + p0[1]) / (h * h);
        }
      }
      const stiff = Math.min(1, Math.max(0, b.stiff ?? 0.45));
      const f0 = 0.6 + stiff * 3.4;
      const kk = (TAU * f0) ** 2;
      const damp = 2 * 0.22 * Math.sqrt(kk);
      const amp = isSway ? (b.amp || 0) * DEG : 0;
      const len = Math.max(20, layer.h * 0.8);
      const sub = 4;
      const dt = D / N / sub;
      let th = 0, vth = 0, x = 0, vx = 0, y = 0, vy = 0;
      for (let pass = 0; pass < 3; pass += 1) {
        for (let k = 0; k < N; k += 1) {
          for (let s = 0; s < sub; s += 1) {
            const target = amp * base[k].wind;
            const ath = kk * (target - th) - damp * vth - (isSway ? (parent ? follow : 1) * ax[k] / len : 0);
            vth += ath * dt; th += vth * dt;
            if (follow > 0) {
              const k2 = kk * 0.6;
              const d2 = 2 * 0.18 * Math.sqrt(k2);
              vx += (-k2 * x - d2 * vx - follow * ax[k]) * dt; x += vx * dt;
              vy += (-k2 * y - d2 * vy - follow * ay[k]) * dt; y += vy * dt;
            }
          }
          if (pass === 2) { rot[k] = th; offx[k] = x; offy[k] = y; }
        }
      }
    }
    for (let k = 0; k < N; k += 1) {
      const v = base[k];
      v.rot += rot[k];
      v.dx += offx[k];
      v.dy += offy[k];
      clampPoco(layer, set, v);
      // Ubicación base (donde vive la capa) + animación encima.
      let m = localMatrix(set.pivot.x, set.pivot.y, v.dx + (B.dx || 0), v.dy + (B.dy || 0), v.rot + (B.rot || 0) * DEG, v.sc * (B.sc ?? 1));
      if (parent) {
        const j = k * 6;
        m = mul([parent.mats[j], parent.mats[j + 1], parent.mats[j + 2], parent.mats[j + 3], parent.mats[j + 4], parent.mats[j + 5]], m);
      }
      mats.set(m, k * 6);
      op[k] = Math.max(0, Math.min(1, v.op)) * (parent ? parent.op[k] : 1);
      glow[k] = v.glow;
      drift[k] = v.drift;
    }
    out[i] = { mats, op, glow, drift };
  }
  return { N, D, layers: out };
}

/** Muestra el horneado en el tiempo t (interpola entre muestras). */
export function sample(baked, i, t) {
  const L = baked.layers[i];
  const N = baked.N;
  const f = (frac(t / baked.D) * N);
  const k0 = Math.floor(f) % N;
  const k1 = (k0 + 1) % N;
  const a = f - Math.floor(f);
  const m = new Array(6);
  for (let j = 0; j < 6; j += 1) m[j] = L.mats[k0 * 6 + j] * (1 - a) + L.mats[k1 * 6 + j] * a;
  let d = L.drift[k0] + (L.drift[k1] - L.drift[k0]) * a;
  if (L.drift[k1] < L.drift[k0]) d = L.drift[k0];
  return { m, op: L.op[k0] * (1 - a) + L.op[k1] * a, glow: L.glow[k0] * (1 - a) + L.glow[k1] * a, drift: d };
}

export { frac };
