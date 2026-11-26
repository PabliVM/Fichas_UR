// ================================================
// STATE.JS — Estado de UI en memoria
// Solo vive mientras la página está abierta.
// NO se guarda en localStorage ni en ningún otro
// almacenamiento local.
// ================================================

import { APP_NAME, DEFAULT_SEASON, TEAMS, TABS, PROFILES, SEASONS, SEASONS_RETIRADAS } from './constants.js';
import { saveDocument, updateDocument, readDocument, readCollection } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { showError } from './utils.js';

// Texto por defecto de Configuración › Cómo funciona (botón "Cargar texto actualizado").
export const FLUJO_ACTUAL = `CÓMO FUNCIONA RM PERFILES (noviembre 2026)

1. JUGADORES
   - Alta uno a uno (+ Añadir › Un jugador) o en bloque (+ Añadir › Varios /
     actualizar datos): un solo Excel con datos personales, años en el club y
     datos condicionales de una evaluación. Celda vacía = no se toca; dato
     distinto = se actualiza. También desde una foto o texto pegado (IA).
   - Residencia: Madrid (por defecto), Residencia o Media pensión.
   - Años en el club: número o por etapas (2+3); cada temporada suma uno sola.
   - Configuración › Datos pendientes: jugadores a los que les falta algún dato,
     editables desde ahí mismo.

2. EQUIPOS
   - Plantilla por temporada. Arrastrar un jugador a otra posición u otro
     equipo → Mover o Duplicar. "Datos" edita los datos de todo el equipo.
   - "Presentación de fichas": portadas, mapa de nivel (izq. Madrid, dcha.
     Residencia y Media pensión), campograma y Ficha 1 + 2 de cada jugador,
     agrupadas por posición. ⚙ Opciones: comparar medias (equipo, posición o
     misma generación y posición de todos los equipos), notas M sí/no,
     observaciones, notas en portadas. PDF del equipo.

3. EVALUACIONES
   - Una evaluación es un periodo (p. ej. Noviembre 2026) para TODAS las
     posiciones.
   - Importar encuesta: se elige la pestaña del Excel; la posición sale del
     nombre de la pestaña (o se elige). Las columnas se colocan según
     Configuración › Columnas de la encuesta de esa posición (la referencia).
     Aviso si alguna columna no cuadra con su pregunta.
   - Encuestas ya importadas con notas distintas: se elige Mantener o Reemplazar.
   - Ver registros: tabla por posición, filtros por jugador, equipo y posición.
     Editar una nota o borrar un registro desde la tabla.
   - Jugador evaluado en varias posiciones: aviso; en su ficha (o en la
     presentación) "Ficha como": una posición, otra o las dos (ficha duplicada).

4. FICHAS
   - Medias: por competencia (media de los evaluadores), por bloque (Mental,
     Técnico, Táctico) y por perfil.
   - Ficha 1: descripción (✨ la IA propone una), competencias ofensivas y
     defensivas, aspectos a potenciar/mejorar, campograma con hasta 3
     camisetas (se guardan). Textos editables: se guardan por evaluación y se
     ven igual en la ficha y en la presentación.
   - Ficha 2: notas por bloque, columna M (metodología): se escribe a mano o
     se pulsa la M para rellenar los huecos con la media. Si hay notas M, los
     círculos se pintan con ellas; si no, con las de la encuesta.
     Condicional: columnas 1 y 2 = datos del jugador (media y máxima);
     3 y 4 = referencias de Configuración › Datos condicionales.

5. CONFIGURACIÓN
   - Encuesta y criterios: posiciones, aspectos por posición (✎ renombrar,
     ↑↓ ordenar), columnas de la encuesta (↑↓), datos condicionales,
     evaluadores (nombre, rol, 2 equipos, unificar), frases modelo.
   - Fichas: ficha tipo, colores, rango de colores, matriz.
   - Datos y ayuda: datos pendientes, copia de seguridad, este texto.

6. SUPER ADMIN
   - Usuarios y permisos (Oculta / Ver / Editar por pantalla), acceso solo
     desde la red del club y horario, registro de actividad, conservación
     de datos.

Recorrido del dato:
Configuración → Excel de la encuesta → Registros → Medias (+ notas M) →
Ficha 1 y 2 → Presentación del equipo / PDF
`;

function initialTab() {
  const hash = window.location.hash.replace('#', '');
  if (TABS.some(t => t.key === hash)) return hash;
  // Sin hash (p. ej. recarga desde otra URL): última pestaña usada.
  try { const ult = localStorage.getItem('rm-tab'); if (TABS.some(t => t.key === ult)) return ult; } catch (_) { /* ignorar */ }
  return TABS[0].key;
}

