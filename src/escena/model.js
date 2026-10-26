/* Datos de la escena: comportamientos por capa, adivinados por nombre, y presets de un clic. */

export const BEHAVIORS = [
  ['none', 'Quieto', 'La capa no se mueve sola'],
  ['flotar', 'Flotar', 'Sube y baja suave, como en el aire'],
  ['balanceo', 'Balanceo', 'Se mece con resorte desde su pivote (pasto, orejas, flores)'],
  ['deriva', 'Deriva', 'Viaja de costado y vuelve a entrar por el otro lado'],
  ['brillo', 'Brillo', 'Late su luz: titila y suma un resplandor'],
  ['orbitar', 'Orbitar', 'Da vueltas en círculo u óvalo: alrededor de su lugar, de otra capa (por ejemplo la espada) o de un punto'],
  ['latido', 'Latido', 'Se agranda y achica como si respirara o latiera'],
  ['aparecer', 'Aparecer', 'Aparece y se desvanece (fantasmas, luces, mensajes)'],
  ['recorrido', 'Recorrido', 'Sigue un camino suave que pasa por todas tus claves'],
];

export const EASINGS = [
  ['inout', 'Suave entrada y salida'],
  ['sine', 'Suave'],
  ['back', 'Rebote (se pasa y vuelve)'],
  ['bounce', 'Rebote al caer'],
  ['linear', 'Lineal (velocidad pareja)'],
  ['fluido', 'Fluido (sigue tu mano, para recorridos grabados)'],
  ['step', 'Salto (cambia de golpe)'],
];

export function defaultBase() { return { dx: 0, dy: 0, rot: 0, sc: 1 }; }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const RX = {
  bg: /(fondo|background|^bg|marco|frame|cielo|sky|firma|signature|mascara|mask)/,
  glow: /(brillo|halo|sparkle|estrella|star|glow|destello|chispa|twinkle|sol_estrella)/,
  cloud: /(nube|cloud)/,
  sway: /(oreja|ear|pasto|grass|flor|flower|cola|tail|rama|branch|hoja|leaf|campan|pelo|hair|lazo|cinta)/,
  water: /(agua|water|estanque|pond|salpic|splash|ola|wave)/,
  bunny: /(conejo|bunny|rabbit|personaje|character)/,
  small: /(piedr|stone|roca|rock|resto|debris|luna|moon|sol\b|sun)/,
  fragile: /(conejo|bunny|rabbit|espada|sword|flor|flower)/,
};

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export function defaultPose() { return { dx: 0, dy: 0, rot: 0, sc: 1, op: 1 }; }

/** Comportamiento sugerido según nombre de capa y grupo. `k` multiplica amplitudes. */
export function guessBehavior(layer, scene, k = 1) {
  const n = norm(layer.name);
  const g = norm(layer.group);
  const unit = Math.max(scene.width, scene.height) / 1000;
  const big = layer.w * layer.h > scene.width * scene.height * 0.6;
  const pick = (rx) => rx.test(n) || (!Object.values(RX).some((r) => r.test(n)) && rx.test(g));
  if (big || pick(RX.bg)) {
    if (RX.glow.test(n)) return { type: 'brillo', amp: 0, period: 4, depth: 0.25, glow: 0.35, rot: 0 };
    return { type: 'none', amp: 0, period: 6, rot: 0 };
  }
  if (pick(RX.glow)) {
    // Las luces grandes (sol, halos) laten suave y lento; las chiquitas titilan más.
    const large = layer.w * layer.h > scene.width * scene.height * 0.015;
    return large
      ? { type: 'brillo', amp: 0, period: 5 + hashSeed(n) * 2, depth: 0.15, glow: 0.35, rot: 0 }
      : { type: 'brillo', amp: 0, period: 2 + hashSeed(n) * 2, depth: 0.55, glow: 0.8, rot: 0 };
  }
  if (pick(RX.cloud)) return { type: 'flotar', amp: 7 * unit * k, period: 6, rot: 0.6, stiff: 0.4 };
  if (pick(RX.sway)) return { type: 'balanceo', amp: 4 * k, period: 4, stiff: 0.45, rot: 0 };
  if (pick(RX.water)) return { type: 'flotar', amp: 1.5 * unit * k, period: 5, rot: 0.1 };
  if (pick(RX.bunny)) return { type: 'flotar', amp: 5 * unit * k, period: 5, rot: 0.8 };
  if (pick(RX.small)) return { type: 'flotar', amp: 3 * unit * k, period: 6, rot: 0.5 };
  return { type: 'flotar', amp: 3 * unit * k, period: 6, rot: 0.3 };
}

