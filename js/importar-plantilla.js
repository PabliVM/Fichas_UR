// ================================================
// IMPORTAR-PLANTILLA.JS — Estructura FIJA de las encuestas (Google Forms).
// Funciones puras (sin Firebase ni DOM).
//
// Columnas (1-based):
//  1 fecha · 2 evaluador · 3 jugador · 4-6 perfiles (Ficha 1)
//  7-18  12 competencias tácticas (Ficha 2)    → schema.tactico[0..11]
//  19-22 textos Ficha 1 (ofensivos/defensivos potenciar/mejorar) → no se importan
//  23-31 9 competencias mentales (Ficha 2)     → aspectosComunes.mental[0..8]
//  32    "Perfil técnico" (influye en el círculo técnico) → sin destino definido, se ignora
//  33-44 12 competencias técnicas (Ficha 2)    → schema.tecnico[0..11]
//  45-49 "NO BBDD" → se ignoran
//  50-51 R / P individual (Ficha 1) → sin destino definido, se ignoran
// ================================================

const RE_FECHA = /^\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|^\s*\d{4}-\d{2}-\d{2}/;

/** Quita las filas previas a la primera con fecha en la columna 1 (números, ficha/aspecto, preguntas). */
export function quitarCabeceras(rows) {
  const idx = rows.findIndex(r => RE_FECHA.test(r['Columna 1'] || ''));
  if (idx <= 0) return { rows, omitidas: 0 };
  return { rows: rows.slice(idx), omitidas: idx };
}

/** "9/23/2026 13:35:29" (m/d) o "23/09/2026 …" (d/m) → "2026-09-23T13:35:29". Orden decidido por todo el archivo. */
export function normalizarFechas(rows) {
  const parse = s => {
    const m = String(s || '').trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    return m ? { a: +m[1], b: +m[2], y: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) } : null;
  };
  const ps = rows.map(r => parse(r['Columna 1'])).filter(Boolean);
  const dmy = ps.some(p => p.a > 12) ? true : ps.some(p => p.b > 12) ? false : false; // ambiguo → m/d (como el export de tus encuestas)
  const p2 = n => String(n).padStart(2, '0');
  return rows.map(r => {
    const p = parse(r['Columna 1']);
    if (!p) return r;
    const y = p.y < 100 ? 2000 + p.y : p.y;
    const [d, mo] = dmy ? [p.a, p.b] : [p.b, p.a];
    return { ...r, 'Columna 1': `${y}-${p2(mo)}-${p2(d)}T${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}` };
  });
}

/** Mapeo precargado { 'Columna N': competencia } para la posición. Solo si el archivo tiene ≥44 columnas. */
export function mapeoPorDefecto(state, positionKey, nCols) {
  const mapping = {};
  if (nCols < 44) return mapping;
  const schema = state.criteriaSchemas[positionKey] || {};
  const tact = schema.tactico || [];
  const mental = state.aspectosComunes.mental || [];
  const tec = schema.tecnico || state.aspectosComunes.tecnico || [];
  const poner = (desde, lista, n) => { for (let i = 0; i < n; i++) if (lista[i]) mapping[`Columna ${desde + i}`] = lista[i]; };
  poner(7, tact, 12);
  poner(23, mental, 9);
  poner(33, tec, 12);
  return mapping;
}
