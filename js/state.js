// ================================================
// STATE.JS — Estado de UI en memoria
// Solo vive mientras la página está abierta.
// NO se guarda en localStorage ni en ningún otro
// almacenamiento local.
// ================================================

import { APP_NAME, DEFAULT_SEASON, TEAMS, SCORE_THRESHOLDS } from './constants.js';

const _state = {
  appName:         APP_NAME,
  season:          DEFAULT_SEASON,
  activeTeam:      TEAMS[0].key,
  activeTab:       'inicio',
  darkMode:        false,
  scoreThresholds: { ...SCORE_THRESHOLDS }, // editable desde Configuración
};

export const state = _state;

export function setState(patch) {
  Object.assign(_state, patch);
}
