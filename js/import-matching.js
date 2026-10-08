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

const tokens = str => str.split(' ').filter(Boolean);
/** Un token del archivo "encaja" con uno del jugador si es igual, empieza igual (≥3 letras: "alf" → "alfredo") o es su inicial ("a"). */
function tokenFits(t, pt) {
  if (t === pt) return true;
  if (t.length >= 3 && pt.startsWith(t)) return true;
  return t.length === 1 && pt[0] === t;
}
/** Todas las palabras de uno encajan en el otro (en cualquier orden): apellido solo, nombre solo, "A. Sotres", nombre acortado… */
function isCloseMatch(a, b) {
  if (!a || !b) return false;
  const wa = tokens(a), wb = tokens(b);
  if (!wa.length || !wb.length) return false;
  const subset = (x, y) => x.every(t => y.some(pt => tokenFits(t, pt)));
  return subset(wa, wb) || subset(wb, wa);
}
/** Mismas palabras exactas, aunque en distinto orden ("sotres alfredo"). */
function sameWords(a, b) {
  const wa = tokens(a).sort().join(' '), wb = tokens(b).sort().join(' ');
  return !!wa && wa === wb;
}

/** Si hay varios candidatos y se conoce el equipo del archivo, se reduce a los que coinciden. */
function narrowByTeam(candidates, teamKey) {
  if (!teamKey || candidates.length <= 1) return candidates;
  const porEquipo = candidates.filter(p => p.teamKey === teamKey);
  return porEquipo.length ? porEquipo : candidates;
}

/**
 * @param {string} nameFromFile  texto tal cual viene en el archivo
 * @param {Array}  players       state.players
 * @param {Object} [ctx]         { teamKey } — equipo leído del archivo (si se mapeó), para
 *                                desempatar cuando hay varios jugadores con nombre parecido
 * @returns {{status:'auto'|'dudoso'|'sin-match', playerId:string|null, candidates:Array}}
 */
export function matchJugador(nameFromFile, players, ctx = {}) {
  const target = normalize(nameFromFile);
  if (!target) return { status: 'sin-match', playerId: null, candidates: [] };

  // 1) alias ya confirmado en una importación anterior
  const byAlias = players.find(p => (p.aliases || []).some(a => normalize(a) === target));
  if (byAlias) return { status: 'auto', playerId: byAlias.id, candidates: [byAlias] };

  // 2) coincidencia exacta nombre+apellidos
  const exact = players.filter(p => fullName(p) === target);
  if (exact.length === 1) return { status: 'auto', playerId: exact[0].id, candidates: exact };
  if (exact.length > 1) {
    const narrowed = narrowByTeam(exact, ctx.teamKey);
    if (narrowed.length === 1) return { status: 'auto', playerId: narrowed[0].id, candidates: narrowed };
    return { status: 'dudoso', playerId: null, candidates: narrowed };
  }

  // 2b) mismas palabras en otro orden ("Sotres Alfredo")
  const reorder = players.filter(p => sameWords(fullName(p), target));
  if (reorder.length >= 1) {
    const narrowed = narrowByTeam(reorder, ctx.teamKey);
    if (narrowed.length === 1) return { status: 'auto', playerId: narrowed[0].id, candidates: narrowed };
    return { status: 'dudoso', playerId: null, candidates: narrowed };
  }

  // 3) parecido (solo apellido, solo nombre, acortado, sin tildes…) — SIEMPRE requiere confirmación:
  //    se propone el candidato y, al confirmarlo, se guarda como alias para la próxima vez.
  const close = players.filter(p => isCloseMatch(fullName(p), target));
  if (close.length >= 1) {
    return { status: 'dudoso', playerId: null, candidates: narrowByTeam(close, ctx.teamKey) };
  }

  return { status: 'sin-match', playerId: null, candidates: [] };
}
