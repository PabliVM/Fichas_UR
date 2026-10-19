// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase, addDocument, updateDocument, deleteDocument, addSubDocument, readSubCollection, readCollection, saveDocument, readDocument, updateMapEntry } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { watchAuthState, login, resetPassword } from './auth-service.js';
import { crearEvaluacion, actualizarEvaluacion, eliminarEvaluacion, listarEvaluaciones, queryRegistros, crearRegistro, actualizarRegistro } from './evaluaciones-service.js';
import { matchJugador } from './import-matching.js';
import { calcularMediasPorJugador, calcularMediaGrupo, buildAspectoPorCompetencia } from './medias.js';
import { parseCSV, parseXLSXBuffer, parseEsNumber, buildRowKey, clasificarFilas } from './importar-csv.js';
import { renderHeader }  from './render-header.js';
import { renderTabs, switchTab } from './render-tabs.js';
import { renderFooter }  from './render-footer.js';
import { TABS, LOGO_PATH, TEAMS, FICHA2_OFFICIAL_DIMENSIONS, PROFILES } from './constants.js';
import { state, setState, DEFAULT_FICHA_COLORS, loadConfigFromFirestore, loadPlayersFromFirestore } from './state.js';
import { renderFichaDetalle, setGpsTolerance, condicionalScore, fitFichaToFrame } from './ficha-detalle.js';
import { renderFichaPagina1 } from './ficha-pagina1.js';
import { FICHA1_DEMO_DATA }   from './ficha-pagina1-demo-data.js';
import { exportFichaAsPDF, exportFichasAsPDF } from './pdf-export.js';
import { showError, showSuccess, safeText } from './utils.js';
import { renderFichasEspejo } from './ficha-espejo-ui.js';
import { buildCatalogo, slugify } from './ficha-espejo.js';
import { quitarCabeceras, normalizarFechas, mapeoPorDefecto, columnasEfectivas, TEXTOS_DESTINOS, RP_DESTINOS } from './importar-plantilla.js';
import { renderColumnasEncuesta } from './columnas-encuesta-ui.js';

// ── EVITAR SALTO DE SCROLL AL RE-RENDERIZAR ───────
// Reemplazar innerHTML de un panel entero resetea el scroll del navegador.
// Se usa en botones que re-renderizan paneles grandes (Fichas tipo, etc.)
// para que el usuario no "suba" solo por cambiar de posición/página.
function preservandoScroll(fn) {
  const y = window.scrollY;
  fn();
  requestAnimationFrame(() => window.scrollTo(0, y));
}

// ── AVISO FIREBASE ────────────────────────────────

function firebaseNotice() {
  if (!isFirebaseUnconfigured()) return '';
  return `
    <div class="firebase-notice mb-16">
      ⚠ Firebase pendiente de configurar — edita <code>js/firebase-config.js</code>
    </div>
  `;
}

// ── PANELES (stub — cada uno se implementa en su propia fase) ──

function renderPanelInicio(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card card-lg">
      <div class="card-title">Resumen</div>
      <div class="card-body">
        <p>Archivos importados: —</p>
        <p>Evaluaciones registradas: —</p>
        <p>Jugadores evaluados: —</p>
        <p>Pendientes de revisar: —</p>
      </div>
    </div>
  `;
}

function renderPanelImportar(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card">
      <div class="card-title">Importar CSV</div>
      <div class="card-body">Módulo de importación pendiente de implementar.</div>
    </div>
  `;
}