export function isFragile(layer) {
  return RX.fragile.test(norm(layer.name)) || RX.fragile.test(norm(layer.group).split(' / ').pop() || '');
}

/** Pivote por defecto: abajo al centro del dibujo (para balanceo), centro para lo demás. */
export function defaultPivot(layer, type) {
  if (type === 'balanceo') return { x: layer.x + layer.w / 2, y: layer.y + layer.h * 0.96 };
  return { x: layer.x + layer.w / 2, y: layer.y + layer.h / 2 };
}

export function makeLayerSettings(layer, scene, index) {
  const beh = guessBehavior(layer, scene);
  const seed = hashSeed(`${layer.name}#${index}`);
  return {
    visible: true,
    beh,
    pivot: defaultPivot(layer, beh.type),
    phase: Math.round(seed * 100) / 100,
    poco: false,
    base: defaultBase(),
    keys: [],
    maxMove: Math.max(4, Math.round(Math.max(scene.width, scene.height) * 0.0025)),
    parent: null,
    follow: 0,
    flipX: false,
    flipY: false,
    kf: { on: false, a: defaultPose(), b: defaultPose(), ease: 'inout', period: 0, hold: true },
  };
}

export function makeSceneSettings(scene) {
  const halo = scene.layers.findIndex((l) => /(luna|moon|sol_estrella|sun)/.test(norm(l.name)));
  return {
    duration: 12,
    loop: true,
    fps: 30,
    effects: {
      sparkles: true, density: 40, color: '#fff6d8', size: 1,
      halo: halo >= 0, haloLayer: halo >= 0 ? halo : 0, haloColor: '#ffe9b0', haloStrength: 0.35,
    },
    out: { preset: '1920x1080', fit: 'fit', zoom: 1, panX: 0, panY: 0, bg: '#000000', mbps: 0 },
  };
}

export const PRESETS = [
  ['brisa', 'Brisa suave', 'Pasto, flores y orejas se mecen; nubes flotan; estrellas titilan'],
  ['cielo', 'Flotando en el cielo', 'Todo flota despacito, cada cosa a su ritmo'],
  ['brillos', 'Calma con brillos', 'Casi quieto: sólo brillan las luces y las chispitas'],
  ['quieto', 'Todo quieto', 'Saca todos los movimientos (para empezar de cero)'],
];

export function applyPreset(id, scene, settings) {
  scene.layers.forEach((layer, i) => {
    const s = settings.layers[i];
    let beh = guessBehavior(layer, scene, id === 'cielo' ? 1.4 : 1);
    if (id === 'cielo' && beh.type === 'flotar') beh = { ...beh, period: 7 + hashSeed(layer.name) * 3, rot: beh.rot * 1.4 };
    if (id === 'brillos' && beh.type !== 'brillo') beh = { ...beh, type: 'none' };
    if (id === 'quieto') beh = { ...beh, type: 'none' };
    if (id === 'brisa' && beh.type === 'flotar') beh = { ...beh, amp: beh.amp * 0.8 };
    s.beh = beh;
    s.pivot = defaultPivot(layer, beh.type);
    s.phase = Math.round(Math.random() * 100) / 100;
  });
  settings.effects.sparkles = id !== 'quieto';
  settings.effects.density = id === 'brillos' ? 60 : 40;
}

export const OUTPUTS = [
  ['3840x1728', '20:9 · 3840×1728', 3840, 1728],
  ['2560x1152', '20:9 · 2560×1152', 2560, 1152],
  ['3840x2160', '16:9 · 3840×2160 (4K)', 3840, 2160],
  ['1920x1080', '16:9 · 1920×1080', 1920, 1080],
  ['1440x2160', '2:3 · 1440×2160', 1440, 2160],
  ['1080x1920', '9:16 · 1080×1920', 1080, 1920],
  ['1080x1080', '1:1 · 1080×1080', 1080, 1080],
  ['original', 'Original (hasta 4K)', 0, 0],
];

export function outputSize(preset, scene) {
  const o = OUTPUTS.find((x) => x[0] === preset) || OUTPUTS[3];
  if (o[0] !== 'original') return { w: o[2], h: o[3] };
  const s = Math.min(1, 3840 / Math.max(scene.width, scene.height), 2160 / Math.min(scene.width, scene.height));
  const even = (v) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { w: even(scene.width), h: even(scene.height) };
}

/** Bitrate automático: generoso pero lejos de 250 MB. */
export function autoMbps(w, h) {
  const mp = (w * h) / 1e6;
  return Math.min(40, Math.max(20, Math.round(mp * 10)));
}
