// ================================================
// RENDER-HEADER.JS — Header corporativo RM Perfiles
// ================================================

import { state, setState }   from './state.js';
import { LOGO_PATH } from './constants.js';
import { safeText }          from './utils.js';

export function renderHeader() {
  const header = document.getElementById('rm-header');
  if (!header) return;

  header.innerHTML = `
    <div class="header-logo">
      <img src="${LOGO_PATH}" alt="RM" />
    </div>
    <div style="display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;overflow:hidden;">
      <span class="header-app-name">${safeText(state.appName)}</span>
      <span class="header-app-subtitle">Real Madrid · Cantera</span>
    </div>
  `;
  // Temporada + modo oscuro: movidos a la fila de pestañas (#rm-tabs),
  // ver render-tabs.js — menos información apretada en el header.
}