function renderPanelSucesion(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">Líneas de sucesión</div>
      <div class="card-body">Pendiente de definir — pestaña reservada.</div>
    </div>
  `;
}

let registroSubTab = localStorage.getItem('rm-registro-subtab') || 'registro'; // 'registro' | 'bbdd'

// ── REGISTRO DE DATOS: contexto de evaluación, import CSV y BBDD ──
// Colecciones nuevas 'evaluaciones' y 'registros' (evaluaciones-service.js).
// No toca 'jugadores' ni 'config'. Ver auditoría 15 puntos.

let regEvaluaciones  = null;  // cache; null = no cargado aún, [] = cargado y vacío
let regEvalFormOpen  = false;
let regEvalEditId    = null;  // id de la evaluación que se está editando (null = alta nueva)
let regEvalSel       = null;  // id de la evaluación activa para importar
let regImport        = null;  // estado del wizard de importación (ver resetRegImport)

let bbddFiltros  = { temporada: '', evaluacionId: '', jugadorId: '', posicionKey: '', evaluador: '', vista: 'individuales' };
let bbddResultado = null;     // { registros, mediasPorJugador } tras pulsar Buscar
let bbddBusy = false;
let fichaRealView = null;     // { jugadorId, positionKey } | null — "Ver ficha" desde BBDD
let fichaRealSubPage = 1;

let compFiltros  = { temporada: '', equipo: '', generacion: '', posicionKey: '', evaluacionId: '' };
let compJugadorId = '';
let compResultado = null;     // { mediasPorJugador, grupoMedia, jugadorMedia, n } tras Comparar
let compBusy = false;

// ── Ficha real (BBDD → Ficha 1/2) ──────────────────
// Mismo objeto que ya esperan renderFichaPagina1/renderFichaDetalle — no se
// toca su diseño ni su lógica, solo se rellena con la media consolidada real
// en vez de null (auditoría §10-11). "Ver ficha" alimenta esto, no duplica.

/** value → 'green'/'yellow'/'red' según state.scoreBands (asume orden alto→bajo, 3 bandas — el mismo criterio que ya usa Configuración → Bandas de color). */
function bandKeyForValue(value, bands) {
  if (value == null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const idx = sorted.findIndex(b => value >= b.min);
  if (idx === -1) return null;
  return ['green', 'yellow', 'red'][idx] ?? 'red';
}

/** Símbolo de la Ficha 1 por banda (alta→baja = green/yellow/red). Por defecto ✔ / – / ✘; configurable en Colores de las medias. */
const SIMBOLOS_DEF = ['check', 'dash', 'x'];
function simbolosFicha1() {
  const sorted = [...state.scoreBands].sort((a, b) => b.min - a.min);
  const out = {};
  ['green', 'yellow', 'red'].forEach((k, i) => { out[k] = sorted[i] ? (sorted[i].simbolo || SIMBOLOS_DEF[i]) : 'box'; });
  return out;
}

/** Items del bloque Condicional: media/máxima del jugador (ficha personal, por evaluación) o columnas del import; refs de Configuración. */
function condicionalItems(positionKey, comp, jugador, evalId) {
  return (state.aspectosComunes.condicional || []).map(label => {
    const ref = state.condicionalRefs?.[positionKey]?.[label] || {};
    const sl = slugify(label);
    const vA = evalId ? jugador?.condicionalPorEval?.[evalId]?.[sl] : null;
    const vB = evalId ? jugador?.condicionalMaxPorEval?.[evalId]?.[sl] : null;
    return { label, valueA: vA ?? comp[label] ?? null, valueB: vB ?? comp[`${label}__B`] ?? null, refA: ref.col3 ?? null, refB: ref.col4 ?? null };
  });
}

// Notas manuales de la Ficha 2: se guardan por jugador y evaluación (jugadores/{id}.fichaNotasManuales[evaluación] = { 'bloque|ítem': nota }).
async function guardarNotasManuales(j, evKey, mapa) {
  const hay = Object.keys(mapa).length > 0;
  const todo = { ...(j.fichaNotasManuales || {}) };
  if (hay) todo[evKey] = mapa; else delete todo[evKey];
  j.fichaNotasManuales = todo;
  const enEstado = state.players.find(x => x.id === j.id);
  if (enEstado && enEstado !== j) enEstado.fichaNotasManuales = todo;
  try { await updateMapEntry('jugadores', j.id, 'fichaNotasManuales', evKey, hay ? mapa : null); }
  catch (err) { console.error(err); showError('No se pudo guardar la nota manual.'); }
}

function buildFichaRealData(positionKey, media, jugador, evalId, ref) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const comp = media?.porCompetencia || {};
  const rated = list => (list || []).map(label => ({ label, value: comp[label] ?? null }));
  const condicional = condicionalItems(positionKey, comp, jugador, evalId);
  return {
    ref: ref || null,
    manual: jugador?.fichaNotasManuales?.[evalId || 'sin-evaluacion'] || null,
    onManual: jugador?.id ? (mapa => guardarNotasManuales(jugador, evalId || 'sin-evaluacion', mapa)) : null,
    player: { name: jugador ? `${jugador.nombre} ${jugador.apellidos}`.trim() : 'Jugador', photoUrl: jugador?.fotoUrl || null },
    blocks: {
      mental:      { rp: [null, null], items: rated(state.aspectosComunes.mental) },
      tecnico:     { rp: [null, null], items: rated(schema.tecnico ?? state.aspectosComunes.tecnico) },
      tactico:     { rp: [null, null], items: rated(schema.tactico) },
      condicional: { rp: null,         items: condicional },
    },
    plan: {
      tecnico: ['', '', '', '', '', '', ''], tactico: ['', '', '', '', '', '', ''],
      condicional: ['', '', '', '', '', '', ''], mental: ['', '', '', '', '', '', ''],
    },
  };
}

const PERFIL_AJUSTE = 0; // puntos que se restan a la nota de los 3 perfiles en la Ficha 1 (0 = nota real)

function buildFicha1RealData(positionKey, media, jugador, aspectos, evalId) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const mental = state.aspectosComunes.mental || [];
  const mid = Math.ceil(mental.length / 2);
  const positionLabel = state.positions.find(p => p.key === positionKey)?.label || FICHA1_DEMO_DATA.player.position;
  const comp = media?.porCompetencia || {};
  const tactico = schema.tactico || [];
  const orderByTactico = selected => tactico.filter(t => (selected || []).includes(t));
  const withStatus = label => ({ label, status: bandKeyForValue(comp[label], state.scoreBands) });

  const perfiles = schema.perfiles || [];
  const perfilCompetencias = schema.perfilCompetencias || {};
  const statusBars = perfiles.map(nombre => {
    // Preferido: puntuación directa del perfil (import CSV/Excel, columnas 4-6).
    // Si no hay, fallback: media de las sub-competencias de perfilCompetencias.
    let mediaPerfil = comp[nombre] != null ? comp[nombre] : null;
    if (mediaPerfil == null) {
      const items = perfilCompetencias[nombre] || [];
      const valores = items.map(it => comp[it]).filter(v => v != null);
      mediaPerfil = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
    }
    // Ajuste opcional de presentación (PERFIL_AJUSTE; 0 = sin ajuste).
    if (mediaPerfil != null) mediaPerfil = Math.max(0, mediaPerfil - PERFIL_AJUSTE);
    const bandHex = mediaPerfil == null ? null : ([...state.scoreBands].sort((a, b) => b.min - a.min).find(b => mediaPerfil >= Number(b.min))?.color || null);
    return { label: nombre, value: mediaPerfil, hex: bandHex, color: bandKeyForValue(mediaPerfil, state.scoreBands) };
  });

  // Círculo central: igual que la Ficha 2 — color de cada cuarto = banda de la media de las notas del bloque.
  const mediaBloque = labels => {
    const v = (labels || []).map(l => comp[l]).filter(x => typeof x === 'number' && !Number.isNaN(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const bandasOrd = [...state.scoreBands].sort((a, b) => b.min - a.min);
  const hexMedia = m => (m == null ? '#ffffff' : (bandasOrd.find(b => m >= Number(b.min))?.color || '#ffffff'));
  const circleColors = {
    mental: hexMedia(mediaBloque(state.aspectosComunes.mental)),
    tecnico: hexMedia(mediaBloque(schema.tecnico ?? state.aspectosComunes.tecnico)),
    tactico: hexMedia(mediaBloque(schema.tactico)),
    condicional: hexMedia(condicionalScore(condicionalItems(positionKey, comp, jugador, evalId), state.condicionalTolerance)),
  };

  return {
    ...FICHA1_DEMO_DATA,
    circleColors,
    gridOrder: state.fichaGridOrder,
    player: {
      ...FICHA1_DEMO_DATA.player,
      name: jugador ? `${jugador.nombre} ${jugador.apellidos}`.trim() : 'Jugador',
      position: positionLabel,
      photoUrl: jugador?.fotoUrl || null,
      birthDate: jugador?.birthDate ? jugador.birthDate.split('-').reverse().join('/') : '',
      maturationalAge: jugador?.maturationalAge || null,
      height: jugador?.height ?? null,
      weight: jugador?.weight ?? null,
      foot: jugador?.foot || '',
      heightOk: null,
      rValue: aspectos?.rp?.r ?? null,
      pValue: aspectos?.rp?.p ?? null,
    },
    statusBars: statusBars.length ? statusBars : FICHA1_DEMO_DATA.statusBars,
    personalidad: {
      col1: mental.slice(0, mid).map(withStatus),
      col2: mental.slice(mid).map(withStatus),
    },
    competenciasOfensivas: orderByTactico(schema.competenciasOfensivas).map(withStatus),
    competenciasDefensivas: orderByTactico(schema.competenciasDefensivas).map(withStatus),
    frasesModelo: state.frasesModelo,
    simbolos: simbolosFicha1(),
    ...(aspectos ? { aspectosOfensivos: aspectos.ofensivos, aspectosDefensivos: aspectos.defensivos } : {}),
  };
}

function buildFichaRealViewHTML() {
  return `
    <div class="mb-16 flex ficha-toolbar" style="justify-content:space-between;align-items:center;">
      <button class="btn btn-ghost" id="ficha-real-volver">← Volver a resultados</button>
      <div class="flex gap-8">
        <button class="btn ${fichaRealSubPage === 1 ? 'btn-primary' : 'btn-sm'}" data-ficha-real-page="1">Ficha 1</button>
        <button class="btn ${fichaRealSubPage === 2 ? 'btn-primary' : 'btn-sm'}" data-ficha-real-page="2">Ficha 2</button>
      </div>
    </div>
    <div id="ficha1-real-wrap" class="ficha-wrap ${fichaRealSubPage === 1 ? '' : 'hidden'}"></div>
    <div id="ficha-real-wrap" class="ficha-wrap ${fichaRealSubPage === 2 ? '' : 'hidden'}"></div>
  `;
}

function renderFichaRealView(container) {
  container.innerHTML = buildFichaRealViewHTML();
  const jugador = state.players.find(p => p.id === fichaRealView.jugadorId);
  const media = bbddResultado?.mediasPorJugador?.[fichaRealView.jugadorId] || null;
  const positionKey = fichaRealView.positionKey;

  renderFichaPagina1(container.querySelector('#ficha1-real-wrap'), buildFicha1RealData(positionKey, media, jugador), LOGO_PATH, state.fichaColors);
  setGpsTolerance(state.condicionalTolerance);
  renderFichaDetalle(container.querySelector('#ficha-real-wrap'), buildFichaRealData(positionKey, media, jugador), LOGO_PATH, state.scoreBands, undefined, state.fichaColors, state.fichaGridOrder);

  container.querySelector('#ficha-real-volver')?.addEventListener('click', () => {
    fichaRealView = null;
    renderBBDDSub(container);
  });
  container.querySelectorAll('[data-ficha-real-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      fichaRealSubPage = Number(btn.dataset.fichaRealPage);
      renderFichaRealView(container);
    });
  });
}

function resetRegImport() {
  regImport = {
    step: 'archivo',   // 'archivo' | 'mapeo' | 'resumen'
    headers: [], rows: [], mapping: {},
    resultado: null,   // { nuevos, sinCambios, conCambios, errores }
    pendientes: [],    // filas con jugador dudoso/sin match, a resolver a mano
    decisiones: {},    // { rowKey: 'mantener'|'reemplazar' } para conCambios
    busy: false,
  };
}

async function ensureEvaluacionesLoaded(container) {
  if (regEvaluaciones !== null) return;
  if (isFirebaseUnconfigured()) { regEvaluaciones = []; return; }
  try {
    regEvaluaciones = await listarEvaluaciones();
  } catch (err) {
    console.error('[Firestore] No se pudieron cargar las evaluaciones:', err);
    regEvaluaciones = [];
    showError('No se pudieron cargar las evaluaciones.');
  }
  renderPanelRegistro(container);
}

function mediaGeneralDe(media) {
  const vals = Object.values(media?.porAspecto || {}).filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ── Registro: contexto de evaluación ──────────────

function buildEvaluacionFormHTML() {
  const ev = regEvalEditId ? regEvaluaciones.find(e => e.id === regEvalEditId) : null;
  return `
    <div class="card mb-16">
      <div class="card-title">${ev ? 'Editar evaluación' : 'Nueva evaluación'}</div>
      <div class="card-body">
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <div class="field-group" style="min-width:150px;">
            <label class="label">Temporada</label>
            <select class="select" id="ev-temporada">${state.seasons.map(s => `<option value="${safeText(s)}" ${ev?.temporada === s ? 'selected' : ''}>${safeText(s)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:220px;">
            <label class="label">Nombre / periodo</label>
            <input class="input" type="text" id="ev-nombre" placeholder="Ej. Evaluación enero" value="${safeText(ev?.nombre || '')}" />
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Posición</label>
            <select class="select" id="ev-posicion">${state.positions.map(p => `<option value="${p.key}" ${ev?.posicionKey === p.key ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Tipo de evaluación</label>
            <input class="input" type="text" id="ev-tipo" placeholder="Ej. Trimestral" value="${safeText(ev?.tipo || '')}" />
          </div>
          <div class="field-group" style="min-width:140px;">
            <label class="label">Fecha inicio</label>
            <input class="input" type="date" id="ev-fecha-ini" value="${safeText(ev?.fechaInicio || '')}" />
          </div>
          <div class="field-group" style="min-width:140px;">
            <label class="label">Fecha fin</label>
            <input class="input" type="date" id="ev-fecha-fin" value="${safeText(ev?.fechaFin || '')}" />
          </div>
        </div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="ev-crear">${ev ? 'Guardar cambios' : 'Crear evaluación'}</button>
          <button class="btn btn-ghost" id="ev-cancelar">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function buildEvaluacionesListHTML() {
  if (!regEvaluaciones) return '<p class="text-xs text-muted">Cargando evaluaciones…</p>';
  if (!regEvaluaciones.length) return '<p class="text-xs text-muted">Sin evaluaciones todavía.</p>';
  const rows = regEvaluaciones.map(ev => `
    <tr style="${regEvalSel === ev.id ? 'background:var(--bg-hover);' : ''}">
      <td>${safeText(ev.temporada)}</td>
      <td>${safeText(ev.nombre)}</td>
      <td>${safeText(state.positions.find(p => p.key === ev.posicionKey)?.label || ev.posicionKey)}</td>
      <td>${safeText(ev.tipo || '-')}</td>
      <td>${safeText(ev.fechaInicio || '-')}${ev.fechaFin ? ' – ' + safeText(ev.fechaFin) : ''}</td>
      <td class="flex gap-8">
        <button class="btn btn-sm" data-ev-importar="${ev.id}">Importar CSV</button>
        <button class="btn btn-sm" data-ev-editar="${ev.id}">Editar</button>
        <button class="btn btn-sm" data-ev-borrar="${ev.id}">Borrar</button>
      </td>
    </tr>
  `).join('');
  return `
    <div style="overflow-x:auto;">
      <table class="table table-compact">
        <thead><tr><th>Temporada</th><th>Nombre</th><th>Posición</th><th>Tipo</th><th>Fechas</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Registro: wizard de importación CSV ───────────

function buildImportWizardHTML() {
  const ev = regEvaluaciones.find(e => e.id === regEvalSel);
  if (!ev) return '';
  const posLabel = state.positions.find(p => p.key === ev.posicionKey)?.label || ev.posicionKey;
  let body = '';

  if (regImport.step === 'archivo') {
    body = `
      <p class="text-xs text-muted mb-16">Sube el archivo (CSV o Excel). En el siguiente paso indicas qué es cada columna — no hace falta que las columnas se llamen de una forma concreta.</p>
      <input class="input" type="file" id="import-file" accept=".csv,.xlsx,.xls" />
      <div class="flex gap-8 mt-16"><button class="btn btn-ghost" id="import-cancelar">Cancelar</button></div>
    `;
  } else if (regImport.step === 'mapeo') {
    const schema = state.criteriaSchemas[ev.posicionKey] || {};
    const perfiles = schema.perfiles || [];
    const aspectoPorCompetencia = buildAspectoPorCompetencia(state, ev.posicionKey);
    const competencias = Object.keys(aspectoPorCompetencia);
    const optionsFor = header => {
      const sel = regImport.mapping[header] || '';
      const o = (v, l) => `<option value="${safeText(v)}" ${sel === v ? 'selected' : ''}>${safeText(l)}</option>`;
      return [
        `<option value="">— Ignorar columna —</option>`,
        o('@fecha', 'Fecha y hora'), o('@evaluador', 'Evaluador'), o('@jugador', 'Jugador'),
        o('equipo', 'Equipo (opcional — ayuda a identificar al jugador)'),
        ...Object.entries({ ...RP_DESTINOS, ...TEXTOS_DESTINOS }).map(([k, l]) => o(k, l)),
        ...perfiles.filter(Boolean).map(p => o(p, `Perfil: ${p}`)),
        ...competencias.flatMap(c => aspectoPorCompetencia[c] === 'condicional' ? [
          o(c + '::A', `Condicional: ${c} — valor 1`), o(c + '::B', `Condicional: ${c} — valor 2`),
        ] : [
          o(c, `Competencia: ${c} (${aspectoPorCompetencia[c]})`),
        ]),
      ].join('');
    };
    body = `
      <p class="text-xs text-muted mb-16">${regImport.rows.length} filas leídas${regImport.omitidas ? ` (${regImport.omitidas} filas de cabecera omitidas)` : ''}${regImport.precargado ? '. Mapeo precargado desde Configuración → Columnas encuesta' : ''}. Indica qué es cada columna (obligatorio: Jugador y Evaluador). Posición: ${safeText(posLabel)}.</p>
      <div style="overflow-x:auto;">
        <table class="table table-compact">
          <thead><tr><th>Columna del archivo</th><th>Ejemplo</th><th>Se importa como</th></tr></thead>
          <tbody>
            ${regImport.headers.map(h => `
              <tr>
                <td>${safeText(h)}</td>
                <td class="text-muted">${safeText(String(regImport.rows[0]?.[h] ?? '').slice(0, 40))}</td>
                <td><select class="select" data-map-col="${safeText(h)}">${optionsFor(h)}</select></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="flex gap-8 mt-16">
        <button class="btn btn-primary" id="import-validar">Validar</button>
        <button class="btn btn-ghost" id="import-cancelar">Cancelar</button>
      </div>
    `;
  } else if (regImport.step === 'resumen') {
    body = buildResumenImportHTML(regImport.resultado);
  }

  return `<div class="card mb-16"><div class="card-title">Importar CSV — ${safeText(ev.nombre)} (${safeText(posLabel)}, ${safeText(ev.temporada)})</div><div class="card-body">${body}</div></div>`;
}

/** Pendientes agrupados por nombre (sin tildes/mayúsculas): una decisión por nombre vale para todas sus filas. */
function gruposPendientes() {
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const mapa = new Map();
  regImport.pendientes.forEach(f => {
    const k = norm(f.jugadorNombreArchivo);
    if (!mapa.has(k)) mapa.set(k, { nombre: f.jugadorNombreArchivo, filas: [], candidates: f.matchCandidates || [] });
    mapa.get(k).filas.push(f);
  });
  return [...mapa.values()];
}

function buildResumenImportHTML(r) {
  if (!r) return '';
  const grupos = gruposPendientes();
  const todos = [...state.players].sort((x, y) => `${x.apellidos} ${x.nombre}`.localeCompare(`${y.apellidos} ${y.nombre}`, 'es'));
  const etiqueta = p => `${p.nombre || ''} ${p.apellidos || ''}`.trim() + (p.teamKey ? ` (${TEAMS.find(t => t.key === p.teamKey)?.label || p.teamKey})` : '');
  const pendHTML = grupos.length ? `
    <div class="mb-16">
      <div class="text-xs text-muted mb-8" style="font-weight:700;text-transform:uppercase;">Pendientes de identificar (${grupos.length} nombres, ${regImport.pendientes.length} filas)</div>
      <p class="text-xs text-muted mb-8">Elige a quién corresponde cada nombre: vale para todas sus filas y se guarda como alias, así la próxima vez se reconoce solo.</p>
      <div class="text-xs mb-8" style="background:#fef3c7;border:1px solid #f59e0b;color:#78350f;padding:8px 10px;border-radius:6px;line-height:1.5;">
        ⚠ <b>Estos jugadores no se meten en la BBDD porque no se sabe quiénes son. Comprobadlos:</b><br>
        ${grupos.map(g => `${safeText(g.nombre)} (${g.filas.length})`).join(' · ')}
      </div>
      <table class="table table-compact">
        <thead><tr><th>Nombre en archivo</th><th>Filas</th><th>Asignar a</th></tr></thead>
        <tbody>
          ${grupos.map((g, i) => {
            const ids = new Set(g.candidates.map(c => c.id));
            const unico = g.candidates.length === 1 ? g.candidates[0].id : '';
            return `
            <tr>
              <td>${safeText(g.nombre)}</td>
              <td>${g.filas.length}</td>
              <td>
                <select class="select" data-pend-select="${i}">
                  <option value="">— Ignorar estas filas —</option>
                  ${g.candidates.length ? `<optgroup label="Parecidos">${g.candidates.map(c => `<option value="${c.id}" ${c.id === unico ? 'selected' : ''}>${safeText(etiqueta(c))}</option>`).join('')}</optgroup>` : ''}
                  <optgroup label="Todos los jugadores">${todos.filter(p => !ids.has(p.id)).map(p => `<option value="${p.id}">${safeText(etiqueta(p))}</option>`).join('')}</optgroup>
                </select>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <button class="btn btn-sm mt-8" id="import-aplicar-pendientes">Aplicar identificaciones</button>
    </div>
  ` : '';

  const cambiosHTML = r.conCambios.length ? `
    <div class="mb-16">
      <div class="text-xs text-muted mb-8" style="font-weight:700;text-transform:uppercase;">Existentes con valores distintos (${r.conCambios.length}) — por defecto se mantiene el existente</div>
      <table class="table table-compact">
        <thead><tr><th>Jugador (archivo)</th><th>Evaluador</th><th>Decisión</th></tr></thead>
        <tbody>
          ${r.conCambios.map(f => `
            <tr>
              <td>${safeText(f.jugadorNombreArchivo)}</td>
              <td>${safeText(f.evaluador)}</td>
              <td>
                <select class="select" data-decision="${safeText(f.rowKey)}">
                  <option value="mantener" ${(regImport.decisiones[f.rowKey] || 'mantener') === 'mantener' ? 'selected' : ''}>Mantener existente</option>
                  <option value="reemplazar" ${regImport.decisiones[f.rowKey] === 'reemplazar' ? 'selected' : ''}>Sustituir por el nuevo</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  return `
    <ul class="text-xs mb-16" style="line-height:1.8;">
      <li><b>${r.nuevos.length}</b> nuevos — se importarán</li>
      <li><b>${r.sinCambios.length}</b> existentes sin cambios — se ignoran</li>
      <li><b>${r.conCambios.length}</b> existentes con cambios — decides abajo</li>
      <li><b>${r.errores.length}</b> con error — no se importan</li>
      <li><b>${regImport.pendientes.length}</b> pendientes de identificar</li>
    </ul>
    ${r.errores.length ? `<div class="text-xs text-muted mb-16">Errores: ${r.errores.map(f => safeText((f.error || '') + ' — ' + (f.jugadorNombreArchivo || ''))).join(' · ')}</div>` : ''}
    ${pendHTML}
    ${cambiosHTML}
    <div class="flex gap-8 mt-16">
      <button class="btn btn-primary" id="import-confirmar" ${regImport.busy ? 'disabled' : ''}>${regImport.busy ? 'Importando…' : 'Confirmar importación'}</button>
      <button class="btn btn-ghost" id="import-cancelar">Cancelar</button>
    </div>
  `;
}

/** De filas parseadas + mapeo → clasificación NUEVO/SIN CAMBIOS/CON CAMBIOS/ERROR (auditoría §15). */
async function procesarImport(container) {
  const ev = regEvaluaciones.find(e => e.id === regEvalSel);
  const schema = state.criteriaSchemas[ev.posicionKey] || {};
  const perfiles = schema.perfiles || [];
  // IDs estables (ficha-espejo.js): además de puntuaciones{nombre}, cada registro
  // nuevo guarda puntuacionesId{id}. Retrocompatible: lo antiguo se sigue leyendo por nombre.
  const catalogo = buildCatalogo(state, ev.posicionKey);
  const idPorClave = {};
  catalogo.lista.forEach(c => { if (!(c.clave in idPorClave)) idPorClave[c.clave] = c.id; });
  // Columnas de fecha/evaluador/jugador/equipo: las que el usuario mapeó (Configuración → Columnas encuesta).
  const colDe = tok => Object.keys(regImport.mapping).find(h => regImport.mapping[h] === tok);
  const colFecha = colDe('@fecha'), colEvaluador = colDe('@evaluador'), colJugador = colDe('@jugador');
  const colEquipo = colDe('equipo');
  const teamKeyPorLabel = raw => TEAMS.find(t => t.label.toLowerCase().trim() === String(raw || '').toLowerCase().trim())?.key || null;

  const filas = regImport.rows.map(row => {
    const jugadorNombreArchivo = (row[colJugador] || '').trim();
    const evaluador = (row[colEvaluador] || '').trim();
    const fechaRegistro = colFecha ? (row[colFecha] || '').trim() || null : null;
    if (!jugadorNombreArchivo || !evaluador) {
      return { error: 'Falta jugador o evaluador', jugadorNombreArchivo, evaluador };
    }
    const puntuaciones = {};
    const puntuacionesId = {};
    const textos = {}; // respuestas abiertas → recuadros de la Ficha 1
    Object.entries(regImport.mapping).forEach(([header, target]) => {
      if (!target || !target.startsWith('@txt_')) return;
      const t = String(row[header] ?? '').trim();
      if (t) textos[target.slice(5)] = t;
    });
    const rp = {}; // R / P de la Ficha 1
    Object.entries(regImport.mapping).forEach(([header, target]) => {
      if (target !== '@r' && target !== '@p') return;
      const v = parseEsNumber(row[header]);
      if (v != null) rp[target.slice(1)] = v;
    });
    let invalido = false;

    Object.entries(regImport.mapping).forEach(([header, target]) => {
      if (!target || target === 'equipo' || target.startsWith('@')) return;
      const raw = row[header];
      if (raw === '' || raw == null) return;
      const val = parseEsNumber(raw);
      if (val == null) { invalido = true; return; }
      // Condicional con dos columnas: "Item::A" → Item (valor 1), "Item::B" → Item__B (valor 2)
      const key = target.endsWith('::A') ? target.slice(0, -3) : target.endsWith('::B') ? target.slice(0, -3) + '__B' : target;
      puntuaciones[key] = val;
      if (idPorClave[key]) puntuacionesId[idPorClave[key]] = val;
    });
    if (invalido) return { error: 'Valor no numérico', jugadorNombreArchivo, evaluador };

    const teamKey = colEquipo ? teamKeyPorLabel(row[colEquipo]) : null;
    const match = matchJugador(jugadorNombreArchivo, state.players, { teamKey });
    if (match.status !== 'auto') {
      return { jugadorNombreArchivo, evaluador, puntuaciones, puntuacionesId, textos, rp, fechaRegistro, matchStatus: match.status, matchCandidates: match.candidates };
    }
    const jugadorId = match.playerId;
    const rowKey = buildRowKey({ evaluacionId: ev.id, jugadorId, jugadorNombreArchivo, evaluador });
    return { jugadorNombreArchivo, evaluador, puntuaciones, puntuacionesId, textos, rp, fechaRegistro, jugadorId, rowKey };
  });

  regImport.pendientes = filas.filter(f => !f.error && !f.jugadorId);
  const resueltas = filas.filter(f => f.error || f.jugadorId);

  let existentes = [];
  try {
    existentes = await queryRegistros({ evaluacionId: ev.id });
  } catch (err) {
    console.error('[Firestore] No se pudieron leer los registros existentes:', err);
    showError('No se pudo comprobar duplicados (revisa las reglas/índices de Firestore).');
  }

  regImport.resultado = clasificarFilas(resueltas, existentes);
  regImport.decisiones = {};
  regImport.step = 'resumen';
  renderPanelRegistro(container);
}

function renderRegistroSub(container) {
  const wizard = regEvalSel ? buildImportWizardHTML() : '';
  container.innerHTML = `
    <div class="card mb-16">
      <div class="card-title">Evaluaciones (contexto de importación)</div>
      <div class="card-body">
        ${regEvalFormOpen ? buildEvaluacionFormHTML() : `<button class="btn btn-primary mb-16" id="reg-nueva-ev">+ Nueva evaluación</button>`}
        ${buildEvaluacionesListHTML()}
      </div>
    </div>
    ${wizard}
  `;

  container.querySelector('#reg-nueva-ev')?.addEventListener('click', () => {
    regEvalFormOpen = true;
    regEvalEditId = null;
    renderRegistroSub(container);
  });
  container.querySelector('#ev-cancelar')?.addEventListener('click', () => {
    regEvalFormOpen = false;
    regEvalEditId = null;
    renderRegistroSub(container);
  });
  container.querySelector('#ev-crear')?.addEventListener('click', async () => {
    const data = {
      temporada:   container.querySelector('#ev-temporada').value,
      nombre:      container.querySelector('#ev-nombre').value.trim(),
      posicionKey: container.querySelector('#ev-posicion').value,
      tipo:        container.querySelector('#ev-tipo').value.trim() || null,
      fechaInicio: container.querySelector('#ev-fecha-ini').value || null,
      fechaFin:    container.querySelector('#ev-fecha-fin').value || null,
    };
    if (!data.nombre) { showError('Ponle un nombre/periodo a la evaluación.'); return; }
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para crear evaluaciones.'); return; }
    try {
      if (regEvalEditId) {
        await actualizarEvaluacion(regEvalEditId, data);
        regEvaluaciones = regEvaluaciones.map(e => e.id === regEvalEditId ? { ...e, ...data } : e);
        showSuccess('Evaluación actualizada.');
      } else {
        const id = await crearEvaluacion(data);
        regEvaluaciones = [...regEvaluaciones, { id, ...data }];
        showSuccess('Evaluación creada.');
      }
      regEvalFormOpen = false;
      regEvalEditId = null;
      renderRegistroSub(container);
    } catch (err) {
      console.error('[Firestore] No se pudo guardar la evaluación:', err);
      showError('No se pudo guardar la evaluación (revisa las reglas de Firestore).');
    }
  });

  container.querySelectorAll('[data-ev-importar]').forEach(btn => {
    btn.addEventListener('click', () => {
      regEvalSel = btn.dataset.evImportar;
      resetRegImport();
      renderRegistroSub(container);
    });
  });

  container.querySelectorAll('[data-ev-editar]').forEach(btn => {
    btn.addEventListener('click', () => {
      regEvalEditId = btn.dataset.evEditar;
      regEvalFormOpen = true;
      renderRegistroSub(container);
    });
  });

  container.querySelectorAll('[data-ev-borrar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.evBorrar;
      if (isFirebaseUnconfigured()) { showError('Configura Firebase para borrar evaluaciones.'); return; }
      try {
        const registrosDeEsta = await queryRegistros({ evaluacionId: id });
        const aviso = registrosDeEsta.length
          ? `Esta evaluación tiene ${registrosDeEsta.length} registro(s) importado(s). Se borrará el CONTEXTO (temporada/posición/tipo), pero los registros individuales NO se borran — quedarán sin evaluación asociada. ¿Seguro?`
          : '¿Borrar esta evaluación?';
        if (!confirm(aviso)) return;
        await eliminarEvaluacion(id);
        regEvaluaciones = regEvaluaciones.filter(e => e.id !== id);
        if (regEvalSel === id) { regEvalSel = null; resetRegImport(); }
        showSuccess('Evaluación borrada.');
        renderRegistroSub(container);
      } catch (err) {
        console.error('[Firestore] No se pudo borrar la evaluación:', err);
        showError('No se pudo borrar (revisa las reglas de Firestore).');
      }
    });
  });

  container.querySelector('#import-file')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const esExcel = /\.(xlsx|xls)$/i.test(file.name);
    let parsed;
    try {
      parsed = esExcel ? parseXLSXBuffer(await file.arrayBuffer()) : parseCSV(await file.text());
    } catch (err) {
      console.error('[Import] No se pudo leer el archivo:', err);
      showError('No se pudo leer el archivo (¿formato correcto?).');
      return;
    }
    if (!parsed.headers.length) { showError('No se pudo leer el archivo (¿está vacío?).'); return; }
    if (parsed.headers.length < 6) { showError('El archivo debe tener al menos 6 columnas: fecha, evaluador, jugador y 3 perfiles.'); return; }
    // Estructura fija de las encuestas: se omiten filas de cabecera (números/aspecto/preguntas),
    // la fecha se normaliza a ISO y el mapeo de columnas 7+ llega precargado (editable).
    const evImp = regEvaluaciones.find(x => x.id === regEvalSel);
    const mapeoInicial = mapeoPorDefecto(state, evImp?.posicionKey, parsed.headers.length);
    const colFechaImp = Object.keys(mapeoInicial).find(h => mapeoInicial[h] === '@fecha') || 'Columna 1';
    const limpio = quitarCabeceras(parsed.rows, colFechaImp);
    regImport.headers = parsed.headers;
    regImport.rows = normalizarFechas(limpio.rows, colFechaImp);
    regImport.omitidas = limpio.omitidas;
    regImport.mapping = mapeoInicial;
    regImport.precargado = Object.keys(regImport.mapping).length > 0;
    regImport.step = 'mapeo';
    renderRegistroSub(container);
  });

  container.querySelector('#import-cancelar')?.addEventListener('click', () => {
    regEvalSel = null;
    resetRegImport();
    renderRegistroSub(container);
  });

  container.querySelectorAll('[data-map-col]').forEach(sel => {
    sel.addEventListener('change', () => { regImport.mapping[sel.dataset.mapCol] = sel.value; });
  });

  container.querySelector('#import-validar')?.addEventListener('click', () => {
    const vals = Object.values(regImport.mapping);
    if (!vals.includes('@jugador') || !vals.includes('@evaluador')) { showError('Indica qué columna es el Jugador y cuál el Evaluador.'); return; }
    procesarImport(container);
  });

  container.querySelectorAll('[data-decision]').forEach(sel => {
    sel.addEventListener('change', () => { regImport.decisiones[sel.dataset.decision] = sel.value; });
  });

  container.querySelector('#import-aplicar-pendientes')?.addEventListener('click', async () => {
    const resueltos = [];
    const restantes = [];
    const aliasUpdates = new Map(); // playerId -> Set(nombres del archivo)
    const grupos = gruposPendientes();
    const grupoDe = new Map(); // fila → índice de grupo
    grupos.forEach((g, gi) => g.filas.forEach(f => grupoDe.set(f, gi)));
    regImport.pendientes.forEach(f => {
      const sel = container.querySelector(`[data-pend-select="${grupoDe.get(f)}"]`);
      const playerId = sel?.value || '';
      if (!playerId) { restantes.push(f); return; }
      const rowKey = buildRowKey({ evaluacionId: regEvalSel, jugadorId: playerId, jugadorNombreArchivo: f.jugadorNombreArchivo, evaluador: f.evaluador });
      resueltos.push({ jugadorNombreArchivo: f.jugadorNombreArchivo, evaluador: f.evaluador, puntuaciones: f.puntuaciones, puntuacionesId: f.puntuacionesId, textos: f.textos || {}, rp: f.rp || {}, fechaRegistro: f.fechaRegistro, jugadorId: playerId, rowKey });
      if (!aliasUpdates.has(playerId)) aliasUpdates.set(playerId, new Set());
      aliasUpdates.get(playerId).add(f.jugadorNombreArchivo);
    });

    // Guarda las equivalencias confirmadas como alias — nunca sustituye el nombre oficial (auditoría §5)
    for (const [playerId, nombres] of aliasUpdates) {
      const player = state.players.find(p => p.id === playerId);
      if (!player) continue;
      const aliases = [...new Set([...(player.aliases || []), ...nombres])];
      try {
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', playerId, { aliases });
        setState({ players: state.players.map(p => p.id === playerId ? { ...p, aliases } : p) });
      } catch (err) {
        console.error('[Firestore] No se pudo guardar el alias:', err);
      }
    }

    regImport.pendientes = restantes;

    let existentes = [];
    try { existentes = await queryRegistros({ evaluacionId: regEvalSel }); } catch (err) { console.error('[Firestore]', err); }
    const todas = [
      ...resueltos,
      ...regImport.resultado.nuevos,
      ...regImport.resultado.sinCambios,
      ...regImport.resultado.conCambios.map(({ existente, ...rest }) => rest),
      ...regImport.resultado.errores,
    ];
    regImport.resultado = clasificarFilas(todas, existentes);
    renderRegistroSub(container);
  });

  container.querySelector('#import-confirmar')?.addEventListener('click', async () => {
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para importar.'); return; }
    const ev = regEvaluaciones.find(e => e.id === regEvalSel);
    const r = regImport.resultado;
    regImport.busy = true;
    renderRegistroSub(container);
    try {
      for (const fila of r.nuevos) {
        await crearRegistro({
          evaluacionId: ev.id, temporada: ev.temporada, posicionKey: ev.posicionKey, tipo: ev.tipo || null,
          jugadorId: fila.jugadorId, jugadorNombreArchivo: fila.jugadorNombreArchivo, evaluador: fila.evaluador,
          puntuaciones: fila.puntuaciones, puntuacionesId: fila.puntuacionesId || {}, textos: fila.textos || {}, rp: fila.rp || {}, fechaRegistro: fila.fechaRegistro || null, rowKey: fila.rowKey, origen: 'csv',
        });
      }
      let sustituidos = 0;
      for (const fila of r.conCambios) {
        if ((regImport.decisiones[fila.rowKey] || 'mantener') === 'reemplazar') {
          await actualizarRegistro(fila.existente.id, {
            puntuaciones: fila.puntuaciones, puntuacionesId: fila.puntuacionesId || {}, textos: fila.textos || {}, rp: fila.rp || {}, jugadorNombreArchivo: fila.jugadorNombreArchivo, evaluador: fila.evaluador,
            fechaRegistro: fila.fechaRegistro || null,
          });
          sustituidos++;
        }
      }
      const noIdent = [...new Set(regImport.pendientes.map(f => f.jugadorNombreArchivo))];
      showSuccess(`Importado: ${r.nuevos.length} nuevos, ${sustituidos} sustituidos.` + (noIdent.length ? ` NO importados (sin identificar, comprobad): ${noIdent.join(', ')}.` : ''));
      regEvalSel = null;
      resetRegImport();
      renderRegistroSub(container);
    } catch (err) {
      console.error('[Firestore] Error importando registros:', err);
      showError('Error al importar (revisa las reglas de Firestore).');
      regImport.busy = false;
      renderRegistroSub(container);
    }
  });
}

// ── BBDD: filtros + medias/individuales/todo ──────

/** Columnas de la encuesta (ver importar-plantilla.js) para una posición, con el nombre de cada competencia. */
function columnasEncuesta(positionKey) {
  // TODAS las columnas (1-51), tengan o no destino: así la tabla refleja siempre tu plantilla.
  return columnasEfectivas(state, positionKey);
}

/** Tabla de registros con las columnas de la encuesta; las notas son editables y se guardan al salir de la celda. */
function buildTablaEncuestaHTML(registros, positionKey, jugadorLabel) {
  const cols = columnasEncuesta(positionKey);
  const posLabel = state.positions.find(p => p.key === positionKey)?.label || positionKey;
  const fmtFecha = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : (f || '—'); };
  // Fecha / evaluador / jugador se ven siempre (aunque la columna no se importe a ninguna competencia):
  // los marcados con @ y, si no hay marca, las columnas 1, 2 y 3 sin destino.
  const tieneToken = t => cols.some(c => c.destino === t);
  const tipoCol = c => {
    if (['@fecha', '@evaluador', '@jugador'].includes(c.destino)) return c.destino;
    if (!c.destino && c.num === 1 && !tieneToken('@fecha')) return '@fecha';
    if (!c.destino && c.num === 2 && !tieneToken('@evaluador')) return '@evaluador';
    if (!c.destino && c.num === 3 && !tieneToken('@jugador')) return '@jugador';
    return c.destino;
  };
  const celda = (r, c) => {
    const t = tipoCol(c);
    if (t === '@fecha') return `<td class="bt-nowrap">${safeText(fmtFecha(r.fechaRegistro))}</td>`;
    if (t === '@evaluador') return `<td class="bt-nowrap">${safeText(r.evaluador)}</td>`;
    if (t === '@jugador') return `<td class="bt-nowrap bt-bold">${safeText(jugadorLabel(r.jugadorId))}</td>`;
    if (!t || t === 'equipo') return `<td class="bt-vacia"></td>`;
    if (t.startsWith('@txt_')) return `<td class="bt-texto">${safeText(r.textos?.[t.slice(5)] ?? '')}</td>`;
    const valor = t === '@r' || t === '@p' ? r.rp?.[t.slice(1)] : r.puntuaciones?.[t];
    return `<td class="bt-num"><input class="input" type="text" inputmode="decimal" data-reg-edit="${r.id}" data-clave="${safeText(t)}" value="${safeText(valor ?? '')}" /></td>`;
  };
  const rows = registros.length
    ? registros.map(r => `<tr>${cols.map(c => celda(r, c)).join('')}</tr>`).join('')
    : `<tr>${cols.map(() => '<td class="bt-vacia"></td>').join('')}</tr>`;
  return `
    <style>
      .bt-wrap { overflow:auto; max-height:75vh; border:1px solid #cbd5e1; border-radius:6px; background:#fff; }
      .bt { border-collapse:collapse; width:max-content; min-width:100%; background:#fff; color:#0f1117; font-size:11px; }
      .bt th { background:var(--header-bg, #1d4ed8); color:#fff; font-size:9.5px; font-weight:700; line-height:1.2; text-transform:uppercase; letter-spacing:.1px;
               text-align:center; vertical-align:middle; padding:5px 4px; width:72px; min-width:72px; max-width:72px; border-left:1px solid rgba(255,255,255,.35); overflow-wrap:anywhere; hyphens:auto; position:sticky; top:0; z-index:1; }
      .bt th.bt-th-txt { width:380px; min-width:380px; max-width:380px; }
      .bt th:first-child { border-left:none; }
      .bt th .bt-n { display:block; font-size:9px; font-weight:600; opacity:.75; margin-bottom:2px; }
      .bt td { background:#fff; color:#0f1117; padding:1px 5px; border-left:1px solid #cbd5e1; border-top:1px solid #cbd5e1; text-align:center; vertical-align:middle; line-height:1.25; height:22px; }
      .bt td:first-child { border-left:none; }
      .bt tbody tr:nth-child(even) td { background:#f8fafc; }
      .bt .bt-nowrap { white-space:nowrap; }
      .bt .bt-bold { font-weight:700; text-align:left; }
      .bt .bt-texto { width:380px; min-width:380px; max-width:380px; font-size:10px; line-height:1.25; text-align:left; vertical-align:top; padding-top:3px; padding-bottom:3px; }
      .bt .bt-vacia { height:22px; }
      .bt .bt-num { padding:0; }
      .bt .bt-num input { width:100%; box-sizing:border-box; height:22px; font-size:11px; padding:0 2px; text-align:center; background:transparent; color:#0f1117; border:none; border-radius:0; box-shadow:none; }
      .bt .bt-num input:focus { outline:2px solid var(--blue-500, #3b82f6); outline-offset:-2px; background:#fff; }
    </style>
    <p class="text-xs text-muted mb-8">${safeText(posLabel)} · ${registros.length} registros · ${cols.length} columnas según Configuración → Columnas encuesta. Edita una nota y sal de la celda para guardar.</p>
    <div class="bt-wrap"><table class="bt">
      <thead><tr>${cols.map(c => `<th class="${String(tipoCol(c) || '').startsWith('@txt_') ? 'bt-th-txt' : ''}" title="Columna ${c.num} de la encuesta"><span class="bt-n">${c.num}</span>${safeText(c.nombre)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/** Posición cuyas columnas se muestran aunque no haya datos: la del filtro, la de la evaluación elegida o la primera. */
function posicionBBDD() {
  const ev = bbddFiltros.evaluacionId ? (regEvaluaciones || []).find(e => e.id === bbddFiltros.evaluacionId) : null;
  return bbddFiltros.posicionKey || ev?.posicionKey || state.positions[0]?.key || null;
}

function buildBBDDResultadosHTML() {
  const tablaVacia = () => { const pk = posicionBBDD(); return pk ? buildTablaEncuestaHTML([], pk, () => '') : ''; };
  if (!bbddResultado) return tablaVacia() + '<p class="text-xs text-muted mt-8">Aplica filtros y pulsa Buscar.</p>';
  const { registros, mediasPorJugador } = bbddResultado;
  if (!registros.length) return tablaVacia() + '<p class="text-xs text-muted mt-8">Sin registros para estos filtros.</p>';

  const jugadorLabel = id => {
    const p = state.players.find(x => x.id === id);
    return p ? `${p.nombre} ${p.apellidos}` : '(sin identificar)';
  };

  if (bbddFiltros.vista === 'individuales') {
    const posKeys = [...new Set(registros.map(r => r.posicionKey))];
    if (posKeys.length === 1) return buildTablaEncuestaHTML(registros, posKeys[0], jugadorLabel);
    const rows = registros.map(r => `
      <tr><td>${safeText(jugadorLabel(r.jugadorId))}</td><td>${safeText(r.evaluador)}</td><td>${Object.keys(r.puntuaciones || {}).length} valores</td></tr>
    `).join('');
    return `<p class="text-xs text-muted mb-8">Filtra por una posición (o una evaluación) para ver la tabla con las columnas de la encuesta, editable.</p><table class="table table-compact"><thead><tr><th>Jugador</th><th>Evaluador</th><th>Datos</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const porJugador = {};
  registros.forEach(r => { if (r.jugadorId) (porJugador[r.jugadorId] = porJugador[r.jugadorId] || []).push(r); });

  const rows = Object.entries(mediasPorJugador).map(([jugadorId, media]) => {
    const general = mediaGeneralDe(media);
    const regsJ = porJugador[jugadorId] || [];
    const detalle = bbddFiltros.vista === 'todo' ? `
      <tr><td colspan="4" style="padding:6px 0 14px 0;">
        ${[...new Set(regsJ.map(r => r.posicionKey))].map(pk => buildTablaEncuestaHTML(regsJ.filter(r => r.posicionKey === pk), pk, jugadorLabel)).join('')}
      </td></tr>
    ` : '';
    return `
      <tr style="font-weight:700;background:var(--bg-hover);">
        <td>${safeText(jugadorLabel(jugadorId))}</td><td>MEDIA</td><td>${general != null ? general.toFixed(2) : '-'}</td>
        <td>${jugadorId ? `<button class="btn btn-sm" data-ver-ficha="${jugadorId}">Ver ficha</button>` : ''}</td>
      </tr>
      ${detalle}
    `;
  }).join('');

  return `<table class="table table-compact"><thead><tr><th>Jugador</th><th></th><th>Media general</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildBBDDPanelHTML() {
  const evOptions = (regEvaluaciones || []).map(ev => `<option value="${ev.id}" ${bbddFiltros.evaluacionId === ev.id ? 'selected' : ''}>${safeText(ev.nombre)} (${safeText(ev.temporada)})</option>`).join('');
  return `
    <div class="card mb-16 rm-sticky rm-sticky-2">
      <div class="card-title">Filtros</div>
      <div class="card-body">
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <div class="field-group" style="min-width:200px;">
            <label class="label">Evaluación</label>
            <select class="select" id="bbdd-evaluacion"><option value="">— Todas —</option>${evOptions}</select>
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Temporada</label>
            <select class="select" id="bbdd-temporada"><option value="">— Todas —</option>${state.seasons.map(s => `<option value="${safeText(s)}" ${bbddFiltros.temporada === s ? 'selected' : ''}>${safeText(s)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Posición</label>
            <select class="select" id="bbdd-posicion"><option value="">— Todas —</option>${state.positions.map(p => `<option value="${p.key}" ${bbddFiltros.posicionKey === p.key ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:180px;">
            <label class="label">Jugador</label>
            <select class="select" id="bbdd-jugador"><option value="">— Todos —</option>${state.players.map(p => `<option value="${p.id}" ${bbddFiltros.jugadorId === p.id ? 'selected' : ''}>${safeText(p.nombre)} ${safeText(p.apellidos)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Evaluador</label>
            <input class="input" type="text" id="bbdd-evaluador" value="${safeText(bbddFiltros.evaluador)}" placeholder="Nombre del evaluador" />
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Vista</label>
            <select class="select" id="bbdd-vista">
              <option value="todo" ${bbddFiltros.vista === 'todo' ? 'selected' : ''}>Todo</option>
              <option value="medias" ${bbddFiltros.vista === 'medias' ? 'selected' : ''}>Solo medias</option>
              <option value="individuales" ${bbddFiltros.vista === 'individuales' ? 'selected' : ''}>Tabla de la encuesta (registros individuales)</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary mt-16" id="bbdd-buscar">${bbddBusy ? 'Buscando…' : 'Buscar'}</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Resultados</div>
      <div class="card-body">${buildBBDDResultadosHTML()}</div>
    </div>
  `;
}

function renderBBDDSub(container) {
  if (fichaRealView) { renderFichaRealView(container); return; }

  container.innerHTML = buildBBDDPanelHTML();

  container.querySelectorAll('[data-ver-ficha]').forEach(btn => {
    btn.addEventListener('click', () => {
      const jugadorId = btn.dataset.verFicha;
      const regs = (bbddResultado?.registros || []).filter(r => r.jugadorId === jugadorId);
      const positionKey = regs[0]?.posicionKey || state.positions[0]?.key;
      fichaRealView = { jugadorId, positionKey };
      fichaRealSubPage = 1;
      renderBBDDSub(container);
    });
  });

  ['#bbdd-posicion', '#bbdd-evaluacion'].forEach(sel => container.querySelector(sel)?.addEventListener('change', () => {
    // actualiza la vista previa de columnas (sin buscar) conservando el resto de filtros
    bbddFiltros = {
      temporada:    container.querySelector('#bbdd-temporada').value,
      evaluacionId: container.querySelector('#bbdd-evaluacion').value,
      jugadorId:    container.querySelector('#bbdd-jugador').value,
      posicionKey:  container.querySelector('#bbdd-posicion').value,
      evaluador:    container.querySelector('#bbdd-evaluador').value.trim(),
      vista:        container.querySelector('#bbdd-vista').value,
    };
    renderBBDDSub(container);
  }));

  container.querySelectorAll('[data-reg-edit]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const reg = (bbddResultado?.registros || []).find(r => r.id === inp.dataset.regEdit);
      if (!reg) return;
      const clave = inp.dataset.clave;
      const raw = inp.value.trim();
      const val = raw === '' ? null : parseEsNumber(raw);
      if (raw !== '' && val == null) { showError('La nota debe ser un número.'); inp.value = reg.puntuaciones?.[clave] ?? ''; return; }
      if (clave === '@r' || clave === '@p') { // R / P de la Ficha 1
        const rp = { ...(reg.rp || {}) };
        if (val == null) delete rp[clave.slice(1)]; else rp[clave.slice(1)] = val;
        try { await actualizarRegistro(reg.id, { rp }); reg.rp = rp; inp.value = val ?? ''; showSuccess('Nota guardada.'); }
        catch (err) { showError('No se pudo guardar la nota (revisa las reglas de Firestore).'); inp.value = reg.rp?.[clave.slice(1)] ?? ''; }
        return;
      }
      const puntuaciones = { ...(reg.puntuaciones || {}) };
      const puntuacionesId = { ...(reg.puntuacionesId || {}) };
      const idClave = buildCatalogo(state, reg.posicionKey).lista.find(c => c.clave === clave)?.id;
      if (val == null) { delete puntuaciones[clave]; if (idClave) delete puntuacionesId[idClave]; }
      else { puntuaciones[clave] = val; if (idClave) puntuacionesId[idClave] = val; }
      try {
        await actualizarRegistro(reg.id, { puntuaciones, puntuacionesId });
        reg.puntuaciones = puntuaciones; reg.puntuacionesId = puntuacionesId;
        const porPosicion = {};
        bbddResultado.registros.forEach(r => { (porPosicion[r.posicionKey] = porPosicion[r.posicionKey] || []).push(r); });
        const medias = {};
        Object.entries(porPosicion).forEach(([pk, regs]) => Object.assign(medias, calcularMediasPorJugador(regs, buildAspectoPorCompetencia(state, pk))));
        bbddResultado.mediasPorJugador = medias;
        inp.value = val ?? '';
        showSuccess('Nota guardada.');
      } catch (err) {
        console.error('[Firestore] No se pudo guardar la nota:', err);
        showError('No se pudo guardar la nota (revisa las reglas de Firestore).');
        inp.value = reg.puntuaciones?.[clave] ?? '';
      }
    });
  });

  container.querySelector('#bbdd-buscar')?.addEventListener('click', async () => {
    bbddFiltros = {
      temporada:    container.querySelector('#bbdd-temporada').value,
      evaluacionId: container.querySelector('#bbdd-evaluacion').value,
      jugadorId:    container.querySelector('#bbdd-jugador').value,
      posicionKey:  container.querySelector('#bbdd-posicion').value,
      evaluador:    container.querySelector('#bbdd-evaluador').value.trim(),
      vista:        container.querySelector('#bbdd-vista').value,
    };
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para consultar la BBDD.'); return; }
    bbddBusy = true;
    renderBBDDSub(container);
    try {
      const filtrosQuery = {};
      ['evaluacionId', 'temporada', 'posicionKey', 'jugadorId', 'evaluador'].forEach(k => {
        if (bbddFiltros[k]) filtrosQuery[k] = bbddFiltros[k];
      });
      const registros = await queryRegistros(filtrosQuery);
      // Medias agrupadas por posición: cada registro usa el esquema de SU
      // propia posición (histórica) — nunca la posición actual del jugador.
      const porPosicion = {};
      registros.forEach(r => { (porPosicion[r.posicionKey] = porPosicion[r.posicionKey] || []).push(r); });
      const mediasPorJugador = {};
      Object.entries(porPosicion).forEach(([posKey, regs]) => {
        Object.assign(mediasPorJugador, calcularMediasPorJugador(regs, buildAspectoPorCompetencia(state, posKey)));
      });
      bbddResultado = { registros, mediasPorJugador };
    } catch (err) {
      console.error('[Firestore] No se pudo consultar la BBDD:', err);
      showError('No se pudo consultar (revisa reglas/índices de Firestore).');
      bbddResultado = { registros: [], mediasPorJugador: {} };
    }
    bbddBusy = false;
    renderBBDDSub(container);
  });
}

// ── Comparativas (auditoría §12) ──────────────────
// evaluadores → media del jugador → media de cada jugador del grupo →
// media del grupo. Cada jugador pesa una vez, tenga los evaluadores que
// tenga (misma función calcularMediaGrupo que usa BBDD).

function buildComparativasHTML() {
  const evOptions = (regEvaluaciones || []).map(ev => `<option value="${ev.id}" ${compFiltros.evaluacionId === ev.id ? 'selected' : ''}>${safeText(ev.nombre)} (${safeText(ev.temporada)})</option>`).join('');
  const generaciones = [...new Set(state.players.map(p => calcAgeAndYear(p.birthDate).year).filter(y => y != null))].sort((a, b) => b - a);
  return `
    <div class="card mb-16">
      <div class="card-title">Comparar jugador con un grupo</div>
      <div class="card-body">
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <div class="field-group" style="min-width:200px;">
            <label class="label">Jugador</label>
            <select class="select" id="comp-jugador"><option value="">— Elige —</option>${state.players.map(p => `<option value="${p.id}" ${compJugadorId === p.id ? 'selected' : ''}>${safeText(p.nombre)} ${safeText(p.apellidos)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:200px;">
            <label class="label">Evaluación</label>
            <select class="select" id="comp-evaluacion"><option value="">— Elige —</option>${evOptions}</select>
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Temporada</label>
            <select class="select" id="comp-temporada"><option value="">— Todas —</option>${state.seasons.map(s => `<option value="${safeText(s)}" ${compFiltros.temporada === s ? 'selected' : ''}>${safeText(s)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Posición (grupo)</label>
            <select class="select" id="comp-posicion"><option value="">— Todas —</option>${state.positions.map(p => `<option value="${p.key}" ${compFiltros.posicionKey === p.key ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Equipo</label>
            <select class="select" id="comp-equipo"><option value="">— Todos —</option>${TEAMS.map(t => `<option value="${t.key}" ${compFiltros.equipo === t.key ? 'selected' : ''}>${safeText(t.label)}</option>`).join('')}</select>
          </div>
          <div class="field-group" style="min-width:140px;">
            <label class="label">Generación</label>
            <select class="select" id="comp-generacion"><option value="">— Todas —</option>${generaciones.map(y => `<option value="${y}" ${compFiltros.generacion === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select>
          </div>
        </div>
        <button class="btn btn-primary mt-16" id="comp-buscar">${compBusy ? 'Comparando…' : 'Comparar'}</button>
      </div>
    </div>
    <div class="card"><div class="card-title">Resultado</div><div class="card-body">${buildComparativasResultadoHTML()}</div></div>
  `;
}

function buildComparativasResultadoHTML() {
  if (!compResultado) return '<p class="text-xs text-muted">Elige jugador + evaluación (y filtros de grupo) y pulsa Comparar.</p>';
  const { jugadorMedia, grupoMedia, n } = compResultado;
  if (!jugadorMedia) return `<p class="text-xs text-muted">El jugador elegido no tiene registros con estos filtros. Grupo: ${n} jugadores.</p>`;
  const jugadorGeneral = mediaGeneralDe(jugadorMedia);
  const aspectos = [...new Set([...Object.keys(jugadorMedia.porAspecto || {})])];
  const filas = aspectos.map(a => {
    const grupoAspecto = calcularMediaGrupo(compResultado.mediasPorJugador, a);
    return `<tr><td>${safeText(a)}</td><td>${jugadorMedia.porAspecto[a]?.toFixed(2) ?? '-'}</td><td>${grupoAspecto != null ? grupoAspecto.toFixed(2) : '-'}</td></tr>`;
  }).join('');
  return `
    <p class="text-xs text-muted mb-16">Grupo: ${n} jugador(es).</p>
    <table class="table table-compact">
      <thead><tr><th>Aspecto</th><th>Jugador</th><th>Media del grupo</th></tr></thead>
      <tbody>
        ${filas}
        <tr style="font-weight:700;"><td>General</td><td>${jugadorGeneral != null ? jugadorGeneral.toFixed(2) : '-'}</td><td>${grupoMedia != null ? grupoMedia.toFixed(2) : '-'}</td></tr>
      </tbody>
    </table>
  `;
}

function renderComparativasSub(container) {
  container.innerHTML = buildComparativasHTML();
  container.querySelector('#comp-buscar')?.addEventListener('click', async () => {
    compJugadorId = container.querySelector('#comp-jugador').value;
    compFiltros = {
      evaluacionId: container.querySelector('#comp-evaluacion').value,
      temporada:    container.querySelector('#comp-temporada').value,
      posicionKey:  container.querySelector('#comp-posicion').value,
      equipo:       container.querySelector('#comp-equipo').value,
      generacion:   container.querySelector('#comp-generacion').value,
    };
    if (!compFiltros.evaluacionId) { showError('Elige una evaluación.'); return; }
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para comparar.'); return; }
    compBusy = true;
    renderComparativasSub(container);
    try {
      const ev = regEvaluaciones.find(e => e.id === compFiltros.evaluacionId);
      const filtrosQuery = { evaluacionId: compFiltros.evaluacionId };
      if (compFiltros.temporada) filtrosQuery.temporada = compFiltros.temporada;
      if (compFiltros.posicionKey) filtrosQuery.posicionKey = compFiltros.posicionKey;
      const registros = await queryRegistros(filtrosQuery);
      if (compFiltros.equipo) await ensurePlantillas();
      // Equipo/generación no viven en 'registros' — se acotan aquí, pero
      // SOLO sobre el subconjunto ya filtrado por Firestore, no la colección entera.
      const registrosFiltrados = registros.filter(r => {
        if (!r.jugadorId) return false;
        const jugador = state.players.find(p => p.id === r.jugadorId);
        if (!jugador) return false;
        if (compFiltros.equipo && !equiposDeJugador(jugador, ev?.temporada || compFiltros.temporada).includes(compFiltros.equipo)) return false;
        if (compFiltros.generacion && String(calcAgeAndYear(jugador.birthDate).year) !== compFiltros.generacion) return false;
        return true;
      });
      const posicionParaMedias = compFiltros.posicionKey || ev.posicionKey;
      const map = buildAspectoPorCompetencia(state, posicionParaMedias);
      const mediasPorJugador = calcularMediasPorJugador(registrosFiltrados, map);
      compResultado = {
        mediasPorJugador,
        grupoMedia: calcularMediaGrupo(mediasPorJugador),
        jugadorMedia: compJugadorId ? mediasPorJugador[compJugadorId] : null,
        n: Object.keys(mediasPorJugador).length,
      };
    } catch (err) {
      console.error('[Firestore] No se pudo calcular la comparativa:', err);
      showError('No se pudo comparar (revisa reglas/índices de Firestore).');
      compResultado = null;
    }
    compBusy = false;
    renderComparativasSub(container);
  });
}

function renderPanelRegistro(container) {
  ensureEvaluacionesLoaded(container);
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="rm-sticky mb-16 flex gap-8" style="padding:6px 0;">
      <button class="btn ${registroSubTab === 'registro' ? 'btn-primary' : 'btn-sm'}" data-registro-subtab="registro">Registro</button>
      <button class="btn ${registroSubTab === 'bbdd' ? 'btn-primary' : 'btn-sm'}" data-registro-subtab="bbdd">BBDD</button>
      <button class="btn ${registroSubTab === 'comparativas' ? 'btn-primary' : 'btn-sm'}" data-registro-subtab="comparativas">Comparativas</button>
    </div>
    <div id="registro-sub-content"></div>
  `;
  const sub = container.querySelector('#registro-sub-content');
  if (registroSubTab === 'registro') renderRegistroSub(sub);
  else if (registroSubTab === 'bbdd') renderBBDDSub(sub);
  else renderComparativasSub(sub);

  container.querySelectorAll('[data-registro-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      registroSubTab = btn.dataset.registroSubtab;
      localStorage.setItem('rm-registro-subtab', registroSubTab);
      renderPanelRegistro(container);
    });
  });
}

let jugadorFormId = null; // null=formulario cerrado, 'new'=alta, <id>=editando ese jugador
let configCriteriaPosition = null;      // qué posición se está editando en "Items a evaluar"
let fichaTipoPosition = null;           // qué posición se está viendo en Configuración → Fichas tipo → Individual
let configSubTab = localStorage.getItem('rm-config-subtab') || 'posiciones'; // pestaña interna activa dentro de Configuración — persiste al refrescar

const CONFIG_GROUPS = [
  {
    label: 'Contenido',
    tabs: [
      { key: 'posiciones',       label: 'Posiciones' },
      { key: 'items',            label: 'Aspectos' },
      { key: 'colores',          label: 'Rango de colores' },
      { key: 'condicional-refs', label: 'Datos condicionales' },
    ],
  },
  {
    label: 'Fichas tipo',
    tabs: [
      { key: 'fichas-individual',  label: 'Individual' },
      { key: 'columnas-encuesta',  label: 'Columnas encuesta' },
      { key: 'fichas-espejo',      label: 'Fichas Espejo' },
      { key: 'fichas-campograma',  label: 'Campograma' },
      { key: 'fichas-mapa-nivel',  label: 'Mapa de nivel' },
    ],
  },
  {
    label: 'Diseño',
    tabs: [
      { key: 'ficha-colores', label: 'Colores de la ficha' },
      { key: 'ficha-matriz',  label: 'Matriz' },
      { key: 'dimensiones',   label: 'Dimensiones' },
    ],
  },
  {
    label: 'Ayuda',
    tabs: [
      { key: 'flujo',   label: 'Flujo de evaluaciones' },
      { key: 'frases',  label: 'Frases modelo' },
      { key: 'copia-seguridad', label: 'Copia de seguridad' },
    ],
  },
];
// Temporadas: quitado de momento (código y datos se mantienen, solo se oculta la pestaña).

// Comunes a todas las posiciones (sin selector de posición). Técnico salió
// de aquí — ahora varía por posición, igual que Táctico (ver buildTecnicoCategoryHTML).
const ASPECTOS_COMUNES_CATEGORIES = [
  { key: 'mental',      label: 'Mental' },
  { key: 'condicional', label: 'Condicional' },
];
let itemsConfigPage = 1; // qué página se edita en "Items a evaluar": 1 ó 2 (por defecto Ficha 1)

function buildAspectoComunCategoryHTML(cat) {
  const items = state.aspectosComunes[cat.key] || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">${safeText(cat.label)} <span class="text-muted" style="font-weight:400;text-transform:none;font-size:11px;">(común a todas las posiciones)</span></div>
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin items definidos.</span>'}
      </div>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="input" data-crit-new data-scope="comun" data-cat="${cat.key}" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo item… (o pega varios, uno por línea)"></textarea>
        <button class="btn btn-sm" data-crit-add data-scope="comun" data-cat="${cat.key}">+ Añadir</button>
      </div>
    </div>
  `;
}

// Técnico: ahora varía por posición (igual que Táctico). Mientras una
// posición no tenga lista propia, se muestra la común como referencia
// (solo lectura) con un botón para copiarla y empezar a editar desde ahí
// — no se inventa ni se pierde el dato ya cargado.
function buildTecnicoPositionSelectorHTML() {
  return `
    <div class="mb-16" style="max-width:280px;">
      <div class="text-xs text-muted mb-8">Posición</div>
      <select class="select" data-crit-position>
        ${state.positions.map(p => `<option value="${p.key}" ${p.key === configCriteriaPosition ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}
      </select>
    </div>
  `;
}

function buildTecnicoCategoryHTML() {
  const posLabel = state.positions.find(p => p.key === configCriteriaPosition)?.label || configCriteriaPosition;
  const schema = state.criteriaSchemas[configCriteriaPosition] || {};
  const hasOwn = Array.isArray(schema.tecnico);
  const items = hasOwn ? schema.tecnico : (state.aspectosComunes.tecnico || []);
  const chips = items.map((label, i) => hasOwn ? `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-cat="tecnico" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-cat="tecnico" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-cat="tecnico" data-idx="${i}" title="Quitar">×</button>
    </span>
  ` : `<span class="chip" style="opacity:0.6;">${safeText(label)}</span>`).join('');
  return `
    <div class="mb-16">
      <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Técnico <span class="text-muted" style="font-weight:400;text-transform:none;font-size:11px;">(por posición)</span></div>
      ${buildTecnicoPositionSelectorHTML()}
      ${!hasOwn ? `
        <p class="text-xs text-muted mb-8">
          "${safeText(posLabel)}" aún no tiene lista propia — se muestra la común como referencia (solo lectura).
          <button class="btn btn-sm" data-seed-tecnico>Usar esta lista como punto de partida</button>
        </p>
      ` : ''}
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin items definidos.</span>'}
      </div>
      ${hasOwn ? `
        <div class="flex gap-8" style="align-items:flex-start;">
          <textarea class="input" data-crit-new data-cat="tecnico" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo item… (o pega varios, uno por línea)"></textarea>
          <button class="btn btn-sm" data-crit-add data-cat="tecnico">+ Añadir</button>
        </div>
      ` : ''}
    </div>
  `;
}

// Selector de posición + copiar (Táctico/Ofensivas/Defensivas dependen de la posición).
// withCopy=false quita el selector "Copiar desde…" (se deja solo en Competencias,
// que es lo único que ese botón copia de verdad — en Táctico y Perfiles sobraba/confundía).
function buildPositionSelectorHTML(withCopy = true) {
  return `
    <div class="flex gap-12 mb-16" style="align-items:flex-end;flex-wrap:wrap;">
      <label style="display:block;max-width:280px;">
        <div class="text-xs text-muted mb-8">Posición</div>
        <select class="select" data-crit-position>
          ${state.positions.map(p => `<option value="${p.key}" ${p.key === configCriteriaPosition ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}
        </select>
      </label>
      ${(withCopy && state.positions.length > 1) ? `
        <label style="display:block;max-width:280px;">
          <div class="text-xs text-muted mb-8">Copiar Táctico/Ofensivas/Defensivas desde…</div>
          <select class="select" data-crit-copy-from>
            <option value="">—</option>
            ${state.positions.filter(p => p.key !== configCriteriaPosition).map(p => `<option value="${p.key}">${safeText(p.label)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-sm" data-crit-copy-btn>Copiar</button>
      ` : ''}
    </div>
  `;
}

// Táctico: varía por posición (configCriteriaPosition). Selector de posición debajo del título.
function buildTacticoCategoryHTML() {
  const items = state.criteriaSchemas[configCriteriaPosition]?.tactico || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-cat="tactico" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-cat="tactico" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-cat="tactico" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Táctico</div>
      ${buildPositionSelectorHTML(false)}
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin items definidos.</span>'}
      </div>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="input" data-crit-new data-cat="tactico" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo item… (o pega varios, uno por línea)"></textarea>
        <button class="btn btn-sm" data-crit-add data-cat="tactico">+ Añadir</button>
      </div>
    </div>
  `;
}

// Ofensivas/Defensivas: checkboxes SOBRE el Táctico ya creado (no texto libre).
function buildOfenDefCheckboxesHTML(role, label) {
  const key = role === 'of' ? 'competenciasOfensivas' : 'competenciasDefensivas';
  const tactico = state.criteriaSchemas[configCriteriaPosition]?.tactico || [];
  const selected = state.criteriaSchemas[configCriteriaPosition]?.[key] || [];
  const titleHTML = `<div class="mb-8" style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.02em;color:var(--text-secondary);">${label}</div>`;
  if (!tactico.length) {
    return `<div style="flex:1;min-width:260px;">${titleHTML}<p class="text-xs text-muted">Define antes el Táctico de esta posición (pestaña Ficha 2).</p></div>`;
  }
  const boxes = tactico.map(label2 => `
    <label class="flex gap-8" style="align-items:center;">
      <input type="checkbox" data-toggle-comp data-role="${role}" data-label="${safeText(label2)}" ${selected.includes(label2) ? 'checked' : ''} />
      <span class="text-xs">${safeText(label2)}</span>
    </label>
  `).join('');
  return `
    <div style="flex:1;min-width:260px;">
      ${titleHTML}
      <div class="flex gap-8" style="flex-direction:column;">${boxes}</div>
    </div>
  `;
}

// Perfiles: lista libre por posición (nombre del perfil — sin competencias asociadas todavía).
function buildPerfilesCategoryHTML() {
  const items = state.criteriaSchemas[configCriteriaPosition]?.perfiles || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-cat="perfiles" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-cat="perfiles" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-cat="perfiles" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin perfiles definidos.</span>'}
      </div>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="input" data-crit-new data-cat="perfiles" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo perfil… (o pega varios, uno por línea)"></textarea>
        <button class="btn btn-sm" data-crit-add data-cat="perfiles">+ Añadir</button>
      </div>
    </div>
  `;
}

// Perfiles: para CADA perfil de esta posición, checkboxes sobre el Táctico
// ya creado (igual patrón que Ofensivas/Defensivas) — qué competencias
// entran en la media de ese perfil. Se guarda en criteriaSchemas[pos].perfilCompetencias[nombrePerfil].
function buildPerfilCompetenciasHTML() {
  const schema = state.criteriaSchemas[configCriteriaPosition] || {};
  const perfiles = schema.perfiles || [];
  const tactico = schema.tactico || [];
  if (!perfiles.length) return '<p class="text-xs text-muted">Define antes al menos un perfil (arriba).</p>';
  if (!tactico.length) return '<p class="text-xs text-muted">Define antes el Táctico de esta posición (pestaña Ficha 2).</p>';
  const perfilCompetencias = schema.perfilCompetencias || {};
  return `
    <div class="flex gap-24" style="flex-wrap:wrap;">
      ${perfiles.map(perfil => {
        const selected = perfilCompetencias[perfil] || [];
        const boxes = tactico.map(label => `
          <label class="flex gap-8" style="align-items:center;">
            <input type="checkbox" data-toggle-perfil-comp data-perfil="${safeText(perfil)}" data-label="${safeText(label)}" ${selected.includes(label) ? 'checked' : ''} />
            <span class="text-xs">${safeText(label)}</span>
          </label>
        `).join('');
        return `
          <div style="flex:1;min-width:260px;">
            <div class="mb-8" style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.02em;color:var(--text-secondary);">${safeText(perfil)}</div>
            <div class="flex gap-8" style="flex-direction:column;">${boxes}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Tabla "Datos condicionales": filas = Aspectos → Condicional, columnas = Posiciones × (3, 4).
// Nada hardcodeado: se genera de state.aspectosComunes.condicional y state.positions.
function buildCondicionalRefsTableHTML() {
  const items = state.aspectosComunes.condicional || [];
  const positions = state.positions || [];
  if (!items.length) return '<p class="text-xs text-muted">Define primero ítems en Aspectos → Condicional.</p>';
  if (!positions.length) return '<p class="text-xs text-muted">Define primero al menos una posición.</p>';

  const getVal = (posKey, item, col) => state.condicionalRefs?.[posKey]?.[item]?.[col] ?? '';

  return `
    <div class="cond-refs-wrap" style="overflow-x:auto;max-width:100%;--cond-refs-bg:${state.fichaColors.slate};--cond-refs-header:${state.fichaColors.wine};">
      <table class="cond-refs-table">
        <thead>
          <tr>
            <th class="cond-refs-sticky">Ítem condicional</th>
            ${positions.map(p => `<th colspan="2" style="text-align:center;">${safeText(p.label)}</th>`).join('')}
          </tr>
          <tr>
            <th class="cond-refs-sticky">Fútbol profesional</th>
            ${positions.map(() => `<th style="text-align:center;">Med.</th><th style="text-align:center;">Máx.</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td class="cond-refs-sticky">${safeText(item)}</td>
              ${positions.map(p => `
                <td><input type="text" data-condicional-ref data-pos="${p.key}" data-item="${safeText(item)}" data-col="col3" value="${getVal(p.key, item, 'col3')}" /></td>
                <td><input type="text" data-condicional-ref data-pos="${p.key}" data-item="${safeText(item)}" data-col="col4" value="${getVal(p.key, item, 'col4')}" /></td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Año y edad NUNCA se guardan — se calculan siempre de birthDate para que no se desincronicen.
function calcAgeAndYear(birthDateStr) {
  if (!birthDateStr) return { age: null, year: null };
  const d = new Date(birthDateStr);
  if (Number.isNaN(d.getTime())) return { age: null, year: null };
  const year = d.getFullYear();
  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear = (today.getMonth() > d.getMonth()) || (today.getMonth() === d.getMonth() && today.getDate() >= d.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return { age, year };
}

// Datos VARIABLES del jugador — llevan histórico (subcolección
// jugadores/{id}/historico): cada cambio se AÑADE, nunca se sobreescribe.
// El propio doc del jugador guarda el último valor (teamKey/positionKey/
// weight/height/complexion) como "espejo" para listar rápido, tal como
// ya se hacía con weight/height — solo se amplía el mismo patrón.
const HISTORICO_FIELDS = ['teamKey', 'positionKey', 'weight', 'height', 'complexion'];

async function cargarEvaluacionesSilencioso() {
  if (regEvaluaciones !== null) return;
  if (isFirebaseUnconfigured()) { regEvaluaciones = []; return; }
  try { regEvaluaciones = await listarEvaluaciones(); }
  catch (err) { console.error('[Firestore] No se pudieron cargar las evaluaciones:', err); regEvaluaciones = []; }
}

function buildJugadorFormHTML(player) {
  const p = player || {};
  const teamOptions = TEAMS.map(t => `<option value="${t.key}" ${p.teamKey === t.key ? 'selected' : ''}>${safeText(t.label)}</option>`).join('');
  const posOptions = state.positions.map(pos => `<option value="${pos.key}" ${p.positionKey === pos.key ? 'selected' : ''}>${safeText(pos.label)}</option>`).join('');
  return `
    <div class="card mb-16">
      <div class="card-title">${player ? 'Editar jugador' : 'Nuevo jugador'}</div>
      <div class="card-body">
        <div class="flex gap-12 mb-16" style="align-items:center;flex-wrap:wrap;">
          <img id="jug-foto-preview" src="${p.fotoUrl || ''}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--bg-hover);display:${p.fotoUrl ? 'block' : 'none'};" />
          <div class="field-group">
            <label class="label">Foto</label>
            <input class="input" type="file" id="jug-foto" accept="image/*" />
          </div>
          <div id="jug-crop" style="display:none;">
            <div id="jug-crop-view" style="width:180px;height:180px;border-radius:50%;overflow:hidden;position:relative;background:var(--bg-hover);cursor:grab;touch-action:none;border:2px solid var(--blue-500, #3b82f6);">
              <img id="jug-crop-img" alt="" draggable="false" style="position:absolute;left:0;top:0;max-width:none;user-select:none;pointer-events:none;" />
            </div>
            <input type="range" id="jug-crop-zoom" min="1" max="3" step="0.01" value="1" style="width:180px;display:block;margin-top:8px;" />
            <div class="text-xs text-muted">Arrastra para mover · desliza para ampliar</div>
          </div>
        </div>
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <div class="field-group" style="min-width:180px;">
            <label class="label">Nombre</label>
            <input class="input" type="text" id="jug-nombre" value="${safeText(p.nombre || '')}" />
          </div>
          <div class="field-group" style="min-width:180px;">
            <label class="label">Apellidos</label>
            <input class="input" type="text" id="jug-apellidos" value="${safeText(p.apellidos || '')}" />
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Fecha de nacimiento</label>
            <input class="input" type="date" id="jug-birthdate" value="${p.birthDate || ''}" />
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Lateralidad</label>
            <select class="select" id="jug-foot">
              <option value="">—</option>
              <option value="Diestro" ${p.foot === 'Diestro' ? 'selected' : ''}>Diestro</option>
              <option value="Zurdo" ${p.foot === 'Zurdo' ? 'selected' : ''}>Zurdo</option>
              <option value="Ambidiestro" ${p.foot === 'Ambidiestro' ? 'selected' : ''}>Ambidiestro</option>
            </select>
          </div>
          <div class="field-group" style="min-width:190px;">
            <label class="label">Residencia</label>
            <select class="select" id="jug-residencia">
              <option value="">—</option>
              ${['Residente en Madrid', 'En residencia', 'Media pensión'].map(v => `<option value="${v}" ${p.residencia === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Edad madurativa</label>
            <input class="input" type="text" id="jug-maturational" value="${safeText(p.maturationalAge ?? '')}" />
          </div>
        </div>
        <div class="text-xs text-muted mt-16 mb-8" style="font-weight:700;text-transform:uppercase;">Datos con histórico (cada cambio se guarda, no se pierde el anterior)</div>
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <div class="field-group" style="min-width:160px;">
            <label class="label">Equipo</label>
            <select class="select" id="jug-team"><option value="">—</option>${teamOptions}</select>
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Posición</label>
            <select class="select" id="jug-position"><option value="">—</option>${posOptions}</select>
          </div>
          <div class="field-group" style="min-width:120px;">
            <label class="label">Peso (kg)</label>
            <input class="input" type="number" step="0.1" min="0" id="jug-weight" value="${p.weight ?? ''}" />
          </div>
          <div class="field-group" style="min-width:120px;">
            <label class="label">Altura (m)</label>
            <input class="input" type="number" step="0.01" min="0" id="jug-height" value="${p.height ?? ''}" />
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Complexión</label>
            <input class="input" type="text" id="jug-complexion" value="${safeText(p.complexion ?? '')}" />
          </div>
        </div>
        ${(state.aspectosComunes.condicional || []).length ? `
        <div class="text-xs text-muted mt-16 mb-8" style="font-weight:700;text-transform:uppercase;">Datos condicionales del jugador (media y máxima por evaluación → Ficha 2, columnas 1 y 2)</div>
        ${(regEvaluaciones || []).length ? `
        <div class="field-group mb-8" style="min-width:260px;max-width:360px;">
          <label class="label">Evaluación</label>
          <select class="select" id="jug-cond-eval">${regEvaluaciones.map((e, i) => `<option value="${e.id}" ${i === 0 ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
        </div>
        <div style="overflow-x:auto;"><table class="table table-compact" style="max-width:520px;">
          <thead><tr><th>Ítem condicional</th><th>Media</th><th>Máxima</th></tr></thead>
          <tbody>${state.aspectosComunes.condicional.map(item => `
            <tr><td>${safeText(item)}</td>
              <td><input class="input" type="text" inputmode="decimal" style="width:90px;" data-jug-cond="${safeText(slugify(item))}" value="" /></td>
              <td><input class="input" type="text" inputmode="decimal" style="width:90px;" data-jug-condmax="${safeText(slugify(item))}" value="" /></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="text-xs text-muted">Crea primero una evaluación (Registro de datos) para poder guardar datos condicionales.</p>'}` : ''}
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="jug-save">${player ? 'Guardar cambios' : 'Añadir jugador'}</button>
          <button class="btn btn-ghost" id="jug-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function buildHistoricoHTML(entries) {
  if (!entries.length) return '<p class="text-xs text-muted">Sin histórico todavía.</p>';
  const sorted = [...entries].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const rows = sorted.map(e => {
    const fecha = e.createdAt?.seconds ? new Date(e.createdAt.seconds * 1000).toLocaleDateString('es-ES') : '-';
    const cambios = HISTORICO_FIELDS.filter(f => e[f] !== undefined && e[f] !== null && e[f] !== '')
      .map(f => {
        if (f === 'teamKey') return 'Equipo: ' + safeText(TEAMS.find(t => t.key === e.teamKey)?.label || e.teamKey);
        if (f === 'positionKey') return 'Posición: ' + safeText(state.positions.find(p => p.key === e.positionKey)?.label || e.positionKey);
        if (f === 'weight') return 'Peso: ' + e.weight + ' kg';
        if (f === 'height') return 'Altura: ' + e.height + ' m';
        if (f === 'complexion') return 'Complexión: ' + safeText(e.complexion);
        return '';
      }).join(' · ');
    return `<tr><td>${fecha}</td><td>${cambios}</td></tr>`;
  }).join('');
  return `<table class="table table-compact"><tbody>${rows}</tbody></table>`;
}

// ── Jugadores: filtros + ficha de jugador ──────────
let jugFiltros = { q: '', teamKey: '', positionKey: '', year: '', foot: '' };
let jugVolverA = null;             // 'plantillas' si la ficha se abrió desde esa pestaña (botón Volver)
let jugFichaId = null;             // null = lista; <id> = ficha de ese jugador abierta
const jugFichaRegs = {};           // { [playerId]: registros[] } — evaluaciones recibidas
const jugFichaLoading = new Set(); // evita lanzar la misma carga dos veces

const normalizeTxt = str => String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function jugadorPasaFiltros(p) {
  const f = jugFiltros;
  if (f.q) {
    const txt = normalizeTxt(`${p.nombre || ''} ${p.apellidos || ''}`);
    if (!f.q.split(/\s+/).filter(Boolean).every(w => txt.includes(normalizeTxt(w)))) return false;
  }
  if (f.teamKey && p.teamKey !== f.teamKey) return false;
  if (f.positionKey && p.positionKey !== f.positionKey) return false;
  if (f.year && String(calcAgeAndYear(p.birthDate).year) !== String(f.year)) return false;
  if (f.foot && p.foot !== f.foot) return false;
  return true;
}

function buildJugadoresFiltrosHTML() {
  const years = [...new Set(state.players.map(p => calcAgeAndYear(p.birthDate).year).filter(Boolean))].sort((a, b) => b - a);
  const sel = (id, label, opts, val) => `
    <div class="field-group" style="min-width:140px;"><label class="label">${label}</label>
      <select class="select" id="${id}"><option value="">Todos</option>${opts.map(([v, l]) => `<option value="${safeText(String(v))}" ${String(val) === String(v) ? 'selected' : ''}>${safeText(l)}</option>`).join('')}</select>
    </div>`;
  return `
    <div class="card mb-16 rm-sticky"><div class="card-body">
      <div class="flex gap-12" style="flex-wrap:wrap;align-items:flex-end;">
        <div class="field-group" style="min-width:220px;"><label class="label">Buscar (nombre o apellidos)</label>
          <input class="input" type="text" id="jug-f-q" value="${safeText(jugFiltros.q)}" placeholder="Ej. Pérez" /></div>
        ${sel('jug-f-team', 'Equipo', TEAMS.map(t => [t.key, t.label]), jugFiltros.teamKey)}
        ${sel('jug-f-pos', 'Posición', state.positions.map(p => [p.key, p.label]), jugFiltros.positionKey)}
        ${sel('jug-f-year', 'Año nacimiento', years.map(y => [y, String(y)]), jugFiltros.year)}
        ${sel('jug-f-foot', 'Lateralidad', ['Diestro', 'Zurdo', 'Ambidiestro'].map(x => [x, x]), jugFiltros.foot)}
        <button class="btn btn-sm" id="jug-f-clear">Limpiar filtros</button>
      </div>
    </div></div>`;
}

async function cargarDatosFicha(container, id) {
  jugFichaLoading.add(id);
  try {
    if (isFirebaseUnconfigured()) {
      jugFichaRegs[id] = jugFichaRegs[id] || [];
      jugadorHistoricoCache[id] = jugadorHistoricoCache[id] || [];
    } else {
      await Promise.all([
        jugFichaRegs[id] ? null : queryRegistros({ jugadorId: id }).then(r => { jugFichaRegs[id] = r; }).catch(err => { console.error('[Firestore] Registros del jugador:', err); jugFichaRegs[id] = []; }),
        jugadorHistoricoCache[id] ? null : readSubCollection('jugadores', id, 'historico').then(h => { jugadorHistoricoCache[id] = h; }).catch(err => { console.error('[Firestore] Histórico:', err); jugadorHistoricoCache[id] = []; }),
      ]);
    }
  } finally {
    jugFichaLoading.delete(id);
  }
  if (jugFichaId === id && !jugadorFormId) renderPanelJugadores(container);
}

let jugFichaTab = 'datos';     // 'datos' | 'fichas' (Ficha 1 y Ficha 2 una debajo de otra)
const JUG_REF_QUIEN = [['', 'Sin comparar'], ['team', 'Mismo equipo'], ['gen', 'Misma generación'], ['pos', 'Misma posición'], ['jug', 'Un jugador concreto…']];
let jugRef = { who: '', when: 'eval', jugId: '', evalId: '' };   // comparación elegida para las medias de la Ficha 2
const jugRefCache = {};        // { clave: {mental,tecnico,tactico,label} }
const jugRefLoading = new Set();

function jugRefKey(evSel, pid) { return evSel ? [evSel.eid, jugRef.who, jugRef.when, jugRef.jugId, jugRef.evalId, pid].join('|') : null; }

async function cargarReferencia(container, p, evSel) {
  const key = jugRefKey(evSel, p.id);
  if (jugRefLoading.has(key)) return;
  jugRefLoading.add(key);
  const { who, when, jugId, evalId } = jugRef;
  try {
    const mapa = buildAspectoPorCompetencia(state, evSel.posKey);
    let regsF, label;
    if (who === 'jug') {
      const j = state.players.find(x => x.id === jugId);
      if (!j || !evalId) { jugRefCache[key] = { label: 'Comparación: elige jugador y evaluación' }; return; }
      regsF = await queryRegistros({ jugadorId: jugId, evaluacionId: evalId });
      const ev = (regEvaluaciones || []).find(e => e.id === evalId);
      label = `Comparado con: ${`${j.nombre || ''} ${j.apellidos || ''}`.trim()} · ${ev ? `${ev.temporada} ${ev.nombre}` : ''}`;
    } else {
      const filtros = when === 'eval' ? { evaluacionId: evSel.eid } : { posicionKey: evSel.posKey, ...(when.startsWith('temp:') ? { temporada: when.slice(5) } : {}) };
      const regsAll = await queryRegistros(filtros);
    if (who === 'team') await ensurePlantillas();
    const temporadaRef = evSel.ev?.temporada || '';
    const misEquipos = who === 'team' ? equiposDeJugador(p, temporadaRef) : [];
      const year = calcAgeAndYear(p.birthDate).year;
      regsF = regsAll.filter(r => {
        if (!r.jugadorId) return false;
        const j = state.players.find(x => x.id === r.jugadorId);
        if (!j) return false;
        if (who === 'team' && !equiposDeJugador(j, temporadaRef).some(t => misEquipos.includes(t))) return false;
        if (who === 'gen' && calcAgeAndYear(j.birthDate).year !== year) return false;
        return true;
      });
      const quien = JUG_REF_QUIEN.find(m => m[0] === who)?.[1] || '';
      const cuando = when === 'eval' ? 'esta evaluación' : when === 'todo' ? 'todo el histórico' : `temporada ${when.slice(5)}`;
      label = `Comparado con: ${quien} · ${cuando}`;
    }
    const medias = calcularMediasPorJugador(regsF.filter(r => r.jugadorId), mapa);
    const n = Object.keys(medias).length;
    jugRefCache[key] = n ? {
      mental: calcularMediaGrupo(medias, 'mental'), tecnico: calcularMediaGrupo(medias, 'tecnico'), tactico: calcularMediaGrupo(medias, 'tactico'),
      label: `${label}${who === 'jug' ? '' : ` (${n} jug.)`}`,
    } : { label: 'Comparación: sin datos' };
  } catch (err) {
    console.error('[Firestore] No se pudo calcular la referencia:', err);
    showError('No se pudo calcular la media de comparación (revisa reglas/índices de Firestore).');
    jugRefCache[key] = { label: 'Comparación: error' };
  } finally {
    jugRefLoading.delete(key);
  }
  if (jugFichaId === p.id && !jugadorFormId) preservandoScroll(() => renderPanelJugadores(container));
}

let jugFichaEvalId = null;     // evaluación elegida para Ficha 1/2 (null = la última/final)

function renderFichaJugador(container, p) {
  const id = p.id;
  if ((!jugFichaRegs[id] || !jugadorHistoricoCache[id]) && !jugFichaLoading.has(id)) cargarDatosFicha(container, id);

  const { age, year } = calcAgeAndYear(p.birthDate);
  const teamLabel = TEAMS.find(t => t.key === p.teamKey)?.label;
  const posLabel  = state.positions.find(pos => pos.key === p.positionKey)?.label;
  const dato = (label, v) => `<div style="min-width:150px;"><div class="text-xs text-muted">${label}</div><div style="font-weight:600;">${v == null || v === '' ? '—' : safeText(String(v))}</div></div>`;
  const fmt = v => v == null ? '—' : Number(v).toFixed(1).replace('.', ',');
  const evInfo = eid => (regEvaluaciones || []).find(e => e.id === eid);
  const evLabel = eid => { const e = evInfo(eid); return e ? `${e.temporada} · ${e.nombre}` : eid; };

  // Evaluaciones del jugador (una fila por evaluación), de la más reciente a la más antigua.
  // "Evaluación final" = la más reciente (por fecha fin/inicio; si no hay fechas, la última creada).
  const regs = jugFichaRegs[id];
  let filas = [];
  if (regs) {
    const grupos = {};
    regs.forEach(r => { const k = r.evaluacionId || 'sin-evaluacion'; (grupos[k] = grupos[k] || []).push(r); });
    filas = Object.entries(grupos).map(([eid, rs]) => {
      const ev = evInfo(eid);
      const posKey = ev?.posicionKey || rs[0]?.posicionKey;
      const media = calcularMediasPorJugador(rs.map(r => ({ ...r, jugadorId: id })), buildAspectoPorCompetencia(state, posKey))[id];
      const idx = (regEvaluaciones || []).findIndex(e => e.id === eid);
      return { eid, ev, posKey, n: new Set(rs.map(r => r.evaluador)).size, media, orden: `${ev?.fechaFin || ev?.fechaInicio || ''}|${String(idx).padStart(5, '0')}` };
    }).sort((a, b) => String(b.orden).localeCompare(String(a.orden)));
  }
  let filasEval = filas.filter(f => f.eid !== 'sin-evaluacion' && f.ev);
  if (regs) { // evaluaciones con datos condicionales del jugador aunque no tenga registros importados
    const conDatos = new Set([...Object.keys(p.condicionalPorEval || {}), ...Object.keys(p.condicionalMaxPorEval || {})]);
    conDatos.forEach(eid => {
      const ev = evInfo(eid);
      if (!ev || filasEval.some(f => f.eid === eid)) return;
      const idx = (regEvaluaciones || []).findIndex(e => e.id === eid);
      filasEval.push({ eid, ev, posKey: ev.posicionKey || p.positionKey, n: 0, media: null, orden: `${ev.fechaFin || ev.fechaInicio || ''}|${String(idx).padStart(5, '0')}` });
    });
    filasEval.sort((x, y) => String(y.orden).localeCompare(String(x.orden)));
  }
  const evSel = filasEval.find(f => f.eid === jugFichaEvalId) || filasEval[0] || null; // por defecto, la final

  // ── Pestaña "Datos personales"
  const items = state.aspectosComunes.condicional || [];
  const porEval = p.condicionalPorEval || {};
  const porEvalMax = p.condicionalMaxPorEval || {};
  const evCond = [...new Set([...Object.keys(porEval), ...Object.keys(porEvalMax)])].filter(eid => Object.keys(porEval[eid] || {}).length || Object.keys(porEvalMax[eid] || {}).length);
  const condHTML = evCond.length ? `
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Evaluación (media / máx)</th>${items.map(i => `<th>${safeText(i)}</th>`).join('')}</tr></thead>
      <tbody>${evCond.map(eid => `<tr><td>${safeText(evLabel(eid))}</td>${items.map(i => `<td>${safeText(porEval[eid]?.[slugify(i)] ?? '—')} / ${safeText(porEvalMax[eid]?.[slugify(i)] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>` : '<p class="text-xs text-muted">Sin datos condicionales. Se añaden en Editar.</p>';

  let evalHTML = '<p class="text-xs text-muted">Cargando…</p>';
  if (regs) {
    evalHTML = filas.length ? `
      <div style="overflow-x:auto;"><table class="table table-compact">
        <thead><tr><th>Evaluación</th><th>Posición</th><th>Evaluadores</th><th>Mental</th><th>Técnico</th><th>Táctico</th><th>Media general</th></tr></thead>
        <tbody>${filas.map((f, i) => `<tr>
          <td>${safeText(f.eid === 'sin-evaluacion' ? '(sin evaluación asociada)' : evLabel(f.eid))}${f === filasEval[0] ? ' <b>(final)</b>' : ''}</td>
          <td>${safeText(state.positions.find(x => x.key === f.posKey)?.label || f.posKey || '—')}</td>
          <td>${f.n}</td>
          <td>${fmt(f.media?.porAspecto?.mental)}</td><td>${fmt(f.media?.porAspecto?.tecnico)}</td><td>${fmt(f.media?.porAspecto?.tactico)}</td>
          <td><b>${fmt(mediaGeneralDe(f.media))}</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="text-xs text-muted">Todavía no hay evaluaciones importadas de este jugador.</p>';
  }

  const datosHTML = `
    <div class="card mb-16"><div class="card-title">Datos personales</div><div class="card-body">
      <div class="flex gap-24" style="flex-wrap:wrap;">
        ${dato('Nombre', p.nombre)}${dato('Apellidos', p.apellidos)}${dato('Equipo', teamLabel)}${dato('Posición', posLabel)}
        ${dato('Fecha de nacimiento', p.birthDate)}${dato('Año', year)}${dato('Edad', age != null ? age + ' años' : null)}
        ${dato('Lateralidad', p.foot)}${dato('Edad madurativa', p.maturationalAge)}
        ${dato('Peso', p.weight != null ? p.weight + ' kg' : null)}${dato('Altura', p.height != null ? p.height + ' m' : null)}${dato('Complexión', p.complexion)}
      </div>
    </div></div>
    <div class="card mb-16"><div class="card-title">Evaluaciones</div><div class="card-body">${evalHTML}</div></div>
    <div class="card mb-16"><div class="card-title">Datos condicionales</div><div class="card-body">${condHTML}</div></div>
    <div class="card mb-16"><div class="card-title">Histórico (peso, altura, equipo, posición…)</div><div class="card-body">
      ${jugadorHistoricoCache[id] ? buildHistoricoHTML(jugadorHistoricoCache[id]) : '<p class="text-xs text-muted">Cargando…</p>'}
    </div></div>`;

  // ── Pestañas Ficha 1 / Ficha 2 (evaluación elegida; por defecto la final)
  // Textos de Ficha 1 (potenciar/mejorar): guardados por el técnico, o respuestas de la encuesta (1 fila por evaluador).
  const textosKey = evSel?.eid || 'sin-evaluacion';
  const regsEval = evSel ? (regs || []).filter(r => (r.evaluacionId || 'sin-evaluacion') === evSel.eid) : [];
  const filasTexto = k => regsEval.map(r => String(r.textos?.[k] || '').replace(/\s*\n+\s*/g, ' · ').trim()).filter(Boolean);
  const guardadosTxt = p.fichaTextos?.[textosKey];
  const origenTxt = k => guardadosTxt?.[k] ?? filasTexto(k);
  let textosExtra = 0;
  const cinco = arr => { textosExtra = Math.max(textosExtra, arr.length - 5); return Array.from({ length: 5 }, (_, i) => arr[i] || ''); };
  const mediaRP = k => { const v = regsEval.map(r => r.rp?.[k]).filter(x => typeof x === 'number'); if (!v.length) return null; const m = v.reduce((x, y) => x + y, 0) / v.length; return String(Math.round(m * 10) / 10).replace('.', ','); };
  const aspectosTxt = {
    rp: { r: mediaRP('r'), p: mediaRP('p') },
    ofensivos: { potenciar: cinco(origenTxt('of_pot')), mejorar: cinco(origenTxt('of_mej')) },
    defensivos: { potenciar: cinco(origenTxt('def_pot')), mejorar: cinco(origenTxt('def_mej')) },
  };

  if (jugFichaTab === 'ficha1' || jugFichaTab === 'ficha2') jugFichaTab = 'fichas';
  const refKey = jugRefKey(evSel, id);
  const refLista = jugRef.who && (jugRef.who !== 'jug' || (jugRef.jugId && jugRef.evalId));
  const refData = (refLista && refKey) ? (jugRefCache[refKey] || null) : null;
  if (refLista && refKey && !refData && regs && !isFirebaseUnconfigured()) cargarReferencia(container, p, evSel);
  const fichaTabHTML = !regs ? '<p class="text-xs text-muted">Cargando…</p>'
    : (!evSel && !p.positionKey) ? '<p class="text-xs text-muted">Este jugador no tiene posición asignada: edítalo para elegir una.</p>'
    : `
      ${evSel ? `<div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
        <label class="text-xs text-muted" for="jug-ficha-eval">Evaluación</label>
        <select class="select" id="jug-ficha-eval" style="max-width:360px;">
          ${filasEval.map((f, i) => `<option value="${f.eid}" ${f.eid === evSel.eid ? 'selected' : ''}>${safeText(evLabel(f.eid))}${i === 0 ? ' — final' : ''}</option>`).join('')}
        </select>
      </div>` : '<p class="text-xs text-muted mb-16">Sin evaluaciones importadas: ficha tipo de la posición, sin notas.</p>'}
      ${evSel ? `<div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
        <label class="text-xs text-muted" for="jug-ref-who">Comparar medias con</label>
        <select class="select" id="jug-ref-who" style="max-width:220px;">${JUG_REF_QUIEN.map(([v, l]) => `<option value="${v}" ${v === jugRef.who ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${jugRef.who && jugRef.who !== 'jug' ? `<select class="select" id="jug-ref-when" style="max-width:220px;">
          <option value="eval" ${jugRef.when === 'eval' ? 'selected' : ''}>Esta evaluación</option>
          ${[...new Set((regEvaluaciones || []).map(e => e.temporada).filter(Boolean))].sort().reverse().map(t => `<option value="temp:${safeText(t)}" ${jugRef.when === 'temp:' + t ? 'selected' : ''}>Temporada ${safeText(t)}</option>`).join('')}
          <option value="todo" ${jugRef.when === 'todo' ? 'selected' : ''}>Todo el histórico</option>
        </select>` : ''}
        ${jugRef.who === 'jug' ? `<select class="select" id="jug-ref-jug" style="max-width:260px;">
          <option value="">Jugador…</option>
          ${[...state.players].sort((a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`)).map(x => `<option value="${x.id}" ${x.id === jugRef.jugId ? 'selected' : ''}>${safeText(`${x.apellidos || ''}, ${x.nombre || ''}`)}</option>`).join('')}
        </select>
        <select class="select" id="jug-ref-eval" style="max-width:260px;">
          <option value="">Evaluación…</option>
          ${(regEvaluaciones || []).map(e => `<option value="${e.id}" ${e.id === jugRef.evalId ? 'selected' : ''}>${safeText(`${e.temporada} · ${e.nombre}`)}</option>`).join('')}
        </select>` : ''}
        ${refLista && !refData ? '<span class="text-xs text-muted">Calculando…</span>' : ''}
      </div>` : ''}
      <div class="mb-8 flex gap-8 btn-print-ficha" style="flex-wrap:wrap;align-items:center;">
        <b>Ficha 1</b>
        <button class="btn btn-primary btn-print-ficha" id="jug-fichas-pdf">⬇ PDF Ficha 1 + 2</button>
        <button class="btn btn-sm btn-print-ficha" id="jug-ficha1-pdf">⬇ Solo Ficha 1</button>
        <button class="btn btn-sm" id="jug-textos-guardar">Guardar textos</button>
        <button class="btn btn-sm" id="jug-textos-restaurar" ${p.fichaTextos?.[textosKey] ? '' : 'disabled'}>Restaurar desde la encuesta</button>
        <span class="text-xs text-muted">Ofensivos/defensivos a potenciar y mejorar: vienen de la encuesta, edítalos en la ficha y pulsa Guardar textos.${textosExtra ? ` Hay ${textosExtra} respuestas más de las que caben (5 filas).` : ''}</span>
      </div>
      <div id="jug-ficha1-wrap" class="ficha-wrap mb-16"></div>
      <div class="mb-8 flex gap-8 btn-print-ficha" style="flex-wrap:wrap;align-items:center;">
        <b>Ficha 2</b>
        <button class="btn btn-sm btn-print-ficha" id="jug-ficha2-pdf">⬇ Solo Ficha 2</button>
      </div>
      <div id="jug-ficha2-wrap" class="ficha-wrap"></div>`;

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="flex gap-8 mb-16">
      <button class="btn btn-ghost" id="jug-ficha-volver">${jugVolverA === 'plantillas' ? '← Volver a Plantillas' : '← Volver a la lista'}</button>
      <button class="btn btn-primary" id="jug-ficha-editar">Editar</button>
    </div>
    <div class="card mb-16"><div class="card-body">
      <div class="flex gap-16" style="align-items:center;flex-wrap:wrap;">
        ${p.fotoUrl ? `<img src="${p.fotoUrl}" alt="" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" />` : '<div style="width:80px;height:80px;border-radius:50%;background:var(--bg-hover);"></div>'}
        <div>
          <div style="font-size:22px;font-weight:800;">${safeText(`${p.nombre || ''} ${p.apellidos || ''}`.trim() || 'Jugador')}</div>
          <div class="text-muted">${safeText([teamLabel, posLabel, year ? `Año ${year}` : null, age != null ? `${age} años` : null].filter(Boolean).join(' · ') || 'Sin datos de equipo/posición')}</div>
        </div>
      </div>
    </div></div>
    <div class="flex gap-8 mb-16">
      <button class="btn ${jugFichaTab === 'datos' ? 'btn-primary' : 'btn-sm'}" data-jug-tab="datos">Datos personales</button>
      <button class="btn ${jugFichaTab === 'fichas' ? 'btn-primary' : 'btn-sm'}" data-jug-tab="fichas">Ficha 1 y Ficha 2</button>
    </div>
    ${jugFichaTab === 'datos' ? datosHTML : fichaTabHTML}
  `;

  if (jugFichaTab !== 'datos' && regs && (evSel || p.positionKey)) {
    const fPos = evSel?.posKey || p.positionKey, fMedia = evSel?.media || null;
    renderFichaPagina1(container.querySelector('#jug-ficha1-wrap'), buildFicha1RealData(fPos, fMedia, p, aspectosTxt, evSel?.eid), LOGO_PATH, state.fichaColors);
    setGpsTolerance(state.condicionalTolerance);
    renderFichaDetalle(container.querySelector('#jug-ficha2-wrap'), buildFichaRealData(fPos, fMedia, p, evSel?.eid, refData), LOGO_PATH, state.scoreBands, undefined, state.fichaColors, state.fichaGridOrder);
  }

  container.querySelector('#jug-fichas-pdf')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const f1 = container.querySelector('#jug-ficha1-wrap .p1-detalle');
    const f2 = container.querySelector('#jug-ficha2-wrap .ficha-detalle');
    if (!f1 || !f2) return;
    f1.dataset.pie = f2.dataset.pie = pieEvaluacion(evSel?.ev);
    btn.disabled = true; btn.textContent = 'Generando PDF…';
    try {
      const nombre = `${p.nombre || ''} ${p.apellidos || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jugador';
      await exportFichasAsPDF([f1, f2], `${nombre}-fichas.pdf`);
    } catch (err) {
      showError('No se pudo generar el PDF: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '⬇ PDF Ficha 1 + 2';
    }
  });
  [['1', '.p1-detalle'], ['2', '.ficha-detalle']].forEach(([n, sel]) => {
    container.querySelector(`#jug-ficha${n}-pdf`)?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const fichaEl = container.querySelector(`#jug-ficha${n}-wrap ${sel}`);
      if (!fichaEl) return;
      btn.disabled = true; btn.textContent = 'Generando PDF…';
      try {
        const nombre = `${p.nombre || ''} ${p.apellidos || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jugador';
        await exportFichaAsPDF(fichaEl, `${nombre}-ficha${n}.pdf`);
      } catch (err) {
        showError('No se pudo generar el PDF: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = n === '1' ? '⬇ Solo Ficha 1' : '⬇ Solo Ficha 2';
      }
    });
  });
  container.querySelector('#jug-textos-guardar')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const wrap = container.querySelector('#jug-ficha1-wrap');
    const grids = [...wrap.querySelectorAll('.p1-aspectos-grid')];
    const leer = (g, i) => [...(g?.querySelectorAll('.p1-aspectos-col')[i]?.querySelectorAll('li') || [])].map(li => li.innerText.trim());
    const nuevo = { of_pot: leer(grids[0], 0), of_mej: leer(grids[0], 1), def_pot: leer(grids[1], 0), def_mej: leer(grids[1], 1) };
    const fichaTextos = { ...(p.fichaTextos || {}), [textosKey]: nuevo };
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await updateDocument('jugadores', id, { fichaTextos });
      setState({ players: state.players.map(x => x.id === id ? { ...x, fichaTextos } : x) });
      showSuccess('Textos de la ficha guardados.');
    } catch (err) {
      console.error('[Firestore] No se pudieron guardar los textos:', err);
      showError('No se pudieron guardar (revisa las reglas de Firestore).');
    } finally { btn.disabled = false; btn.textContent = 'Guardar textos'; }
  });
  container.querySelector('#jug-textos-restaurar')?.addEventListener('click', async () => {
    const fichaTextos = { ...(p.fichaTextos || {}) };
    delete fichaTextos[textosKey];
    try {
      await updateDocument('jugadores', id, { fichaTextos });
      setState({ players: state.players.map(x => x.id === id ? { ...x, fichaTextos } : x) });
      renderPanelJugadores(container);
    } catch (err) { showError('No se pudo restaurar.'); }
  });
  container.querySelectorAll('[data-jug-tab]').forEach(btn => btn.addEventListener('click', () => {
    jugFichaTab = btn.dataset.jugTab;
    preservandoScroll(() => renderPanelJugadores(container));
  }));
  [['who', '#jug-ref-who'], ['when', '#jug-ref-when'], ['jugId', '#jug-ref-jug'], ['evalId', '#jug-ref-eval']].forEach(([campo, sel]) => {
    container.querySelector(sel)?.addEventListener('change', e => {
      jugRef = { ...jugRef, [campo]: e.target.value };
      preservandoScroll(() => renderPanelJugadores(container));
    });
  });
  container.querySelector('#jug-ficha-eval')?.addEventListener('change', e => {
    jugFichaEvalId = e.target.value;
    preservandoScroll(() => renderPanelJugadores(container));
  });
  container.querySelector('#jug-ficha-volver')?.addEventListener('click', () => {
    jugFichaId = null;
    if (jugVolverA === 'plantillas') { jugVolverA = null; switchTab('plantillas'); return; }
    renderPanelJugadores(container);
  });
  container.querySelector('#jug-ficha-editar')?.addEventListener('click', async () => {
    await cargarEvaluacionesSilencioso();
    jugadorFormId = id;
    renderPanelJugadores(container);
  });
}

let jugadorHistoricoOpenId = null; // qué jugador tiene el histórico desplegado
let jugadorHistoricoCache  = {};   // { [playerId]: entries[] } — evita releer si ya se abrió

function renderPanelJugadores(container) {
  const editingPlayer = (jugadorFormId && jugadorFormId !== 'new')
    ? state.players.find(p => p.id === jugadorFormId)
    : null;
  if (jugadorFormId && jugadorFormId !== 'new' && !editingPlayer) jugadorFormId = null; // se borró, cierra el form

  // Ficha de jugador abierta (y sin formulario de edición encima) → vista de ficha
  if (jugFichaId && !jugadorFormId) {
    const fichaPlayer = state.players.find(pl => pl.id === jugFichaId);
    if (fichaPlayer) { renderFichaJugador(container, fichaPlayer); return; }
    jugFichaId = null; // el jugador ya no existe
  }
  const soloForm = !!(jugFichaId && jugadorFormId); // editando desde la ficha: se oculta la lista

  const jugadoresFiltrados = state.players.filter(jugadorPasaFiltros);
  const rows = jugadoresFiltrados.map(p => {
    const { age, year } = calcAgeAndYear(p.birthDate);
    const teamLabel = TEAMS.find(t => t.key === p.teamKey)?.label || '-';
    const posLabel  = state.positions.find(pos => pos.key === p.positionKey)?.label || '-';
    const historicoRow = jugadorHistoricoOpenId === p.id ? `
      <tr><td colspan="10" style="background:var(--bg-hover);">
        ${jugadorHistoricoCache[p.id] ? buildHistoricoHTML(jugadorHistoricoCache[p.id]) : '<p class="text-xs text-muted">Cargando…</p>'}
      </td></tr>
    ` : '';
    return `
      <tr>
        <td>${p.fotoUrl ? `<img src="${p.fotoUrl}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" />` : ''}</td>
        <td><a href="#" data-jug-ficha="${p.id}" style="font-weight:600;color:inherit;text-decoration:underline;cursor:pointer;">${safeText(p.nombre || '')}</a></td>
        <td><a href="#" data-jug-ficha="${p.id}" style="font-weight:600;color:inherit;text-decoration:underline;cursor:pointer;">${safeText(p.apellidos || '')}</a></td>
        <td>${year ?? '-'}</td>
        <td>${age ?? '-'}</td>
        <td>${safeText(teamLabel)}</td>
        <td>${safeText(posLabel)}</td>
        <td>${p.weight != null ? p.weight + ' kg' : '-'}</td>
        <td>${p.height != null ? p.height + ' m' : '-'}</td>
        <td>
          <button class="btn btn-sm" data-jug-ficha="${p.id}">Ficha</button>
          <button class="btn btn-sm" data-jug-edit="${p.id}">Editar</button>
          <button class="btn btn-sm" data-jug-hist="${p.id}">${jugadorHistoricoOpenId === p.id ? 'Ocultar histórico' : 'Histórico'}</button>
          <button class="btn btn-sm" data-jug-del="${p.id}">Borrar</button>
        </td>
      </tr>
      ${historicoRow}
    `;
  }).join('');

  container.innerHTML = `
    ${firebaseNotice()}
    ${jugadorFormId ? buildJugadorFormHTML(editingPlayer) : ''}
    ${soloForm ? '' : buildJugadoresFiltrosHTML()}
    <div class="card" ${soloForm ? 'style="display:none;"' : ''}>
      <div class="card-title">Jugadores (${jugadoresFiltrados.length}${jugadoresFiltrados.length !== state.players.length ? ` de ${state.players.length}` : ''})</div>
      <div class="card-body">
        ${jugadorFormId ? '' : '<button class="btn btn-primary mb-16" id="jug-add">+ Añadir jugador</button>'}
        <div style="overflow-x:auto;">
          <table class="table">
            <thead>
              <tr>
                <th></th><th>Nombre</th><th>Apellidos</th><th>Año</th><th>Edad</th>
                <th>Equipo</th><th>Posición</th><th>Peso</th><th>Altura</th><th></th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="10" class="text-muted">${state.players.length ? 'Ningún jugador coincide con los filtros.' : 'Sin jugadores todavía.'}</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Filtros: la búsqueda por texto mantiene el foco al re-pintar
  const refiltrar = conFoco => {
    renderPanelJugadores(container);
    if (conFoco) {
      const inp = container.querySelector('#jug-f-q');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  };
  container.querySelector('#jug-f-q')?.addEventListener('input', e => { jugFiltros.q = e.target.value; refiltrar(true); });
  [['#jug-f-team', 'teamKey'], ['#jug-f-pos', 'positionKey'], ['#jug-f-year', 'year'], ['#jug-f-foot', 'foot']].forEach(([sel, key]) => {
    container.querySelector(sel)?.addEventListener('change', e => { jugFiltros[key] = e.target.value; refiltrar(false); });
  });
  container.querySelector('#jug-f-clear')?.addEventListener('click', () => {
    jugFiltros = { q: '', teamKey: '', positionKey: '', year: '', foot: '' };
    refiltrar(false);
  });
  container.querySelectorAll('[data-jug-ficha]').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.preventDefault();
      await cargarEvaluacionesSilencioso();
      jugFichaId = btn.dataset.jugFicha;
      jugFichaTab = 'datos'; jugVolverA = null;
      jugFichaEvalId = null; // por defecto, evaluación final
      renderPanelJugadores(container);
    });
  });

  // Foto: al elegir archivo se abre un recorte circular (mover + zoom). Al guardar se sube el recorte.
  const CROP_V = 180;
  let crop = null;
  const cropImgEl = container.querySelector('#jug-crop-img');
  const cropViewEl = container.querySelector('#jug-crop-view');
  const cropZoomEl = container.querySelector('#jug-crop-zoom');
  const aplicarCrop = () => {
    if (!crop) return;
    const scale = crop.min * crop.zoom;
    const w = crop.natW * scale, h = crop.natH * scale;
    crop.x = Math.min(0, Math.max(CROP_V - w, crop.x));
    crop.y = Math.min(0, Math.max(CROP_V - h, crop.y));
    cropImgEl.style.width = w + 'px';
    cropImgEl.style.height = h + 'px';
    cropImgEl.style.left = crop.x + 'px';
    cropImgEl.style.top = crop.y + 'px';
  };
  container.querySelector('#jug-foto')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) { crop = null; container.querySelector('#jug-crop').style.display = 'none'; return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const min = Math.max(CROP_V / img.naturalWidth, CROP_V / img.naturalHeight);
      crop = { img, natW: img.naturalWidth, natH: img.naturalHeight, min, zoom: 1,
               x: (CROP_V - img.naturalWidth * min) / 2, y: (CROP_V - img.naturalHeight * min) / 2 };
      cropImgEl.src = url;
      cropZoomEl.value = 1;
      container.querySelector('#jug-crop').style.display = 'block';
      const prev = container.querySelector('#jug-foto-preview');
      if (prev) prev.style.display = 'none';
      aplicarCrop();
    };
    img.onerror = () => { crop = null; showError('No se pudo leer esa imagen.'); };
    img.src = url;
  });
  cropZoomEl?.addEventListener('input', () => {
    if (!crop) return;
    const old = crop.min * crop.zoom;
    const cx = (CROP_V / 2 - crop.x) / old, cy = (CROP_V / 2 - crop.y) / old; // punto central en coords de imagen
    crop.zoom = Number(cropZoomEl.value);
    const nuevo = crop.min * crop.zoom;
    crop.x = CROP_V / 2 - cx * nuevo;
    crop.y = CROP_V / 2 - cy * nuevo;
    aplicarCrop();
  });
  let cropDrag = null;
  cropViewEl?.addEventListener('pointerdown', e => {
    if (!crop) return;
    cropDrag = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
    cropViewEl.setPointerCapture(e.pointerId);
    cropViewEl.style.cursor = 'grabbing';
  });
  cropViewEl?.addEventListener('pointermove', e => {
    if (!cropDrag || !crop) return;
    crop.x = cropDrag.x + (e.clientX - cropDrag.px);
    crop.y = cropDrag.y + (e.clientY - cropDrag.py);
    aplicarCrop();
  });
  const finDrag = () => { cropDrag = null; if (cropViewEl) cropViewEl.style.cursor = 'grab'; };
  cropViewEl?.addEventListener('pointerup', finDrag);
  cropViewEl?.addEventListener('pointercancel', finDrag);
  /** Recorte visible → JPEG 400×400 (ligero, ~40-80 KB). */
  const exportarCrop = () => new Promise(resolve => {
    const OUT = 400;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const scale = crop.min * crop.zoom;
    const cx = canvas.getContext('2d');
    cx.drawImage(crop.img, -crop.x / scale, -crop.y / scale, CROP_V / scale, CROP_V / scale, 0, 0, OUT, OUT);
    // Conserva la transparencia: WebP con alfa (ligero, ~30-60 KB). Si el navegador no lo da, PNG; último recurso JPEG blanco.
    const aJpeg = () => {
      const c2 = document.createElement('canvas'); c2.width = c2.height = OUT;
      const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, OUT, OUT); x2.drawImage(canvas, 0, 0);
      c2.toBlob(b => resolve(b ? new File([b], 'foto.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
    };
    canvas.toBlob(wp => {
      if (wp && wp.type === 'image/webp' && wp.size <= 450000) { resolve(new File([wp], 'foto.webp', { type: 'image/webp' })); return; }
      canvas.toBlob(png => {
        if (png && png.size <= 450000) { resolve(new File([png], 'foto.png', { type: 'image/png' })); return; }
        aJpeg();
      }, 'image/png');
    }, 'image/webp', 0.92);
  });

  container.querySelector('#jug-add')?.addEventListener('click', async () => {
    await cargarEvaluacionesSilencioso();
    jugadorFormId = 'new';
    renderPanelJugadores(container);
  });
  container.querySelector('#jug-cancel')?.addEventListener('click', () => {
    jugadorFormId = null;
    renderPanelJugadores(container);
  });
  container.querySelectorAll('[data-jug-edit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await cargarEvaluacionesSilencioso();
      jugadorFormId = btn.dataset.jugEdit;
      renderPanelJugadores(container);
    });
  });
  container.querySelectorAll('[data-jug-hist]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.jugHist;
      if (jugadorHistoricoOpenId === id) {
        jugadorHistoricoOpenId = null;
        renderPanelJugadores(container);
        return;
      }
      jugadorHistoricoOpenId = id;
      renderPanelJugadores(container);
      if (!jugadorHistoricoCache[id] && !isFirebaseUnconfigured()) {
        try {
          jugadorHistoricoCache[id] = await readSubCollection('jugadores', id, 'historico');
        } catch (err) {
          console.error('[Firestore] No se pudo leer el histórico:', err);
          jugadorHistoricoCache[id] = [];
        }
        if (jugadorHistoricoOpenId === id) renderPanelJugadores(container);
      } else if (isFirebaseUnconfigured()) {
        jugadorHistoricoCache[id] = [];
        renderPanelJugadores(container);
      }
    });
  });
  container.querySelectorAll('[data-jug-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.jugDel;
      try {
        if (!isFirebaseUnconfigured()) await deleteDocument('jugadores', id);
        setState({ players: state.players.filter(p => p.id !== id) });
        renderPanelJugadores(container);
        showSuccess('Jugador borrado.');
      } catch (err) {
        console.error('[Firestore] No se pudo borrar el jugador:', err);
        showError('No se pudo borrar el jugador (revisa las reglas de Firestore).');
      }
    });
  });
  // Datos condicionales por evaluación: borrador en memoria hasta pulsar Guardar.
  const condSel = container.querySelector('#jug-cond-eval');
  const condInputs = [...container.querySelectorAll('[data-jug-cond]')];
  const condMaxInputs = [...container.querySelectorAll('[data-jug-condmax]')];
  const condDraft = JSON.parse(JSON.stringify((jugadorFormId !== 'new' && editingPlayer?.condicionalPorEval) || {}));
  const condMaxDraft = JSON.parse(JSON.stringify((jugadorFormId !== 'new' && editingPlayer?.condicionalMaxPorEval) || {}));
  let condEvalActual = condSel?.value || null;
  const condVolcar = () => { // inputs → borrador de la evaluación actual
    if (!condEvalActual) return;
    condDraft[condEvalActual] = condDraft[condEvalActual] || {};
    condInputs.forEach(inp => {
      const raw = inp.value.trim();
      if (raw === '') delete condDraft[condEvalActual][inp.dataset.jugCond];
      else condDraft[condEvalActual][inp.dataset.jugCond] = raw; // se valida al guardar
    });
    condMaxDraft[condEvalActual] = condMaxDraft[condEvalActual] || {};
    condMaxInputs.forEach(inp => {
      const raw = inp.value.trim();
      if (raw === '') delete condMaxDraft[condEvalActual][inp.dataset.jugCondmax];
      else condMaxDraft[condEvalActual][inp.dataset.jugCondmax] = raw;
    });
  };
  const condCargar = () => { // borrador → inputs
    condInputs.forEach(inp => { inp.value = condDraft[condEvalActual]?.[inp.dataset.jugCond] ?? ''; });
    condMaxInputs.forEach(inp => { inp.value = condMaxDraft[condEvalActual]?.[inp.dataset.jugCondmax] ?? ''; });
  };
  if (condSel) condCargar();
  condSel?.addEventListener('change', () => { condVolcar(); condEvalActual = condSel.value; condCargar(); });

  container.querySelector('#jug-save')?.addEventListener('click', async () => {
    let condicionalPorEval = null, condicionalMaxPorEval = null;
    if (condSel) {
      condVolcar();
      condicionalMaxPorEval = {};
      for (const [evId, valores] of Object.entries(condMaxDraft)) {
        for (const [slug, raw] of Object.entries(valores)) {
          const n = typeof raw === 'number' ? raw : parseEsNumber(raw);
          if (n == null) { showError('Alguna máxima condicional no es un número.'); return; }
          (condicionalMaxPorEval[evId] = condicionalMaxPorEval[evId] || {})[slug] = n;
        }
      }
      condicionalPorEval = {};
      for (const [evId, valores] of Object.entries(condDraft)) {
        for (const [slug, raw] of Object.entries(valores)) {
          const n = typeof raw === 'number' ? raw : parseEsNumber(raw);
          if (n == null) { showError('Algún dato condicional no es un número.'); return; }
          (condicionalPorEval[evId] = condicionalPorEval[evId] || {})[slug] = n;
        }
      }
    }
    const baseData = {
      nombre: container.querySelector('#jug-nombre').value.trim(),
      apellidos: container.querySelector('#jug-apellidos').value.trim(),
      birthDate: container.querySelector('#jug-birthdate').value || null,
      foot: container.querySelector('#jug-foot').value,
      residencia: container.querySelector('#jug-residencia').value,
      maturationalAge: container.querySelector('#jug-maturational').value.trim(),
    };
    const historicoData = {
      teamKey: container.querySelector('#jug-team').value || null,
      positionKey: container.querySelector('#jug-position').value || null,
      weight: container.querySelector('#jug-weight').value === '' ? null : parseFloat(container.querySelector('#jug-weight').value),
      height: container.querySelector('#jug-height').value === '' ? null : parseFloat(container.querySelector('#jug-height').value),
      complexion: container.querySelector('#jug-complexion').value.trim() || null,
    };
    if (condicionalPorEval) baseData.condicionalPorEval = condicionalPorEval;
    if (condicionalMaxPorEval) baseData.condicionalMaxPorEval = condicionalMaxPorEval;
    let fotoFile = container.querySelector('#jug-foto').files[0] || null;
    if (!baseData.nombre) { showError('El nombre es obligatorio.'); return; }
    const saveBtn = container.querySelector('#jug-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando…';
    if (fotoFile && crop) fotoFile = (await exportarCrop()) || fotoFile; // sube el recorte, no el original

    // ¿Cambió algún dato con histórico respecto al valor actual? Solo se
    // añade una entrada de histórico si de verdad hay un cambio — evita
    // entradas vacías o repetidas cada vez que se guarda el formulario.
    const isNew = jugadorFormId === 'new';
    const prev = isNew ? {} : (editingPlayer || {});
    const changedHistorico = isNew
      ? HISTORICO_FIELDS.some(f => historicoData[f] !== null)
      : HISTORICO_FIELDS.some(f => historicoData[f] !== (prev[f] ?? null));

    try {
      let id;
      if (isNew) {
        const data = { ...baseData, ...historicoData };
        id = isFirebaseUnconfigured() ? crypto.randomUUID() : await addDocument('jugadores', data);
        setState({ players: [...state.players, { id, ...data }] });
      } else {
        id = jugadorFormId;
        const data = { ...baseData, ...historicoData };
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', id, data);
        setState({ players: state.players.map(p => p.id === id ? { ...p, ...data } : p) });
      }

      if (historicoData.teamKey && (isNew || historicoData.teamKey !== (prev.teamKey ?? null))) {
        try { await añadirAPlantilla(id, historicoData.teamKey, state.season); }
        catch (err) { console.error('[Firestore] No se pudo añadir a la plantilla:', err); showError('Jugador guardado, pero no se pudo añadir a la plantilla.'); }
      }

      if (changedHistorico && !isFirebaseUnconfigured()) {
        await addSubDocument('jugadores', id, 'historico', historicoData);
        delete jugadorHistoricoCache[id]; // se recarga la próxima vez que se abra
      }

      if (fotoFile && !isFirebaseUnconfigured()) {
        try {
          // Foto 400×400 JPEG (~40-80 KB) guardada como data URL en el doc: sin Storage.
          const fotoUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => rej(fr.error || new Error('lectura de foto'));
            fr.readAsDataURL(fotoFile);
          });
          if (fotoUrl.length > 700000) throw new Error('foto demasiado grande');
          await updateDocument('jugadores', id, { fotoUrl });
          setState({ players: state.players.map(p => p.id === id ? { ...p, fotoUrl } : p) });
        } catch (err) {
          console.error('[Storage] No se pudo subir la foto:', err);
          showError(`Jugador guardado, pero la foto no se pudo guardar [${err?.code || err?.message || 'error desconocido'}].`, 9000);
        }
      }

      showSuccess(isNew ? 'Jugador añadido.' : 'Jugador actualizado.');
      jugadorFormId = null;
      renderPanelJugadores(container);
    } catch (err) {
      console.error('[Firestore] No se pudo guardar el jugador:', err);
      showError(`No se pudo guardar el jugador [${err?.code || err?.message || 'error desconocido'}] (revisa las reglas de Firestore o la conexión).`, 9000);
      saveBtn.disabled = false;
      saveBtn.textContent = jugadorFormId === 'new' ? 'Añadir jugador' : 'Guardar cambios';
    }
  });
}

let fichasSubPage = 1; // qué página de la ficha se muestra: 1 ó 2

/**
 * Construye los datos de la ficha 2 (mental/técnico/táctico/condicional)
 * a partir del esquema de Configuración de una posición — así, si cambias
 * los items ahí, se reflejan aquí. Valores siempre en blanco (demo).
 */
function buildFichaDemoFromSchema(positionKey) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const rated = list => (list || []).map(label => ({ label, value: null }));
  // refA/refB (columnas 3/4) = valores fijos de Configuración → Datos condicionales
  // para esta posición. valueA/valueB (columnas 1/2) son manuales — sin datos aún.
  const condicional = (state.aspectosComunes.condicional || []).map(label => {
    const ref = state.condicionalRefs?.[positionKey]?.[label] || {};
    return {
      label, valueA: null, valueB: null,
      refA: ref.col3 ?? null, refB: ref.col4 ?? null,
    };
  });

  return {
    player: { name: 'Jugador de ejemplo', photoUrl: null },
    blocks: {
      mental:      { rp: [null, null], items: rated(state.aspectosComunes.mental) },
      tecnico:     { rp: [null, null], items: rated(schema.tecnico ?? state.aspectosComunes.tecnico) },
      tactico:     { rp: [null, null], items: rated(schema.tactico) },
      condicional: { rp: null,         items: condicional },
    },
    plan: {
      tecnico:     ['', '', '', '', '', '', ''],
      tactico:     ['', '', '', '', '', '', ''],
      condicional: ['', '', '', '', '', '', ''],
      mental:      ['', '', '', '', '', '', ''],
    },
  };
}

/**
 * Ficha 1: Personalidad = derivada de Mental (sin duplicar dato, fuente única).
 * Ofensivas/Defensivas = las seleccionadas en Configuración (subconjunto de Táctico).
 */
function buildFicha1DemoFromSchema(positionKey) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const mental = state.aspectosComunes.mental || [];
  const mid = Math.ceil(mental.length / 2);
  const positionLabel = PROFILES.find(p => p.key === positionKey)?.label || FICHA1_DEMO_DATA.player.position;
  // Ofensivas/Defensivas se guardan en el orden en que se van marcando los
  // checkboxes (histórico de clics), no en el orden del Táctico que se ve
  // en pantalla. Aquí se reordenan siguiendo el Táctico, para que la ficha
  // coincida siempre con el orden visual de Aspectos.
  const tactico = schema.tactico || [];
  const orderByTactico = selected => tactico.filter(t => (selected || []).includes(t));
  // Perfil 1/2/3 son genéricos solo si la posición aún no tiene perfiles
  // propios definidos en Configuración → Perfiles — si los tiene, se usan
  // sus nombres reales (ej. "Dominador de área"), sin inventar ni duplicar.
  const perfiles = schema.perfiles || [];
  return {
    ...FICHA1_DEMO_DATA,
    player: { ...FICHA1_DEMO_DATA.player, position: positionLabel },
    statusBars: perfiles.length ? perfiles.map(nombre => ({ label: nombre, color: null })) : FICHA1_DEMO_DATA.statusBars,
    personalidad: {
      col1: mental.slice(0, mid).map(label => ({ label, status: null })),
      col2: mental.slice(mid).map(label => ({ label, status: null })),
    },
    competenciasOfensivas: orderByTactico(schema.competenciasOfensivas).map(label => ({ label, status: null })),
    competenciasDefensivas: orderByTactico(schema.competenciasDefensivas).map(label => ({ label, status: null })),
    frasesModelo: state.frasesModelo,
    simbolos: simbolosFicha1(),
  };
}

function renderPanelFichas(container, positionKey = 'portero') {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="mb-16 flex ficha-toolbar" style="justify-content:space-between;align-items:center;">
      <div class="flex gap-8">
        <button class="btn ${fichasSubPage === 1 ? 'btn-primary' : 'btn-sm'}" data-ficha-page="1">Ficha 1</button>
        <button class="btn ${fichasSubPage === 2 ? 'btn-primary' : 'btn-sm'}" data-ficha-page="2">Ficha 2</button>
      </div>
      <button class="btn btn-primary btn-print-ficha" id="btn-print-ficha">⬇ Descargar PDF</button>
    </div>
    <p class="text-xs text-muted mb-16">Datos de ejemplo, pendiente de conectar a Firestore.</p>
    <div id="ficha1-demo-wrap" class="ficha-wrap ${fichasSubPage === 1 ? '' : 'hidden'}"></div>
    <div id="ficha-demo-wrap" class="ficha-wrap ${fichasSubPage === 2 ? '' : 'hidden'}"></div>
  `;
  const wrap1 = container.querySelector('#ficha1-demo-wrap');
  renderFichaPagina1(wrap1, buildFicha1DemoFromSchema(positionKey), LOGO_PATH, state.fichaColors);

  const wrap = container.querySelector('#ficha-demo-wrap');
  setGpsTolerance(state.condicionalTolerance);
  renderFichaDetalle(wrap, buildFichaDemoFromSchema(positionKey), LOGO_PATH, state.scoreBands, undefined, state.fichaColors, state.fichaGridOrder);

  container.querySelectorAll('[data-ficha-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      fichasSubPage = Number(btn.dataset.fichaPage);
      preservandoScroll(() => renderPanelFichas(container, positionKey));
    });
  });

  const btnPrint = container.querySelector('#btn-print-ficha');
  btnPrint.addEventListener('click', async () => {
    const activeWrap = fichasSubPage === 1 ? wrap1 : wrap;
    const fichaEl = activeWrap.querySelector('.ficha-detalle');
    if (!fichaEl) return;
    btnPrint.disabled = true;
    btnPrint.textContent = 'Generando PDF…';
    try {
      await exportFichaAsPDF(fichaEl, `ficha-tipo-${positionKey}-pagina${fichasSubPage}.pdf`);
    } catch (err) {
      showError('No se pudo generar el PDF: ' + err.message);
    } finally {
      btnPrint.disabled = false;
      btnPrint.textContent = '⬇ Descargar PDF';
    }
  });
}

function renderPanelConfig(container) {
  const bandsSorted = [...state.scoreBands].sort((a, b) => b.min - a.min);
  const posRows = state.positions.map(p => `
    <span class="chip">${safeText(p.label)} <button data-del-pos="${p.key}" title="Quitar">×</button></span>
  `).join('');
  const seasonRows = state.seasons.map(s => `
    <span class="chip">${safeText(s)} <button data-del-season="${safeText(s)}" title="Quitar">×</button></span>
  `).join('');

  if (configCriteriaPosition && !state.positions.some(p => p.key === configCriteriaPosition)) {
    configCriteriaPosition = null;
  }
  if (!configCriteriaPosition && state.positions.length) {
    configCriteriaPosition = state.positions[0].key;
  }

  if (fichaTipoPosition && !state.positions.some(p => p.key === fichaTipoPosition)) {
    fichaTipoPosition = null;
  }
  if (!fichaTipoPosition && state.positions.length) {
    fichaTipoPosition = state.positions[0].key;
  }

  const grupoCfg = CONFIG_GROUPS.find(g => g.tabs.some(t => t.key === configSubTab)) || CONFIG_GROUPS[0];
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="rm-sticky mb-16" style="border-bottom:1px solid var(--border-default);padding-bottom:8px;">
      <div class="flex gap-8 mb-8" style="align-items:center;flex-wrap:wrap;">
        ${CONFIG_GROUPS.map(g => `<button class="btn ${g === grupoCfg ? 'btn-primary' : 'btn-sm'}" data-config-group="${g.label}" style="font-weight:700;">${g.label}</button>`).join('')}
      </div>
      <div class="flex gap-8" style="align-items:center;flex-wrap:wrap;">
        ${grupoCfg.tabs.map(t => `<button class="btn ${t.key === configSubTab ? 'btn-secondary' : 'btn-sm'}" ${t.key === configSubTab ? 'style="background:var(--bg-hover);border-color:var(--border-strong,var(--border-default));font-weight:700;"' : ''} data-config-subtab="${t.key}">${t.label}</button>`).join('')}
      </div>
    </div>

    ${configSubTab !== 'posiciones' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Posiciones</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Las evaluaciones (CSV, formularios) son por posición — esta lista es la que se usa en Plantillas para asignar posición a cada jugador.
        </p>
        <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          ${posRows || '<span class="text-xs text-muted">Sin posiciones definidas.</span>'}
        </div>
        <div class="flex gap-12" style="align-items:flex-end;">
          <label>
            <div class="text-xs text-muted mb-8">Nueva posición</div>
            <input class="input" type="text" id="pos-new" placeholder="Ej. Portero" />
          </label>
          <button class="btn btn-primary" id="pos-add">+ Añadir posición</button>
        </div>
      </div>
    </div>
    `}

    ${configSubTab !== 'items' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Items a evaluar</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Mental/Condicional son comunes a todas las posiciones. Técnico y Táctico varían por posición.
          Ofensivas/Defensivas (ficha 1) se seleccionan del Táctico de esa posición. Personalidad (ficha 1) se genera sola desde Mental.
        </p>
        ${state.positions.length === 0 ? '<p class="text-xs text-muted">Define primero al menos una posición en la pestaña Posiciones.</p>' : `
          <div class="flex gap-8 mb-16">
            <button class="btn ${itemsConfigPage === 1 ? 'btn-primary' : 'btn-sm'}" data-items-page="1">Ficha 1</button>
            <button class="btn ${itemsConfigPage === 2 ? 'btn-primary' : 'btn-sm'}" data-items-page="2">Ficha 2</button>
          </div>

          ${itemsConfigPage === 2 ? (
            buildAspectoComunCategoryHTML(ASPECTOS_COMUNES_CATEGORIES[0])
            + buildTecnicoCategoryHTML()
            + buildAspectoComunCategoryHTML(ASPECTOS_COMUNES_CATEGORIES[1])
          ) : `
            <div class="mb-16">
              <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Personalidad <span class="text-muted" style="font-weight:400;text-transform:none;font-size:11px;">(automática)</span></div>
              <p class="text-xs text-muted">Se genera desde Mental. Edítala en la pestaña "Ficha 2".</p>
            </div>
          `}

          ${itemsConfigPage === 2
            ? buildTacticoCategoryHTML()
            : `<div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Competencias</div>`
              + buildPositionSelectorHTML()
              + `<div class="flex gap-24" style="flex-wrap:wrap;">${buildOfenDefCheckboxesHTML('of', 'Ofensivas')}${buildOfenDefCheckboxesHTML('def', 'Defensivas')}</div>`
              + `<div class="mb-8 mt-16" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Perfiles</div>`
              + buildPositionSelectorHTML(false)
              + buildPerfilesCategoryHTML()
              + `<div class="mb-8 mt-16" style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.02em;color:var(--text-secondary);">Competencias de cada perfil (para la media)</div>`
              + buildPerfilCompetenciasHTML()}
        `}
      </div>
    </div>
    `}

    ${configSubTab !== 'temporadas' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Temporadas</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Al crear una temporada nueva, cada jugador empieza con el mismo equipo que tenía en la temporada anterior — luego lo cambias en Plantillas si se ha movido.
        </p>
        <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          ${seasonRows || '<span class="text-xs text-muted">Sin temporadas definidas.</span>'}
        </div>
        <div class="flex gap-12" style="align-items:flex-end;">
          <label>
            <div class="text-xs text-muted mb-8">Nueva temporada</div>
            <input class="input" type="text" id="season-new" placeholder="Ej. 2027/2028" />
          </label>
          <button class="btn btn-primary" id="season-add">+ Crear temporada</button>
        </div>
      </div>
    </div>
    `}

    ${configSubTab !== 'colores' ? '' : `
    <div class="card">
      <div class="card-title">Colores de las medias</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Se aplican a MENTAL, TÉCNICO y TÁCTICO (y al círculo central). CONDICIONAL usa objetivos GPS aparte (✔/✘), no estas bandas.
          Pon las bandas que necesites (3, 4, las que sean) — se ordenan solas de mayor a menor umbral.
        </p>
        <div class="flex gap-8" style="flex-direction:column;">
          ${bandsSorted.map((b, i) => `
            <div class="flex gap-12" style="align-items:center;" data-band-row="${i}">
              <input type="color" value="${b.color}" data-band-color="${i}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
              <span class="text-xs text-muted">a partir de</span>
              <input class="input" type="number" step="0.1" min="0" max="10" value="${b.min}" data-band-min="${i}" style="width:80px;" />
              <span class="text-xs text-muted">en Ficha 1:</span>
              <select class="select" data-band-simbolo="${i}" style="width:150px;">
                ${[['check', '✔ Check'], ['dash', '– Raya'], ['x', '✘ X'], ['box', '■ Cuadro de color']].map(([k, l]) => `<option value="${k}" ${(b.simbolo || SIMBOLOS_DEF[i] || 'box') === k ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
              <button class="btn btn-sm" data-band-del="${i}" ${bandsSorted.length <= 1 ? 'disabled' : ''}>Quitar</button>
            </div>
          `).join('')}
        </div>
        <button class="btn mt-16" id="band-add">+ Añadir banda de color</button>
      </div>
    </div>
    `}

    ${configSubTab !== 'condicional-refs' ? '' : `
    <div class="card">
      <div class="card-title">Datos condicionales</div>
      <div class="card-body">
        <div class="flex gap-24" style="align-items:flex-start;flex-wrap:wrap;">
          ${buildCondicionalRefsTableHTML()}
          <div class="field-group" style="min-width:220px;">
            <label class="label">Tolerancia (±) para el guion amarillo</label>
            <input class="input" type="text" id="condicional-tolerance" value="${state.condicionalTolerance}" style="max-width:140px;" />
            <p class="text-xs text-muted mt-8">
              En Ficha 2, si el valor del jugador está dentro de ± esta cifra respecto a la media profesional (columna 3), sale guion amarillo. Por encima → check verde. Por debajo → X roja.
            </p>
          </div>
        </div>
      </div>
    </div>
    `}

    ${configSubTab !== 'ficha-colores' ? '' : `
    <div class="card">
      <div class="card-title">Colores de la ficha</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          El fondo general y el de las cabeceras (MENTAL/TÉCNICO/... y PLAN DE ACCIÓN) de la ficha 1 y la ficha 2.
        </p>
        <div class="flex mb-16" style="gap:24px;flex-wrap:wrap;">
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-slate" value="${state.fichaColors.slate}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Fondo general</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-wine" value="${state.fichaColors.wine}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Cabeceras (granate)</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-general" value="${state.fichaColors.textGeneral}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto general</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-header" value="${state.fichaColors.textHeader}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto de las cabeceras</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-aspectos" value="${state.fichaColors.textAspectos}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto de "Aspectos del jugador"</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-subheader" value="${state.fichaColors.textSubheaderWhite}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto de las cabeceras blancas del plan</span>
          </label>
        </div>
        <div class="flex gap-8">
          <button class="btn" id="ficha-colors-reset">Restaurar valores por defecto</button>
          <button class="btn btn-primary" id="ficha-colors-save-default">Guardar como predeterminado</button>
        </div>
        <p class="text-xs text-muted mt-16">
          "Restaurar" vuelve a lo último guardado como predeterminado (o a los de fábrica si nunca has guardado uno).
        </p>
      </div>
    </div>
    `}

    ${configSubTab !== 'ficha-matriz' ? '' : `
    <div class="card">
      <div class="card-title">Matriz de la ficha 2</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Elige qué bloque va en cada hueco de la matriz 2×2. Tamaños y contenido de cada bloque no cambian, solo dónde cae cada uno.
        </p>
        <div class="grid-2" style="max-width:520px;gap:16px;">
          ${['tl', 'tr', 'bl', 'br'].map(pos => `
            <div class="field-group">
              <label class="label">${{ tl: 'Arriba izquierda', tr: 'Arriba derecha', bl: 'Abajo izquierda', br: 'Abajo derecha' }[pos]}</label>
              <select class="select" data-matrix-pos="${pos}">
                ${['mental', 'tecnico', 'condicional', 'tactico'].map(key => `
                  <option value="${key}" ${state.fichaGridOrder[pos] === key ? 'selected' : ''}>${{ mental: 'Mental', tecnico: 'Técnico', condicional: 'Condicional', tactico: 'Táctico' }[key]}</option>
                `).join('')}
              </select>
            </div>
          `).join('')}
        </div>
        <p class="text-xs text-muted mt-16" id="matriz-error" style="display:none;color:var(--score-red,#ef4444);">
          Los 4 huecos deben tener bloques distintos — no se ha guardado.
        </p>
        <button class="btn mt-16" id="matriz-reset">Restaurar orden de fábrica</button>
      </div>
    </div>
    `}

    ${configSubTab !== 'dimensiones' ? '' : `
    <div class="card">
      <div class="card-title">Dimensiones oficiales — Ficha 2</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Referencia fija (no editable): son los valores reales de <code>css/ficha.css</code> y <code>js/ficha-detalle.js</code>.
          Lienzo de diseño: ${FICHA2_OFFICIAL_DIMENSIONS.designWidth} × ${FICHA2_OFFICIAL_DIMENSIONS.designHeight}px.
          La Ficha 1 usa un lienzo de 4700px de ancho — sus valores se aplican escalados ×0.6528 (4700/7200) para que se vean del mismo tamaño en pantalla.
        </p>
        <div style="max-width:520px;">
          ${FICHA2_OFFICIAL_DIMENSIONS.groups.map(g => `
            <div class="mb-8">
              <div class="text-xs mb-8" style="font-weight:700;">${safeText(g.title)}</div>
              <table class="table table-compact">
                <tbody>
                  ${g.rows.map(([label, value]) => `
                    <tr><td>${safeText(label)}</td><td style="text-align:right;font-weight:600;white-space:nowrap;">${safeText(value)}</td></tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        </div>
        <p class="text-xs text-muted mt-16">
          ⚠ Ficha 1 ya aplica estos valores escalados en <code>css/ficha1.css</code> (título/subheader/listas/círculo). Lo que no tiene equivalente en Ficha 1 (radar, GPS, plan de acción) no aplica.
        </p>
      </div>
    </div>
    `}

    ${configSubTab !== 'fichas-individual' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas tipo — Individual</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Vista previa de la Ficha 1 y Ficha 2 de cada posición, generadas desde Aspectos.</p>
        ${state.positions.length === 0 ? '<p class="text-xs text-muted">Define primero al menos una posición en la pestaña Posiciones.</p>' : `
          <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
            ${state.positions.map(p => `<button class="btn ${p.key === fichaTipoPosition ? 'btn-primary' : 'btn-sm'}" data-ficha-tipo-pos="${p.key}">${safeText(p.label)}</button>`).join('')}
          </div>
          <div id="fichas-tipo-wrap"></div>
        `}
      </div>
    </div>
    `}

    ${configSubTab !== 'columnas-encuesta' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Columnas de la encuesta (1-51)</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Por posición: cómo se llama cada columna (cabecera en la BBDD) y a qué va (Fecha, Evaluador, Jugador, un perfil, una competencia o nada). Todo editable; la plantilla es solo el punto de partida. Se usa en el import (mapeo precargado) y en la tabla de BBDD. Después, Fichas Espejo decide cómo se calcula (media, etc.).</p>
        <div id="columnas-encuesta-wrap"></div>
      </div>
    </div>
    `}

    ${configSubTab !== 'fichas-espejo' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas Espejo — origen y cálculo de cada número</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Cada ítem de la Ficha 1 y 2 tiene un número. Pulsa Configurar para definir de dónde sale su dato y qué operación se hace. Aún NO está conectado a las fichas reales.</p>
        <div id="fichas-espejo-wrap"></div>
      </div>
    </div>
    `}

    ${configSubTab !== 'fichas-campograma' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas tipo — Campograma</div>
      <div class="card-body"><p class="text-xs text-muted">Pendiente de implementar.</p></div>
    </div>
    `}

    ${configSubTab !== 'fichas-mapa-nivel' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas tipo — Mapa de nivel</div>
      <div class="card-body"><p class="text-xs text-muted">Pendiente de implementar.</p></div>
    </div>
    `}

    ${configSubTab !== 'flujo' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Flujo de evaluaciones</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Documentación interna — no aparece en las fichas de los jugadores. Se guarda igual que el resto de Configuración.
        </p>
        <textarea class="input" id="flujo-evaluaciones-text" rows="24" style="width:100%;font-family:var(--font-mono, monospace);font-size:13px;resize:vertical;">${safeText(state.flujoEvaluaciones)}</textarea>
      </div>
    </div>
    `}

    ${configSubTab !== 'copia-seguridad' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Copia de seguridad</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Descarga un archivo JSON con jugadores (con su histórico), plantillas, evaluaciones, registros y configuración. Solo lee: no modifica nada en Firebase. Contiene datos y fotos de menores: guárdalo fuera de GitHub y no lo envíes por correo.</p>
        <button class="btn btn-primary" id="copia-seg-btn">⬇ Copia de seguridad (JSON)</button>
        <span class="text-xs text-muted" id="copia-seg-estado" style="margin-left:12px;"></span>
      </div>
    </div>`}

    ${configSubTab !== 'frases' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Frases modelo</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Banco de frases para "Descripción del jugador". En la ficha, el técnico marca las que aplican (botón "+ Frases" junto a la descripción) y se juntan en el texto — editable después. Sin IA: solo unen el texto tal cual.
        </p>
        <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          ${state.frasesModelo.map((f, i) => `
            <span class="chip">${safeText(f)}<button data-del-frase data-idx="${i}" title="Quitar">×</button></span>
          `).join('') || '<span class="text-xs text-muted">Sin frases definidas.</span>'}
        </div>
        <div class="flex gap-8" style="align-items:flex-start;">
          <textarea class="input" id="frase-new" rows="2" style="min-height:56px;resize:vertical;flex:1;" placeholder="Nueva frase… (o pega varias, una por línea)"></textarea>
          <button class="btn btn-sm" id="frase-add-btn">+ Añadir</button>
        </div>
      </div>
    </div>
    `}
  `;

  container.querySelector('#copia-seg-btn')?.addEventListener('click', async e => {
    const btn = e.currentTarget, est = container.querySelector('#copia-seg-estado');
    if (isFirebaseUnconfigured()) { showError('Firebase sin configurar.'); return; }
    btn.disabled = true;
    try {
      const copia = { version: 1, creada: new Date().toISOString(), colecciones: {} };
      for (const nombre of ['jugadores', 'plantillas', 'evaluaciones', 'registros']) {
        est.textContent = `Leyendo ${nombre}…`;
        copia.colecciones[nombre] = await readCollection(nombre);
      }
      est.textContent = 'Leyendo configuración…';
      copia.config = await readDocument('config', 'general');
      let i = 0;
      for (const j of copia.colecciones.jugadores) {
        est.textContent = `Leyendo histórico ${++i}/${copia.colecciones.jugadores.length}…`;
        try { j._historico = await readSubCollection('jugadores', j.id, 'historico'); } catch { j._historico = []; }
      }
      const blob = new Blob([JSON.stringify(copia)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `rm-perfiles-copia-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      est.textContent = `Listo: ${copia.colecciones.jugadores.length} jugadores, ${copia.colecciones.plantillas.length} plantillas, ${copia.colecciones.evaluaciones.length} evaluaciones, ${copia.colecciones.registros.length} registros.`;
    } catch (err) {
      console.error('[Copia]', err); est.textContent = ''; showError('No se pudo crear la copia: ' + (err?.message || err));
    } finally { btn.disabled = false; }
  });
  container.querySelectorAll('[data-config-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = CONFIG_GROUPS.find(x => x.label === btn.dataset.configGroup); if (!g) return;
      configSubTab = g.tabs[0].key;
      localStorage.setItem('rm-config-subtab', configSubTab);
      renderPanelConfig(container);
    });
  });
  container.querySelectorAll('[data-config-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      configSubTab = btn.dataset.configSubtab;
      localStorage.setItem('rm-config-subtab', configSubTab);
      renderPanelConfig(container);
    });
  });

  const flujoTextarea = container.querySelector('#flujo-evaluaciones-text');
  if (flujoTextarea) {
    flujoTextarea.addEventListener('change', () => {
      setState({ flujoEvaluaciones: flujoTextarea.value });
    });
  }

  const fraseAddBtn = container.querySelector('#frase-add-btn');
  if (fraseAddBtn) {
    fraseAddBtn.addEventListener('click', () => {
      const input = container.querySelector('#frase-new');
      const rawLines = input.value.split('\n').map(l => l.trim()).filter(Boolean);
      if (!rawLines.length) { showError('Escribe al menos una frase.'); return; }
      const existingLower = state.frasesModelo.map(f => f.toLowerCase());
      const toAdd = rawLines.filter(l => !existingLower.includes(l.toLowerCase()));
      if (!toAdd.length) { showError('Esa frase ya existe.'); return; }
      setState({ frasesModelo: [...state.frasesModelo, ...toAdd] });
      renderPanelConfig(container);
    });
  }
  container.querySelectorAll('[data-del-frase]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      setState({ frasesModelo: state.frasesModelo.filter((_, i) => i !== idx) });
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-ficha-tipo-pos]').forEach(btn => {
    btn.addEventListener('click', () => {
      fichaTipoPosition = btn.dataset.fichaTipoPos;
      fichasSubPage = 1; // cada posición se abre siempre en Ficha 1, no arrastra el "Individual 2" de la anterior
      preservandoScroll(() => renderPanelConfig(container));
    });
  });

  const fichasTipoWrap = container.querySelector('#fichas-tipo-wrap');
  if (fichasTipoWrap) renderPanelFichas(fichasTipoWrap, fichaTipoPosition);

  const columnasEncuestaWrap = container.querySelector('#columnas-encuesta-wrap');
  if (columnasEncuestaWrap) renderColumnasEncuesta(columnasEncuestaWrap);

  const fichasEspejoWrap = container.querySelector('#fichas-espejo-wrap');
  if (fichasEspejoWrap) renderFichasEspejo(fichasEspejoWrap);

  container.querySelectorAll('[data-crit-copy-btn]').forEach(copyBtn => {
    copyBtn.addEventListener('click', () => {
      const from = copyBtn.parentElement.querySelector('[data-crit-copy-from]')?.value;
      if (!from) { showError('Elige de qué posición copiar.'); return; }
      const source = state.criteriaSchemas[from] || {};
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: {
            ...(state.criteriaSchemas[configCriteriaPosition] || {}),
            tactico: [...(source.tactico || [])],
            competenciasOfensivas: [...(source.competenciasOfensivas || [])],
            competenciasDefensivas: [...(source.competenciasDefensivas || [])],
          },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
      showSuccess('Items copiados. Revísalos antes de dar por bueno el perfil.');
    });
  });

  container.querySelectorAll('[data-band-color]').forEach(input => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.bandColor);
      const bands = [...bandsSorted];
      bands[i] = { ...bands[i], color: input.value };
      setState({ scoreBands: bands });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
      showSuccess('Color actualizado.');
    });
  });

  container.querySelectorAll('[data-band-simbolo]').forEach(sel => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.bandSimbolo);
      const bands = [...bandsSorted];
      bands[i] = { ...bands[i], simbolo: sel.value };
      setState({ scoreBands: bands });
      showSuccess('Símbolo actualizado.');
    });
  });

  container.querySelectorAll('[data-band-min]').forEach(input => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.bandMin);
      const min = parseFloat(input.value);
      if (Number.isNaN(min)) { showError('Umbral no válido.'); return; }
      const bands = [...bandsSorted];
      bands[i] = { ...bands[i], min };
      setState({ scoreBands: bands });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
      renderPanelConfig(container); // reordena si el cambio lo requiere
      showSuccess('Umbral actualizado.');
    });
  });

  container.querySelectorAll('[data-band-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (bandsSorted.length <= 1) return;
      const i = Number(btn.dataset.bandDel);
      const bands = bandsSorted.filter((_, idx) => idx !== i);
      setState({ scoreBands: bands });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
      renderPanelConfig(container);
      showSuccess('Banda eliminada.');
    });
  });

  container.querySelector('#band-add')?.addEventListener('click', () => {
    // Nueva banda entre la más baja actual y 0, con un color por defecto neutro.
    const lowestMin = bandsSorted[bandsSorted.length - 1]?.min ?? 1;
    const newMin = Math.max(0, lowestMin - 1);
    const bands = [...bandsSorted, { color: '#94a3b8', min: newMin }];
    setState({ scoreBands: bands });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    renderPanelConfig(container);
  });

  // Datos condicionales: guarda al salir del campo (change), sin re-renderizar
  // la tabla entera (perdería el foco/scroll en cada tecla).
  container.querySelectorAll('[data-condicional-ref]').forEach(input => {
    input.addEventListener('change', () => {
      const pos = input.dataset.pos;
      const item = input.dataset.item;
      const col = input.dataset.col;
      const raw = input.value.trim();
      const num = raw === '' ? null : parseFloat(raw.replace(',', '.'));
      const value = (num === null || Number.isNaN(num)) ? null : num;
      const posRefs = state.condicionalRefs[pos] || {};
      const itemRefs = posRefs[item] || {};
      setState({
        condicionalRefs: {
          ...state.condicionalRefs,
          [pos]: { ...posRefs, [item]: { ...itemRefs, [col]: value } },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
    });
  });

  container.querySelector('#condicional-tolerance')?.addEventListener('change', e => {
    const raw = e.target.value.trim().replace(',', '.');
    const num = parseFloat(raw);
    const value = (raw === '' || Number.isNaN(num) || num < 0) ? state.condicionalTolerance : num;
    e.target.value = value;
    setState({ condicionalTolerance: value });
    document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
  });

  container.querySelector('#ficha-color-slate')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, slate: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-wine')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, wine: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-general')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textGeneral: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-header')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textHeader: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-aspectos')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textAspectos: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-subheader')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textSubheaderWhite: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-colors-reset')?.addEventListener('click', () => {
    setState({ fichaColors: { ...(state.fichaColorsDefault || DEFAULT_FICHA_COLORS) } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    renderPanelConfig(container);
    showSuccess('Colores restaurados al predeterminado.');
  });
  container.querySelector('#ficha-colors-save-default')?.addEventListener('click', () => {
    setState({ fichaColorsDefault: { ...state.fichaColors } });
    showSuccess('Guardado como predeterminado. "Restaurar" volverá aquí a partir de ahora.');
  });

  container.querySelectorAll('[data-matrix-pos]').forEach(sel => {
    sel.addEventListener('change', () => {
      const order = { ...state.fichaGridOrder };
      container.querySelectorAll('[data-matrix-pos]').forEach(s => {
        order[s.dataset.matrixPos] = s.value;
      });
      const values = Object.values(order);
      const hasDuplicates = new Set(values).size !== values.length;
      const errorMsg = container.querySelector('#matriz-error');
      if (hasDuplicates) {
        if (errorMsg) errorMsg.style.display = '';
        return;
      }
      if (errorMsg) errorMsg.style.display = 'none';
      setState({ fichaGridOrder: order });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    });
  });
  container.querySelector('#matriz-reset')?.addEventListener('click', () => {
    setState({ fichaGridOrder: { tl: 'mental', tr: 'tecnico', bl: 'condicional', br: 'tactico' } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    renderPanelConfig(container);
    showSuccess('Matriz restaurada al orden de fábrica.');
  });

  container.querySelector('#pos-add')?.addEventListener('click', () => {
    const input = container.querySelector('#pos-new');
    const label = input.value.trim();
    if (!label) { showError('Escribe el nombre de la posición.'); return; }

    const key = label.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (state.positions.some(p => p.key === key)) {
      showError('Esa posición ya existe.');
      return;
    }
    setState({ positions: [...state.positions, { key, label }] });
    renderPanelConfig(container);
    showSuccess('Posición añadida.');
  });

  container.querySelectorAll('[data-del-pos]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.delPos;
      const inUse = state.players.some(p => p.positions.includes(key));
      if (inUse) {
        showError('No se puede quitar: hay jugadores con esa posición asignada.');
        return;
      }
      setState({ positions: state.positions.filter(p => p.key !== key) });
      renderPanelConfig(container);
    });
  });

  container.querySelector('[data-seed-tecnico]')?.addEventListener('click', () => {
    const schema = state.criteriaSchemas[configCriteriaPosition] || {};
    setState({
      criteriaSchemas: {
        ...state.criteriaSchemas,
        [configCriteriaPosition]: { ...schema, tecnico: [...(state.aspectosComunes.tecnico || [])] },
      },
    });
    document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
    renderPanelConfig(container);
    showSuccess('Lista copiada — ya puedes editarla para esta posición.');
  });

  container.querySelectorAll('[data-crit-position]').forEach(critSelect => {
    critSelect.addEventListener('change', () => {
      configCriteriaPosition = critSelect.value;
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-items-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      itemsConfigPage = Number(btn.dataset.itemsPage);
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-crit-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const isComun = btn.dataset.scope === 'comun';
      const input = container.querySelector(`[data-crit-new][data-cat="${cat}"]${isComun ? '[data-scope="comun"]' : ''}`);
      // Admite pegar/escribir varias líneas: una por item. Se descartan vacías
      // y duplicados (contra lo ya existente y entre sí, sin distinguir mayúsculas).
      const rawLines = input.value.split('\n').map(l => l.trim()).filter(Boolean);
      if (!rawLines.length) { showError('Escribe el nombre del item (uno por línea si son varios).'); return; }
      const existingItems = isComun
        ? (state.aspectosComunes[cat] || [])
        : ((state.criteriaSchemas[configCriteriaPosition] || {})[cat] || []);
      const existingLower = existingItems.map(l => l.toLowerCase());
      const toAdd = [];
      const skipped = [];
      rawLines.forEach(line => {
        const lower = line.toLowerCase();
        if (existingLower.includes(lower) || toAdd.some(a => a.toLowerCase() === lower)) {
          skipped.push(line);
        } else {
          toAdd.push(line);
        }
      });
      if (!toAdd.length) { showError('Ese item ya existe en este bloque.'); return; }
      if (isComun) {
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: [...existingItems, ...toAdd] } });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: [...existingItems, ...toAdd] } } });
      }
      if (skipped.length) showSuccess(`${toAdd.length} añadido(s). ${skipped.length} ya existían y se han ignorado.`);
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-del-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.scope === 'comun') {
        const items = (state.aspectosComunes[cat] || []).filter((_, i) => i !== idx);
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: items } });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        const items = (schema[cat] || []).filter((_, i) => i !== idx);
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: items } } });
      }
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-move-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      const dir = Number(btn.dataset.dir); // -1 sube, +1 baja
      const isComun = btn.dataset.scope === 'comun';
      const items = [...((isComun ? state.aspectosComunes[cat] : state.criteriaSchemas[configCriteriaPosition]?.[cat]) || [])];
      const target = idx + dir;
      if (target < 0 || target >= items.length) return;
      [items[idx], items[target]] = [items[target], items[idx]];
      if (isComun) {
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: items } });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: items } } });
      }
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-toggle-comp]').forEach(box => {
    box.addEventListener('change', () => {
      const role = box.dataset.role; // 'of' | 'def'
      const key = role === 'of' ? 'competenciasOfensivas' : 'competenciasDefensivas';
      const label = box.dataset.label;
      const schema = state.criteriaSchemas[configCriteriaPosition] || {};
      const current = schema[key] || [];
      const next = box.checked ? [...current, label] : current.filter(l => l !== label);
      setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [key]: next } } });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
    });
  });

  container.querySelectorAll('[data-toggle-perfil-comp]').forEach(box => {
    box.addEventListener('change', () => {
      const perfil = box.dataset.perfil;
      const label = box.dataset.label;
      const schema = state.criteriaSchemas[configCriteriaPosition] || {};
      const perfilCompetencias = schema.perfilCompetencias || {};
      const current = perfilCompetencias[perfil] || [];
      const next = box.checked ? [...current, label] : current.filter(l => l !== label);
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: { ...schema, perfilCompetencias: { ...perfilCompetencias, [perfil]: next } },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
    });
  });

  container.querySelector('#season-add')?.addEventListener('click', () => {
    const input = container.querySelector('#season-new');
    const season = input.value.trim();
    if (!season) { showError('Escribe el nombre de la temporada.'); return; }
    if (state.seasons.includes(season)) { showError('Esa temporada ya existe.'); return; }

    setState({ seasons: [...state.seasons, season] });
    renderHeader();
    renderPanelConfig(container);
    showSuccess('Temporada creada.');
  });

  container.querySelectorAll('[data-del-season]').forEach(btn => {
    btn.addEventListener('click', () => {
      const season = btn.dataset.delSeason;
      if (season === state.season) {
        showError('No se puede quitar la temporada activa — cámbiala primero en el header.');
        return;
      }
      setState({ seasons: state.seasons.filter(s => s !== season) });
      renderPanelConfig(container);
    });
  });
}

