// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase, setWriteGuard, setAfterWrite, addDocument, updateDocument, deleteDocument, addSubDocument, readSubCollection, readCollection, saveDocument, readDocument, updateMapEntry, arrayUnion, arrayRemove } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { watchAuthState, login, logout, resetPassword, tokenActual } from './auth-service.js';
import { cargarPerfil, tabsVisibles, nivel, puedeVer, puedeEditar, esSuperadmin, perfilActual, SUBPANTALLAS } from './permisos-service.js';
import { renderPanelAdmin } from './admin-panel.js';
import { exportarJugador, borrarJugadorCompleto } from './rgpd.js';
import { iniciarAuditoria, auditar, exigirDobleFactor, exigirPrivacidad, exigirAcceso, iniciarInactividad, mensajeCierre } from './seguridad.js';
import { leerTablaJugadores, CAMPO_LABEL, descargarPlantilla, campoDeCabecera } from './importar-jugadores.js';
import { leerFilas, filasDesdeTexto, leerTablaCondicional } from './importar-condicional.js';
import { abrirEditorFoto } from './foto-editor.js';
import { crearEvaluacion, actualizarEvaluacion, eliminarEvaluacion, listarEvaluaciones, queryRegistros, crearRegistro, actualizarRegistro, eliminarRegistro } from './evaluaciones-service.js';
import { matchJugador } from './import-matching.js';
import { calcularMediasPorJugador, calcularMediaGrupo, buildAspectoPorCompetencia } from './medias.js';
import { parseCSV, parseXLSXBuffer, parseEsNumber, buildRowKey, clasificarFilas } from './importar-csv.js';
import { renderHeader }  from './render-header.js';
import { renderTabs, switchTab } from './render-tabs.js';
import { preguntasDeCabecera, comprobarPorBloques } from './comprobar-columnas.js';
import { renderFooter }  from './render-footer.js';
import { TABS, LOGO_PATH, TEAMS, FICHA2_OFFICIAL_DIMENSIONS, PROFILES, CONDICIONAL_BASE, esEquipoBase } from './constants.js';
import { state, setState, DEFAULT_FICHA_COLORS, loadConfigFromFirestore, loadPlayersFromFirestore } from './state.js';
import { renderFichaDetalle, setGpsTolerance, condicionalScore, condicionalBaseScore, fitFichaToFrame } from './ficha-detalle.js';
import { renderFichaPagina1 } from './ficha-pagina1.js';
import { FICHA1_DEMO_DATA }   from './ficha-pagina1-demo-data.js';
import { exportFichaAsPDF, exportFichasAsPDF } from './pdf-export.js';
import { showError, showSuccess, safeText, fmtDec } from './utils.js';
import { renderFichasEspejo } from './ficha-espejo-ui.js';
import { buildCatalogo, slugify } from './ficha-espejo.js';
import { quitarCabeceras, normalizarFechas, mapeoPorDefecto, columnasEfectivas, TEXTOS_DESTINOS, RP_DESTINOS, EXTRAS_DESTINOS } from './importar-plantilla.js';
import { renderColumnasEncuesta } from './columnas-encuesta-ui.js';
import { renderEvaluadores, tituloEvaluador, infoEvaluador } from './evaluadores-ui.js';

// ── EVITAR SALTO DE SCROLL AL RE-RENDERIZAR ───────
// Reemplazar innerHTML de un panel entero resetea el scroll del navegador.
// Se usa en botones que re-renderizan paneles grandes (Fichas tipo, etc.)
// para que el usuario no "suba" solo por cambiar de posición/página.
function preservandoScroll(fn) {
  const y = window.scrollY;
  // Fija la altura mientras se repinta (si no, el navegador recorta el scroll y la pantalla "salta"), y restaura el scroll sin esperar al siguiente frame.
  const b = document.body;
  const prevMin = b.style.minHeight;
  b.style.minHeight = `${document.documentElement.scrollHeight}px`;
  fn();
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
    requestAnimationFrame(() => { window.scrollTo(0, y); b.style.minHeight = prevMin; });
  });
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
    <div class="card" style="min-height:60vh;display:flex;align-items:center;justify-content:center;text-align:center;">
      <div style="padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:560px;">
        <div aria-hidden="true" style="font-size:64px;line-height:1;">🚧</div>
        <div style="font-size:30px;font-weight:800;">Líneas de sucesión</div>
        <div style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:6px 16px;font-weight:800;letter-spacing:1px;font-size:13px;">PRÓXIMAMENTE</div>
        <p class="text-muted" style="font-size:15px;margin:0;">Estamos preparando esta sección. Muy pronto estará disponible.</p>
      </div>
    </div>
  `;
}

let registroSubTab = localStorage.getItem('rm-registro-subtab') || 'registro'; // 'registro' | 'bbdd'

// ── PERMISOS POR SUBPANTALLA ─────────────────────
// La subpantalla actual si el usuario puede verla; si no, la primera que sí.
const subVisible = (tab, actual) => puedeVer(`${tab}.${actual}`) ? actual
  : (SUBPANTALLAS[tab].find(x => puedeVer(`${tab}.${x.key}`))?.key ?? actual);
// Clave de permiso de lo que se está viendo ahora ('config.items', 'jugadores.lista', 'sucesion'…).
function pantallaActual() {
  const t = state.activeTab;
  if (t === 'registro') return `registro.${registroSubTab}`;
  if (t === 'config') return `config.${configSubTab}`;
  if (t === 'plantillas') return `plantillas.${plVista.modo}`;
  if (t === 'jugadores') return jugFichaId ? `jugadores.${jugFichaTab}` : 'jugadores.lista';
  return t;
}
// Aviso "Solo lectura" en la pestaña activa según la subpantalla que se ve.
function actualizarSoloLectura() {
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('solo-lectura', p.dataset.tab === state.activeTab && nivel(pantallaActual()) === 'ver');
  });
}

// ── REGISTRO DE DATOS: contexto de evaluación, import CSV y BBDD ──
// Colecciones nuevas 'evaluaciones' y 'registros' (evaluaciones-service.js).
// No toca 'jugadores' ni 'config'. Ver auditoría 15 puntos.

let regEvaluaciones  = null;  // cache; null = no cargado aún, [] = cargado y vacío
let regEvalFormOpen  = false;
let regEvalEditId    = null;  // id de la evaluación que se está editando (null = alta nueva)
let regEvalSel       = null;  // id de la evaluación activa para importar
let regImport        = null;  // estado del wizard de importación (ver resetRegImport)
let regHuerfanos     = null;  // { res: {registros, mediasPorJugador} } registros cuya evaluación ya no existe
let regVer           = null;  // { evId, res: { registros, mediasPorJugador } | null } registros desplegados en una tarjeta

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

// Alevines e infantiles: el bloque Condicional son capacidades con símbolo puesto a mano, por evaluación
// (jugadores/{id}.condicionalBasePorEval[evaluación] = { slug: 'ok' | 'dash' | 'fail' }).
const SIMBOLO_TXT = { ok: '✔', dash: '▬', fail: '✘' };
function condicionalBaseItems(jugador, evKey) {
  const m = jugador?.condicionalBasePorEval?.[evKey] || {};
  return CONDICIONAL_BASE.map(label => ({ label, key: slugify(label), simbolo: m[slugify(label)] || '' }));
}
async function guardarCondicionalBase(j, evKey, mapa) {
  const prev = { condicionalBasePorEval: JSON.parse(JSON.stringify(j.condicionalBasePorEval || {})) };
  const todo = { ...(j.condicionalBasePorEval || {}), [evKey]: mapa };
  j.condicionalBasePorEval = todo;
  const enEstado = state.players.find(x => x.id === j.id);
  if (enEstado && enEstado !== j) enEstado.condicionalBasePorEval = todo;
  try {
    await updateMapEntry('jugadores', j.id, 'condicionalBasePorEval', evKey, mapa);
    await registrarCambios(j.id, prev, { condicionalBasePorEval: todo });
  } catch (err) { console.error(err); showError('No se pudo guardar el dato condicional.'); }
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
  const base = esEquipoBase(jugador?.teamKey);
  const evKey = evalId || 'sin-evaluacion';
  const condicional = base ? condicionalBaseItems(jugador, evKey) : condicionalItems(positionKey, comp, jugador, evalId);
  return {
    ref: ref || null,
    onBase: base && jugador?.id ? (mapa => guardarCondicionalBase(jugador, evKey, mapa)) : null,
    manual: jugador?.fichaNotasManuales?.[evalId || 'sin-evaluacion'] || null,
    onManual: jugador?.id ? (mapa => guardarNotasManuales(jugador, evalId || 'sin-evaluacion', mapa)) : null,
    player: { name: jugador ? `${jugador.nombre} ${jugador.apellidos}`.trim() : 'Jugador', photoUrl: jugador?.fotoUrl || null },
    blocks: {
      mental:      { rp: [null, null], items: rated(state.aspectosComunes.mental) },
      tecnico:     { rp: [null, null], items: rated(schema.tecnico ?? state.aspectosComunes.tecnico) },
      tactico:     { rp: [null, null], items: rated(schema.tactico) },
      condicional: { rp: null,         items: condicional, base },
    },
    plan: (() => { // Plan de acción guardado (por evaluación); si no hay, 7 filas vacías por columna
      const g = jugador?.fichaTextos?.[evKey]?.plan || {};
      const col = k => Array.from({ length: 7 }, (_, i) => g[k]?.[i] || '');
      return { tecnico: col('tecnico'), tactico: col('tactico'), condicional: col('condicional'), mental: col('mental') };
    })(),
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
    condicional: hexMedia(esEquipoBase(jugador?.teamKey)
      ? condicionalBaseScore(condicionalBaseItems(jugador, evalId || 'sin-evaluacion'))
      : condicionalScore(condicionalItems(positionKey, comp, jugador, evalId), state.condicionalTolerance)),
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
    ...(aspectos ? { aspectosOfensivos: aspectos.ofensivos, aspectosDefensivos: aspectos.defensivos, description: aspectos.desc || '' } : {}),
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

let evPosMigrando = false;
const evPosIntentadas = new Set(); // una vez por sesión cada evaluación (si falla no se reintenta en bucle)
async function ensureEvaluacionesLoaded(container) {
  if (regEvaluaciones !== null) {
    // Ya cargadas desde otra pestaña: si queda alguna antigua con posición, se pasa a todas las posiciones.
    if (!evPosMigrando && !isFirebaseUnconfigured() && regEvaluaciones.some(e => e.posicionKey && !evPosIntentadas.has(e.id)) && puedeEditar('registro.registro')) {
      evPosMigrando = true;
      await evaluacionesParaTodasLasPosiciones();
      evPosMigrando = false;
      if (container.isConnected) renderPanelRegistro(container);
    }
    return;
  }
  if (isFirebaseUnconfigured()) { regEvaluaciones = []; return; }
  try {
    regEvaluaciones = await listarEvaluaciones();
    await evaluacionesParaTodasLasPosiciones();
  } catch (err) {
    console.error('[Firestore] No se pudieron cargar las evaluaciones:', err);
    regEvaluaciones = [];
    showError('No se pudieron cargar las evaluaciones.');
  }
  renderPanelRegistro(container);
}

// Una evaluación es un periodo para TODAS las posiciones. Las antiguas que quedaron marcadas con una posición
// se pasan solas: antes, cada registro suyo sin posición se queda con la de la evaluación (no se pierde nada).
async function evaluacionesParaTodasLasPosiciones() {
  if (!puedeEditar('registro.registro')) return;
  for (const ev of (regEvaluaciones || []).filter(e => e.posicionKey && !evPosIntentadas.has(e.id))) {
    evPosIntentadas.add(ev.id);
    try {
      const regs = await queryRegistros({ evaluacionId: ev.id });
      for (const r of regs.filter(r => !r.posicionKey)) await actualizarRegistro(r.id, { posicionKey: ev.posicionKey });
      await actualizarEvaluacion(ev.id, { posicionKey: null });
      ev.posicionKey = null;
    } catch (err) { console.error('[Evaluaciones] No se pudo pasar a todas las posiciones:', ev.id, err); }
  }
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
  if (!regEvaluaciones.length) return '<p class="text-xs text-muted">Sin evaluaciones todavía. Crea una para empezar a importar encuestas.</p>';
  const fecha = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const orden = [...regEvaluaciones].sort((x, y) => String(y.fechaInicio || y.fechaFin || '').localeCompare(String(x.fechaInicio || x.fechaFin || '')));
  return `<div style="display:flex;flex-direction:column;gap:12px;">${orden.map(ev => {
    const pos = state.positions.find(p => p.key === ev.posicionKey)?.label || ev.posicionKey || '';
    const activa = regEvalSel === ev.id, viendo = regVer?.evId === ev.id;
    const fechas = [fecha(ev.fechaInicio), fecha(ev.fechaFin)].filter(Boolean).join(' – ');
    let registros = '';
    if (viendo) {
      const r = regVer.res;
      registros = !r ? '<p class="text-xs text-muted mt-8">Cargando registros…</p>'
        : !r.registros.length ? '<p class="text-xs text-muted mt-8">Sin registros todavía en esta evaluación.</p>'
        : (() => { // una tabla por posición (cada una con sus columnas de encuesta)
          const label = id => { const p = state.players.find(x => x.id === id); return p ? `${p.nombre} ${p.apellidos}` : '(sin identificar)'; };
          const orden = state.positions.map(p => p.key);
          const pks = [...new Set(r.registros.map(x => x.posicionKey || ev.posicionKey || ''))].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
          return pks.map(pk => `<div class="mt-16"><div style="font-weight:800;margin-bottom:6px;">${safeText(state.positions.find(p => p.key === pk)?.label || pk || 'Sin posición')}</div>
            ${pk ? buildTablaEncuestaHTML(r.registros.filter(x => (x.posicionKey || ev.posicionKey || '') === pk), pk, label) : ''}</div>`).join('');
        })();
    }
    return `
    <div class="card" style="margin:0;${activa || viendo ? 'border:2px solid var(--blue-500, #3b82f6);' : ''}">
      <div class="card-body">
        <div class="flex gap-8" style="align-items:center;flex-wrap:wrap;">
          <div style="flex:1 1 260px;min-width:0;">
            <div style="font-size:16px;font-weight:800;">${safeText(ev.nombre)}${ev.posicionKey ? ` <span class="text-xs text-muted" title="Evaluación antigua de una sola posición: puedes unirla con las demás del mismo periodo">· solo ${safeText(pos)}</span>` : ''}</div>
            <div class="text-xs text-muted">${safeText(ev.temporada)}${ev.tipo ? ' · ' + safeText(ev.tipo) : ''}${fechas ? ' · ' + fechas : ''}</div>
          </div>
          <button class="btn btn-sm btn-primary" data-ev-importar="${ev.id}">📥 Importar encuesta</button>
          <button class="btn btn-sm" data-ev-ver="${ev.id}">${viendo ? 'Ocultar registros' : 'Ver registros'}</button>
          <button class="btn btn-sm" data-ev-editar="${ev.id}">Editar</button>
          <button class="btn btn-sm" data-ev-borrar="${ev.id}" style="color:#b91c1c;">Borrar</button>
        </div>
        ${registros}
        ${activa ? `<div class="mt-16">${buildImportWizardHTML()}</div>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

/** Evaluaciones del mismo periodo (mismo nombre y temporada) que antes se creaban una por posición. */
function gruposEvaluacionesRepetidas() {
  const g = {};
  (regEvaluaciones || []).forEach(e => { const k = `${normalizeTxt(e.nombre).trim()}|${e.temporada || ''}`; (g[k] = g[k] || []).push(e); });
  return Object.values(g).filter(arr => arr.length > 1);
}
function buildUnirEvaluacionesHTML() {
  const grupos = gruposEvaluacionesRepetidas();
  if (!grupos.length) return '';
  const pos = k => state.positions.find(p => p.key === k)?.label || k || 'sin posición';
  return `<div class="card mb-16" style="border:2px solid #f59e0b;"><div class="card-body">
    <div class="flex gap-8" style="align-items:center;flex-wrap:wrap;">
      <div style="flex:1 1 320px;">
        <b>🔗 Evaluaciones del mismo periodo separadas por posición</b>
        <div class="text-xs text-muted" style="margin-top:4px;">${grupos.map(gr => `<div>· <b>${safeText(gr[0].nombre)}</b> (${safeText(gr[0].temporada)}): ${gr.map(e => safeText(pos(e.posicionKey))).join(', ')}</div>`).join('')}</div>
        <div class="text-xs text-muted" style="margin-top:4px;">Al unirlas queda una sola evaluación por periodo con todas las posiciones. Se mueven sus registros y lo guardado en las fichas (textos, descripción, plan, condicionales, notas a mano). Antes se descarga una copia de seguridad.</div>
      </div>
      <button class="btn btn-primary" id="reg-unir">Unir evaluaciones</button>
      <span class="text-xs text-muted" id="reg-unir-estado"></span>
    </div>
  </div></div>`;
}
/** Junta cada grupo en una evaluación (la más antigua). Mueve registros y los mapas por evaluación de cada jugador. */
async function unirEvaluaciones(estado) {
  const grupos = gruposEvaluacionesRepetidas();
  // 1. Copia de seguridad (evaluaciones, registros y jugadores) que se descarga antes de tocar nada
  estado('Haciendo copia de seguridad…');
  const copia = { tipo: 'antes-de-unir-evaluaciones', creada: new Date().toISOString(),
    evaluaciones: await readCollection('evaluaciones'), registros: await readCollection('registros'), jugadores: await readCollection('jugadores') };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(copia)], { type: 'application/json' }));
  a.download = `copia-antes-de-unir-evaluaciones-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  const CAMPOS = ['condicionalPorEval', 'condicionalMaxPorEval', 'condicionalBasePorEval', 'fichaNotasManuales', 'fichaTextos'];
  let movidos = 0;
  for (const gr of grupos) {
    const orden = [...gr].sort((x, y) => (x.createdAt?.seconds || 0) - (y.createdAt?.seconds || 0));
    const master = orden[0], otras = orden.slice(1);
    // Los registros de la principal guardan su posición antes de que la evaluación deje de tenerla
    if (master.posicionKey) {
      for (const r of (await queryRegistros({ evaluacionId: master.id })).filter(r => !r.posicionKey)) await actualizarRegistro(r.id, { posicionKey: master.posicionKey });
    }
    for (const ot of otras) {
      estado(`Uniendo ${master.nombre}: ${state.positions.find(p => p.key === ot.posicionKey)?.label || ''}…`);
      for (const r of await queryRegistros({ evaluacionId: ot.id })) {
        await actualizarRegistro(r.id, { evaluacionId: master.id, temporada: master.temporada, posicionKey: r.posicionKey || ot.posicionKey || null,
          rowKey: buildRowKey({ evaluacionId: master.id, jugadorId: r.jugadorId, jugadorNombreArchivo: r.jugadorNombreArchivo, evaluador: r.evaluador }) });
        movidos++;
      }
      for (const j of state.players) {
        for (const campo of CAMPOS) {
          const val = j[campo]?.[ot.id];
          if (val == null) continue;
          const yaHay = j[campo]?.[master.id];
          const nuevo = yaHay && typeof yaHay === 'object' && typeof val === 'object' ? { ...val, ...yaHay } : (yaHay ?? val);
          await updateMapEntry('jugadores', j.id, campo, master.id, nuevo);
          await updateMapEntry('jugadores', j.id, campo, ot.id, null);
          const mapa = { ...(j[campo] || {}), [master.id]: nuevo }; delete mapa[ot.id];
          j[campo] = mapa;
        }
      }
      await eliminarEvaluacion(ot.id);
    }
    const fechas = gr.map(e => e.fechaInicio).filter(Boolean).sort(), fines = gr.map(e => e.fechaFin).filter(Boolean).sort();
    const patch = { posicionKey: null, fechaInicio: fechas[0] || master.fechaInicio || null, fechaFin: fines[fines.length - 1] || master.fechaFin || null };
    await actualizarEvaluacion(master.id, patch);
    regEvaluaciones = regEvaluaciones.filter(e => !otras.some(o => o.id === e.id)).map(e => e.id === master.id ? { ...e, ...patch } : e);
  }
  setState({ players: [...state.players] });
  return { grupos: grupos.length, movidos };
}

/** Registros cuya evaluación se borró: verlos, editarlos, borrarlos o pasarlos a otra evaluación de su posición. */
function buildHuerfanosHTML() {
  if (!regEvaluaciones) return '';
  const cab = `<div class="flex gap-8" style="align-items:center;flex-wrap:wrap;">
      <div style="flex:1 1 260px;"><b>Registros sin evaluación</b><div class="text-xs text-muted">Los de evaluaciones borradas. Puedes revisarlos, borrarlos o pasarlos a otra evaluación.</div></div>
      <button class="btn btn-sm" id="reg-huerfanos">${regHuerfanos ? 'Ocultar' : '🔍 Buscar'}</button></div>`;
  if (!regHuerfanos) return `<div class="card" style="margin-top:12px;"><div class="card-body">${cab}</div></div>`;
  const regs = regHuerfanos.res.registros;
  if (!regs.length) return `<div class="card" style="margin-top:12px;"><div class="card-body">${cab}<p class="text-xs text-muted mt-8">✓ No hay registros sin evaluación.</p></div></div>`;
  const label = id => { const p = state.players.find(x => x.id === id); return p ? `${p.nombre} ${p.apellidos}` : '(sin identificar)'; };
  const bloques = [...new Set(regs.map(r => r.posicionKey || ''))].map(pk => {
    const rs = regs.filter(r => (r.posicionKey || '') === pk);
    const pos = state.positions.find(p => p.key === pk)?.label || pk || 'Sin posición';
    const temps = [...new Set(rs.map(r => r.temporada).filter(Boolean))].join(', ');
    const evs = (regEvaluaciones || []).filter(e => !e.posicionKey || e.posicionKey === pk); // las de periodo (todas las posiciones) o las antiguas de esa posición
    return `<div class="mt-16" style="border-top:1px solid var(--border-default);padding-top:12px;">
      <div class="flex gap-8 mb-8" style="align-items:center;flex-wrap:wrap;">
        <b style="flex:1 1 220px;">${safeText(pos)} · ${rs.length} registro(s)${temps ? ' · ' + safeText(temps) : ''}</b>
        ${evs.length ? `<select class="select" data-huer-dest="${safeText(pk)}" style="width:auto;"><option value="">Pasar a la evaluación…</option>${evs.map(e => `<option value="${e.id}">${safeText(e.nombre)} (${safeText(e.temporada)})</option>`).join('')}</select>
        <button class="btn btn-sm" data-huer-mover="${safeText(pk)}">Pasar</button>` : `<span class="text-xs text-muted">No hay evaluaciones de ${safeText(pos)} para pasarlos.</span>`}
        <button class="btn btn-sm" data-huer-borrar="${safeText(pk)}" style="color:#b91c1c;">🗑 Borrar estos ${rs.length}</button>
      </div>
      ${pk ? buildTablaEncuestaHTML(rs, pk, label) : ''}
    </div>`;
  }).join('');
  return `<div class="card" style="margin-top:12px;border:2px solid #f59e0b;"><div class="card-body">${cab}${bloques}</div></div>`;
}

/** Criterios de una posición por bloque, para comparar cada columna solo con los de su bloque. */
function bloquesCriterios(posicionKey) {
  const apc = buildAspectoPorCompetencia(state, posicionKey);
  const bloques = { perfiles: (state.criteriaSchemas[posicionKey]?.perfiles || []).filter(Boolean) };
  Object.entries(apc).forEach(([c, a]) => { if (a !== 'condicional') (bloques[a] = bloques[a] || []).push(c); });
  return bloques;
}

// ── Registro: wizard de importación CSV ───────────

function buildImportWizardHTML() {
  const ev = regEvaluaciones.find(e => e.id === regEvalSel);
  if (!ev) return '';
  const posImp = regImport.posicionKey || ev.posicionKey;
  const posLabel = state.positions.find(p => p.key === posImp)?.label || posImp || '';
  let body = '';

  if (regImport.step === 'archivo') {
    body = `
      <p class="text-xs text-muted mb-16">Sube el archivo (CSV o Excel). En el siguiente paso indicas qué es cada columna — no hace falta que las columnas se llamen de una forma concreta.</p>
      <input class="input" type="file" id="import-file" accept=".csv,.xlsx,.xls" />
      <div class="flex gap-8 mt-16"><button class="btn btn-ghost" id="import-cancelar">Cancelar</button></div>
    `;
  } else if (regImport.step === 'mapeo') {
    const schema = state.criteriaSchemas[posImp] || {};
    const perfiles = schema.perfiles || [];
    const aspectoPorCompetencia = buildAspectoPorCompetencia(state, posImp);
    const competencias = Object.keys(aspectoPorCompetencia);
    const optionsFor = header => {
      const sel = regImport.mapping[header] || '';
      const o = (v, l) => `<option value="${safeText(v)}" ${sel === v ? 'selected' : ''}>${safeText(l)}</option>`;
      return [
        `<option value="">— Ignorar columna —</option>`,
        o('@fecha', 'Fecha y hora'), o('@evaluador', 'Evaluador'), o('@jugador', 'Jugador'),
        o('equipo', 'Equipo (opcional — ayuda a identificar al jugador)'),
        ...Object.entries({ ...RP_DESTINOS, ...TEXTOS_DESTINOS, ...EXTRAS_DESTINOS }).map(([k, l]) => o(k, l)),
        ...perfiles.filter(Boolean).map(p => o(p, `Perfil: ${p}`)),
        ...competencias.flatMap(c => aspectoPorCompetencia[c] === 'condicional' ? [
          o(c + '::A', `Condicional: ${c} — valor 1`), o(c + '::B', `Condicional: ${c} — valor 2`),
        ] : [
          o(c, `Competencia: ${c} (${aspectoPorCompetencia[c]})`),
        ]),
      ].join('');
    };
    const preguntas = regImport.preguntas || {};
    const hayPreguntas = Object.keys(preguntas).length > 0;
    const chk = hayPreguntas ? comprobarPorBloques(preguntas, regImport.mapping, bloquesCriterios(posImp)) : { porColumna: {}, avisos: 0 };
    const estadoHTML = h => {
      const e = chk.porColumna[h];
      if (!e) return '';
      if (e.estado === 'ok') return '<span style="color:#15803d;font-weight:700;">✓ Cuadra</span>';
      if (e.estado === 'aviso') return `<span style="color:#b45309;font-weight:700;">⚠ ¿${safeText(e.sugerido)}?</span>`;
      return '<span class="text-muted" title="No hay un criterio con nombre parecido: revísala tú">? Revisar</span>';
    };
    const aviso = !hayPreguntas ? ''
      : chk.avisos ? `<div class="mb-16" style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <div style="flex:1 1 300px;color:#78350f;"><b>⚠ ${chk.avisos} columna${chk.avisos === 1 ? '' : 's'} no cuadra${chk.avisos === 1 ? '' : 'n'} con la pregunta del Excel.</b><div class="text-xs">Si importas así, esas notas se guardarían en otro criterio.</div></div>
          <button class="btn btn-primary" id="import-auto">Colocar según el Excel</button>
        </div>`
      : '<div class="mb-16" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;color:#166534;"><b>✓ Las columnas cuadran con las preguntas del Excel.</b></div>';
    body = `
      <div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
        <label class="label" for="import-posicion" style="margin:0;">Posición de esta encuesta</label>
        <select class="select" id="import-posicion" style="width:auto;min-width:180px;">${state.positions.map(pp => `<option value="${pp.key}" ${pp.key === posImp ? 'selected' : ''}>${safeText(pp.label)}</option>`).join('')}</select>
        ${regImport.hoja ? `<span class="text-xs text-muted">pestaña del Excel: «${safeText(regImport.hoja)}»</span>` : ''}
        <span class="text-xs text-muted">· columnas según Configuración › Columnas de la encuesta (${safeText(state.positions.find(pp => pp.key === posImp)?.label || '')})${Object.keys(state.columnasEncuesta?.[posImp] || {}).length ? ', con tus cambios' : ''}</span>
      </div>
      ${aviso}
      <p class="text-xs text-muted mb-16">${regImport.rows.length} filas leídas${regImport.omitidas ? ` (${regImport.omitidas} filas de cabecera omitidas)` : ''}${regImport.precargado ? '. Mapeo precargado desde Configuración › Columnas de la encuesta' : ''}. Indica qué es cada columna (obligatorio: Jugador y Evaluador). Posición: ${safeText(posLabel)}.</p>
      <div style="overflow-x:auto;">
        <table class="table table-compact">
          <thead><tr><th>Columna del archivo</th><th>${hayPreguntas ? 'Pregunta del Excel' : 'Ejemplo'}</th><th>Se importa como</th>${hayPreguntas ? '<th>Estado</th>' : ''}</tr></thead>
          <tbody>
            ${regImport.headers.map(h => `
              <tr style="${chk.porColumna[h]?.estado === 'aviso' ? 'background:#fffbeb;' : ''}">
                <td>${safeText(h)}</td>
                <td class="text-muted" style="max-width:420px;">${safeText(preguntas[h] || String(regImport.rows[0]?.[h] ?? '').slice(0, 40))}</td>
                <td><select class="select" data-map-col="${safeText(h)}">${optionsFor(h)}</select></td>
                ${hayPreguntas ? `<td class="text-xs" style="white-space:nowrap;">${estadoHTML(h)}</td>` : ''}
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

  return `<div style="border-top:1px solid var(--border-default);padding-top:12px;"><div style="font-weight:800;margin-bottom:8px;">📥 Importar encuesta — ${safeText(ev.nombre)} (${safeText(ev.temporada)}${regImport.step !== 'archivo' && posLabel ? ' · ' + safeText(posLabel) : ''})</div>${body}</div>`;
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
  const todos = [...state.players].sort(ordenPorNombre); // mismo orden que lo que se lee: Nombre Apellidos
  const etiqueta = p => `${p.nombre || ''} ${p.apellidos || ''}`.trim() + (p.teamKey ? ` (${TEAMS.find(t => t.key === p.teamKey)?.label || p.teamKey})` : '');
  const pendHTML = grupos.length ? `
    <div class="mb-16">
      <div class="text-xs text-muted mb-8" style="font-weight:700;text-transform:uppercase;">Pendientes de identificar (${grupos.length} nombres, ${regImport.pendientes.length} filas)</div>
      <p class="text-xs text-muted mb-8">Elige a quién corresponde cada nombre: vale para todas sus filas y se guarda como alias, así la próxima vez se reconoce solo. Al pulsar <b>Confirmar importación</b> se guardan también.</p>
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
  const posImp = regImport.posicionKey || ev.posicionKey;
  const schema = state.criteriaSchemas[posImp] || {};
  const perfiles = schema.perfiles || [];
  // IDs estables (ficha-espejo.js): además de puntuaciones{nombre}, cada registro
  // nuevo guarda puntuacionesId{id}. Retrocompatible: lo antiguo se sigue leyendo por nombre.
  const catalogo = buildCatalogo(state, posImp);
  const idPorClave = {};
  catalogo.lista.forEach(c => { if (!(c.clave in idPorClave)) idPorClave[c.clave] = c.id; });
  // Columnas de fecha/evaluador/jugador/equipo: las que el usuario mapeó (Configuración → Columnas encuesta).
  const colDe = tok => Object.keys(regImport.mapping).find(h => regImport.mapping[h] === tok);
  const colFecha = colDe('@fecha'), colEvaluador = colDe('@evaluador'), colJugador = colDe('@jugador');
  const colEquipo = colDe('equipo');
  const teamKeyPorLabel = raw => TEAMS.find(t => t.label.toLowerCase().trim() === String(raw || '').toLowerCase().trim())?.key || null;

  const celdasIgnoradas = [];
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
    const extras = {}; // Perfil técnico, Inteligencia táctica, Talento: aparte, no cuentan en medias
    Object.entries(regImport.mapping).forEach(([header, target]) => {
      if (!target || !target.startsWith('@x_')) return;
      const v = parseEsNumber(row[header]);
      if (v != null) extras[target.slice(3)] = v;
    });
    Object.entries(regImport.mapping).forEach(([header, target]) => {
      if (!target || target === 'equipo' || target.startsWith('@')) return;
      const raw = row[header];
      if (raw === '' || raw == null) return;
      const val = parseEsNumber(raw);
      // Celda no numérica: se ignora SOLO esa celda (antes se perdía la fila entera) y se avisa.
      if (val == null) { celdasIgnoradas.push(`${jugadorNombreArchivo} / ${evaluador}: ${header} = "${raw}"`); return; }
      // Condicional con dos columnas: "Item::A" → Item (valor 1), "Item::B" → Item__B (valor 2)
      const key = target.endsWith('::A') ? target.slice(0, -3) : target.endsWith('::B') ? target.slice(0, -3) + '__B' : target;
      puntuaciones[key] = val;
      if (idPorClave[key]) puntuacionesId[idPorClave[key]] = val;
    });

    const teamKey = colEquipo ? teamKeyPorLabel(row[colEquipo]) : null;
    const match = matchJugador(jugadorNombreArchivo, state.players, { teamKey });
    if (match.status !== 'auto') {
      return { jugadorNombreArchivo, evaluador, puntuaciones, puntuacionesId, textos, rp, extras, fechaRegistro, matchStatus: match.status, matchCandidates: match.candidates };
    }
    const jugadorId = match.playerId;
    const rowKey = buildRowKey({ evaluacionId: ev.id, jugadorId, jugadorNombreArchivo, evaluador });
    return { jugadorNombreArchivo, evaluador, puntuaciones, puntuacionesId, textos, rp, extras, fechaRegistro, jugadorId, rowKey };
  });

  regImport.pendientes = filas.filter(f => !f.error && !f.jugadorId);
  const resueltas = filas.filter(f => f.error || f.jugadorId);

  let existentes = [];
  try {
    existentes = await queryRegistros({ evaluacionId: ev.id });
  } catch (err) {
    console.error('[Firestore] No se pudieron leer los registros existentes:', err);
    showError('No se pudo comprobar duplicados (revisa las reglas/índices de Firestore). Importación detenida para no duplicar registros.');
    return;
  }

  if (celdasIgnoradas.length) {
    showError(`${celdasIgnoradas.length} celda(s) no numéricas ignoradas (el resto de la fila sí se importa): ${celdasIgnoradas.slice(0, 5).join(' · ')}${celdasIgnoradas.length > 5 ? ' …' : ''}`, 12000);
  }
  regImport.resultado = clasificarFilas(resueltas, existentes);
  regImport.decisiones = {};
  regImport.step = 'resumen';
  renderPanelRegistro(container);
}

