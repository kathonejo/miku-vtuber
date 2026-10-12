/** Movimiento solo, sin cámara. El azar sale de una semilla; el tiempo no se repite. */

const BASIS = [Math.SQRT2, Math.sqrt(3), Math.sqrt(5), Math.sqrt(7), Math.PI, Math.E];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function easeOut(k) {
  const t = clamp(k, 0, 1);
  return 1 - (1 - t) ** 3;
}

function easeInOut(k) {
  const t = clamp(k, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function pulse(k) {
  const t = clamp(k, 0, 1);
  if (t < 0.36) return easeOut(t / 0.36);
  return 1 - (t - 0.36) / 0.64;
}

function sylEnv(k) {
  const t = clamp(k, 0, 1);
  if (t < 0.28) return easeOut(t / 0.28);
  if (t < 0.6) return 1;
  return 1 - easeOut((t - 0.6) / 0.4);
}

export function createShowcase() {
  let rand = mulberry32(1);
  let time = 0;
  let yawWaves = [];
  let pitchWaves = [];
  let rollWaves = [];
  let gazeWaves = [];
  let smileWaves = [];
  let shoulderWaves = [];
  let look = null;
  let blink = null;
  let saccade = null;
  let talk = null;
  let smileEv = null;
  let bounceAt = 8;
  let pendingJump = 0;

  function exp01() {
    return Math.min(1, -Math.log(Math.max(1e-6, rand())) / 2.4);
  }

  function makeWaves(amp) {
    const n = 2 + Math.floor(rand() * 2);
    const waves = [];
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const twist = 0.82 + (BASIS[i % BASIS.length] % 1) * 0.36;
      let hz = (0.05 + rand() * 0.25) * twist;
      hz = clamp(hz, 0.05, 0.3);
      const weight = 0.5 + rand();
      waves.push({ hz, phase: rand() * Math.PI * 2, weight });
      total += weight;
    }
    for (const wave of waves) wave.amp = (amp * wave.weight) / total;
    return waves;
  }

  function sampleWaves(waves) {
    let y = 0;
    for (const wave of waves) {
      y += Math.sin(time * wave.hz * Math.PI * 2 + wave.phase) * wave.amp;
    }
    return y;
  }

  function scheduleLook(from) {
    return {
      start: from + 2.5 + exp01() * 4.5,
      yaw: (rand() * 2 - 1) * 0.6,
      pitch: (rand() * 2 - 1) * 0.3,
      roll: (rand() * 2 - 1) * 0.25,
      ease: 0.3 + rand() * 0.3,
      hold: 0.65 + rand() * 1.15,
      back: 0.7 + rand() * 0.6,
      lead: 0.12,
      blinkAfter: false,
      firedBlink: false,
    };
  }

  function armLookBlink(ev) {
    const big = Math.abs(ev.yaw) + Math.abs(ev.pitch) > 0.42;
    ev.blinkAfter = big && rand() < 0.55;
  }

  function lookEnd(ev) {
    return ev.start + ev.lead + ev.ease + ev.hold + ev.back;
  }

  function sampleLook() {
    const ev = look;
    const idle = { yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0, gazeK: 0, fireBlink: false };
    if (!ev || time < ev.start) return idle;
    const local = time - ev.start;
    const headStart = ev.lead;
    const headEnd = ev.lead + ev.ease;
    const holdEnd = headEnd + ev.hold;
    const backEnd = holdEnd + ev.back;
    if (local >= backEnd) return null;
    const gazeEase = 0.14;
    let gazeK = 1;
    let headK = 0;
    if (local < gazeEase) gazeK = easeOut(local / gazeEase);
    else if (local >= holdEnd) gazeK = 1 - easeInOut((local - holdEnd) / ev.back);
    if (local >= headStart && local < headEnd) headK = easeOut((local - headStart) / ev.ease);
    else if (local >= headEnd && local < holdEnd) headK = 1;
    else if (local >= holdEnd) headK = 1 - easeInOut((local - holdEnd) / ev.back);
    let fireBlink = false;
    if (ev.blinkAfter && !ev.firedBlink && local >= headEnd) {
      ev.firedBlink = true;
      fireBlink = true;
    }
    return {
      yaw: ev.yaw * headK,
      pitch: ev.pitch * headK,
      roll: ev.roll * headK,
      gx: ev.yaw * 1.15 * gazeK,
      gy: ev.pitch * 1.35 * gazeK,
      gazeK,
      fireBlink,
    };
  }

  function scheduleBlink(from) {
    return {
      t0: from + 2 + exp01() * 4,
      dur: 0.12 + rand() * 0.06,
      dur2: 0.12 + rand() * 0.06,
      gap: 0.07 + rand() * 0.04,
      double: rand() < 0.15,
    };
  }

  function blinkSpan(ev) {
    return ev.double ? ev.dur + ev.gap + ev.dur2 : ev.dur;
  }

  function blinkLevel(ev) {
    const local = time - ev.t0;
    if (local < 0) return 0;
    if (local < ev.dur) return pulse(local / ev.dur);
    if (!ev.double) return -1;
    if (local < ev.dur + ev.gap) return 0;
    const k = (local - ev.dur - ev.gap) / ev.dur2;
    if (k < 1) return pulse(k);
    return -1;
  }

  function nudgeBlink() {
    const local = time - blink.t0;
    if (local >= 0 && local < blinkSpan(blink)) return;
    blink = {
      t0: time + 0.02,
      dur: 0.12 + rand() * 0.06,
      dur2: 0.13,
      gap: 0.08,
      double: false,
    };
  }

  function scheduleSaccade(from, prev) {
    const period = 0.8 + exp01() * 2.2;
    const amp = 0.08 + rand() * 0.26;
    const ang = rand() * Math.PI * 2;
    return {
      t0: from,
      dur: 0.08 + rand() * 0.06,
      until: from + period,
      x: Math.cos(ang) * amp,
      y: Math.sin(ang) * amp * 0.7,
      fromX: prev ? prev.x : 0,
      fromY: prev ? prev.y : 0,
    };
  }

  function sampleSaccade() {
    const ev = saccade;
    if (!ev || time < ev.t0) return { x: ev ? ev.fromX : 0, y: ev ? ev.fromY : 0 };
    const k = ev.dur > 0 ? (time - ev.t0) / ev.dur : 1;
    const e = easeOut(k);
    return {
      x: ev.fromX + (ev.x - ev.fromX) * e,
      y: ev.fromY + (ev.y - ev.fromY) * e,
    };
  }

  function buildBurst(start) {
    const dur = 1.5 + rand() * 3.5;
    const end = start + dur;
    const segs = [];
    let cursor = start;
    let sincePhrase = 0;
    const phraseEvery = 2 + Math.floor(rand() * 2);
    let guard = 0;
    while (cursor < end - 0.09 && guard < 48) {
      guard += 1;
      const count = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < count && cursor < end - 0.09; i += 1) {
        const len = 0.09 + rand() * 0.13;
        const jaw = 0.25 + rand() * 0.65;
        const kind = rand();
        let funnel = 0;
        let smile = 0;
        if (kind < 0.18) funnel = 0.6 + rand() * 0.3;
        else if (kind < 0.34) smile = 0.45 + rand() * 0.4;
        const stress = (i === 0 && rand() < 0.7) || rand() < 0.16;
        segs.push({
          t0: cursor,
          t1: Math.min(end, cursor + len),
          jaw,
          funnel,
          smile,
          stress,
        });
        cursor += len;
      }
      if (cursor >= end - 0.05) break;
      sincePhrase += 1;
      const phrase = sincePhrase >= phraseEvery;
      if (phrase) sincePhrase = 0;
      const gap = phrase ? 0.4 + rand() * 0.4 : 0.1 + rand() * 0.2;
      const gapEnd = Math.min(end, cursor + gap);
      segs.push({ t0: cursor, t1: gapEnd, rest: true });
      cursor = gapEnd;
    }
    return { start, end, segs };
  }

  function sampleTalk() {
    const idle = { jaw: 0, funnel: 0, pucker: 0, smile: 0, nod: 0 };
    if (!talk || time < talk.start) return idle;
    if (time >= talk.end) return null;
    for (const seg of talk.segs) {
      if (time < seg.t0 || time >= seg.t1) continue;
      if (seg.rest) return idle;
      const span = Math.max(1e-3, seg.t1 - seg.t0);
      const k = (time - seg.t0) / span;
      const env = sylEnv(k);
      return {
        jaw: seg.jaw * env,
        funnel: seg.funnel * env,
        pucker: 0,
        smile: seg.smile * env,
        nod: seg.stress ? Math.sin(clamp(k, 0, 1) * Math.PI) * 0.05 : 0,
      };
    }
    return idle;
  }

  function scheduleSmile(from) {
    return {
      t0: from + 8 + exp01() * 8,
      dur: 0.5 + rand() * 0.7,
      amp: 0.62 + rand() * 0.28,
    };
  }

  function sampleSmileBump() {
    if (!smileEv || time < smileEv.t0) return 0;
    const k = (time - smileEv.t0) / smileEv.dur;
    if (k >= 1) return -1;
    return Math.sin(k * Math.PI) * smileEv.amp;
  }

  function catchUp(finished, schedule) {
    for (let i = 0; i < 24; i += 1) {
      if (!finished()) return;
      schedule();
    }
  }

  function reseed(n) {
    const v = Number(n);
    rand = mulberry32(Number.isFinite(v) ? v >>> 0 : 1);
    time = 0;
    pendingJump = 0;
    yawWaves = makeWaves(0.16);
    pitchWaves = makeWaves(0.07);
    rollWaves = makeWaves(0.09);
    gazeWaves = makeWaves(0.05);
    smileWaves = makeWaves(0.14);
    shoulderWaves = makeWaves(0.035);
    look = scheduleLook(0);
    armLookBlink(look);
    blink = scheduleBlink(rand() * 0.8);
    saccade = scheduleSaccade(0.25 + rand() * 0.4, null);
    talk = buildBurst(4 + exp01() * 8);
    smileEv = scheduleSmile(0);
    bounceAt = 6 + rand() * 8;
  }

  function seed(n) {
    reseed(n);
  }

  function step(dt) {
    const d = clamp(Number(dt) || 0, 0, 0.05);
    time += d;
    pendingJump = 0;

    catchUp(() => look && time >= lookEnd(look), () => {
      look = scheduleLook(lookEnd(look));
      armLookBlink(look);
    });
    const lookNow = sampleLook() || {
      yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0, gazeK: 0, fireBlink: false,
    };
    if (lookNow.fireBlink) nudgeBlink();

    catchUp(() => blink && time >= blink.t0 + blinkSpan(blink), () => {
      blink = scheduleBlink(blink.t0 + blinkSpan(blink));
    });
    const blinkV = Math.max(0, blinkLevel(blink));

    catchUp(() => saccade && time >= saccade.until, () => {
      saccade = scheduleSaccade(saccade.until, saccade);
    });
    const sac = sampleSaccade();

    catchUp(() => talk && time >= talk.end, () => {
      talk = buildBurst(talk.end + 4 + exp01() * 8);
    });
    const mouth = sampleTalk() || { jaw: 0, funnel: 0, pucker: 0, smile: 0, nod: 0 };

    catchUp(() => smileEv && time >= smileEv.t0 + smileEv.dur, () => {
      smileEv = scheduleSmile(smileEv.t0 + smileEv.dur);
    });
    const bump = sampleSmileBump();
    let smile = clamp(0.35 + sampleWaves(smileWaves), 0.2, 0.5);
    if (bump > 0) smile = Math.max(smile, bump);
    smile = clamp(smile + mouth.smile, 0, 1.2);

    if (time >= bounceAt) {
      pendingJump = 0.32 + rand() * 0.16;
      bounceAt = time + 6 + rand() * 8;
    }

    const damp = lookNow.gazeK > 0.25 ? 0.22 : 1;
    return {
      jump: pendingJump,
      targets: {
        mode: 'showcase',
        face: true,
        pose: false,
        yaw: clamp(sampleWaves(yawWaves) + lookNow.yaw, -1.25, 1.25),
        pitch: clamp(sampleWaves(pitchWaves) + lookNow.pitch + mouth.nod, -1.25, 1.25),
        roll: clamp(sampleWaves(rollWaves) + lookNow.roll, -1, 1),
        gazeX: clamp(lookNow.gx + sac.x * damp + sampleWaves(gazeWaves), -1.2, 1.2),
        gazeY: clamp(lookNow.gy + sac.y * damp, -1.2, 1.2),
        blinkL: blinkV,
        blinkR: blinkV,
        jaw: clamp(mouth.jaw, 0, 1.5),
        funnel: clamp(mouth.funnel, 0, 1.5),
        pucker: 0,
        smile,
        wristUp: 0,
        heartRot: 0,
        shoulderTilt: clamp(sampleWaves(shoulderWaves), -0.08, 0.08),
      },
    };
  }

  reseed(1);
  return { step, seed };
}