// ── PLANTILLAS: equipos por temporada (colección 'plantillas') ─────────────
// Un doc por temporada+equipo: { temporada, teamKey, jugadorIds: [] }.
// Un jugador puede estar en varios equipos y cambia de equipo cada temporada.
let plantillasCache = null;      // null = sin cargar; array de docs
let plantillasLoading = null;
let plantillaTemporada = '';

const plantillaDocId = (temporada, teamKey) => `${String(temporada).replace(/\//g, '-')}__${teamKey}`;
const TEAMS_ORDEN_PLANTILLA = [...TEAMS]; // de Castilla hacia abajo (Castilla, RMC, Juveniles… Alevín A)
const plAbiertos = new Set(); // equipos desplegados en la pestaña Plantillas
// Abreviatura de cada posición (columnas de la vista de plantillas). Se deduce del nombre definido en Configuración.
const posAbrev = label => {
  const n = String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const mapa = [['portero', 'PO'], ['lateral', 'LAT'], ['central', 'CT'], ['mediocentro', 'MC'], ['interior', 'INT'], ['extremo', 'EXT'], ['delantero', 'DC']];
  return mapa.find(([k]) => n.startsWith(k))?.[1] || String(label || '?').slice(0, 3).toUpperCase();
};
const esPortero = pos => /portero/i.test(String(pos?.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

async function ensurePlantillas() {
  if (plantillasCache) return plantillasCache;
  if (isFirebaseUnconfigured()) { plantillasCache = []; return plantillasCache; }
  if (!plantillasLoading) {
    plantillasLoading = readCollection('plantillas')
      .then(r => { plantillasCache = r; })
      .catch(err => { console.error('[Firestore] Plantillas:', err); showError('No se pudieron cargar las plantillas (revisa las reglas de Firestore para "plantillas").'); plantillasCache = []; })
      .finally(() => { plantillasLoading = null; });
  }
  await plantillasLoading;
  return plantillasCache;
}

// Equipos del jugador en una temporada. Si esa temporada aún no tiene plantillas
// creadas, se usa el equipo actual del jugador (compatibilidad con lo anterior).
function equiposDeJugador(jugador, temporada) {
  const docs = (plantillasCache || []).filter(d => d.temporada === temporada && d.teamKey !== '_portada');
  if (!docs.length) return jugador?.teamKey ? [jugador.teamKey] : [];
  return docs.filter(d => (d.jugadorIds || []).includes(jugador.id)).map(d => d.teamKey);
}

let plVista = { modo: 'grid', teamKey: null };
let plIrJugador = null; // jugador al que saltar al abrir la presentación (clic en su nombre)
let plRefModo = 'team';   // comparación de las medias en la Presentación: 'team' (precargado) | 'teampos' | 'none'  // 'grid' | 'datos' | 'pres'

const nombreCompleto = j => `${j.apellidos || ''}, ${j.nombre || ''}`.replace(/^, |, $/g, '').trim();
const ordenJugadores = (a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, 'es');

// Guarda (fusiona) campos en el doc de la plantilla temporada+equipo sin perder los demás (jugadorIds, fotos…).
async function guardarPlantilla(temporada, teamKey, patch) {
  await ensurePlantillas();
  const id = plantillaDocId(temporada, teamKey);
  const prev = plantillasCache.find(d => d.id === id);
  if (prev) {
    // Solo se escriben los campos que cambian: no se pisa lo que otra persona haya guardado en el resto del documento.
    const data = { ...patch, temporada, teamKey };
    try {
      await updateDocument('plantillas', id, data);
      plantillasCache = plantillasCache.map(d => d.id === id ? { ...d, ...data } : d);
      return;
    } catch (err) {
      if (err?.code !== 'not-found') throw err; // si alguien lo borró, se vuelve a crear abajo
    }
  }
  const { id: _id, updatedAt: _u, ...rest } = prev || {};
  const data = { jugadorIds: [], ...rest, ...patch, temporada, teamKey };
  await saveDocument('plantillas', id, data);
  plantillasCache = [...plantillasCache.filter(d => d.id !== id), { id, ...data }];
}

// Guarda UNA entrada de un campo-mapa (textos, observaciones) sin reescribir el mapa entero: dos personas
// editando observaciones distintas ya no se pisan. valor null/'' = borrar esa entrada.
async function guardarPlantillaEntrada(temporada, teamKey, campo, clave, valor) {
  await ensurePlantillas();
  const id = plantillaDocId(temporada, teamKey);
  if (!plantillasCache.some(d => d.id === id)) await guardarPlantilla(temporada, teamKey, {});
  const v = valor ? valor : null;
  await updateMapEntry('plantillas', id, campo, clave, v);
  plantillasCache = plantillasCache.map(d => {
    if (d.id !== id) return d;
    const m = { ...(d[campo] || {}) }; if (v === null) delete m[clave]; else m[clave] = v;
    return { ...d, [campo]: m };
  });
}

// Añade un jugador a la plantilla (temporada+equipo). No quita de otras: puede estar en varias.
async function añadirAPlantilla(jugadorId, teamKey, temporada) {
  if (!jugadorId || !teamKey || !temporada || isFirebaseUnconfigured()) return;
  await ensurePlantillas();
  const ids = plantillasCache.find(d => d.id === plantillaDocId(temporada, teamKey))?.jugadorIds || [];
  if (ids.includes(jugadorId)) return;
  await guardarPlantilla(temporada, teamKey, { jugadorIds: [...ids, jugadorId] });
}

// Guarda un campo de la ficha de datos desde la plantilla (misma fuente que el formulario de Jugadores).
async function guardarCampoJugador(id, campo, valor) {
  const p = state.players.find(x => x.id === id);
  if (!p) return;
  const patch = { [campo]: valor };
  await updateDocument('jugadores', id, patch);
  const nuevo = { ...p, ...patch };
  setState({ players: state.players.map(x => x.id === id ? nuevo : x) });
  if (HISTORICO_FIELDS.includes(campo)) {
    const h = {}; HISTORICO_FIELDS.forEach(f => { h[f] = nuevo[f] ?? null; });
    await addSubDocument('jugadores', id, 'historico', h);
    delete jugadorHistoricoCache[id];
  }
}

// "Apellidos, Nombre" (con coma) o "Nombre Apellidos" (1ª palabra = nombre, resto = apellidos).
function parsearLineaJugador(linea) {
  const t = linea.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.includes(',')) { const [ap, ...no] = t.split(','); return { apellidos: ap.trim(), nombre: no.join(' ').trim() }; }
  const w = t.split(' ');
  return { nombre: w[0], apellidos: w.slice(1).join(' ') };
}

async function crearPlantillaDesdeLista(texto, teamKey, temporada) {
  await ensurePlantillas();
  const res = { creados: [], existentes: [], dudosos: [] };
  for (const linea of texto.split(/\r?\n/)) {
    const pj = parsearLineaJugador(linea);
    if (!pj || !pj.nombre) continue;
    const m = matchJugador(`${pj.nombre} ${pj.apellidos}`, state.players, { teamKey });
    if (m.status === 'auto') { await añadirAPlantilla(m.playerId, teamKey, temporada); res.existentes.push(linea.trim()); continue; }
    if (m.status === 'dudoso') { res.dudosos.push(`${linea.trim()} ≈ ${m.candidates.map(nombreCompleto).join(' / ')}`); continue; }
    const data = { nombre: pj.nombre, apellidos: pj.apellidos, birthDate: null, foot: '', maturationalAge: '', teamKey, positionKey: null, weight: null, height: null, complexion: null };
    const id = await addDocument('jugadores', data);
    setState({ players: [...state.players, { id, ...data }] });
    await addSubDocument('jugadores', id, 'historico', { teamKey, positionKey: null, weight: null, height: null, complexion: null });
    await añadirAPlantilla(id, teamKey, temporada);
    res.creados.push(linea.trim());
  }
  return res;
}

function renderPanelPlantillas(container) {
  if (!plantillasCache) {
    container.innerHTML = `${firebaseNotice()}<p class="text-xs text-muted">Cargando plantillas…</p>`;
    ensurePlantillas().then(() => { if (container.isConnected) renderPanelPlantillas(container); });
    return;
  }
  if (!plantillaTemporada || !state.seasons.includes(plantillaTemporada)) plantillaTemporada = state.season || state.seasons[0] || '';
  if (plVista.modo === 'datos') return renderPlantillaDatos(container);
  if (plVista.modo === 'pres') return renderPlantillaPresentacion(container);
  const docDe = teamKey => plantillasCache.find(d => d.id === plantillaDocId(plantillaTemporada, teamKey));
  const nombreDe = id => { const j = state.players.find(x => x.id === id); return j ? nombreCompleto(j) : '(jugador eliminado)'; };
  const todos = [...state.players].sort(ordenJugadores);

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="rm-sticky flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;padding:8px 0;">
      <label class="text-xs text-muted" for="pl-temporada">Temporada</label>
      <select class="select" id="pl-temporada" style="max-width:200px;">${state.seasons.map(t => `<option value="${safeText(t)}" ${t === plantillaTemporada ? 'selected' : ''}>${safeText(t)}</option>`).join('')}</select>
      <label class="btn btn-sm" style="cursor:pointer;" title="Una sola vez para todos los equipos de esta temporada. En cada equipo puedes cambiarla.">📷 Foto de portada (todos los equipos)<input type="file" accept="image/*" id="pl-foto-global" hidden /></label>
      <span class="text-xs text-muted">Un jugador puede estar en varios equipos. Los jugadores nuevos con equipo se añaden aquí solos (temporada activa).</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${TEAMS_ORDEN_PLANTILLA.map(t => {
        const ids = docDe(t.key)?.jugadorIds || [];
        const libres = todos.filter(j => !ids.includes(j.id));
        const colDe = id => { const pk = state.players.find(x => x.id === id)?.positionKey; return state.positions.some(p => p.key === pk) ? pk : '_sin'; };
        const porteros = ids.filter(id => esPortero(state.positions.find(p => p.key === colDe(id)))).length;
        const campo = ids.length - porteros;
        const columnas = [...state.positions.map(p => ({ key: p.key, abrev: posAbrev(p.label), titulo: p.label })), ...(ids.some(id => colDe(id) === '_sin') ? [{ key: '_sin', abrev: '—', titulo: 'Sin posición' }] : [])];
        const jug = id => `<div class="flex" style="justify-content:space-between;align-items:center;gap:2px;"><a href="#" data-pl-ir="${t.key}|${id}" class="text-xs" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);text-decoration:none;font-weight:600;" title="Ver ficha de ${safeText(nombreDe(id))}">${safeText(nombreDe(id))}</a><button class="btn btn-sm btn-ghost" style="padding:0 4px;" data-pl-del="${t.key}|${id}" title="Quitar de la plantilla">✕</button></div>`;
        return `<div class="card" data-pl-det="${t.key}"><div class="card-body">
          <div style="display:flex;gap:14px;align-items:stretch;flex-wrap:wrap;">
            <div style="width:190px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;">
              <div><b>${safeText(t.label)}</b><div class="text-xs text-muted" title="Jugadores de campo + porteros">${campo}+${porteros} <span style="opacity:.7;">campo+porteros</span></div></div>
              <div class="flex gap-8" style="flex-wrap:wrap;">
                <button class="btn btn-sm" data-pl-datos="${t.key}" ${ids.length ? '' : 'disabled'}>Datos</button>
                <button class="btn btn-sm btn-primary" data-pl-pres="${t.key}" ${ids.length ? '' : 'disabled'}>Presentación de fichas</button>
                <button class="btn btn-sm" data-pl-lista-btn="${t.key}">+ Lista</button>
              </div>
            </div>
            <div style="flex:1;min-width:0;overflow-x:auto;"><div style="display:grid;grid-template-columns:repeat(${columnas.length},minmax(110px,1fr));min-height:90px;border:1px solid var(--border-default);border-radius:8px;">
              ${columnas.map((col, ci) => { const cj = ids.filter(id => colDe(id) === col.key); return `<div style="${ci ? 'border-left:1px solid var(--border-default);' : ''}padding:6px 8px;display:flex;flex-direction:column;gap:3px;min-width:0;">
                <div style="font-weight:800;font-size:12px;letter-spacing:.04em;border-bottom:1px solid var(--border-default);padding-bottom:4px;margin-bottom:2px;" title="${safeText(col.titulo)}">${col.abrev} <span class="text-xs text-muted" style="font-weight:600;">${cj.length || ''}</span></div>
                ${cj.map(jug).join('')}
              </div>`; }).join('')}
            </div></div>
          </div>
          <div data-pl-lista-box="${t.key}" style="display:none;margin-top:12px;">
            <textarea class="input" data-pl-lista="${t.key}" rows="6" style="width:100%;" placeholder="Un jugador por línea:&#10;Apellidos, Nombre&#10;o: Nombre Apellidos"></textarea>
            <button class="btn btn-sm btn-primary mt-8" data-pl-lista-ok="${t.key}">Crear plantilla</button>
          </div>
          <div class="flex gap-8" style="margin-top:12px;">
            <select class="select" data-pl-sel="${t.key}" style="flex:1;min-width:0;max-width:420px;"><option value="">Añadir jugador…</option>${libres.map(j => `<option value="${j.id}">${safeText(nombreCompleto(j))}</option>`).join('')}</select>
            <button class="btn btn-sm btn-primary" data-pl-add="${t.key}">Añadir</button>
          </div>
        </div></div>`;
      }).join('')}
    </div>`;
  container.querySelectorAll('details[data-pl-det]').forEach(d => {
    d.addEventListener('toggle', () => { d.open ? plAbiertos.add(d.dataset.plDet) : plAbiertos.delete(d.dataset.plDet); });
    d.querySelector('summary')?.addEventListener('click', e => { if (e.target.closest('button')) e.preventDefault(); });
  });

  const guardar = async (teamKey, jugadorIds) => {
    try {
      await guardarPlantilla(plantillaTemporada, teamKey, { jugadorIds });
      preservandoScroll(() => renderPanelPlantillas(container));
    } catch (err) {
      console.error('[Firestore] No se pudo guardar la plantilla:', err);
      showError('No se pudo guardar la plantilla (revisa las reglas de Firestore para "plantillas").');
    }
  };
  container.querySelector('#pl-temporada')?.addEventListener('change', e => { plantillaTemporada = e.target.value; renderPanelPlantillas(container); });
  container.querySelector('#pl-foto-global')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await guardarPlantilla(plantillaTemporada, '_portada', { fotoPortada: await fotoADataUrl(f) }); showSuccess('Foto de portada guardada para todos los equipos.'); }
    catch (err) { console.error(err); showError('No se pudo guardar la foto (¿demasiado grande?).'); }
  });
  container.querySelectorAll('[data-pl-add]').forEach(btn => btn.addEventListener('click', () => {
    const teamKey = btn.dataset.plAdd;
    const sel = container.querySelector(`[data-pl-sel="${teamKey}"]`);
    if (!sel?.value) return;
    guardar(teamKey, [...(docDe(teamKey)?.jugadorIds || []), sel.value]);
  }));
  container.querySelectorAll('[data-pl-del]').forEach(btn => btn.addEventListener('click', () => {
    const [teamKey, jid] = btn.dataset.plDel.split('|');
    guardar(teamKey, (docDe(teamKey)?.jugadorIds || []).filter(x => x !== jid));
  }));
  container.querySelectorAll('[data-pl-datos]').forEach(btn => btn.addEventListener('click', () => { plVista = { modo: 'datos', teamKey: btn.dataset.plDatos }; renderPanelPlantillas(container); }));
  container.querySelectorAll('[data-pl-ir]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); const id = el.dataset.plIr.split('|')[1];
    jugFichaId = id; jugadorFormId = null; jugFichaTab = 'datos'; jugFichaEvalId = null; jugVolverA = 'plantillas'; switchTab('jugadores');
  }));
  container.querySelectorAll('[data-pl-pres]').forEach(btn => btn.addEventListener('click', () => { plVista = { modo: 'pres', teamKey: btn.dataset.plPres }; renderPanelPlantillas(container); }));
  container.querySelectorAll('[data-pl-lista-btn]').forEach(btn => btn.addEventListener('click', () => {
    const box = container.querySelector(`[data-pl-lista-box="${btn.dataset.plListaBtn}"]`);
    box.style.display = box.style.display === 'none' ? '' : 'none';
    const det = box.closest('details'); if (det && box.style.display !== 'none') det.open = true;
  }));
  container.querySelectorAll('[data-pl-lista-ok]').forEach(btn => btn.addEventListener('click', async () => {
    const teamKey = btn.dataset.plListaOk;
    const texto = container.querySelector(`[data-pl-lista="${teamKey}"]`).value;
    if (!texto.trim()) return;
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para crear plantillas.'); return; }
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      const r = await crearPlantillaDesdeLista(texto, teamKey, plantillaTemporada);
      showSuccess(`Creados ${r.creados.length} · ya existían ${r.existentes.length}${r.dudosos.length ? ` · ${r.dudosos.length} dudosos sin crear` : ''}.`);
      if (r.dudosos.length) showError(`Dudosos (no creados, añádelos a mano si son ellos): ${r.dudosos.join(' | ')}`, 15000);
    } catch (err) {
      console.error('[Firestore] Crear plantilla:', err);
      showError('No se pudo crear la plantilla completa (revisa reglas de Firestore).');
    }
    renderPanelPlantillas(container);
  }));
}

// ── Plantilla · Datos: tabla editable de las fichas de datos (misma fuente que Jugadores) ──
function renderPlantillaDatos(container) {
  const t = TEAMS.find(x => x.key === plVista.teamKey);
  const ids = plantillasCache.find(d => d.id === plantillaDocId(plantillaTemporada, plVista.teamKey))?.jugadorIds || [];
  const jugs = ids.map(id => state.players.find(x => x.id === id)).filter(Boolean).sort(ordenJugadores);
  const inp = (j, campo, tipo = 'text', extra = '') => `<input class="input" type="${tipo}" ${extra} data-pl-campo="${campo}" data-pl-id="${j.id}" value="${safeText(j[campo] ?? '')}" style="min-width:${tipo === 'date' ? 130 : 80}px;" />`;
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
      <button class="btn btn-ghost" id="pl-volver">← Plantillas</button>
      <b>${safeText(t?.label || '')} · ${safeText(plantillaTemporada)}</b>
      <span class="text-xs text-muted">Los cambios se guardan al salir de la casilla y son los mismos de la ficha del jugador.</span>
    </div>
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Apellidos</th><th>Nombre</th><th>F. nacimiento</th><th>Lateralidad</th><th>Posición</th><th>Altura (m)</th><th>Peso (kg)</th><th>Complexión</th><th>Ed. madurativa</th><th></th></tr></thead>
      <tbody>${jugs.map(j => `<tr>
        <td>${inp(j, 'apellidos')}</td><td>${inp(j, 'nombre')}</td><td>${inp(j, 'birthDate', 'date')}</td>
        <td><select class="select" data-pl-campo="foot" data-pl-id="${j.id}">${['', 'Diestro', 'Zurdo', 'Ambidiestro'].map(v => `<option value="${v}" ${(j.foot || '') === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}</select></td>
        <td><select class="select" data-pl-campo="positionKey" data-pl-id="${j.id}"><option value="">—</option>${state.positions.map(p => `<option value="${p.key}" ${j.positionKey === p.key ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}</select></td>
        <td>${inp(j, 'height', 'number', 'step="0.01" min="0"')}</td><td>${inp(j, 'weight', 'number', 'step="0.1" min="0"')}</td>
        <td>${inp(j, 'complexion')}</td><td>${inp(j, 'maturationalAge')}</td>
        <td><button class="btn btn-sm" data-pl-ficha="${j.id}">Ficha</button></td></tr>`).join('')}</tbody>
    </table></div>`;
  container.querySelector('#pl-volver').addEventListener('click', () => { plVista = { modo: 'grid', teamKey: null }; renderPanelPlantillas(container); });
  container.querySelectorAll('[data-pl-campo]').forEach(el => el.addEventListener('change', async () => {
    const campo = el.dataset.plCampo;
    let v = el.value;
    if (campo === 'height' || campo === 'weight') v = v === '' ? null : parseFloat(v);
    else if (campo === 'birthDate') v = v || null;
    else if (campo === 'complexion') v = v.trim() || null;
    else if (typeof v === 'string' && campo !== 'foot' && campo !== 'positionKey') v = v.trim();
    if (campo === 'positionKey') v = v || null;
    if (campo === 'nombre' && !v) { showError('El nombre es obligatorio.'); renderPlantillaDatos(container); return; }
    try { await guardarCampoJugador(el.dataset.plId, campo, v); }
    catch (err) { console.error('[Firestore] Campo jugador:', err); showError('No se pudo guardar el cambio.'); }
  }));
  container.querySelectorAll('[data-pl-ficha]').forEach(btn => btn.addEventListener('click', () => {
    jugFichaId = btn.dataset.plFicha; jugadorFormId = null; jugFichaTab = 'fichas'; jugFichaEvalId = null;
    switchTab('jugadores');
  }));
}

// ── Plantilla · Presentación: Ficha 1 y 2 de todos los jugadores, seguidas ──
// Evaluación mostrada por jugador: la más reciente de la temporada de la plantilla (si no hay, la más reciente).
// Texto del pie de los PDF: fecha de la EVALUACIÓN (no la de impresión).
const fmtFechaEv = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
function pieEvaluacion(ev) {
  if (!ev) return '';
  const a = fmtFechaEv(ev.fechaInicio), b = fmtFechaEv(ev.fechaFin);
  const fechas = a && b && a !== b ? `${a} – ${b}` : (b || a);
  return `Evaluación: ${[ev.temporada, ev.nombre].filter(Boolean).join(' · ')}${fechas ? ' · ' + fechas : ''}`;
}
function prepararFichaJugador(p, regs, temporada) {
  const evInfo = eid => (regEvaluaciones || []).find(e => e.id === eid);
  const grupos = {};
  (regs || []).forEach(r => { const k = r.evaluacionId || 'sin-evaluacion'; (grupos[k] = grupos[k] || []).push(r); });
  let filasEval = Object.entries(grupos).map(([eid, rs]) => {
    const ev = evInfo(eid);
    const posKey = ev?.posicionKey || rs[0]?.posicionKey;
    const media = calcularMediasPorJugador(rs.map(r => ({ ...r, jugadorId: p.id })), buildAspectoPorCompetencia(state, posKey))[p.id];
    const idx = (regEvaluaciones || []).findIndex(e => e.id === eid);
    return { eid, ev, posKey, media, orden: `${ev?.fechaFin || ev?.fechaInicio || ''}|${String(idx).padStart(5, '0')}` };
  }).filter(f => f.eid !== 'sin-evaluacion' && f.ev);
  new Set([...Object.keys(p.condicionalPorEval || {}), ...Object.keys(p.condicionalMaxPorEval || {})]).forEach(eid => {
    const ev = evInfo(eid);
    if (!ev || filasEval.some(f => f.eid === eid)) return;
    const idx = (regEvaluaciones || []).findIndex(e => e.id === eid);
    filasEval.push({ eid, ev, posKey: ev.posicionKey || p.positionKey, media: null, orden: `${ev.fechaFin || ev.fechaInicio || ''}|${String(idx).padStart(5, '0')}` });
  });
  filasEval.sort((x, y) => String(y.orden).localeCompare(String(x.orden)));
  const evSel = filasEval.find(f => f.ev?.temporada === temporada) || filasEval[0] || null;
  const textosKey = evSel?.eid || 'sin-evaluacion';
  const regsEval = evSel ? (regs || []).filter(r => (r.evaluacionId || 'sin-evaluacion') === evSel.eid) : [];
  const filasTexto = k => regsEval.map(r => String(r.textos?.[k] || '').replace(/\s*\n+\s*/g, ' · ').trim()).filter(Boolean);
  const origenTxt = k => p.fichaTextos?.[textosKey]?.[k] ?? filasTexto(k);
  const cinco = arr => Array.from({ length: 5 }, (_, i) => arr[i] || '');
  const mediaRP = k => { const v = regsEval.map(r => r.rp?.[k]).filter(x => typeof x === 'number'); if (!v.length) return null; const m = v.reduce((x, y) => x + y, 0) / v.length; return String(Math.round(m * 10) / 10).replace('.', ','); };
  return {
    evSel, textosKey,
    fPos: evSel?.posKey || p.positionKey, fMedia: evSel?.media || null,
    aspectosTxt: {
      rp: { r: mediaRP('r'), p: mediaRP('p') },
      ofensivos: { potenciar: cinco(origenTxt('of_pot')), mejorar: cinco(origenTxt('of_mej')) },
      defensivos: { potenciar: cinco(origenTxt('def_pot')), mejorar: cinco(origenTxt('def_mej')) },
    },
  };
}

// Portadas y separadores (diapositivas 1920×1080 que se escalan a pantalla y se capturan a tamaño natural para el PDF).
// Diapositivas 1920×1337 (misma proporción que la Ficha 2: 7200×5014) que se escalan a pantalla y se
// capturan a tamaño natural para el PDF. Estilo único: títulos en negrita mayúsculas, subtítulos en peso medio.
const PL_W = 1920, PL_H = 1337;
function injectPlantillaStyles() {
  if (document.getElementById('pl-styles')) return;
  const st = document.createElement('style');
  st.id = 'pl-styles';
  st.textContent = `
    .pl-frame{position:relative;width:100%;aspect-ratio:${PL_W}/${PL_H};overflow:hidden;margin-bottom:16px;border-radius:6px;}
    .pl-slide{position:absolute;left:0;top:0;width:${PL_W}px;height:${PL_H}px;transform-origin:top left;overflow:hidden;font-family:'Segoe UI Black','Arial Black',system-ui,sans-serif;color:#fff;}
    .pl-slide .pl-crest{position:absolute;width:150px;height:150px;object-fit:contain;border-radius:28px;}
    .pl-t{font-weight:900;text-transform:uppercase;letter-spacing:-0.01em;line-height:1;margin:0;}
    .pl-t-xl{font-size:165px;font-style:italic;}
    .pl-t-l{font-size:96px;}
    .pl-t-m{font-size:66px;}
    .pl-sub{font-family:system-ui,'Segoe UI',sans-serif;font-weight:600;font-size:40px;opacity:0.8;}
    .pl-barra{position:sticky;top:calc(var(--header-h) + var(--tabs-h));z-index:80;background:var(--bg-app);padding:8px 0;margin-top:-4px;box-shadow:0 2px 6px rgba(0,0,0,0.12);}
    .pl-ed{white-space:pre-line;outline:none;cursor:text;}
    .pl-ed:hover{outline:2px dashed rgba(255,255,255,0.45);outline-offset:6px;}
    .pl-ed:focus{outline:2px solid #ffab40;outline-offset:6px;}
    #pl-pres-lista:fullscreen{background:#111;overflow-y:auto;padding:48px 0 8px;scroll-snap-type:y proximity;}
    .pl-obs{margin:0 auto 20px;}
    .pl-obs{display:flex;gap:8px;align-items:stretch;}
    .pl-obs textarea{flex:1;min-width:0;box-sizing:border-box;min-height:56px;resize:vertical;font:14px system-ui,sans-serif;padding:8px 10px;border-radius:8px;}
    .pl-obs-ctl{display:flex;flex-direction:column;justify-content:center;gap:6px;font:12px system-ui,sans-serif;white-space:nowrap;}
    .pl-obs-ctl button{cursor:pointer;border-radius:8px;padding:4px 8px;}
    #pl-pres-lista:fullscreen .pl-obs-ctl{color:#ddd;}
    #pl-pres-lista:fullscreen .pl-obs textarea{background:#1b1b1b;color:#eee;border:1px solid #444;}
    #pl-pres-lista.pl-solo .pl-obs{display:none;}
    #pl-pres-lista.pl-solo > .pl-cur + .pl-obs,#pl-pres-lista.pl-solo .pl-cur + .pl-obs{display:flex;}
    #pl-pres-lista:fullscreen > *{max-width:calc((100vh - 190px) * ${PL_W} / ${PL_H});margin-left:auto;margin-right:auto;}
    #pl-pres-lista.pl-solo > *{display:none;}
    #pl-pres-lista.pl-solo > .pl-host{display:block;}
    #pl-pres-lista.pl-solo .pl-frame:not(.pl-cur),#pl-pres-lista.pl-solo .ficha-wrap:not(.pl-cur){display:none;}
    #pl-pres-lista.pl-solo .pl-cur{display:block;}
    #pl-pres-lista.pl-solo .pl-foto-btn{display:none !important;}
    #pl-pres-lista.pl-sin-obs .pl-obs{display:none !important;}
    #pl-pres-lista.pl-sin-obs:fullscreen > *{max-width:calc((100vh - 120px) * ${PL_W} / ${PL_H});}
    #pl-solo-nav,#pl-solo-top{display:none;}
    #pl-pres-lista.pl-solo > #pl-solo-top{display:flex;position:fixed;top:0;left:0;right:0;z-index:10;gap:6px;justify-content:center;flex-wrap:wrap;padding:6px;background:rgba(0,0,0,0.75);}
    #pl-solo-top button{background:#fff;color:#111;border:0;border-radius:14px;padding:4px 14px;font:700 13px system-ui,sans-serif;cursor:pointer;}
    #pl-solo-top button:hover{background:#ffab40;}
    #pl-pres-lista.pl-solo > #pl-solo-nav{display:flex;position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:10;gap:12px;align-items:center;background:rgba(0,0,0,0.75);color:#fff;padding:6px 16px;border-radius:22px;font:600 15px system-ui,sans-serif;}
    #pl-solo-nav button{background:#fff;color:#111;border:0;border-radius:14px;padding:4px 14px;font-weight:700;cursor:pointer;}
    #pl-pres-lista:fullscreen .btn-print-ficha{color:#ddd;}
    .pl-nombre{font-weight:800;text-transform:uppercase;text-align:center;line-height:1.1;letter-spacing:-0.01em;}
  `;
  document.head.appendChild(st);
}
let plUid = 0;
// Textos editables de las diapositivas fijas (portadas y separadores). Se guardan en la plantilla: 'portada.*' en la general de la temporada, el resto por equipo.
let plTextos = {};
const plVerObs = () => { try { return localStorage.getItem('rm-pl-ver-obs') !== '0'; } catch { return true; } };
const plT = (key, def) => safeText(plTextos[key] ?? def);
const plEd = key => `data-pl-ed="${key}" contenteditable="true" spellcheck="false"`;
// Formas en SVG en línea (html2canvas no soporta clip-path de CSS, pero sí SVG).
function plPoligono(style, w, h, pts, fill) {
  return `<svg style="position:absolute;${style}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="${pts.map(([x, y]) => `${x * w / 100},${y * h / 100}`).join(' ')}" fill="${fill}"/></svg>`;
}
function plFotoPoligono(style, w, h, pts, foto, textoVacio) {
  const id = `plclip${++plUid}`;
  const poly = pts.map(([x, y]) => `${x * w / 100},${y * h / 100}`).join(' ');
  return `<svg style="position:absolute;${style}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><clipPath id="${id}"><polygon points="${poly}"/></clipPath></defs>
    ${foto ? `<image href="${foto}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
           : `<polygon points="${poly}" fill="rgba(255,255,255,0.08)"/><text x="${w / 2}" y="${h / 2}" fill="rgba(255,255,255,0.45)" font-size="44" text-anchor="middle" font-family="system-ui,sans-serif">${textoVacio}</text>`}
  </svg>`;
}
function plSlide(inner, bg, extraClass = '') {
  return `<div class="pl-frame ${extraClass}"><div class="pl-slide" style="background:${bg}">${inner}</div></div>`;
}
function plOro(style, w, h) {
  const id = `plg${++plUid}`;
  return `<svg style="position:absolute;${style}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5a623"/><stop offset="1" stop-color="#f5a623" stop-opacity="0"/></linearGradient></defs><polygon points="${w * 0.4},0 ${w},0 ${w * 0.6},${h} 0,${h}" fill="url(#${id})"/></svg>`;
}
const PL_ORO_SOLIDO = '#ffab40';
const plCrest = style => `<img class="pl-crest" src="${LOGO_PATH}" style="${style}" alt="" />`;

function plPortadaGeneral(c, foto) {
  return plSlide(`
    ${plCrest('left:40px;top:40px;')}
    <h1 class="pl-t pl-t-xl pl-ed" ${plEd('portada.titulo')} style="position:absolute;left:80px;top:230px;width:1100px;">${plT('portada.titulo', 'Evolución\nde los\njugadores')}</h1>
    ${plFotoPoligono('right:60px;top:230px;', 1000, 800, [[12, 0], [100, 0], [88, 100], [0, 100]], foto, 'Foto de portada')}
    ${plOro('right:60px;bottom:150px;', 230, 300)}
    ${plPoligono('left:0;bottom:0;', 900, 260, [[0, 0], [100, 0], [94, 100], [0, 100]], c.wine)}
    <div class="pl-t pl-t-m" style="position:absolute;left:60px;bottom:0;height:260px;display:flex;align-items:center;color:#111;font-style:italic;"><span class="pl-ed" ${plEd('portada.sub')}>${plT('portada.sub', 'Informes\nindividuales')}</span></div>`, c.slate);
}
function plPortadaEquipo(c, foto, equipo, temporada) {
  return plSlide(`
    ${plFotoPoligono('left:60px;top:60px;', 1050, 1217, [[0, 0], [100, 0], [92, 100], [0, 100]], foto, 'Foto del equipo')}
    ${plCrest('right:60px;top:50px;')}
    ${plOro('right:60px;bottom:60px;', 230, 340)}
    <div style="position:absolute;left:1120px;right:60px;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;text-align:center;">
      <div class="pl-t pl-t-m pl-ed" ${plEd('equipo.nombre')} style="white-space:nowrap;">${plT('equipo.nombre', equipo)}</div>
      <div class="pl-sub pl-ed" ${plEd('equipo.temporada')}>${plT('equipo.temporada', temporada)}</div>
    </div>`, c.slate);
}
function plPlural(label) {
  const t = String(label || '').trim();
  if (!t || /s$/i.test(t)) return t;
  return /[aeiouáéíóú]$/i.test(t) ? `${t}s` : `${t}es`;
}
// Quita el fondo blanco (conectado a los bordes) de una foto y devuelve PNG transparente. Cache por dataURL.
const _sinFondoCache = new Map();
function quitarFondoBlanco(src) {
  if (_sinFondoCache.has(src)) return _sinFondoCache.get(src);
  const pr = new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      try {
        const w = im.naturalWidth, h = im.naturalHeight;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
        const d = cx.getImageData(0, 0, w, h), p = d.data;
        // Si la foto ya trae transparencia (PNG sin fondo) no se toca: así nunca se come lo blanco de la camiseta.
        for (let i = 3; i < p.length; i += 4) if (p[i] < 250) { resolve(src); return; }
        const esB = i => p[i] >= 252 && p[i + 1] >= 252 && p[i + 2] >= 252 || p[i + 3] === 0;
        const vis = new Uint8Array(w * h), pila = [];
        const push = (x, y) => { const k = y * w + x; if (!vis[k] && esB(k * 4)) { vis[k] = 1; pila.push(k); } };
        for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
        for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
        while (pila.length) {
          const k = pila.pop(), x = k % w, y = (k - x) / w;
          if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
        }
        for (let k = 0; k < w * h; k++) if (vis[k]) p[k * 4 + 3] = 0;
        cx.putImageData(d, 0, 0);
        resolve(cv.toDataURL('image/png'));
      } catch (e) { resolve(src); }
    };
    im.onerror = () => resolve(src);
    im.src = src;
  });
  _sinFondoCache.set(src, pr);
  return pr;
}
async function aplicarSinFondo(root) {
  await Promise.all([...root.querySelectorAll('img[data-sin-fondo]')].map(async el => {
    el.src = await quitarFondoBlanco(el.getAttribute('src'));
    el.removeAttribute('data-sin-fondo');
  }));
}

function plSeparadorPosicion(c, titulo, jugadores) {
  const n = jugadores.length;
  const filas = n > 6 ? 2 : 1;
  const porFila = Math.ceil(n / filas);
  const slot = Math.min(300, Math.floor(1700 / porFila));
  const fotoH = Math.round(slot * (filas === 2 ? 1.0 : 1.15));
  const bloqueH = (fotoH + 130) * filas;
  const top0 = 330 + Math.max(0, (820 - bloqueH) / 2);
  const partes = j => [String(j.nombre || '').trim(), String(j.apellidos || '').trim()].filter(Boolean);
  const celdas = jugadores.map((j, i) => {
    const fila = Math.floor(i / porFila), col = i % porFila;
    const enFila = fila === filas - 1 ? n - porFila * (filas - 1) : porFila;
    const x0 = (PL_W - enFila * slot) / 2 + col * slot;
    const y0 = top0 + fila * (fotoH + 130);
    const D = Math.round(Math.min(slot * 0.84, fotoH)), R0 = D / 2, cid = `plsep${++plUid}`;
    // Igual que en las fichas: jugador dentro de un círculo blanco (SVG como imagen: el PDF lo pinta bien).
    const img = j.fotoUrl
      ? svgComoImg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}"><clipPath id="${cid}"><circle cx="${R0}" cy="${R0}" r="${R0}"/></clipPath><circle cx="${R0}" cy="${R0}" r="${R0}" fill="#ffffff"/><image xlink:href="${j.fotoUrl}" href="${j.fotoUrl}" x="0" y="0" width="${D}" height="${D}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${cid})"/></svg>`, D, D, `position:absolute;left:${(slot - D) / 2}px;top:${fotoH - D}px;`)
      : `<svg style="position:absolute;left:${slot * 0.08}px;top:0;" width="${slot * 0.84}" height="${fotoH}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet"><circle cx="50" cy="38" r="22" fill="rgba(255,255,255,0.15)"/><rect x="18" y="64" width="64" height="40" rx="20" fill="rgba(255,255,255,0.15)"/></svg>`;
    return `<div style="position:absolute;left:${x0}px;top:${y0}px;width:${slot}px;">
      <div style="position:relative;width:${slot}px;height:${fotoH}px;">${img}</div>
      <div class="pl-nombre" style="margin-top:14px;font-size:${filas === 2 ? 34 : 40}px;">${partes(j).map(safeText).join('<br>')}</div></div>`;
  }).join('');
  return plSlide(`
    ${plCrest('left:40px;top:40px;')}
    ${plOro('right:140px;top:60px;', 200, 330)}${plOro('right:60px;top:100px;', 200, 330)}
    <div class="pl-t pl-t-l" style="position:absolute;left:0;right:0;top:200px;text-align:center;"><span class="pl-ed" ${plEd('sep.' + titulo)}>${plT('sep.' + titulo, plPlural(titulo))}</span></div>
    ${celdas}
    ${plPoligono('left:0;bottom:0;', 520, 150, [[0, 0], [94, 0], [100, 100], [0, 100]], PL_ORO_SOLIDO)}
    ${plPoligono('right:0;bottom:0;', 640, 150, [[6, 0], [100, 0], [100, 100], [0, 100]], PL_ORO_SOLIDO)}`, c.slate);
}
function plPendiente(c, titulo) {
  return plSlide(`
    ${plCrest('left:40px;top:40px;')}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;">
      <div class="pl-t pl-t-l">${safeText(titulo)}</div><div class="pl-sub" style="opacity:0.5;">Por definir</div></div>`, c.slate, 'pl-pendiente');
}
function ajustarSlides(root) {
  root.querySelectorAll('.pl-frame').forEach(fr => {
    const sl = fr.querySelector('.pl-slide');
    if (!sl) return;
    let maxW = Math.min(fr.parentElement?.clientWidth || root.clientWidth || 1700, 1700); // misma regla de ancho que las fichas (fitFichaToFrame)
    const lim = parseFloat(getComputedStyle(fr).maxWidth); if (lim > 0) maxW = Math.min(maxW, lim);   // pantalla completa: un frame suelto también se ajusta al alto
    fr.style.width = `${maxW}px`;
    fr.style.margin = '0 auto 16px';
    sl.style.transform = `scale(${maxW / PL_W})`;
  });
}
// Reduce la foto elegida a ≤1400 px y JPEG 0.8 (~150 KB) para guardarla en el doc de la plantilla.
function fotoADataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('imagen no válida'));
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', 0.8));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// ── Campograma: campo.jpg a diapositiva completa con los jugadores colocados a mano ──
const CAMPO_POS = { tl: [270, 360], tr: [0, 90], br: [90, 180], bl: [180, 270] };
const textoSobre = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#111';
  const n = parseInt(m[1], 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
  return l > 150 ? '#111' : '#fff';
};
const hexDeNota = v => {
  if (v == null || Number.isNaN(v)) return null;
  return [...state.scoreBands].sort((a, b) => b.min - a.min).find(b => v >= Number(b.min))?.color || null;
};
const notaNum = t => { if (t == null || t === '') return null; const v = parseFloat(String(t).replace(',', '.')); return Number.isNaN(v) ? null : v; };

