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
  // { id, name, positions: [posKey, posKey2?], teamsBySeason: { [season]: teamKey } }
  players:         [],
  // { id, playerId, season, createdAt } — informe = 1 registro de las 2 fichas para ese jugador/temporada
  informes:        [],
  // MENTAL/TÉCNICO/CONDICIONAL: comunes a TODAS las posiciones. Editable en
  // Configuración → Items a evaluar → Ficha 2, sin selector de posición.
  aspectosComunes: {
    mental: ['Autoconfianza', 'Act. y Preparación mental', 'Control del estrés', 'Concentración', 'Motivación', 'Comunicación', 'Capacidad de adaptación', 'Autonomía', 'Determinación'],
    tecnico: ['Pase', 'Control', 'Conducción', 'Manejo pie no dominante', 'Perfiles', 'Cambios de orientación', 'Velocidad de juego', 'Capacidad de anticipación', 'Disputas aéreas', 'Duelos defensivos 1vs1', 'Contundencia defensiva', 'Despejes'],
    condicional: ['V.MAX.', 'D.Sprint.', 'D.A Int.', 'N°Sprint.', 'Ac.Max.', 'N° Ac Max.', 'D.Total.', 'M/min.', 'CMJ', 'Índice Lesional.', 'Perfil Físico.', 'Edad Madurativa.'],
  },
  // Táctico varía por posición. Ofensivas/Defensivas (ficha 1) son un
  // SUBCONJUNTO seleccionado del Táctico de esa posición — no texto libre.
  // Semilla portero: los 12 originales de Táctico + los 5+7 que antes vivían
  // como texto libre en Ofensivas/Defensivas (migrados tal cual, sin fusionar
  // con los ya existentes por tener redacción distinta — ⚠ revisar duplicados).
  criteriaSchemas: {
    portero: {
      tactico: [
        'Circulación / Timing', 'Progresión en conducción', 'Pase ULDF.', '1vs1 en banda', 'Progresión juego interior', 'Juego asociativo en banda', 'Cap. asociativa bajo presión', 'Pase ULDF', 'Defensa espalda', 'Continuidad en el juego', 'Defensa Juego directo.', 'Defensa de área llegando.',
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
  // Tolerancia (±) para el guion amarillo del bloque CONDICIONAL (Ficha 2):
  // si |valor - refA| <= esto, sale guion; si no, check verde o X roja.
  // Editable en Configuración → Datos condicionales.
  condicionalTolerance: 0.2,
};

export const state = _state;

// ── PERSISTENCIA EN FIRESTORE ─────────────────────
// Un único documento (config/general) con todo lo editable en Configuración.
// jugadores/informes NO van aquí (tendrán su propia colección más adelante).
const CONFIG_COLLECTION = 'config';
const CONFIG_DOC_ID = 'general';
const CONFIG_KEYS = ['positions', 'criteriaSchemas', 'aspectosComunes', 'scoreBands', 'fichaColors', 'fichaColorsDefault', 'seasons', 'condicionalRefs', 'condicionalTolerance'];

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
