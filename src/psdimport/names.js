/** Nombres de capa → rol. Minúsculas, sin acentos, '_' como espacio. */

export const ROLE_OPTIONS = [
  ['ignore', 'Ignorar'],
  ['hair_back', 'Pelo atrás'],
  ['ear_l', 'Oreja conejo izq.'],
  ['ear_r', 'Oreja conejo der.'],
  ['human_ears', 'Orejas'],
  ['face', 'Cara'],
  ['neck', 'Cuello'],
  ['bangs', 'Flequillo'],
  ['hair', 'Mechón (pelo que se mueve)'],
  ['body', 'Cuerpo'],
  ['eye_l_A', 'Ojo izq. (estilo A)'],
  ['eye_r_A', 'Ojo der. (estilo A)'],
  ['eye_l_B', 'Ojo izq. (estilo B)'],
  ['eye_r_B', 'Ojo der. (estilo B)'],
  ['white_l', 'Ojo blanco izq.'],
  ['white_r', 'Ojo blanco der.'],
  ['iris_l', 'Iris izq.'],
  ['iris_r', 'Iris der.'],
  ['pupil_l', 'Pupila izq.'],
  ['pupil_r', 'Pupila der.'],
  ['highlight_l', 'Brillo izq.'],
  ['highlight_r', 'Brillo der.'],
  ['lash_l', 'Pestañas izq.'],
  ['lash_r', 'Pestañas der.'],
  ['closed_l', 'Ojo cerrado izq.'],
  ['closed_r', 'Ojo cerrado der.'],
  ['mouth_neutral', 'Boca normal'],
  ['mouth_small', 'Boca pequeña'],
  ['mouth_a', 'Boca abierta'],
  ['mouth_o', 'Boca o'],
  ['mouth_smile', 'Boca sonrisa'],
  ['upper_l', 'Brazo izq.'],
  ['upper_r', 'Brazo der.'],
  ['fore_l', 'Antebrazo izq.'],
  ['fore_r', 'Antebrazo der.'],
  ['sleeve_l', 'Manga izq.'],
  ['sleeve_r', 'Manga der.'],
  ['acc_head', 'Accesorio cabeza (sigue la cabeza)'],
  ['acc_body', 'Accesorio cuerpo'],
  ['static', 'Estático'],
];

const ROLE_SET = new Set(ROLE_OPTIONS.map(([id]) => id));

const POSES = {
  saludo: 'wave', saludar: 'wave', corazon: 'heart', paz: 'peace', v: 'peace',
  aplauso: 'clap', aplaudir: 'clap', senala: 'point', senalar: 'point', apunta: 'point',
  arriba: 'up', celebra: 'up', celebrar: 'up', reposo: 'rest',
};

const KINDS = {
  brazo: 'upper', antebrazo: 'fore', manga: 'sleeve', mangas: 'sleeve',
  puno: 'sleeve', mano: 'sleeve', manos: 'sleeve',
};

const EYE_PART = {
  blanco: 'white', iris: 'iris', pupila: 'pupil', brillo: 'highlight',
  pestanas: 'lash', parpado: 'lash', cerrado: 'closed',
};

export function normName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(words, word) {
  return words.includes(word);
}

function eyeStyle(words) {
  if (has(words, 'b')) return 'B';
  return 'A';
}

/** Clasificación por nombre, sin lado. El lado lo pone la posición. */
export function classifyName(raw) {
  const name = normName(raw);
  const words = name.split(' ').filter(Boolean);
  if (!words.length) return { role: 'unknown', known: false, name };
  if (has(words, 'pelo') && has(words, 'atras')) return { role: 'hair_back', known: true, name };
  if (has(words, 'orejas')) return { role: 'human_ears', known: true, name };
  if (has(words, 'oreja')) return { role: 'ear', known: true, name };
  if (has(words, 'flequillo')) return { role: 'bangs', known: true, name };
  if (has(words, 'cuello')) return { role: 'neck', known: true, name };
  if (has(words, 'cuerpo')) return { role: 'body', known: true, name };
  if (has(words, 'cara') || has(words, 'cabeza')) return { role: 'face', known: true, name };
  if (has(words, 'boca')) {
    let mouth = 'mouth_neutral';
    if (has(words, 'abierta') || has(words, 'open')) mouth = 'mouth_a';
    else if (has(words, 'sonrisa') || has(words, 'smile')) mouth = 'mouth_smile';
    else if (has(words, 'pequena') || has(words, 'chica') || has(words, 'small')) mouth = 'mouth_small';
    else if (has(words, 'o')) mouth = 'mouth_o';
    else if (has(words, 'a')) mouth = 'mouth_a';
    return { role: mouth, known: true, name };
  }
  if (has(words, 'mechon') || has(words, 'mechones') || has(words, 'rizo')) {
    return { role: 'hair', known: true, name };
  }
  const eye = classifyEye(words);
  if (eye) return { ...eye, known: true, name };
  const kind = KINDS[words[0]];
  if (kind) {
    const pose = words.slice(1).map((word) => POSES[word]).find(Boolean) || 'rest';
    return { role: kind, pose, known: true, name };
  }
  return { role: 'unknown', known: false, name };
}

function classifyEye(words) {
  const head = words[0];
  const line = head === 'linea' && has(words, 'ojo');
  const eyeWord = ['ojo', 'iris', 'pupila', 'brillo', 'pestanas', 'parpado'].includes(head) || line;
  if (!eyeWord && !words.some((word) => EYE_PART[word])) return null;
  let part = 'full';
  if (has(words, 'cerrado')) part = 'closed';
  else if (line || has(words, 'pestanas') || has(words, 'parpado')) part = 'lash';
  else {
    for (const word of words) {
      if (EYE_PART[word]) { part = EYE_PART[word]; break; }
    }
  }
  if (part === 'full' && !has(words, 'ojo') && head !== 'ojo') return null;
  return { role: 'eye', eyePart: part, style: part === 'closed' ? null : eyeStyle(words) };
}

export function isKnownRole(raw) {
  return classifyName(raw).known;
}

/** Valor del <select>, con el lado ya resuelto (l a la izquierda de la pantalla). */
export function roleValue(cls, side) {
  const sd = side === 'r' ? 'r' : 'l';
  if (!cls || cls.role === 'unknown') return 'unknown';
  if (cls.role === 'ear') return sd === 'l' ? 'ear_l' : 'ear_r';
  if (cls.role === 'upper' || cls.role === 'fore' || cls.role === 'sleeve') return `${cls.role}_${sd}`;
  if (cls.role === 'eye') {
    if (cls.eyePart === 'closed') return `closed_${sd}`;
    if (cls.eyePart === 'full') return `eye_${sd}_${cls.style === 'B' ? 'B' : 'A'}`;
    return `${cls.eyePart}_${sd}`;
  }
  return cls.role;
}

export function isRole(value) {
  return ROLE_SET.has(value);
}

export function sideFromRole(role) {
  if (typeof role !== 'string') return null;
  if (role.endsWith('_l') || role.includes('_l_')) return 'l';
  if (role.endsWith('_r') || role.includes('_r_')) return 'r';
  return null;
}

export function roleLabel(role) {
  const hit = ROLE_OPTIONS.find(([id]) => id === role);
  return hit ? hit[1] : role || 'Ignorar';
}
