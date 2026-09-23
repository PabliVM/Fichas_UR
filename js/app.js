// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase }           from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { renderHeader }  from './render-header.js';
import { renderTabs }    from './render-tabs.js';
import { renderFooter }  from './render-footer.js';
import { TABS, LOGO_PATH } from './constants.js';
import { state }         from './state.js';
import { renderFichaDetalle, fitFichaToPrintPage, resetFichaPrintScale } from './ficha-detalle.js';
import { FICHA_DEMO_DATA }    from './ficha-demo-data.js';
import { showError, showSuccess } from './utils.js';

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
    <div class="mb-16 flex" style="justify-content:space-between;align-items:center;">
      <span><strong>Plantilla de ficha (página 2)</strong> — datos de ejemplo, pendiente de conectar a Firestore.</span>
      <button class="btn btn-primary btn-print-ficha" id="btn-print-ficha">🖨 Imprimir / PDF</button>
    </div>
    <div id="ficha-demo-wrap"></div>
  `;
  const wrap = container.querySelector('#ficha-demo-wrap');
  renderFichaDetalle(wrap, FICHA_DEMO_DATA, LOGO_PATH, state.scoreThresholds);

  container.querySelector('#btn-print-ficha').addEventListener('click', () => {
    fitFichaToPrintPage(wrap);
    window.print();
  });

  // Por si se imprime con Ctrl+P en vez de con el botón
  window.addEventListener('beforeprint', () => fitFichaToPrintPage(wrap));
  window.addEventListener('afterprint', () => resetFichaPrintScale(wrap));
}

function renderPanelConfig(container) {
  const t = state.scoreThresholds;
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card">
      <div class="card-title">Límites de color (medias)</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Se aplican a MENTAL, TÉCNICO y TÁCTICO. CONDICIONAL usa objetivos GPS aparte (✔/✘), no estos límites.
        </p>
        <div class="flex gap-12" style="align-items:flex-end;flex-wrap:wrap;">
          <label>
            <div class="text-xs text-muted mb-8">Verde a partir de</div>
            <input class="input" type="number" step="0.1" min="0" max="5" id="th-green" value="${t.green}" />
          </label>
          <label>
            <div class="text-xs text-muted mb-8">Amarillo a partir de</div>
            <input class="input" type="number" step="0.1" min="0" max="5" id="th-yellow" value="${t.yellow}" />
          </label>
          <span class="text-xs text-muted">Por debajo de amarillo → rojo.</span>
        </div>
        <p class="text-xs text-muted mt-16">
          ⚠ Pendiente: esto solo dura mientras la pestaña está abierta. Falta guardarlo en Firestore para que persista.
        </p>
      </div>
    </div>
  `;

  const greenInput  = container.querySelector('#th-green');
  const yellowInput = container.querySelector('#th-yellow');

  function applyThresholds() {
    const green  = parseFloat(greenInput.value);
    const yellow = parseFloat(yellowInput.value);
    if (Number.isNaN(green) || Number.isNaN(yellow) || yellow > green) {
      showError('El límite amarillo no puede ser mayor que el verde.');
      return;
    }
    setState({ scoreThresholds: { green, yellow } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    showSuccess('Límites actualizados.');
  }

  greenInput.addEventListener('change', applyThresholds);
  yellowInput.addEventListener('change', applyThresholds);
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

  document.addEventListener('rm:thresholds-changed', () => {
    const panel = document.querySelector('.tab-panel[data-tab="fichas"]');
    if (panel) renderPanelFichas(panel);
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