// Colores de la ficha (fondo, cabeceras) — editable en Configuración,
// con botón para volver a estos valores por defecto.
export const DEFAULT_FICHA_COLORS = {
  slate: '#24313d', // fondo general de la ficha
  wine:  '#7b3a52', // cabeceras granate (MENTAL/TÉCNICO/... y PLAN DE ACCIÓN)
  textGeneral:        '#ffffff', // texto general (listas, descripción...)
  textHeader:         '#ffffff', // texto de las cabeceras granate y el header azul
  textAspectos:       '#ffffff', // texto del header "ASPECTOS DEL JUGADOR"
  textSubheaderWhite: '#0f1117', // texto de las cabeceras blancas (TÉCNICO/TÁCTICO/... del plan)
};

const _state = {
  appName:         APP_NAME,
  season:          DEFAULT_SEASON,
  activeTeam:      TEAMS[0].key,
  activeTab:       initialTab(),
  darkMode:        false,
  fichaColors:     { ...DEFAULT_FICHA_COLORS }, // colores ACTIVOS ahora mismo (los que se ven en la ficha)
  // Colores "por defecto" que usa el botón Restaurar — el usuario los fija
  // pulsando "Guardar como predeterminado" (copia fichaColors aquí). Si
  // nunca lo ha pulsado, queda null y Restaurar cae en DEFAULT_FICHA_COLORS
  // (los de fábrica del código).
  fichaColorsDefault: null,
  // Orden de los 4 bloques en la matriz 2x2 de la Ficha 2 — editable en
  // Configuración → Matriz. Claves = posición fija en pantalla (tl=arriba
  // izq, tr=arriba der, bl=abajo izq, br=abajo der); valores = qué bloque
  // va ahí. Semilla = el orden de siempre (mental/tecnico arriba,
  // condicional/tactico abajo). Tamaños y contenido no cambian, solo el
  // hueco donde cae cada bloque.
  fichaGridOrder: { tl: 'mental', tr: 'tecnico', bl: 'condicional', br: 'tactico' },
  // Bandas de color para las medias — editable en Configuración: cuántas
  // haya (2, 3, 4...) y qué color/umbral tiene cada una. Semilla: 3 bandas
  // (verde/amarillo/rojo), igual que el criterio que ya usábamos.
  scoreBands: [
    { color: '#22c55e', min: 4 }, // verde:   media >= 4
    { color: '#eab308', min: 3 }, // amarillo: 3 <= media < 4
    { color: '#ef4444', min: 0 }, // rojo:    media < 3
  ],
  positions:       PROFILES.map(p => ({ ...p })), // editable desde Configuración — semilla: PROFILES
  seasons:         [...SEASONS], // editable desde Configuración — semilla: SEASONS
  // { id, nombre, apellidos, birthDate, foot, maturationalAge, fotoUrl,
  //   teamKey, positionKey, weight, height, complexion } — los últimos 5
  // son "espejo" del último valor; el histórico real vive en la
  // subcolección Firestore jugadores/{id}/historico (ver firebase-service.js).
  players:         [],
  // MENTAL/TÉCNICO/CONDICIONAL: comunes a TODAS las posiciones. Editable en
  // Configuración → Items a evaluar → Ficha 2, sin selector de posición.
  aspectosComunes: {
    mental: ['Autoconfianza', 'Act. y Preparación mental', 'Control del estrés', 'Concentración', 'Motivación', 'Comunicación', 'Capacidad de adaptación', 'Autonomía', 'Determinación'],
    tecnico: ['Pase', 'Control', 'Conducción', 'Manejo pie no dominante', 'Perfiles', 'Cambios de orientación', 'Velocidad de juego', 'Capacidad de anticipación', 'Disputas aéreas', 'Duelos defensivos 1vs1', 'Contundencia defensiva', 'Despejes'],
    condicional: ['V.MAX.', 'D.Sprint.', 'D.A Int.', 'N°Sprint.', 'Ac.Max.', 'N° Ac Max.', 'D.Total.', 'M/min.', 'CMJ', 'Índice Lesional.', 'Perfil Físico.', 'Edad Madurativa.'],
  },
  // Táctico varía por posición. Ofensivas/Defensivas (ficha 1) son un
  // SUBCONJUNTO seleccionado del Táctico de esa posición — no texto libre.
  // Semilla portero: 12 tácticas = 5 ofensivas + 7 defensivas (los 12 antiguos
  // duplicados se descartaron, aprobado por Pablo).
  criteriaSchemas: {
    portero: {
      tactico: [
        'Continuidad en circulación', 'Pase largo para progresar', 'Progresión con pase desde juego interior', 'Capacidad asociativa bajo presión', 'Capacidad para iniciar acciones ofensivas',
        'Dominio del juego aéreo', 'Defensa espalda ULDF acciones divididas', 'Defensa juego directo', 'Acciones bajo palos', 'Comunicación línea defensiva llegada a área', 'Gestión línea defensiva organizando marcas y equilibrio', 'Dominio interpretar y actuar ABP',
      ],
      competenciasOfensivas: ['Continuidad en circulación', 'Pase largo para progresar', 'Progresión con pase desde juego interior', 'Capacidad asociativa bajo presión', 'Capacidad para iniciar acciones ofensivas'],
      competenciasDefensivas: ['Dominio del juego aéreo', 'Defensa espalda ULDF acciones divididas', 'Defensa juego directo', 'Acciones bajo palos', 'Comunicación línea defensiva llegada a área', 'Gestión línea defensiva organizando marcas y equilibrio', 'Dominio interpretar y actuar ABP'],
    },
  },
  // Valores FIJOS de referencia por posición para el bloque CONDICIONAL de
  // la Ficha 2 (columnas 3/4). Se rellenan en Configuración → Datos
  // condicionales. Sin semilla — no hay datos reales todavía.
  // Forma: { [posKey]: { [itemCondicional]: { col3: number|null, col4: number|null } } }
  condicionalRefs: {},
  // Reglas de Fichas Espejo (Configuración → Fichas Espejo): de dónde sale
  // y cómo se calcula cada número de la ficha. NO conectado aún a las fichas
  // reales. Forma: { [posKey]: { 1|2: { [num]: { origen, campoId, operacion,
  // vacios, decimales, labelAlGuardar } } } }
  fichaEspejoReglas: {},
  // Columnas 1-51 de la encuesta (Configuración → Columnas encuesta): solo los CAMBIOS sobre
  // la plantilla. Forma: { [posKey]: { [n]: { nombre?, destino? } } } (ver importar-plantilla.js).
  columnasEncuesta: {},
  // Tolerancia (±) para el guion amarillo del bloque CONDICIONAL (Ficha 2):
  // si |valor - refA| <= esto, sale guion; si no, check verde o X roja.
  // Editable en Configuración → Datos condicionales.
  condicionalTolerance: 0.2,
  // Nombre largo de cada ítem condicional (como viene en el Excel del preparador). Sale entre paréntesis en las tablas
  // de la app y sirve para reconocer sus columnas al importar ("Dist >21 (m) - Media" / "- Máx"). Editable en Datos condicionales.
  // Ítems condicionales con un solo valor (sin máxima).
  condicionalSinMax: ['V.MAX.'],
  condicionalDesc: {
    'V.MAX.': 'Vmax Referencia (km/h)', 'D.Total.': 'Dist Total (m)', 'D.A Int.': 'Dist >21 (m)', 'D.Sprint.': 'Dist >24 (m)',
    'Ac.Max.': 'Acc Máx (m/s2)', 'N°Sprint.': 'Nº Acciones >24', 'N° Ac Max.': 'Acc >3', 'M/min.': 'm/min',
  },
  // Banco de frases modelo para "Descripción del jugador" — editable en
  // Configuración → Ayuda → Frases modelo. El técnico las marca en la
  // ficha (checklist) y se juntan en el texto editable de Descripción.
  // Sin IA ni cálculo automático — eso depende de las medias (pendiente).
  frasesModelo: [],
  // Evaluadores de las encuestas: { claveNormalizada: { nombre, rol, teamKey, alias } } — Configuración › Evaluadores.
  evaluadores: {},
  // Texto libre editable en Configuración → Ayuda → Flujo de evaluaciones.
  // Documentación interna (no aparece en las fichas de los jugadores).
  flujoEvaluaciones: FLUJO_ACTUAL,
};


