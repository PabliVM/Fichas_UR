// ================================================
// RENDER-TABS.JS — Pestañas genéricas
// ================================================

import { state, setState } from './state.js';
import { tabsVisibles, puedeVer } from './permisos-service.js';
import { TABS } from './constants.js';

// Pestaña de la barra que se marca (una pestaña fuera de la barra marca la suya: Líneas de sucesión → Equipos).
const tabDeBarra = key => TABS.find(t => t.key === key)?.dentroDe || key;

export function renderTabs() {
  const nav = document.getElementById('rm-tabs');
  if (!nav) return;

  nav.innerHTML = tabsVisibles().filter(tab => tab.enBarra !== false).map(tab => `
    <button
      class="tab-btn ${tabDeBarra(state.activeTab) === tab.key ? 'active' : ''}"
      data-tab="${tab.key}">
      ${tab.label}
    </button>
  `).join('');

  nav.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.tab;
      document.dispatchEvent(new CustomEvent('rm:tab-click', { detail: key })); // vuelve a la pantalla principal de la pestaña
      if (state.activeTab === key) document.dispatchEvent(new CustomEvent('rm:tab-changed', { detail: key }));
      else switchTab(key);
    });
  });
}

export function switchTab(tabKey) {
  if (state.activeTab === tabKey) return;
  if (!puedeVer(tabKey)) return; // pestaña sin permiso (p. ej. enlace desde otra)
  setState({ activeTab: tabKey });
  history.replaceState(null, '', '#' + tabKey);
  try { localStorage.setItem('rm-tab', tabKey); } catch (_) { /* ignorar */ }

  // Actualizar botones
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabDeBarra(tabKey));
  });

  // Mostrar/ocultar paneles
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.tab !== tabKey);
  });

  document.dispatchEvent(new CustomEvent('rm:tab-changed', { detail: tabKey }));
}
