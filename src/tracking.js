import {
  FilesetResolver,
  FaceLandmarker,
  PoseLandmarker,
  DrawingUtils,
} from '@mediapipe/tasks-vision';

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
  camera: 'Cámara activa. El avatar te sigue en espejo.',
  cpu: 'Cámara activa. Seguimiento en CPU.',
  denied: 'Permiso de cámara denegado. Puedes usar el modo demo.',
  missing: 'No se encontró ninguna cámara. Modo demo activo.',
  insecure: 'Se necesita un contexto seguro (HTTPS o localhost) para usar la cámara.',
  unsupported: 'Este navegador no permite el acceso a la cámara.',
  demo: 'Modo demo: mueve el ratón para orientar la cabeza y la mirada.',
  stopped: 'Cámara detenida. Modo demo activo.',
  modelsFail: 'No se pudieron cargar los modelos. Revisa la conexión. Modo demo activo.',
  busy: 'No se pudo abrir la cámara. Puede estar en uso por otra aplicación.',
  starting: 'Activando cámara…',
};

const POSE_L_SHOULDER = 11;
const POSE_R_SHOULDER = 12;
const POSE_L_ELBOW = 13;
const POSE_R_ELBOW = 14;
const POSE_L_WRIST = 15;
const POSE_R_WRIST = 16;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function mirrorPoint(p) {
  if (!p) return null;
  return { x: 1 - p.x, y: p.y, visibility: p.visibility, presence: p.presence };
}

export function pointOk(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  if (typeof p.visibility === 'number' && p.visibility < 0.5) return false;
  if (typeof p.presence === 'number' && p.presence < 0.5) return false;
  return true;
}

/** Vector "hacia abajo" perpendicular a la línea de hombros (espacio ya espejado, y hacia abajo). */
export function shoulderDown(sL, sR) {
  const sdx = sR.x - sL.x;
  const sdy = sR.y - sL.y;
  const x = -sdy;
  const y = sdx;
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/**
 * Ángulo de canvas (horario positivo) desde el vector A hasta el vector B.
 * Con A apuntando abajo del brazo, el resultado es la rotación del hueso.
 */
export function angleBetween(ax, ay, bx, by) {
  const dot = ax * bx + ay * by;
  const det = ax * by - ay * bx;
  return Math.atan2(det, dot);
}

export function limbAngles(shoulder, elbow, wrist, down) {
  const ux = elbow.x - shoulder.x;
  const uy = elbow.y - shoulder.y;
  const fx = wrist.x - elbow.x;
  const fy = wrist.y - elbow.y;
  if (Math.hypot(ux, uy) < 0.02 || Math.hypot(fx, fy) < 0.02) {
    return { ok: false, upper: 0, fore: 0 };
  }
  return {
    ok: true,
    upper: angleBetween(down.x, down.y, ux, uy),
    fore: angleBetween(ux, uy, fx, fy),
  };
}

export function poseToArms(landmarks) {
  const empty = { okL: false, okR: false, upperL: 0, foreL: 0, upperR: 0, foreR: 0 };
  if (!landmarks || landmarks.length < 17) return empty;
  const rawSL = landmarks[POSE_L_SHOULDER];
  const rawSR = landmarks[POSE_R_SHOULDER];
  if (!pointOk(rawSL) || !pointOk(rawSR)) return empty;
  const sL = mirrorPoint(rawSL);
  const sR = mirrorPoint(rawSR);
  const down = shoulderDown(sL, sR);

  const rawEL = landmarks[POSE_L_ELBOW];
  const rawWL = landmarks[POSE_L_WRIST];
  const rawER = landmarks[POSE_R_ELBOW];
  const rawWR = landmarks[POSE_R_WRIST];

  let left = { ok: false, upper: 0, fore: 0 };
  let right = { ok: false, upper: 0, fore: 0 };
  if (pointOk(rawEL) && pointOk(rawWL)) {
    left = limbAngles(sL, mirrorPoint(rawEL), mirrorPoint(rawWL), down);
  }
  if (pointOk(rawER) && pointOk(rawWR)) {
    right = limbAngles(sR, mirrorPoint(rawER), mirrorPoint(rawWR), down);
  }
  return {
    okL: left.ok,
    okR: right.ok,
    upperL: left.upper,
    foreL: left.fore,
    upperR: right.upper,
    foreR: right.fore,
  };
}

export function blendMap(faceResult) {
  const cats = faceResult?.faceBlendshapes?.[0]?.categories;
  const map = Object.create(null);
  if (!cats) return map;
  for (const c of cats) map[c.categoryName] = c.score || 0;
  return map;
}

export function eulerFromMatrix(data) {
  if (!data || data.length < 16) return null;
  const r00 = data[0];
  const r10 = data[1];
  const r20 = data[2];
  const r21 = data[6];
  const r22 = data[10];
  if (![r00, r10, r20, r21, r22].every(Number.isFinite)) return null;
  const pitch = Math.atan2(r21, r22);
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22));
  const roll = Math.atan2(r10, r00);
  if (![pitch, yaw, roll].every(Number.isFinite)) return null;
  return { pitch, yaw, roll };
}

