// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase }           from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { renderHeader }  from './render-header.js';
import { renderTabs, switchTab } from './render-tabs.js';
import { renderFooter }  from './render-footer.js';
import { TABS, LOGO_PATH, TEAMS } from './constants.js';
import { state, setState }         from './state.js';
import { renderFichaDetalle } from './ficha-detalle.js';
import { renderFichaPagina1 } from './ficha-pagina1.js';
import { FICHA1_DEMO_DATA }   from './ficha-pagina1-demo-data.js';
import { exportFichaAsPDF } from './pdf-export.js';
import { showError, showSuccess, safeText } from './utils.js';

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

let plantillasSelectedPlayerId = null; // navegación local lista ↔ perfil (no es estado global de la app)
let configCriteriaPosition = null;      // qué posición se está editando en "Items a evaluar"
let configSubTab = 'posiciones';        // pestaña interna activa dentro de Configuración

const CONFIG_SUBTABS = [
  { key: 'posiciones',  label: 'Posiciones' },
  { key: 'items',       label: 'Items por posición' },
  { key: 'colores',     label: 'Rango de colores' },
  { key: 'temporadas',  label: 'Temporadas' },
];

const CRITERIA_CATEGORIES = [
  { key: 'mental',                  label: 'Mental (ficha 2)' },
  { key: 'tecnico',                 label: 'Técnico (ficha 2)' },
  { key: 'tactico',                 label: 'Táctico (ficha 2)' },
  { key: 'condicional',             label: 'Condicional (ficha 2)' },
  { key: 'personalidad',            label: 'Personalidad (ficha 1)' },
  { key: 'competenciasOfensivas',   label: 'Competencias ofensivas (ficha 1)' },
  { key: 'competenciasDefensivas',  label: 'Competencias defensivas (ficha 1)' },
];

