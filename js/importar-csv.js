// ================================================
// IMPORTAR-CSV.JS — Parseo genérico (CSV y Excel) +
// deduplicación idempotente. NO asume nombres de
// columna: el usuario mapea cada columna del archivo
// a un campo/competencia conocido antes de importar
// (auditoría §4).
// ================================================

import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.18.7/package/xlsx.mjs';

/** Excel (.xlsx/.xls) → misma forma {headers, rows} que parseCSV. Usa la primera hoja. */
export function parseXLSXBuffer(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) return { headers: [], rows: [] };
  const filas2D = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });
  if (!filas2D.length) return { headers: [], rows: [] };
  const headers = filas2D[0].map(h => String(h ?? '').trim());
  const rows = filas2D.slice(1)
    .filter(cols => cols.some(c => String(c ?? '').trim() !== ''))
    .map(cols => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(cols[i] ?? '').trim(); });
      return obj;
    });
  return { headers, rows };
}

/** Parser CSV simple (detecta separador , o ;). Soporta comillas. */
export function parseCSV(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };

  const parseLine = line => {
    const out = []; let cur = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === sep && !inQuotes) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).map(cols => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

/** "1,8" o "1.8" → 1.8 (mismo criterio que el guion de Condicional en ficha-detalle.js). */
export function parseEsNumber(str) {
  if (str == null) return null;
  let s = String(str).trim();
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Clave única de un registro, para detectar duplicados al reimportar el
 * mismo archivo (auditoría §15). PROVISIONAL: se ajustará cuando se
 * conozcan las columnas reales, si un evaluador puede puntuar al mismo
 * jugador más de una vez dentro de la misma evaluación.
 */
export function buildRowKey({ evaluacionId, jugadorId, jugadorNombreArchivo, evaluador }) {
  return [evaluacionId, jugadorId || `sin-id:${(jugadorNombreArchivo || '').toLowerCase()}`, evaluador || '—'].join('|');
}

/**
 * Clasifica filas nuevas frente a lo ya existente en Firestore para esa
 * evaluación → NUEVO / EXISTENTE SIN CAMBIOS / EXISTENTE CON CAMBIOS / ERROR.
 * @param {Array} filas       [{ rowKey, jugadorId, evaluador, puntuaciones, jugadorNombreArchivo, error? }]
 * @param {Array} existentes  registros ya en Firestore de esta evaluación
 */
export function clasificarFilas(filas, existentes) {
  const porKey = new Map(existentes.map(r => [r.rowKey, r]));
  const nuevos = [], sinCambios = [], conCambios = [], errores = [];
  filas.forEach(fila => {
    if (fila.error) { errores.push(fila); return; }
    const existente = porKey.get(fila.rowKey);
    if (!existente) { nuevos.push(fila); return; }
    const igual = JSON.stringify(existente.puntuaciones || {}) === JSON.stringify(fila.puntuaciones || {});
    if (igual) sinCambios.push(fila);
    else conCambios.push({ ...fila, existente });
  });
  return { nuevos, sinCambios, conCambios, errores };
}
