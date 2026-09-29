// ================================================
// MEDIAS.JS — Cálculo de resultados consolidados.
// Puro (sin Firestore). Método fijado en auditoría:
//   evaluadores → media por competencia
//   medias de competencias → media del aspecto
//   grupo (comparativas) → media NO ponderada de la
//   media de cada jugador (cada jugador pesa 1 vez,
//   tenga los evaluadores que tenga)
// ================================================

function mean(nums) {
  const valid = nums.filter(n => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * @param {Array}  registros  todos con el mismo jugadorId (uno por evaluador)
 * @param {Object} aspectoPorCompetencia  { competenciaKey: aspectoKey }
 */
export function calcularMediaJugador(registros, aspectoPorCompetencia) {
  const competenciasVistas = new Set();
  registros.forEach(r => Object.keys(r.puntuaciones || {}).forEach(k => competenciasVistas.add(k)));

  const porCompetencia = {};
  competenciasVistas.forEach(comp => {
    const valores = registros.map(r => r.puntuaciones?.[comp]).filter(v => v != null);
    porCompetencia[comp] = mean(valores);
  });

  const grupos = {};
  competenciasVistas.forEach(comp => {
    const aspecto = aspectoPorCompetencia?.[comp] || 'otros';
    (grupos[aspecto] = grupos[aspecto] || []).push(porCompetencia[comp]);
  });
  const porAspecto = {};
  Object.entries(grupos).forEach(([aspecto, valores]) => { porAspecto[aspecto] = mean(valores); });

  return { porCompetencia, porAspecto, evaluadores: [...new Set(registros.map(r => r.evaluador))] };
}

/** Agrupa registros por jugadorId y calcula la media de cada uno. */
export function calcularMediasPorJugador(registros, aspectoPorCompetencia) {
  const porJugador = {};
  registros.forEach(r => {
    if (!r.jugadorId) return; // sin identificar todavía — no entra en medias
    (porJugador[r.jugadorId] = porJugador[r.jugadorId] || []).push(r);
  });
  const out = {};
  Object.entries(porJugador).forEach(([jugadorId, regs]) => {
    out[jugadorId] = calcularMediaJugador(regs, aspectoPorCompetencia);
  });
  return out;
}

/** Media de grupo (comparativas) — cada jugador pesa una vez. */
export function calcularMediaGrupo(mediasPorJugador, aspectoKey = null) {
  const valores = Object.values(mediasPorJugador).map(m => {
    if (aspectoKey) return m.porAspecto[aspectoKey];
    return mean(Object.values(m.porAspecto));
  });
  return mean(valores);
}

/** Mapa competencia→aspecto para una posición (mental/tecnico/tactico/condicional). */
export function buildAspectoPorCompetencia(state, positionKey) {
  const map = {};
  (state.aspectosComunes.mental || []).forEach(c => { map[c] = 'mental'; });
  const schema = state.criteriaSchemas[positionKey] || {};
  (schema.tecnico || state.aspectosComunes.tecnico || []).forEach(c => { map[c] = 'tecnico'; });
  (schema.tactico || []).forEach(c => { map[c] = 'tactico'; });
  (state.aspectosComunes.condicional || []).forEach(c => { map[c] = 'condicional'; });
  return map;
}
