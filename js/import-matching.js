// ================================================
// IMPORT-MATCHING.JS — Relaciona el nombre de un
// jugador tal como viene en el archivo con su playerId
// oficial. Nunca sustituye el nombre oficial.
// ================================================

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function fullName(p) {
  return normalize(`${p.nombre || ''} ${p.apellidos || ''}`);
}

/** Mismas palabras (aunque incompleto o en distinto orden) o una contiene a la otra. */
function isCloseMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = a.split(' ').filter(Boolean);
  const wb = b.split(' ').filter(Boolean);
  if (wa.length && wb.length) {
    const setB = new Set(wb);
    const inter = wa.filter(w => setB.has(w)).length;
    if (inter >= 1 && inter >= Math.min(wa.length, wb.length)) return true;
  }
  return a.includes(b) || b.includes(a);
}

/**
 * @param {string} nameFromFile  texto tal cual viene en el archivo
 * @param {Array}  players       state.players
 * @returns {{status:'auto'|'dudoso'|'sin-match', playerId:string|null, candidates:Array}}
 */
export function matchJugador(nameFromFile, players) {
  const target = normalize(nameFromFile);
  if (!target) return { status: 'sin-match', playerId: null, candidates: [] };

  // 1) alias ya confirmado en una importación anterior
  const byAlias = players.find(p => (p.aliases || []).some(a => normalize(a) === target));
  if (byAlias) return { status: 'auto', playerId: byAlias.id, candidates: [byAlias] };

  // 2) coincidencia exacta nombre+apellidos
  const exact = players.filter(p => fullName(p) === target);
  if (exact.length === 1) return { status: 'auto', playerId: exact[0].id, candidates: exact };
  if (exact.length > 1) return { status: 'dudoso', playerId: null, candidates: exact };

  // 3) parecido (nombre incompleto, orden distinto) — requiere confirmación manual
  const close = players.filter(p => isCloseMatch(fullName(p), target));
  if (close.length >= 1) return { status: 'dudoso', playerId: null, candidates: close };

  return { status: 'sin-match', playerId: null, candidates: [] };
}
