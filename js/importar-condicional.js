// ================================================
// IMPORTAR-CONDICIONAL.JS — Carga de datos condicionales
// (media y máxima por evaluación) desde Excel/CSV o desde
// una lista pegada (copiar/pegar de Excel). Fila 1 = títulos:
// columna(s) del jugador + una columna por ítem condicional.
// "<ítem> máx" / "máx <ítem>" = máxima; el resto, media.
// ================================================

import { parseCSV, parseEsNumber } from './importar-csv.js';
import { campoDeCabecera, norm } from './importar-jugadores.js';
import { slugify } from './ficha-espejo.js';

export { leerFilas } from './importar-jugadores.js';

/** Texto pegado (tabuladores si viene de Excel; si no, CSV con , o ;) → filas 2D. */
export function filasDesdeTexto(texto) {
  const t = String(texto || '').replace(/\r\n?/g, '\n');
  if (t.includes('\t')) return t.split('\n').map(l => l.split('\t').map(c => c.trim())).filter(c => c.some(x => x !== ''));
  const { headers, rows } = parseCSV(t);
  return rows.map(r => headers.map(h => r[h]));
}

const MAX_PREF = ['max', 'maxima', 'maximo'];

function columnaDe(titulo, items) {
  const n = norm(titulo);
  if (!n) return { tipo: null };
  const item = items.find(i => norm(i) === n);
  if (item) return { tipo: 'media', item };
  for (const m of MAX_PREF) {
    const resto = n.endsWith(' ' + m) ? n.slice(0, -m.length - 1) : n.startsWith(m + ' ') ? n.slice(m.length + 1) : null;
    const it = resto && items.find(i => norm(i) === resto);
    if (it) return { tipo: 'max', item: it };
  }
  const campo = campoDeCabecera(titulo);
  if (['nombre', 'apellidos', 'nombreCompleto'].includes(campo)) return { tipo: campo };
  return { tipo: null };
}

/**
 * @param {Array<Array>} filas2D  primera fila = títulos
 * @param {string[]} items        state.aspectosComunes.condicional
 * @returns {{ columnas: Array<{titulo, tipo, item}>, filas: Array<{nombre, media:{}, max:{}, avisos:string[]}> }}
 */
export function leerTablaCondicional(filas2D, items) {
  if (!filas2D.length) throw new Error('No hay datos.');
  const [cab, ...resto] = filas2D;
  const columnas = cab.map(t => ({ titulo: String(t ?? '').trim(), ...columnaDe(t, items) }));
  // Sin columna de nombre reconocida: la primera (si no es un ítem) es el jugador.
  if (!columnas.some(c => ['nombre', 'nombreCompleto'].includes(c.tipo))) {
    if (columnas[0] && !columnas[0].item) columnas[0].tipo = 'nombreCompleto';
    else throw new Error('No encuentro la columna del jugador (Jugador, Nombre o Nombre completo).');
  }
  if (!columnas.some(c => c.item)) throw new Error('Ninguna columna coincide con un ítem condicional de Configuración.');

  const filas = resto.map(cols => {
    let nombre = '', apellidos = '', completo = '';
    const media = {}, max = {}, avisos = [];
    columnas.forEach((c, i) => {
      const v = cols[i];
      const txt = String(v ?? '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      if (c.tipo === 'nombre') nombre = txt;
      else if (c.tipo === 'apellidos') apellidos = apellidos ? `${apellidos} ${txt}` : txt;
      else if (c.tipo === 'nombreCompleto') completo = txt.includes(',') ? txt.split(',').reverse().map(x => x.trim()).join(' ') : txt;
      else if (c.item) {
        const n = typeof v === 'number' ? v : parseEsNumber(txt);
        if (n == null) avisos.push(`${c.titulo}: "${txt}" no es un número`);
        else (c.tipo === 'max' ? max : media)[slugify(c.item)] = n;
      }
    });
    return { nombre: completo || `${nombre} ${apellidos}`.trim(), media, max, avisos };
  }).filter(f => f.nombre);
  return { columnas, filas };
}