function buildCriteriaCategoryHTML(cat) {
  const items = state.criteriaSchemas[configCriteriaPosition]?.[cat.key] || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-cat="${cat.key}" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-cat="${cat.key}" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-cat="${cat.key}" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="text-xs mb-8" style="font-weight:700;">${safeText(cat.label)}</div>
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin items definidos.</span>'}
      </div>
      <div class="flex gap-8">
        <input class="input" type="text" data-crit-new data-cat="${cat.key}" placeholder="Nuevo item…" />
        <button class="btn btn-sm" data-crit-add data-cat="${cat.key}">+ Añadir</button>
      </div>
    </div>
  `;
}

function renderPanelPlantillas(container) {
  const player = plantillasSelectedPlayerId
    ? state.players.find(p => p.id === plantillasSelectedPlayerId)
    : null;

  if (plantillasSelectedPlayerId && !player) plantillasSelectedPlayerId = null; // se borró, vuelve a la lista

  if (player) {
    renderPlayerProfile(container, player);
  } else {
    renderPlantillasList(container);
  }
}

function renderPlantillasList(container) {
  const posLabel = keys => keys
    .map(k => state.positions.find(p => p.key === k)?.label || k)
    .join(' / ');

  const rows = state.players.map(pl => `
    <tr>
      <td><button class="link-btn" data-open="${pl.id}">${safeText(pl.name)}</button></td>
      <td>
        <select class="select" data-team-for="${pl.id}">
          <option value="">—</option>
          ${TEAMS.map(t => `<option value="${t.key}" ${pl.teamsBySeason[state.season] === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </td>
      <td>${safeText(posLabel(pl.positions))}</td>
      <td><button class="btn btn-sm" data-del="${pl.id}">Eliminar</button></td>
    </tr>
  `).join('');

  const posOptions = state.positions.map(p => `<option value="${p.key}">${safeText(p.label)}</option>`).join('');

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="card mb-16">
      <div class="card-title">Nuevo jugador</div>
      <div class="card-body">
        <p class="text-xs text-muted mb-16">El equipo se asigna para la temporada activa (${safeText(state.season)}) — cámbiala en el selector del header.</p>
        <div class="flex gap-12" style="flex-wrap:wrap;align-items:flex-end;">
          <label>
            <div class="text-xs text-muted mb-8">Nombre</div>
            <input class="input" type="text" id="pl-name" placeholder="Nombre y apellidos" />
          </label>
          <label>
            <div class="text-xs text-muted mb-8">Equipo (${safeText(state.season)})</div>
            <select class="select" id="pl-team">
              ${TEAMS.map(t => `<option value="${t.key}">${t.label}</option>`).join('')}
            </select>
          </label>
          <label>
            <div class="text-xs text-muted mb-8">Posición 1</div>
            <select class="select" id="pl-pos1"><option value="">—</option>${posOptions}</select>
          </label>
          <label>
            <div class="text-xs text-muted mb-8">Posición 2 (opcional)</div>
            <select class="select" id="pl-pos2"><option value="">—</option>${posOptions}</select>
          </label>
          <button class="btn btn-primary" id="pl-add">+ Añadir jugador</button>
        </div>
        ${state.positions.length === 0 ? '<p class="text-xs text-muted mt-16">⚠ No hay posiciones definidas todavía — añádelas en Configuración.</p>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Jugadores (${state.players.length}) — temporada ${safeText(state.season)}</div>
      <div class="card-body" style="overflow-x:auto;">
        <table class="table">
          <thead><tr><th>Nombre</th><th>Equipo</th><th>Posición(es)</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="text-muted">Sin jugadores todavía.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="text-xs text-muted mt-16" style="padding: 0 16px 16px;">
        ⚠ Pendiente: esto solo dura mientras la pestaña está abierta. Falta guardarlo en Firestore para que persista.
      </p>
    </div>
  `;

  container.querySelector('#pl-add').addEventListener('click', () => {
    const name = container.querySelector('#pl-name').value.trim();
    const team = container.querySelector('#pl-team').value;
    const pos1 = container.querySelector('#pl-pos1').value;
    const pos2 = container.querySelector('#pl-pos2').value;

    if (!name) { showError('Falta el nombre del jugador.'); return; }
    if (!pos1) { showError('Elige al menos una posición.'); return; }
    if (pos2 && pos2 === pos1) { showError('Las 2 posiciones no pueden ser la misma.'); return; }

    const positions = [pos1, ...(pos2 ? [pos2] : [])];
    const teamsBySeason = team ? { [state.season]: team } : {};
    setState({ players: [...state.players, { id: crypto.randomUUID(), name, positions, teamsBySeason }] });
    renderPanelPlantillas(container);
    showSuccess('Jugador añadido.');
  });

  container.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      plantillasSelectedPlayerId = btn.dataset.open;
      renderPanelPlantillas(container);
    });
  });

  container.querySelectorAll('[data-team-for]').forEach(sel => {
    sel.addEventListener('change', () => {
      const id = sel.dataset.teamFor;
      const players = state.players.map(p => p.id === id
        ? { ...p, teamsBySeason: { ...p.teamsBySeason, [state.season]: sel.value } }
        : p
      );
      setState({ players });
      showSuccess('Equipo actualizado para ' + state.season + '.');
    });
  });

  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({
        players:  state.players.filter(p => p.id !== btn.dataset.del),
        informes: state.informes.filter(i => i.playerId !== btn.dataset.del),
      });
      renderPanelPlantillas(container);
    });
  });
}

function renderPlayerProfile(container, player) {
  const posLabel = state.positions.find(p => p.key === player.positions[0])?.label || player.positions[0];
  const posLabel2 = player.positions[1]
    ? (state.positions.find(p => p.key === player.positions[1])?.label || player.positions[1])
    : null;

  const teamRows = state.seasons.map(s => `
    <tr><td>${safeText(s)}</td><td>${safeText(TEAMS.find(t => t.key === player.teamsBySeason[s])?.label || '—')}</td></tr>
  `).join('');

  const informesSeason = state.informes
    .filter(i => i.playerId === player.id && i.season === state.season)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const informesRows = informesSeason.map(inf => `
    <tr>
      <td>${new Date(inf.createdAt).toLocaleDateString('es-ES')}</td>
      <td>${safeText(inf.season)}</td>
      <td><button class="btn btn-sm" data-ver-informe="${inf.id}">Ver ficha</button></td>
    </tr>
  `).join('');

  container.innerHTML = `
    <button class="btn btn-sm mb-16" id="pl-back">← Volver a Plantillas</button>
    <div class="card mb-16">
      <div class="card-title">${safeText(player.name)}</div>
      <div class="card-body">
        <p class="mb-8"><strong>Posición${posLabel2 ? 'es' : ''}:</strong> ${safeText(posLabel)}${posLabel2 ? ' / ' + safeText(posLabel2) : ''}</p>
        <table class="table" style="max-width:400px;">
          <thead><tr><th>Temporada</th><th>Equipo</th></tr></thead>
          <tbody>${teamRows}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Informes — temporada ${safeText(state.season)}</div>
      <div class="card-body">
        <button class="btn btn-primary mb-16" id="pl-new-informe">+ Nuevo informe (ficha 1/2 + 2/2)</button>
        <table class="table">
          <thead><tr><th>Fecha</th><th>Temporada</th><th></th></tr></thead>
          <tbody>${informesRows || '<tr><td colspan="3" class="text-muted">Sin informes en esta temporada.</td></tr>'}</tbody>
        </table>
        <p class="text-xs text-muted mt-16">
          ⚠ Pendiente: "Ver ficha" todavía no carga los datos reales de este jugador — de momento lleva a la plantilla de ejemplo en la pestaña Fichas.
        </p>
      </div>
    </div>
  `;

  container.querySelector('#pl-back').addEventListener('click', () => {
    plantillasSelectedPlayerId = null;
    renderPanelPlantillas(container);
  });

  container.querySelector('#pl-new-informe').addEventListener('click', () => {
    const informe = { id: crypto.randomUUID(), playerId: player.id, season: state.season, createdAt: new Date().toISOString() };
    setState({ informes: [...state.informes, informe] });
    renderPlayerProfile(container, player);
    showSuccess('Informe creado.');
  });

  container.querySelectorAll('[data-ver-informe]').forEach(btn => {
    btn.addEventListener('click', () => switchTab('fichas'));
  });
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

let fichasSubPage = 1; // qué página de la ficha se muestra: 1 ó 2

/**
 * Construye los datos de la ficha 2 (mental/técnico/táctico/condicional)
 * a partir del esquema de Configuración de una posición — así, si cambias
 * los items ahí, se reflejan aquí. Valores siempre en blanco (demo).
 */
function buildFichaDemoFromSchema(positionKey) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const rated = key => (schema[key] || []).map(label => ({ label, value: null }));
  const condicional = (schema.condicional || []).map(label => ({
    label, valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null,
  }));

  return {
    player: { name: 'Jugador de ejemplo', photoUrl: null },
    blocks: {
      mental:      { rp: [null, null], items: rated('mental') },
      tecnico:     { rp: [null, null], items: rated('tecnico') },
      tactico:     { rp: [null, null], items: rated('tactico') },
      condicional: { rp: null,         items: condicional },
    },
    plan: {
      tecnico:     ['', '', '', '', '', '', ''],
      tactico:     ['', '', '', '', '', '', ''],
      condicional: ['', '', '', '', '', '', ''],
      mental:      ['', '', '', '', '', '', ''],
    },
  };
}

function renderPanelFichas(container) {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="mb-16 flex ficha-toolbar" style="justify-content:space-between;align-items:center;">
      <div class="flex gap-8">
        <button class="btn ${fichasSubPage === 1 ? 'btn-primary' : 'btn-sm'}" data-ficha-page="1">Ficha 1</button>
        <button class="btn ${fichasSubPage === 2 ? 'btn-primary' : 'btn-sm'}" data-ficha-page="2">Ficha 2</button>
      </div>
      <button class="btn btn-primary btn-print-ficha" id="btn-print-ficha">⬇ Descargar PDF</button>
    </div>
    <p class="text-xs text-muted mb-16">Datos de ejemplo, pendiente de conectar a Firestore.</p>
    <div id="ficha1-demo-wrap" class="ficha-wrap ${fichasSubPage === 1 ? '' : 'hidden'}"></div>
    <div id="ficha-demo-wrap" class="ficha-wrap ${fichasSubPage === 2 ? '' : 'hidden'}"></div>
  `;
  const wrap1 = container.querySelector('#ficha1-demo-wrap');
  renderFichaPagina1(wrap1, FICHA1_DEMO_DATA, LOGO_PATH);

  const wrap = container.querySelector('#ficha-demo-wrap');
  renderFichaDetalle(wrap, buildFichaDemoFromSchema('portero'), LOGO_PATH, state.scoreBands);

  container.querySelectorAll('[data-ficha-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      fichasSubPage = Number(btn.dataset.fichaPage);
      renderPanelFichas(container);
    });
  });

  const btnPrint = container.querySelector('#btn-print-ficha');
  btnPrint.addEventListener('click', async () => {
    const activeWrap = fichasSubPage === 1 ? wrap1 : wrap;
    const fichaEl = activeWrap.querySelector('.ficha-detalle');
    if (!fichaEl) return;
    btnPrint.disabled = true;
    btnPrint.textContent = 'Generando PDF…';
    try {
      await exportFichaAsPDF(fichaEl, `ficha-jugador-pagina${fichasSubPage}.pdf`);
    } catch (err) {
      showError('No se pudo generar el PDF: ' + err.message);
    } finally {
      btnPrint.disabled = false;
      btnPrint.textContent = '⬇ Descargar PDF';
    }
  });
}

