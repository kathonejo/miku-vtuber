/** Cadena "Sigue a": la pieza local vive dentro del transform de su padre. */

function fallbackParent(part) {
  if (part?.parent) return part.parent;
  if (part?.role === 'eye' || part?.role === 'mouth') return 'head';
  return 'body';
}

/** locals: del padre inmediato hacia la raíz. head = la cadena llega a Cabeza. */
export function resolveChain(part, byId) {
  const locals = [];
  const seen = new Set();
  if (!part) return { head: false, locals };
  let current = part;
  for (let i = 0; i < 24; i += 1) {
    const parent = fallbackParent(current);
    if (parent === 'head') return { head: true, locals };
    if (parent === 'body') return { head: false, locals };
    if (seen.has(parent)) return { head: false, locals };
    const next = byId?.[parent];
    if (!next) return { head: false, locals };
    seen.add(parent);
    locals.push(next);
    current = next;
  }
  return { head: false, locals };
}

export function wouldCycle(partId, parentId, byId) {
  if (!parentId || parentId === 'body' || parentId === 'head') return false;
  if (parentId === partId) return true;
  const seen = new Set([partId]);
  let cursor = parentId;
  while (cursor && cursor !== 'body' && cursor !== 'head') {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const next = byId?.[cursor];
    if (!next) return false;
    cursor = next.parent;
  }
  return false;
}
