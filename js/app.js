// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase, addDocument, updateDocument, deleteDocument, addSubDocument, readSubCollection, uploadPlayerPhoto } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { watchAuthState, login, resetPassword } from './auth-service.js';
import { crearEvaluacion, actualizarEvaluacion, eliminarEvaluacion, listarEvaluaciones, queryRegistros, crearRegistro, actualizarRegistro } from './evaluaciones-service.js';
import { matchJugador } from './import-matching.js';
import { calcularMediasPorJugador, calcularMediaGrupo, buildAspectoPorCompetencia } from './medias.js';
import { parseCSV, parseXLSXBuffer, parseEsNumber, buildRowKey, clasificarFilas } from './importar-csv.js';
import { renderHeader }  from './render-header.js';
import { renderTabs } from './render-tabs.js';
import { renderFooter }  from './render-footer.js';
import { TABS, LOGO_PATH, TEAMS, FICHA2_OFFICIAL_DIMENSIONS, PROFILES } from './constants.js';
import { state, setState, DEFAULT_FICHA_COLORS, loadConfigFromFirestore, loadPlayersFromFirestore } from './state.js';
import { renderFichaDetalle, setGpsTolerance } from './ficha-detalle.js';
import { renderFichaPagina1 } from './ficha-pagina1.js';
import { FICHA1_DEMO_DATA }   from './ficha-pagina1-demo-data.js';
import { exportFichaAsPDF } from './pdf-export.js';
import { showError, showSuccess, safeText } from './utils.js';
import { renderFichasEspejo } from './ficha-espejo-ui.js';
import { buildCatalogo, slugify } from './ficha-espejo.js';

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

let bbddFiltros  = { temporada: '', evaluacionId: '', jugadorId: '', posicionKey: '', evaluador: '', vista: 'todo' };
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

