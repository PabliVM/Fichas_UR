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

/** Tipo y valores por defecto de cada columna 1..51 (ver cabecera del archivo). */
export const TOTAL_COLUMNAS = 51;
export function tipoColumna(n) {
  if (n === 1) return 'Fecha';
  if (n === 2) return 'Evaluador';
  if (n === 3) return 'Jugador';
  if (n <= 6) return 'Perfil (Ficha 1)';
  if (n <= 18) return 'Táctico (Ficha 2)';
  if (n <= 22) return 'Texto (Ficha 1)';
  if (n <= 31) return 'Mental (Ficha 2)';
  if (n === 32) return 'Perfil técnico';
  if (n <= 44) return 'Técnico (Ficha 2)';
  if (n <= 49) return 'NO BBDD';
  return n === 50 ? 'R (Ficha 1)' : 'P (Ficha 1)';
}
const TEXTOS = { 19: 'Ofensivos a potenciar', 20: 'Ofensivos a mejorar', 21: 'Defensivos a potenciar', 22: 'Defensivos a mejorar' };

/**
 * Columnas efectivas de la posición: plantilla por defecto + cambios del usuario
 * (state.columnasEncuesta[pos][n] = { nombre?, destino? }).
 * destino = competencia a la que van las notas ('' = no se importa). 1-3 y 19-22 (texto) no son editables.
 * @returns {Array<{num,tipo,nombre,destino,fija}>}
 */
export function columnasEfectivas(state, positionKey) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const tact = schema.tactico || [];
  const mental = state.aspectosComunes.mental || [];
  const tec = schema.tecnico || state.aspectosComunes.tecnico || [];
  const perfiles = schema.perfiles || [];
  const over = state.columnasEncuesta?.[positionKey] || {};
  const out = [];
  for (let n = 1; n <= TOTAL_COLUMNAS; n++) {
    let nombre = '', destino = '', fija = false;
    if (n === 1) { nombre = 'Fecha y hora'; fija = true; }
    else if (n === 2) { nombre = 'Evaluador'; fija = true; }
    else if (n === 3) { nombre = 'Jugador'; fija = true; }
    else if (n <= 6) { nombre = destino = perfiles[n - 4] || ''; fija = true; }
    else if (n <= 18) nombre = destino = tact[n - 7] || '';
    else if (n <= 22) { nombre = TEXTOS[n]; fija = true; }
    else if (n <= 31) nombre = destino = mental[n - 23] || '';
    else if (n === 32) nombre = 'Perfil técnico';
    else if (n <= 44) nombre = destino = tec[n - 33] || '';
    else if (n <= 49) nombre = 'NO BBDD';
    else nombre = n === 50 ? 'R' : 'P';
    const o = over[n];
    if (o && !fija) {
      if (o.nombre) nombre = o.nombre;
      if ('destino' in o) destino = o.destino || '';
    }
    out.push({ num: n, tipo: tipoColumna(n), nombre, destino, fija });
  }
  return out;
}

/** Mapeo precargado { 'Columna N': competencia } para el import. Solo si el archivo tiene >=44 columnas. */
export function mapeoPorDefecto(state, positionKey, nCols) {
  const mapping = {};
  if (nCols < 44) return mapping;
  columnasEfectivas(state, positionKey).forEach(c => {
    if (c.num >= 7 && !c.fija && c.destino && c.num <= nCols) mapping[`Columna ${c.num}`] = c.destino;
  });
  return mapping;
}