export const state = _state;

// ── PERSISTENCIA EN FIRESTORE ─────────────────────
// Un único documento (config/general) con todo lo editable en Configuración.
// jugadores NO va aquí — colección propia 'jugadores' (ver loadPlayersFromFirestore).
const CONFIG_COLLECTION = 'config';
const CONFIG_DOC_ID = 'general';
const CONFIG_KEYS = ['positions', 'criteriaSchemas', 'aspectosComunes', 'scoreBands', 'fichaColors', 'fichaColorsDefault', 'seasons', 'condicionalRefs', 'fichaEspejoReglas', 'columnasEncuesta', 'condicionalTolerance', 'fichaGridOrder', 'flujoEvaluaciones', 'frasesModelo', 'evaluadores', 'condicionalDesc', 'condicionalSinMax'];

let _persistTimer = null;
// Solo se guarda la configuración si la carga inicial terminó bien: si falló, el estado en memoria son los valores
// por defecto y guardarlos machacaría la configuración real de Firestore.
let _configCargada = false;
let _avisoNoCargada = false;
function schedulePersist() {
  if (isFirebaseUnconfigured()) return; // sin credenciales: se queda solo en memoria, como hasta ahora
  if (!_configCargada) {
    if (!_avisoNoCargada) { _avisoNoCargada = true; showError('La configuración guardada no se cargó: los cambios NO se guardan. Recarga la página (Ctrl+Shift+R).', 9000); }
    return;
  }
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(persistNow, 400); // agrupa cambios rápidos seguidos (ej. arrastrar un color) en un solo guardado
}

