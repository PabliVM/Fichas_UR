// ================================================
// IMPORTAR-CONDICIONAL.JS — Carga de datos condicionales
// (media y máxima por evaluación) desde Excel/CSV o desde
// una lista pegada (copiar/pegar de Excel). Fila 1 = títulos:
// columna(s) del jugador + una columna por ítem condicional.
// "<ítem> máx" / "máx <ítem>" = máxima; el resto, media.
// Alevines e infantiles: columnas con las capacidades (Coordinación, Agilidad…)
// y ✔ / ▬ / ✘ (o Bien / Regular / Mal). A cada jugador se le guarda lo suyo.
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

function columnaDe(titulo, items, base) {
  const n = norm(titulo);
  if (!n) return { tipo: null };
  const item = items.find(i => norm(i) === n);
  const capacidad = base.find(b => norm(b) === n); // misma columna puede valer para los dos (p. ej. Edad madurativa)
  if (item) return { tipo: 'media', item, ...(capacidad ? { base: capacidad } : {}) };
  if (capacidad) return { tipo: 'base', base: capacidad };
  for (const m of MAX_PREF) {
    const resto = n.endsWith(' ' + m) ? n.slice(0, -m.length - 1) : n.startsWith(m + ' ') ? n.slice(m.length + 1) : null;
    const it = resto && items.find(i => norm(i) === resto);
    if (it) return { tipo: 'max', item: it };
  }
  const campo = campoDeCabecera(titulo);
  if (['nombre', 'apellidos', 'nombreCompleto'].includes(campo)) return { tipo: campo };
  return { tipo: null };
}

/** ✔ / ▬ / ✘ (y equivalentes escritos) → 'ok' | 'dash' | 'fail', o null si no se reconoce. */
export function parseSimbolo(txt) {
  const t = String(txt ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['✔', '✓', '✅', '✔️', 'ok', 'bien', 'b', 'si', '+', 'verde'].includes(t)) return 'ok';
  if (['▬', '-', '–', '—', '=', '~', 'regular', 'r', 'amarillo', 'normal'].includes(t)) return 'dash';
  if (['✘', '✗', 'x', '❌', 'mal', 'm', 'no', 'rojo'].includes(t)) return 'fail';
  return null;
}

/**
 * @param {Array<Array>} filas2D  primera fila = títulos
 * @param {string[]} items        state.aspectosComunes.condicional (datos numéricos)
 * @param {string[]} [base]       capacidades de alevines/infantiles (símbolos)
 * @returns {{ columnas: Array<{titulo, tipo, item, base}>, filas: Array<{nombre, media:{}, max:{}, base:{}, avisosNum:string[], avisosBase:string[]}> }}
 */
export function leerTablaCondicional(filas2D, items, base = []) {
  if (!filas2D.length) throw new Error('No hay datos.');
  const [cab, ...resto] = filas2D;
  const columnas = cab.map(t => ({ titulo: String(t ?? '').trim(), ...columnaDe(t, items, base) }));
  // Sin columna de nombre reconocida: la primera (si no es un ítem) es el jugador.
  if (!columnas.some(c => ['nombre', 'nombreCompleto'].includes(c.tipo))) {
    if (columnas[0] && !columnas[0].item && !columnas[0].base) columnas[0].tipo = 'nombreCompleto';
    else throw new Error('No encuentro la columna del jugador (Jugador, Nombre o Nombre completo).');
  }
  if (!columnas.some(c => c.item || c.base)) throw new Error('Ninguna columna coincide con un ítem condicional de Configuración ni con una capacidad de alevines/infantiles.');

  const filas = resto.map((cols, fila) => {
    let nombre = '', apellidos = '', completo = '';
    const media = {}, max = {}, simbolos = {}, avisosNum = [], avisosBase = [];
    columnas.forEach((c, i) => {
      const v = cols[i];
      const txt = String(v ?? '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      if (c.tipo === 'nombre') nombre = txt;
      else if (c.tipo === 'apellidos') apellidos = apellidos ? `${apellidos} ${txt}` : txt;
      else if (c.tipo === 'nombreCompleto') completo = txt.includes(',') ? txt.split(',').reverse().map(x => x.trim()).join(' ') : txt;
      else {
        if (c.item) {
          const n = typeof v === 'number' ? v : parseEsNumber(txt);
          if (n == null) avisosNum.push(`${c.titulo}: "${txt}" no es un número`);
          else (c.tipo === 'max' ? max : media)[slugify(c.item)] = n;
        }
        if (c.base) {
          const s = parseSimbolo(txt);
          if (s == null) avisosBase.push(`${c.titulo}: "${txt}" no es ✔ / ▬ / ✘`);
          else simbolos[slugify(c.base)] = s;
        }
      }
    });
    return { nombre: completo || `${nombre} ${apellidos}`.trim(), media, max, base: simbolos, avisosNum, avisosBase, fila };
  }).filter(f => f.nombre);
  return { columnas, filas };
}
