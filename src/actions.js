/** Gestos con las mangas. Teclas 1–6. El vídeo no interviene: solo la pose de las mangas. */

import { clamp, finite } from './filters.js';

export const POP_IN = 0.18;
export const RETRACT = 0.2;
const DEG = Math.PI / 180;

export const ACTIONS = [
  { id: 'wave', name: 'Saludar', emoji: '👋', key: '1', duration: 1.8, smile: 0, jump: false },
  { id: 'heart', name: 'Corazón', emoji: '🫶', key: '2', duration: 1.8, smile: 0.4, jump: false },
  { id: 'peace', name: 'Paz', emoji: '✌️', key: '3', duration: 1.6, smile: 0.4, jump: false },
  { id: 'clap', name: 'Aplaudir', emoji: '👏', key: '4', duration: 1.6, smile: 0, jump: false },
  { id: 'point', name: 'Señalar', emoji: '👉', key: '5', duration: 1.5, smile: 0, jump: false },
  { id: 'up', name: '¡Celebrar!', emoji: '🙌', key: '6', duration: 1.6, smile: 0.4, jump: true },
];

const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const BY_KEY = Object.fromEntries(ACTIONS.map((a) => [a.key, a]));

export function actionById(id) {
  return BY_ID[id] || null;
}

export function actionByKey(key) {
  return BY_KEY[key] || null;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function envelope(t, dur) {
  const time = finite(t, 0);
  if (time >= dur) return null;
  if (time < POP_IN) {
    const k = time / POP_IN;
    const e = easeOutBack(clamp(k, 0, 1));
    return { phase: 'in', scaleX: 0.2 + 0.8 * e, alpha: clamp(k * 1.65, 0, 1), loop: k, poseT: 0 };
  }
  if (time > dur - RETRACT) {
    const k = (time - (dur - RETRACT)) / RETRACT;
    const e = k * k;
    return {
      phase: 'out',
      scaleX: 1 - 0.82 * e,
      alpha: 1 - e,
      loop: 1 - e,
      poseT: dur - RETRACT - POP_IN,
    };
  }
  return { phase: 'hold', scaleX: 1, alpha: 1, loop: 1, poseT: time - POP_IN };
}

function bone(baseSh, baseEl, oscSh, oscEl, tip) {
  return { baseSh, baseEl, oscSh, oscEl, tip };
}

/** Ángulo de mundo: 0 = abajo, + hacia la derecha de la pantalla. dir = (sin φ, cos φ). */
function poseBones(id, poseT) {
  const t = finite(poseT, 0);
  if (id === 'wave') {
    const wave = Math.sin(t * Math.PI * 2 * 3) * 25 * DEG;
    return {
      l: null,
      r: bone(2.075, 2.291, 0, wave, 'round'),
    };
  }
  if (id === 'heart') {
    return {
      l: bone(0.118, 1.807, 0, 0, 'heart'),
      r: bone(-0.118, -1.807, 0, 0, 'heart'),
      heart: 0.08 + 0.05 * Math.sin(t * 9),
      tipScale: 1.04 + 0.07 * Math.sin(t * 8),
    };
  }
  if (id === 'peace') {
    return {
      l: null,
      r: bone(2.21, 2.42, 0, 0, 'v'),
      sparkle: true,
      roll: 0.62,
    };
  }
  if (id === 'clap') {
    const hold = 1.6 - POP_IN - RETRACT;
    const period = 0.3;
    const cycles = (t - 0.12) / period;
    const close = Math.cos(cycles * Math.PI) ** 2;
    const usable = t >= 0 && t <= hold + 0.04 ? close : 0;
    const side = (sign) => {
      const togSh = sign * 0.094;
      const apaSh = sign * -1.581;
      const togEl = sign * 1.557;
      const apaEl = sign * -0.403;
      const sh = apaSh + (togSh - apaSh) * usable;
      const el = apaEl + (togEl - apaEl) * usable;
      return bone((togSh + apaSh) / 2, (togEl + apaEl) / 2, sh - (togSh + apaSh) / 2, el - (togEl + apaEl) / 2, 'flat');
    };
    return { l: side(1), r: side(-1), clapClose: usable };
  }
  if (id === 'point') {
    return {
      l: bone(-1.799, -1.62, 0, 0, 'point'),
      r: null,
      lean: -1,
    };
  }
  if (id === 'up') {
    const flopL = Math.sin(t * Math.PI * 2 * 2.4) * 18 * DEG;
    const flopR = Math.sin(t * Math.PI * 2 * 2.4 + 0.7) * 18 * DEG;
    return {
      l: bone(-2.4, -2.15, 0, flopL, 'round'),
      r: bone(2.45, 2.55, 0, flopR, 'round'),
    };
  }
  return { l: null, r: null };
}

function sleeveFrom(id, env, extra) {
  const bones = poseBones(id, env.poseT);
  return {
    visible: env.alpha > 0.02,
    snap: false,
    scaleX: env.scaleX,
    alpha: env.alpha,
    loop: env.loop,
    pose: id,
    l: bones.l,
    r: bones.r,
    sparkle: Boolean(bones.sparkle) && env.phase !== 'out',
    clapClose: bones.clapClose || 0,
    tipScale: bones.tipScale || 1,
    smile: 0,
    roll: (bones.roll || 0) * env.alpha,
    lean: (bones.lean || 0) * env.alpha,
    heart: (bones.heart || 0) * env.alpha,
    ...extra,
  };
}

function autoUp(amount, clock) {
  const a = clamp((amount - 0.35) / 0.65, 0, 1);
  const env = { poseT: clock, phase: 'hold', scaleX: 0.45 + 0.55 * a, alpha: clamp(a * 1.25, 0, 1), loop: a };
  const up = poseBones('up', clock);
  const hangL = bone(-0.32, -0.12, 0, 0, 'round');
  const hangR = bone(0.32, 0.12, 0, 0, 'round');
  const mix = (hang, goal) => bone(
    hang.baseSh + (goal.baseSh - hang.baseSh) * a,
    hang.baseEl + (goal.baseEl - hang.baseEl) * a,
    goal.oscSh * a,
    goal.oscEl * a,
    'round',
  );
  return {
    visible: env.alpha > 0.04,
    snap: false,
    scaleX: env.scaleX,
    alpha: env.alpha,
    loop: 1,
    pose: 'up',
    auto: true,
    l: mix(hangL, up.l),
    r: mix(hangR, up.r),
    sparkle: false,
    clapClose: 0,
    tipScale: 1,
    roll: 0,
    lean: 0,
    heart: 0,
  };
}

function emptySleeve() {
  return {
    visible: false,
    snap: false,
    scaleX: 1,
    alpha: 0,
    loop: 0,
    pose: null,
    l: null,
    r: null,
    sparkle: false,
    clapClose: 0,
    tipScale: 1,
    roll: 0,
    lean: 0,
    heart: 0,
  };
}

export function createActions() {
  let current = null;
  let frozen = null;
  let jumpLatch = false;
  let wristHold = 0;
  let wristShown = false;
  let prevClose = 0;
  let clock = 0;

  function trigger(name) {
    const spec = actionById(name);
    if (!spec) return false;
    current = { id: spec.id, t: 0, dur: spec.duration };
    frozen = null;
    jumpLatch = Boolean(spec.jump);
    wristShown = false;
    wristHold = 0;
    prevClose = 0;
    return true;
  }

  function freeze(name, t) {
    if (name == null || t == null) {
      frozen = null;
      current = null;
      return;
    }
    const spec = actionById(name);
    if (!spec) return;
    const time = Math.max(0, finite(t, 0));
    frozen = { id: spec.id, t: time };
    current = { id: spec.id, t: time, dur: spec.duration };
    jumpLatch = false;
  }

  function currentId() {
    if (frozen) return frozen.id;
    if (current) return current.id;
    return null;
  }

  function sample(id, t, dur, snap) {
    const spec = actionById(id);
    const env = envelope(t, dur);
    if (!env || !spec) return null;
    const sleeve = sleeveFrom(id, env);
    sleeve.snap = snap;
    sleeve.smile = spec.smile * env.alpha;
    return { spec, env, sleeve };
  }

  function step(dtIn, targets) {
    const dt = clamp(finite(dtIn, 0), 0, 0.05);
    clock += dt;
    let jump = false;
    if (jumpLatch) {
      jump = true;
      jumpLatch = false;
    }

    if (frozen) {
      const got = sample(frozen.id, frozen.t, actionById(frozen.id).duration, true);
      const sleeve = got ? got.sleeve : emptySleeve();
      prevClose = sleeve.clapClose || 0;
      return {
        jump: false,
        smile: got ? got.sleeve.smile : 0,
        roll: sleeve.roll || 0,
        lean: sleeve.lean || 0,
        heart: sleeve.heart || 0,
        bounce: 0,
        sleeve,
        id: frozen.id,
      };
    }

    if (current) {
      current.t += dt;
      const spec = actionById(current.id);
      if (!spec || current.t >= spec.duration) current = null;
    }

    if (current) {
      const spec = actionById(current.id);
      const got = sample(current.id, current.t, spec.duration, false);
      const sleeve = got ? got.sleeve : emptySleeve();
      let bounce = 0;
      const close = sleeve.clapClose || 0;
      if (prevClose <= 0.9 && close > 0.9) bounce = 0.12;
      prevClose = close;
      wristShown = false;
      wristHold = 0;
      return {
        jump,
        smile: got ? got.sleeve.smile : 0,
        roll: sleeve.roll || 0,
        lean: sleeve.lean || 0,
        heart: sleeve.heart || 0,
        bounce,
        sleeve,
        id: current.id,
      };
    }

    prevClose = 0;
    const wristUp = clamp(finite(targets?.wristUp, 0), 0, 1);
    if (wristUp > 0.55) wristHold += dt;
    else wristHold = 0;
    if (!wristShown && wristHold >= 0.25) wristShown = true;
    if (wristShown && wristUp < 0.35) {
      wristShown = false;
      wristHold = 0;
    }
    if (wristShown) {
      const sleeve = autoUp(wristUp, clock);
      return { jump, smile: 0, roll: 0, lean: 0, heart: 0, bounce: 0, sleeve, id: null };
    }
    return { jump, smile: 0, roll: 0, lean: 0, heart: 0, bounce: 0, sleeve: emptySleeve(), id: null };
  }

  function merge(targets, fx) {
    const base = targets || {};
    const smileAdd = finite(fx?.smile, 0);
    return {
      ...base,
      smile: clamp(finite(base.smile, 0) + smileAdd, 0, 1.5),
      roll: clamp(finite(base.roll, 0) + finite(fx?.roll, 0), -1.5, 1.5),
      exprSmile: clamp(smileAdd, 0, 1),
      exprLean: finite(fx?.lean, 0),
      exprHeart: finite(fx?.heart, 0),
      exprBounce: finite(fx?.bounce, 0),
      sleeve: fx?.sleeve || emptySleeve(),
    };
  }

  return { trigger, freeze, step, merge, currentId };
}
