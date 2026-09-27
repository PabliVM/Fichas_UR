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
    <div class="header-actions" style="display:flex;align-items:center;gap:8px;">
      <select class="select" id="sel-season">
        ${state.seasons.map(s => `<option value="${s}" ${s === state.season ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button class="btn-theme" id="btn-theme" title="Cambiar modo">
        ${state.darkMode ? '☀️' : '🌙'}
      </button>
    </div>
  `;

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  document.getElementById('sel-season').addEventListener('change', e => {
    setState({ season: e.target.value });
    document.dispatchEvent(new CustomEvent('rm:season-changed', { detail: e.target.value }));
  });

}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  setState({ darkMode: isDark });

  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}