function renderRegistroSub(container) {
  container.innerHTML = `
    <div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
      <p class="text-sm text-muted" style="margin:0;flex:1 1 300px;">Cada evaluación agrupa las encuestas de un periodo y una posición: impórtalas y revisa sus registros aquí mismo.</p>
      ${regEvalFormOpen ? '' : '<button class="btn btn-primary" id="reg-nueva-ev">+ Nueva evaluación</button>'}
    </div>
    ${regEvalFormOpen ? `<div class="mb-16">${buildEvaluacionFormHTML()}</div>` : ''}
    ${buildUnirEvaluacionesHTML()}
    ${buildEvaluacionesListHTML()}
    ${buildHuerfanosHTML()}
  `;

  container.querySelector('#reg-unir')?.addEventListener('click', async e => {
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para unir evaluaciones.'); return; }
    const grupos = gruposEvaluacionesRepetidas();
    if (!confirm(`Se van a unir ${grupos.reduce((n, g) => n + g.length, 0)} evaluaciones en ${grupos.length}.\n\nAntes se descargará una copia de seguridad. ¿Seguimos?`)) return;
    const btn = e.currentTarget, est = container.querySelector('#reg-unir-estado');
    btn.disabled = true;
    try {
      const r = await unirEvaluaciones(t => { if (est) est.textContent = t; });
      regVer = null; regEvalSel = null; resetRegImport(); regHuerfanos = null;
      showSuccess(`Hecho: ${r.grupos} evaluación(es) unidas, ${r.movidos} registros movidos.`, 8000);
    } catch (err) {
      console.error('[Unir evaluaciones]', err);
      showError('Se paró a medias: ' + (err.message || err) + '. Lo hecho se queda; vuelve a pulsar para terminar (tienes la copia descargada).', 12000);
    }
    renderRegistroSub(container);
  });
  container.querySelectorAll('[data-ev-ver]').forEach(btn => btn.addEventListener('click', async () => {
    const evId = btn.dataset.evVer;
    if (regVer?.evId === evId) { regVer = null; renderRegistroSub(container); return; }
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para ver los registros.'); return; }
    regVer = { evId, res: null };
    renderRegistroSub(container);
    try {
      const registros = await queryRegistros({ evaluacionId: evId });
      const ev = regEvaluaciones.find(e => e.id === evId);
      const medias = {};
      const porPosicion = {};
      registros.forEach(r => { (porPosicion[r.posicionKey] = porPosicion[r.posicionKey] || []).push(r); });
      Object.entries(porPosicion).forEach(([pk, regs]) => Object.assign(medias, calcularMediasPorJugador(regs, buildAspectoPorCompetencia(state, pk))));
      if (regVer?.evId === evId) regVer.res = { registros: registros.map(r => ({ ...r, posicionKey: r.posicionKey || ev?.posicionKey })), mediasPorJugador: medias };
    } catch (err) {
      console.error('[Firestore] No se pudieron leer los registros:', err);
      showError('No se pudieron leer los registros (revisa reglas/índices de Firestore).');
      regVer = null;
    }
    if (container.isConnected) renderRegistroSub(container);
  }));
  wireRegistrosTabla(container, () => regVer?.res, () => renderRegistroSub(container));
  wireRegistrosTabla(container, () => regHuerfanos?.res, () => renderRegistroSub(container));

  container.querySelector('#reg-huerfanos')?.addEventListener('click', async () => {
    if (regHuerfanos) { regHuerfanos = null; renderRegistroSub(container); return; }
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para buscar registros.'); return; }
    try {
      const ids = new Set((regEvaluaciones || []).map(e => e.id));
      const registros = (await queryRegistros({})).filter(r => !ids.has(r.evaluacionId));
      regHuerfanos = { res: { registros, mediasPorJugador: {} } };
    } catch (err) {
      console.error('[Firestore] Registros sin evaluación:', err);
      showError('No se pudieron leer los registros (revisa las reglas de Firestore).');
    }
    renderRegistroSub(container);
  });
  container.querySelectorAll('[data-huer-borrar]').forEach(btn => btn.addEventListener('click', async () => {
    const pk = btn.dataset.huerBorrar;
    const regs = (regHuerfanos?.res.registros || []).filter(r => (r.posicionKey || '') === pk);
    if (!regs.length || !confirm(`¿Borrar ${regs.length} registro(s) sin evaluación? No se puede deshacer.`)) return;
    let n = 0;
    try { for (const r of regs) { await eliminarRegistro(r.id); n++; } showSuccess(`${n} registro(s) borrados.`); }
    catch (err) { console.error('[Firestore]', err); showError(`Se borraron ${n}; el resto no (revisa permisos).`); }
    regHuerfanos.res.registros = regHuerfanos.res.registros.filter(r => !regs.slice(0, n).includes(r));
    renderRegistroSub(container);
  }));
  container.querySelectorAll('[data-huer-mover]').forEach(btn => btn.addEventListener('click', async () => {
    const pk = btn.dataset.huerMover;
    const evId = container.querySelector(`[data-huer-dest="${pk}"]`)?.value;
    const ev = (regEvaluaciones || []).find(e => e.id === evId);
    if (!ev) { showError('Elige la evaluación a la que pasarlos.'); return; }
    const regs = (regHuerfanos?.res.registros || []).filter(r => (r.posicionKey || '') === pk);
    if (!regs.length || !confirm(`¿Pasar ${regs.length} registro(s) a «${ev.nombre}» (${ev.temporada})?`)) return;
    let n = 0;
    try {
      for (const r of regs) {
        await actualizarRegistro(r.id, { evaluacionId: ev.id, temporada: ev.temporada, tipo: ev.tipo || null,
          rowKey: buildRowKey({ evaluacionId: ev.id, jugadorId: r.jugadorId, jugadorNombreArchivo: r.jugadorNombreArchivo, evaluador: r.evaluador }) });
        n++;
      }
      showSuccess(`${n} registro(s) pasados a ${ev.nombre}.`);
    } catch (err) { console.error('[Firestore]', err); showError(`Se pasaron ${n}; el resto no (revisa permisos).`); }
    regHuerfanos.res.registros = regHuerfanos.res.registros.filter(r => !regs.slice(0, n).includes(r));
    if (regVer?.evId === ev.id) regVer = null;
    renderRegistroSub(container);
  }));

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
        if (!confirm('¿Borrar esta evaluación?')) return;
        let conRegistros = false;
        if (registrosDeEsta.length) {
          conRegistros = confirm(`Tiene ${registrosDeEsta.length} registro(s).\n\nAceptar → borrar también sus registros.\nCancelar → dejarlos (saldrán en «Registros sin evaluación», abajo del todo).`);
        }
        if (conRegistros) for (const r of registrosDeEsta) await eliminarRegistro(r.id);
        await eliminarEvaluacion(id);
        if (regHuerfanos) regHuerfanos = null; // se vuelve a buscar
        regEvaluaciones = regEvaluaciones.filter(e => e.id !== id);
        if (regEvalSel === id) { regEvalSel = null; resetRegImport(); }
        if (regVer?.evId === id) regVer = null;
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
      const posSug = state.positions.find(x => x.key === regEvaluaciones.find(v => v.id === regEvalSel)?.posicionKey)?.label || '';
      parsed = esExcel ? await parseXLSXBuffer(await file.arrayBuffer(), posSug) : parseCSV(await file.text());
    } catch (err) {
      console.error('[Import] No se pudo leer el archivo:', err);
      showError('No se pudo leer el archivo (¿formato correcto?).');
      return;
    }
    if (parsed.cancelado) { e.target.value = ''; return; }
    if (!parsed.headers.length) { showError('No se pudo leer el archivo (¿está vacío?).'); return; }
    if (parsed.headers.length < 6) { showError('El archivo debe tener al menos 6 columnas: fecha, evaluador, jugador y 3 perfiles.'); return; }
    // Estructura fija de las encuestas: se omiten filas de cabecera (números/aspecto/preguntas),
    // la fecha se normaliza a ISO y el mapeo de columnas 7+ llega precargado (editable).
    const evImp = regEvaluaciones.find(x => x.id === regEvalSel);
    // Posición de esta encuesta: la que diga la pestaña del Excel ("Laterales" → Lateral); si no, la de la evaluación antigua (si tenía).
    const raiz = t => normalizeTxt(t).replace(/[^a-z]/g, '').slice(0, 5);
    const porHoja = parsed.hoja ? state.positions.find(p => raiz(p.label) && raiz(p.label) === raiz(parsed.hoja))?.key : null;
    regImport.posicionKey = porHoja || evImp?.posicionKey || regImport.posicionKey || state.positions[0]?.key || null;
    regImport.hoja = parsed.hoja || '';
    const mapeoInicial = mapeoPorDefecto(state, regImport.posicionKey, parsed.headers.length);
    const colFechaImp = Object.keys(mapeoInicial).find(h => mapeoInicial[h] === '@fecha') || 'Columna 1';
    const limpio = quitarCabeceras(parsed.rows, colFechaImp);
    regImport.headers = parsed.headers;
    regImport.rows = normalizarFechas(limpio.rows, colFechaImp);
    regImport.omitidas = limpio.omitidas;
    regImport.preguntas = preguntasDeCabecera(parsed.rows.slice(0, limpio.omitidas), parsed.headers);
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
    sel.addEventListener('change', () => { regImport.mapping[sel.dataset.mapCol] = sel.value; if (regImport.preguntas && Object.keys(regImport.preguntas).length) renderRegistroSub(container); });
  });

  container.querySelector('#import-posicion')?.addEventListener('change', e => {
    regImport.posicionKey = e.target.value;
    regImport.mapping = mapeoPorDefecto(state, regImport.posicionKey, regImport.headers.length);
    regImport.precargado = Object.keys(regImport.mapping).length > 0;
    renderRegistroSub(container);
  });
  container.querySelector('#import-auto')?.addEventListener('click', () => {
    const ev = regEvaluaciones.find(e => e.id === regEvalSel);
    const { porColumna, propuesta } = comprobarPorBloques(regImport.preguntas || {}, regImport.mapping, bloquesCriterios(regImport.posicionKey || ev?.posicionKey));
    Object.entries(porColumna).forEach(([h, e]) => { if (e.estado === 'aviso') regImport.mapping[h] = e.sugerido; });
    // Una columna sin criterio claro que se quede con uno ya colocado en otra → se ignora (no se duplica).
    const tomados = new Set(Object.values(propuesta));
    let dudosas = 0;
    Object.entries(porColumna).forEach(([h, e]) => { if (e.estado === '?' && tomados.has(regImport.mapping[h])) { regImport.mapping[h] = ''; dudosas++; } });
    showSuccess('Columnas colocadas según el Excel.' + (dudosas ? ` ${dudosas} quedan sin criterio: elige tú (marcadas "? Revisar").` : ''));
    renderRegistroSub(container);
  });

  container.querySelector('#import-validar')?.addEventListener('click', () => {
    const vals = Object.values(regImport.mapping);
    if (!vals.includes('@jugador') || !vals.includes('@evaluador')) { showError('Indica qué columna es el Jugador y cuál el Evaluador.'); return; }
    procesarImport(container);
  });

  container.querySelectorAll('[data-decision]').forEach(sel => {
    sel.addEventListener('change', () => { regImport.decisiones[sel.dataset.decision] = sel.value; });
  });

  // Asigna los "Pendientes de identificar" según lo elegido en los desplegables. Devuelve false si no pudo.
  const aplicarPendientes = async (repintar = true) => {
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
      resueltos.push({ jugadorNombreArchivo: f.jugadorNombreArchivo, evaluador: f.evaluador, puntuaciones: f.puntuaciones, puntuacionesId: f.puntuacionesId, textos: f.textos || {}, rp: f.rp || {}, extras: f.extras || {}, fechaRegistro: f.fechaRegistro, jugadorId: playerId, rowKey });
      if (!aliasUpdates.has(playerId)) aliasUpdates.set(playerId, new Set());
      aliasUpdates.get(playerId).add(f.jugadorNombreArchivo);
    });

    // Guarda las equivalencias confirmadas como alias — nunca sustituye el nombre oficial (auditoría §5)
    for (const [playerId, nombres] of aliasUpdates) {
      const player = state.players.find(p => p.id === playerId);
      if (!player) continue;
      const aliases = [...new Set([...(player.aliases || []), ...nombres])];
      try {
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', playerId, { aliases: arrayUnion(...nombres) });
        setState({ players: state.players.map(p => p.id === playerId ? { ...p, aliases } : p) });
      } catch (err) {
        console.error('[Firestore] No se pudo guardar el alias:', err);
        showError(`No se pudo guardar el alias de ${nombreCompleto(player)} (la próxima importación volverá a preguntar).`);
      }
    }

    let existentes = [];
    try { existentes = await queryRegistros({ evaluacionId: regEvalSel }); }
    catch (err) { console.error('[Firestore]', err); showError('No se pudo comprobar duplicados. Importación detenida para no duplicar registros: vuelve a pulsar.'); return false; }
    regImport.pendientes = restantes;
    const todas = [
      ...resueltos,
      ...regImport.resultado.nuevos,
      ...regImport.resultado.sinCambios,
      ...regImport.resultado.conCambios.map(({ existente, ...rest }) => rest),
      ...regImport.resultado.errores,
    ];
    regImport.resultado = clasificarFilas(todas, existentes);
    if (repintar) renderRegistroSub(container);
    return true;
  };
  container.querySelector('#import-aplicar-pendientes')?.addEventListener('click', () => aplicarPendientes(true));

  container.querySelector('#import-confirmar')?.addEventListener('click', async () => {
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para importar.'); return; }
    // Lo elegido en "Pendientes de identificar" cuenta aunque no se pulsara "Aplicar identificaciones".
    if ([...container.querySelectorAll('[data-pend-select]')].some(sel => sel.value)) {
      if (!(await aplicarPendientes(false))) return;
    }
    const ev = regEvaluaciones.find(e => e.id === regEvalSel);
    const r = regImport.resultado;
    regImport.busy = true;
    renderRegistroSub(container);
    let creados = 0;
    try {
      for (const fila of [...r.nuevos]) {
        await crearRegistro({
          evaluacionId: ev.id, temporada: ev.temporada, posicionKey: regImport.posicionKey || ev.posicionKey, tipo: ev.tipo || null,
          jugadorId: fila.jugadorId, jugadorNombreArchivo: fila.jugadorNombreArchivo, evaluador: fila.evaluador,
          puntuaciones: fila.puntuaciones, puntuacionesId: fila.puntuacionesId || {}, textos: fila.textos || {}, rp: fila.rp || {}, extras: fila.extras || {}, fechaRegistro: fila.fechaRegistro || null, rowKey: fila.rowKey, origen: 'csv',
        });
        // Ya guardado: si algo falla después y se reintenta, no se vuelve a crear (evita duplicados).
        r.nuevos = r.nuevos.filter(x => x !== fila);
        r.sinCambios.push(fila);
        creados++;
      }
      let sustituidos = 0;
      for (const fila of r.conCambios) {
        if ((regImport.decisiones[fila.rowKey] || 'mantener') === 'reemplazar') {
          await actualizarRegistro(fila.existente.id, {
            puntuaciones: fila.puntuaciones, puntuacionesId: fila.puntuacionesId || {}, textos: fila.textos || {}, rp: fila.rp || {}, extras: fila.extras || {}, jugadorNombreArchivo: fila.jugadorNombreArchivo, evaluador: fila.evaluador,
            fechaRegistro: fila.fechaRegistro || null,
          });
          sustituidos++;
        }
      }
      const noIdent = [...new Set(regImport.pendientes.map(f => f.jugadorNombreArchivo))];
      showSuccess(`Importado: ${creados} nuevos, ${sustituidos} sustituidos.` + (r.errores.length ? ` ${r.errores.length} fila(s) con error NO importadas.` : '') + (noIdent.length ? ` NO importados (sin identificar, comprobad): ${noIdent.join(', ')}.` : ''));
      regEvalSel = null;
      resetRegImport();
      renderRegistroSub(container);
    } catch (err) {
      console.error('[Firestore] Error importando registros:', err);
      showError(`Error al importar (revisa las reglas de Firestore). Se guardaron ${creados} nuevos antes del fallo; al reintentar no se duplican.`);
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
    if (t === '@evaluador') { const ie = infoEvaluador(r.evaluador); return `<td class="bt-nowrap" title="${safeText(tituloEvaluador(r.evaluador))}" style="cursor:help;">${safeText(r.evaluador)}${ie?.rol ? `<span style="display:block;font-size:9px;color:#64748b;line-height:1;">${safeText(ie.rol)}</span>` : ''}</td>`; }
    if (t === '@jugador') {
      const fp = state.players.find(x => x.id === r.jugadorId), ini = `${(fp?.nombre || '?')[0] || ''}${(fp?.apellidos || '')[0] || ''}`.toUpperCase();
      const av = fp?.fotoUrl ? `<img src="${fp.fotoUrl}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />`
        : `<span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#e2e8f0;color:#1d4ed8;font-size:8px;font-weight:800;align-items:center;justify-content:center;vertical-align:middle;margin-right:6px;">${safeText(ini)}</span>`;
      return `<td class="bt-nowrap bt-bold">${av}${fp ? `<a href="#" data-reg-ficha="${r.jugadorId}" data-reg-ficha-ev="${safeText(r.evaluacionId || '')}" title="Abrir su ficha" style="color:inherit;text-decoration:none;border-bottom:1px dotted currentColor;">${safeText(jugadorLabel(r.jugadorId))}</a>` : safeText(jugadorLabel(r.jugadorId))}</td>`;
    }
    if (!t || t === 'equipo') return `<td class="bt-vacia"></td>`;
    if (t.startsWith('@txt_')) return `<td class="bt-texto">${safeText(r.textos?.[t.slice(5)] ?? '')}</td>`;
    const valor = t === '@r' || t === '@p' ? r.rp?.[t.slice(1)] : t.startsWith('@x_') ? r.extras?.[t.slice(3)] : r.puntuaciones?.[t];
    return `<td class="bt-num${t.startsWith('@x_') ? ' bt-extra' : ''}"><input class="input" type="text" inputmode="decimal" data-reg-edit="${r.id}" data-clave="${safeText(t)}" value="${safeText(valor ?? '')}" /></td>`;
  };
  // Mismo jugador junto: por nombre del jugador (A→Z) y, dentro, por fecha.
  const ordenados = [...registros].sort((a, b) =>
    String(jugadorLabel(a.jugadorId) || '').localeCompare(String(jugadorLabel(b.jugadorId) || ''), 'es', { sensitivity: 'base' })
    || String(a.fechaRegistro || '').localeCompare(String(b.fechaRegistro || '')));
  const rows = ordenados.length
    ? ordenados.map(r => `<tr><td class="bt-del"><button class="btn btn-sm btn-ghost" data-reg-borrar="${r.id}" title="Borrar solo este registro">🗑</button></td>${cols.map(c => celda(r, c)).join('')}</tr>`).join('')
    : `<tr><td class="bt-vacia"></td>${cols.map(() => '<td class="bt-vacia"></td>').join('')}</tr>`;
  // Anchos fijos (colgroup + table-layout:fixed): iguales en todos los navegadores.
  const anchoCol = c => { const t = String(tipoCol(c) || ''); return t.startsWith('@txt_') ? 380 : t === '@fecha' ? 110 : t === '@evaluador' ? 84 : t === '@jugador' ? 190 : 96; };
  const anchoTabla = 40 + cols.reduce((a, c) => a + anchoCol(c), 0);
  return `
    <style>
      .bt-wrap { overflow:auto; max-height:75vh; border:1px solid #cbd5e1; border-radius:6px; background:#fff; }
      .bt { border-collapse:separate; border-spacing:0; table-layout:fixed; background:#fff; color:#0f1117; font-size:11px; }
      .bt th { background:var(--header-bg, #1d4ed8); color:#fff; font-size:9.5px; font-weight:700; line-height:1.2; text-transform:uppercase; letter-spacing:.1px;
               text-align:center; vertical-align:middle; padding:15px 4px 6px; width:96px; min-width:96px; max-width:96px; border-left:1px solid rgba(255,255,255,.35); overflow-wrap:break-word; word-break:normal; hyphens:manual; position:sticky; top:0; z-index:1; }
      .bt th.bt-th-txt { width:380px; min-width:380px; max-width:380px; }
      .bt th.bt-th-fija { white-space:nowrap; }
      .bt th.bt-th-del { width:40px; min-width:40px; max-width:40px; padding:5px 0; }
      .bt td { overflow:hidden; }
      .bt td.bt-nowrap { text-overflow:ellipsis; }
      .bt th:first-child { border-left:none; }
      /* 🗑, Fecha, Evaluador y Jugador fijas al hacer scroll horizontal */
      .bt td:nth-child(-n+4), .bt th:nth-child(-n+4) { position:sticky; z-index:2; }
      .bt th:nth-child(-n+4) { z-index:3; }
      .bt td:nth-child(-n+3) { box-shadow:inset -1px 0 #cbd5e1; } .bt th:nth-child(-n+3) { box-shadow:inset -1px 0 rgba(255,255,255,.35); }
      .bt td:nth-child(1), .bt th:nth-child(1) { left:0; }
      .bt td:nth-child(2), .bt th:nth-child(2) { left:40px; }
      .bt td:nth-child(3), .bt th:nth-child(3) { left:150px; }
      .bt td:nth-child(4), .bt th:nth-child(4) { left:234px; box-shadow:inset -2px 0 #94a3b8; }
      .bt th .bt-n { position:absolute; top:2px; left:0; right:0; font-size:9px; font-weight:600; opacity:.75; line-height:1; } /* número pegado arriba; nombre centrado */
      .bt td { background:#fff; color:#0f1117; padding:1px 5px; border-left:1px solid #cbd5e1; border-top:1px solid #cbd5e1; text-align:center; vertical-align:middle; line-height:1.25; height:22px; }
      .bt td:first-child { border-left:none; }
      .bt tbody tr:nth-child(even) td { background:#f8fafc; }
      .bt .bt-nowrap { white-space:nowrap; }
      .bt .bt-bold { font-weight:700; text-align:left; }
      .bt .bt-texto { width:380px; min-width:380px; max-width:380px; font-size:10px; line-height:1.25; text-align:left; vertical-align:top; padding-top:3px; padding-bottom:3px; }
      .bt .bt-vacia { height:22px; }
      .bt .bt-num { padding:0; }
      .bt td.bt-extra, .bt tbody tr:nth-child(even) td.bt-extra { background:#e5e7eb; } .bt td.bt-extra input { color:#6b7280; }
      .bt th.bt-th-extra { background:#9ca3af; }
      .bt .bt-del { padding:0 2px; } .bt .bt-del .btn { padding:0 6px; min-height:0; height:20px; line-height:1; }
      .bt .bt-num input { width:100%; box-sizing:border-box; height:22px; font-size:11px; padding:0 2px; text-align:center; background:transparent; color:#0f1117; border:none; border-radius:0; box-shadow:none; }
      .bt .bt-num input:focus { outline:2px solid var(--blue-500, #3b82f6); outline-offset:-2px; background:#fff; }
    </style>
    <p class="text-xs text-muted mb-8">${safeText(posLabel)} · ${registros.length} registros · ${cols.length} columnas según Configuración › Columnas de la encuesta. <b>Editar:</b> cambia una nota y sal de la celda · <b>Borrar:</b> 🗑 al principio de cada fila.</p>
    <div class="bt-wrap"><table class="bt" style="width:${anchoTabla}px;">
      <colgroup><col style="width:40px">${cols.map(c => `<col style="width:${anchoCol(c)}px">`).join('')}</colgroup>
      <thead><tr><th class="bt-th-del" title="Borrar un registro">🗑</th>${cols.map(c => `<th class="${String(tipoCol(c) || '').startsWith('@txt_') ? 'bt-th-txt' : ['@fecha', '@evaluador', '@jugador'].includes(tipoCol(c)) ? 'bt-th-fija' : String(tipoCol(c) || '').startsWith('@x_') ? 'bt-th-extra' : ''}" style="width:${anchoCol(c)}px;min-width:${anchoCol(c)}px;max-width:${anchoCol(c)}px;" title="Columna ${c.num} de la encuesta${String(tipoCol(c) || '').startsWith('@x_') ? ' — guardada, de momento no cuenta en medias ni fichas' : ''}"><span class="bt-n">${c.num}</span>${safeText(c.nombre)}</th>`).join('')}</tr></thead>
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
        <td>${safeText(jugadorLabel(jugadorId))}</td><td>MEDIA</td><td>${general != null ? fmtDec(general) : '-'}</td>
        <td>${jugadorId ? `<button class="btn btn-sm" data-ver-ficha="${jugadorId}">Ver ficha</button>` : ''}</td>
      </tr>
      ${detalle}
    `;
  }).join('');

  // Ancho fijo: la tabla de la encuesta de dentro hace scroll en su caja en vez de ensanchar la página (y esconder 🗑).
  return `<table class="table table-compact" style="table-layout:fixed;width:100%;"><colgroup><col style="width:40%"><col style="width:15%"><col style="width:20%"><col style="width:25%"></colgroup><thead><tr><th>Jugador</th><th></th><th>Media general</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
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

/** Edición de notas y 🗑 de la Tabla de la encuesta. res() = { registros, mediasPorJugador } que se muestra. */
function wireRegistrosTabla(container, res, rerender) {
  // Nombre del jugador → su ficha (de esa evaluación); «← Volver a Evaluaciones» devuelve aquí mismo.
  container.querySelectorAll('[data-reg-ficha]').forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    await cargarEvaluacionesSilencioso();
    jugFichaId = a.dataset.regFicha; jugadorFormId = null; jugFichaTab = 'fichas';
    jugFichaEvalId = a.dataset.regFichaEv || null;
    jugVolverA = 'registro'; jugVolverScroll = window.scrollY;
    switchTab('jugadores');
  }));
  // Columnas fijas (🗑, Fecha, Evaluador, Jugador): su "left" medido de verdad, sin huecos por donde se vea lo que pasa por detrás.
  container.querySelectorAll('table.bt').forEach(tabla => {
    if (!tabla.offsetParent) return; // oculta: se quedan los valores del CSS
    const ths = [...tabla.querySelectorAll('thead th')].slice(0, 4);
    const wrap = tabla.closest('.bt-wrap'), sl = wrap ? wrap.scrollLeft : 0;
    if (wrap) wrap.scrollLeft = 0;
    const x0 = tabla.getBoundingClientRect().left;
    const lefts = ths.map(th => Math.round(th.getBoundingClientRect().left - x0));
    if (wrap) wrap.scrollLeft = sl;
    ths.forEach((th, i) => {
      const left = lefts[i] + 'px';
      tabla.querySelectorAll(`tr > :nth-child(${i + 1})`).forEach(cel => { cel.style.left = left; });
    });
  });
  container.querySelectorAll('[data-reg-edit]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const reg = (res()?.registros || []).find(r => r.id === inp.dataset.regEdit);
      if (!reg) return;
      const clave = inp.dataset.clave;
      const raw = inp.value.trim();
      const val = raw === '' ? null : parseEsNumber(raw);
      if (raw !== '' && val == null) { showError('La nota debe ser un número.'); inp.value = reg.puntuaciones?.[clave] ?? ''; return; }
      if (clave.startsWith('@x_')) { // Perfil técnico / Inteligencia táctica / Talento
        const extras = { ...(res().registros.find(r => r.id === reg.id)?.extras || reg.extras || {}) };
        if (val == null) delete extras[clave.slice(3)]; else extras[clave.slice(3)] = val;
        try { await actualizarRegistro(reg.id, { extras }); reg.extras = extras; inp.value = val ?? ''; showSuccess('Nota guardada.'); }
        catch (err) { showError('No se pudo guardar la nota (revisa las reglas de Firestore).'); inp.value = reg.extras?.[clave.slice(3)] ?? ''; }
        return;
      }
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
        res().registros.forEach(r => { (porPosicion[r.posicionKey] = porPosicion[r.posicionKey] || []).push(r); });
        const medias = {};
        Object.entries(porPosicion).forEach(([pk, regs]) => Object.assign(medias, calcularMediasPorJugador(regs, buildAspectoPorCompetencia(state, pk))));
        res().mediasPorJugador = medias;
        inp.value = val ?? '';
        showSuccess('Nota guardada.');
      } catch (err) {
        console.error('[Firestore] No se pudo guardar la nota:', err);
        showError('No se pudo guardar la nota (revisa las reglas de Firestore).');
        inp.value = reg.puntuaciones?.[clave] ?? '';
      }
    });
  });

  container.querySelectorAll('[data-reg-borrar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reg = (res()?.registros || []).find(r => r.id === btn.dataset.regBorrar);
      if (!reg) return;
      const p = state.players.find(x => x.id === reg.jugadorId);
      const quien = p ? `${p.nombre} ${p.apellidos}` : '(sin identificar)';
      if (!confirm(`¿Borrar solo este registro?\n\nJugador: ${quien}\nEvaluador: ${reg.evaluador || '—'}\n\nEl resto de la evaluación no se toca.`)) return;
      try {
        await eliminarRegistro(reg.id);
        res().registros = res().registros.filter(r => r.id !== reg.id);
        const porPosicion = {};
        res().registros.forEach(r => { (porPosicion[r.posicionKey] = porPosicion[r.posicionKey] || []).push(r); });
        const medias = {};
        Object.entries(porPosicion).forEach(([pk, regs]) => Object.assign(medias, calcularMediasPorJugador(regs, buildAspectoPorCompetencia(state, pk))));
        res().mediasPorJugador = medias;
        showSuccess('Registro borrado.');
        rerender();
      } catch (err) {
        console.error('[Firestore] No se pudo borrar el registro:', err);
        showError('No se pudo borrar el registro (revisa permisos o reglas de Firestore).');
      }
    });
  });
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

  wireRegistrosTabla(container, () => bbddResultado, () => renderBBDDSub(container));

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
    return `<tr><td>${safeText(a)}</td><td>${fmtDec(jugadorMedia.porAspecto[a]) ?? '-'}</td><td>${grupoAspecto != null ? fmtDec(grupoAspecto) : '-'}</td></tr>`;
  }).join('');
  return `
    <p class="text-xs text-muted mb-16">Grupo: ${n} jugador(es).</p>
    <table class="table table-compact">
      <thead><tr><th>Aspecto</th><th>Jugador</th><th>Media del grupo</th></tr></thead>
      <tbody>
        ${filas}
        <tr style="font-weight:700;"><td>General</td><td>${jugadorGeneral != null ? fmtDec(jugadorGeneral) : '-'}</td><td>${grupoMedia != null ? fmtDec(grupoMedia) : '-'}</td></tr>
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
      // Cada registro con el esquema de SU posición (una evaluación puede tener todas las posiciones).
      const porPos = {};
      registrosFiltrados.forEach(r => { const pk = r.posicionKey || compFiltros.posicionKey || ev?.posicionKey; (porPos[pk] = porPos[pk] || []).push(r); });
      const mediasPorJugador = {};
      Object.entries(porPos).forEach(([pk, regs]) => Object.assign(mediasPorJugador, calcularMediasPorJugador(regs, buildAspectoPorCompetencia(state, pk))));
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
  registroSubTab = subVisible('registro', registroSubTab);
  ensureEvaluacionesLoaded(container);
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="rm-sticky mb-16 flex gap-8" style="padding:6px 0;">
      ${puedeVer('registro.registro') ? `<button class="btn ${registroSubTab === 'registro' ? 'btn-primary' : 'btn-sm'}" data-registro-subtab="registro">Evaluaciones</button>` : ''}
      ${puedeVer('registro.bbdd') ? `<button class="btn ${registroSubTab === 'bbdd' ? 'btn-primary' : 'btn-sm'}" data-registro-subtab="bbdd">Buscar registros</button>` : ''}
      ${puedeVer('registro.comparativas') ? `<button class="btn ${registroSubTab === 'comparativas' ? 'btn-primary' : 'btn-sm'}" data-registro-subtab="comparativas">Comparativas</button>` : ''}
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
// Ctrl+V con el formulario de jugador abierto: si lo copiado es una imagen, va a la foto (un solo listener para toda la app).
let jugPegarFoto = null;
document.addEventListener('paste', e => {
  if (!jugPegarFoto || !document.getElementById('jug-foto')) return;
  const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (!item) return; // texto normal: se pega en el campo como siempre
  e.preventDefault();
  jugPegarFoto(item.getAsFile());
});
let jugImport = null; // alta masiva desde Excel/CSV: { columnas, filas:[{data, avisos, estado, crear}] } mientras se revisa
let condImport = null; // carga de datos condicionales: { evalId, columnas?, filas?:[{nombre, media, max, avisos, playerId}] }
let configCriteriaPosition = null;      // qué posición se está editando en "Items a evaluar"
let fichaTipoPosition = null;           // qué posición se está viendo en Configuración → Fichas tipo → Individual
// Menú lateral de Configuración: grupos plegados y menú oculto (se recuerdan).
// Por defecto todos los grupos plegados (salvo el de la pantalla abierta); se recuerdan los que abras.
let cfgGruposAbiertos = (() => { try { return JSON.parse(localStorage.getItem('rm-cfg-abiertos') || '[]'); } catch (_) { return []; } })();
let cfgMenuOculto = (() => { try { return localStorage.getItem('rm-cfg-menu-oculto') === '1'; } catch (_) { return false; } })();
let configSubTab = localStorage.getItem('rm-config-subtab') || 'posiciones'; // pestaña interna activa dentro de Configuración — persiste al refrescar

