// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase }          from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { renderHeader }  from './render-header.js';
import { renderTabs }    from './render-tabs.js';
import { renderFooter }  from './render-footer.js';
import { TABS }          from './constants.js';
import { state }         from './state.js';

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

function renderPanelRegistro(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card">
      <div class="card-title">Registro de datos</div>
      <div class="card-body">Tabla editable pendiente de implementar.</div>
    </div>
  `;
}

function renderPanelJugadores(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card">
      <div class="card-title">Jugadores</div>
      <div class="card-body">Listado de jugadores pendiente de implementar.</div>
    </div>
  `;
}

function renderPanelFichas(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card">
      <div class="card-title">Fichas</div>
      <div class="card-body">Plantilla de ficha individual pendiente de implementar.</div>
    </div>
  `;
}

function renderPanelConfig(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card">
      <div class="card-title">Configuración</div>
      <div class="card-body">Opciones de configuración de la aplicación.</div>
    </div>
  `;
}

const RENDERERS = {
  inicio:    renderPanelInicio,
  importar:  renderPanelImportar,
  registro:  renderPanelRegistro,
  jugadores: renderPanelJugadores,
  fichas:    renderPanelFichas,
  config:    renderPanelConfig,
};

// ── RENDERIZAR MAIN ───────────────────────────────

function renderMain() {
  const main = document.getElementById('rm-main');
  main.innerHTML = '';

  TABS.forEach(tab => {
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
  document.addEventListener('rm:tab-changed', e => {
    const tabKey = e.detail;
    const panel  = document.querySelector(`.tab-panel[data-tab="${tabKey}"]`);
    if (!panel) return;

    const render = RENDERERS[tabKey];
    if (render) render(panel);
  });
}

// ── BOOT ─────────────────────────────────────────

function boot() {
  initFirebase();

  renderFooter();
  renderHeader();
  renderTabs();
  renderMain();
  setupEvents();
}

document.addEventListener('DOMContentLoaded', boot);