function renderPanelConfig(container) {
  const bandsSorted = [...state.scoreBands].sort((a, b) => b.min - a.min);
  const posRows = state.positions.map(p => `
    <span class="chip">${safeText(p.label)} <button data-del-pos="${p.key}" title="Quitar">×</button></span>
  `).join('');
  const seasonRows = state.seasons.map(s => `
    <span class="chip">${safeText(s)} <button data-del-season="${safeText(s)}" title="Quitar">×</button></span>
  `).join('');

  if (configCriteriaPosition && !state.positions.some(p => p.key === configCriteriaPosition)) {
    configCriteriaPosition = null;
  }
  if (!configCriteriaPosition && state.positions.length) {
    configCriteriaPosition = state.positions[0].key;
  }

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="flex gap-8 mb-16" style="border-bottom:1px solid var(--border-default);padding-bottom:8px;">
      ${CONFIG_SUBTABS.map(t => `
        <button class="btn ${t.key === configSubTab ? 'btn-primary' : 'btn-sm'}" data-config-subtab="${t.key}">${t.label}</button>
      `).join('')}
    </div>

    ${configSubTab !== 'posiciones' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Posiciones</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Las evaluaciones (CSV, formularios) son por posición — esta lista es la que se usa en Plantillas para asignar posición a cada jugador.
        </p>
        <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          ${posRows || '<span class="text-xs text-muted">Sin posiciones definidas.</span>'}
        </div>
        <div class="flex gap-12" style="align-items:flex-end;">
          <label>
            <div class="text-xs text-muted mb-8">Nueva posición</div>
            <input class="input" type="text" id="pos-new" placeholder="Ej. Portero" />
          </label>
          <button class="btn btn-primary" id="pos-add">+ Añadir posición</button>
        </div>
      </div>
    </div>
    `}

    ${configSubTab !== 'items' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Items a evaluar</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Los 4 bloques de la ficha 2 (Mental, Técnico, Táctico, Condicional) y los 3 de la ficha 1 (Personalidad, Competencias ofensivas, Competencias defensivas). Cada posición tiene su propia lista.
        </p>
        ${state.positions.length === 0 ? '<p class="text-xs text-muted">Define primero al menos una posición en la pestaña Posiciones.</p>' : `
          <div class="flex gap-12 mb-16" style="align-items:flex-end;flex-wrap:wrap;">
            <label style="display:block;max-width:280px;">
              <div class="text-xs text-muted mb-8">Posición</div>
              <select class="select" id="crit-position">
                ${state.positions.map(p => `<option value="${p.key}" ${p.key === configCriteriaPosition ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}
              </select>
            </label>
            ${state.positions.length > 1 ? `
              <label style="display:block;max-width:280px;">
                <div class="text-xs text-muted mb-8">Copiar todos los items desde…</div>
                <select class="select" id="crit-copy-from">
                  <option value="">—</option>
                  ${state.positions.filter(p => p.key !== configCriteriaPosition).map(p => `<option value="${p.key}">${safeText(p.label)}</option>`).join('')}
                </select>
              </label>
              <button class="btn btn-sm" id="crit-copy-btn">Copiar</button>
            ` : ''}
          </div>
          ${CRITERIA_CATEGORIES.map(buildCriteriaCategoryHTML).join('')}
        `}
      </div>
    </div>
    `}

    ${configSubTab !== 'temporadas' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Temporadas</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Al crear una temporada nueva, cada jugador empieza con el mismo equipo que tenía en la temporada anterior — luego lo cambias en Plantillas si se ha movido.
        </p>
        <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
          ${seasonRows || '<span class="text-xs text-muted">Sin temporadas definidas.</span>'}
        </div>
        <div class="flex gap-12" style="align-items:flex-end;">
          <label>
            <div class="text-xs text-muted mb-8">Nueva temporada</div>
            <input class="input" type="text" id="season-new" placeholder="Ej. 2027/2028" />
          </label>
          <button class="btn btn-primary" id="season-add">+ Crear temporada</button>
        </div>
      </div>
    </div>
    `}

    ${configSubTab !== 'colores' ? '' : `
    <div class="card">
      <div class="card-title">Colores de las medias</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Se aplican a MENTAL, TÉCNICO y TÁCTICO (y al círculo central). CONDICIONAL usa objetivos GPS aparte (✔/✘), no estas bandas.
          Pon las bandas que necesites (3, 4, las que sean) — se ordenan solas de mayor a menor umbral.
        </p>
        <div class="flex gap-8" style="flex-direction:column;">
          ${bandsSorted.map((b, i) => `
            <div class="flex gap-12" style="align-items:center;" data-band-row="${i}">
              <input type="color" value="${b.color}" data-band-color="${i}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
              <span class="text-xs text-muted">a partir de</span>
              <input class="input" type="number" step="0.1" min="0" max="10" value="${b.min}" data-band-min="${i}" style="width:80px;" />
              <button class="btn btn-sm" data-band-del="${i}" ${bandsSorted.length <= 1 ? 'disabled' : ''}>Quitar</button>
            </div>
          `).join('')}
        </div>
        <button class="btn mt-16" id="band-add">+ Añadir banda de color</button>
        <p class="text-xs text-muted mt-16">
          ⚠ Pendiente: nada de esta pantalla persiste todavía — falta guardarlo en Firestore.
        </p>
      </div>
    </div>
    `}
  `;

  container.querySelectorAll('[data-config-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      configSubTab = btn.dataset.configSubtab;
      renderPanelConfig(container);
    });
  });

  const copyBtn = container.querySelector('#crit-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const from = container.querySelector('#crit-copy-from').value;
      if (!from) { showError('Elige de qué posición copiar.'); return; }
      const source = state.criteriaSchemas[from] || {};
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: {
            mental: [...(source.mental || [])],
            tecnico: [...(source.tecnico || [])],
            tactico: [...(source.tactico || [])],
            condicional: [...(source.condicional || [])],
            personalidad: [...(source.personalidad || [])],
            competenciasOfensivas: [...(source.competenciasOfensivas || [])],
            competenciasDefensivas: [...(source.competenciasDefensivas || [])],
          },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
      showSuccess('Items copiados. Revísalos antes de dar por bueno el perfil.');
    });
  }

  container.querySelectorAll('[data-band-color]').forEach(input => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.bandColor);
      const bands = [...bandsSorted];
      bands[i] = { ...bands[i], color: input.value };
      setState({ scoreBands: bands });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
      showSuccess('Color actualizado.');
    });
  });

  container.querySelectorAll('[data-band-min]').forEach(input => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.bandMin);
      const min = parseFloat(input.value);
      if (Number.isNaN(min)) { showError('Umbral no válido.'); return; }
      const bands = [...bandsSorted];
      bands[i] = { ...bands[i], min };
      setState({ scoreBands: bands });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
      renderPanelConfig(container); // reordena si el cambio lo requiere
      showSuccess('Umbral actualizado.');
    });
  });

  container.querySelectorAll('[data-band-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (bandsSorted.length <= 1) return;
      const i = Number(btn.dataset.bandDel);
      const bands = bandsSorted.filter((_, idx) => idx !== i);
      setState({ scoreBands: bands });
      document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
      renderPanelConfig(container);
      showSuccess('Banda eliminada.');
    });
  });

  container.querySelector('#band-add')?.addEventListener('click', () => {
    // Nueva banda entre la más baja actual y 0, con un color por defecto neutro.
    const lowestMin = bandsSorted[bandsSorted.length - 1]?.min ?? 1;
    const newMin = Math.max(0, lowestMin - 1);
    const bands = [...bandsSorted, { color: '#94a3b8', min: newMin }];
    setState({ scoreBands: bands });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    renderPanelConfig(container);
  });

  container.querySelector('#pos-add')?.addEventListener('click', () => {
    const input = container.querySelector('#pos-new');
    const label = input.value.trim();
    if (!label) { showError('Escribe el nombre de la posición.'); return; }

    const key = label.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (state.positions.some(p => p.key === key)) {
      showError('Esa posición ya existe.');
      return;
    }
    setState({ positions: [...state.positions, { key, label }] });
    renderPanelConfig(container);
    showSuccess('Posición añadida.');
  });

  container.querySelectorAll('[data-del-pos]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.delPos;
      const inUse = state.players.some(p => p.positions.includes(key));
      if (inUse) {
        showError('No se puede quitar: hay jugadores con esa posición asignada.');
        return;
      }
      setState({ positions: state.positions.filter(p => p.key !== key) });
      renderPanelConfig(container);
    });
  });

  const critSelect = container.querySelector('#crit-position');
  if (critSelect) {
    critSelect.addEventListener('change', () => {
      configCriteriaPosition = critSelect.value;
      renderPanelConfig(container);
    });
  }

  container.querySelectorAll('[data-crit-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const input = container.querySelector(`[data-crit-new][data-cat="${cat}"]`);
      const label = input.value.trim();
      if (!label) { showError('Escribe el nombre del item.'); return; }
      const schema = state.criteriaSchemas[configCriteriaPosition] || {};
      const items = schema[cat] || [];
      if (items.includes(label)) { showError('Ese item ya existe en este bloque.'); return; }
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: { ...schema, [cat]: [...items, label] },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-del-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      const schema = state.criteriaSchemas[configCriteriaPosition] || {};
      const items = (schema[cat] || []).filter((_, i) => i !== idx);
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: { ...schema, [cat]: items },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-move-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      const dir = Number(btn.dataset.dir); // -1 sube, +1 baja
      const schema = state.criteriaSchemas[configCriteriaPosition] || {};
      const items = [...(schema[cat] || [])];
      const target = idx + dir;
      if (target < 0 || target >= items.length) return;
      [items[idx], items[target]] = [items[target], items[idx]];
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: { ...schema, [cat]: items },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelector('#season-add')?.addEventListener('click', () => {
    const input = container.querySelector('#season-new');
    const season = input.value.trim();
    if (!season) { showError('Escribe el nombre de la temporada.'); return; }
    if (state.seasons.includes(season)) { showError('Esa temporada ya existe.'); return; }

    // Traspaso automático: cada jugador empieza en la temporada nueva
    // con el mismo equipo que tenía en la última temporada existente.
    const prevSeason = state.seasons[state.seasons.length - 1];
    const players = state.players.map(p => {
      const prevTeam = p.teamsBySeason[prevSeason];
      return prevTeam
        ? { ...p, teamsBySeason: { ...p.teamsBySeason, [season]: prevTeam } }
        : p;
    });

    setState({ seasons: [...state.seasons, season], players });
    renderHeader();
    renderPanelConfig(container);
    showSuccess('Temporada creada. Revisa los equipos en Plantillas.');
  });

  container.querySelectorAll('[data-del-season]').forEach(btn => {
    btn.addEventListener('click', () => {
      const season = btn.dataset.delSeason;
      if (season === state.season) {
        showError('No se puede quitar la temporada activa — cámbiala primero en el header.');
        return;
      }
      const inUse = state.players.some(p => p.teamsBySeason[season])
        || state.informes.some(i => i.season === season);
      if (inUse) {
        showError('No se puede quitar: hay jugadores o informes de esa temporada.');
        return;
      }
      setState({ seasons: state.seasons.filter(s => s !== season) });
      renderPanelConfig(container);
    });
  });
}

const RENDERERS = {
  inicio:     renderPanelInicio,
  importar:   renderPanelImportar,
  registro:   renderPanelRegistro,
  plantillas: renderPanelPlantillas,
  jugadores:  renderPanelJugadores,
  fichas:     renderPanelFichas,
  config:     renderPanelConfig,
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

  document.addEventListener('rm:season-changed', () => {
    const panel = document.querySelector('.tab-panel[data-tab="plantillas"]');
    if (panel) renderPanelPlantillas(panel);
  });

  document.addEventListener('rm:criteria-changed', () => {
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