// SVG como <img> (data-URL): html2canvas solo dibuja el bitmap y no rompe arcos/clip/textPath al exportar el PDF.
const svgComoImg = (svg, w, h, estilo) => `<img alt="" draggable="false" width="${w}" height="${h}" style="${estilo}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"/>`;

const PL_CARD_ESCALA = 0.65;   // tamaño de cada jugador en el campograma (24 jugadores caben); ajustable
// Todas las medidas ya van multiplicadas por la escala (sin transform CSS ni viewBox escalado):
// html2canvas pintaba mal los SVG dentro de elementos con transform al exportar el PDF.
function plCardJugador(j, f1, x, y, escala) {
  const K = escala || PL_CARD_ESCALA, k = v => Math.round(v * K * 10) / 10;
  const R = k(84), r = k(52), cx = R, cy = R;
  const pol = (rad, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
  const order = f1.gridOrder || { tl: 'mental', tr: 'tecnico', bl: 'condicional', br: 'tactico' };
  const quarters = Object.entries(CAMPO_POS).map(([pos, [a, b]]) => {
    const [x1, y1] = pol(R, a), [x2, y2] = pol(R, b), [x3, y3] = pol(r, b), [x4, y4] = pol(r, a);
    return `<path d="M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 0 0 ${x4},${y4} Z" fill="${f1.circleColors?.[order[pos]] || '#ffffff'}" stroke="#94a3b8" stroke-width="1"/>`;
  }).join('');
  const id = `plc${++plUid}`;
  const foto = j.fotoUrl
    ? `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r - 1}"/></clipPath><image xlink:href="${j.fotoUrl}" href="${j.fotoUrl}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` : '';
  const nota = (txt) => {
    const hex = hexDeNota(notaNum(txt));
    return hex ? { bg: hex, fg: textoSobre(hex), t: String(txt) } : { bg: '#ffffff', fg: '#111', t: 'X' };
  };
  const D = k(58);
  const circ = (n, left) => `<div style="position:absolute;left:${left}px;top:${-k(84 + 17)}px;width:${D}px;height:${D}px;border-radius:50%;background:${n.bg};color:${n.fg};border:${k(3)}px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${k(n.t.length > 2 ? 24 : 30)}px;font-family:system-ui,sans-serif;">${safeText(n.t)}</div>`;
  const barras = (f1.statusBars || []).slice(0, 3).map(b => {
    const bg = b.hex || '#ffffff';
    return `<div style="width:${k(240)}px;height:${k(30)}px;box-sizing:border-box;margin-bottom:${k(4)}px;background:${bg};color:#000;border:${k(3)}px solid #0b2a6b;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;font-weight:400;font-size:${k(18)}px;text-transform:uppercase;white-space:nowrap;overflow:hidden;">${safeText(b.label)}</div>`;
  }).join('');
  const apellido = String(j.apellidos || j.nombre || '').trim().toUpperCase();
  return `<div class="pl-card" data-jid="${j.id}" style="position:absolute;left:${x / 100 * PL_W}px;top:${y / 100 * PL_H}px;width:0;height:0;cursor:grab;touch-action:none;" title="Arrastra para mover · doble clic para quitar">
    ${svgComoImg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${R * 2}" height="${R * 2}" viewBox="0 0 ${R * 2} ${R * 2}">${quarters}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>${foto}</svg>`, R * 2, R * 2, `position:absolute;left:${-R}px;top:${-R}px;pointer-events:none;`).replace('<img ', '<img class="pl-donut" ')}
    ${circ(nota(f1.player?.rValue), -k(84 + 17))}${circ(nota(f1.player?.pValue), k(84 - 41))}
    <div style="position:absolute;left:${-k(90)}px;width:${k(180)}px;top:${R + k(6)}px;text-align:center;"><span style="display:inline-block;background:#d4a63a;color:#111;font-family:system-ui,sans-serif;font-weight:800;font-size:${k(20)}px;padding:${k(3)}px ${k(16)}px;border-radius:20px;white-space:nowrap;">${safeText(apellido)}</span></div>
    <div style="position:absolute;left:${R + k(28)}px;top:${-k(46)}px;">${barras}</div>
  </div>`;
}

// Resumen de posición: los jugadores de esa posición con su donut, notas y barras (igual que en el campograma), en cuadrícula.
function plResumenPosicion(titulo, temporada, teamLabel, items, f1Map) {
  const its = items.filter(x => f1Map[x.j.id]);
  const n = its.length, cols = n <= 4 ? Math.max(1, n) : (n <= 12 ? 4 : 5);
  const rows = Math.ceil(n / cols), L = 60, W = PL_W - 2 * L, cellW = W / cols;
  const K = Math.min(1.0, cellW / 480, (PL_H - 330) / rows / 270);
  const rowH = Math.min(330, (PL_H - 330) / rows);
  const cards = its.map(({ j }, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const enFila = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const x0 = L + (cols - enFila) * cellW / 2 + col * cellW;
    const cx = x0 + 110 * K, cy = 270 + row * rowH + 120 * K;
    return plCardJugador(j, f1Map[j.id], cx / PL_W * 100, cy / PL_H * 100, K).replace('cursor:grab;', '').replace(/ title="[^"]*"/, '');
  }).join('');
  return plSlide(`<img src="./campo1.jpg" alt="" onerror="this.style.display='none'" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;" />
    ${plCrest('right:30px;top:24px;width:110px;height:110px;')}
    <div style="position:absolute;left:60px;top:10px;background:rgba(15,23,32,0.78);border-radius:10px;padding:4px 20px;display:flex;align-items:baseline;gap:14px;">
      <span class="pl-t pl-t-m" style="font-size:34px;">${safeText(plPlural(titulo))} · ${safeText(teamLabel)}</span><span class="pl-sub" style="font-size:22px;">${safeText(temporada)}</span></div>
    ${plLeyendaCirculo(state.fichaGridOrder || { tl: 'mental', tr: 'tecnico', bl: 'condicional', br: 'tactico' })}
    ${cards}`, '#1f6b2a');
}

// Leyenda: mismo donut que el de cada jugador, sin foto y en blanco, con el nombre de cada bloque en su cuarto (texto curvo).
function plLeyendaCirculo(order) {
  const R = 88, r = 44, cx = R, cy = R, mid = (R + r) / 2;   // tamaño real: sin viewBox escalado (el PDF lo pinta bien)
  const nombres = { mental: 'MENTAL', tecnico: 'TÉCNICO', tactico: 'TÁCTICO', condicional: 'CONDICIONAL' };
  const pol = (rad, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
  const u = ++plUid;
  const defs = [], textos = [];
  const quarters = Object.entries(CAMPO_POS).map(([pos, [a, b]]) => {
    const [x1, y1] = pol(R, a), [x2, y2] = pol(R, b), [x3, y3] = pol(r, b), [x4, y4] = pol(r, a);
    const abajo = pos === 'br' || pos === 'bl';
    const [px1, py1] = pol(mid, abajo ? b : a), [px2, py2] = pol(mid, abajo ? a : b);
    defs.push(`<path id="plleg${u}${pos}" d="M${px1},${py1} A${mid},${mid} 0 0 ${abajo ? 0 : 1} ${px2},${py2}" fill="none"/>`);
    textos.push(`<text font-size="12.5" font-weight="800" fill="#111" font-family="system-ui,sans-serif"><textPath xlink:href="#plleg${u}${pos}" href="#plleg${u}${pos}" startOffset="50%" text-anchor="middle">${nombres[order[pos]] || ''}</textPath></text>`);
    return `<path d="M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 0 0 ${x4},${y4} Z" fill="#ffffff" stroke="#94a3b8" stroke-width="1"/>`;
  }).join('');
  return svgComoImg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${R * 2}" height="${R * 2}" viewBox="0 0 ${R * 2} ${R * 2}"><defs>${defs.join('')}</defs>${quarters}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>${textos.join('')}</svg>`, R * 2, R * 2, 'position:absolute;right:60px;bottom:45px;');
}

