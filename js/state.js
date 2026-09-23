// ================================================
// STATE.JS — Estado de UI en memoria
// Solo vive mientras la página está abierta.
// NO se guarda en localStorage ni en ningún otro
// almacenamiento local.
// ================================================

import { APP_NAME, DEFAULT_SEASON, TEAMS, SCORE_THRESHOLDS, TABS, PROFILES, SEASONS } from './constants.js';

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
  scoreThresholds: { ...SCORE_THRESHOLDS }, // editable desde Configuración
  positions:       PROFILES.map(p => ({ ...p })), // editable desde Configuración — semilla: PROFILES
  seasons:         [...SEASONS], // editable desde Configuración — semilla: SEASONS
  // { id, name, positions: [posKey, posKey2?], teamsBySeason: { [season]: teamKey } }
  players:         [],
  // { id, playerId, season, createdAt } — informe = 1 registro de las 2 fichas para ese jugador/temporada
  informes:        [],
};

export const state = _state;

export function setState(patch) {
  Object.assign(_state, patch);
}