/** Yaw/pitch/roll en radianes, ya en convención de espejo (positivo = hacia la derecha de la pantalla). */
export function headFromLandmarks(lm, memory) {
  if (!lm || lm.length < 468) return null;
  const leftEye = lm[33];
  const rightEye = lm[263];
  const nose = lm[1];
  const forehead = lm[10];
  const chin = lm[152];
  if (!leftEye || !rightEye || !nose || !forehead || !chin) return null;

  const inter = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y) || 1e-4;
  const midX = (leftEye.x + rightEye.x) / 2;
  const midY = (leftEye.y + rightEye.y) / 2;
  const roll = -Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x);
  const yaw = -Math.atan2(nose.x - midX, inter * 0.85);

  const faceH = Math.hypot(chin.x - forehead.x, chin.y - forehead.y) || 1e-4;
  const noseV = (nose.y - midY) / faceH;
  if (memory && memory.pitchCount < 40 && Math.abs(yaw) < 0.2 && Math.abs(roll) < 0.18) {
    memory.pitchBase = memory.pitchBase == null ? noseV : memory.pitchBase * 0.9 + noseV * 0.1;
    memory.pitchCount += 1;
  }
  const base = memory?.pitchBase ?? 0.2;
  const pitch = clamp(-(noseV - base) * 3.5, -0.85, 0.85);
  return {
    yaw: clamp(yaw, -1.05, 1.05),
    pitch,
    roll: clamp(roll, -0.8, 0.8),
  };
}

function alignAxis(matrixVal, landmarkVal) {
  if (matrixVal == null || !Number.isFinite(matrixVal) || Math.abs(matrixVal) > 2.3) return landmarkVal;
  let m = matrixVal;
  if (Math.abs(landmarkVal) > 0.1 && Math.abs(m) > 0.08 && Math.sign(m) !== Math.sign(landmarkVal)) {
    m = -m;
  }
  if (Math.abs(landmarkVal) > 0.22 && Math.abs(m) < Math.abs(landmarkVal) * 0.35) return landmarkVal;
  return m;
}

export function headFromFace(faceResult, memory) {
  const lm = faceResult?.faceLandmarks?.[0];
  const fromLm = headFromLandmarks(lm, memory);
  const raw = faceResult?.facialTransformationMatrixes?.[0]?.data;
  const mat = eulerFromMatrix(raw);
  if (!fromLm) {
    if (!mat) return null;
    return {
      yaw: clamp(-mat.yaw, -1.05, 1.05),
      pitch: clamp(mat.pitch, -0.85, 0.85),
      roll: clamp(-mat.roll, -0.8, 0.8),
    };
  }
  if (!mat) return fromLm;
  return {
    yaw: clamp(alignAxis(mat.yaw, fromLm.yaw), -1.05, 1.05),
    pitch: clamp(alignAxis(mat.pitch, fromLm.pitch), -0.85, 0.85),
    roll: clamp(alignAxis(mat.roll, fromLm.roll), -0.8, 0.8),
  };
}

function score(map, name) {
  return map[name] || 0;
}

/** Objetivos sin suavizar. El espejo hace coincidir el lado de la persona con el lado de la pantalla. */
export function targetsFromResults(faceResult, poseResult, memory) {
  const blends = blendMap(faceResult);
  const head = headFromFace(faceResult, memory);
  const faceTracked = Boolean(head);
  const arms = poseToArms(poseResult?.landmarks?.[0]);
  const poseTracked = arms.okL || arms.okR;

  const blinkL = score(blends, 'eyeBlinkLeft');
  const blinkR = score(blends, 'eyeBlinkRight');
  const gazeLX = score(blends, 'eyeLookInLeft') - score(blends, 'eyeLookOutLeft');
  const gazeRX = score(blends, 'eyeLookOutRight') - score(blends, 'eyeLookInRight');
  const gazeLY = score(blends, 'eyeLookUpLeft') - score(blends, 'eyeLookDownLeft');
  const gazeRY = score(blends, 'eyeLookUpRight') - score(blends, 'eyeLookDownRight');

  return {
    mode: faceTracked ? 'track' : 'idle',
    face: faceTracked,
    pose: poseTracked,
    yaw: head?.yaw ?? 0,
    pitch: head?.pitch ?? 0,
    roll: head?.roll ?? 0,
    blinkL,
    blinkR,
    gazeLX,
    gazeLY,
    gazeRX,
    gazeRY,
    jaw: score(blends, 'jawOpen'),
    pucker: Math.max(score(blends, 'mouthFunnel'), score(blends, 'mouthPucker')),
    smileL: score(blends, 'mouthSmileLeft'),
    smileR: score(blends, 'mouthSmileRight'),
    browIn: score(blends, 'browInnerUp'),
    browDL: Math.max(0, score(blends, 'browDownLeft') - score(blends, 'browOuterUpLeft')),
    browDR: Math.max(0, score(blends, 'browDownRight') - score(blends, 'browOuterUpRight')),
    armLOk: arms.okL,
    armROk: arms.okR,
    armLU: arms.upperL,
    armLF: arms.foreL,
    armRU: arms.upperR,
    armRF: arms.foreR,
  };
}

