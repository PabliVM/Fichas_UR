// ================================================
// STATE.JS — Estado de UI en memoria
// Solo vive mientras la página está abierta.
// NO se guarda en localStorage ni en ningún otro
// almacenamiento local.
// ================================================

import { APP_NAME, DEFAULT_SEASON, TEAMS, TABS, PROFILES, SEASONS } from './constants.js';
import { saveDocument, readDocument, readCollection } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { showError } from './utils.js';

function initialTab() {
  const hash = window.location.hash.replace('#', '');
  return TABS.some(t => t.key === hash) ? hash : TABS[0].key;
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
  // Banco de frases modelo para "Descripción del jugador" — editable en
  // Configuración → Ayuda → Frases modelo. El técnico las marca en la
  // ficha (checklist) y se juntan en el texto editable de Descripción.
  // Sin IA ni cálculo automático — eso depende de las medias (pendiente).
  frasesModelo: [],
  // Texto libre editable en Configuración → Ayuda → Flujo de evaluaciones.
  // Documentación interna (no aparece en las fichas de los jugadores).
  flujoEvaluaciones: `FLUJO DE EVALUACIONES (estado actual)

1. Configuración define, por posición: Aspectos comunes (Mental/Técnico/
   Condicional, iguales para todas), Táctico (varía por posición),
   Competencias ofensivas/defensivas (subconjunto de Táctico), Perfiles
   (3 por posición, cada uno con su subconjunto de Táctico para la media),
   rango de colores y datos condicionales de referencia.

2. Con eso se generan las plantillas (Ficha 1 y Ficha 2) por posición —
   lo que se ve hoy en Configuración → Fichas tipo → Individual, con
   datos de ejemplo.

3. PENDIENTE (no implementado todavía):
   - Encuesta/formulario real para evaluar a un jugador concreto.
   - Guardar esas notas en Firestore (colección jugadores).
   - Calcular las medias: por bloque (Mental/Técnico/Condicional/Táctico,
     para el círculo y el radar de Ficha 2) y por perfil (Ficha 1, usando
     las competencias marcadas en Configuración → Perfiles).
   - Autenticación (Firebase Auth).

Recorrido del dato cuando esté completo:
Configuración → Encuesta del jugador → Notas guardadas → Medias → Ficha 1/2 real
`,
};

export const state = _state;

// ── PERSISTENCIA EN FIRESTORE ─────────────────────
// Un único documento (config/general) con todo lo editable en Configuración.
// jugadores NO va aquí — colección propia 'jugadores' (ver loadPlayersFromFirestore).
const CONFIG_COLLECTION = 'config';
const CONFIG_DOC_ID = 'general';
const CONFIG_KEYS = ['positions', 'criteriaSchemas', 'aspectosComunes', 'scoreBands', 'fichaColors', 'fichaColorsDefault', 'seasons', 'condicionalRefs', 'fichaEspejoReglas', 'columnasEncuesta', 'condicionalTolerance', 'fichaGridOrder', 'flujoEvaluaciones', 'frasesModelo'];

let _persistTimer = null;
function schedulePersist() {
  if (isFirebaseUnconfigured()) return; // sin credenciales: se queda solo en memoria, como hasta ahora
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    const snapshot = {};
    CONFIG_KEYS.forEach(k => { snapshot[k] = _state[k]; });
    saveDocument(CONFIG_COLLECTION, CONFIG_DOC_ID, snapshot).catch(err => {
      console.error('[Firestore] No se pudo guardar la configuración:', err);
      showError('No se ha guardado en la nube (revisa las reglas de Firestore o la conexión).', 6000);
    });
  }, 400); // agrupa cambios rápidos seguidos (ej. arrastrar un color) en un solo guardado
}

/**
 * Carga config/general de Firestore ANTES del primer render (llamar en boot()).
 * Si el documento no existe todavía (primera vez), se queda con la semilla local.
 */
export async function loadConfigFromFirestore() {
  if (isFirebaseUnconfigured()) return;
  try {
    const doc = await readDocument(CONFIG_COLLECTION, CONFIG_DOC_ID);
    if (!doc) return;
    const patch = {};
    CONFIG_KEYS.forEach(k => { if (doc[k] !== undefined) patch[k] = doc[k]; });
    Object.assign(_state, patch);
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
  if (Object.keys(patch).some(k => CONFIG_KEYS.includes(k))) schedulePersist();
}
