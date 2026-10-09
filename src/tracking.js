import {
  FilesetResolver,
  FaceLandmarker,
  PoseLandmarker,
  DrawingUtils,
} from '@mediapipe/tasks-vision';
import {
  AttackRelease,
  JumpRejector,
  OneEuroFilter,
  clamp,
  expApproach,
  finite,
} from './filters.js';

/** Coincide con @mediapipe/tasks-vision instalado (1.1.0). */
export const MP_VERSION = '1.1.0';
export const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
export const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const MSG = {
  loading: 'Cargando modelos de seguimiento…',
  ready: 'Modelos listos. Pulsa «Activar cámara».',
  camera: 'Cámara activa. El avatar copia tu cara.',
  cpu: 'Cámara activa. Seguimiento en CPU.',
  denied: 'Permiso de cámara denegado. Puedes usar el modo demo.',
  missing: 'No se encontró ninguna cámara. Modo demo activo.',
  insecure: 'Se necesita un contexto seguro (HTTPS o localhost) para usar la cámara.',
  unsupported: 'Este navegador no permite el acceso a la cámara.',
  demo: 'Modo demo: mueve el ratón para la cabeza y la mirada. Mantén pulsado para abrir la boca.',
  stopped: 'Cámara detenida. Modo demo activo.',
  modelsFail: 'No se pudieron cargar los modelos. Revisa la conexión. Modo demo activo.',
  busy: 'No se pudo abrir la cámara. Puede estar en uso por otra aplicación.',
  starting: 'Activando cámara…',
  calibrating: 'Calibrando… mira al frente, con la cara relajada.',
};

const POSE_L_SHOULDER = 11;
const POSE_R_SHOULDER = 12;
const POSE_L_WRIST = 15;
const POSE_R_WRIST = 16;
const SHOULDER_LIMIT = (5 * Math.PI) / 180;

const CALIB_KEYS = ['yaw', 'pitch', 'roll', 'jaw', 'blinkL', 'blinkR', 'smile'];

function zeroBaseline() {
  return { yaw: 0, pitch: 0, roll: 0, jaw: 0, blinkL: 0, blinkR: 0, smile: 0 };
}

/**
 * Extrae yaw/pitch/roll de la matriz facial 4×4 column-major.
 * r00=d[0] r10=d[1] r20=d[2] r01=d[4] r11=d[5] r21=d[6] r02=d[8] r12=d[9] r22=d[10]
 * yaw = asin(clamp(-r20)), pitch = atan2(r21, r22), roll = atan2(r10, r00).
 *
 * Espejo: la matriz está en la imagen de la cámara SIN voltear. La vista previa
 * se dibuja con scaleX(-1), como un espejo. Si la persona gira la cabeza hacia
 * SU derecha, en esa vista previa el giro se lee hacia la izquierda de la pantalla.
 * Por eso, con mirror activo, se invierten yaw y roll (el pitch no: arriba sigue
 * siendo arriba). Con el espejo apagado se dejan los signos de la imagen cruda.
 */
export function headEulerFromMatrix(data, mirror) {
  if (!data || data.length < 16) return null;
  const r00 = data[0];
  const r10 = data[1];
  const r20 = data[2];
  const r21 = data[6];
  const r22 = data[10];
  if (![r00, r10, r20, r21, r22].every(Number.isFinite)) return null;
  let yaw = Math.asin(clamp(-r20, -1, 1));
  let pitch = Math.atan2(r21, r22);
  let roll = Math.atan2(r10, r00);
  if (![yaw, pitch, roll].every(Number.isFinite)) return null;
  if (mirror) {
    yaw = -yaw;
    roll = -roll;
  }
  return { yaw, pitch, roll };
}

function blendMap(faceResult) {
  const cats = faceResult?.faceBlendshapes?.[0]?.categories;
  const map = Object.create(null);
  if (!cats) return map;
  for (const c of cats) map[c.categoryName || c.displayName] = c.score || 0;
  return map;
}

