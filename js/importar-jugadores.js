// ================================================
// IMPORTAR-JUGADORES.JS — Alta masiva de jugadores
// desde Excel/CSV CON fila de cabecera. Las columnas
// se reconocen por su título (Nombre, Apellidos,
// Fecha de nacimiento, Equipo, Posición, Peso...);
// las desconocidas se ignoran. Lo que falte se deja
// vacío: el perfil se crea igual.
// ================================================

import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.18.7/package/xlsx.mjs';
import { parseCSV, parseEsNumber } from './importar-csv.js';
import { TEAMS } from './constants.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Títulos de columna aceptados (ya normalizados) por campo.
const CAMPOS = {
  nombreCompleto:  ['nombre completo', 'nombre y apellidos', 'apellidos y nombre', 'apellidos nombre', 'nombre apellidos', 'jugador', 'player'],
  nombre:          ['nombre', 'name'],
  apellidos:       ['apellidos', 'apellido', 'apellido 1', 'apellido 2', 'apellido1', 'apellido2', 'primer apellido', 'segundo apellido'],
  birthDate:       ['fecha de nacimiento', 'fecha nacimiento', 'f nacimiento', 'nacimiento', 'fecha nac', 'f nac', 'fnac', 'birthdate'],
  foot:            ['lateralidad', 'pie', 'pierna', 'pie dominante', 'pierna dominante'],
  residencia:      ['residencia'],
  maturationalAge: ['edad madurativa', 'edad biologica', 'madurativa'],
  teamKey:         ['equipo', 'team', 'categoria'],
  positionKey:     ['posicion', 'demarcacion', 'puesto'],
  weight:          ['peso', 'peso kg'],
  height:          ['altura', 'altura m', 'altura cm', 'talla', 'talla cm', 'estatura'],
  complexion:      ['complexion', 'biotipo'],
};
export const CAMPO_LABEL = {
  nombreCompleto: 'Nombre completo', nombre: 'Nombre', apellidos: 'Apellidos', birthDate: 'Fecha de nacimiento',
  foot: 'Lateralidad', residencia: 'Residencia', maturationalAge: 'Edad madurativa', teamKey: 'Equipo',
  positionKey: 'Posición', weight: 'Peso', height: 'Altura', complexion: 'Complexión',
};
const RESIDENCIAS = ['Residente en Madrid', 'En residencia', 'Media pensión'];

function campoDeCabecera(h) {
  const n = norm(h);
  if (!n) return null;
  const exacto = Object.keys(CAMPOS).find(c => CAMPOS[c].includes(n));
  if (exacto) return exacto;
  // "Peso (kg) actual", "Fecha de nacimiento dd/mm/aaaa"…: el título empieza por uno conocido (el más largo gana)
  let mejor = null, largo = 0;
  for (const [c, alias] of Object.entries(CAMPOS)) {
    for (const a of alias) if (n.startsWith(a + ' ') && a.length > largo) { mejor = c; largo = a.length; }
  }
  return mejor;
}