// Mapa de nivel: izquierda = residen en Madrid (Residente / Media pensión), derecha = En residencia.
// Franjas por la nota elegida (Rendimiento o Proyección): ≥4 verde · 3–<4 amarillo · <3 rojo. Sin esa nota → franja 3-4 con "X".
const PL_RESI = {
  'Residente en Madrid': { lado: 'izq', bg: '#ffffff', fg: '#0b2a6b', txt: 'MADRID' },
  'Media pensión':       { lado: 'izq', bg: '#0b2a6b', fg: '#ffffff', txt: 'MEDIA PENSIÓN' },
  'En residencia':       { lado: 'der', bg: '#d4a63a', fg: '#111111', txt: 'RESIDENCIA' },
};
let plMapaModo = 'r';   // nota que ordena el mapa de nivel: 'r' rendimiento · 'p' proyección · 'rp' las dos (2 diapositivas)
function plMapaNivel(tLabel, temporada, items, modo = 'r') {
  const conf = it => PL_RESI[it.j.residencia] || PL_RESI['Residente en Madrid'];
  const campoN = modo === 'p' ? 'pValue' : 'rValue';
  const notaDe = it => notaNum(it.f1?.player?.[campoN]);
  const bandas = [
    { lab: '+4', bg: '#7bbf90', ok: v => v != null && v >= 4 },
    { lab: '3-4', bg: '#f2e09c', ok: v => v == null || (v >= 3 && v < 4) },
    { lab: '-3', bg: '#f0728f', ok: v => v != null && v < 3 },
  ];
  const POR_FILA = 6, ITEM_W = 150, TOP = 165, BOT = 1310, GAP = 16, MITAD = PL_W / 2;
  const datos = bandas.map(b => {
    const its = items.filter(it => b.ok(notaDe(it))).sort((a, c2) => (notaDe(c2) ?? -1) - (notaDe(a) ?? -1));
    const izq = its.filter(it => conf(it).lado === 'izq'), der = its.filter(it => conf(it).lado === 'der');
    return { b, izq, der, filas: Math.max(1, Math.ceil(izq.length / POR_FILA), Math.ceil(der.length / POR_FILA)) };
  });
  const totalFilas = datos.reduce((a, d) => a + d.filas, 0);
  const libre = BOT - TOP - GAP * (datos.length - 1);
  let y = TOP;
  const partes = datos.map(d => {
    const h = Math.round(libre * d.filas / totalFilas), y0 = y; y += h + GAP;
    const rowH = Math.min(240, (h - 90) / d.filas), D = Math.round(Math.min(120, rowH * 0.5));
    const lado = (arr, x0, x1) => arr.map((it, i) => {
      const fila = Math.floor(i / POR_FILA), enFila = Math.min(POR_FILA, arr.length - fila * POR_FILA), col = i % POR_FILA;
      const cx = (x0 + x1) / 2 - (enFila * ITEM_W) / 2 + col * ITEM_W + ITEM_W / 2;
      const top = y0 + 84 + fila * rowH + Math.max(0, (rowH - D - 44) / 2);
      const cf = conf(it), v = notaDe(it), hex = v != null ? hexDeNota(v) : null;
      const pl = it.f1?.player || {};
      const txtNota = hex ? String(pl[campoN]) : 'X';
      const bgN = hex || '#ffffff', fgN = hex ? textoSobre(hex) : '#111';
      const cid = `plmn${++plUid}`, R0 = D / 2, dN = Math.round(D * 0.44);
      const foto = it.j.fotoUrl
        ? svgComoImg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}"><clipPath id="${cid}"><circle cx="${R0}" cy="${R0}" r="${R0}"/></clipPath><circle cx="${R0}" cy="${R0}" r="${R0}" fill="#ffffff"/><image xlink:href="${it.j.fotoUrl}" href="${it.j.fotoUrl}" x="0" y="0" width="${D}" height="${D}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${cid})"/></svg>`, D, D, `position:absolute;left:${(ITEM_W - D) / 2}px;top:0;`)
        : `<div style="position:absolute;left:${(ITEM_W - D) / 2}px;top:0;width:${D}px;height:${D}px;border-radius:50%;background:#fff;"></div>`;
      const ap = String(it.j.apellidos || it.j.nombre || '').trim().toUpperCase();
      return `<div style="position:absolute;left:${cx - ITEM_W / 2}px;top:${top}px;width:${ITEM_W}px;height:${D + 44}px;">
        ${foto}
        <div style="position:absolute;left:${(ITEM_W + D) / 2 - dN * 0.6}px;top:${-dN * 0.1}px;width:${dN}px;height:${dN}px;border-radius:50%;background:${bgN};color:${fgN};border:3px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${txtNota.length > 3 ? 15 : 20}px;font-family:system-ui,sans-serif;">${safeText(txtNota)}</div>
        <div style="position:absolute;left:-10px;width:${ITEM_W + 20}px;top:${D + 8}px;text-align:center;"><span style="display:inline-block;background:${cf.bg};color:${cf.fg};font-family:system-ui,sans-serif;font-weight:800;font-size:17px;padding:3px 14px;border-radius:18px;white-space:nowrap;">${safeText(ap)}</span></div></div>`;
    }).join('');
    return { band: `<div style="position:absolute;left:20px;top:${y0}px;width:${PL_W - 40}px;height:${h}px;background:${d.b.bg};border-radius:70px;"></div>`, cont: `${lado(d.izq, 40, MITAD - 10)}${lado(d.der, MITAD + 10, PL_W - 40)}
      <div style="position:absolute;left:${MITAD - 70}px;top:${y0 + 14}px;width:140px;height:56px;border-radius:28px;background:#14306e;color:#fff;font-family:system-ui,sans-serif;font-weight:900;font-size:34px;display:flex;align-items:center;justify-content:center;">${d.b.lab}</div>` };
  });
  const cuenta = k => items.filter(it => conf(it).txt === k).length;
  const chip = k => { const cf = Object.values(PL_RESI).find(x => x.txt === k); return `<div style="display:flex;align-items:center;gap:8px;"><span style="width:34px;height:34px;border-radius:50%;background:#fff;color:#111;border:2px solid #0b2a6b;display:flex;align-items:center;justify-content:center;font:800 18px system-ui,sans-serif;">${cuenta(k)}</span><span style="background:${cf.bg};color:${cf.fg};font:800 15px system-ui,sans-serif;padding:3px 14px;border-radius:16px;min-width:130px;text-align:center;">${k}</span></div>`; };
  return plSlide(`
    ${plCrest('right:30px;top:24px;width:110px;height:110px;')}
    <div style="position:absolute;left:60px;top:10px;background:rgba(15,23,32,0.78);border-radius:10px;padding:4px 20px;display:flex;align-items:baseline;gap:14px;">
      <span class="pl-t pl-t-m" style="font-size:34px;">${safeText(tLabel)}</span><span class="pl-sub" style="font-size:22px;">${safeText(temporada)}</span></div>
    <div style="position:absolute;left:60px;top:66px;background:#14306e;color:#fff;border-radius:10px;padding:4px 18px;font:800 22px system-ui,sans-serif;">NIVEL SEGÚN ${modo === 'p' ? 'PROYECCIÓN' : 'RENDIMIENTO'}</div>
    <div style="position:absolute;right:170px;top:18px;display:flex;flex-direction:column;gap:6px;">${chip('RESIDENCIA')}${chip('MADRID')}${chip('MEDIA PENSIÓN')}</div>
    <img src="./madrid.jpg" alt="" onerror="this.style.display='none'" style="position:absolute;left:${MITAD / 2 - 50}px;top:82px;width:100px;height:63px;object-fit:cover;" />
    <img src="./espa%C3%B1a.png" alt="" onerror="this.style.display='none'" style="position:absolute;left:${MITAD + MITAD / 2 - 50}px;top:82px;width:100px;height:63px;object-fit:cover;" />
    ${partes.map(p => p.band).join('')}
    <div style="position:absolute;left:${MITAD - 3}px;top:60px;width:6px;height:${BOT - 60}px;background:rgba(0,0,0,0.4);"></div>
    ${partes.map(p => p.cont).join('')}
`, '#e4e6e1');
}