const CONFIG_GROUPS = [
  {
    label: 'Encuesta y criterios',
    tabs: [
      { key: 'posiciones',        label: 'Posiciones' },
      { key: 'items',             label: 'Aspectos por posición' },
      { key: 'columnas-encuesta', label: 'Columnas de la encuesta' },
      { key: 'condicional-refs',  label: 'Datos condicionales' },
      { key: 'evaluadores',       label: 'Evaluadores' },
      { key: 'frases',            label: 'Frases modelo' },
    ],
  },
  {
    label: 'Fichas',
    tabs: [
      { key: 'fichas-individual', label: 'Ficha individual' },
      { key: 'ficha-colores',     label: 'Colores de la ficha' },
      { key: 'colores',           label: 'Rango de colores' },
      { key: 'ficha-matriz',      label: 'Matriz' },
    ],
  },
  {
    label: 'Datos y ayuda',
    tabs: [
      { key: 'copia-seguridad', label: 'Copia de seguridad' },
      { key: 'flujo',           label: 'Cómo funciona (flujo)' },
    ],
  },
  {
    // Borrador guardado (no está conectado a las fichas): solo lo ve el super admin, plegado al final.
    label: 'En pruebas',
    soloSuper: true,
    tabs: [
      { key: 'fichas-espejo', label: 'Ficha espejo (borrador)' },
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
      ${cat.key !== 'condicional' ? `<button data-ren-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" title="Renombrar (sin cambiar de sitio)">✎</button>` : ''}
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
      <button data-ren-crit data-cat="tecnico" data-idx="${i}" title="Renombrar (sin cambiar de sitio)">✎</button>
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
      <button data-ren-crit data-cat="tactico" data-idx="${i}" title="Renombrar (sin cambiar de sitio)">✎</button>
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

// Columnas de la encuesta = la referencia. Antes de cambiar una lista de Items (mover, quitar, renombrar),
// se fijan las columnas tal como están, para que la encuesta no se descoloque. Devuelve el nuevo columnasEncuesta.
function congelarColumnasEncuesta(posiciones, { de = null, a = null, quitar = null } = {}) {
  const todo = JSON.parse(JSON.stringify(state.columnasEncuesta || {}));
  posiciones.forEach(pos => {
    todo[pos] = todo[pos] || {};
    columnasEfectivas(state, pos).forEach(c => {
      if (c.num <= 3) return;
      let { nombre, destino } = c;
      const base = String(destino || '').replace(/::[AB]$/, ''), suf = String(destino || '').slice(base.length);
      if (de && base === de) { destino = a + suf; if (nombre === de) nombre = a; }
      if (quitar && base === quitar) destino = '';
      todo[pos][c.num] = { ...(todo[pos][c.num] || {}), nombre, destino };
    });
  });
  return todo;
}

// Cambia un nombre de competencia/perfil en todo lo que lo usa dentro de un schema de posición.
function renombrarEnSchema(schema, de, a) {
  const r = arr => Array.isArray(arr) ? arr.map(x => x === de ? a : x) : arr;
  const out = { ...schema };
  ['tactico', 'tecnico', 'perfiles', 'competenciasOfensivas', 'competenciasDefensivas'].forEach(k => { if (out[k]) out[k] = r(out[k]); });
  if (out.perfilCompetencias) out.perfilCompetencias = Object.fromEntries(Object.entries(out.perfilCompetencias).map(([k, v]) => [k === de ? a : k, r(v)]));
  return out;
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
  // ↑↓ = mover en el Táctico (mismo orden en las dos listas, en la encuesta 7-18 y en Ficha 2)
  const boxes = tactico.map((label2, i) => `
    <div class="flex gap-8" style="align-items:center;">
      <span style="display:inline-flex;gap:2px;width:44px;flex-shrink:0;">
        <button class="btn btn-sm btn-ghost" style="padding:0 4px;" data-move-crit data-cat="tactico" data-idx="${i}" data-dir="-1" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm btn-ghost" style="padding:0 4px;" data-move-crit data-cat="tactico" data-idx="${i}" data-dir="1" title="Bajar" ${i === tactico.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
      <label class="flex gap-8" style="align-items:center;">
        <input type="checkbox" data-toggle-comp data-role="${role}" data-label="${safeText(label2)}" ${selected.includes(label2) ? 'checked' : ''} />
        <span class="text-xs">${safeText(label2)}</span>
      </label>
    </div>
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
      <button data-ren-crit data-cat="perfiles" data-idx="${i}" title="Renombrar (sin cambiar de sitio)">✎</button>
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

// Años en el club: se guarda el número que se metió y la temporada en que se metió
// (aniosClub, aniosClubTemporada); cada temporada posterior suma uno sola.
const inicioTemporada = t => parseInt(String(t || '').slice(0, 4), 10);
// Puede ser por etapas ("2+3": dos etapas en el club); solo la última suma cada temporada → "2+4".
function etapasAnios(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? [v] : null;
  const partes = String(v).split('+').map(x => x.trim());
  if (!partes.length || partes.some(x => !/^\d+$/.test(x))) return null;
  return partes.map(Number);
}
function aniosEnClub(p) {
  const et = etapasAnios(p?.aniosClub);
  if (!et) return null;
  const dif = inicioTemporada(state.season) - inicioTemporada(p.aniosClubTemporada || state.season);
  et[et.length - 1] = Math.max(0, et[et.length - 1] + (Number.isNaN(dif) ? 0 : dif));
  return et.length === 1 ? et[0] : et.join('+');
}

// Datos VARIABLES del jugador — llevan histórico (subcolección
// jugadores/{id}/historico): cada cambio se AÑADE, nunca se sobreescribe.
// Solo se registra un CAMBIO real (había un valor y pasa a otro distinto);
// rellenar un dato vacío no genera entrada. Entrada: { cambios:[{campo, antes, despues}], …foto actual }.
// El propio doc del jugador guarda el último valor (teamKey/positionKey/
// weight/height/complexion) como "espejo" para listar rápido, tal como
// ya se hacía con weight/height — solo se amplía el mismo patrón.
const HISTORICO_FIELDS = ['teamKey', 'positionKey', 'weight', 'height', 'complexion'];
const esVacio = v => v === null || v === undefined || v === '';
// Importar un Excel sobre jugadores que ya existen: solo se rellenan estos datos si en la ficha están vacíos.
// A quién va una fila importada: id de un jugador (se completa su ficha), 'nuevo' (se crea) o '' (sin elegir: no se aplica).
function asignarDestino(f, destino) {
  f.destino = destino;
  if (destino && destino !== 'nuevo') {
    const actual = state.players.find(p => p.id === destino) || {};
    f.playerId = destino;
    // Celda vacía → se queda lo que tenía; dato nuevo → se guarda; dato distinto → se actualiza.
    const patch = {}, cambios = [];
    CAMPOS_COMPLETAR.forEach(k => {
      if (esVacio(f.data[k])) return;
      const antes = k === 'aniosClub' ? aniosEnClub(actual) : actual[k];
      if (!esVacio(antes) && mismoValor(antes, f.data[k])) return;
      patch[k] = f.data[k];
      if (!esVacio(antes)) cambios.push({ k, antes, despues: f.data[k] });
    });
    if (patch.aniosClub != null) patch.aniosClubTemporada = state.season;
    f.completar = patch;
    f.cambios = cambios;
    f.condPend = condPendienteDe(f, { ...actual, teamKey: actual.teamKey || f.completar.teamKey || null });
    f.estado = Object.keys(f.completar).length || f.condPend ? 'completar' : 'existe';
  } else {
    f.playerId = null;
    f.completar = null;
    f.cambios = [];
    f.condPend = destino === 'nuevo' ? condPendienteDe(f, { teamKey: f.data.teamKey }) : null;
    f.estado = destino === 'nuevo' ? 'nuevo' : 'dudoso';
  }
  f.crear = f.estado === 'nuevo' || f.estado === 'completar';
}
// ¿Es el mismo dato? Números por valor; textos sin distinguir mayúsculas ni tildes.
const mismoValor = (a, b) => (typeof a === 'number' || typeof b === 'number')
  ? Number(a) === Number(b)
  : normalizeTxt(String(a ?? '').trim()) === normalizeTxt(String(b ?? '').trim());
// Datos condicionales que trae la misma fila del Excel de jugadores, para la evaluación elegida: los que el jugador
// no tiene o tiene distintos (celda vacía = no se toca). Alevín/infantil → símbolos; resto → números. null = nada que guardar.
function condPendienteDe(f, jugador) {
  const c = f.cond, evalId = jugImport?.evalId;
  if (!c || !evalId) return null;
  const esBase = esEquipoBase(jugador?.teamKey);
  const falta = (mapa, vals) => Object.fromEntries(Object.entries(vals || {}).filter(([k, v]) => esVacio(mapa?.[evalId]?.[k]) || !mismoValor(mapa[evalId][k], v)));
  const p = esBase ? { base: falta(jugador?.condicionalBasePorEval, c.base) }
    : { media: falta(jugador?.condicionalPorEval, c.media), max: falta(jugador?.condicionalMaxPorEval, c.max) };
  const n = Object.values(p).reduce((a, m) => a + Object.keys(m).length, 0);
  return n ? { ...p, esBase, n } : null;
}
// Guarda en la ficha los datos condicionales pendientes de una fila (mismo formato que la carga de datos condicionales).
async function guardarCondPend(id, cp, evalId) {
  const prev = state.players.find(p => p.id === id);
  if (!prev || !cp) return;
  const juntar = (campo, vals) => {
    const todo = JSON.parse(JSON.stringify(prev[campo] || {}));
    todo[evalId] = { ...(todo[evalId] || {}), ...vals };
    return todo;
  };
  const patch = cp.esBase ? { condicionalBasePorEval: juntar('condicionalBasePorEval', cp.base) }
    : { condicionalPorEval: juntar('condicionalPorEval', cp.media), condicionalMaxPorEval: juntar('condicionalMaxPorEval', cp.max) };
  if (!isFirebaseUnconfigured()) await updateDocument('jugadores', id, patch);
  setState({ players: state.players.map(p => p.id === id ? { ...p, ...patch } : p) });
  await registrarCambios(id, prev, patch);
}
// Residencia: Residencia, Madrid o Media pensión. Si no se ha puesto, es «Madrid».
// Los nombres antiguos guardados («Residente en Madrid», «En residencia») se leen como los nuevos.
const RESI_DEFECTO = 'Madrid';
const RESI_ANTIGUAS = { 'Residente en Madrid': 'Madrid', 'En residencia': 'Residencia' };
const residenciaDe = p => RESI_ANTIGUAS[p?.residencia] || p?.residencia || RESI_DEFECTO;
const CAMPOS_COMPLETAR = ['apellidos', 'birthDate', 'foot', 'residencia', 'maturationalAge', 'teamKey', 'positionKey', 'weight', 'height', 'complexion', 'aniosClub'];

// Cambios reales entre el jugador guardado (prev) y lo nuevo, incluidos los datos condicionales.
function cambiosHistorico(prev, nuevo) {
  const cambios = [];
  HISTORICO_FIELDS.forEach(f => {
    if (f in nuevo && !esVacio(prev[f]) && prev[f] !== (nuevo[f] ?? null)) cambios.push({ campo: f, antes: prev[f], despues: nuevo[f] ?? null });
  });
  [['condicionalPorEval', 'media'], ['condicionalMaxPorEval', 'max'], ['condicionalBasePorEval', 'base']].forEach(([k, tipo]) => {
    if (!nuevo[k]) return;
    Object.entries(prev[k] || {}).forEach(([evalId, items]) => Object.entries(items || {}).forEach(([item, antes]) => {
      const despues = nuevo[k][evalId]?.[item] ?? null;
      if (!esVacio(antes) && antes !== despues) cambios.push({ campo: 'condicional', tipo, evalId, item, antes, despues });
    }));
  });
  return cambios;
}

async function registrarCambios(id, prev, nuevo) {
  const cambios = cambiosHistorico(prev, nuevo);
  if (!cambios.length || isFirebaseUnconfigured()) return;
  const h = { cambios };
  HISTORICO_FIELDS.forEach(f => { h[f] = (f in nuevo ? nuevo[f] : prev[f]) ?? null; });
  await addSubDocument('jugadores', id, 'historico', h);
  delete jugadorHistoricoCache[id]; // se recarga la próxima vez que se abra
}

/** Evaluación que se propone por defecto al cargar datos: la más reciente (por fecha de fin o de inicio). */
function evalPorDefecto() {
  const evs = regEvaluaciones || [];
  if (!evs.length) return null;
  const clave = e => `${e.fechaFin || e.fechaInicio || ''}|${String(e.createdAt?.seconds || 0).padStart(12, '0')}`;
  return [...evs].sort((a, b) => clave(b).localeCompare(clave(a)))[0].id;
}

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
      <div class="card-title" style="display:flex;align-items:center;gap:10px;"><button class="btn btn-sm btn-ghost" type="button" id="jug-volver-form" title="Volver sin guardar (igual que Cancelar)">← Volver</button>${player ? 'Editar jugador' : 'Nuevo jugador'}</div>
      <div class="card-body">
        <div class="flex gap-12 mb-16" style="align-items:center;flex-wrap:wrap;">
          <img id="jug-foto-preview" src="${p.fotoUrl || ''}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--bg-hover);display:${p.fotoUrl ? 'block' : 'none'};" />
          <div class="field-group">
            <label class="label">Foto</label>
            <div class="flex gap-8" style="align-items:center;flex-wrap:wrap;">
              <span style="display:inline-flex;">
                <label class="btn btn-sm" style="cursor:pointer;border-top-right-radius:0;border-bottom-right-radius:0;" title="Elegir una imagen del ordenador">📁 Elegir foto<input type="file" id="jug-foto" accept="image/*" hidden /></label>
                <button class="btn btn-sm" type="button" id="jug-foto-pegar" style="border-top-left-radius:0;border-bottom-left-radius:0;margin-left:-1px;" title="Pega la imagen que hayas copiado (también vale Ctrl+V)">📋 Pegar</button>
              </span>
              <span class="text-xs text-muted" id="jug-foto-nombre">o copia una imagen y pulsa Ctrl+V</span>
            </div>
          </div>
          <div id="jug-crop" style="display:none;">
            <div id="jug-crop-view" style="width:180px;height:180px;border-radius:50%;overflow:hidden;position:relative;background:var(--bg-hover);cursor:grab;touch-action:none;border:2px solid var(--blue-500, #3b82f6);">
              <img id="jug-crop-img" alt="" draggable="false" style="position:absolute;left:0;top:0;max-width:none;user-select:none;pointer-events:none;" />
            </div>
            <input type="range" id="jug-crop-zoom" min="1" max="3" step="0.01" value="1" style="width:180px;display:block;margin-top:8px;" />
            <div class="text-xs text-muted">Arrastra para mover · desliza para ampliar</div>
          </div>
        </div>
        <details class="mb-16" id="jug-pegar-box">
          <summary class="text-sm" style="cursor:pointer;font-weight:600;">📋 Rellenar pegando sus datos desde Excel o una lista</summary>
          <p class="text-xs text-muted" style="margin:8px 0;">Pega la fila de títulos y la fila del jugador (copiadas de Excel), o una lista con un dato por línea: <code>Peso	72</code>, <code>V.MAX.	31,5</code>, <code>Coordinación	✔</code>… Se rellenan los campos de abajo (los condicionales, en la evaluación elegida más abajo); revisa y pulsa Guardar.</p>
          <textarea class="input" id="jug-pegar-texto" rows="4" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
          <button class="btn btn-sm btn-primary mt-8" type="button" id="jug-pegar-ok">Rellenar formulario</button>
        </details>
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
              ${['Residencia', 'Madrid', 'Media pensión'].map(v => `<option value="${v}" ${residenciaDe(p) === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Edad madurativa</label>
            <input class="input" type="text" id="jug-maturational" value="${safeText(p.maturationalAge ?? '')}" />
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Años en el club</label>
            <input class="input" type="text" inputmode="numeric" id="jug-anios-club" value="${aniosEnClub(p) ?? ''}" placeholder="Ej. 3 o 2+3" title="Temporada ${safeText(state.season)}: cada temporada siguiente suma uno sola. Si estuvo en varias etapas: 2+3 (la última etapa es la que suma)." />
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
        ${esEquipoBase(p.teamKey) ? `
        <div class="text-xs text-muted mt-16 mb-8" style="font-weight:700;text-transform:uppercase;">Condicional (alevines e infantiles → Ficha 2 con símbolos)</div>
        ${(regEvaluaciones || []).length ? `
        <div class="field-group mb-8" style="min-width:260px;max-width:360px;">
          <label class="label">Evaluación</label>
          <select class="select" id="jug-cond-eval">${regEvaluaciones.map(e => `<option value="${e.id}" ${e.id === evalPorDefecto() ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
        </div>
        <div style="overflow-x:auto;"><table class="table table-compact" style="max-width:520px;">
          <thead><tr><th>Capacidad</th><th>Valoración</th></tr></thead>
          <tbody>${CONDICIONAL_BASE.map(item => `
            <tr><td>${safeText(item)}</td>
              <td><select class="select" data-jug-cbase="${safeText(slugify(item))}" style="width:130px;">
                <option value="">—</option><option value="ok">✔ Bien</option><option value="dash">▬ Regular</option><option value="fail">✘ Mal</option>
              </select></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="text-xs text-muted">Crea primero una evaluación (Evaluaciones) para poder guardar datos condicionales.</p>'}`
        : (state.aspectosComunes.condicional || []).length ? `
        <div class="text-xs text-muted mt-16 mb-8" style="font-weight:700;text-transform:uppercase;">Datos condicionales del jugador (media y máxima por evaluación → Ficha 2, columnas 1 y 2)</div>
        ${(regEvaluaciones || []).length ? `
        <div class="field-group mb-8" style="min-width:260px;max-width:360px;">
          <label class="label">Evaluación</label>
          <select class="select" id="jug-cond-eval">${regEvaluaciones.map(e => `<option value="${e.id}" ${e.id === evalPorDefecto() ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
        </div>
        <div style="overflow-x:auto;"><table class="table table-compact" style="max-width:520px;">
          <thead><tr><th>Ítem condicional</th><th>Media</th><th>Máxima</th></tr></thead>
          <tbody>${state.aspectosComunes.condicional.map(item => `
            <tr><td>${safeText(item)}</td>
              <td><input class="input" type="text" inputmode="decimal" style="width:90px;" data-jug-cond="${safeText(slugify(item))}" value="" /></td>
              <td><input class="input" type="text" inputmode="decimal" style="width:90px;" data-jug-condmax="${safeText(slugify(item))}" value="" /></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="text-xs text-muted">Crea primero una evaluación (Evaluaciones) para poder guardar datos condicionales.</p>'}` : ''}
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="jug-save">${player ? 'Guardar cambios' : 'Añadir jugador'}</button>
          <button class="btn btn-ghost" id="jug-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function textoCambio(c) {
  const num = v => String(v).replace('.', ',');
  const val = v => {
    if (esVacio(v)) return '—';
    if (c.campo === 'teamKey') return safeText(TEAMS.find(t => t.key === v)?.label || v);
    if (c.campo === 'positionKey') return safeText(state.positions.find(p => p.key === v)?.label || v);
    if (c.campo === 'weight') return num(v) + ' kg';
    if (c.campo === 'height') return num(v) + ' m';
    if (c.campo === 'condicional') return c.tipo === 'base' ? (SIMBOLO_TXT[v] || v) : num(v);
    return safeText(v);
  };
  let etiqueta = { teamKey: 'Equipo', positionKey: 'Posición', weight: 'Peso', height: 'Altura', complexion: 'Complexión' }[c.campo];
  if (c.campo === 'condicional') {
    const item = [...(state.aspectosComunes.condicional || []), ...CONDICIONAL_BASE].find(x => slugify(x) === c.item) || c.item;
    const ev = (regEvaluaciones || []).find(e => e.id === c.evalId);
    etiqueta = `Condicional · ${safeText(item)}${c.tipo === 'max' ? ' (máx.)' : ''}${ev ? ` · ${safeText([ev.temporada, ev.nombre].filter(Boolean).join(' '))}` : ''}`;
  }
  return `${etiqueta}: ${val(c.antes)} → <strong>${val(c.despues)}</strong>`;
}

function buildHistoricoHTML(entries) {
  // Entradas antiguas (solo foto de los datos): se comparan con la anterior y se muestran solo los cambios reales.
  const asc = [...entries].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  const filas = [];
  let anterior = null;
  asc.forEach(e => {
    const cambios = e.cambios || (anterior
      ? HISTORICO_FIELDS.filter(f => !esVacio(anterior[f]) && anterior[f] !== (e[f] ?? null)).map(f => ({ campo: f, antes: anterior[f], despues: e[f] ?? null }))
      : []);
    anterior = e;
    if (cambios.length) filas.push({ e, cambios });
  });
  if (!filas.length) return '<p class="text-xs text-muted">Sin cambios registrados todavía.</p>';
  const rows = filas.reverse().map(({ e, cambios }) => {
    const fecha = e.createdAt?.seconds ? new Date(e.createdAt.seconds * 1000).toLocaleDateString('es-ES') : '-';
    return `<tr><td style="white-space:nowrap;">${fecha}</td><td>${cambios.map(textoCambio).join('<br>')}</td></tr>`;
  }).join('');
  return `<table class="table table-compact"><tbody>${rows}</tbody></table>`;
}

// ── Jugadores: filtros + ficha de jugador ──────────
let jugFiltros = { q: '', teamKey: '', positionKey: '', year: '', foot: '', resi: '' };
let jugVolverA = null;             // 'plantillas' | 'registro': pestaña desde la que se abrió la ficha (botón Volver)
let jugVolverScroll = 0;           // posición de la página al salir, para volver al mismo sitio
let jugFichaId = null;             // null = lista; <id> = ficha de ese jugador abierta
const jugFichaRegs = {};           // { [playerId]: registros[] } — evaluaciones recibidas
const jugFichaLoading = new Set(); // evita lanzar la misma carga dos veces

let jugMasCierreGlobal = false; // listener único para cerrar el menú ⋯ al pulsar fuera
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
  if (f.resi && residenciaDe(p) !== f.resi) return false;
  return true;
}

function buildJugadoresFiltrosHTML() {
  const years = [...new Set(state.players.map(p => calcAgeAndYear(p.birthDate).year).filter(Boolean))].sort((a, b) => b - a);
  const sel = (id, label, opts, val, ancho = 170) => `
    <select class="select" id="${id}" aria-label="${label}" style="width:auto;min-width:${ancho}px;${val ? 'border-color:var(--blue-500, #3b82f6);font-weight:600;' : ''}"><option value="">${label}: todos</option>${opts.map(([v, l]) => `<option value="${safeText(String(v))}" ${String(val) === String(v) ? 'selected' : ''}>${safeText(l)}</option>`).join('')}</select>`;
  const masActivos = [jugFiltros.year, jugFiltros.foot, jugFiltros.resi].filter(Boolean).length;
  const hayFiltros = jugFiltros.q || jugFiltros.teamKey || jugFiltros.positionKey || masActivos;
  return `
    <div class="card mb-16 rm-sticky"><div class="card-body" style="padding-top:12px;padding-bottom:12px;">
      <div class="flex gap-8" style="flex-wrap:wrap;align-items:center;">
        <input class="input" type="text" id="jug-f-q" value="${safeText(jugFiltros.q)}" placeholder="🔎 Buscar por nombre o apellidos" aria-label="Buscar por nombre o apellidos" style="flex:1 1 240px;min-width:200px;" />
        ${sel('jug-f-team', 'Equipo', TEAMS.map(t => [t.key, t.label]), jugFiltros.teamKey)}
        ${sel('jug-f-pos', 'Posición', state.positions.map(p => [p.key, p.label]), jugFiltros.positionKey)}
        <details ${masActivos ? 'open' : ''} style="position:relative;">
          <summary class="btn btn-sm" style="list-style:none;cursor:pointer;">Más filtros${masActivos ? ` (${masActivos})` : ''} ▾</summary>
          <div class="flex gap-8" style="margin-top:8px;flex-wrap:wrap;">
            ${sel('jug-f-year', 'Año nacimiento', years.map(y => [y, String(y)]), jugFiltros.year, 150)}
            ${sel('jug-f-foot', 'Lateralidad', ['Diestro', 'Zurdo', 'Ambidiestro'].map(x => [x, x]), jugFiltros.foot, 150)}
            ${sel('jug-f-resi', 'Residencia', ['Residencia', 'Madrid', 'Media pensión'].map(x => [x, x]), jugFiltros.resi, 150)}
          </div>
        </details>
        ${hayFiltros ? '<button class="btn btn-sm btn-ghost" id="jug-f-clear">Limpiar filtros</button>' : ''}
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
const JUG_REF_QUIEN = [['', 'Sin comparar'], ['team', 'Mismo equipo'], ['gen', 'Misma generación'], ['jug', 'Un jugador concreto…']];
const JUG_REF_LS = 'rm-perfiles.jugRef';
let jugRef = { who: '', when: 'eval', jugId: '', evalId: '' };   // comparación elegida para las medias de la Ficha 2 (se recuerda entre fichas y recargas)
try { const g = JSON.parse(localStorage.getItem(JUG_REF_LS) || 'null'); if (g && typeof g === 'object') jugRef = { ...jugRef, ...g }; if (jugRef.who === 'pos') jugRef.who = ''; } catch (_) { /* sin localStorage: no se recuerda */ }
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
      // Siempre misma posición; "esta evaluación" la acota además a la evaluación abierta.
      const filtros = { posicionKey: evSel.posKey, ...(when === 'eval' ? { evaluacionId: evSel.eid } : when.startsWith('temp:') ? { temporada: when.slice(5) } : {}) };
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
  const fmt = v => v == null ? '—' : fmtDec(v);
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
      const posKey = posicionDeRegistros(rs, ev);
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
      filasEval.push({ eid, ev, posKey: p.positionKey || ev.posicionKey, n: 0, media: null, orden: `${ev.fechaFin || ev.fechaInicio || ''}|${String(idx).padStart(5, '0')}` });
    });
    filasEval.sort((x, y) => String(y.orden).localeCompare(String(x.orden)));
  }
  // Por defecto, la final con notas de la encuesta (una evaluación con solo datos condicionales no tapa las medias).
  const evSel = filasEval.find(f => f.eid === jugFichaEvalId) || filasEval.find(f => f.media) || filasEval[0] || null;

  // ── Pestaña "Datos personales"
  const items = state.aspectosComunes.condicional || [];
  const porEval = p.condicionalPorEval || {};
  const porEvalMax = p.condicionalMaxPorEval || {};
  const evCond = [...new Set([...Object.keys(porEval), ...Object.keys(porEvalMax)])].filter(eid => Object.keys(porEval[eid] || {}).length || Object.keys(porEvalMax[eid] || {}).length);
  const porEvalBase = p.condicionalBasePorEval || {};
  const evBase = Object.keys(porEvalBase).filter(eid => Object.keys(porEvalBase[eid] || {}).length);
  const condHTML = esEquipoBase(p.teamKey) ? (evBase.length ? `
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Evaluación</th>${CONDICIONAL_BASE.map(i => `<th>${safeText(i)}</th>`).join('')}</tr></thead>
      <tbody>${evBase.map(eid => `<tr><td>${safeText(evLabel(eid))}</td>${CONDICIONAL_BASE.map(i => `<td style="text-align:center;font-weight:700;">${SIMBOLO_TXT[porEvalBase[eid]?.[slugify(i)]] || '—'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>` : '<p class="text-xs text-muted">Sin datos condicionales. Se ponen en Editar o pulsando los símbolos de la Ficha 2.</p>')
  : evCond.length ? `
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
    <div class="card mb-16"><div class="card-title">Datos personales${esSuperadmin() && !isFirebaseUnconfigured() ? ' <button class="btn btn-sm" id="jug-rgpd-export" style="float:right;" title="Todos los datos guardados de este jugador (derecho de acceso RGPD)">⬇ Exportar sus datos</button>' : ''}</div><div class="card-body">
      <div class="flex gap-24" style="flex-wrap:wrap;">
        ${dato('Nombre', p.nombre)}${dato('Apellidos', p.apellidos)}${dato('Equipo', teamLabel)}${dato('Posición', posLabel)}
        ${dato('Fecha de nacimiento', p.birthDate)}${dato('Año', year)}${dato('Edad', age != null ? age + ' años' : null)}
        ${dato('Lateralidad', p.foot)}${residenciaDe(p) !== RESI_DEFECTO ? dato('Residencia', residenciaDe(p)) : ''}${dato('Edad madurativa', p.maturationalAge)}${dato('Años en el club', aniosEnClub(p))}
        ${dato('Peso', p.weight != null ? fmtDec(p.weight) + ' kg' : null)}${dato('Altura', p.height != null ? fmtDec(p.height) + ' m' : null)}${dato('Complexión', p.complexion)}
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
  const mediaRP = k => { const v = regsEval.map(r => r.rp?.[k]).filter(x => typeof x === 'number'); if (!v.length) return null; const m = v.reduce((x, y) => x + y, 0) / v.length; return fmtDec(m); };
  const aspectosTxt = {
    desc: guardadosTxt?.desc || '',
    rp: { r: mediaRP('r'), p: mediaRP('p') },
    ofensivos: { potenciar: cinco(origenTxt('of_pot')), mejorar: cinco(origenTxt('of_mej')) },
    defensivos: { potenciar: cinco(origenTxt('def_pot')), mejorar: cinco(origenTxt('def_mej')) },
  };

  if (jugFichaTab === 'ficha1' || jugFichaTab === 'ficha2') jugFichaTab = 'fichas';
  jugFichaTab = subVisible('jugadores', jugFichaTab);
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
        <button class="btn btn-sm" id="jug-desc-ia" title="La IA escribe una propuesta con sus notas y los comentarios de los evaluadores. Revísala y pulsa Guardar textos.">✨ Proponer descripción</button>
        <button class="btn btn-sm btn-primary" id="jug-textos-guardar">💾 Guardar textos</button>
        <button class="btn btn-sm" id="jug-textos-restaurar" ${p.fichaTextos?.[textosKey] ? '' : 'disabled'}>Restaurar desde la encuesta</button>
        <span class="text-xs text-muted">Descripción y ofensivos/defensivos a potenciar y mejorar: edítalos en la ficha y pulsa Guardar textos.${textosExtra ? ` Hay ${textosExtra} respuestas más de las que caben (5 filas).` : ''}</span>
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
      <button class="btn btn-ghost" id="jug-ficha-volver">${jugVolverA === 'plantillas' ? '← Volver a Equipos' : jugVolverA === 'registro' ? '← Volver a Evaluaciones' : '← Volver a la lista'}</button>
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
      ${puedeVer('jugadores.datos') ? `<button class="btn ${jugFichaTab === 'datos' ? 'btn-primary' : 'btn-sm'}" data-jug-tab="datos">Datos personales</button>` : ''}
      ${puedeVer('jugadores.fichas') ? `<button class="btn ${jugFichaTab === 'fichas' ? 'btn-primary' : 'btn-sm'}" data-jug-tab="fichas">Ficha 1 y Ficha 2</button>` : ''}
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
  const f1Jug = container.querySelector('#jug-ficha1-wrap'), f2Jug = container.querySelector('#jug-ficha2-wrap');
  container.querySelector('#jug-textos-guardar')?.addEventListener('click', e => guardarTextosFicha(p, textosKey, f1Jug, f2Jug, { btn: e.currentTarget, aviso: true }));
  autoGuardarTextosFicha([f1Jug, f2Jug], () => guardarTextosFicha(p, textosKey, f1Jug, f2Jug, { pendienteBtn: container.querySelector('#jug-textos-guardar') }), container.querySelector('#jug-textos-guardar'));
  container.querySelector('#jug-desc-ia')?.addEventListener('click', e => proponerDescripcion(e.currentTarget, container.querySelector('#jug-ficha1-wrap .p1-desc-text'), p, evSel, aspectosTxt, container.querySelector('#jug-textos-guardar')));
  container.querySelector('#jug-textos-restaurar')?.addEventListener('click', async () => {
    // Vuelven los 4 textos de la encuesta; la descripción y el plan de acción se conservan.
    const actual = p.fichaTextos?.[textosKey] || {};
    const resto = {}; if (actual.desc) resto.desc = actual.desc; if (actual.plan) resto.plan = actual.plan;
    const fichaTextos = { ...(p.fichaTextos || {}) };
    if (Object.keys(resto).length) fichaTextos[textosKey] = resto; else delete fichaTextos[textosKey];
    try {
      await updateMapEntry('jugadores', id, 'fichaTextos', textosKey, Object.keys(resto).length ? resto : null);
      setState({ players: state.players.map(x => x.id === id ? { ...x, fichaTextos } : x) });
      renderPanelJugadores(container);
    } catch (err) { showError('No se pudo restaurar.'); }
  });
  container.querySelector('#jug-rgpd-export')?.addEventListener('click', async () => {
    try { await exportarJugador(p); auditar('exportar', `datos de ${nombreCompleto(p)}`); }
    catch (err) { console.error('[RGPD] Exportar:', err); showError('No se pudo exportar.'); }
  });
  container.querySelectorAll('[data-jug-tab]').forEach(btn => btn.addEventListener('click', () => {
    jugFichaTab = btn.dataset.jugTab;
    preservandoScroll(() => renderPanelJugadores(container));
  }));
  [['who', '#jug-ref-who'], ['when', '#jug-ref-when'], ['jugId', '#jug-ref-jug'], ['evalId', '#jug-ref-eval']].forEach(([campo, sel]) => {
    container.querySelector(sel)?.addEventListener('change', e => {
      jugRef = { ...jugRef, [campo]: e.target.value };
      try { localStorage.setItem(JUG_REF_LS, JSON.stringify(jugRef)); } catch (_) { /* ignorar */ }
      preservandoScroll(() => renderPanelJugadores(container));
    });
  });
  container.querySelector('#jug-ficha-eval')?.addEventListener('change', e => {
    jugFichaEvalId = e.target.value;
    preservandoScroll(() => renderPanelJugadores(container));
  });
  container.querySelector('#jug-ficha-volver')?.addEventListener('click', () => {
    jugFichaId = null;
    if (jugVolverA === 'plantillas' || jugVolverA === 'registro') {
      const destino = jugVolverA, y = jugVolverScroll;
      jugVolverA = null; switchTab(destino);
      setTimeout(() => window.scrollTo(0, y), 60); // vuelve a donde estaba
      return;
    }
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

// Vista previa del alta masiva: qué columnas se han reconocido y qué jugadores se van a crear.
// Formato que espera una importación: vista tipo Excel (letra de columna, fila 1 = títulos, fila 2 = ejemplo)
// y, debajo, qué va en cada columna. cols: [{ titulo, ejemplo, nota }]
function formatoImportHTML(cols, intro) {
  const letra = i => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
  const celda = 'border:1px solid var(--border-default);padding:4px 8px;white-space:nowrap;';
  const cab = `${celda}background:var(--bg-hover);color:var(--text-muted);text-align:center;font-weight:600;`;
  return `
    <div class="mb-16">
      <p class="text-sm mb-8"><strong>Así tiene que ser el archivo:</strong> ${intro}</p>
      <div style="overflow-x:auto;">
        <table style="border-collapse:collapse;font-size:12px;">
          <tr><td style="${cab}"></td>${cols.map((_, i) => `<td style="${cab}">${letra(i)}</td>`).join('')}</tr>
          <tr><td style="${cab}">1</td>${cols.map(c => `<td style="${celda}font-weight:700;${c.nota ? 'cursor:help;' : ''}" title="${safeText(String(c.nota || '').replace(/<[^>]+>/g, ''))}">${safeText(c.titulo)}</td>`).join('')}</tr>
          <tr><td style="${cab}">2</td>${cols.map(c => `<td style="${celda}color:var(--text-muted);">${safeText(c.ejemplo ?? '')}</td>`).join('')}</tr>
        </table>
      </div>
      <p class="text-xs text-muted" style="margin:6px 0 0;">Pasa el ratón por un título para ver qué poner.</p>
    </div>`;
}

function columnasPlantillaJugadores() {
  return [
    { titulo: 'Nombre', ejemplo: 'Alfredo', nota: '<strong>obligatoria</strong>.' },
    { titulo: 'Apellidos', ejemplo: 'Sotres García' },
    { titulo: 'Fecha de nacimiento', ejemplo: '15/03/2004', nota: 'dd/mm/aaaa (o fecha de Excel).' },
    { titulo: 'Lateralidad', ejemplo: 'Diestro', nota: 'Diestro, Zurdo o Ambidiestro.' },
    { titulo: 'Residencia', ejemplo: 'Residencia', nota: 'Residencia, Madrid o Media pensión (vacía = Madrid).' },
    { titulo: 'Edad madurativa', ejemplo: '' },
    { titulo: 'Años en el club', ejemplo: '3', nota: 'número entero (3) o por etapas (2+3); cada temporada siguiente suma uno a la última etapa.' },
    { titulo: 'Equipo', ejemplo: TEAMS[1]?.label || '', nota: 'uno de: ' + TEAMS.map(t => safeText(t.label)).join(', ') + '.' },
    { titulo: 'Posición', ejemplo: state.positions[0]?.label || '', nota: 'una de: ' + state.positions.map(p => safeText(p.label)).join(', ') + '.' },
    { titulo: 'Peso', ejemplo: '78,5', nota: 'en kg.' },
    { titulo: 'Altura', ejemplo: '1,85', nota: 'en metros (1,85) o centímetros (185).' },
    { titulo: 'Complexión', ejemplo: '' },
    // Opcional: datos condicionales en el mismo Excel (se elige la evaluación al importar). Sin la columna Jugador ni lo que ya es dato personal.
    ...columnasPlantillaCondicional().slice(1).filter(c => !campoDeCabecera(c.titulo))
      .map(c => ({ ...c, nota: `condicional (opcional): ${c.nota}` })),
  ];
}

function buildJugImportHTML() {
  const evs = regEvaluaciones || [];
  if (!jugImport.filas) {
    return `
    <div class="card mb-16">
      <div class="card-title" style="display:flex;align-items:center;gap:10px;"><button class="btn btn-sm btn-ghost" type="button" data-jimp-volver>← Volver</button>📥 Cargar datos de jugadores</div>
      <div class="card-body">
        <p class="text-sm mb-16">Un solo Excel con todos los datos del jugador (personales, años en el club y condicionales). Al subirlo: <b>jugador nuevo</b> → se crea; <b>celda con dato</b> → se guarda o, si es distinto, se actualiza; <b>celda vacía</b> → no se toca lo que ya tiene.</p>
        ${evs.length ? `<div class="field-group mb-16" style="max-width:420px;"><label class="label">1 · Evaluación de los datos condicionales</label>
          <select class="select" id="jimp-eval0">${evs.map(e => `<option value="${e.id}" ${e.id === (jugImport.evalInicial || evalPorDefecto()) ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select></div>`
        : '<p class="text-xs text-muted mb-16">No hay evaluaciones: los datos condicionales no se podrán guardar hasta crear una en Evaluaciones.</p>'}
        <div class="label">${evs.length ? '2' : '1'} · Descarga el Excel</div>
        <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          <button class="btn btn-primary" id="jimp-exportar" title="Los jugadores del listado (con los filtros que tengas puestos) y sus datos actuales: edítalo y vuelve a subirlo">⬇ Excel con los datos actuales (${jugadoresListado().length} jugadores)</button>
          <button class="btn" id="jimp-plantilla">⬇ Excel vacío</button>
        </div>
        <div class="label">${evs.length ? '3' : '2'} · Súbelo o pega el texto</div>
        <input class="input" type="file" id="jug-import-file" accept=".xlsx,.xls,.csv" />
        <textarea class="input" id="jimp-texto" rows="5" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px;" placeholder="…o pega aquí las filas copiadas de Excel (con la fila de títulos)"></textarea>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-primary" id="jimp-leer">Leer texto pegado</button>
          <button class="btn" id="jimp-ia" title="Para listas escritas sin columnas: la IA las ordena">🤖 Leer texto con IA</button>
          <label class="btn" style="cursor:pointer;" title="Foto o captura de una tabla o lista (también puedes pegarla con Ctrl+V en el cuadro de texto)">📷 Leer foto con IA<input type="file" id="jimp-foto" accept="image/*" style="display:none;" /></label>
          <button class="btn btn-ghost" id="jimp-cancel">Cancelar</button>
        </div>
        <p class="text-xs text-muted mt-8" id="jimp-ia-estado">Con IA: antes de guardar siempre ves la vista previa para revisarla.</p>
        <details class="mt-16">
          <summary class="text-sm" style="cursor:pointer;font-weight:600;">ℹ Columnas que reconoce</summary>
          <div style="margin-top:8px;">${formatoImportHTML(columnasPlantillaJugadores(), 'una fila por jugador; la fila 1 con estos títulos (el orden da igual y puedes quitar las columnas que no tengas).')}</div>
        </details>
        ${evs.length > 1 ? `<details class="mt-8">
          <summary class="text-sm" style="cursor:pointer;font-weight:600;">↔ ¿Cargaste los datos condicionales en otra evaluación? Moverlos</summary>
          <div class="flex gap-8 mt-8" style="align-items:center;flex-wrap:wrap;">
            <span class="text-sm">De</span>
            <select class="select" id="cimp-mov-de" style="max-width:280px;">${evs.map(e => `<option value="${e.id}">${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
            <span class="text-sm">a</span>
            <select class="select" id="cimp-mov-a" style="max-width:280px;">${evs.map(e => `<option value="${e.id}" ${e.id === evalPorDefecto() ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
            <button class="btn btn-sm" id="cimp-mover">Mover</button>
          </div>
          <p class="text-xs text-muted" style="margin-top:6px;">Pasa los datos condicionales (números y ✔▬✘) de todos los jugadores de la primera evaluación a la segunda. Si en la de destino ya había un dato, se queda el de destino.</p>
        </details>` : ''}
      </div>
    </div>`;
  }
  const { columnas, filas } = jugImport;
  const condCols = jugImport.condColumnas || [];
  const condHTML = !condCols.length ? '' : `
        <div class="flex gap-8 mb-8" style="align-items:center;flex-wrap:wrap;">
          <span class="text-xs"><strong>Datos condicionales</strong> (${condCols.map(c => safeText(c.titulo)).join(', ')}) →</span>
          ${evs.length ? `<select class="select" id="jimp-eval" style="max-width:320px;min-height:30px;font-size:12px;">${evs.map(e => `<option value="${e.id}" ${e.id === jugImport.evalId ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
            <span class="text-xs text-muted">alevín/infantil: ✔ ▬ ✘; resto: números. Solo se rellenan los que falten en esa evaluación.</span>`
          : '<span class="text-xs" style="color:#f59e0b;">no hay evaluaciones: crea una en Evaluaciones para guardarlos (los demás datos sí se guardan).</span>'}
        </div>`;
  const resumenCond = f => {
    const cp = f.condPend; if (!cp) return '';
    const etiqueta = clave => condCols.find(c => slugify(c.base || '') === clave || slugify(c.item || '') === clave);
    const partes = cp.esBase
      ? Object.entries(cp.base).map(([k, v]) => `${etiqueta(k)?.base || k} ${SIMBOLO_TXT[v] || v}`)
      : [...Object.entries(cp.media).map(([k, v]) => `${etiqueta(k)?.item || k} ${String(v).replace('.', ',')}`), ...Object.entries(cp.max).map(([k, v]) => `${etiqueta(k)?.item || k} máx ${String(v).replace('.', ',')}`)];
    return `<span title="${safeText(partes.join(' · '))}">${cp.n} dato${cp.n === 1 ? '' : 's'}${cp.esBase ? ' ✔▬✘' : ''}</span>`;
  };
  // "Añade: … · Cambia: Peso 70 → 78,5" en las fichas que ya existen.
  const valTxt = (k, v) => k === 'teamKey' ? (TEAMS.find(t => t.key === v)?.label || v) : k === 'positionKey' ? (state.positions.find(x => x.key === v)?.label || v)
    : k === 'birthDate' ? String(v).split('-').reverse().join('/') : typeof v === 'number' ? String(v).replace('.', ',') : v;
  const textoActualiza = f => {
    const cambiadas = new Set((f.cambios || []).map(c => c.k));
    const nuevos = Object.keys(f.completar || {}).filter(k => CAMPO_LABEL[k] && !cambiadas.has(k)).map(k => CAMPO_LABEL[k]);
    if (f.condPend) nuevos.push(`datos condicionales (${f.condPend.n})`);
    const cambios = (f.cambios || []).map(c => `${CAMPO_LABEL[c.k]} ${safeText(valTxt(c.k, c.antes))} → <b>${safeText(valTxt(c.k, c.despues))}</b>`);
    return `<div class="text-xs text-muted">${nuevos.length ? `Añade: ${nuevos.map(safeText).join(', ')}` : ''}${nuevos.length && cambios.length ? '<br>' : ''}${cambios.length ? `Cambia: ${cambios.join(', ')}` : ''}</div>`;
  };
  const reconocidas = columnas.filter(c => c.campo).map(c => `${safeText(c.titulo)} → ${CAMPO_LABEL[c.campo]}`).join(' · ');
  const ignoradas = columnas.filter(c => !c.campo && c.titulo && !condCols.some(cc => cc.titulo === c.titulo)).map(c => safeText(c.titulo)).join(', ');
  const n = filas.filter(f => f.crear).length;
  const nCompletar = filas.filter(f => f.crear && f.estado === 'completar').length;
  const todosOrdenados = [...state.players].sort(ordenJugadores); // la lista muestra "Apellidos, Nombre"
  const nCrear = n - nCompletar;
  const textoBoton = [nCrear ? `Crear ${nCrear} jugador${nCrear === 1 ? '' : 'es'}` : '', nCompletar ? `actualizar ${nCompletar} ficha${nCompletar === 1 ? '' : 's'}` : ''].filter(Boolean).join(' y ') || 'Nada que aplicar';
  const ESTADO = {
    nuevo:    '<span class="badge badge-green">Nuevo</span>',
    existe:   '<span class="badge badge-gray">Sin cambios</span>',
    completar: '<span class="badge badge-blue">Actualizar ficha</span>',
    dudoso:   '<span class="badge badge-gold">Elige el jugador</span>',
    repetido: '<span class="badge badge-gray">Repetido en el archivo</span>',
  };
  return `
    <div class="card mb-16">
      <div class="card-title" style="display:flex;align-items:center;gap:10px;"><button class="btn btn-sm btn-ghost" type="button" data-jimp-volver>← Volver</button>Importar jugadores (${filas.length} en el archivo)</div>
      <div class="card-body">
        <p class="text-xs text-muted mb-8"><strong>Columnas reconocidas:</strong> ${reconocidas}${ignoradas ? `<br><strong>Ignoradas:</strong> ${ignoradas}` : ''}</p>${condHTML}
        <p class="text-xs text-muted mb-8">Se aplican los marcados: los <b>nuevos</b> se crean; en los que <b>ya existen</b>, cada celda con dato se guarda y, si es distinto al que tenían, <b>se actualiza</b> (queda en el histórico). Las <b>celdas vacías no borran nada</b>. Las fotos se suben desde el listado.</p>
        <div style="overflow-x:auto;max-height:420px;overflow-y:auto;">
          <table class="table table-compact">
            <thead><tr><th><input type="checkbox" id="jimp-all" ${n === filas.length ? 'checked' : ''} /></th><th>Nombre</th><th>Apellidos</th><th>Jugador de la app</th><th>Nacimiento</th><th>Equipo</th><th>Posición</th><th>Peso</th><th>Altura</th><th>Años club</th>${condCols.length ? '<th>Condicional</th>' : ''}<th>Estado</th><th>Avisos</th></tr></thead>
            <tbody>${filas.map((f, i) => `
              <tr>
                <td><input type="checkbox" data-jimp-i="${i}" ${f.crear ? 'checked' : ''} ${f.estado === 'dudoso' ? 'disabled title="Elige primero el jugador"' : f.estado === 'existe' ? 'disabled title="El archivo no trae nada nuevo ni distinto para este jugador"' : ''} /></td>
                <td>${safeText(f.data.nombre)}</td>
                <td>${safeText(f.data.apellidos)}</td>
                <td>${f.estado === 'repetido' ? '' : `<select class="select" data-jimp-dest="${i}" style="min-width:210px;font-size:12px;min-height:30px;${f.estado === 'dudoso' ? 'border-color:#f59e0b;' : ''}">
                  ${f.destino === '' ? '<option value="" selected>— elige jugador —</option>' : ''}
                  <option value="nuevo" ${f.destino === 'nuevo' ? 'selected' : ''}>＋ Crear como nuevo</option>
                  ${(f.candidatos || []).length ? `<optgroup label="Parecidos">${f.candidatos.map(id => { const j = state.players.find(x => x.id === id); return j ? `<option value="${id}" ${f.destino === id ? 'selected' : ''}>${safeText(nombreCompleto(j))}</option>` : ''; }).join('')}</optgroup>` : ''}
                  <optgroup label="Todos">${todosOrdenados.filter(j => !(f.candidatos || []).includes(j.id)).map(j => `<option value="${j.id}" ${f.destino === j.id ? 'selected' : ''}>${safeText(nombreCompleto(j))}</option>`).join('')}</optgroup>
                </select>`}</td>
                <td>${f.data.birthDate ? f.data.birthDate.split('-').reverse().join('/') : '-'}</td>
                <td>${safeText(TEAMS.find(t => t.key === f.data.teamKey)?.label || '-')}</td>
                <td>${safeText(state.positions.find(p => p.key === f.data.positionKey)?.label || '-')}</td>
                <td>${f.data.weight ?? '-'}</td>
                <td>${f.data.height ?? '-'}</td>
                <td>${f.data.aniosClub ?? '-'}</td>
                ${condCols.length ? `<td class="text-xs">${resumenCond(f)}</td>` : ''}
                <td>${ESTADO[f.estado]}${f.estado === 'completar' ? textoActualiza(f) : ''}</td>
                <td class="text-xs" style="color:#f59e0b;">${f.avisos.map(safeText).join('<br>')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="jimp-crear" ${n ? '' : 'disabled'}>${textoBoton.charAt(0).toUpperCase() + textoBoton.slice(1)}</button>
          <button class="btn btn-ghost" id="jimp-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function columnasPlantillaCondicional() {
  const items = state.aspectosComunes.condicional || [];
  return [
    { titulo: 'Jugador', ejemplo: 'Sotres García, Alfredo', nota: '<strong>obligatoria</strong>: "Apellidos, Nombre" o "Nombre Apellidos" (o dos columnas Nombre y Apellidos).' },
    ...items.map(i => ({ titulo: i, ejemplo: '', nota: CONDICIONAL_BASE.some(b => slugify(b) === slugify(i)) ? 'media (en alevines e infantiles: ✔ / ▬ / ✘).' : 'media.' })),
    ...items.map(i => ({ titulo: `${i} máx`, ejemplo: '', nota: 'máxima.' })),
    // Alevines e infantiles: capacidades con símbolo (las que ya coinciden con un ítem numérico usan esa misma columna).
    ...CONDICIONAL_BASE.filter(b => !items.some(i => slugify(i) === slugify(b)))
      .map(b => ({ titulo: b, ejemplo: '', nota: 'alevines e infantiles: ✔ / ▬ / ✘ (o Bien / Regular / Mal).' })),
  ];
}

// Carga de datos condicionales (media/máxima de una evaluación) desde Excel/CSV o lista pegada.
function buildCondImportHTML() {
  const evs = regEvaluaciones || [];
  const items = state.aspectosComunes.condicional || [];
  const evSelect = `<select class="select" id="cimp-eval" style="max-width:360px;">${evs.map(e => `<option value="${e.id}" ${e.id === condImport.evalId ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>`;
  if (!condImport.filas) {
    return `
    <div class="card mb-16">
      <div class="card-title">Cargar datos condicionales</div>
      <div class="card-body">
        ${!evs.length ? '<p class="text-sm text-muted">Crea primero una evaluación en Evaluaciones.</p>' : !items.length ? '<p class="text-sm text-muted">No hay ítems condicionales en Configuración › Aspectos.</p>' : `
        <div class="field-group mb-8"><label class="label">Evaluación</label>${evSelect}</div>
        ${formatoImportHTML(columnasPlantillaCondicional(), 'una fila por jugador; la fila 1 con estos títulos (el orden da igual y puedes quitar los que no midas). Todos los jugadores en el mismo archivo: a los de <b>alevín e infantil</b> se les guardan las capacidades con ✔ / ▬ / ✘ y al resto los datos numéricos. Las celdas vacías no borran nada. Decimales con coma o punto.')}
        <div class="flex gap-8 mb-8" style="flex-wrap:wrap;align-items:center;">
          <button class="btn" id="cimp-plantilla">⬇ Descargar plantilla Excel</button>
          <input class="input" type="file" id="cimp-file" accept=".xlsx,.xls,.csv" />
        </div>
        <textarea class="input" id="cimp-texto" rows="6" style="width:100%;font-family:monospace;font-size:12px;" placeholder="…o pega aquí la tabla copiada de Excel (con la fila de títulos)"></textarea>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="cimp-leer">Leer</button>
          <button class="btn btn-ghost" id="cimp-cancel">Cancelar</button>
        </div>
        <details class="mt-16">
          <summary class="text-sm" style="cursor:pointer;font-weight:600;">↔ ¿Los cargaste en otra evaluación? Moverlos de una a otra</summary>
          <div class="flex gap-8 mt-8" style="align-items:center;flex-wrap:wrap;">
            <span class="text-sm">De</span>
            <select class="select" id="cimp-mov-de" style="max-width:280px;">${evs.map(e => `<option value="${e.id}">${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
            <span class="text-sm">a</span>
            <select class="select" id="cimp-mov-a" style="max-width:280px;">${evs.map(e => `<option value="${e.id}" ${e.id === evalPorDefecto() ? 'selected' : ''}>${safeText(e.temporada)} · ${safeText(e.nombre)}</option>`).join('')}</select>
            <button class="btn btn-sm" id="cimp-mover">Mover</button>
          </div>
          <p class="text-xs text-muted" style="margin-top:6px;">Pasa los datos condicionales (números y símbolos ✔▬✘) de todos los jugadores de la primera evaluación a la segunda y los quita de la primera. Si en la de destino ya había un dato, se queda el de destino.</p>
        </details>`}
        ${!evs.length || !items.length ? '<button class="btn btn-ghost mt-16" id="cimp-cancel">Cerrar</button>' : ''}
      </div>
    </div>`;
  }
  const cols = condImport.columnas.filter(c => c.item || c.base);
  const jugDe = f => state.players.find(p => p.id === f.playerId);
  const esBaseFila = f => { const j = jugDe(f); return !!j && esEquipoBase(j.teamKey); };
  const celdaCond = (f, c) => {
    if (esBaseFila(f) || (!f.playerId && !c.item)) return c.base ? (SIMBOLO_TXT[f.base[slugify(c.base)]] || '') : '';
    if (!c.item) return '';
    const v = (c.tipo === 'max' ? f.max : f.media)[slugify(c.item)];
    return v == null ? '' : String(v).replace('.', ',');
  };
  const ignoradas = condImport.columnas.filter(c => !c.tipo && c.titulo).map(c => safeText(c.titulo)).join(', ');
  const ev = evs.find(e => e.id === condImport.evalId);
  const todos = [...state.players].sort(ordenJugadores);
  const n = condImport.filas.filter(f => f.playerId).length;
  return `
    <div class="card mb-16">
      <div class="card-title">Datos condicionales · ${safeText(ev ? `${ev.temporada} · ${ev.nombre}` : '')} (${condImport.filas.length} filas)</div>
      <div class="card-body">
        <p class="text-xs text-muted mb-8"><strong>Columnas:</strong> ${cols.map(c => `${safeText(c.titulo)} → ${c.item ? safeText(c.item) + (c.tipo === 'max' ? ' (máx.)' : '') : ''}${c.item && c.base ? ' · ' : ''}${c.base ? `${safeText(c.base)} (✔▬✘)` : ''}`).join(' · ')}${ignoradas ? `<br><strong>Ignoradas:</strong> ${ignoradas}` : ''}</p>
        <p class="text-xs text-muted mb-8">Revisa el jugador de cada fila (los dudosos o no encontrados quedan sin asignar). A los de alevín e infantil se les guardan los símbolos y al resto los números. Si un dato ya tenía otro valor, el cambio queda en el histórico.</p>
        <div style="overflow:auto;max-height:420px;">
          <table class="table table-compact">
            <thead><tr><th>En el archivo</th><th>Jugador</th><th>Tipo</th>${cols.map(c => `<th>${safeText(c.titulo)}</th>`).join('')}<th>Avisos</th></tr></thead>
            <tbody>${condImport.filas.map((f, i) => `
              <tr>
                <td>${safeText(f.nombre)}</td>
                <td><select class="select" data-cimp-i="${i}" style="min-width:200px;${f.playerId ? '' : 'border-color:#f59e0b;'}">
                  <option value="">— no guardar —</option>
                  ${f.candidatos.length ? `<optgroup label="Parecidos">${f.candidatos.map(j => `<option value="${j.id}" ${j.id === f.playerId ? 'selected' : ''}>${safeText(nombreCompleto(j))}</option>`).join('')}</optgroup>` : ''}
                  <optgroup label="Todos">${todos.map(j => `<option value="${j.id}" ${j.id === f.playerId && !f.candidatos.some(c => c.id === j.id) ? 'selected' : ''}>${safeText(nombreCompleto(j))}</option>`).join('')}</optgroup>
                </select></td>
                <td class="text-xs">${f.playerId ? (esBaseFila(f) ? 'Símbolos' : 'Números') : '—'}</td>
                ${cols.map(c => `<td style="text-align:center;">${celdaCond(f, c)}</td>`).join('')}
                <td class="text-xs" style="color:#f59e0b;">${(esBaseFila(f) ? f.avisosBase : f.avisosNum).map(safeText).join('<br>')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="cimp-guardar" ${n ? '' : 'disabled'}>Guardar datos de ${n} jugador${n === 1 ? '' : 'es'}</button>
          <button class="btn btn-ghost" id="cimp-cancel">Cancelar</button>
        </div>
      </div>
    </div>`;
}

// Jugadores del listado con los filtros puestos. Orden: alfabético por nombre (y apellidos); con filtro de equipo,
// primero por posición (portero → delantero) y luego alfabético.
function jugadoresListado() {
  return state.players.filter(jugadorPasaFiltros)
    .sort((a, b) => (jugFiltros.teamKey ? rangoPosicion(a.positionKey) - rangoPosicion(b.positionKey) : 0) || ordenPorNombre(a, b));
}

function renderPanelJugadores(container) {
  const editingPlayer = (jugadorFormId && jugadorFormId !== 'new')
    ? state.players.find(p => p.id === jugadorFormId)
    : null;
  if (jugadorFormId && jugadorFormId !== 'new' && !editingPlayer) jugadorFormId = null; // se borró, cierra el form

  // Ficha de jugador abierta (y sin formulario de edición encima) → vista de ficha
  if (jugFichaId && !jugadorFormId && !puedeVer('jugadores.datos') && !puedeVer('jugadores.fichas')) jugFichaId = null; // sin permiso para fichas
  if (jugFichaId && !jugadorFormId) {
    const fichaPlayer = state.players.find(pl => pl.id === jugFichaId);
    if (fichaPlayer) { renderFichaJugador(container, fichaPlayer); return; }
    jugFichaId = null; // el jugador ya no existe
  }
  const soloForm = !!(jugadorFormId || jugImport || condImport); // añadiendo, editando o cargando: solo se ve eso (← Volver para salir)

  const jugadoresFiltrados = jugadoresListado();
  const rows = jugadoresFiltrados.map(p => {
    const { age, year } = calcAgeAndYear(p.birthDate);
    const teamLabel = TEAMS.find(t => t.key === p.teamKey)?.label || '-';
    const posLabel  = state.positions.find(pos => pos.key === p.positionKey)?.label || '-';
    const historicoRow = jugadorHistoricoOpenId === p.id ? `
      <tr><td colspan="11" style="background:var(--bg-hover);">
        ${jugadorHistoricoCache[p.id] ? buildHistoricoHTML(jugadorHistoricoCache[p.id]) : '<p class="text-xs text-muted">Cargando…</p>'}
      </td></tr>
    ` : '';
    return `
      <tr>
        <td><button type="button" data-jug-foto="${p.id}" title="${p.fotoUrl ? 'Cambiar foto' : 'Poner foto'} (pegar o elegir archivo)" style="width:36px;height:36px;border-radius:50%;padding:0;border:${p.fotoUrl ? 'none' : '1px dashed var(--border-emphasis)'};background:var(--bg-hover);cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:15px;">${p.fotoUrl ? `<img src="${p.fotoUrl}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;display:block;" />` : '📷'}</button></td>
        <td><a href="#" data-jug-ficha="${p.id}" style="font-weight:600;color:inherit;text-decoration:underline;cursor:pointer;">${safeText(p.nombre || '')}</a></td>
        <td><a href="#" data-jug-ficha="${p.id}" style="font-weight:600;color:inherit;text-decoration:underline;cursor:pointer;">${safeText(p.apellidos || '')}</a></td>
        <td>${year ?? '-'}</td>
        <td>${age ?? '-'}</td>
        <td>${aniosEnClub(p) ?? '-'}</td>
        <td>${safeText(teamLabel)}</td>
        <td>${safeText(posLabel)}</td>
        <td>${p.weight != null ? fmtDec(p.weight) + ' kg' : '-'}</td>
        <td>${p.height != null ? fmtDec(p.height) + ' m' : '-'}</td>
        <td>${safeText(residenciaDe(p))}</td>
        <td>
          <div class="flex gap-8" style="align-items:center;justify-content:flex-end;">
          <button class="btn btn-sm btn-primary" data-jug-ficha="${p.id}">Ficha</button>
          <details class="jug-mas" style="position:relative;">
            <summary class="btn btn-sm" style="list-style:none;cursor:pointer;" aria-label="Más acciones" title="Más acciones">⋯</summary>
            <div class="card" style="position:absolute;right:0;top:calc(100% + 4px);z-index:30;margin:0;padding:6px;min-width:170px;display:flex;flex-direction:column;gap:2px;box-shadow:0 8px 24px rgba(15,23,42,.18);">
              <button class="btn btn-sm btn-ghost" style="justify-content:flex-start;text-align:left;" data-jug-edit="${p.id}">Editar</button>
              <button class="btn btn-sm btn-ghost" style="justify-content:flex-start;text-align:left;" data-jug-hist="${p.id}">${jugadorHistoricoOpenId === p.id ? 'Ocultar histórico' : 'Histórico'}</button>
              <button class="btn btn-sm btn-ghost" style="justify-content:flex-start;text-align:left;" data-jug-foto="${p.id}">Cambiar foto</button>
              <button class="btn btn-sm btn-ghost" style="justify-content:flex-start;text-align:left;color:#b91c1c;" data-jug-del="${p.id}">Borrar</button>
            </div>
          </details>
          </div>
        </td>
      </tr>
      ${historicoRow}
    `;
  }).join('');

  container.innerHTML = `
    ${firebaseNotice()}
    ${jugadorFormId ? buildJugadorFormHTML(editingPlayer) : ''}
    ${jugImport && !jugadorFormId ? buildJugImportHTML() : ''}
    ${condImport && !jugadorFormId ? buildCondImportHTML() : ''}
    ${soloForm ? '' : buildJugadoresFiltrosHTML()}
    <div class="card" ${soloForm ? 'style="display:none;"' : ''}>
      <div class="card-title">Jugadores (${jugadoresFiltrados.length}${jugadoresFiltrados.length !== state.players.length ? ` de ${state.players.length}` : ''})</div>
      <div class="card-body">
        ${jugadorFormId ? '' : `<div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          <details class="jug-mas" style="position:relative;">
            <summary class="btn btn-primary" style="cursor:pointer;">+ Añadir ▾</summary>
            <div class="card" style="position:absolute;left:0;top:calc(100% + 4px);z-index:30;margin:0;padding:6px;min-width:280px;display:flex;flex-direction:column;gap:2px;box-shadow:0 8px 24px rgba(15,23,42,.18);">
              <button class="btn btn-ghost" id="jug-add" style="justify-content:flex-start;text-align:left;flex-direction:column;align-items:flex-start;"><b>Un jugador</b><span class="text-xs text-muted">Rellenar su ficha a mano</span></button>
              <button class="btn btn-ghost" id="jug-import" style="justify-content:flex-start;text-align:left;flex-direction:column;align-items:flex-start;"><b>Varios / actualizar datos</b><span class="text-xs text-muted">Excel, texto pegado o foto</span></button>
            </div>
          </details>
        </div>`}
        <div style="overflow-x:auto;">
          <style>
            .jug-lista td { padding-top:3px !important; padding-bottom:3px !important; }
            .jug-lista td .btn-sm { padding-top:3px; padding-bottom:3px; min-height:0; }
            .jug-lista [data-jug-foto] { width:30px !important; height:30px !important; }
            .jug-lista [data-jug-foto] img { width:30px !important; height:30px !important; }
          </style>
          <table class="table jug-lista">
            <thead>
              <tr>
                <th></th><th>Nombre</th><th>Apellidos</th><th>Año</th><th>Edad</th><th>Años club</th>
                <th>Equipo</th><th>Posición</th><th>Peso</th><th>Altura</th><th>Residencia</th><th></th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="12" class="text-muted">${state.players.length ? 'Ningún jugador coincide con los filtros.' : 'Sin jugadores todavía.'}</td></tr>`}</tbody>
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
  [['#jug-f-team', 'teamKey'], ['#jug-f-pos', 'positionKey'], ['#jug-f-year', 'year'], ['#jug-f-foot', 'foot'], ['#jug-f-resi', 'resi']].forEach(([sel, key]) => {
    container.querySelector(sel)?.addEventListener('change', e => { jugFiltros[key] = e.target.value; refiltrar(false); });
  });
  container.querySelector('#jug-f-clear')?.addEventListener('click', () => {
    jugFiltros = { q: '', teamKey: '', positionKey: '', year: '', foot: '', resi: '' };
    refiltrar(false);
  });
  // Menú ⋯ de cada jugador: flotante (la tabla tiene scroll y lo recortaría); uno abierto a la vez.
  container.querySelectorAll('details.jug-mas').forEach(d => d.addEventListener('toggle', () => {
    if (!d.open) return;
    container.querySelectorAll('details.jug-mas[open]').forEach(o => { if (o !== d) o.open = false; });
    const r = d.querySelector('summary').getBoundingClientRect(), menu = d.querySelector('.card');
    menu.style.position = 'fixed';
    menu.style.right = 'auto';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - (menu.offsetWidth || 170) - 8)) + 'px';
    const alto = menu.offsetHeight || 120;
    menu.style.top = (r.bottom + 4 + alto > window.innerHeight ? r.top - alto - 4 : r.bottom + 4) + 'px';
  }));
  if (!jugMasCierreGlobal) {
    jugMasCierreGlobal = true;
    document.addEventListener('click', e => { if (!e.target.closest('details.jug-mas')) document.querySelectorAll('details.jug-mas[open]').forEach(o => { o.open = false; }); });
    window.addEventListener('scroll', () => document.querySelectorAll('details.jug-mas[open]').forEach(o => { o.open = false; }), true);
  }
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
    const nom = container.querySelector('#jug-foto-nombre'); if (nom) nom.textContent = '✓ ' + f.name + ' — ajústala en el círculo';
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
  // Foto pegada (copiada de una web, WhatsApp, captura…): se mete en el mismo campo y abre el mismo recorte circular.
  const usarFotoPegada = blob => {
    const inp = container.querySelector('#jug-foto');
    if (!inp || !blob) return;
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const dt = new DataTransfer();
    dt.items.add(new File([blob], `foto-pegada.${ext}`, { type: blob.type || 'image/png' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
  };
  container.querySelector('#jug-foto-pegar')?.addEventListener('click', async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const tipo = item.types.find(t => t.startsWith('image/'));
        if (tipo) { usarFotoPegada(await item.getType(tipo)); return; }
      }
      showError('No hay ninguna imagen copiada. Copia una foto (clic derecho → Copiar imagen) y vuelve a pulsar.');
    } catch (_) {
      showError('El navegador no deja leer el portapapeles con el botón: pulsa Ctrl+V (⌘+V en Mac) con el formulario abierto.', 7000);
    }
  });
  if (container.querySelector('#jug-foto')) jugPegarFoto = usarFotoPegada; // lo usa el Ctrl+V global (ver abajo)

  // Rellenar el formulario de UN jugador pegando sus datos (fila de Excel con títulos, o lista "dato ⇥ valor").
  container.querySelector('#jug-pegar-ok')?.addEventListener('click', async () => {
    const texto = container.querySelector('#jug-pegar-texto').value;
    let filas = filasDesdeTexto(texto);
    if (!filas.length) { showError('Pega primero los datos.'); return; }
    // ¿Lista vertical (un dato por línea) o fila horizontal (títulos + valores)?
    const vertical = filas.every(f => f.length <= 2) && (filas.length > 2 || !(campoDeCabecera(filas[0][0]) && campoDeCabecera(filas[0][1])));
    let [cab, vals] = vertical ? [filas.map(f => f[0]), filas.map(f => f[1] ?? '')] : [filas[0], filas[1] || []];
    // Si no trae nombre, se usa el del formulario solo para poder leer la tabla.
    const sinNombre = !cab.some(t => ['nombre', 'nombreCompleto'].includes(campoDeCabecera(t)));
    if (sinNombre) { cab = ['Nombre', ...cab]; vals = [container.querySelector('#jug-nombre').value || 'x', ...vals]; }
    let n = 0;
    const avisos = [];
    const poner = (sel, v) => { const el = container.querySelector(sel); if (el && v != null && v !== '') { el.value = v; n++; } };
    try {
      const { columnas, filas: fs } = await leerTablaJugadores([cab, vals], state.positions);
      const d = fs[0]?.data || {};
      const hay = k => columnas.some(c => c.campo === k) || (k === 'nombre' || k === 'apellidos') && columnas.some(c => c.campo === 'nombreCompleto');
      if (!sinNombre) poner('#jug-nombre', d.nombre);
      if (hay('apellidos')) poner('#jug-apellidos', d.apellidos);
      if (hay('birthDate')) poner('#jug-birthdate', d.birthDate);
      if (hay('foot')) poner('#jug-foot', d.foot);
      if (hay('residencia')) poner('#jug-residencia', d.residencia);
      if (hay('maturationalAge')) poner('#jug-maturational', d.maturationalAge);
      if (hay('aniosClub')) poner('#jug-anios-club', d.aniosClub);
      if (hay('teamKey')) poner('#jug-team', d.teamKey);
      if (hay('positionKey')) poner('#jug-position', d.positionKey);
      if (hay('weight')) poner('#jug-weight', d.weight);
      if (hay('height')) poner('#jug-height', d.height);
      if (hay('complexion')) poner('#jug-complexion', d.complexion);
      avisos.push(...(fs[0]?.avisos || []));
    } catch (_) { /* solo datos condicionales */ }
    try { // condicionales, en la evaluación elegida en el formulario
      const cabCond = cab.map(t => (['nombre', 'apellidos', 'nombreCompleto', null].includes(campoDeCabecera(t)) ? t : ''));
      const c = leerTablaCondicional([cabCond, vals], state.aspectosComunes.condicional || [], CONDICIONAL_BASE).filas[0];
      if (c) {
        Object.entries(c.media).forEach(([k, v]) => poner(`[data-jug-cond="${k}"]`, String(v).replace('.', ',')));
        Object.entries(c.max).forEach(([k, v]) => poner(`[data-jug-condmax="${k}"]`, String(v).replace('.', ',')));
        Object.entries(c.base).forEach(([k, v]) => poner(`[data-jug-cbase="${k}"]`, v));
        avisos.push(...(container.querySelector('[data-jug-cbase]') ? c.avisosBase : c.avisosNum));
      }
    } catch (_) { /* sin columnas condicionales */ }
    if (n) showSuccess(`${n} dato${n === 1 ? '' : 's'} rellenado${n === 1 ? '' : 's'}. Revisa y pulsa Guardar.`);
    else showError('No reconozco ningún dato. Usa los mismos títulos que en la plantilla de importar jugadores.');
    if (avisos.length) showError(avisos.join(' · '), 9000);
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

  // Foto desde el listado (sin abrir Editar): ventana para pegar/elegir, ajustar en el círculo y guardar.
  container.querySelectorAll('[data-jug-foto]').forEach(btn => btn.addEventListener('click', () => {
    const j = state.players.find(x => x.id === btn.dataset.jugFoto);
    if (!j) return;
    abrirEditorFoto({
      titulo: `${j.nombre || ''} ${j.apellidos || ''}`.trim() || 'Jugador',
      fotoActual: j.fotoUrl,
      onGuardar: async file => {
        const fotoUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(fr.error || new Error('lectura de foto'));
          fr.readAsDataURL(file);
        });
        if (fotoUrl.length > 700000) throw new Error('foto demasiado grande');
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', j.id, { fotoUrl });
        setState({ players: state.players.map(p => p.id === j.id ? { ...p, fotoUrl } : p) });
        renderPanelJugadores(container);
        showSuccess('Foto guardada.');
      },
    });
  }));

  container.querySelector('#jug-add')?.addEventListener('click', async () => {
    await cargarEvaluacionesSilencioso();
    jugadorFormId = 'new';
    renderPanelJugadores(container);
  });
  // Alta masiva desde Excel/CSV
  container.querySelector('#jug-import')?.addEventListener('click', async () => { await cargarEvaluacionesSilencioso(); condImport = null; jugImport = {}; renderPanelJugadores(container); });
  container.querySelector('#jimp-eval0')?.addEventListener('change', e => { jugImport.evalInicial = e.target.value; });
  container.querySelector('#jimp-exportar')?.addEventListener('click', () => {
    const evalId = container.querySelector('#jimp-eval0')?.value || jugImport.evalInicial || evalPorDefecto();
    const cols = columnasPlantillaJugadores().map(c => c.titulo);
    const items = state.aspectosComunes.condicional || [];
    const num = v => (v == null || v === '' ? '' : v);
    const fila = j => cols.map(t => {
      switch (campoDeCabecera(t)) {
        case 'nombre': return j.nombre || '';
        case 'apellidos': return j.apellidos || '';
        case 'birthDate': return j.birthDate ? j.birthDate.split('-').reverse().join('/') : '';
        case 'foot': return j.foot || '';
        case 'residencia': return residenciaDe(j);
        case 'maturationalAge': return j.maturationalAge || '';
        case 'aniosClub': return num(aniosEnClub(j));
        case 'teamKey': return TEAMS.find(x => x.key === j.teamKey)?.label || '';
        case 'positionKey': return state.positions.find(x => x.key === j.positionKey)?.label || '';
        case 'weight': return num(j.weight);
        case 'height': return num(j.height);
        case 'complexion': return j.complexion || '';
      }
      if (!evalId) return '';
      const media = items.find(i => i === t), max = items.find(i => `${i} máx` === t), cap = CONDICIONAL_BASE.find(b => b === t);
      if (media) return num(j.condicionalPorEval?.[evalId]?.[slugify(media)]);
      if (max) return num(j.condicionalMaxPorEval?.[evalId]?.[slugify(max)]);
      if (cap && esEquipoBase(j.teamKey)) return SIMBOLO_TXT[j.condicionalBasePorEval?.[evalId]?.[slugify(cap)]] || '';
      return '';
    });
    descargarPlantilla(`jugadores-${new Date().toISOString().slice(0, 10)}.xlsx`, [cols, ...jugadoresListado().map(fila)]);
  });
  container.querySelector('#jimp-plantilla')?.addEventListener('click', () => {
    const cols = columnasPlantillaJugadores();
    descargarPlantilla('plantilla-jugadores.xlsx', [cols.map(c => c.titulo)]); // solo títulos: una fila de ejemplo se importaría como jugador
  });
  // origen = archivo elegido o filas del texto pegado (copiado de Excel)
  const leerJugadores = async origen => {
    try {
      const filas2D = Array.isArray(origen) ? origen : await leerFilas(origen);
      if (!filas2D) { const fi = container.querySelector('#jug-import-file'); if (fi) fi.value = ''; return; } // pestaña: cancelado
      const { columnas, filas } = await leerTablaJugadores(filas2D, state.positions);
      if (!filas.length) { showError('No hay jugadores con nombre en los datos.'); return; }
      // Columnas de datos condicionales en el mismo Excel (las que ya son un dato personal, p. ej. Edad madurativa, se quedan como dato personal).
      let condColumnas = [];
      try {
        const cab = (filas2D[0] || []).map(t => (['nombre', 'apellidos', 'nombreCompleto', null].includes(campoDeCabecera(t)) ? t : ''));
        const cond = leerTablaCondicional([cab, ...filas2D.slice(1)], state.aspectosComunes.condicional || [], CONDICIONAL_BASE);
        condColumnas = cond.columnas.filter(c => c.item || c.base);
        const porFila = new Map(cond.filas.map(c => [c.fila, c]));
        filas.forEach(f => { f.cond = porFila.get(f.fila) || null; });
      } catch (_) { /* sin columnas condicionales: solo datos personales */ }
      if (condColumnas.length) await cargarEvaluacionesSilencioso();
      const evalElegida = container.querySelector('#jimp-eval0')?.value || jugImport?.evalInicial || evalPorDefecto();
      jugImport = { columnas, filas, condColumnas, evalId: condColumnas.length ? evalElegida : null, evalInicial: evalElegida };
      const vistos = new Set();
      filas.forEach(f => {
        const nombre = `${f.data.nombre} ${f.data.apellidos}`.trim();
        const clave = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const m = matchJugador(nombre, state.players, { teamKey: f.data.teamKey });
        f.candidatos = (m.candidates || []).map(c => c.id);
        if (vistos.has(clave)) { f.estado = 'repetido'; f.crear = false; }
        // Ya existe: solo se rellenan los datos que le faltan en la ficha (lo que ya tiene no se toca).
        else if (m.status === 'auto') asignarDestino(f, m.playerId);
        // Parecido (p. ej. solo el nombre): con un único candidato se propone ese; con varios, se elige en la fila.
        else if (m.status === 'dudoso') asignarDestino(f, f.candidatos.length === 1 ? f.candidatos[0] : '');
        else asignarDestino(f, 'nuevo');
        vistos.add(clave);
      });
      renderPanelJugadores(container);
    } catch (err) {
      console.error('[Importar jugadores]', err);
      showError('No se pudieron leer los datos: ' + (err.message || err), 9000);
    }
  };
  container.querySelector('#jug-import-file')?.addEventListener('change', e => { if (e.target.files[0]) leerJugadores(e.target.files[0]); });
  container.querySelector('#jimp-leer')?.addEventListener('click', () => {
    const texto = container.querySelector('#jimp-texto').value;
    if (!texto.trim()) { showError('Pega primero las filas copiadas de Excel.'); return; }
    leerJugadores(filasDesdeTexto(texto));
  });
  // Foto o texto libre → /api/extraer (Claude) → filas con los títulos de la app → misma vista previa
  const leerConIA = async cuerpo => {
    const estado = container.querySelector('#jimp-ia-estado');
    const botones = container.querySelectorAll('#jimp-ia, #jimp-leer, label:has(#jimp-foto)');
    botones.forEach(b => { b.disabled = true; b.style.opacity = .5; b.style.pointerEvents = 'none'; });
    if (estado) estado.textContent = '⏳ Leyendo con IA… (puede tardar unos segundos)';
    try {
      let token = null; try { token = await tokenActual(); } catch (_) { /* modo local sin Firebase */ }
      const columnas = columnasPlantillaJugadores().map(c => ({ titulo: c.titulo, nota: String(c.nota || '').replace(/<[^>]+>/g, '') }));
      const r = await fetch('/api/extraer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, body: JSON.stringify({ ...cuerpo, columnas }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503 && d.error === 'no-configurado') throw new Error('falta poner la clave ANTHROPIC_API_KEY en Vercel.');
      if (!r.ok) throw new Error(d.error || ('error ' + r.status));
      if (!d.filas?.length || d.filas.length < 2) throw new Error('no se encontró ningún jugador.');
      await leerJugadores(d.filas);
    } catch (err) {
      showError('IA: ' + (err.message || err), 9000);
    } finally {
      botones.forEach(b => { b.disabled = false; b.style.opacity = ''; b.style.pointerEvents = ''; });
      if (estado) estado.textContent = 'Con IA: antes de guardar siempre ves la vista previa para revisarla.';
    }
  };
  const leerFotoIA = async file => {
    if (!file || !/^image\//.test(file.type)) { showError('Elige una imagen (JPG o PNG).'); return; }
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(img.width, img.height)); // reduce el tamaño (más rápido y barato)
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      leerConIA({ imagen: cv.toDataURL('image/jpeg', 0.9).split(',')[1], mediaType: 'image/jpeg' });
    } catch (_) { showError('No se pudo abrir la imagen.'); }
  };
  container.querySelector('#jimp-foto')?.addEventListener('change', e => leerFotoIA(e.target.files[0]));
  container.querySelector('#jimp-ia')?.addEventListener('click', () => {
    const texto = container.querySelector('#jimp-texto').value;
    if (!texto.trim()) { showError('Pega o escribe primero la lista en el cuadro.'); return; }
    leerConIA({ texto });
  });
  container.querySelector('#jimp-texto')?.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile();
    if (f) { e.preventDefault(); leerFotoIA(f); }
  });
  container.querySelector('#jimp-eval')?.addEventListener('change', e => {
    jugImport.evalId = e.target.value;
    jugImport.filas.forEach(f => { if (f.estado !== 'repetido') asignarDestino(f, f.destino); }); // lo que falta depende de la evaluación
    renderPanelJugadores(container);
  });
  container.querySelectorAll('[data-jimp-dest]').forEach(sel => sel.addEventListener('change', () => {
    asignarDestino(jugImport.filas[+sel.dataset.jimpDest], sel.value);
    renderPanelJugadores(container);
  }));
  container.querySelectorAll('[data-jimp-i]').forEach(cb => cb.addEventListener('change', () => {
    jugImport.filas[+cb.dataset.jimpI].crear = cb.checked;
    renderPanelJugadores(container);
  }));
  container.querySelector('#jimp-all')?.addEventListener('change', e => {
    jugImport.filas.forEach(f => { if (f.estado === 'nuevo' || f.estado === 'completar') f.crear = e.target.checked; }); // nunca duplica sin querer
    renderPanelJugadores(container);
  });
  container.querySelector('#jimp-cancel')?.addEventListener('click', () => { jugImport = null; renderPanelJugadores(container); });
  container.querySelectorAll('[data-jimp-volver]').forEach(b => b.addEventListener('click', () => { jugImport = null; renderPanelJugadores(container); }));
  container.querySelector('#jimp-crear')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const aCrear = jugImport.filas.filter(f => f.crear);
    if (!aCrear.length) return;
    btn.disabled = true;
    let ok = 0;
    const fallos = [];
    let completadas = 0;
    for (const f of aCrear) {
      btn.textContent = `Guardando ${ok + completadas + fallos.length + 1} de ${aCrear.length}…`;
      const data = f.data;
      try {
        if (f.estado === 'completar') { // ficha existente: datos nuevos y los que han cambiado (celdas vacías no se tocan)
          const patch = f.completar;
          if (Object.keys(patch).length) {
            const prev = state.players.find(p => p.id === f.playerId) || {};
            if (!isFirebaseUnconfigured()) await updateDocument('jugadores', f.playerId, patch);
            setState({ players: state.players.map(p => p.id === f.playerId ? { ...p, ...patch } : p) });
            await registrarCambios(f.playerId, prev, patch); // los cambios de valor quedan en el histórico
            if (patch.teamKey) await añadirAPlantilla(f.playerId, patch.teamKey, state.season);
          }
          await guardarCondPend(f.playerId, f.condPend, jugImport.evalId);
          completadas++;
          continue;
        }
        const nuevo0 = { ...data, residencia: data.residencia || RESI_DEFECTO };
        const nuevo = nuevo0.aniosClub != null ? { ...nuevo0, aniosClubTemporada: state.season } : nuevo0;
        const id = isFirebaseUnconfigured() ? crypto.randomUUID() : await addDocument('jugadores', nuevo);
        setState({ players: [...state.players, { id, ...nuevo }] });
        if (data.teamKey) await añadirAPlantilla(id, data.teamKey, state.season);
        await guardarCondPend(id, f.condPend, jugImport.evalId);
        ok++;
      } catch (err) {
        console.error('[Importar jugadores] Fallo con', data.nombre, data.apellidos, err);
        fallos.push(`${data.nombre} ${data.apellidos}`.trim());
      }
    }
    jugImport = null;
    renderPanelJugadores(container);
    if (ok || completadas) showSuccess([ok ? `${ok} jugador${ok === 1 ? '' : 'es'} creado${ok === 1 ? '' : 's'}` : '', completadas ? `${completadas} ficha${completadas === 1 ? '' : 's'} actualizada${completadas === 1 ? '' : 's'}` : ''].filter(Boolean).join(' y ') + '.');
    if (fallos.length) showError(`Fallaron ${fallos.length}: ${fallos.join(', ')}. Revisa permisos o conexión.`, 12000);
  });

  // Carga de datos condicionales
  container.querySelector('#jug-cond-import')?.addEventListener('click', async () => {
    await cargarEvaluacionesSilencioso();
    jugImport = null;
    condImport = { evalId: evalPorDefecto() };
    renderPanelJugadores(container);
  });
  container.querySelector('#cimp-eval')?.addEventListener('change', e => { condImport.evalId = e.target.value; });
  container.querySelector('#cimp-cancel')?.addEventListener('click', () => { condImport = null; renderPanelJugadores(container); });
  container.querySelector('#cimp-mover')?.addEventListener('click', async e => {
    const de = container.querySelector('#cimp-mov-de').value, a = container.querySelector('#cimp-mov-a').value;
    if (!de || !a || de === a) { showError('Elige dos evaluaciones distintas.'); return; }
    const CAMPOS = ['condicionalPorEval', 'condicionalMaxPorEval', 'condicionalBasePorEval'];
    const afectados = state.players.filter(j => CAMPOS.some(c => Object.keys(j[c]?.[de] || {}).length));
    if (!afectados.length) { showError('Ningún jugador tiene datos condicionales en esa evaluación.'); return; }
    const nombreEv = id => { const ev = (regEvaluaciones || []).find(x => x.id === id); return ev ? `${ev.temporada} · ${ev.nombre}` : id; };
    if (!confirm(`¿Mover los datos condicionales de ${afectados.length} jugador(es) de "${nombreEv(de)}" a "${nombreEv(a)}"?`)) return;
    const btn = e.currentTarget; btn.disabled = true;
    let ok = 0; const fallos = [];
    for (const j of afectados) {
      btn.textContent = `Moviendo ${ok + fallos.length + 1} de ${afectados.length}…`;
      const patch = {};
      CAMPOS.forEach(c => {
        if (!j[c]?.[de]) return;
        const todo = JSON.parse(JSON.stringify(j[c]));
        todo[a] = { ...todo[de], ...(todo[a] || {}) }; // lo que ya hubiera en el destino se queda
        delete todo[de];
        patch[c] = todo;
      });
      try {
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', j.id, patch);
        setState({ players: state.players.map(p => p.id === j.id ? { ...p, ...patch } : p) });
        ok++;
      } catch (err) { console.error('[Condicional] Mover', j.id, err); fallos.push(nombreCompleto(j)); }
    }
    renderPanelJugadores(container);
    if (ok) showSuccess(`Datos condicionales de ${ok} jugador${ok === 1 ? '' : 'es'} movidos a "${nombreEv(a)}".`);
    if (fallos.length) showError(`Fallaron ${fallos.length}: ${fallos.join(', ')}.`, 12000);
  });
  container.querySelector('#cimp-plantilla')?.addEventListener('click', () => {
    const cols = columnasPlantillaCondicional();
    descargarPlantilla('plantilla-datos-condicionales.xlsx', [cols.map(c => c.titulo)]);
  });
  container.querySelector('#cimp-leer')?.addEventListener('click', async () => {
    try {
      const file = container.querySelector('#cimp-file').files[0];
      const texto = container.querySelector('#cimp-texto').value;
      if (!file && !texto.trim()) { showError('Elige un archivo o pega la tabla.'); return; }
      const filas2D = file ? await leerFilas(file) : filasDesdeTexto(texto);
      if (!filas2D) return;
      const { columnas, filas } = leerTablaCondicional(filas2D, state.aspectosComunes.condicional || [], CONDICIONAL_BASE);
      if (!filas.length) { showError('No hay filas con jugador.'); return; }
      filas.forEach(f => {
        const m = matchJugador(f.nombre, state.players);
        f.candidatos = m.candidates || [];
        // Un único parecido (p. ej. solo el nombre de pila): se propone ese jugador.
        f.playerId = m.status === 'auto' ? m.playerId : (m.status === 'dudoso' && f.candidatos.length === 1 ? f.candidatos[0].id : '');
      });
      condImport = { evalId: condImport.evalId, columnas, filas };
      renderPanelJugadores(container);
    } catch (err) {
      console.error('[Condicional] Leer:', err);
      showError('No se pudo leer: ' + (err.message || err), 9000);
    }
  });
  container.querySelectorAll('[data-cimp-i]').forEach(sel => sel.addEventListener('change', () => {
    condImport.filas[+sel.dataset.cimpI].playerId = sel.value;
    renderPanelJugadores(container);
  }));
  container.querySelector('#cimp-guardar')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const evalId = condImport.evalId;
    const porJugador = new Map(); // varias filas del mismo jugador: se juntan (la última manda)
    condImport.filas.filter(f => f.playerId).forEach(f => {
      const acc = porJugador.get(f.playerId) || { media: {}, max: {}, base: {} };
      Object.assign(acc.media, f.media); Object.assign(acc.max, f.max); Object.assign(acc.base, f.base);
      porJugador.set(f.playerId, acc);
    });
    btn.disabled = true;
    let ok = 0;
    const fallos = [];
    for (const [id, vals] of porJugador) {
      btn.textContent = `Guardando ${ok + fallos.length + 1} de ${porJugador.size}…`;
      const prev = state.players.find(p => p.id === id);
      if (!prev) continue;
      let patch;
      if (esEquipoBase(prev.teamKey)) { // alevín / infantil: capacidades con símbolo
        if (!Object.keys(vals.base).length) continue;
        const condicionalBasePorEval = JSON.parse(JSON.stringify(prev.condicionalBasePorEval || {}));
        condicionalBasePorEval[evalId] = { ...(condicionalBasePorEval[evalId] || {}), ...vals.base };
        patch = { condicionalBasePorEval };
      } else {
        if (!Object.keys(vals.media).length && !Object.keys(vals.max).length) continue;
        const condicionalPorEval = JSON.parse(JSON.stringify(prev.condicionalPorEval || {}));
        const condicionalMaxPorEval = JSON.parse(JSON.stringify(prev.condicionalMaxPorEval || {}));
        condicionalPorEval[evalId] = { ...(condicionalPorEval[evalId] || {}), ...vals.media };
        condicionalMaxPorEval[evalId] = { ...(condicionalMaxPorEval[evalId] || {}), ...vals.max };
        patch = { condicionalPorEval, condicionalMaxPorEval };
      }
      try {
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', id, patch);
        setState({ players: state.players.map(p => p.id === id ? { ...p, ...patch } : p) });
        await registrarCambios(id, prev, patch);
        ok++;
      } catch (err) {
        console.error('[Condicional] Guardar', id, err);
        fallos.push(nombreCompleto(prev));
      }
    }
    condImport = null;
    renderPanelJugadores(container);
    if (ok) showSuccess(`Datos condicionales guardados en ${ok} jugador${ok === 1 ? '' : 'es'}.`);
    if (fallos.length) showError(`Fallaron ${fallos.length}: ${fallos.join(', ')}. Revisa permisos o conexión.`, 12000);
  });

  ['#jug-cancel', '#jug-volver-form'].forEach(sel => container.querySelector(sel)?.addEventListener('click', () => {
    jugadorFormId = null;
    renderPanelJugadores(container);
  }));
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
      const pj = state.players.find(x => x.id === id);
      if (!confirm(`¿Borrar a ${pj ? nombreCompleto(pj) : 'este jugador'}? Se borran TODOS sus datos (RGPD): ficha, textos, notas, datos condicionales, foto, histórico, registros de evaluaciones y su sitio en las plantillas. No se puede deshacer.`)) return;
      try {
        const avisos = isFirebaseUnconfigured() ? [] : await borrarJugadorCompleto(id);
        setState({ players: state.players.filter(p => p.id !== id) });
        plantillasCache = null; // se quitó de las plantillas: se releen
        renderPanelJugadores(container);
        showSuccess('Jugador borrado.');
        if (avisos.length) showError(`No se pudo borrar: ${avisos.join(', ')}.`, 12000);
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
  const cbSelects = [...container.querySelectorAll('[data-jug-cbase]')]; // alevines/infantiles: símbolos
  const cbDraft = JSON.parse(JSON.stringify((jugadorFormId !== 'new' && editingPlayer?.condicionalBasePorEval) || {}));
  let condEvalActual = condSel?.value || null;
  const condVolcar = () => { // inputs → borrador de la evaluación actual
    if (!condEvalActual) return;
    if (cbSelects.length) {
      cbDraft[condEvalActual] = {};
      cbSelects.forEach(sel => { if (sel.value) cbDraft[condEvalActual][sel.dataset.jugCbase] = sel.value; });
    }
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
    cbSelects.forEach(sel => { sel.value = cbDraft[condEvalActual]?.[sel.dataset.jugCbase] || ''; });
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
    // Años en el club: si no se toca, se conserva la referencia; si cambia, se apunta en la temporada actual.
    const aniosTxt = container.querySelector('#jug-anios-club').value.replace(/\s+/g, '');
    const aniosEt = etapasAnios(aniosTxt);
    if (aniosTxt !== '' && !aniosEt) { showError('Años en el club: un número entero (3) o por etapas (2+3).'); return; }
    const aniosNum = !aniosEt ? null : aniosEt.length === 1 ? aniosEt[0] : aniosEt.join('+');
    if (String(aniosNum ?? '') !== String(aniosEnClub(jugadorFormId === 'new' ? null : editingPlayer) ?? '')) {
      baseData.aniosClub = aniosNum;
      baseData.aniosClubTemporada = aniosNum == null ? null : state.season;
    }
    const historicoData = {
      teamKey: container.querySelector('#jug-team').value || null,
      positionKey: container.querySelector('#jug-position').value || null,
      weight: container.querySelector('#jug-weight').value === '' ? null : parseFloat(container.querySelector('#jug-weight').value),
      height: container.querySelector('#jug-height').value === '' ? null : parseFloat(container.querySelector('#jug-height').value),
      complexion: container.querySelector('#jug-complexion').value.trim() || null,
    };
    if (cbSelects.length) baseData.condicionalBasePorEval = Object.fromEntries(Object.entries(cbDraft).filter(([, m]) => Object.keys(m).length));
    if (condicionalPorEval && !cbSelects.length) baseData.condicionalPorEval = condicionalPorEval;
    if (condicionalMaxPorEval) baseData.condicionalMaxPorEval = condicionalMaxPorEval;
    let fotoFile = container.querySelector('#jug-foto').files[0] || null;
    if (!baseData.nombre) { showError('El nombre es obligatorio.'); return; }
    const saveBtn = container.querySelector('#jug-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando…';
    if (fotoFile && crop) fotoFile = (await exportarCrop()) || fotoFile; // sube el recorte, no el original

    const isNew = jugadorFormId === 'new';
    const prev = isNew ? {} : (editingPlayer || {});

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

      if (!isNew) await registrarCambios(id, prev, { ...baseData, ...historicoData }); // solo cambios reales, no datos nuevos

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

  if (!CONFIG_GROUPS.some(g => g.tabs.some(t => t.key === configSubTab))) configSubTab = 'posiciones'; // pantalla quitada del menú
  configSubTab = subVisible('config', configSubTab);
  const gruposVis = CONFIG_GROUPS.filter(g => !g.soloSuper || esSuperadmin()).map(g => ({ ...g, tabs: g.tabs.filter(t => puedeVer(`config.${t.key}`)) })).filter(g => g.tabs.length);
    container.innerHTML = `
    ${firebaseNotice()}
    <div class="cfg-layout" style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;">
    ${cfgMenuOculto ? `<button class="btn btn-sm" id="cfg-mostrar" title="Mostrar el menú de Configuración" style="position:sticky;top:8px;">☰ Menú</button>` : `
    <nav class="card cfg-side" style="flex:1 1 220px;max-width:270px;margin:0;padding:8px 10px 12px;position:sticky;top:8px;">
      <div style="display:flex;justify-content:flex-end;"><button class="btn btn-sm btn-ghost" id="cfg-ocultar" title="Ocultar el menú (más sitio para la ficha)" style="padding:2px 8px;">« Ocultar</button></div>
      ${gruposVis.map(g => {
        const dentro = g.tabs.some(t => t.key === configSubTab), cerrado = !cfgGruposAbiertos.includes(g.label);
        return `
        <button class="btn btn-ghost text-xs" data-cfg-grupo="${safeText(g.label)}" aria-expanded="${!cerrado}" style="display:flex;width:100%;justify-content:space-between;align-items:center;font-weight:700;color:${cerrado && dentro ? 'var(--blue-600, #1d4ed8)' : 'var(--text-muted)'};letter-spacing:1px;text-transform:uppercase;padding:10px 10px 4px;">${g.label}<span aria-hidden="true">${cerrado ? '▸' : '▾'}</span></button>
        ${cerrado ? '' : g.tabs.map(t => `<button class="btn btn-ghost" data-config-subtab="${t.key}" style="display:block;width:100%;text-align:left;justify-content:flex-start;padding:7px 10px;margin:1px 0;border-radius:8px;${t.key === configSubTab ? 'background:var(--blue-50, #eff6ff);color:var(--blue-600, #1d4ed8);font-weight:700;' : 'font-weight:500;'}">${t.label}</button>`).join('')}`;
      }).join('')}
    </nav>`}
    <div class="cfg-main" style="flex:999 1 560px;min-width:0;">

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
              + `<div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;"><span class="text-xs text-muted">Orden del Táctico (fichas; la encuesta se ordena en Columnas de la encuesta):</span>
                  <button class="btn btn-sm" data-tact-orden="def">Defensivas primero</button>
                  <button class="btn btn-sm" data-tact-orden="of">Ofensivas primero</button>
                  <button class="btn btn-sm btn-primary" data-tact-orden="def" data-tact-todas="1" title="Aplica Defensivas primero a todas las posiciones">Defensivas primero en todas las posiciones</button></div>`
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
      <div class="card-title">Ficha individual</div>
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

    ${configSubTab !== 'evaluadores' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Evaluadores</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Quién es cada evaluador de las encuestas y qué rol tiene. Las variantes del mismo nombre (JESUS, Jesús…) cuentan como una. Solo informativo: no cambia notas ni medias. En la tabla de registros se ve al pasar el ratón por el evaluador.</p>
        <div id="evaluadores-wrap"></div>
      </div>
    </div>
    `}

    ${configSubTab !== 'columnas-encuesta' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Columnas de la encuesta (1-51)</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Por posición: cómo se llama cada columna (cabecera en la BBDD) y a qué va (Fecha, Evaluador, Jugador, un perfil, una competencia o nada). Todo editable; la plantilla es solo el punto de partida. Se usa en el import (mapeo precargado) y en la tabla de BBDD.</p>
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
      <div class="card-title">Campograma</div>
      <div class="card-body"><p class="text-xs text-muted">Pendiente de implementar.</p></div>
    </div>
    `}

    ${configSubTab !== 'fichas-mapa-nivel' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Mapa de nivel</div>
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
        <textarea class="input" id="flujo-evaluaciones-text" rows="24" style="width:100%;min-height:70vh;font-family:var(--font-mono, monospace);font-size:13px;line-height:1.5;resize:vertical;overflow:hidden;">${safeText(state.flujoEvaluaciones)}</textarea>
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
    </div></div>
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
      configSubTab = (g.tabs.find(t => puedeVer(`config.${t.key}`)) || g.tabs[0]).key;
      localStorage.setItem('rm-config-subtab', configSubTab);
      renderPanelConfig(container);
    });
  });
  container.querySelectorAll('[data-cfg-grupo]').forEach(btn => btn.addEventListener('click', () => {
    const g = btn.dataset.cfgGrupo;
    cfgGruposAbiertos = cfgGruposAbiertos.includes(g) ? cfgGruposAbiertos.filter(x => x !== g) : [...cfgGruposAbiertos, g];
    try { localStorage.setItem('rm-cfg-abiertos', JSON.stringify(cfgGruposAbiertos)); } catch (_) { /* ignorar */ }
    renderPanelConfig(container);
  }));
  const menuCfg = oculto => () => {
    cfgMenuOculto = oculto;
    try { localStorage.setItem('rm-cfg-menu-oculto', oculto ? '1' : '0'); } catch (_) { /* ignorar */ }
    renderPanelConfig(container);
  };
  container.querySelector('#cfg-ocultar')?.addEventListener('click', menuCfg(true));
  container.querySelector('#cfg-mostrar')?.addEventListener('click', menuCfg(false));
  container.querySelectorAll('[data-config-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      configSubTab = btn.dataset.configSubtab;
      localStorage.setItem('rm-config-subtab', configSubTab);
      renderPanelConfig(container);
    });
  });

  const flujoTextarea = container.querySelector('#flujo-evaluaciones-text');
  if (flujoTextarea) {
    // Crece con el texto: se ve entero, sin barra de desplazamiento propia.
    const ajustarFlujo = () => { flujoTextarea.style.height = 'auto'; flujoTextarea.style.height = Math.max(flujoTextarea.scrollHeight + 4, window.innerHeight * 0.7) + 'px'; };
    requestAnimationFrame(ajustarFlujo);
    flujoTextarea.addEventListener('input', ajustarFlujo);
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

  const evaluadoresWrap = container.querySelector('#evaluadores-wrap');
  if (evaluadoresWrap) renderEvaluadores(evaluadoresWrap);

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

  // ✎ Renombrar sin cambiar de sitio: se cambia también en Ofensivas/Defensivas, perfiles y Columnas de la encuesta.
  container.querySelectorAll('[data-ren-crit]').forEach(btn => btn.addEventListener('click', () => {
    const cat = btn.dataset.cat, idx = Number(btn.dataset.idx), comun = btn.dataset.scope === 'comun';
    const lista = comun ? state.aspectosComunes[cat] || [] : state.criteriaSchemas[configCriteriaPosition]?.[cat] || [];
    const de = lista[idx]; if (!de) return;
    const a = (prompt(`Nuevo nombre para «${de}»:`, de) || '').trim();
    if (!a || a === de) return;
    if (lista.includes(a)) { showError(`Ya existe «${a}» en esta lista.`); return; }
    const posiciones = comun ? state.positions.map(p => p.key) : [configCriteriaPosition];
    const columnasEncuesta = congelarColumnasEncuesta(posiciones, { de, a });
    const criteriaSchemas = { ...state.criteriaSchemas };
    posiciones.forEach(pos => { if (criteriaSchemas[pos]) criteriaSchemas[pos] = renombrarEnSchema(criteriaSchemas[pos], de, a); });
    const patch = { criteriaSchemas, columnasEncuesta };
    if (comun) patch.aspectosComunes = { ...state.aspectosComunes, [cat]: lista.map(x => x === de ? a : x) };
    setState(patch);
    document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
    showSuccess(`«${de}» → «${a}». Las notas ya importadas siguen con el nombre antiguo: vuelve a subir el Excel para pasarlas.`);
    renderPanelConfig(container);
  }));

  container.querySelectorAll('[data-del-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.scope === 'comun') {
        const quitar = (state.aspectosComunes[cat] || [])[idx];
        const columnasEncuesta = congelarColumnasEncuesta(state.positions.map(p => p.key), { quitar });
        const items = (state.aspectosComunes[cat] || []).filter((_, i) => i !== idx);
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: items }, columnasEncuesta });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        const columnasEncuesta = congelarColumnasEncuesta([configCriteriaPosition], { quitar: (schema[cat] || [])[idx] });
        const items = (schema[cat] || []).filter((_, i) => i !== idx);
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: items } }, columnasEncuesta });
      }
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  // Reordena el Táctico (de la posición o de todas): primero las marcadas como Defensivas (u Ofensivas), cada grupo en su orden actual.
  // Las columnas de la encuesta NO cambian (son la referencia).
  container.querySelectorAll('[data-tact-orden]').forEach(btn => btn.addEventListener('click', () => {
    const def = btn.dataset.tactOrden === 'def';
    const posiciones = btn.dataset.tactTodas ? state.positions.map(p => p.key) : [configCriteriaPosition];
    const schemas = { ...state.criteriaSchemas };
    const colEnc = congelarColumnasEncuesta(posiciones);
    posiciones.forEach(pos => {
      const schema = schemas[pos] || {};
      const tact = schema.tactico || [];
      const primero = new Set(def ? schema.competenciasDefensivas || [] : schema.competenciasOfensivas || []);
      schemas[pos] = { ...schema, tactico: [...tact.filter(t => primero.has(t)), ...tact.filter(t => !primero.has(t))] };
    });
    setState({ criteriaSchemas: schemas, columnasEncuesta: colEnc });
    showSuccess(`${def ? 'Defensivas' : 'Ofensivas'} primero${btn.dataset.tactTodas ? ' en todas las posiciones' : ''}. Las columnas de la encuesta no cambian.`);
    renderPanelConfig(container);
  }));
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
      const columnasEncuesta = congelarColumnasEncuesta(isComun ? state.positions.map(p => p.key) : [configCriteriaPosition]);
      if (isComun) {
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: items }, columnasEncuesta });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: items } }, columnasEncuesta });
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

// true si la carga de 'plantillas' falló: la caché vacía NO es la realidad y guardar sobre ella machacaría los documentos.
let plantillasFallo = false;
function comprobarPlantillasCargadas() {
  if (plantillasFallo) throw new Error('Las plantillas no se cargaron: recarga la página antes de guardar.');
}

async function ensurePlantillas() {
  if (plantillasCache) return plantillasCache;
  if (isFirebaseUnconfigured()) { plantillasCache = []; return plantillasCache; }
  if (!plantillasLoading) {
    plantillasLoading = readCollection('plantillas')
      .then(r => { plantillasCache = r; plantillasFallo = false; })
      .catch(err => { console.error('[Firestore] Plantillas:', err); showError('No se pudieron cargar las plantillas (revisa las reglas de Firestore para "plantillas"). Los cambios en plantillas NO se guardarán: recarga la página.', 9000); plantillasCache = []; plantillasFallo = true; })
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
const plCardDatos = new Set();
let plOpcionesAbiertas = false;
let plEvalSel = null;            // presentación: evaluación elegida para todo el equipo ('auto' = cada uno la suya)  // presentación: panel ⚙ Opciones desplegado   // equipos que muestran la pestaña Datos en su tarjeta
let plAddCierreGlobal = false;   // listener único para cerrar los "+ Añadir"
let plIrJugador = null; // jugador al que saltar al abrir la presentación (clic en su nombre)
let plRefModo = 'team';   // comparación de las medias en la Presentación: 'team' (precargado) | 'teampos' | 'none'  // 'grid' | 'datos' | 'pres'

const nombreCompleto = j => `${j.apellidos || ''}, ${j.nombre || ''}`.replace(/^, |, $/g, '').trim();
const ordenJugadores = (a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, 'es');
const ordenPorNombre = (a, b) => `${a.nombre || ''} ${a.apellidos || ''}`.trim().localeCompare(`${b.nombre || ''} ${b.apellidos || ''}`.trim(), 'es'); // listado de Jugadores
// Orden de las posiciones en el listado filtrado por equipo (se reconoce por la clave o el nombre de Configuración). Sin posición, al final.
const ORDEN_POSICIONES = ['portero', 'central', 'lateral', 'mediocentro', 'interior', 'extremo', 'delantero'];
function rangoPosicion(positionKey) {
  if (!positionKey) return ORDEN_POSICIONES.length + 1;
  const pos = state.positions.find(p => p.key === positionKey);
  const txt = normalizeTxt(`${positionKey} ${pos?.label || ''}`);
  const i = ORDEN_POSICIONES.findIndex(w => txt.includes(w));
  return i < 0 ? ORDEN_POSICIONES.length : i;
}

// Guarda (fusiona) campos en el doc de la plantilla temporada+equipo sin perder los demás (jugadorIds, fotos…).
// cachePatch: lo que se apunta en la caché local cuando patch lleva arrayUnion/arrayRemove.
async function guardarPlantilla(temporada, teamKey, patch, cachePatch = patch) {
  await ensurePlantillas();
  comprobarPlantillasCargadas();
  const id = plantillaDocId(temporada, teamKey);
  const prev = plantillasCache.find(d => d.id === id);
  if (prev) {
    // Solo se escriben los campos que cambian: no se pisa lo que otra persona haya guardado en el resto del documento.
    const data = { ...patch, temporada, teamKey };
    try {
      await updateDocument('plantillas', id, data);
      plantillasCache = plantillasCache.map(d => d.id === id ? { ...d, ...cachePatch, temporada, teamKey } : d);
      return;
    } catch (err) {
      if (err?.code !== 'not-found') throw err; // si alguien lo borró, se vuelve a crear abajo
    }
  }
  const { id: _id, updatedAt: _u, ...rest } = prev || {};
  // merge: si otra persona creó el documento mientras tanto, se fusiona en vez de machacarlo.
  await saveDocument('plantillas', id, { ...rest, ...patch, temporada, teamKey }, { merge: true });
  plantillasCache = [...plantillasCache.filter(d => d.id !== id), { id, jugadorIds: [], ...rest, ...cachePatch, temporada, teamKey }];
}

// Guarda UNA entrada de un campo-mapa (textos, observaciones) sin reescribir el mapa entero: dos personas
// editando observaciones distintas ya no se pisan. valor null/'' = borrar esa entrada.
async function guardarPlantillaEntrada(temporada, teamKey, campo, clave, valor) {
  await ensurePlantillas();
  comprobarPlantillasCargadas();
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
  await guardarPlantilla(temporada, teamKey, { jugadorIds: arrayUnion(jugadorId) }, { jugadorIds: [...ids, jugadorId] });
}

// Guarda un campo de la ficha de datos desde la plantilla (misma fuente que el formulario de Jugadores).
async function guardarCampoJugador(id, campo, valor) {
  const p = state.players.find(x => x.id === id);
  if (!p) return;
  const patch = { [campo]: valor };
  await updateDocument('jugadores', id, patch);
  const nuevo = { ...p, ...patch };
  setState({ players: state.players.map(x => x.id === id ? nuevo : x) });
  await registrarCambios(id, p, patch);
}

// "Apellidos, Nombre" (con coma) o "Nombre Apellidos" (1ª palabra = nombre, resto = apellidos).
function parsearLineaJugador(linea) {
  const t = linea.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.includes(',')) { const [ap, ...no] = t.split(','); return { apellidos: ap.trim(), nombre: no.join(' ').trim() }; }
  const w = t.split(' ');
  return { nombre: w[0], apellidos: w.slice(1).join(' ') };
}

async function crearPlantillaDesdeLista(texto, teamKey, temporada, positionKey = null) { // positionKey: la de la columna desde la que se añade (solo para quien no tenga)
  await ensurePlantillas();
  const res = { creados: [], existentes: [], dudosos: [] };
  for (const linea of texto.split(/\r?\n/)) {
    const pj = parsearLineaJugador(linea);
    if (!pj || !pj.nombre) continue;
    const m = matchJugador(`${pj.nombre} ${pj.apellidos}`, state.players, { teamKey });
    if (m.status === 'auto') {
      await añadirAPlantilla(m.playerId, teamKey, temporada);
      if (positionKey && !state.players.find(x => x.id === m.playerId)?.positionKey) await guardarCampoJugador(m.playerId, 'positionKey', positionKey);
      res.existentes.push(linea.trim()); continue;
    }
    if (m.status === 'dudoso') { res.dudosos.push(`${linea.trim()} ≈ ${m.candidates.map(nombreCompleto).join(' / ')}`); continue; }
    const data = { nombre: pj.nombre, apellidos: pj.apellidos, birthDate: null, foot: '', residencia: RESI_DEFECTO, maturationalAge: '', teamKey, positionKey: positionKey || null, weight: null, height: null, complexion: null };
    const id = await addDocument('jugadores', data);
    setState({ players: [...state.players, { id, ...data }] });
    await añadirAPlantilla(id, teamKey, temporada);
    res.creados.push(linea.trim());
  }
  return res;
}

// Al soltar un jugador en otro equipo u otra posición: menú junto al cursor «Mover» / «Duplicar». Devuelve 'mover' | 'duplicar' | null.
function plElegirMoverDuplicar(x, y, { equipo, posicion }) {
  return new Promise(resolve => {
    const que = equipo && posicion ? 'equipo y posición' : equipo ? 'equipo' : 'posición';
    const m = document.createElement('div');
    m.className = 'card';
    m.style.cssText = `position:fixed;z-index:1000;margin:0;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:190px;box-shadow:0 8px 24px rgba(15,23,42,.22);left:${Math.min(x, window.innerWidth - 210)}px;top:${Math.min(y, window.innerHeight - 140)}px;`;
    m.innerHTML = `<div class="text-xs text-muted" style="font-weight:700;">Cambio de ${que}</div>
      <button class="btn btn-sm btn-primary" data-a="mover">Mover</button>
      <button class="btn btn-sm" data-a="duplicar" title="${equipo ? 'Queda en los dos equipos' : ''}${equipo && posicion ? ' · ' : ''}${posicion ? 'Sale en las dos posiciones' : ''}">Duplicar</button>
      <button class="btn btn-sm btn-ghost" data-a="">Cancelar</button>`;
    const fin = v => { m.remove(); document.removeEventListener('mousedown', fuera, true); document.removeEventListener('keydown', esc); resolve(v); };
    const fuera = ev => { if (!m.contains(ev.target)) fin(null); };
    const esc = ev => { if (ev.key === 'Escape') fin(null); };
    m.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => fin(b.dataset.a || null)));
    document.body.appendChild(m);
    setTimeout(() => { document.addEventListener('mousedown', fuera, true); document.addEventListener('keydown', esc); }, 0);
  });
}

function renderPanelPlantillas(container) {
  if (!plantillasCache) {
    container.innerHTML = `${firebaseNotice()}<p class="text-xs text-muted">Cargando plantillas…</p>`;
    ensurePlantillas().then(() => { if (container.isConnected) renderPanelPlantillas(container); });
    return;
  }
  if (!plantillaTemporada || !state.seasons.includes(plantillaTemporada)) plantillaTemporada = state.season || state.seasons[0] || '';
  if (plVista.modo !== 'grid' && !puedeVer(`plantillas.${plVista.modo}`)) plVista = { modo: 'grid', teamKey: null };
  if (plVista.modo === 'datos') return renderPlantillaDatos(container);
  if (plVista.modo === 'pres') return renderPlantillaPresentacion(container);
  const docDe = teamKey => plantillasCache.find(d => d.id === plantillaDocId(plantillaTemporada, teamKey));
  const nombreDe = id => { const j = state.players.find(x => x.id === id); return j ? `${j.nombre || ''} ${j.apellidos || ''}`.trim() : '(jugador eliminado)'; }; // nombre primero
  const todos = [...state.players].sort(ordenJugadores);

  container.innerHTML = `
    ${firebaseNotice()}
    <style>.pl-chip .pl-x{opacity:0;transition:opacity .15s;}.pl-chip:hover .pl-x,.pl-chip:focus-within .pl-x{opacity:1;}@media (hover:none){.pl-chip .pl-x{opacity:.6;}}</style>
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
        const pj = id => state.players.find(x => x.id === id);
        const corto = j => `${j?.nombre || ''} ${String(j?.apellidos || '').trim().split(/\s+/)[0] || ''}`.trim() || '(jugador eliminado)';
        const iniciales = j => `${(j?.nombre || '?')[0] || ''}${(j?.apellidos || '')[0] || ''}`.toUpperCase();
        const colorLinea = key => { const k = normalizeTxt(key); return k === '_sin' ? '#94a3b8' : /porter/.test(k) ? '#d4a63a' : /central|lateral|defens/.test(k) ? '#1d4ed8' : /medio|interior|pivote|centrocamp/.test(k) ? '#1f6b2a' : '#b91c1c'; };
        const extrasDe = id => (pj(id)?.posicionesExtra || []).filter(k => state.positions.some(p => p.key === k));
        const chip = (id, colKey) => { const j = pj(id), extra = colDe(id) !== colKey; return `<div class="pl-chip" draggable="true" data-pl-drag="${t.key}|${id}|${colKey}" title="${extra ? 'Posición duplicada (la principal es ' + safeText(state.positions.find(p => p.key === colDe(id))?.label || 'otra') + '). ' : ''}Arrastra a otra posición o a otro equipo: mover o duplicar" style="cursor:grab;position:relative;display:flex;align-items:center;gap:7px;background:var(--bg-surface, #fff);border:1px ${extra ? 'dashed' : 'solid'} var(--border-default);border-radius:8px;padding:4px 6px;min-width:0;">
            ${j?.fotoUrl ? `<img src="${j.fotoUrl}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;" />` : `<span style="width:24px;height:24px;border-radius:50%;background:var(--bg-hover);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--blue-600, #1d4ed8);">${safeText(iniciales(j))}</span>`}
            <a href="#" data-pl-ir="${t.key}|${id}" class="text-xs" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);text-decoration:none;font-weight:600;" title="${safeText(nombreDe(id))} — ver ficha">${safeText(corto(j))}</a>
            ${extra ? `<button class="btn btn-sm btn-ghost pl-x" style="padding:0 4px;" data-pl-del-extra="${id}|${colKey}" title="Quitar de esta posición (sigue en la principal)" aria-label="Quitar ${safeText(nombreDe(id))} de esta posición">✕</button>`
              : `<button class="btn btn-sm btn-ghost pl-x" style="padding:0 4px;" data-pl-del="${t.key}|${id}" title="Quitar de la plantilla" aria-label="Quitar ${safeText(nombreDe(id))}">✕</button>`}
          </div>`; };
        const verDatos = plCardDatos.has(t.key) && ids.length && puedeVer('plantillas.datos');
        const añadir = col => {
          const libresPos = [...libres.filter(j => (j.positionKey || '_sin') === col.key), ...libres.filter(j => (j.positionKey || '_sin') !== col.key)];
          return `<details class="pl-add" style="position:relative;">
            <summary class="text-xs" style="list-style:none;cursor:pointer;border:1px dashed var(--border-emphasis, #cbd5e1);border-radius:8px;padding:5px;text-align:center;color:var(--text-muted);">+ Añadir</summary>
            <div class="card" style="position:absolute;left:0;top:calc(100% + 4px);z-index:20;margin:0;padding:10px;width:280px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 24px rgba(15,23,42,.18);">
              <div class="text-xs" style="font-weight:800;color:var(--blue-600, #1d4ed8);">+ AÑADIR A ${safeText(plPlural(col.titulo).toUpperCase())}</div>
              <div class="flex gap-8"><select class="select" data-pl-sel="${t.key}|${col.key}" style="flex:1;min-width:0;"><option value="">Elegir jugador…</option>${libresPos.map(j => `<option value="${j.id}">${safeText(nombreCompleto(j))}</option>`).join('')}</select>
              <button class="btn btn-sm btn-primary" data-pl-add="${t.key}|${col.key}">Añadir</button></div>
              <div class="text-xs text-muted">o pega una lista (uno por línea; crea los que no existan):</div>
              <textarea class="input" data-pl-lista="${t.key}|${col.key}" rows="4" style="width:100%;font-size:12px;" placeholder="Apellidos, Nombre&#10;o: Nombre Apellidos"></textarea>
              <button class="btn btn-sm" data-pl-lista-ok="${t.key}|${col.key}">Añadir la lista</button>
            </div>
          </details>`;
        };
        return `<div class="card" data-pl-det="${t.key}"><div class="card-body">
          <div class="flex gap-8" style="align-items:center;flex-wrap:wrap;margin-bottom:12px;">
            <b style="font-size:17px;">${safeText(t.label)}</b>
            <span class="text-muted" style="font-size:14px;font-weight:600;" title="${campo} de campo + ${porteros} portero${porteros === 1 ? '' : 's'}">${campo}+${porteros}</span>
            ${puedeVer('plantillas.datos') && ids.length ? `<span style="display:inline-flex;background:var(--bg-hover);border-radius:999px;padding:3px;margin-left:6px;">
              <button class="btn btn-sm ${verDatos ? 'btn-ghost' : ''}" data-pl-vista="${t.key}|plantilla" style="border-radius:999px;${verDatos ? '' : 'background:var(--bg-surface, #fff);font-weight:700;'}">Plantilla</button>
              <button class="btn btn-sm ${verDatos ? '' : 'btn-ghost'}" data-pl-vista="${t.key}|datos" style="border-radius:999px;${verDatos ? 'background:var(--bg-surface, #fff);font-weight:700;' : ''}">Datos</button></span>` : ''}
            <span style="flex:1;"></span>
            ${puedeVer('plantillas.pres') ? `<button class="btn btn-sm btn-primary" data-pl-pres="${t.key}" ${ids.length ? '' : 'disabled'}>Presentación de fichas</button>` : ''}
          </div>
          ${verDatos ? `<div data-pl-datos-box="${t.key}"><p class="text-xs text-muted mb-8">Los cambios se guardan al salir de la casilla y son los mismos de la ficha del jugador.</p>${datosEquipoTablaHTML(t.key)}</div>` : `
          <div style="overflow-x:auto;"><div style="display:grid;grid-template-columns:repeat(${columnas.length},minmax(130px,1fr));gap:8px;">
            ${columnas.map(col => { const cj = ids.filter(id => colDe(id) === col.key || (col.key !== '_sin' && extrasDe(id).includes(col.key) && colDe(id) !== col.key)); return `<div data-pl-col="${col.key}" data-pl-team="${t.key}" style="background:var(--bg-hover);border-radius:10px;border-top:4px solid ${colorLinea(col.key)};padding:8px;display:flex;flex-direction:column;gap:5px;min-width:0;">
              <div class="flex" style="justify-content:space-between;font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--text-muted);" title="${safeText(col.titulo)}"><span>${safeText(col.key === '_sin' ? 'SIN POSICIÓN' : plPlural(col.titulo).toUpperCase())}</span><span>${cj.length || ''}</span></div>
              ${cj.map(id => chip(id, col.key)).join('')}
              ${añadir(col)}
            </div>`; }).join('')}
          </div></div>`}
        </div></div>`;
      }).join('')}
    </div>`;
  container.querySelectorAll('details[data-pl-det]').forEach(d => {
    d.addEventListener('toggle', () => { d.open ? plAbiertos.add(d.dataset.plDet) : plAbiertos.delete(d.dataset.plDet); });
    d.querySelector('summary')?.addEventListener('click', e => { if (e.target.closest('button')) e.preventDefault(); });
  });

  const guardar = async (teamKey, patch, cachePatch) => {
    try {
      await guardarPlantilla(plantillaTemporada, teamKey, patch, cachePatch);
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
    const [teamKey, colKey] = btn.dataset.plAdd.split('|');
    const sel = container.querySelector(`[data-pl-sel="${btn.dataset.plAdd}"]`);
    if (!sel?.value) return;
    // Sin posición todavía → se le pone la de la columna desde la que se añade.
    if (colKey && colKey !== '_sin' && !state.players.find(x => x.id === sel.value)?.positionKey) {
      guardarCampoJugador(sel.value, 'positionKey', colKey).catch(err => console.error('[Firestore] Posición:', err));
    }
    guardar(teamKey, { jugadorIds: arrayUnion(sel.value) }, { jugadorIds: [...new Set([...(docDe(teamKey)?.jugadorIds || []), sel.value])] });
  }));
  container.querySelectorAll('[data-pl-del]').forEach(btn => btn.addEventListener('click', () => {
    const [teamKey, jid] = btn.dataset.plDel.split('|');
    guardar(teamKey, { jugadorIds: arrayRemove(jid) }, { jugadorIds: (docDe(teamKey)?.jugadorIds || []).filter(x => x !== jid) });
  }));
  container.querySelectorAll('[data-pl-vista]').forEach(btn => btn.addEventListener('click', () => {
    const [teamKey, vista] = btn.dataset.plVista.split('|');
    if (vista === 'datos') plCardDatos.add(teamKey); else plCardDatos.delete(teamKey);
    preservandoScroll(() => renderPanelPlantillas(container));
  }));
  // Arrastrar un jugador a otra columna = cambiar su posición (en su ficha y en toda la app).
  container.querySelectorAll('[data-pl-drag]').forEach(ch => ch.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', ch.dataset.plDrag); e.dataTransfer.effectAllowed = 'move'; ch.style.opacity = '.5';
  }));
  container.querySelectorAll('[data-pl-drag]').forEach(ch => ch.addEventListener('dragend', () => { ch.style.opacity = ''; }));
  container.querySelectorAll('[data-pl-col]').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.style.outline = '2px dashed var(--blue-500, #3b82f6)'; });
    col.addEventListener('dragleave', () => { col.style.outline = ''; });
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.style.outline = '';
      const [origen, id, colOrigen] = e.dataTransfer.getData('text/plain').split('|'), equipo = col.dataset.plTeam;
      const destino = col.dataset.plCol === '_sin' ? null : col.dataset.plCol;
      const j = state.players.find(x => x.id === id);
      if (!j || !id) return;
      const principal = j.positionKey || null, extras = (j.posicionesExtra || []).filter(k => k !== principal);
      const cambiaEq = origen !== equipo, cambiaPos = (colOrigen === '_sin' ? null : colOrigen) !== destino && principal !== destino && !(destino && extras.includes(destino) && !cambiaEq);
      if (!cambiaPos && !cambiaEq) return;
      const accion = !cambiaEq && !destino ? 'mover' : await plElegirMoverDuplicar(e.clientX, e.clientY, { equipo: cambiaEq, posicion: cambiaPos && !!destino });
      if (!accion) return;
      const dup = accion === 'duplicar';
      try {
        // Equipo: mover = sale del de origen y entra en el de destino; duplicar = está en los dos (misma temporada).
        if (cambiaEq) {
          await guardarPlantilla(plantillaTemporada, equipo, { jugadorIds: arrayUnion(id) }, { jugadorIds: [...new Set([...(docDe(equipo)?.jugadorIds || []), id])] });
          if (!dup) {
            await guardarPlantilla(plantillaTemporada, origen, { jugadorIds: arrayRemove(id) }, { jugadorIds: (docDe(origen)?.jugadorIds || []).filter(x => x !== id) });
            if (j.teamKey === origen) await guardarCampoJugador(id, 'teamKey', equipo);
          }
        }
        // Posición: mover = cambia la de esa casilla; duplicar = sale también en la nueva columna (posición extra).
        if (cambiaPos) {
          const desdeExtra = colOrigen !== '_sin' && colOrigen !== principal;
          if (dup && destino) await guardarCampoJugador(id, 'posicionesExtra', [...new Set([...extras, destino])]);
          else if (desdeExtra && destino) await guardarCampoJugador(id, 'posicionesExtra', [...new Set([...extras.filter(k => k !== colOrigen), destino])]);
          else {
            if (destino && extras.includes(destino)) await guardarCampoJugador(id, 'posicionesExtra', extras.filter(k => k !== destino));
            await guardarCampoJugador(id, 'positionKey', destino);
          }
        }
        const posTxt = destino ? state.positions.find(p => p.key === destino)?.label || destino : 'sin posición';
        showSuccess(`${nombreCompleto(j)} ${dup ? '+' : '→'} ${[cambiaEq ? TEAMS.find(x => x.key === equipo)?.label || equipo : '', cambiaPos ? posTxt : ''].filter(Boolean).join(' · ')}`);
      } catch (err) { console.error('[Firestore] Mover jugador:', err); showError('No se pudo guardar el cambio.'); }
      preservandoScroll(() => renderPanelPlantillas(container));
    });
  });
  container.querySelectorAll('[data-pl-del-extra]').forEach(btn => btn.addEventListener('click', async () => {
    const [jid, colKey] = btn.dataset.plDelExtra.split('|');
    const j = state.players.find(x => x.id === jid); if (!j) return;
    try { await guardarCampoJugador(jid, 'posicionesExtra', (j.posicionesExtra || []).filter(k => k !== colKey)); }
    catch (err) { console.error('[Firestore] Posición extra:', err); showError('No se pudo quitar.'); }
    preservandoScroll(() => renderPanelPlantillas(container));
  }));
  container.querySelectorAll('[data-pl-datos-box]').forEach(box => wireDatosEquipo(box, () => preservandoScroll(() => renderPanelPlantillas(container))));
  // Un solo "+ Añadir" abierto; se cierra al pulsar fuera.
  container.querySelectorAll('details.pl-add').forEach(d => d.addEventListener('toggle', () => {
    if (!d.open) return;
    container.querySelectorAll('details.pl-add[open]').forEach(o => { if (o !== d) o.open = false; });
    // Flotante (la fila de posiciones tiene scroll y lo recortaría)
    const r = d.querySelector('summary').getBoundingClientRect(), menu = d.querySelector('.card');
    menu.style.position = 'fixed';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px';
    const alto = menu.offsetHeight || 220;
    menu.style.top = (r.bottom + 4 + alto > window.innerHeight ? Math.max(8, r.top - alto - 4) : r.bottom + 4) + 'px';
  }));
  if (!plAddCierreGlobal) {
    plAddCierreGlobal = true;
    document.addEventListener('click', e => { if (!e.target.closest('details.pl-add')) document.querySelectorAll('details.pl-add[open]').forEach(o => { o.open = false; }); });
    window.addEventListener('scroll', e => { if (!e.target.closest?.('details.pl-add')) document.querySelectorAll('details.pl-add[open]').forEach(o => { if (!o.contains(document.activeElement)) o.open = false; }); }, true);
  }
  container.querySelectorAll('[data-pl-ir]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); const id = el.dataset.plIr.split('|')[1];
    jugFichaId = id; jugadorFormId = null; jugFichaTab = 'datos'; jugFichaEvalId = null; jugVolverA = 'plantillas'; jugVolverScroll = window.scrollY; switchTab('jugadores');
  }));
  container.querySelectorAll('[data-pl-pres]').forEach(btn => btn.addEventListener('click', () => { plVista = { modo: 'pres', teamKey: btn.dataset.plPres }; renderPanelPlantillas(container); }));
  container.querySelectorAll('[data-pl-lista-ok]').forEach(btn => btn.addEventListener('click', async () => {
    const [teamKey, colKey] = btn.dataset.plListaOk.split('|');
    const texto = container.querySelector(`[data-pl-lista="${btn.dataset.plListaOk}"]`).value;
    if (!texto.trim()) return;
    if (isFirebaseUnconfigured()) { showError('Configura Firebase para crear plantillas.'); return; }
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      const r = await crearPlantillaDesdeLista(texto, teamKey, plantillaTemporada, colKey && colKey !== '_sin' ? colKey : null);
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
/** Tabla editable de datos de los jugadores de un equipo (misma fuente que Jugadores). */
function datosEquipoTablaHTML(teamKey) {
  const ids = plantillasCache.find(d => d.id === plantillaDocId(plantillaTemporada, teamKey))?.jugadorIds || [];
  const jugs = ids.map(id => state.players.find(x => x.id === id)).filter(Boolean).sort(ordenJugadores);
  const inp = (j, campo, tipo = 'text', extra = '') => `<input class="input" type="${tipo}" ${extra} data-pl-campo="${campo}" data-pl-id="${j.id}" value="${safeText(j[campo] ?? '')}" style="min-width:${tipo === 'date' ? 130 : 80}px;" />`;
  return `<div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Apellidos</th><th>Nombre</th><th>F. nacimiento</th><th>Lateralidad</th><th>Posición</th><th>Altura (m)</th><th>Peso (kg)</th><th>Complexión</th><th>Ed. madurativa</th><th></th></tr></thead>
      <tbody>${jugs.map(j => `<tr>
        <td>${inp(j, 'apellidos')}</td><td>${inp(j, 'nombre')}</td><td>${inp(j, 'birthDate', 'date')}</td>
        <td><select class="select" data-pl-campo="foot" data-pl-id="${j.id}">${['', 'Diestro', 'Zurdo', 'Ambidiestro'].map(v => `<option value="${v}" ${(j.foot || '') === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}</select></td>
        <td><select class="select" data-pl-campo="positionKey" data-pl-id="${j.id}"><option value="">—</option>${state.positions.map(p => `<option value="${p.key}" ${j.positionKey === p.key ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}</select></td>
        <td>${inp(j, 'height', 'number', 'step="0.01" min="0"')}</td><td>${inp(j, 'weight', 'number', 'step="0.1" min="0"')}</td>
        <td>${inp(j, 'complexion')}</td><td>${inp(j, 'maturationalAge')}</td>
        <td><button class="btn btn-sm" data-pl-ficha="${j.id}">Ficha</button></td></tr>`).join('')}</tbody>
    </table></div>`;
}
function wireDatosEquipo(root, rerender) {
  root.querySelectorAll('[data-pl-campo]').forEach(el => el.addEventListener('change', async () => {
    const campo = el.dataset.plCampo;
    let v = el.value;
    if (campo === 'height' || campo === 'weight') v = v === '' ? null : parseFloat(v);
    else if (campo === 'birthDate') v = v || null;
    else if (campo === 'complexion') v = v.trim() || null;
    else if (typeof v === 'string' && campo !== 'foot' && campo !== 'positionKey') v = v.trim();
    if (campo === 'positionKey') v = v || null;
    if (campo === 'nombre' && !v) { showError('El nombre es obligatorio.'); rerender(); return; }
    try { await guardarCampoJugador(el.dataset.plId, campo, v); if (campo === 'positionKey') rerender(); }
    catch (err) { console.error('[Firestore] Campo jugador:', err); showError('No se pudo guardar el cambio.'); }
  }));
  root.querySelectorAll('[data-pl-ficha]').forEach(btn => btn.addEventListener('click', () => {
    jugFichaId = btn.dataset.plFicha; jugadorFormId = null; jugFichaTab = 'fichas'; jugFichaEvalId = null;
    switchTab('jugadores');
  }));
}

/** Textos editables de las fichas (Ficha 1: potenciar/mejorar y descripción · Ficha 2: plan de acción).
 *  Se guardan en el jugador por evaluación (fichaTextos[evaluación]): lo mismo se ve en su ficha y en la presentación. */
function leerTextosFicha(f1, f2) {
  const grids = [...(f1?.querySelectorAll('.p1-aspectos-grid') || [])];
  const leer = (g, i) => [...(g?.querySelectorAll('.p1-aspectos-col')[i]?.querySelectorAll('li') || [])].map(li => li.innerText.trim());
  const out = { of_pot: leer(grids[0], 0), of_mej: leer(grids[0], 1), def_pot: leer(grids[1], 0), def_mej: leer(grids[1], 1),
    desc: (f1?.querySelector('.p1-desc-text')?.innerText || '').trim() };
  if (f2?.querySelector('li[data-plan]')) {
    out.plan = {};
    ['tecnico', 'tactico', 'condicional', 'mental'].forEach(k => { out.plan[k] = [...f2.querySelectorAll(`li[data-plan="${k}"]`)].map(li => li.innerText.trim()); });
  }
  return out;
}
async function guardarTextosFicha(jug, key, f1, f2, { btn, aviso, pendienteBtn } = {}) {
  if (!f1 && !f2) return;
  const nuevo = { ...(jug.fichaTextos?.[key] || {}), ...leerTextosFicha(f1, f2) };
  if (JSON.stringify(nuevo) === JSON.stringify(jug.fichaTextos?.[key] || {})) { if (aviso) showSuccess('Sin cambios que guardar.'); marcarTextosPendientes(btn || pendienteBtn, false); return; }
  const txt = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    await updateMapEntry('jugadores', jug.id, 'fichaTextos', key, nuevo);
    const fichaTextos = { ...(jug.fichaTextos || {}), [key]: nuevo };
    jug.fichaTextos = fichaTextos;
    setState({ players: state.players.map(x => x.id === jug.id ? { ...x, fichaTextos } : x) });
    showSuccess(aviso ? 'Textos de la ficha guardados.' : 'Guardado ✓', aviso ? undefined : 1500);
    marcarTextosPendientes(btn || pendienteBtn, false);
  } catch (err) {
    console.error('[Firestore] No se pudieron guardar los textos:', err);
    showError('No se pudieron guardar los textos (revisa las reglas de Firestore).');
    if (btn) btn.textContent = txt;
  } finally { if (btn) btn.disabled = false; }
}
/** Botón «Guardar textos» en ámbar mientras haya cambios sin guardar (p. ej. una descripción propuesta por la IA). */
function marcarTextosPendientes(btn, pendiente) {
  if (!btn) return;
  btn.style.background = pendiente ? '#f59e0b' : '';
  btn.style.borderColor = pendiente ? '#d97706' : '';
  btn.style.boxShadow = pendiente ? '0 0 0 3px rgba(245,158,11,.35)' : '';
  btn.textContent = pendiente ? '💾 Guardar textos (sin guardar)' : '💾 Guardar textos';
}
/** Guarda solo al salir de un texto editado de la ficha (sin tener que pulsar «Guardar textos»). */
function autoGuardarTextosFicha(roots, guardar, btn = null) {
  let t = null;
  roots.filter(Boolean).forEach(r => r.addEventListener('input', e => { if (e.target.closest?.('[contenteditable="true"]')) marcarTextosPendientes(btn, true); }));
  roots.filter(Boolean).forEach(r => r.addEventListener('focusout', e => {
    if (!e.target.closest?.('[contenteditable="true"]')) return;
    clearTimeout(t); t = setTimeout(guardar, 300);
  }));
}

/** «✨ Proponer descripción»: la IA redacta la descripción de la Ficha 1 (no se guarda sola; luego «Guardar textos»). */
async function proponerDescripcion(btn, descEl, p, evSel, aspectosTxt, btnGuardar = null) {
  if (!descEl) return;
  if (descEl.innerText.trim() && !confirm(`Ya hay una descripción de ${nombreCompleto(p)}. ¿Sustituirla por la propuesta?`)) return;
  const fPos = evSel?.posKey || p.positionKey, comp = evSel?.media?.porCompetencia || {};
  const apc = buildAspectoPorCompetencia(state, fPos);
  const notas = Object.entries(comp).filter(([, v]) => typeof v === 'number')
    .map(([c, v]) => ({ competencia: c, bloque: apc[c] || 'perfil', nota: Math.round(v * 100) / 100 }));
  if (!notas.length) { showError(`${nombreCompleto(p)} no tiene notas en esta evaluación: no hay con qué escribir la descripción.`); return; }
  const limpia = arr => (arr || []).filter(Boolean);
  const datos = {
    jugador: `${p.nombre || ''} ${p.apellidos || ''}`.trim(),
    posicion: state.positions.find(x => x.key === fPos)?.label || fPos || '',
    equipo: TEAMS.find(t => t.key === p.teamKey)?.label || '',
    evaluacion: evSel?.ev ? `${evSel.ev.temporada} · ${evSel.ev.nombre}` : '',
    notas, rp: aspectosTxt?.rp || null,
    comentarios: {
      ofensivos_potenciar: limpia(aspectosTxt?.ofensivos?.potenciar), ofensivos_mejorar: limpia(aspectosTxt?.ofensivos?.mejorar),
      defensivos_potenciar: limpia(aspectosTxt?.defensivos?.potenciar), defensivos_mejorar: limpia(aspectosTxt?.defensivos?.mejorar),
    },
    frasesModelo: (state.frasesModelo || []).slice(0, 40),
  };
  const txtBtn = btn.textContent;
  btn.disabled = true; btn.textContent = '✨ Escribiendo…';
  try {
    let token = null; try { token = await tokenActual(); } catch (_) { /* modo local */ }
    const r = await fetch('/api/describir', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, body: JSON.stringify(datos) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 503 && d.error === 'no-configurado') throw new Error('falta poner la clave ANTHROPIC_API_KEY en Vercel.');
    if (!r.ok || !d.texto) throw new Error(d.error || ('error ' + r.status));
    descEl.textContent = d.texto;
    marcarTextosPendientes(btnGuardar, true);
    showSuccess('Descripción propuesta: revísala y pulsa «Guardar textos».', 6000);
  } catch (err) {
    showError('No se pudo proponer la descripción: ' + (err.message || err), 9000);
  } finally { btn.disabled = false; btn.textContent = txtBtn; }
}

// ── Plantilla · Datos (pantalla completa, se mantiene por compatibilidad) ──
function renderPlantillaDatos(container) {
  const t = TEAMS.find(x => x.key === plVista.teamKey);
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="flex gap-8 mb-16" style="align-items:center;flex-wrap:wrap;">
      <button class="btn btn-ghost" id="pl-volver">← Equipos</button>
      <b>${safeText(t?.label || '')} · ${safeText(plantillaTemporada)}</b>
      <span class="text-xs text-muted">Los cambios se guardan al salir de la casilla y son los mismos de la ficha del jugador.</span>
    </div>
    ${datosEquipoTablaHTML(plVista.teamKey)}`;
  container.querySelector('#pl-volver').addEventListener('click', () => { plVista = { modo: 'grid', teamKey: null }; renderPanelPlantillas(container); });
  wireDatosEquipo(container, () => renderPlantillaDatos(container));
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
// Posición con la que se hizo la encuesta de un jugador en una evaluación: la de sus registros (la más repetida);
// la de la evaluación solo si los registros no la tienen (evaluaciones antiguas). Así una encuesta de laterales
// subida a una evaluación antigua de centrales se ve con los criterios de lateral.
function posicionDeRegistros(rs, ev) {
  const n = {};
  (rs || []).forEach(r => { if (r.posicionKey) n[r.posicionKey] = (n[r.posicionKey] || 0) + 1; });
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || ev?.posicionKey || null;
}

function prepararFichaJugador(p, regs, temporada, evalPreferida = null) { // evalPreferida: la elegida para todo el equipo
  const evInfo = eid => (regEvaluaciones || []).find(e => e.id === eid);
  const grupos = {};
  (regs || []).forEach(r => { const k = r.evaluacionId || 'sin-evaluacion'; (grupos[k] = grupos[k] || []).push(r); });
  let filasEval = Object.entries(grupos).map(([eid, rs]) => {
    const ev = evInfo(eid);
    const posKey = posicionDeRegistros(rs, ev);
    const media = calcularMediasPorJugador(rs.map(r => ({ ...r, jugadorId: p.id })), buildAspectoPorCompetencia(state, posKey))[p.id];
    const idx = (regEvaluaciones || []).findIndex(e => e.id === eid);
    return { eid, ev, posKey, media, orden: `${ev?.fechaFin || ev?.fechaInicio || ''}|${String(idx).padStart(5, '0')}` };
  }).filter(f => f.eid !== 'sin-evaluacion' && f.ev);
  new Set([...Object.keys(p.condicionalPorEval || {}), ...Object.keys(p.condicionalMaxPorEval || {})]).forEach(eid => {
    const ev = evInfo(eid);
    if (!ev || filasEval.some(f => f.eid === eid)) return;
    const idx = (regEvaluaciones || []).findIndex(e => e.id === eid);
    filasEval.push({ eid, ev, posKey: p.positionKey || ev.posicionKey, media: null, orden: `${ev.fechaFin || ev.fechaInicio || ''}|${String(idx).padStart(5, '0')}` });
  });
  filasEval.sort((x, y) => String(y.orden).localeCompare(String(x.orden)));
  const evSel = evalPreferida ? (filasEval.find(f => f.eid === evalPreferida) || null)
    : (filasEval.find(f => f.ev?.temporada === temporada && f.media) || filasEval.find(f => f.ev?.temporada === temporada) || filasEval.find(f => f.media) || filasEval[0] || null);
  const textosKey = evSel?.eid || 'sin-evaluacion';
  const regsEval = evSel ? (regs || []).filter(r => (r.evaluacionId || 'sin-evaluacion') === evSel.eid) : [];
  const filasTexto = k => regsEval.map(r => String(r.textos?.[k] || '').replace(/\s*\n+\s*/g, ' · ').trim()).filter(Boolean);
  const origenTxt = k => p.fichaTextos?.[textosKey]?.[k] ?? filasTexto(k);
  const cinco = arr => Array.from({ length: 5 }, (_, i) => arr[i] || '');
  const mediaRP = k => { const v = regsEval.map(r => r.rp?.[k]).filter(x => typeof x === 'number'); if (!v.length) return null; const m = v.reduce((x, y) => x + y, 0) / v.length; return fmtDec(m); };
  return {
    evSel, textosKey,
    fPos: evSel?.posKey || p.positionKey, fMedia: evSel?.media || null,
    aspectosTxt: {
      desc: p.fichaTextos?.[textosKey]?.desc || '',
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
    .pl-t{font-weight:900;text-transform:uppercase;letter-spacing:-0.01em;line-height:1;margin:0;overflow-wrap:normal;word-break:normal;hyphens:none;}
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
    #pl-pres-lista.pl-solo .pl-pend{display:none !important;}
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
const plNotasPortada = () => { try { return localStorage.getItem('rm-pl-notas-portada') !== '0'; } catch { return true; } };
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

function plSeparadorPosicion(c, titulo, jugadores, f1Map) {
  const n = jugadores.length;
  // Opción "Notas en las portadas": cada jugador se dibuja como en el campograma (donut, notas R/P y 3 perfiles).
  if (f1Map && plNotasPortada() && jugadores.some(j => f1Map[j.id])) {
    const filas = n > 12 ? 3 : n > 4 ? 2 : 1, porFila = Math.ceil(n / filas);
    const slot = Math.floor(1700 / porFila);
    const TOP = 310, BOT = PL_H - 190, rowH = (BOT - TOP) / filas;
    const K = Math.min(1, (slot - 16) / 453, (rowH - 16) / 240);
    const celdasN = jugadores.map((j, i) => {
      const fila = Math.floor(i / porFila), col = i % porFila;
      const enFila = fila === filas - 1 ? n - porFila * (filas - 1) : porFila;
      const x0 = (PL_W - enFila * slot) / 2 + col * slot;
      const cx = x0 + (slot - 453 * K) / 2 + 101 * K;
      const cy = TOP + fila * rowH + rowH / 2 - 12.5 * K;
      if (f1Map[j.id]) return plCardJugador(j, f1Map[j.id], cx / PL_W * 100, cy / PL_H * 100, K).replace('cursor:grab;', '').replace(/ title="[^"]*"/, '');
      // Sin ficha: solo nombre (no hay notas que mostrar)
      return `<div style="position:absolute;left:${x0}px;top:${cy}px;width:${slot}px;"><div class="pl-nombre" style="font-size:34px;">${safeText(`${j.nombre || ''} ${j.apellidos || ''}`.trim())}</div></div>`;
    }).join('');
    return plSlide(`
    ${plCrest('left:40px;top:40px;')}
    ${plOro('right:140px;top:60px;', 200, 330)}${plOro('right:60px;top:100px;', 200, 330)}
    <div class="pl-t pl-t-l" style="position:absolute;left:0;right:0;top:170px;text-align:center;"><span class="pl-ed" ${plEd('sep.' + titulo)}>${plT('sep.' + titulo, plPlural(titulo))}</span></div>
    ${celdasN}
    ${plPoligono('left:0;bottom:0;', 520, 150, [[0, 0], [94, 0], [100, 100], [0, 100]], PL_ORO_SOLIDO)}
    ${plPoligono('right:0;bottom:0;', 640, 150, [[6, 0], [100, 0], [100, 100], [0, 100]], PL_ORO_SOLIDO)}`, c.slate);
  }
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
    // Títulos grandes: si una palabra no cabe en su caja, se reduce la letra (nunca se parte la palabra).
    sl.querySelectorAll('.pl-t-xl, .pl-t-l').forEach(el => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 1 && size > 48) { size -= 4; el.style.fontSize = size + 'px'; }
    });
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
    const v = notaNum(txt);
    return hex ? { bg: hex, fg: textoSobre(hex), t: fmtDec(v) } : { bg: '#ffffff', fg: '#111', t: 'X' };
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
  return svgComoImg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${R * 2}" height="${R * 2}" viewBox="0 0 ${R * 2} ${R * 2}"><defs>${defs.join('')}</defs>${quarters}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#94a3b8" stroke-width="1"/>${textos.join('')}</svg>`, R * 2, R * 2, 'position:absolute;right:60px;bottom:45px;'); // centro hueco: se ve el campo (como el hueco de la foto)
}

// Mapa de nivel: izquierda = residen en Madrid (Residente / Media pensión), derecha = En residencia.
// Franjas por la nota elegida (Rendimiento o Proyección): ≥4 verde · 3–<4 amarillo · <3 rojo. Sin esa nota → franja 3-4 con "X".
const PL_RESI = {
  'Madrid':        { lado: 'izq', bg: '#ffffff', fg: '#0b2a6b', txt: 'MADRID' },
  'Media pensión': { lado: 'izq', bg: '#0b2a6b', fg: '#ffffff', txt: 'MEDIA PENSIÓN' },
  'Residencia':    { lado: 'der', bg: '#d4a63a', fg: '#111111', txt: 'RESIDENCIA' },
};
let plMapaModo = 'r';   // nota que ordena el mapa de nivel: 'r' rendimiento · 'p' proyección · 'rp' las dos (2 diapositivas)
function plMapaNivel(tLabel, temporada, items, modo = 'r') {
  const conf = it => PL_RESI[residenciaDe(it.j)] || PL_RESI[RESI_DEFECTO];
  const campoN = modo === 'p' ? 'pValue' : 'rValue';
  const notaDe = it => notaNum(it.f1?.player?.[campoN]);
  const bandas = [
    { lab: '+4', bg: '#7bbf90', ok: v => v != null && v >= 4 },
    { lab: '3-4', bg: '#f2e09c', ok: v => v != null && v >= 3 && v < 4 }, // sin nota: fuera de la diapositiva (lista de pendientes)
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
      const txtNota = hex ? String(Math.round(v * 10) / 10).replace('.', ',') : 'X'; // mapa de nivel: 1 decimal como mucho
      const bgN = hex || '#ffffff', fgN = hex ? textoSobre(hex) : '#111';
      const cid = `plmn${++plUid}`, R0 = D / 2, dN = Math.min(56, Math.max(String(txtNota).length > 3 ? 42 : 34, Math.round(D * 0.5)));
      const foto = it.j.fotoUrl
        ? svgComoImg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}"><clipPath id="${cid}"><circle cx="${R0}" cy="${R0}" r="${R0}"/></clipPath><circle cx="${R0}" cy="${R0}" r="${R0}" fill="#ffffff"/><image xlink:href="${it.j.fotoUrl}" href="${it.j.fotoUrl}" x="0" y="0" width="${D}" height="${D}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${cid})"/></svg>`, D, D, `position:absolute;left:${(ITEM_W - D) / 2}px;top:0;`)
        : `<div style="position:absolute;left:${(ITEM_W - D) / 2}px;top:0;width:${D}px;height:${D}px;border-radius:50%;background:#fff;"></div>`;
      const ap = String(it.j.apellidos || it.j.nombre || '').trim().toUpperCase();
      return `<div style="position:absolute;left:${cx - ITEM_W / 2}px;top:${top}px;width:${ITEM_W}px;height:${D + 44}px;">
        ${foto}
        <div style="position:absolute;left:${(ITEM_W + D) / 2 - dN * 0.55}px;top:${-dN * 0.25}px;width:${dN}px;height:${dN}px;border-radius:50%;background:${bgN};color:${fgN};border:3px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.max(12, Math.min(26, Math.round((dN - 6) / (txtNota.length > 1 ? txtNota.length * 0.58 : 1.4))))}px;line-height:1;letter-spacing:-0.5px;font-family:system-ui,sans-serif;">${safeText(txtNota)}</div>
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
    <div class="pl-barra mb-16" style="display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:0 0 10px 10px;">
      <div class="flex gap-8" style="align-items:center;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="pl-volver">← Equipos</button>
        <b style="font-size:16px;">${safeText(t?.label || '')}</b>
        <span class="text-sm text-muted">${safeText(temporada)} · ${jugs.length} jugadores</span>
        <label class="text-xs text-muted" for="pl-eval" style="margin-left:8px;">Evaluación</label>
        <select class="select btn-print-ficha" id="pl-eval" style="width:auto;min-width:200px;" title="La misma evaluación para todos los jugadores del equipo"><option>Cargando…</option></select>
        <span style="flex:1;"></span>
        <span class="text-xs text-muted" id="pl-pres-estado">Cargando fichas…</span>
        <button class="btn btn-print-ficha" id="pl-pres-full" title="Pantalla completa: flechas del teclado para pasar de diapositiva, Esc para salir">▶ Presentar</button>
        <button class="btn btn-primary btn-print-ficha" id="pl-pres-pdf" disabled>⬇ PDF del equipo</button>
      </div>
      <div class="flex gap-8 btn-print-ficha" style="align-items:center;flex-wrap:wrap;">
        <span class="text-xs text-muted" style="font-weight:700;letter-spacing:.5px;">IR A</span>
        <span id="pl-saltos" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;"></span>
      </div>
      <details class="btn-print-ficha" id="pl-opciones" ${plOpcionesAbiertas ? 'open' : ''}>
        <summary class="text-xs" style="cursor:pointer;font-weight:700;color:var(--text-muted);letter-spacing:.5px;">⚙ OPCIONES · fotos y contenido</summary>
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:8px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            <span class="text-xs text-muted" style="font-weight:700;">Fotos</span>
            <div class="flex gap-8" style="flex-wrap:wrap;align-items:center;">
              <label class="btn btn-sm" style="cursor:pointer;" title="Se usa en todos los equipos de la temporada salvo los que tengan una propia">Portada (todos los equipos)<input type="file" accept="image/*" id="pl-foto-portada" hidden /></label>
              <label class="btn btn-sm" style="cursor:pointer;" title="Solo para este equipo">Portada (solo este equipo)<input type="file" accept="image/*" id="pl-foto-portada-eq" hidden /></label>
              <button class="btn btn-sm btn-ghost" id="pl-foto-portada-quitar" ${docP().fotoPortada ? '' : 'style="display:none;"'}>↺ Usar la general</button>
              <label class="btn btn-sm" style="cursor:pointer;">Foto del equipo<input type="file" accept="image/*" id="pl-foto-equipo" hidden /></label>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <span class="text-xs text-muted" style="font-weight:700;">Contenido</span>
            <div class="flex gap-8" style="flex-wrap:wrap;align-items:center;">
              <label class="text-xs text-muted" for="pl-ref">Comparar medias con</label>
              <select class="select" id="pl-ref" style="max-width:240px;">
                <option value="team" ${plRefModo === 'team' ? 'selected' : ''}>Equipo (toda la plantilla)</option>
                <option value="teampos" ${plRefModo === 'teampos' ? 'selected' : ''}>Equipo · misma posición</option>
                <option value="none" ${plRefModo === 'none' ? 'selected' : ''}>Sin comparar</option>
              </select>
              <label class="text-xs" title="La portada de cada posición lleva las notas del campograma. Desmarcada: portada solo con fotos y nombres."><input type="checkbox" id="pl-notas-portada" ${plNotasPortada() ? 'checked' : ''} /> Notas en las portadas</label>
              <label class="text-xs"><input type="checkbox" id="pl-ver-obs" ${plVerObs() ? 'checked' : ''} /> Ver observaciones</label>
            </div>
          </div>
        </div>
      </details>
    </div>
    <div id="pl-pres-lista"></div>`;
  container.querySelector('#pl-volver').addEventListener('click', () => { plVista = { modo: 'grid', teamKey: null }; renderPanelPlantillas(container); });
  container.querySelector('#pl-opciones').addEventListener('toggle', e => { plOpcionesAbiertas = e.target.open; });
  container.querySelector('#pl-ref').addEventListener('change', e => { plRefModo = e.target.value; renderPlantillaPresentacion(container); });
  container.querySelector('#pl-notas-portada').addEventListener('change', e => { try { localStorage.setItem('rm-pl-notas-portada', e.target.checked ? '1' : '0'); } catch {} renderPlantillaPresentacion(container); });
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
  await cargarEvaluacionesSilencioso();
  if (!container.isConnected || plVista.modo !== 'pres') return;
  setGpsTolerance(state.condicionalTolerance);

  // Evaluación para todo el equipo: por defecto la más reciente de la temporada (o «cada uno la suya»).
  const fechaEv = e => `${e.fechaFin || e.fechaInicio || ''}|${String(e.createdAt?.seconds || 0).padStart(12, '0')}`;
  const evsTemp = (regEvaluaciones || []).filter(e => e.temporada === temporada).sort((a, b) => fechaEv(b).localeCompare(fechaEv(a)));
  if (plEvalSel !== 'auto' && !evsTemp.some(e => e.id === plEvalSel)) plEvalSel = evsTemp[0]?.id || 'auto';
  const selEval = container.querySelector('#pl-eval');
  if (selEval) {
    selEval.innerHTML = evsTemp.map(e => `<option value="${e.id}" ${e.id === plEvalSel ? 'selected' : ''}>${safeText(e.nombre)}${e.posicionKey ? ' · ' + safeText(state.positions.find(x => x.key === e.posicionKey)?.label || '') : ''}</option>`).join('')
      + `<option value="auto" ${plEvalSel === 'auto' ? 'selected' : ''}>Cada jugador, su más reciente</option>`;
    selEval.addEventListener('change', () => { plEvalSel = selEval.value; renderPlantillaPresentacion(container); });
  }

  // Agrupa por posición (en el orden de Configuración); sin posición al final.
  const preps = jugs.map(j => ({ j, prep: prepararFichaJugador(j, jugFichaRegs[j.id] || [], temporada, plEvalSel === 'auto' ? null : plEvalSel) }));
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
      ${(plMapaModo === 'rp' ? ['r', 'p'] : [plMapaModo]).map(m => plMapaNivel(t?.label || '', temporada, jugs.map(j => ({ j, f1: f1Map[j.id] })), m)).join('')}
      ${(() => { // sin nota: no salen en la diapositiva; aquí, fuera del PDF
        const sinNota = m => jugs.filter(j => notaNum(f1Map[j.id]?.player?.[m === 'p' ? 'pValue' : 'rValue']) == null);
        const bloques = (plMapaModo === 'rp' ? ['r', 'p'] : [plMapaModo]).map(m => ({ m, js: sinNota(m) })).filter(b => b.js.length);
        return bloques.length ? `<div class="card btn-print-ficha pl-pend mb-16" style="margin-top:4px;"><div class="card-body">${bloques.map(b => `
          <div class="text-sm mb-8"><b>Pendientes de evaluar (${b.m === 'p' ? 'Proyección' : 'Rendimiento'}) · ${b.js.length}</b> <span class="text-xs text-muted">— no salen en la diapositiva</span></div>
          <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">${b.js.map(j => `<span style="background:var(--bg-hover);border-radius:999px;padding:4px 12px;font-size:13px;font-weight:600;">${safeText(`${j.nombre || ''} ${j.apellidos || ''}`.trim())}</span>`).join('')}</div>`).join('')}
        </div></div>` : '';
      })()}`;
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
  // Agrupa por la posición del jugador (la de su ficha / plantilla); si no tiene, la de su evaluación.
  const posDe = x => (state.positions.some(pos => pos.key === x.j.positionKey) ? x.j.positionKey : x.prep.fPos);
  const grupos = state.positions.map(pos => ({ titulo: pos.label, items: preps.filter(x => posDe(x) === pos.key) }));
  grupos.push({ titulo: 'Sin posición', items: preps.filter(x => !posDe(x) || !state.positions.some(pos => pos.key === posDe(x))) });

  let hechas = 0;
  for (const g of grupos.filter(g => g.items.length)) {
    addHTML(plSeparadorPosicion(c, g.titulo, g.items.map(x => x.j), f1Map));
    lista.lastElementChild.dataset.plObs = `sep.${g.titulo}`;
    obsMontar();
    // (La diapositiva de resumen por posición ya no se genera: las notas van en la portada de la posición. plResumenPosicion queda sin usar.)
    await aplicarSinFondo(lista);
    ajustarSlides(lista);
    for (const { j, prep } of g.items) {
      const sec = document.createElement('div');
      sec.className = 'mb-16';
      sec.innerHTML = `
        <div class="flex gap-8 mb-8 btn-print-ficha" style="align-items:center;flex-wrap:wrap;">
          <b style="font-size:18px;">${safeText(nombreCompleto(j))}</b>
          <span class="text-xs text-muted">${safeText(prep.evSel ? `${prep.evSel.ev.temporada} · ${prep.evSel.ev.nombre}` : 'Sin evaluaciones')}</span>
          ${prep.fPos ? `<button class="btn btn-sm" data-pr-desc="${j.id}" title="La IA propone la descripción con sus notas y los comentarios de los evaluadores">✨ Proponer descripción</button>` : ''}
          <button class="btn btn-sm btn-primary" data-pr-textos="${j.id}">💾 Guardar textos</button>
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
      sec.querySelector('[data-pr-desc]')?.addEventListener('click', e => proponerDescripcion(e.currentTarget, sec.querySelector('[data-pr-f1] .p1-desc-text'), j, prep.evSel, prep.aspectosTxt, sec.querySelector('[data-pr-textos]')));
      const f1Pr = sec.querySelector('[data-pr-f1]'), f2Pr = sec.querySelector('[data-pr-f2]');
      sec.querySelector('[data-pr-textos]').addEventListener('click', e => guardarTextosFicha(j, prep.textosKey, f1Pr, f2Pr, { btn: e.currentTarget, aviso: true }));
      autoGuardarTextosFicha([f1Pr, f2Pr], () => guardarTextosFicha(j, prep.textosKey, f1Pr, f2Pr, { pendienteBtn: sec.querySelector('[data-pr-textos]') }), sec.querySelector('[data-pr-textos]'));
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
    const evsEq = [...new Map(preps.filter(x => x.prep.evSel?.ev).map(x => [x.prep.evSel.eid, x.prep.evSel.ev])).values()];
    const pieEq = evsEq.length === 1 ? pieEvaluacion(evsEq[0]) : (evsEq.length ? `Evaluaciones: ${evsEq.map(e => [e.temporada, e.nombre].filter(Boolean).join(' · ')).join(' / ')}` : '');
    lista.querySelectorAll('.pl-frame').forEach(f => { f.dataset.pie = pieEq; });
    const els = [...lista.querySelectorAll('.pl-slide, .p1-detalle, .ficha-detalle')].filter(el => !el.closest('.pl-pendiente')); // páginas "por definir": nunca en el PDF
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
  admin:      renderPanelAdmin,
};

// ── RENDERIZAR MAIN ───────────────────────────────

function renderMain() {
  const main = document.getElementById('rm-main');
  main.innerHTML = '';

  tabsVisibles().forEach(tab => {
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
  // Pulsar una pestaña de la barra lleva a su pantalla principal (no a la última ficha o presentación abierta).
  document.addEventListener('rm:tab-click', e => {
    if (e.detail === 'jugadores') { jugFichaId = null; jugadorFormId = null; jugVolverA = null; }
    if (e.detail === 'plantillas') plVista = { modo: 'grid', teamKey: null };
  });
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
  const avisoCierre = mensajeCierre();
  if (avisoCierre) { const e = overlay.querySelector('#login-error'); e.textContent = avisoCierre; e.style.display = 'block'; }
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

// Usuario autenticado pero sin ninguna pantalla asignada (o desactivado).
function showSinPermisos(email) {
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
  const overlay = ensureLoginOverlay();
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:linear-gradient(160deg, var(--blue-600), var(--blue-400));font-family:var(--font-sans);padding:16px;';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:40px 36px;width:100%;max-width:380px;text-align:center;">
      <img src="${LOGO_PATH}" alt="" style="width:80px;height:80px;object-fit:contain;margin:0 auto 16px;display:block;" />
      <div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">Sin permisos</div>
      <p class="text-sm text-muted mb-16">${safeText(email || '')} aún no tiene pantallas asignadas. Pide acceso al administrador.</p>
      <button class="btn btn-primary" id="sinperm-salir" style="width:100%;">Salir</button>
    </div>
  `;
  overlay.querySelector('#sinperm-salir').addEventListener('click', () => logout().catch(err => console.error('[Auth] No se pudo cerrar sesión:', err)));
}

function hideLogin() {
  const overlay = document.getElementById('rm-login-overlay');
  if (overlay) overlay.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.style.display = '';
}

// ── RECORDAR DÓNDE ESTABAS AL RECARGAR ───────────
// Además de la pestaña (hash), se recuerda la ficha de jugador abierta y la vista de Plantillas.
const NAV_LS = 'rm-nav';
(function navRestaurar() {
  try {
    const n = JSON.parse(localStorage.getItem(NAV_LS) || 'null');
    if (!n || typeof n !== 'object') return;
    if (typeof n.jugFichaId === 'string' && n.jugFichaId) {
      jugFichaId = n.jugFichaId;
      jugFichaTab = n.jugFichaTab === 'fichas' ? 'fichas' : 'datos';
      jugFichaEvalId = typeof n.jugFichaEvalId === 'string' ? n.jugFichaEvalId : null;
      jugVolverA = ['plantillas', 'registro'].includes(n.jugVolverA) ? n.jugVolverA : null;
    }
    if (typeof n.plantillaTemporada === 'string' && n.plantillaTemporada) plantillaTemporada = n.plantillaTemporada;
    if (n.plVista && ['grid', 'datos', 'pres'].includes(n.plVista.modo)) plVista = { modo: n.plVista.modo, teamKey: n.plVista.teamKey || null };
  } catch (_) { /* ignorar */ }
})();
function navGuardar() {
  try {
    localStorage.setItem(NAV_LS, JSON.stringify({ jugFichaId, jugFichaTab, jugFichaEvalId, jugVolverA, plantillaTemporada, plVista }));
  } catch (_) { /* ignorar */ }
}
window.addEventListener('pagehide', navGuardar);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') navGuardar(); });

let _appBooted = false;
let _booting = false; // evita arrancar dos veces si Firebase avisa de nuevo mientras se piden doble factor/privacidad

async function boot() {
  initFirebase();
  watchAuthState(async user => {
    if (!user) {
      if (_appBooted) { location.reload(); return; } // al salir se descarta lo pintado con los permisos del usuario anterior
      showLogin(); return;
    }
    if (_appBooted) { hideLogin(); return; } // ya está montado — no se repite en cada evento de auth
    if (_booting) return;
    _booting = true;
    try {
      const conFirebase = !isFirebaseUnconfigured();
      if (conFirebase) {
        iniciarAuditoria(user);
        if (!(await exigirDobleFactor(user))) return; // se queda en la pantalla de alta del autenticador
      }
      await cargarPerfil(user);
      const visibles = tabsVisibles();
      if (!visibles.length) { showSinPermisos(user.email); return; }
      if (conFirebase) await exigirPrivacidad(user);
      if (conFirebase && !esSuperadmin() && !(await exigirAcceso(perfilActual()))) return; // horario / red del club
      await arrancarApp(user, visibles);
    } finally { _booting = false; }
  });
}

async function arrancarApp(user, visibles) {
  hideLogin();
  _appBooted = true;
  if (!isFirebaseUnconfigured()) {
    auditar('entrada');
    iniciarInactividad();
    setAfterWrite((op, ruta) => auditar(op, ruta)); // cada guardado/borrado queda registrado
  }
  const hash = window.location.hash.replace('#', '');
  if (hash === 'admin' && esSuperadmin()) setState({ activeTab: 'admin' });
  else if (!puedeVer(state.activeTab)) setState({ activeTab: visibles[0].key });
  // "Ver" = solo lectura: se bloquea cualquier guardado hecho desde esa pantalla (las reglas de Firestore lo impiden también).
  setWriteGuard(() => {
    if (!puedeEditar(pantallaActual())) throw Object.assign(new Error('Solo lectura: no tienes permiso para guardar en esta pantalla.'), { code: 'permission-denied' });
  });

  await loadConfigFromFirestore(); // trae Configuración guardada antes de pintar
  await loadPlayersFromFirestore(); // trae la lista de jugadores

  renderFooter();
  renderHeader();
  renderTabs();
  renderMain();
  setupEvents();
  actualizarSoloLectura();
  // Cada clic puede cambiar de subpantalla: se recalcula el aviso después de que actúe el botón.
  document.addEventListener('click', () => setTimeout(() => { actualizarSoloLectura(); registrarVista(); }, 0), true);
  document.addEventListener('rm:tab-changed', () => setTimeout(() => { actualizarSoloLectura(); registrarVista(); }, 0));
  registrarVista();
}

// Registro de actividad: qué pantalla (y qué jugador) se abre.
let ultimaVista = '';
function registrarVista() {
  let v = pantallaActual();
  if (state.activeTab === 'jugadores' && jugFichaId) {
    const j = state.players.find(x => x.id === jugFichaId);
    v += ` · ${j ? nombreCompleto(j) : jugFichaId}`;
  }
  if (v === ultimaVista) return;
  ultimaVista = v;
  auditar('ver', v);
}

document.addEventListener('DOMContentLoaded', boot);