function buildFichaRealData(positionKey, media, jugador) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const comp = media?.porCompetencia || {};
  const rated = list => (list || []).map(label => ({ label, value: comp[label] ?? null }));
  // Condicional: el mapeo de import permite dos columnas por item (valor 1/2,
  // ver importar-csv.js) — valueB llega como `${label}__B` si se mapeó.
  const condicional = (state.aspectosComunes.condicional || []).map(label => {
    const ref = state.condicionalRefs?.[positionKey]?.[label] || {};
    return { label, valueA: comp[label] ?? null, valueB: comp[`${label}__B`] ?? null, refA: ref.col3 ?? null, refB: ref.col4 ?? null };
  });
  return {
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

function buildFicha1RealData(positionKey, media, jugador) {
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
    return { label: nombre, color: bandKeyForValue(mediaPerfil, state.scoreBands) };
  });

  return {
    ...FICHA1_DEMO_DATA,
    player: {
      ...FICHA1_DEMO_DATA.player,
      name: jugador ? `${jugador.nombre} ${jugador.apellidos}`.trim() : 'Jugador',
      position: positionLabel,
      photoUrl: jugador?.fotoUrl || null,
      heightOk: null,
    },
    statusBars: statusBars.length ? statusBars : FICHA1_DEMO_DATA.statusBars,
    personalidad: {
      col1: mental.slice(0, mid).map(withStatus),
      col2: mental.slice(mid).map(withStatus),
    },
    competenciasOfensivas: orderByTactico(schema.competenciasOfensivas).map(withStatus),
    competenciasDefensivas: orderByTactico(schema.competenciasDefensivas).map(withStatus),
    frasesModelo: state.frasesModelo,
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
    const colsFijas = regImport.headers.slice(0, 6);
    const colsLibres = regImport.headers.slice(6);
    const etiquetaFija = [
      'Fecha y hora', 'Evaluador', 'Jugador',
      `Perfil: ${perfiles[0] || '(sin definir)'}`,
      `Perfil: ${perfiles[1] || '(sin definir)'}`,
      `Perfil: ${perfiles[2] || '(sin definir)'}`,
    ];
    const optionsFor = header => {
      const sel = regImport.mapping[header] || '';
      return [
        `<option value="">— Ignorar columna —</option>`,
        `<option value="equipo" ${sel === 'equipo' ? 'selected' : ''}>Equipo (opcional — ayuda a identificar al jugador)</option>`,
        ...competencias.flatMap(c => aspectoPorCompetencia[c] === 'condicional' ? [
          `<option value="${safeText(c)}::A" ${sel === c + '::A' ? 'selected' : ''}>Condicional: ${safeText(c)} — valor 1</option>`,
          `<option value="${safeText(c)}::B" ${sel === c + '::B' ? 'selected' : ''}>Condicional: ${safeText(c)} — valor 2</option>`,
        ] : [
          `<option value="${safeText(c)}" ${sel === c ? 'selected' : ''}>Competencia: ${safeText(c)} (${safeText(aspectoPorCompetencia[c])})</option>`,
        ]),
      ].join('');
    };
    body = `
      <p class="text-xs text-muted mb-16">${regImport.rows.length} filas leídas. Sin cabecera: columnas 1-6 fijas (fecha, evaluador, jugador, 3 perfiles de ${safeText(posLabel)}). Columnas 7+: indica qué competencia es cada una.</p>
      <div style="overflow-x:auto;">
        <table class="table table-compact mb-16">
          <thead><tr><th>Columna</th><th>Ejemplo</th><th>Es</th></tr></thead>
          <tbody>
            ${colsFijas.map((h, i) => `
              <tr>
                <td>${safeText(h)}</td>
                <td class="text-muted">${safeText(regImport.rows[0]?.[h] ?? '')}</td>
                <td>${safeText(etiquetaFija[i])}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${colsLibres.length ? `
      <div style="overflow-x:auto;">
        <table class="table table-compact">
          <thead><tr><th>Columna del archivo</th><th>Ejemplo</th><th>Se importa como</th></tr></thead>
          <tbody>
            ${colsLibres.map(h => `
              <tr>
                <td>${safeText(h)}</td>
                <td class="text-muted">${safeText(regImport.rows[0]?.[h] ?? '')}</td>
                <td><select class="select" data-map-col="${safeText(h)}">${optionsFor(h)}</select></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : ''}
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

function buildResumenImportHTML(r) {
  if (!r) return '';
  const pendHTML = regImport.pendientes.length ? `
    <div class="mb-16">
      <div class="text-xs text-muted mb-8" style="font-weight:700;text-transform:uppercase;">Pendientes de identificar (${regImport.pendientes.length})</div>
      <table class="table table-compact">
        <thead><tr><th>Nombre en archivo</th><th>Evaluador</th><th>Asignar a</th></tr></thead>
        <tbody>
          ${regImport.pendientes.map((f, i) => `
            <tr>
              <td>${safeText(f.jugadorNombreArchivo)}</td>
              <td>${safeText(f.evaluador)}</td>
              <td>
                <select class="select" data-pend-select="${i}">
                  <option value="">— Ignorar esta fila —</option>
                  ${(f.matchCandidates || []).map(c => `<option value="${c.id}">${safeText(c.nombre)} ${safeText(c.apellidos)}</option>`).join('')}
                </select>
              </td>
            </tr>
          `).join('')}
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
  // Contrato fijo (sin cabecera): 1=fecha, 2=evaluador, 3=jugador, 4-6=perfiles.
  const colFecha = 'Columna 1', colEvaluador = 'Columna 2', colJugador = 'Columna 3';
  const colPerfiles = ['Columna 4', 'Columna 5', 'Columna 6'];
  const colEquipo = Object.keys(regImport.mapping).find(h => regImport.mapping[h] === 'equipo');
  const teamKeyPorLabel = raw => TEAMS.find(t => t.label.toLowerCase().trim() === String(raw || '').toLowerCase().trim())?.key || null;

  const filas = regImport.rows.map(row => {
    const jugadorNombreArchivo = (row[colJugador] || '').trim();
    const evaluador = (row[colEvaluador] || '').trim();
    const fechaRegistro = (row[colFecha] || '').trim() || null;
    if (!jugadorNombreArchivo || !evaluador) {
      return { error: 'Falta jugador o evaluador', jugadorNombreArchivo, evaluador };
    }
    const puntuaciones = {};
    const puntuacionesId = {};
    let invalido = false;

    colPerfiles.forEach((col, i) => {
      const nombre = perfiles[i];
      if (!nombre) return;
      const raw = row[col];
      if (raw === '' || raw == null) return;
      const val = parseEsNumber(raw);
      if (val == null) { invalido = true; return; }
      puntuaciones[nombre] = val;
      if (idPorClave[nombre]) puntuacionesId[idPorClave[nombre]] = val;
    });

    Object.entries(regImport.mapping).forEach(([header, target]) => {
      if (!target || target === 'equipo') return;
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
      return { jugadorNombreArchivo, evaluador, puntuaciones, puntuacionesId, fechaRegistro, matchStatus: match.status, matchCandidates: match.candidates };
    }
    const jugadorId = match.playerId;
    const rowKey = buildRowKey({ evaluacionId: ev.id, jugadorId, jugadorNombreArchivo, evaluador });
    return { jugadorNombreArchivo, evaluador, puntuaciones, puntuacionesId, fechaRegistro, jugadorId, rowKey };
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
    regImport.headers = parsed.headers;
    regImport.rows = parsed.rows;
    regImport.mapping = {};
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
    procesarImport(container);
  });

  container.querySelectorAll('[data-decision]').forEach(sel => {
    sel.addEventListener('change', () => { regImport.decisiones[sel.dataset.decision] = sel.value; });
  });

  container.querySelector('#import-aplicar-pendientes')?.addEventListener('click', async () => {
    const resueltos = [];
    const restantes = [];
    const aliasUpdates = new Map(); // playerId -> Set(nombres del archivo)
    regImport.pendientes.forEach((f, i) => {
      const sel = container.querySelector(`[data-pend-select="${i}"]`);
      const playerId = sel?.value || '';
      if (!playerId) { restantes.push(f); return; }
      const rowKey = buildRowKey({ evaluacionId: regEvalSel, jugadorId: playerId, jugadorNombreArchivo: f.jugadorNombreArchivo, evaluador: f.evaluador });
      resueltos.push({ jugadorNombreArchivo: f.jugadorNombreArchivo, evaluador: f.evaluador, puntuaciones: f.puntuaciones, puntuacionesId: f.puntuacionesId, fechaRegistro: f.fechaRegistro, jugadorId: playerId, rowKey });
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
          puntuaciones: fila.puntuaciones, puntuacionesId: fila.puntuacionesId || {}, fechaRegistro: fila.fechaRegistro || null, rowKey: fila.rowKey, origen: 'csv',
        });
      }
      let sustituidos = 0;
      for (const fila of r.conCambios) {
        if ((regImport.decisiones[fila.rowKey] || 'mantener') === 'reemplazar') {
          await actualizarRegistro(fila.existente.id, {
            puntuaciones: fila.puntuaciones, puntuacionesId: fila.puntuacionesId || {}, jugadorNombreArchivo: fila.jugadorNombreArchivo, evaluador: fila.evaluador,
            fechaRegistro: fila.fechaRegistro || null,
          });
          sustituidos++;
        }
      }
      showSuccess(`Importado: ${r.nuevos.length} nuevos, ${sustituidos} sustituidos.`);
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

function buildBBDDResultadosHTML() {
  if (!bbddResultado) return '<p class="text-xs text-muted">Aplica filtros y pulsa Buscar.</p>';
  const { registros, mediasPorJugador } = bbddResultado;
  if (!registros.length) return '<p class="text-xs text-muted">Sin registros para estos filtros.</p>';

  const jugadorLabel = id => {
    const p = state.players.find(x => x.id === id);
    return p ? `${p.nombre} ${p.apellidos}` : '(sin identificar)';
  };

  if (bbddFiltros.vista === 'individuales') {
    const rows = registros.map(r => `
      <tr><td>${safeText(jugadorLabel(r.jugadorId))}</td><td>${safeText(r.evaluador)}</td><td>${Object.keys(r.puntuaciones || {}).length} valores</td></tr>
    `).join('');
    return `<table class="table table-compact"><thead><tr><th>Jugador</th><th>Evaluador</th><th>Datos</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const porJugador = {};
  registros.forEach(r => { if (r.jugadorId) (porJugador[r.jugadorId] = porJugador[r.jugadorId] || []).push(r); });

  const rows = Object.entries(mediasPorJugador).map(([jugadorId, media]) => {
    const general = mediaGeneralDe(media);
    const detalle = bbddFiltros.vista === 'todo' ? `
      <tr><td colspan="4" style="padding-left:32px;">
        ${(porJugador[jugadorId] || []).map(r => `<div class="text-xs text-muted">${safeText(r.evaluador)}: ${Object.entries(r.puntuaciones || {}).map(([k, v]) => `${safeText(k)}=${v}`).join(', ')}</div>`).join('')}
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
    <div class="card mb-16">
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
              <option value="individuales" ${bbddFiltros.vista === 'individuales' ? 'selected' : ''}>Solo registros individuales</option>
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
      // Equipo/generación no viven en 'registros' — se acotan aquí, pero
      // SOLO sobre el subconjunto ya filtrado por Firestore, no la colección entera.
      const registrosFiltrados = registros.filter(r => {
        if (!r.jugadorId) return false;
        const jugador = state.players.find(p => p.id === r.jugadorId);
        if (!jugador) return false;
        if (compFiltros.equipo && jugador.teamKey !== compFiltros.equipo) return false;
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
    <div class="mb-16 flex gap-8">
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
        <div class="flex gap-12 mb-16" style="align-items:center;">
          <img id="jug-foto-preview" src="${p.fotoUrl || ''}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--bg-hover);display:${p.fotoUrl ? 'block' : 'none'};" />
          <div class="field-group">
            <label class="label">Foto</label>
            <input class="input" type="file" id="jug-foto" accept="image/*" />
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
        <div class="text-xs text-muted mt-16 mb-8" style="font-weight:700;text-transform:uppercase;">Datos condicionales (un valor por evaluación)</div>
        ${(regEvaluaciones || []).length ? `
        <div class="field-group mb-8" style="min-width:260px;max-width:360px;">
          <label class="label">Evaluación</label>
          <select class="select" id="jug-cond-eval">${regEvaluaciones.map((e, i) => `<option value="${e.id}" ${i === 0 ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
        </div>
        <div class="flex gap-12" style="flex-wrap:wrap;">
          ${state.aspectosComunes.condicional.map(item => `
            <div class="field-group" style="min-width:120px;">
              <label class="label">${safeText(item)}</label>
              <input class="input" type="text" inputmode="decimal" data-jug-cond="${safeText(slugify(item))}" value="" />
            </div>`).join('')}
        </div>` : '<p class="text-xs text-muted">Crea primero una evaluación (Registro de datos) para poder guardar datos condicionales.</p>'}` : ''}
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
    <div class="card mb-16"><div class="card-body">
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

let jugFichaTab = 'datos';     // 'datos' | 'ficha1' | 'ficha2'
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
  const filasEval = filas.filter(f => f.eid !== 'sin-evaluacion' && f.ev);
  const evSel = filasEval.find(f => f.eid === jugFichaEvalId) || filasEval[0] || null; // por defecto, la final

  // ── Pestaña "Datos personales"
  const items = state.aspectosComunes.condicional || [];
  const porEval = p.condicionalPorEval || {};
  const evCond = Object.keys(porEval).filter(eid => Object.keys(porEval[eid] || {}).length);
  const condHTML = evCond.length ? `
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Evaluación</th>${items.map(i => `<th>${safeText(i)}</th>`).join('')}</tr></thead>
      <tbody>${evCond.map(eid => `<tr><td>${safeText(evLabel(eid))}</td>${items.map(i => `<td>${safeText(porEval[eid][slugify(i)] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
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
  const fichaTabHTML = !regs ? '<p class="text-xs text-muted">Cargando…</p>'
    : !evSel ? '<p class="text-xs text-muted">Este jugador no tiene evaluaciones importadas todavía.</p>'
    : `
      <div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
        <label class="text-xs text-muted" for="jug-ficha-eval">Evaluación</label>
        <select class="select" id="jug-ficha-eval" style="max-width:360px;">
          ${filasEval.map((f, i) => `<option value="${f.eid}" ${f.eid === evSel.eid ? 'selected' : ''}>${safeText(evLabel(f.eid))}${i === 0 ? ' — final' : ''}</option>`).join('')}
        </select>
      </div>
      <div id="jug-ficha-wrap" class="ficha-wrap"></div>`;

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="flex gap-8 mb-16">
      <button class="btn btn-ghost" id="jug-ficha-volver">← Volver a la lista</button>
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
      <button class="btn ${jugFichaTab === 'ficha1' ? 'btn-primary' : 'btn-sm'}" data-jug-tab="ficha1">Ficha 1</button>
      <button class="btn ${jugFichaTab === 'ficha2' ? 'btn-primary' : 'btn-sm'}" data-jug-tab="ficha2">Ficha 2</button>
    </div>
    ${jugFichaTab === 'datos' ? datosHTML : fichaTabHTML}
  `;

  if (jugFichaTab !== 'datos' && evSel) {
    const wrap = container.querySelector('#jug-ficha-wrap');
    if (jugFichaTab === 'ficha1') {
      renderFichaPagina1(wrap, buildFicha1RealData(evSel.posKey, evSel.media, p), LOGO_PATH, state.fichaColors);
    } else {
      setGpsTolerance(state.condicionalTolerance);
      renderFichaDetalle(wrap, buildFichaRealData(evSel.posKey, evSel.media, p), LOGO_PATH, state.scoreBands, undefined, state.fichaColors, state.fichaGridOrder);
    }
  }

  container.querySelectorAll('[data-jug-tab]').forEach(btn => btn.addEventListener('click', () => {
    jugFichaTab = btn.dataset.jugTab;
    preservandoScroll(() => renderPanelJugadores(container));
  }));
  container.querySelector('#jug-ficha-eval')?.addEventListener('change', e => {
    jugFichaEvalId = e.target.value;
    preservandoScroll(() => renderPanelJugadores(container));
  });
  container.querySelector('#jug-ficha-volver')?.addEventListener('click', () => { jugFichaId = null; renderPanelJugadores(container); });
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
        <td>${safeText(p.nombre || '')}</td>
        <td>${safeText(p.apellidos || '')}</td>
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
    btn.addEventListener('click', async () => {
      await cargarEvaluacionesSilencioso();
      jugFichaId = btn.dataset.jugFicha;
      jugFichaTab = 'datos';
      jugFichaEvalId = null; // por defecto, evaluación final
      renderPanelJugadores(container);
    });
  });

  // Vista previa de la foto al elegir el archivo (antes no pasaba nada hasta guardar)
  container.querySelector('#jug-foto')?.addEventListener('change', e => {
    const f = e.target.files[0];
    const prev = container.querySelector('#jug-foto-preview');
    if (!f || !prev) return;
    prev.src = URL.createObjectURL(f);
    prev.style.display = 'block';
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
  const condDraft = JSON.parse(JSON.stringify((jugadorFormId !== 'new' && editingPlayer?.condicionalPorEval) || {}));
  let condEvalActual = condSel?.value || null;
  const condVolcar = () => { // inputs → borrador de la evaluación actual
    if (!condEvalActual) return;
    condDraft[condEvalActual] = condDraft[condEvalActual] || {};
    condInputs.forEach(inp => {
      const raw = inp.value.trim();
      if (raw === '') delete condDraft[condEvalActual][inp.dataset.jugCond];
      else condDraft[condEvalActual][inp.dataset.jugCond] = raw; // se valida al guardar
    });
  };
  const condCargar = () => { // borrador → inputs
    condInputs.forEach(inp => { inp.value = condDraft[condEvalActual]?.[inp.dataset.jugCond] ?? ''; });
  };
  if (condSel) condCargar();
  condSel?.addEventListener('change', () => { condVolcar(); condEvalActual = condSel.value; condCargar(); });

  container.querySelector('#jug-save')?.addEventListener('click', async () => {
    let condicionalPorEval = null;
    if (condSel) {
      condVolcar();
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
    const fotoFile = container.querySelector('#jug-foto').files[0] || null;
    if (!baseData.nombre) { showError('El nombre es obligatorio.'); return; }

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

      if (changedHistorico && !isFirebaseUnconfigured()) {
        await addSubDocument('jugadores', id, 'historico', historicoData);
        delete jugadorHistoricoCache[id]; // se recarga la próxima vez que se abra
      }

      if (fotoFile && !isFirebaseUnconfigured()) {
        try {
          const fotoUrl = await uploadPlayerPhoto(id, fotoFile);
          await updateDocument('jugadores', id, { fotoUrl });
          setState({ players: state.players.map(p => p.id === id ? { ...p, fotoUrl } : p) });
        } catch (err) {
          console.error('[Storage] No se pudo subir la foto:', err);
          showError(`Jugador guardado, pero la foto no se pudo subir [${err?.code || err?.message || 'error desconocido'}]. Revisa Firebase Storage (activado y reglas publicadas).`, 9000);
        }
      }

      showSuccess(isNew ? 'Jugador añadido.' : 'Jugador actualizado.');
      jugadorFormId = null;
      renderPanelJugadores(container);
    } catch (err) {
      console.error('[Firestore] No se pudo guardar el jugador:', err);
      showError('No se pudo guardar el jugador (revisa las reglas de Firestore o la conexión).');
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

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="mb-16" style="border-bottom:1px solid var(--border-default);padding-bottom:8px;">
      ${CONFIG_GROUPS.map(g => `
        <div class="flex gap-8 mb-8" style="align-items:center;flex-wrap:wrap;">
          <span class="text-xs text-muted" style="width:112px;flex-shrink:0;font-weight:700;text-transform:uppercase;">${g.label}</span>
          ${g.tabs.map(t => `
            <button class="btn ${t.key === configSubTab ? 'btn-primary' : 'btn-sm'}" data-config-subtab="${t.key}">${t.label}</button>
          `).join('')}
        </div>
      `).join('')}
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

const RENDERERS = {
  inicio:     renderPanelInicio,
  importar:   renderPanelImportar,
  registro:   renderPanelRegistro,
  jugadores:  renderPanelJugadores,
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