export function decorativeTargets(time, demo) {
  if (demo?.active) {
    const gx = clamp((demo.x - 0.5) * 2, -1, 1);
    const gy = clamp((0.5 - demo.y) * 2, -1, 1);
    return {
      mode: 'demo',
      face: false,
      pose: false,
      yaw: gx * 0.62,
      pitch: gy * 0.42,
      roll: gx * 0.08,
      blinkL: 0,
      blinkR: 0,
      gazeLX: gx,
      gazeLY: gy,
      gazeRX: gx,
      gazeRY: gy,
      jaw: 0.02,
      pucker: 0,
      smileL: 0.18,
      smileR: 0.18,
      browIn: 0.08,
      browDL: 0,
      browDR: 0,
      armLOk: false,
      armROk: false,
      armLU: 0,
      armLF: 0,
      armRU: 0,
      armRF: 0,
    };
  }
  return {
    mode: 'idle',
    face: false,
    pose: false,
    yaw: Math.sin(time * 0.55) * 0.2,
    pitch: Math.sin(time * 0.4 + 0.7) * 0.07,
    roll: Math.sin(time * 0.32) * 0.045,
    blinkL: 0,
    blinkR: 0,
    gazeLX: Math.sin(time * 0.48) * 0.35,
    gazeLY: Math.sin(time * 0.36 + 1.2) * 0.22,
    gazeRX: Math.sin(time * 0.48) * 0.35,
    gazeRY: Math.sin(time * 0.36 + 1.2) * 0.22,
    jaw: 0.015,
    pucker: 0,
    smileL: 0.14 + Math.sin(time * 0.6) * 0.04,
    smileR: 0.14 + Math.sin(time * 0.6) * 0.04,
    browIn: 0.06,
    browDL: 0,
    browDR: 0,
    armLOk: false,
    armROk: false,
    armLU: 0,
    armLF: 0,
    armRU: 0,
    armRF: 0,
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
    try { face?.close?.(); } catch { /* ya falló la creación */ }
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
  const memory = { pitchBase: null, pitchCount: 0 };

  function status(msg) {
    if (onStatus) onStatus(msg);
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
      memory.pitchBase = null;
      memory.pitchCount = 0;
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
    stopStream();
    lastFace = null;
    lastPose = null;
    status(MSG.stopped);
  }

  function nextTimestamp() {
    const now = performance.now();
    clock = Math.max(now, clock + 0.1);
    return clock;
  }

  function consumeFrame() {
    if (!running || !face || !pose || falling) return null;
    if (video.readyState < 2 || !video.videoWidth) return null;
    if (video.currentTime === lastVideoTime) {
      return {
        fresh: false,
        face: lastFace,
        pose: lastPose,
        targets: targetsFromResults(lastFace, lastPose, memory),
      };
    }
    lastVideoTime = video.currentTime;
    const ts = nextTimestamp();
    try {
      lastFace = face.detectForVideo(video, ts);
      lastPose = pose.detectForVideo(video, ts);
    } catch (err) {
      console.warn(err);
      if (delegate === 'GPU') void fallbackToCpu();
      return {
        fresh: false,
        face: lastFace,
        pose: lastPose,
        targets: targetsFromResults(lastFace, lastPose, memory),
      };
    }
    return {
      fresh: true,
      face: lastFace,
      pose: lastPose,
      targets: targetsFromResults(lastFace, lastPose, memory),
    };
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
        color: 'rgba(62,207,196,0.22)',
        lineWidth: 0.6,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
        color: '#3ecfc4',
        lineWidth: 1.2,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
        color: '#ffe27a',
        lineWidth: 1.2,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
        color: '#ffe27a',
        lineWidth: 1.2,
      });
      drawing.drawConnectors(faceLm, FaceLandmarker.FACE_LANDMARKS_LIPS, {
        color: '#ff8fb8',
        lineWidth: 1.2,
      });
    }
    const poseLm = lastPose?.landmarks?.[0];
    if (poseLm) {
      drawing.drawConnectors(poseLm, PoseLandmarker.POSE_CONNECTIONS, {
        color: '#ff7ad9',
        lineWidth: 2,
      });
      drawing.drawLandmarks(poseLm, { color: '#ffffff', radius: 3, lineWidth: 1 });
    }
  }

  function destroy() {
    stop();
    try { face?.close?.(); } catch { /* noop */ }
    try { pose?.close?.(); } catch { /* noop */ }
    face = null;
    pose = null;
  }

  return {
    ensureModels,
    start,
    stop,
    destroy,
    consumeFrame,
    drawDebug,
    isRunning: () => running,
    getDelegate: () => delegate,
  };
}