async function leerFilas(file) {
  if (/\.csv$/i.test(file.name)) {
    const { headers, rows } = parseCSV(await file.text());
    return rows.map(r => headers.map(h => r[h]));
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' })
    .filter(cols => cols.some(c => String(c ?? '').trim() !== ''));
}

// Fecha → 'aaaa-mm-dd'. Acepta fecha de Excel (número), dd/mm/aaaa, dd-mm-aa y aaaa-mm-dd.
function parseFecha(v) {
  if (typeof v === 'number' && v > 1000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? iso(d.y, d.m, d.d) : null;
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y <= new Date().getFullYear() % 100 ? 2000 : 1900;
    return iso(y, +m[2], +m[1]);
  }
  return null;
}
function iso(y, mo, d) {
  const f = new Date(Date.UTC(y, mo - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseLateralidad(v) {
  const n = norm(v);
  if (!n) return '';
  if (n.startsWith('amb')) return 'Ambidiestro';
  if (n.startsWith('dies') || n.startsWith('der') || n === 'd' || n === 'r') return 'Diestro';
  if (n.startsWith('zur') || n.startsWith('izq') || n === 'z' || n === 'i' || n === 'l') return 'Zurdo';
  return null;
}

const buscarPor = (lista, v) => {
  const n = norm(v);
  return n ? lista.find(x => norm(x.label) === n || norm(x.key) === n) : undefined;
};

/**
 * @param {File} file
 * @param {Array} positions  state.positions
 * @returns {{ columnas: Array<{titulo, campo}>, filas: Array<{data, avisos:string[]}> }}
 */
export async function leerTablaJugadores(file, positions) {
  const filas2D = await leerFilas(file);
  if (!filas2D.length) throw new Error('El archivo está vacío.');
  const [cab, ...resto] = filas2D;
  const columnas = cab.map(t => ({ titulo: String(t ?? '').trim(), campo: campoDeCabecera(t) }));
  const usados = new Set(columnas.map(c => c.campo));
  if (!usados.has('nombre') && !usados.has('nombreCompleto')) {
    throw new Error('No encuentro la columna "Nombre" (o "Nombre completo" / "Jugador") en la primera fila.');
  }

  const filas = resto.map(cols => {
    const crudo = {}; // campo → valor (apellidos de varias columnas se juntan)
    columnas.forEach((c, i) => {
      if (!c.campo) return;
      const v = cols[i];
      if (String(v ?? '').trim() === '') return;
      if (c.campo === 'apellidos' && crudo.apellidos) crudo.apellidos += ' ' + String(v).trim();
      else if (crudo[c.campo] === undefined) crudo[c.campo] = v;
    });
    const avisos = [];
    const txt = k => String(crudo[k] ?? '').replace(/\s+/g, ' ').trim();
    let nombre = txt('nombre'), apellidos = txt('apellidos');
    if (!nombre && crudo.nombreCompleto !== undefined) {
      const t = txt('nombreCompleto');
      if (t.includes(',')) { const [ap, ...no] = t.split(','); apellidos = ap.trim(); nombre = no.join(' ').trim(); }
      else { const w = t.split(' '); nombre = w[0]; apellidos = w.slice(1).join(' '); }
    }

    const data = {
      nombre, apellidos,
      birthDate: null, foot: '', residencia: '', maturationalAge: txt('maturationalAge'),
      teamKey: null, positionKey: null, weight: null, height: null, complexion: txt('complexion') || null,
    };
    if (crudo.birthDate !== undefined) {
      data.birthDate = parseFecha(crudo.birthDate);
      if (!data.birthDate) avisos.push(`Fecha no válida: "${txt('birthDate')}"`);
    }
    if (crudo.foot !== undefined) {
      const f = parseLateralidad(crudo.foot);
      if (f === null) avisos.push(`Lateralidad no reconocida: "${txt('foot')}"`); else data.foot = f;
    }
    if (crudo.residencia !== undefined) {
      const r = RESIDENCIAS.find(x => norm(x) === norm(crudo.residencia));
      if (!r) avisos.push(`Residencia no reconocida: "${txt('residencia')}"`); else data.residencia = r;
    }
    if (crudo.teamKey !== undefined) {
      const t = buscarPor(TEAMS, crudo.teamKey);
      if (!t) avisos.push(`Equipo no reconocido: "${txt('teamKey')}"`); else data.teamKey = t.key;
    }
    if (crudo.positionKey !== undefined) {
      const p = buscarPor(positions, crudo.positionKey);
      if (!p) avisos.push(`Posición no reconocida: "${txt('positionKey')}"`); else data.positionKey = p.key;
    }
    if (crudo.weight !== undefined) {
      const n = typeof crudo.weight === 'number' ? crudo.weight : parseEsNumber(crudo.weight);
      if (n == null || n <= 0) avisos.push(`Peso no válido: "${txt('weight')}"`); else data.weight = n;
    }
    if (crudo.height !== undefined) {
      let n = typeof crudo.height === 'number' ? crudo.height : parseEsNumber(crudo.height);
      if (n != null && n > 3) n = Math.round(n) / 100; // en cm → m
      if (n == null || n <= 0) avisos.push(`Altura no válida: "${txt('height')}"`); else data.height = n;
    }
    return { data, avisos };
  }).filter(f => f.data.nombre);

  return { columnas, filas };
}