// Foto de portada: la del equipo si tiene una propia; si no, la general de la temporada (para todos los equipos).
const fotoPortadaDe = (temporada, teamKey) =>
  plantillasCache?.find(d => d.id === plantillaDocId(temporada, teamKey))?.fotoPortada
  || plantillasCache?.find(d => d.id === plantillaDocId(temporada, '_portada'))?.fotoPortada || null;

// Estructura del PDF de equipo: portada · portada del equipo · campograma (pendiente) · mapa de nivel (pendiente)
// · por cada posición: separador + Ficha 1 y 2 de cada jugador.
async function renderPlantillaPresentacion(container) {
  injectPlantillaStyles();
  const t = TEAMS.find(x => x.key === plVista.teamKey);
  const temporada = plantillaTemporada;
  const docP = () => plantillasCache.find(d => d.id === plantillaDocId(temporada, plVista.teamKey)) || {};
  const jugs = (docP().jugadorIds || []).map(id => state.players.find(x => x.id === id)).filter(Boolean).sort(ordenJugadores);
  const c = state.fichaColors || { slate: '#24313d', wine: '#7f3a52' };
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="pl-barra flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
      <button class="btn btn-ghost" id="pl-volver">← Plantillas</button>
      <b>${safeText(t?.label || '')} · ${safeText(temporada)} · ${jugs.length} jugadores</b>
      <label class="btn btn-sm" style="cursor:pointer;" title="Se usa en todos los equipos de la temporada salvo los que tengan una propia">Foto portada (todos los equipos)<input type="file" accept="image/*" id="pl-foto-portada" hidden /></label>
      <label class="btn btn-sm" style="cursor:pointer;" title="Solo para este equipo">Foto portada (solo este equipo)<input type="file" accept="image/*" id="pl-foto-portada-eq" hidden /></label>
      <button class="btn btn-sm btn-ghost" id="pl-foto-portada-quitar" ${docP().fotoPortada ? '' : 'style="display:none;"'}>↺ Usar la general</button>
      <label class="btn btn-sm" style="cursor:pointer;">Foto equipo<input type="file" accept="image/*" id="pl-foto-equipo" hidden /></label>
      <label class="text-xs text-muted" for="pl-ref">Comparar medias con</label>
      <select class="select" id="pl-ref" style="max-width:260px;">
        <option value="team" ${plRefModo === 'team' ? 'selected' : ''}>Equipo (toda la plantilla)</option>
        <option value="teampos" ${plRefModo === 'teampos' ? 'selected' : ''}>Equipo · misma posición</option>
        <option value="none" ${plRefModo === 'none' ? 'selected' : ''}>Sin comparar</option>
      </select>
      <label class="text-xs"><input type="checkbox" id="pl-inc-pend" /> Incluir páginas "por definir" en el PDF</label>
      <label class="text-xs btn-print-ficha"><input type="checkbox" id="pl-ver-obs" ${plVerObs() ? 'checked' : ''} /> Ver observaciones</label>
      <button class="btn btn-primary btn-print-ficha" id="pl-pres-pdf" disabled>⬇ PDF del equipo</button>
      <button class="btn btn-print-ficha" id="pl-pres-full" title="Pantalla completa: flechas del teclado para pasar de diapositiva, Esc para salir">▶ Presentar</button>
      <span class="btn-print-ficha" id="pl-saltos" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;"></span>
      <span class="text-xs text-muted" id="pl-pres-estado">Cargando fichas…</span>
    </div>
    <div id="pl-pres-lista"></div>`;
  container.querySelector('#pl-volver').addEventListener('click', () => { plVista = { modo: 'grid', teamKey: null }; renderPanelPlantillas(container); });
  container.querySelector('#pl-ref').addEventListener('change', e => { plRefModo = e.target.value; renderPlantillaPresentacion(container); });
  const lista = container.querySelector('#pl-pres-lista');
  const estado = container.querySelector('#pl-pres-estado');
  const pdfBtn = container.querySelector('#pl-pres-pdf');
  const addHTML = html => lista.insertAdjacentHTML('beforeend', html);
  plTextos = { ...(plantillasCache.find(d => d.id === plantillaDocId(temporada, '_portada'))?.textos || {}), ...(docP().textos || {}) };
  lista.addEventListener('paste', e => { if (e.target.closest?.('[data-pl-ed]')) { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); } });
  lista.addEventListener('focusout', async e => {
    const el = e.target.closest?.('[data-pl-ed]'); if (!el) return;
    const key = el.dataset.plEd, val = el.innerText.replace(/\n+$/, '').trim();
    if (val === (plTextos[key] ?? null) || (val === '' && plTextos[key] == null)) return;
    const next = { ...plTextos }; if (val) next[key] = val; else delete next[key];
    plTextos = next;
    const dest = key.startsWith('portada.') ? '_portada' : plVista.teamKey;
    try { await guardarPlantillaEntrada(temporada, dest, 'textos', key, val); }
    catch (err) { console.error(err); showError('No se pudo guardar el texto.'); }
  });
  let plObs = { ...(docP().observaciones || {}) };
  // Cuadro de observaciones bajo cada diapositiva (solo en pantalla; no entra en el PDF). Cada diapositiva lleva data-pl-obs="clave".
  const obsFechaAuto = () => { try { return localStorage.getItem('rm-obs-fecha') !== '0'; } catch { return true; } };
  const hoy = () => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const obsAnchos = () => lista.querySelectorAll('.pl-obs').forEach(b => {   // el cuadro mide lo mismo que la diapositiva
    const u = b.previousElementSibling; if (!u) return;
    const w = (u.querySelector?.('.ficha-a4-frame') || u).getBoundingClientRect().width;
    if (w > 0) { b.style.width = `${Math.round(w)}px`; b.style.maxWidth = '100%'; }
  });
  const obsMontar = () => {
    lista.querySelectorAll('[data-pl-obs]').forEach(u => {
      if (u.nextElementSibling?.classList.contains('pl-obs')) return;
      const box = document.createElement('div');
      box.className = 'pl-obs btn-print-ficha';
      if (u.dataset.plFijo) box.dataset.plFijo = '1';
      box.innerHTML = `<textarea class="input" data-pl-obs-key="${safeText(u.dataset.plObs)}" rows="2" placeholder="Observaciones…">${safeText(plObs[u.dataset.plObs] || '')}</textarea>
        <div class="pl-obs-ctl"><label title="Al hacer clic por primera vez en un cuadro vacío se escribe la fecha de hoy"><input type="checkbox" data-pl-obs-auto ${obsFechaAuto() ? 'checked' : ''}/> Fecha automática</label><button type="button" class="btn btn-sm" data-pl-obs-fecha>📅 Insertar fecha</button></div>`;
      u.after(box);
    });
    obsAnchos(); requestAnimationFrame(obsAnchos);
  };
  lista.addEventListener('focusout', async e => {
    const ta = e.target.closest?.('[data-pl-obs-key]'); if (!ta) return;
    const key = ta.dataset.plObsKey, val = ta.value.trim();
    if (val === (plObs[key] || '')) return;
    const next = { ...plObs }; if (val) next[key] = val; else delete next[key];
    plObs = next;
    try { await guardarPlantillaEntrada(temporada, plVista.teamKey, 'observaciones', key, val); }
    catch (err) { console.error(err); showError('No se pudieron guardar las observaciones.'); }
  });
  lista.addEventListener('focusin', e => {   // primer clic en un cuadro vacío → fecha de hoy
    const ta = e.target.closest?.('[data-pl-obs-key]');
    if (ta && !ta.value.trim() && obsFechaAuto()) { ta.value = `${hoy()}: `; ta.setSelectionRange(ta.value.length, ta.value.length); }
  });
  lista.addEventListener('change', e => { if (e.target.matches?.('[data-pl-obs-auto]')) { try { localStorage.setItem('rm-obs-fecha', e.target.checked ? '1' : '0'); } catch {} lista.querySelectorAll('[data-pl-obs-auto]').forEach(c => { c.checked = e.target.checked; }); } });
  lista.addEventListener('click', e => {
    const b = e.target.closest?.('[data-pl-obs-fecha]'); if (!b) return;
    const ta = b.closest('.pl-obs').querySelector('textarea');
    ta.value = `${ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : ''}${hoy()}: `;
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  const campoHost = document.createElement('div');   // aquí va la diapositiva del campograma (tras "Mapa de nivel")
  let soloRefrescar = null;   // modo diapositiva a diapositiva (pantalla completa)
  const mapaHost = document.createElement('div');    // diapositiva "Mapa de nivel" (antes del campograma)
  lista.appendChild(mapaHost);
  lista.appendChild(campoHost);

  const dibujarPortadas = () => {
    lista.querySelectorAll('[data-pl-fijo]').forEach(el => el.remove());
    const tmp = document.createElement('div');
    tmp.innerHTML = plPortadaGeneral(c, fotoPortadaDe(temporada, plVista.teamKey)) + plPortadaEquipo(c, docP().fotoEquipo, t?.label || '', temporada);
    [...tmp.children].forEach((el, i) => { el.dataset.plObs = ['portada', 'equipo'][i] || `fijo${i}`; });
    [...tmp.children].reverse().forEach(el => { el.dataset.plFijo = '1'; lista.prepend(el); });
    // Botón "Subir foto" sobre las dos portadas (solo en pantalla: queda fuera de la diapositiva que se captura al PDF)
    [['#pl-foto-portada', 0, 'portada (todos los equipos)'], ['#pl-foto-portada-eq', 0, 'portada (solo este equipo)'], ['#pl-foto-equipo', 1, 'del equipo']].forEach(([inp, i, txt]) => {
      const fr = lista.children[i];
      if (!fr) return;
      fr.style.position = 'relative';
      const b = document.createElement('button');
      b.className = 'btn btn-sm btn-primary pl-foto-btn';
      b.textContent = `📷 Foto ${txt}`;
      b.style.cssText = `position:absolute;right:12px;bottom:${12 + 36 * (inp === '#pl-foto-portada' ? 1 : 0)}px;z-index:5;`;
      b.addEventListener('click', () => container.querySelector(inp).click());
      fr.appendChild(b);
    });
    obsMontar();
    ajustarSlides(lista);
  };
  dibujarPortadas();
  const subirFoto = (inputId, campo) => container.querySelector(inputId).addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await guardarPlantilla(temporada, plVista.teamKey, { [campo]: await fotoADataUrl(f) }); if (campo === 'fotoPortada') container.querySelector('#pl-foto-portada-quitar').style.display = ''; dibujarPortadas(); showSuccess('Foto guardada.'); }
    catch (err) { console.error(err); showError('No se pudo guardar la foto (¿demasiado grande?).'); }
  });
  container.querySelector('#pl-foto-portada').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await guardarPlantilla(temporada, '_portada', { fotoPortada: await fotoADataUrl(f) }); dibujarPortadas(); showSuccess('Foto de portada guardada para todos los equipos.'); }
    catch (err) { console.error(err); showError('No se pudo guardar la foto (¿demasiado grande?).'); }
  });
  subirFoto('#pl-foto-equipo', 'fotoEquipo');
  subirFoto('#pl-foto-portada-eq', 'fotoPortada');
  container.querySelector('#pl-foto-portada-quitar').addEventListener('click', async e => {
    try { await guardarPlantilla(temporada, plVista.teamKey, { fotoPortada: '' }); e.target.style.display = 'none'; dibujarPortadas(); showSuccess('Este equipo vuelve a usar la portada general.'); }
    catch (err) { console.error(err); showError('No se pudo guardar el cambio.'); }
  });
  window.addEventListener('resize', () => { if (container.isConnected) ajustarSlides(lista); });

  if (!isFirebaseUnconfigured()) {
    await Promise.all(jugs.map(j => jugFichaRegs[j.id] ? null : queryRegistros({ jugadorId: j.id }).then(r => { jugFichaRegs[j.id] = r; }).catch(err => { console.error('[Firestore] Registros:', err); jugFichaRegs[j.id] = []; })));
  }
  if (!container.isConnected || plVista.modo !== 'pres') return;
  setGpsTolerance(state.condicionalTolerance);

  // Agrupa por posición (en el orden de Configuración); sin posición al final.
  const preps = jugs.map(j => ({ j, prep: prepararFichaJugador(j, jugFichaRegs[j.id] || [], temporada) }));
  // Campograma: campo.jpg a diapositiva completa + jugadores arrastrables (posiciones guardadas en la plantilla).
  const f1Map = {};
  preps.forEach(({ j, prep }) => { if (prep.fPos) f1Map[j.id] = buildFicha1RealData(prep.fPos, prep.fMedia, j, prep.aspectosTxt, prep.evSel?.eid); });
  const dibujarCampo = () => {
    const pos = docP().campograma || {};
    const colocados = jugs.filter(j => f1Map[j.id] && pos[j.id]);
    const libres = jugs.filter(j => f1Map[j.id] && !pos[j.id]);
    campoHost.innerHTML = `
      <div class="flex gap-8 mb-8 btn-print-ficha" style="align-items:center;flex-wrap:wrap;">
        <b>Campograma</b>
        <select class="select" id="pl-campo-sel" style="max-width:260px;"><option value="">Añadir jugador al campo…</option>${libres.map(j => `<option value="${j.id}">${safeText(nombreCompleto(j))}</option>`).join('')}</select>
        <button class="btn btn-sm btn-primary" id="pl-campo-add">Añadir</button>
        <span class="text-xs text-muted">Arrastra para mover · doble clic para quitar del campo.</span>
      </div>
      ${plSlide(`<img src="./campo1.jpg" alt="" onerror="this.style.display='none'" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;" />
        ${plCrest('right:30px;top:24px;width:110px;height:110px;')}
        <div style="position:absolute;left:60px;top:10px;background:rgba(15,23,32,0.78);border-radius:10px;padding:4px 20px;display:flex;align-items:baseline;gap:14px;">
          <span class="pl-t pl-t-m" style="font-size:34px;">${safeText(t?.label || '')}</span><span class="pl-sub" style="font-size:22px;">${safeText(temporada)}</span></div>
        ${plLeyendaCirculo(state.fichaGridOrder || { tl: 'mental', tr: 'tecnico', bl: 'condicional', br: 'tactico' })}
        ${colocados.map(j => plCardJugador(j, f1Map[j.id], pos[j.id].x, pos[j.id].y)).join('')}`, '#1f6b2a')}`;
    const fCampo = campoHost.querySelector('.pl-frame'); if (fCampo) fCampo.dataset.plObs = 'campo';
    obsMontar();
    ajustarSlides(lista);
    soloRefrescar?.();
    const sl = campoHost.querySelector('.pl-slide');
    const guardarCampo = async nuevo => {
      try { await guardarPlantilla(temporada, plVista.teamKey, { campograma: nuevo }); }
      catch (err) { console.error(err); showError('No se pudo guardar el campograma.'); }
    };
    campoHost.querySelector('#pl-campo-add').addEventListener('click', async () => {
      const id = campoHost.querySelector('#pl-campo-sel').value; if (!id) return;
      const n = Object.keys(pos).length;
      await guardarCampo({ ...pos, [id]: { x: 10 + (n % 5) * 17, y: 14 + Math.floor(n / 5) * 16 } });
      dibujarCampo();
    });
    let drag = null;
    sl.addEventListener('pointerdown', e => {
      const card = e.target.closest?.('.pl-card'); if (!card) return;
      const d = card.querySelector('.pl-donut').getBoundingClientRect();
      drag = { card, dx: e.clientX - (d.left + d.width / 2), dy: e.clientY - (d.top + d.height / 2), moved: false, id: card.dataset.jid };
      card.setPointerCapture?.(e.pointerId); card.style.cursor = 'grabbing'; e.preventDefault();
    });
    sl.addEventListener('pointermove', e => {
      if (!drag) return;
      const rc = sl.getBoundingClientRect();
      const x = Math.min(100, Math.max(0, ((e.clientX - drag.dx - rc.left) / rc.width) * 100));
      const y = Math.min(100, Math.max(0, ((e.clientY - drag.dy - rc.top) / rc.height) * 100));
      drag.x = x; drag.y = y; drag.moved = true;
      drag.card.style.left = `${x / 100 * PL_W}px`; drag.card.style.top = `${y / 100 * PL_H}px`;
    });
    const fin = async () => {
      if (!drag) return;
      const d = drag; drag = null; d.card.style.cursor = 'grab';
      if (d.moved) { pos[d.id] = { x: d.x, y: d.y }; await guardarCampo({ ...pos }); }
    };
    sl.addEventListener('pointerup', fin); sl.addEventListener('pointercancel', fin);
    sl.addEventListener('dblclick', async e => {
      const card = e.target.closest?.('.pl-card'); if (!card) return;
      const nuevo = { ...pos }; delete nuevo[card.dataset.jid];
      await guardarCampo(nuevo); dibujarCampo();
    });
  };
  const dibujarMapa = () => {
    mapaHost.innerHTML = `
      <div class="flex gap-8 mb-8 btn-print-ficha" style="align-items:center;flex-wrap:wrap;">
        <b>Mapa de nivel</b>
        <label class="text-xs text-muted" for="pl-mapa-modo">Ordenar por la nota de</label>
        <select class="select" id="pl-mapa-modo" style="max-width:200px;"><option value="r" ${plMapaModo === 'r' ? 'selected' : ''}>Rendimiento</option><option value="p" ${plMapaModo === 'p' ? 'selected' : ''}>Proyección</option><option value="rp" ${plMapaModo === 'rp' ? 'selected' : ''}>Las dos (2 diapositivas)</option></select>
      </div>
      ${(plMapaModo === 'rp' ? ['r', 'p'] : [plMapaModo]).map(m => plMapaNivel(t?.label || '', temporada, jugs.map(j => ({ j, f1: f1Map[j.id] })), m)).join('')}`;
    mapaHost.querySelector('#pl-mapa-modo').addEventListener('change', e => { plMapaModo = e.target.value; dibujarMapa(); });
    [...mapaHost.querySelectorAll('.pl-frame')].forEach((f, i, arr) => { f.dataset.plObs = arr.length > 1 ? `mapa-${i ? 'p' : 'r'}` : `mapa-${plMapaModo}`; });
    obsMontar();
    ajustarSlides(lista);
    soloRefrescar?.();
  };
  dibujarMapa();
  dibujarCampo();

  // Media de comparación = media de las medias de cada jugador de la plantilla (cada uno pesa 1; sin consultas extra).
  const refDe = (j, prep) => {
    if (plRefModo === 'none') return null;
    const pool = preps.filter(x => x.prep.fMedia && (plRefModo === 'team' || x.prep.fPos === prep.fPos));
    if (!pool.length) return { label: 'Comparación: sin datos' };
    const medias = Object.fromEntries(pool.map(x => [x.j.id, x.prep.fMedia]));
    return {
      mental: calcularMediaGrupo(medias, 'mental'), tecnico: calcularMediaGrupo(medias, 'tecnico'), tactico: calcularMediaGrupo(medias, 'tactico'),
      label: `Comparado con: ${plRefModo === 'team' ? 'Equipo' : 'Equipo · misma posición'} ${t?.label || ''} (${pool.length} jug.)`,
    };
  };
  const grupos = state.positions.map(pos => ({ titulo: pos.label, items: preps.filter(x => x.prep.fPos === pos.key) }));
  grupos.push({ titulo: 'Sin posición', items: preps.filter(x => !x.prep.fPos || !state.positions.some(pos => pos.key === x.prep.fPos)) });

  let hechas = 0;
  for (const g of grupos.filter(g => g.items.length)) {
    addHTML(plSeparadorPosicion(c, g.titulo, g.items.map(x => x.j)));
    lista.lastElementChild.dataset.plObs = `sep.${g.titulo}`;
    obsMontar();
    if (g.items.some(x => f1Map[x.j.id])) { addHTML(plResumenPosicion(g.titulo, temporada, t?.label || '', g.items, f1Map)); lista.lastElementChild.dataset.plObs = `res.${g.titulo}`; obsMontar(); }
    await aplicarSinFondo(lista);
    ajustarSlides(lista);
    for (const { j, prep } of g.items) {
      const sec = document.createElement('div');
      sec.className = 'mb-16';
      sec.innerHTML = `
        <div class="flex gap-8 mb-8 btn-print-ficha" style="align-items:center;flex-wrap:wrap;">
          <b style="font-size:18px;">${safeText(nombreCompleto(j))}</b>
          <span class="text-xs text-muted">${safeText(prep.evSel ? `${prep.evSel.ev.temporada} · ${prep.evSel.ev.nombre}` : 'Sin evaluaciones')}</span>
          <button class="btn btn-sm" data-pr-textos="${j.id}">Guardar textos</button>
          <button class="btn btn-sm" data-pr-editar="${j.id}">Editar datos</button>
        </div>
        ${prep.fPos ? '<div class="ficha-wrap mb-16" data-pr-f1></div><div class="ficha-wrap" data-pr-f2></div>' : '<p class="text-xs text-muted">Sin posición ni evaluación: asigna una posición en Datos (no entra en el PDF).</p>'}`;
      lista.appendChild(sec);
      if (!prep.fPos) continue;
      sec.querySelectorAll('[data-pr-f1],[data-pr-f2]').forEach(w => { w.dataset.pie = pieEvaluacion(prep.evSel?.ev); });
      sec.querySelector('[data-pr-f1]').dataset.plObs = `j1.${j.id}`; sec.querySelector('[data-pr-f2]').dataset.plObs = `j2.${j.id}`;
      obsMontar();
      renderFichaPagina1(sec.querySelector('[data-pr-f1]'), buildFicha1RealData(prep.fPos, prep.fMedia, j, prep.aspectosTxt, prep.evSel?.eid), LOGO_PATH, state.fichaColors);
      renderFichaDetalle(sec.querySelector('[data-pr-f2]'), buildFichaRealData(prep.fPos, prep.fMedia, j, prep.evSel?.eid, refDe(j, prep)), LOGO_PATH, state.scoreBands, undefined, state.fichaColors, state.fichaGridOrder);
      sec.querySelector('[data-pr-textos]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const grids = [...sec.querySelectorAll('.p1-aspectos-grid')];
        const leer = (gr, i) => [...(gr?.querySelectorAll('.p1-aspectos-col')[i]?.querySelectorAll('li') || [])].map(li => li.innerText.trim());
        const nuevo = { of_pot: leer(grids[0], 0), of_mej: leer(grids[0], 1), def_pot: leer(grids[1], 0), def_mej: leer(grids[1], 1) };
        const fichaTextos = { ...(j.fichaTextos || {}), [prep.textosKey]: nuevo };
        btn.disabled = true; btn.textContent = 'Guardando…';
        try {
          await updateDocument('jugadores', j.id, { fichaTextos });
          j.fichaTextos = fichaTextos;
          setState({ players: state.players.map(x => x.id === j.id ? { ...x, fichaTextos } : x) });
          showSuccess('Textos guardados.');
        } catch (err) { console.error(err); showError('No se pudieron guardar los textos.'); }
        finally { btn.disabled = false; btn.textContent = 'Guardar textos'; }
      });
      sec.querySelector('[data-pr-editar]').addEventListener('click', () => { jugFichaId = null; jugadorFormId = j.id; switchTab('jugadores'); });
      estado.textContent = `Fichas ${++hechas}/${preps.length}…`;
      await new Promise(r => setTimeout(r, 0)); // deja respirar al navegador entre fichas
    }
  }
  estado.textContent = '';
  const reajustar = () => { ajustarSlides(lista); lista.querySelectorAll('.ficha-wrap').forEach(w => fitFichaToFrame(w)); obsAnchos(); };
  reajustar();
  if (window.ResizeObserver) {
    let ultimoAncho = lista.clientWidth;
    new ResizeObserver(() => {
      if (!container.isConnected || lista.clientWidth === ultimoAncho) return;
      ultimoAncho = lista.clientWidth;
      requestAnimationFrame(reajustar);
    }).observe(lista);
  }
  pdfBtn.disabled = false;
  // Pantalla completa, diapositiva a diapositiva (flechas / botones). Las demás quedan ocultas.
  let cur = 0;
  const nav = document.createElement('div');
  nav.id = 'pl-solo-nav';
  nav.innerHTML = '<button data-n="-1">◀</button><span id="pl-solo-cnt"></span><button data-n="1">▶</button><button data-obs="1" title="Mostrar u ocultar las observaciones (tecla N)">📝 Notas</button>';
  lista.appendChild(nav);
  const unidades = () => [...lista.querySelectorAll('.pl-frame, .ficha-wrap')];
  const mostrar = i => {
    const us = unidades(); if (!us.length) return;
    cur = Math.max(0, Math.min(us.length - 1, i));
    lista.querySelectorAll('.pl-cur,.pl-host').forEach(x => x.classList.remove('pl-cur', 'pl-host'));
    const u = us[cur]; u.classList.add('pl-cur');
    let T = u; while (T.parentElement && T.parentElement !== lista) T = T.parentElement;
    T.classList.add('pl-host');
    nav.querySelector('#pl-solo-cnt').textContent = `${cur + 1} / ${us.length}`;
    reajustar();
  };
  soloRefrescar = () => { if (lista.classList.contains('pl-solo')) mostrar(cur); };
  // Saltos rápidos: Inicio · Mapa de nivel · Campograma · una por posición (en pantalla y en modo presentación)
  const saltos = [
    { label: 'Inicio', ok: k => k === 'portada' },
    { label: 'Mapa de nivel', ok: k => k.startsWith('mapa-') },
    { label: 'Campograma', ok: k => k === 'campo' },
    ...grupos.filter(g => g.items.length).map(g => ({ label: plPlural(g.titulo), ok: k => k === `sep.${g.titulo}` })),
  ];
  const irA = ok => {
    const u = [...lista.querySelectorAll('[data-pl-obs]')].find(x => ok(x.dataset.plObs)); if (!u) return;
    if (lista.classList.contains('pl-solo')) mostrar(unidades().indexOf(u)); else u.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const hostSaltos = container.querySelector('#pl-saltos');
  saltos.forEach(x => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm'; b.textContent = x.label;
    b.addEventListener('click', () => irA(x.ok));
    hostSaltos.appendChild(b);
  });
  // Los mismos saltos, en una barra fija arriba en modo presentación
  const navTop = document.createElement('div');
  navTop.id = 'pl-solo-top';
  saltos.forEach(x => {
    const b = document.createElement('button');
    b.textContent = x.label;
    b.addEventListener('click', () => { irA(x.ok); b.blur(); });
    navTop.appendChild(b);
  });
  lista.appendChild(navTop);
  const aplicarVerObs = v => {
    lista.classList.toggle('pl-sin-obs', !v);
    try { localStorage.setItem('rm-pl-ver-obs', v ? '1' : '0'); } catch {}
    const chk = container.querySelector('#pl-ver-obs'); if (chk) chk.checked = v;
    requestAnimationFrame(reajustar);
  };
  aplicarVerObs(plVerObs());
  if (plIrJugador) { const jid = plIrJugador; plIrJugador = null; let n = 0; const t0 = setInterval(() => { if (lista.querySelector(`[data-pl-obs="j1.${jid}"]`) || ++n > 40) { clearInterval(t0); irA(k => k === `j1.${jid}`); } }, 150); }
  container.querySelector('#pl-ver-obs').addEventListener('change', e => aplicarVerObs(e.target.checked));
  nav.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.obs) { aplicarVerObs(lista.classList.contains('pl-sin-obs')); return; }
    if (b.dataset.n) mostrar(cur + Number(b.dataset.n));
  });
  container.querySelector('#pl-pres-full').addEventListener('click', () => {
    const us = unidades(), mid = window.innerHeight / 2;   // empieza por la diapositiva que estás viendo
    const i = us.findIndex(x => { const r = x.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; });
    cur = Math.max(0, i);
    (lista.requestFullscreen || lista.webkitRequestFullscreen)?.call(lista);
  });
  document.addEventListener('fullscreenchange', () => {
    if (!container.isConnected) return;
    if (document.fullscreenElement === lista) { lista.classList.add('pl-solo'); requestAnimationFrame(() => mostrar(cur)); }
    else if (lista.classList.contains('pl-solo')) {
      const actual = unidades()[cur];
      lista.classList.remove('pl-solo');
      lista.querySelectorAll('.pl-cur,.pl-host').forEach(x => x.classList.remove('pl-cur', 'pl-host'));
      requestAnimationFrame(() => { reajustar(); actual?.scrollIntoView({ block: 'center' }); });
    }
  });
  document.addEventListener('keydown', e => {
    if (!container.isConnected || document.fullscreenElement !== lista || e.target.closest?.('[contenteditable],textarea,input,select')) return;
    if (e.key === 'n' || e.key === 'N') { aplicarVerObs(lista.classList.contains('pl-sin-obs')); return; }
    const sig = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key), ant = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
    if (!sig && !ant) return;
    e.preventDefault();
    mostrar(cur + (sig ? 1 : -1));
  });
  lista.tabIndex = -1;
  pdfBtn.addEventListener('click', async () => {
    const incluirPend = container.querySelector('#pl-inc-pend').checked;
    const evsEq = [...new Map(preps.filter(x => x.prep.evSel?.ev).map(x => [x.prep.evSel.eid, x.prep.evSel.ev])).values()];
    const pieEq = evsEq.length === 1 ? pieEvaluacion(evsEq[0]) : (evsEq.length ? `Evaluaciones: ${evsEq.map(e => [e.temporada, e.nombre].filter(Boolean).join(' · ')).join(' / ')}` : '');
    lista.querySelectorAll('.pl-frame').forEach(f => { f.dataset.pie = pieEq; });
    const els = [...lista.querySelectorAll('.pl-slide, .p1-detalle, .ficha-detalle')].filter(el => incluirPend || !el.closest('.pl-pendiente'));
    if (!els.length) return;
    pdfBtn.disabled = true; pdfBtn.textContent = 'Generando PDF…';
    try { await exportFichasAsPDF(els, `${plVista.teamKey}-${String(temporada).replace(/\//g, '-')}.pdf`); }
    catch (err) { showError('No se pudo generar el PDF: ' + err.message); }
    finally { pdfBtn.disabled = false; pdfBtn.textContent = '⬇ PDF del equipo'; }
  });
}

