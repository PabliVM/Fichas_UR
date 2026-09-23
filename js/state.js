// ================================================
// STATE.JS — Estado de UI en memoria
// Solo vive mientras la página está abierta.
// NO se guarda en localStorage ni en ningún otro
// almacenamiento local.
// ================================================

import { APP_NAME, DEFAULT_SEASON, TEAMS, TABS, PROFILES, SEASONS } from './constants.js';

function initialTab() {
  const hash = window.location.hash.replace('#', '');
  return TABS.some(t => t.key === hash) ? hash : 'inicio';
}

const _state = {
  appName:         APP_NAME,
  season:          DEFAULT_SEASON,
  activeTeam:      TEAMS[0].key,
  activeTab:       initialTab(),
  darkMode:        false,
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
  // Items a evaluar por posición y bloque (los 4 de la ficha 2 + los 3 de la ficha 1).
  // Semilla: los que ya conocíamos del perfil de portero (de los PDF de formularios).
  criteriaSchemas: {
    portero: {
      mental: ['Autoconfianza', 'Act. y Preparación mental', 'Control del estrés', 'Concentración', 'Motivación', 'Comunicación', 'Capacidad de adaptación', 'Autonomía', 'Determinación'],
      tecnico: ['Pase', 'Control', 'Conducción', 'Manejo pie no dominante', 'Perfiles', 'Cambios de orientación', 'Velocidad de juego', 'Capacidad de anticipación', 'Disputas aéreas', 'Duelos defensivos 1vs1', 'Contundencia defensiva', 'Despejes'],
      tactico: ['Circulación / Timing', 'Progresión en conducción', 'Pase ULDF.', '1vs1 en banda', 'Progresión juego interior', 'Juego asociativo en banda', 'Cap. asociativa bajo presión', 'Pase ULDF', 'Defensa espalda', 'Continuidad en el juego', 'Defensa Juego directo.', 'Defensa de área llegando.'],
      condicional: ['V.MAX.', 'D.Sprint.', 'D.A Int.', 'N°Sprint.', 'Ac.Max.', 'N° Ac Max.', 'D.Total.', 'M/min.', 'CMJ', 'Índice Lesional.', 'Perfil Físico.', 'Edad Madurativa.'],
      personalidad: ['Autoconfianza', 'Act. y Prep. mental', 'Control del estrés', 'Concentración', 'Motivación', 'Comunicación', 'Cap. adaptación', 'Autonomía', 'Determinación'],
      competenciasOfensivas: ['Continuidad en circulación', 'Pase largo para progresar', 'Progresión con pase desde juego interior', 'Capacidad asociativa bajo presión', 'Capacidad para iniciar acciones ofensivas'],
      competenciasDefensivas: ['Dominio del juego aéreo', 'Defensa espalda ULDF acciones divididas', 'Defensa juego directo', 'Acciones bajo palos', 'Comunicación línea defensiva llegada a área', 'Gestión línea defensiva organizando marcas y equilibrio', 'Dominio interpretar y actuar ABP'],
    },
  },
};

export const state = _state;

export function setState(patch) {
  Object.assign(_state, patch);
}