function score(map, name) {
  const v = map[name];
  return Number.isFinite(v) ? v : 0;
}

function dist2(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointOk(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  if (typeof p.visibility === 'number' && !(p.visibility > 0.5)) return false;
  return true;
}

/**
 * MediaPipe nombra el parpadeo desde la persona (eyeBlinkLeft = su ojo izquierdo).
 * Con espejo, su izquierda cae a la izquierda de la pantalla (eye_l).
 * Sin espejo, la imagen cruda pone su izquierda a la derecha de la pantalla.
 */
function screenBlinks(blends, mirror) {
  const blinkRight = score(blends, 'eyeBlinkRight');
  const blinkLeft = score(blends, 'eyeBlinkLeft');
  if (mirror) return { blinkL: blinkLeft, blinkR: blinkRight };
  return { blinkL: blinkRight, blinkR: blinkLeft };
}

const BLINK_CLOSED_REF = 0.75;
const BLINK_OPEN_INIT = 0.08;

/** Línea base de ojo abierto: sube despacio (0.05/s) y baja más rápido (0.5/s). */
function followOpen(base, raw, dt) {
  if (!(raw < base + 0.12)) return base;
  const rate = raw > base ? 0.05 : 0.5;
  const step = rate * Math.max(0, dt);
  const delta = raw - base;
  if (delta > step) return base + step;
  if (delta < -step) return base - step;
  return base + delta;
}

function normBlink(raw, base) {
  const denom = Math.max(0.3, BLINK_CLOSED_REF - base);
  return clamp((raw - base) / denom, 0, 1);
}

function pole(prev, x, dt, tau) {
  const a = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-4, tau));
  const y = prev + (x - prev) * a;
  return Number.isFinite(y) ? y : x;
}

/**
 * Zona muerta y histéresis. Cerrado = 1. Abierto = guiño parcial, nunca cierre total.
 * `v` ya va multiplicado por la sensibilidad.
 */
function shapeBlink(v, closed) {
  const x = v < 0.2 ? 0 : v;
  let next = closed;
  if (!closed && x > 0.62) next = true;
  else if (closed && x < 0.38) next = false;
  if (next) return { closed: true, out: 1 };
  return { closed: false, out: clamp((x - 0.2) / 0.6, 0, 1) * 0.45 };
}

function irisGazeX(lm, iris, c1, c2) {
  if (!lm || !lm[iris] || !lm[c1] || !lm[c2]) return null;
  const lo = Math.min(lm[c1].x, lm[c2].x);
  const hi = Math.max(lm[c1].x, lm[c2].x);
  const span = hi - lo;
  if (!(span > 1e-4)) return 0;
  const t = (lm[iris].x - lo) / span;
  return (t - 0.5) * 2;
}

function rawGaze(lm, blends, mirror) {
  const g468 = irisGazeX(lm, 468, 33, 133);
  const g473 = irisGazeX(lm, 473, 362, 263);
  let gazeX;
  if (g468 == null && g473 == null) {
    const left = score(blends, 'eyeLookInLeft') - score(blends, 'eyeLookOutLeft');
    const right = score(blends, 'eyeLookOutRight') - score(blends, 'eyeLookInRight');
    gazeX = (left + right) / 2;
  } else {
    const a = g468 ?? g473;
    const b = g473 ?? g468;
    gazeX = (a + b) / 2;
  }
  if (mirror) gazeX = -gazeX;
  const up = (score(blends, 'eyeLookUpLeft') + score(blends, 'eyeLookUpRight')) / 2;
  const down = (score(blends, 'eyeLookDownLeft') + score(blends, 'eyeLookDownRight')) / 2;
  const gazeY = (down - up) * 1.6;
  return {
    gazeX: clamp(gazeX * 1.8, -1, 1),
    gazeY: clamp(gazeY, -1, 1),
  };
}