const RENDERERS = {
  inicio:     renderPanelInicio,
  importar:   renderPanelImportar,
  registro:   renderPanelRegistro,
  jugadores:  renderPanelJugadores,
  plantillas: renderPanelPlantillas,
  sucesion:   renderPanelSucesion,
  fichas:     renderPanelFichas,
  config:     renderPanelConfig,
};

// ── RENDERIZAR MAIN ───────────────────────────────

function renderMain() {
  const main = document.getElementById('rm-main');
  main.innerHTML = '';

  TABS.forEach(tab => {
    const panel = document.createElement('div');
    panel.className = 'tab-panel' + (tab.key !== state.activeTab ? ' hidden' : '');
    panel.dataset.tab = tab.key;
    main.appendChild(panel);

    const render = RENDERERS[tab.key];
    if (render) render(panel);
  });
}

// ── EVENTOS GLOBALES ─────────────────────────────

function setupEvents() {
  document.addEventListener('rm:tab-changed', e => {
    const tabKey = e.detail;
    const panel  = document.querySelector(`.tab-panel[data-tab="${tabKey}"]`);
    if (!panel) return;

    const render = RENDERERS[tabKey];
    if (render) render(panel);
  });

  document.addEventListener('rm:thresholds-changed', () => {
    const wrap = document.querySelector('#fichas-tipo-wrap');
    if (wrap) renderPanelFichas(wrap, fichaTipoPosition);
  });

  document.addEventListener('rm:criteria-changed', () => {
    const wrap = document.querySelector('#fichas-tipo-wrap');
    if (wrap) renderPanelFichas(wrap, fichaTipoPosition);
  });
}