// Solo se escriben las claves que han cambiado: así no se pisan los cambios que otra persona haya hecho en otras claves.
const _clavesPendientes = new Set();
function persistNow() {
  clearTimeout(_persistTimer);
  _persistTimer = null;
  if (!_clavesPendientes.size) return;
  const patch = {};
  _clavesPendientes.forEach(k => { patch[k] = _state[k]; });
  _clavesPendientes.clear();
  updateDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, patch).catch(err => {
    if (err?.code !== 'not-found') throw err;
    // Primera vez (el documento aún no existe): se crea con toda la configuración.
    const snapshot = {};
    CONFIG_KEYS.forEach(k => { snapshot[k] = _state[k]; });
    return saveDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, snapshot);
  }).catch(err => {
    console.error('[Firestore] No se pudo guardar la configuración:', err);
    Object.keys(patch).forEach(k => _clavesPendientes.add(k)); // se reintenta en el próximo guardado
    showError('No se ha guardado en la nube (revisa las reglas de Firestore o la conexión).', 6000);
  });
}
// Al ocultar/cerrar la pestaña se guarda ya lo pendiente (no se espera a los 400 ms).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && _persistTimer) persistNow(); });

/**
 * Carga config/general de Firestore ANTES del primer render (llamar en boot()).
 * Si el documento no existe todavía (primera vez), se queda con la semilla local.
 */
export async function loadConfigFromFirestore() {
  if (isFirebaseUnconfigured()) return;
  try {
    const doc = await readDocument(CONFIG_COLLECTION, CONFIG_DOC_ID);
    _configCargada = true; // lectura correcta (aunque el documento aún no exista: primera vez)
    if (!doc) return;
    const patch = {};
    CONFIG_KEYS.forEach(k => { if (doc[k] !== undefined) patch[k] = doc[k]; });
    if (Array.isArray(patch.seasons)) {
      const limpias = patch.seasons.filter(t => !SEASONS_RETIRADAS.includes(t));
      patch.seasons = limpias.length ? limpias : [...SEASONS];
    }
    Object.assign(_state, patch);
    if (!_state.seasons.includes(_state.season)) _state.season = _state.seasons[0];
  } catch (err) {
    console.error('[Firestore] No se pudo cargar la configuración:', err);
    showError('No se pudo cargar la configuración guardada (revisa las reglas de Firestore o la conexión).', 6000);
  }
}

/**
 * Carga la colección 'jugadores' completa de Firestore ANTES del primer
 * render (llamar en boot(), junto a loadConfigFromFirestore). Colección
 * aparte del doc config/general — cada jugador es su propio documento.
 */
export async function loadPlayersFromFirestore() {
  if (isFirebaseUnconfigured()) return;
  try {
    const players = await readCollection('jugadores');
    Object.assign(_state, { players });
  } catch (err) {
    console.error('[Firestore] No se pudieron cargar los jugadores:', err);
    showError('No se pudieron cargar los jugadores (revisa las reglas de Firestore o la conexión).', 6000);
  }
}

export function setState(patch) {
  Object.assign(_state, patch);
  const claves = Object.keys(patch).filter(k => CONFIG_KEYS.includes(k));
  if (!claves.length) return;
  if (_configCargada) claves.forEach(k => _clavesPendientes.add(k));
  schedulePersist();
}