function tuneEuro(filter, minCutoff, beta, smoothing) {
  const s = clamp(finite(smoothing, 0.35), 0, 1);
  const scale = 1.7 - 1.25 * s;
  filter.minCutoff = minCutoff * scale;
  filter.beta = beta * (1.3 - 0.7 * s);
  filter.dCutoff = 1;
}

function mouthRates(smoothing) {
  const s = clamp(finite(smoothing, 0.35), 0, 1);
  return {
    mouthAttack: 55 - 30 * s,
    mouthRelease: 16 - 8 * s,
  };
}

function makePointFilter() {
  return {
    jump: new JumpRejector(0.25, 3),
    fx: new OneEuroFilter(1, 0.3, 1),
    fy: new OneEuroFilter(1, 0.3, 1),
    x: null,
    y: null,
  };
}

function readPosePoint(filter, landmark, t, smoothing) {
  if (!pointOk(landmark)) {
    if (filter.x == null) return null;
    return { x: filter.x, y: filter.y };
  }
  tuneEuro(filter.fx, 1, 0.3, smoothing);
  tuneEuro(filter.fy, 1, 0.3, smoothing);
  const gated = filter.jump.push(landmark.x, landmark.y);
  if (!gated.accept) {
    if (filter.x == null) return null;
    return { x: filter.x, y: filter.y };
  }
  if (gated.reset) {
    filter.fx.reset();
    filter.fy.reset();
  }
  filter.x = filter.fx.filter(gated.x, t);
  filter.y = filter.fy.filter(gated.y, t);
  return { x: filter.x, y: filter.y };
}

function screenX(x, mirror) {
  return mirror ? 1 - x : x;
}

function raiseAmount(wrist, shoulder) {
  if (!wrist || !shoulder) return 0;
  return clamp((shoulder.y - wrist.y) / 0.18, 0, 1);
}

export function decorativeTargets(time, demo, settings) {
  const head = clamp(settings?.sensitivity?.head ?? 1, 0.2, 1.8);
  const mouth = clamp(settings?.sensitivity?.mouth ?? 1, 0.2, 2);
  const t = finite(time, 0);
  if (demo?.active) {
    const gx = clamp((finite(demo.x, 0.5) - 0.5) * 2, -1, 1);
    const gy = clamp((finite(demo.y, 0.5) - 0.5) * 2, -1, 1);
    const flap = Math.sin(t * 16);
    const jaw = demo.down ? (flap > 0 ? 0.78 : 0.32) * Math.min(mouth, 1.5) : 0;
    return {
      mode: 'demo',
      face: false,
      pose: false,
      yaw: clamp(gx * 0.92 * head, -1.25, 1.25),
      pitch: clamp(gy * 0.72 * head, -1.25, 1.25),
      roll: clamp(gx * 0.28 * head, -1, 1),
      blinkL: 0,
      blinkR: 0,
      gazeX: clamp(gx * 0.95, -1, 1),
      gazeY: clamp(gy * 0.85, -1, 1),
      jaw,
      funnel: 0,
      pucker: 0,
      smile: demo.down ? 0.22 : 0.18,
      wristUp: 0,
      heartRot: 0,
      shoulderTilt: 0,
    };
  }
  return {
    mode: 'idle',
    face: false,
    pose: false,
    yaw: clamp(Math.sin(t * 0.7) * 0.16 * head, -1, 1),
    pitch: clamp(Math.sin(t * 0.45 + 0.5) * 0.06 * head, -1, 1),
    roll: clamp(Math.sin(t * 0.33) * 0.22 * head, -1, 1),
    blinkL: 0,
    blinkR: 0,
    gazeX: Math.sin(t * 0.5) * 0.35,
    gazeY: Math.sin(t * 0.37 + 1) * 0.25,
    jaw: 0,
    funnel: 0,
    pucker: 0,
    smile: 0.12,
    wristUp: 0,
    heartRot: 0,
    shoulderTilt: 0,
  };
}

async function createLandmarkers(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  let face = null;
  let pose = null;
  try {
    face = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    return { face, pose, delegate };
  } catch (err) {
    try { face?.close?.(); } catch { /* la creación ya falló */ }
    try { pose?.close?.(); } catch { /* igual */ }
    throw err;
  }
}

function cameraErrorMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return MSG.denied;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return MSG.missing;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return MSG.busy;
  if (name === 'SecurityError') {
    if (typeof window !== 'undefined' && !window.isSecureContext) return MSG.insecure;
    return MSG.denied;
  }
  return MSG.missing;
}

export function createTracker(video, onStatus) {
  let face = null;
  let pose = null;
  let delegate = null;
  let modelPromise = null;
  let stream = null;
  let running = false;
  let lastVideoTime = -1;
  let clock = 0;
  let falling = false;
  let lastFace = null;
  let lastPose = null;
  let drawing = null;
  let frameIndex = 0;
  let lastFilterT = null;
  let output = null;
  let calibArmed = false;
  let heldEuler = null;
  let heldEulerAt = 0;
  let shoulderTarget = 0;
  let wristTarget = 0;
  let heartTarget = 0;
  let shouldersOk = false;
  let wristsOk = false;

  const yawF = new OneEuroFilter(1.2, 0.6, 1);
  const pitchF = new OneEuroFilter(1.2, 0.6, 1);
  const rollF = new OneEuroFilter(1.2, 0.6, 1);
  const gazeXF = new OneEuroFilter(1.5, 1, 1);
  const gazeYF = new OneEuroFilter(1.5, 1, 1);
  const blinkLF = new AttackRelease(45, 18);
  const blinkRF = new AttackRelease(45, 18);
  let openL = BLINK_OPEN_INIT;
  let openR = BLINK_OPEN_INIT;
  let nSmoothL = 0;
  let nSmoothR = 0;
  let winkHold = 0;
  let eyeClosedL = false;
  let eyeClosedR = false;
  const jawF = new AttackRelease(48, 14);
  const funnelF = new AttackRelease(48, 14);
  const puckerF = new AttackRelease(48, 14);
  const smileF = new AttackRelease(36, 12);

  const shoulderL = makePointFilter();
  const shoulderR = makePointFilter();
  const wristL = makePointFilter();
  const wristR = makePointFilter();

  let wristUpSm = 0;
  let heartRotSm = 0;
  let shoulderSm = 0;

  const calib = {
    collecting: false,
    startedAt: 0,
    samples: [],
    base: zeroBaseline(),
  };

  function status(msg) {
    if (onStatus) onStatus(msg);
  }

  function resetFilters() {
    yawF.reset();
    pitchF.reset();
    rollF.reset();
    gazeXF.reset();
    gazeYF.reset();
    blinkLF.reset(0);
    blinkRF.reset(0);
    openL = BLINK_OPEN_INIT;
    openR = BLINK_OPEN_INIT;
    nSmoothL = 0;
    nSmoothR = 0;
    winkHold = 0;
    eyeClosedL = false;
    eyeClosedR = false;
    jawF.reset(0);
    funnelF.reset(0);
    puckerF.reset(0);
    smileF.reset(0);
    for (const p of [shoulderL, shoulderR, wristL, wristR]) {
      p.jump.reset();
      p.fx.reset();
      p.fy.reset();
      p.x = null;
      p.y = null;
    }
    wristUpSm = 0;
    heartRotSm = 0;
    shoulderSm = 0;
    shoulderTarget = 0;
    wristTarget = 0;
    heartTarget = 0;
    shouldersOk = false;
    wristsOk = false;
    heldEuler = null;
    heldEulerAt = 0;
    lastFilterT = null;
    output = null;
    frameIndex = 0;
  }

  function beginCalib(now) {
    calib.collecting = true;
    calib.startedAt = now;
    calib.samples = [];
  }

  function finishCalib() {
    calib.collecting = false;
    const samples = calib.samples;
    calib.samples = [];
    if (samples.length < 8) return;
    const next = zeroBaseline();
    for (const key of CALIB_KEYS) {
      let sum = 0;
      for (const sample of samples) sum += sample[key];
      next[key] = sum / samples.length;
    }
    calib.base = next;
    openL = next.blinkL;
    openR = next.blinkR;
  }

  function ensureModels() {
    if (face && pose) return Promise.resolve(delegate);
    if (!modelPromise) {
      modelPromise = (async () => {
        try {
          const built = await createLandmarkers('GPU');
          face = built.face;
          pose = built.pose;
          delegate = built.delegate;
        } catch (gpuErr) {
          console.warn('Delegado GPU no disponible, se usa CPU.', gpuErr);
          const built = await createLandmarkers('CPU');
          face = built.face;
          pose = built.pose;
          delegate = built.delegate;
        }
        return delegate;
      })().catch((err) => {
        modelPromise = null;
        face = null;
        pose = null;
        throw err;
      });
    }
    return modelPromise;
  }

  async function fallbackToCpu() {
    if (falling || delegate === 'CPU') return;
    falling = true;
    try {
      try { face?.close?.(); } catch { /* noop */ }
      try { pose?.close?.(); } catch { /* noop */ }
      face = null;
      pose = null;
      const built = await createLandmarkers('CPU');
      face = built.face;
      pose = built.pose;
      delegate = 'CPU';
      if (running) status(MSG.cpu);
    } catch (err) {
      console.warn(err);
      status(MSG.modelsFail);
    } finally {
      falling = false;
    }
  }

  async function openCamera() {
    const attempts = [
      { video: { width: 640, height: 480, facingMode: 'user' }, audio: false },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.name === 'SecurityError') {
          throw err;
        }
      }
    }
    throw lastErr || new Error('camera');
  }

  async function start() {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      status(MSG.insecure);
      return { ok: false, message: MSG.insecure };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status(MSG.unsupported);
      return { ok: false, message: MSG.unsupported };
    }
    status(MSG.starting);
    try {
      status(MSG.loading);
      await ensureModels();
    } catch (err) {
      console.warn(err);
      status(MSG.modelsFail);
      return { ok: false, message: MSG.modelsFail };
    }
    try {
      const next = await openCamera();
      stopStream();
      stream = next;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      running = true;
      lastVideoTime = -1;
      lastFace = null;
      lastPose = null;
      resetFilters();
      calib.base = zeroBaseline();
      calib.collecting = false;
      calibArmed = true;
      const msg = delegate === 'CPU' ? MSG.cpu : MSG.camera;
      status(msg);
      return { ok: true, message: msg };
    } catch (err) {
      console.warn(err);
      const message = cameraErrorMessage(err);
      status(message);
      return { ok: false, message };
    }
  }

  function stopStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function stop() {
    running = false;
    calibArmed = false;
    calib.collecting = false;
    stopStream();
    lastFace = null;
    lastPose = null;
    resetFilters();
    status(MSG.stopped);
  }

  function nextTimestamp() {
    const now = performance.now();
    clock = Math.max(now, clock + 0.1);
    return clock;
  }

  function buildTargets(settings, now, poseFresh) {
    const mirror = settings?.mirror !== false;
    const smoothing = clamp(settings?.smoothing ?? 0.35, 0, 1);
    const headAmt = clamp(settings?.sensitivity?.head ?? 1, 0.2, 1.8);
    const mouthAmt = clamp(settings?.sensitivity?.mouth ?? 1, 0.2, 2);
    const blinkAmt = clamp(settings?.sensitivity?.blink ?? 1, 0.2, 2);
    const rates = mouthRates(smoothing);

    const lm = lastFace?.faceLandmarks?.[0] || null;
    const blends = blendMap(lastFace);
    const faceTracked = Boolean(lm && lm.length > 200);
    const mat = lastFace?.facialTransformationMatrixes?.[0]?.data;
    let euler = faceTracked ? headEulerFromMatrix(mat, mirror) : null;
    if (euler) {
      heldEuler = euler;
      heldEulerAt = now;
    } else if (faceTracked && heldEuler && now - heldEulerAt < 0.45) {
      euler = heldEuler;
    } else if (!faceTracked) {
      heldEuler = null;
    }

    let yawRaw = 0;
    let pitchRaw = 0;
    let rollRaw = 0;
    let jawRaw = 0;
    let funnelRaw = 0;
    let puckerRaw = 0;
    let smileRaw = 0;
    let blinkRawL = 0;
    let blinkRawR = 0;
    let gazeRaw = { gazeX: 0, gazeY: 0 };

    if (faceTracked) {
      if (euler) {
        yawRaw = euler.yaw;
        pitchRaw = euler.pitch;
        rollRaw = euler.roll;
      }
      jawRaw = score(blends, 'jawOpen');
      funnelRaw = score(blends, 'mouthFunnel');
      puckerRaw = score(blends, 'mouthPucker');
      smileRaw = (score(blends, 'mouthSmileLeft') + score(blends, 'mouthSmileRight')) / 2;
      const blinks = screenBlinks(blends, mirror);
      blinkRawL = blinks.blinkL;
      blinkRawR = blinks.blinkR;
      gazeRaw = rawGaze(lm, blends, mirror);
    }

    if (calib.collecting && faceTracked) {
      calib.samples.push({
        yaw: yawRaw,
        pitch: pitchRaw,
        roll: rollRaw,
        jaw: jawRaw,
        blinkL: blinkRawL,
        blinkR: blinkRawR,
        smile: smileRaw,
      });
    }

    const base = calib.base;
    const dt = lastFilterT == null ? 1 / 60 : clamp(now - lastFilterT, 1 / 240, 0.1);
    lastFilterT = now;

    tuneEuro(yawF, 1.2, 0.6, smoothing);
    tuneEuro(pitchF, 1.2, 0.6, smoothing);
    tuneEuro(rollF, 1.2, 0.6, smoothing);
    tuneEuro(gazeXF, 1.5, 1, smoothing);
    tuneEuro(gazeYF, 1.5, 1, smoothing);

    const yawRad = yawF.filter(yawRaw, now);
    const pitchRad = pitchF.filter(pitchRaw, now);
    const rollRad = rollF.filter(rollRaw, now);
    const gazeX = gazeXF.filter(faceTracked ? gazeRaw.gazeX : 0, now);
    const gazeY = gazeYF.filter(faceTracked ? gazeRaw.gazeY : 0, now);

    blinkLF.attack = 45;
    blinkLF.release = 18;
    blinkRF.attack = 45;
    blinkRF.release = 18;
    jawF.attack = rates.mouthAttack;
    jawF.release = rates.mouthRelease;
    funnelF.attack = rates.mouthAttack;
    funnelF.release = rates.mouthRelease;
    puckerF.attack = rates.mouthAttack;
    puckerF.release = rates.mouthRelease;
    smileF.attack = rates.mouthAttack * 0.8;
    smileF.release = rates.mouthRelease;

    const jawOpen = Math.max(0, jawRaw - base.jaw);
    const jawTarget = clamp((jawOpen * 1.6 - 0.04) * mouthAmt, 0, 1.5);
    const funnelTarget = clamp(funnelRaw * 1.4 * mouthAmt, 0, 1.5);
    const puckerTarget = clamp(puckerRaw * 1.2 * mouthAmt, 0, 1.5);
    const smileTarget = clamp(Math.max(0, smileRaw - base.smile) * 1.3 * mouthAmt, 0, 1.5);
    if (faceTracked) {
      openL = followOpen(openL, blinkRawL, dt);
      openR = followOpen(openR, blinkRawR, dt);
    }
    const nLraw = faceTracked ? normBlink(blinkRawL, openL) : 0;
    const nRraw = faceTracked ? normBlink(blinkRawR, openR) : 0;
    nSmoothL = pole(nSmoothL, nLraw, dt, 0.025);
    nSmoothR = pole(nSmoothR, nRraw, dt, 0.025);
    const nL = nSmoothL;
    const nR = nSmoothR;
    const wink = Math.abs(nL - nR) > 0.5 && Math.max(nL, nR) > 0.75;
    if (settings?.independentWink === true && faceTracked && wink) winkHold += dt;
    else winkHold = 0;
    let linkL;
    let linkR;
    if (settings?.independentWink === true && winkHold >= 0.12) {
      const lo = Math.min(nL, nR);
      if (nL >= nR) {
        linkL = nL;
        linkR = lo;
      } else {
        linkR = nR;
        linkL = lo;
      }
    } else {
      const linked = (nL + nR) / 2;
      linkL = linked;
      linkR = linked;
    }
    const shapedL = shapeBlink(linkL * blinkAmt, eyeClosedL);
    const shapedR = shapeBlink(linkR * blinkAmt, eyeClosedR);
    eyeClosedL = shapedL.closed;
    eyeClosedR = shapedR.closed;

    const jaw = jawF.update(faceTracked ? jawTarget : 0, dt);
    const funnel = funnelF.update(faceTracked ? funnelTarget : 0, dt);
    const pucker = puckerF.update(faceTracked ? puckerTarget : 0, dt);
    const smile = smileF.update(faceTracked ? smileTarget : 0, dt);
    const blinkL = blinkLF.update(faceTracked ? shapedL.out : 0, dt);
    const blinkR = blinkRF.update(faceTracked ? shapedR.out : 0, dt);

    const yawN = clamp(clamp((yawRad - base.yaw) / 0.6, -1, 1) * headAmt, -1.25, 1.25);
    const pitchN = clamp(clamp((pitchRad - base.pitch) / 0.45, -1, 1) * headAmt, -1.25, 1.25);
    const rollN = clamp(clamp((rollRad - base.roll) / 0.5, -1, 1) * headAmt, -1.25, 1.25);

    if (poseFresh) {
      const poseLm = lastPose?.landmarks?.[0] || null;
      const sL = readPosePoint(shoulderL, poseLm?.[POSE_L_SHOULDER], now, smoothing);
      const sR = readPosePoint(shoulderR, poseLm?.[POSE_R_SHOULDER], now, smoothing);
      const wL = readPosePoint(wristL, poseLm?.[POSE_L_WRIST], now, smoothing);
      const wR = readPosePoint(wristR, poseLm?.[POSE_R_WRIST], now, smoothing);
      shouldersOk = Boolean(pointOk(poseLm?.[POSE_L_SHOULDER]) && pointOk(poseLm?.[POSE_R_SHOULDER]) && sL && sR);
      const wristLOk = Boolean(pointOk(poseLm?.[POSE_L_WRIST]) && wL);
      const wristROk = Boolean(pointOk(poseLm?.[POSE_R_WRIST]) && wR);
      wristsOk = wristLOk || wristROk;
      shoulderTarget = 0;
      wristTarget = 0;
      heartTarget = 0;
      if (shouldersOk) {
        const left = { x: screenX(sL.x, mirror), y: sL.y };
        const right = { x: screenX(sR.x, mirror), y: sR.y };
        const a = left.x <= right.x ? left : right;
        const b = left.x <= right.x ? right : left;
        const span = b.x - a.x;
        shoulderTarget = span > 1e-4
          ? clamp(Math.atan2(b.y - a.y, span), -SHOULDER_LIMIT, SHOULDER_LIMIT)
          : 0;
      }
      if (shouldersOk && wristsOk) {
        const upL = wristLOk ? raiseAmount(wL, sL) : 0;
        const upR = wristROk ? raiseAmount(wR, sR) : 0;
        const n = (wristLOk ? 1 : 0) + (wristROk ? 1 : 0);
        wristTarget = clamp(n > 1 ? (upL + upR) / 2 : Math.max(upL, upR), 0, 1);
        if (wristLOk && wristROk) {
          const wristSpan = screenX(wR.x, mirror) - screenX(wL.x, mirror);
          const shoulderSpan = screenX(sR.x, mirror) - screenX(sL.x, mirror);
          heartTarget = clamp((wristSpan - shoulderSpan) * 1.1, -0.35, 0.35);
        }
      }
    }

    const ease = wristsOk || shouldersOk ? 14 : 6;
    wristUpSm = expApproach(wristUpSm, wristsOk ? wristTarget : 0, ease, dt);
    heartRotSm = expApproach(heartRotSm, wristsOk ? heartTarget : 0, ease, dt);
    shoulderSm = expApproach(shoulderSm, shouldersOk ? shoulderTarget : 0, ease, dt);

    output = {
      mode: 'track',
      face: faceTracked,
      pose: Boolean(shouldersOk || wristsOk),
      yaw: yawN,
      pitch: pitchN,
      roll: rollN,
      blinkL: clamp(blinkL, 0, 1),
      blinkR: clamp(blinkR, 0, 1),
      gazeX: clamp(gazeX, -1.2, 1.2),
      gazeY: clamp(gazeY, -1.2, 1.2),
      jaw: clamp(jaw, 0, 1.5),
      funnel: clamp(funnel, 0, 1.5),
      pucker: clamp(pucker, 0, 1.5),
      smile: clamp(smile, 0, 1.5),
      wristUp: clamp(wristUpSm, 0, 1),
      heartRot: clamp(heartRotSm, -0.4, 0.4),
      shoulderTilt: clamp(shoulderSm, -SHOULDER_LIMIT, SHOULDER_LIMIT),
    };
    return output;
  }

  function consumeFrame(settings) {
    if (!running || !face || !pose || falling) return null;
    if (!video || video.readyState < 2 || !video.videoWidth) return output;
    const now = performance.now() / 1000;
    if (calib.collecting && now - calib.startedAt >= 1.5) finishCalib();
    if (video.currentTime === lastVideoTime) return output;
    lastVideoTime = video.currentTime;
    const ts = nextTimestamp();
    let poseFresh = false;
    try {
      lastFace = face.detectForVideo(video, ts);
      frameIndex += 1;
      if (frameIndex % 2 === 0) {
        lastPose = pose.detectForVideo(video, ts);
        poseFresh = true;
      }
    } catch (err) {
      console.warn(err);
      if (delegate === 'GPU') void fallbackToCpu();
      return output;
    }
    if (calibArmed) {
      calibArmed = false;
      beginCalib(now);
    }
    return buildTargets(settings || {}, now, poseFresh);
  }

  function drawDebug(canvas, enabled) {
    if (!canvas) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      drawing = null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!enabled || !running) return;
    if (!drawing) drawing = new DrawingUtils(ctx);
    const faceLm = lastFace?.faceLandmarks?.[0];
    if (faceLm) {
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
        color: 'rgba(73,198,214,0.22)',
        lineWidth: 0.6,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
        color: '#49c6d6',
        lineWidth: 1.2,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
        color: '#c8e03c',
        lineWidth: 1.2,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
        color: '#c8e03c',
        lineWidth: 1.2,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_LIPS, {
        color: '#f0703c',
        lineWidth: 1.2,
      });
    }
    const poseLm = lastPose?.landmarks?.[0];
    if (poseLm) {
      drawing.drawConnectors(poseLm, PoseLandmarker.POSE_CONNECTIONS, {
        color: '#f0703c',
        lineWidth: 2,
      });
      drawing.drawLandmarks(poseLm, { color: '#fff5dc', radius: 3, lineWidth: 1 });
    }
  }

  function destroy() {
    stop();
    try { face?.close?.(); } catch { /* noop */ }
    try { pose?.close?.(); } catch { /* noop */ }
    face = null;
    pose = null;
  }

  function calibrate() {
    if (!running) return false;
    calibArmed = false;
    beginCalib(performance.now() / 1000);
    return true;
  }

  return {
    ensureModels,
    start,
    stop,
    destroy,
    consumeFrame,
    drawDebug,
    calibrate,
    isCalibrating: () => calib.collecting,
    isRunning: () => running,
    getDelegate: () => delegate,
  };
}