// ── BOOT ─────────────────────────────────────────

// ── LOGIN (Firebase Auth) ─────────────────────────
// Overlay aparte de #app — no toca el HTML existente. Mientras no hay
// usuario, #app queda oculto; al autenticarse se arranca el resto tal cual.

function ensureLoginOverlay() {
  let el = document.getElementById('rm-login-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rm-login-overlay';
    document.body.appendChild(el);
  }
  return el;
}

function showLogin() {
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
  const overlay = ensureLoginOverlay();
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:linear-gradient(160deg, var(--blue-600), var(--blue-400));font-family:var(--font-sans);padding:16px;';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:40px 36px;width:100%;max-width:380px;text-align:center;">
      <img src="${LOGO_PATH}" alt="" style="width:80px;height:80px;object-fit:contain;margin:0 auto 16px;display:block;" />
      <div style="font-size:22px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">${safeText(state.appName)}</div>
      <div style="font-size:13px;color:var(--blue-500);margin-bottom:24px;">Real Madrid · Cantera</div>
      <div style="text-align:left;">
        <div class="field-group mb-16"><input class="input" type="email" id="login-email" placeholder="Email" autocomplete="username" style="width:100%;" /></div>
        <div class="field-group mb-16"><input class="input" type="password" id="login-password" placeholder="Contraseña" autocomplete="current-password" style="width:100%;" /></div>
      </div>
      <p class="text-xs mb-16" id="login-error" style="display:none;color:#ef4444;text-align:left;"></p>
      <button class="btn btn-primary" id="login-btn" style="width:100%;">Iniciar sesión</button>
      <div style="margin-top:16px;">
        <a href="#" id="login-forgot" style="color:var(--blue-500);font-size:13px;">¿Olvidaste tu contraseña?</a>
      </div>
    </div>
  `;
  const doLogin = async () => {
    const email = overlay.querySelector('#login-email').value.trim();
    const password = overlay.querySelector('#login-password').value;
    const errEl = overlay.querySelector('#login-error');
    errEl.style.display = 'none';
    if (!email || !password) { errEl.textContent = 'Rellena email y contraseña.'; errEl.style.display = 'block'; return; }
    try {
      await login(email, password);
    } catch (err) {
      console.error('[Auth] Login fallido:', err);
      errEl.textContent = 'Email o contraseña incorrectos.';
      errEl.style.display = 'block';
    }
  };
  overlay.querySelector('#login-btn').addEventListener('click', doLogin);
  overlay.querySelector('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  overlay.querySelector('#login-forgot').addEventListener('click', async e => {
    e.preventDefault();
    const email = overlay.querySelector('#login-email').value.trim();
    if (!email) { showError('Escribe tu email arriba primero.'); return; }
    try {
      await resetPassword(email);
      showSuccess('Te hemos enviado un email para restablecer la contraseña.');
    } catch (err) {
      console.error('[Auth] No se pudo enviar el email de recuperación:', err);
      showError('No se pudo enviar el email (revisa que sea correcto).');
    }
  });
}

function hideLogin() {
  const overlay = document.getElementById('rm-login-overlay');
  if (overlay) overlay.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.style.display = '';
}

let _appBooted = false;

async function boot() {
  initFirebase();
  watchAuthState(async user => {
    if (!user) { showLogin(); return; }
    hideLogin();
    if (_appBooted) return; // ya está montado — no se repite en cada evento de auth
    _appBooted = true;

    await loadConfigFromFirestore(); // trae Configuración guardada antes de pintar
    await loadPlayersFromFirestore(); // trae la lista de jugadores

    renderFooter();
    renderHeader();
    renderTabs();
    renderMain();
    setupEvents();
  });
}

document.addEventListener('DOMContentLoaded', boot);
