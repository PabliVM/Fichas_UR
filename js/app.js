// ================================================
// APP.JS — Punto de entrada RM Perfiles
// ================================================

import { initFirebase, addDocument, updateDocument, deleteDocument } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { renderHeader }  from './render-header.js';
import { renderTabs, switchTab } from './render-tabs.js';
import { renderFooter }  from './render-footer.js';
import { TABS, LOGO_PATH, TEAMS, FICHA2_OFFICIAL_DIMENSIONS } from './constants.js';
import { state, setState, DEFAULT_FICHA_COLORS, loadConfigFromFirestore, loadPlayersFromFirestore } from './state.js';
import { renderFichaDetalle, setGpsTolerance } from './ficha-detalle.js';
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
let jugadorFormId = null; // null=formulario cerrado, 'new'=alta, <id>=editando ese jugador
let configCriteriaPosition = null;      // qué posición se está editando en "Items a evaluar"
let fichaTipoPosition = null;           // qué posición se está viendo en Configuración → Fichas tipo → Individual
let configSubTab = 'posiciones';        // pestaña interna activa dentro de Configuración

const CONFIG_GROUPS = [
  {
    label: 'Contenido',
    tabs: [
      { key: 'posiciones',       label: 'Posiciones' },
      { key: 'items',            label: 'Aspectos' },
      { key: 'colores',          label: 'Rango de colores' },
      { key: 'condicional-refs', label: 'Datos condicionales' },
    ],
  },
  {
    label: 'Fichas tipo',
    tabs: [
      { key: 'fichas-individual',  label: 'Individual' },
      { key: 'fichas-campograma',  label: 'Campograma' },
      { key: 'fichas-mapa-nivel',  label: 'Mapa de nivel' },
    ],
  },
  {
    label: 'Diseño',
    tabs: [
      { key: 'ficha-colores', label: 'Colores de la ficha' },
      { key: 'dimensiones',   label: 'Dimensiones' },
    ],
  },
];
// Temporadas: quitado de momento (código y datos se mantienen, solo se oculta la pestaña).

// Comunes a todas las posiciones (sin selector de posición).
const ASPECTOS_COMUNES_CATEGORIES = [
  { key: 'mental',      label: 'Mental' },
  { key: 'tecnico',     label: 'Técnico' },
  { key: 'condicional', label: 'Condicional' },
];
let itemsConfigPage = 2; // qué página se edita en "Items a evaluar": 1 ó 2

function buildAspectoComunCategoryHTML(cat) {
  const items = state.aspectosComunes[cat.key] || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-scope="comun" data-cat="${cat.key}" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">${safeText(cat.label)} <span class="text-muted" style="font-weight:400;text-transform:none;font-size:11px;">(común a todas las posiciones)</span></div>
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin items definidos.</span>'}
      </div>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="input" data-crit-new data-scope="comun" data-cat="${cat.key}" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo item… (o pega varios, uno por línea)"></textarea>
        <button class="btn btn-sm" data-crit-add data-scope="comun" data-cat="${cat.key}">+ Añadir</button>
      </div>
    </div>
  `;
}

// Selector de posición + copiar (Táctico/Ofensivas/Defensivas dependen de la posición).
function buildPositionSelectorHTML() {
  return `
    <div class="flex gap-12 mb-16" style="align-items:flex-end;flex-wrap:wrap;">
      <label style="display:block;max-width:280px;">
        <div class="text-xs text-muted mb-8">Posición</div>
        <select class="select" data-crit-position>
          ${state.positions.map(p => `<option value="${p.key}" ${p.key === configCriteriaPosition ? 'selected' : ''}>${safeText(p.label)}</option>`).join('')}
        </select>
      </label>
      ${state.positions.length > 1 ? `
        <label style="display:block;max-width:280px;">
          <div class="text-xs text-muted mb-8">Copiar Táctico/Ofensivas/Defensivas desde…</div>
          <select class="select" data-crit-copy-from>
            <option value="">—</option>
            ${state.positions.filter(p => p.key !== configCriteriaPosition).map(p => `<option value="${p.key}">${safeText(p.label)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-sm" data-crit-copy-btn>Copiar</button>
      ` : ''}
    </div>
  `;
}

// Táctico: varía por posición (configCriteriaPosition). Selector de posición debajo del título.
function buildTacticoCategoryHTML() {
  const items = state.criteriaSchemas[configCriteriaPosition]?.tactico || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-cat="tactico" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-cat="tactico" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-cat="tactico" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Táctico</div>
      ${buildPositionSelectorHTML()}
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin items definidos.</span>'}
      </div>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="input" data-crit-new data-cat="tactico" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo item… (o pega varios, uno por línea)"></textarea>
        <button class="btn btn-sm" data-crit-add data-cat="tactico">+ Añadir</button>
      </div>
    </div>
  `;
}

// Ofensivas/Defensivas: checkboxes SOBRE el Táctico ya creado (no texto libre).
function buildOfenDefCheckboxesHTML(role, label) {
  const key = role === 'of' ? 'competenciasOfensivas' : 'competenciasDefensivas';
  const tactico = state.criteriaSchemas[configCriteriaPosition]?.tactico || [];
  const selected = state.criteriaSchemas[configCriteriaPosition]?.[key] || [];
  const titleHTML = `<div class="mb-8" style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.02em;color:var(--text-secondary);">${label}</div>`;
  if (!tactico.length) {
    return `<div style="flex:1;min-width:260px;">${titleHTML}<p class="text-xs text-muted">Define antes el Táctico de esta posición (pestaña Ficha 2).</p></div>`;
  }
  const boxes = tactico.map(label2 => `
    <label class="flex gap-8" style="align-items:center;">
      <input type="checkbox" data-toggle-comp data-role="${role}" data-label="${safeText(label2)}" ${selected.includes(label2) ? 'checked' : ''} />
      <span class="text-xs">${safeText(label2)}</span>
    </label>
  `).join('');
  return `
    <div style="flex:1;min-width:260px;">
      ${titleHTML}
      <div class="flex gap-8" style="flex-direction:column;">${boxes}</div>
    </div>
  `;
}

// Perfiles: lista libre por posición (nombre del perfil — sin competencias asociadas todavía).
function buildPerfilesCategoryHTML() {
  const items = state.criteriaSchemas[configCriteriaPosition]?.perfiles || [];
  const chips = items.map((label, i) => `
    <span class="chip">
      ${i > 0 ? `<button data-move-crit data-cat="perfiles" data-idx="${i}" data-dir="-1" title="Subir">↑</button>` : ''}
      ${i < items.length - 1 ? `<button data-move-crit data-cat="perfiles" data-idx="${i}" data-dir="1" title="Bajar">↓</button>` : ''}
      ${safeText(label)}
      <button data-del-crit data-cat="perfiles" data-idx="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  return `
    <div class="mb-16">
      <div class="flex gap-8 mb-8" style="flex-wrap:wrap;">
        ${chips || '<span class="text-xs text-muted">Sin perfiles definidos.</span>'}
      </div>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="input" data-crit-new data-cat="perfiles" rows="1" style="min-height:36px;resize:vertical;" placeholder="Nuevo perfil… (o pega varios, uno por línea)"></textarea>
        <button class="btn btn-sm" data-crit-add data-cat="perfiles">+ Añadir</button>
      </div>
    </div>
  `;
}

// Tabla "Datos condicionales": filas = Aspectos → Condicional, columnas = Posiciones × (3, 4).
// Nada hardcodeado: se genera de state.aspectosComunes.condicional y state.positions.
function buildCondicionalRefsTableHTML() {
  const items = state.aspectosComunes.condicional || [];
  const positions = state.positions || [];
  if (!items.length) return '<p class="text-xs text-muted">Define primero ítems en Aspectos → Condicional.</p>';
  if (!positions.length) return '<p class="text-xs text-muted">Define primero al menos una posición.</p>';

  const getVal = (posKey, item, col) => state.condicionalRefs?.[posKey]?.[item]?.[col] ?? '';

  return `
    <div class="cond-refs-wrap" style="overflow-x:auto;max-width:100%;--cond-refs-bg:${state.fichaColors.slate};--cond-refs-header:${state.fichaColors.wine};">
      <table class="cond-refs-table">
        <thead>
          <tr>
            <th class="cond-refs-sticky">Ítem condicional</th>
            ${positions.map(p => `<th colspan="2" style="text-align:center;">${safeText(p.label)}</th>`).join('')}
          </tr>
          <tr>
            <th class="cond-refs-sticky">Fútbol profesional</th>
            ${positions.map(() => `<th style="text-align:center;">Med.</th><th style="text-align:center;">Máx.</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td class="cond-refs-sticky">${safeText(item)}</td>
              ${positions.map(p => `
                <td><input type="text" data-condicional-ref data-pos="${p.key}" data-item="${safeText(item)}" data-col="col3" value="${getVal(p.key, item, 'col3')}" /></td>
                <td><input type="text" data-condicional-ref data-pos="${p.key}" data-item="${safeText(item)}" data-col="col4" value="${getVal(p.key, item, 'col4')}" /></td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
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

// Año y edad NUNCA se guardan — se calculan siempre de birthDate para que no se desincronicen.
function calcAgeAndYear(birthDateStr) {
  if (!birthDateStr) return { age: null, year: null };
  const d = new Date(birthDateStr);
  if (Number.isNaN(d.getTime())) return { age: null, year: null };
  const year = d.getFullYear();
  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear = (today.getMonth() > d.getMonth()) || (today.getMonth() === d.getMonth() && today.getDate() >= d.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return { age, year };
}

function buildJugadorFormHTML(player) {
  const p = player || {};
  return `
    <div class="card mb-16">
      <div class="card-title">${player ? 'Editar jugador' : 'Nuevo jugador'}</div>
      <div class="card-body">
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <div class="field-group" style="min-width:180px;">
            <label class="label">Nombre</label>
            <input class="input" type="text" id="jug-nombre" value="${safeText(p.nombre || '')}" />
          </div>
          <div class="field-group" style="min-width:180px;">
            <label class="label">Apellidos</label>
            <input class="input" type="text" id="jug-apellidos" value="${safeText(p.apellidos || '')}" />
          </div>
          <div class="field-group" style="min-width:160px;">
            <label class="label">Fecha de nacimiento</label>
            <input class="input" type="date" id="jug-birthdate" value="${p.birthDate || ''}" />
          </div>
          <div class="field-group" style="min-width:120px;">
            <label class="label">Peso (kg)</label>
            <input class="input" type="number" step="0.1" min="0" id="jug-weight" value="${p.weight ?? ''}" />
          </div>
          <div class="field-group" style="min-width:120px;">
            <label class="label">Altura (m)</label>
            <input class="input" type="number" step="0.01" min="0" id="jug-height" value="${p.height ?? ''}" />
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Lateralidad</label>
            <select class="select" id="jug-foot">
              <option value="">—</option>
              <option value="Diestro" ${p.foot === 'Diestro' ? 'selected' : ''}>Diestro</option>
              <option value="Zurdo" ${p.foot === 'Zurdo' ? 'selected' : ''}>Zurdo</option>
              <option value="Ambidiestro" ${p.foot === 'Ambidiestro' ? 'selected' : ''}>Ambidiestro</option>
            </select>
          </div>
          <div class="field-group" style="min-width:150px;">
            <label class="label">Edad madurativa</label>
            <input class="input" type="text" id="jug-maturational" value="${safeText(p.maturationalAge ?? '')}" />
          </div>
        </div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="jug-save">${player ? 'Guardar cambios' : 'Añadir jugador'}</button>
          <button class="btn btn-ghost" id="jug-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function renderPanelJugadores(container) {
  const editingPlayer = (jugadorFormId && jugadorFormId !== 'new')
    ? state.players.find(p => p.id === jugadorFormId)
    : null;
  if (jugadorFormId && jugadorFormId !== 'new' && !editingPlayer) jugadorFormId = null; // se borró, cierra el form

  const rows = state.players.map(p => {
    const { age, year } = calcAgeAndYear(p.birthDate);
    return `
      <tr>
        <td>${safeText(p.nombre || '')}</td>
        <td>${safeText(p.apellidos || '')}</td>
        <td>${p.birthDate || '-'}</td>
        <td>${year ?? '-'}</td>
        <td>${age ?? '-'}</td>
        <td>${p.weight != null ? p.weight + ' kg' : '-'}</td>
        <td>${p.height != null ? p.height + ' m' : '-'}</td>
        <td>${safeText(p.foot || '-')}</td>
        <td>${safeText(p.maturationalAge ?? '-')}</td>
        <td>
          <button class="btn btn-sm" data-jug-edit="${p.id}">Editar</button>
          <button class="btn btn-sm" data-jug-del="${p.id}">Borrar</button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    ${firebaseNotice()}
    ${jugadorFormId ? buildJugadorFormHTML(editingPlayer) : ''}
    <div class="card">
      <div class="card-title">Jugadores (${state.players.length})</div>
      <div class="card-body">
        ${jugadorFormId ? '' : '<button class="btn btn-primary mb-16" id="jug-add">+ Añadir jugador</button>'}
        <div style="overflow-x:auto;">
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th><th>Apellidos</th><th>F. nacimiento</th><th>Año</th><th>Edad</th>
                <th>Peso</th><th>Altura</th><th>Lateralidad</th><th>E. madurativa</th><th></th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="10" class="text-muted">Sin jugadores todavía.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#jug-add')?.addEventListener('click', () => {
    jugadorFormId = 'new';
    renderPanelJugadores(container);
  });
  container.querySelector('#jug-cancel')?.addEventListener('click', () => {
    jugadorFormId = null;
    renderPanelJugadores(container);
  });
  container.querySelectorAll('[data-jug-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      jugadorFormId = btn.dataset.jugEdit;
      renderPanelJugadores(container);
    });
  });
  container.querySelectorAll('[data-jug-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.jugDel;
      try {
        if (!isFirebaseUnconfigured()) await deleteDocument('jugadores', id);
        setState({ players: state.players.filter(p => p.id !== id) });
        renderPanelJugadores(container);
        showSuccess('Jugador borrado.');
      } catch (err) {
        console.error('[Firestore] No se pudo borrar el jugador:', err);
        showError('No se pudo borrar el jugador (revisa las reglas de Firestore).');
      }
    });
  });
  container.querySelector('#jug-save')?.addEventListener('click', async () => {
    const data = {
      nombre: container.querySelector('#jug-nombre').value.trim(),
      apellidos: container.querySelector('#jug-apellidos').value.trim(),
      birthDate: container.querySelector('#jug-birthdate').value || null,
      weight: container.querySelector('#jug-weight').value === '' ? null : parseFloat(container.querySelector('#jug-weight').value),
      height: container.querySelector('#jug-height').value === '' ? null : parseFloat(container.querySelector('#jug-height').value),
      foot: container.querySelector('#jug-foot').value,
      maturationalAge: container.querySelector('#jug-maturational').value.trim(),
    };
    if (!data.nombre) { showError('El nombre es obligatorio.'); return; }
    try {
      if (jugadorFormId === 'new') {
        let id = crypto.randomUUID();
        if (!isFirebaseUnconfigured()) id = await addDocument('jugadores', data);
        setState({ players: [...state.players, { id, ...data }] });
        showSuccess('Jugador añadido.');
      } else {
        if (!isFirebaseUnconfigured()) await updateDocument('jugadores', jugadorFormId, data);
        setState({ players: state.players.map(p => p.id === jugadorFormId ? { ...p, ...data } : p) });
        showSuccess('Jugador actualizado.');
      }
      jugadorFormId = null;
      renderPanelJugadores(container);
    } catch (err) {
      console.error('[Firestore] No se pudo guardar el jugador:', err);
      showError('No se pudo guardar el jugador (revisa las reglas de Firestore o la conexión).');
    }
  });
}

let fichasSubPage = 1; // qué página de la ficha se muestra: 1 ó 2

/**
 * Construye los datos de la ficha 2 (mental/técnico/táctico/condicional)
 * a partir del esquema de Configuración de una posición — así, si cambias
 * los items ahí, se reflejan aquí. Valores siempre en blanco (demo).
 */
function buildFichaDemoFromSchema(positionKey) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const rated = list => (list || []).map(label => ({ label, value: null }));
  // refA/refB (columnas 3/4) = valores fijos de Configuración → Datos condicionales
  // para esta posición. valueA/valueB (columnas 1/2) son manuales — sin datos aún.
  const condicional = (state.aspectosComunes.condicional || []).map(label => {
    const ref = state.condicionalRefs?.[positionKey]?.[label] || {};
    return {
      label, valueA: null, valueB: null,
      refA: ref.col3 ?? null, refB: ref.col4 ?? null,
    };
  });

  return {
    player: { name: 'Jugador de ejemplo', photoUrl: null },
    blocks: {
      mental:      { rp: [null, null], items: rated(state.aspectosComunes.mental) },
      tecnico:     { rp: [null, null], items: rated(state.aspectosComunes.tecnico) },
      tactico:     { rp: [null, null], items: rated(schema.tactico) },
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

/**
 * Ficha 1: Personalidad = derivada de Mental (sin duplicar dato, fuente única).
 * Ofensivas/Defensivas = las seleccionadas en Configuración (subconjunto de Táctico).
 */
function buildFicha1DemoFromSchema(positionKey) {
  const schema = state.criteriaSchemas[positionKey] || {};
  const mental = state.aspectosComunes.mental || [];
  const mid = Math.ceil(mental.length / 2);
  return {
    ...FICHA1_DEMO_DATA,
    personalidad: {
      col1: mental.slice(0, mid).map(label => ({ label, status: null })),
      col2: mental.slice(mid).map(label => ({ label, status: null })),
    },
    competenciasOfensivas: (schema.competenciasOfensivas || []).map(label => ({ label, status: null })),
    competenciasDefensivas: (schema.competenciasDefensivas || []).map(label => ({ label, status: null })),
  };
}

function renderPanelFichas(container, positionKey = 'portero') {
  container.innerHTML = `
    ${firebaseNotice()}
    <div class="mb-16 flex ficha-toolbar" style="justify-content:space-between;align-items:center;">
      <div class="flex gap-8">
        <button class="btn ${fichasSubPage === 1 ? 'btn-primary' : 'btn-sm'}" data-ficha-page="1">Individual 1</button>
        <button class="btn ${fichasSubPage === 2 ? 'btn-primary' : 'btn-sm'}" data-ficha-page="2">Individual 2</button>
      </div>
      <button class="btn btn-primary btn-print-ficha" id="btn-print-ficha">⬇ Descargar PDF</button>
    </div>
    <p class="text-xs text-muted mb-16">Datos de ejemplo, pendiente de conectar a Firestore.</p>
    <div id="ficha1-demo-wrap" class="ficha-wrap ${fichasSubPage === 1 ? '' : 'hidden'}"></div>
    <div id="ficha-demo-wrap" class="ficha-wrap ${fichasSubPage === 2 ? '' : 'hidden'}"></div>
  `;
  const wrap1 = container.querySelector('#ficha1-demo-wrap');
  renderFichaPagina1(wrap1, buildFicha1DemoFromSchema(positionKey), LOGO_PATH, state.fichaColors);

  const wrap = container.querySelector('#ficha-demo-wrap');
  setGpsTolerance(state.condicionalTolerance);
  renderFichaDetalle(wrap, buildFichaDemoFromSchema(positionKey), LOGO_PATH, state.scoreBands, undefined, state.fichaColors);

  container.querySelectorAll('[data-ficha-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      fichasSubPage = Number(btn.dataset.fichaPage);
      renderPanelFichas(container, positionKey);
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
      await exportFichaAsPDF(fichaEl, `ficha-tipo-${positionKey}-pagina${fichasSubPage}.pdf`);
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

  if (fichaTipoPosition && !state.positions.some(p => p.key === fichaTipoPosition)) {
    fichaTipoPosition = null;
  }
  if (!fichaTipoPosition && state.positions.length) {
    fichaTipoPosition = state.positions[0].key;
  }

  container.innerHTML = `
    ${firebaseNotice()}
    <div class="mb-16" style="border-bottom:1px solid var(--border-default);padding-bottom:8px;">
      ${CONFIG_GROUPS.map(g => `
        <div class="flex gap-8 mb-8" style="align-items:center;flex-wrap:wrap;">
          <span class="text-xs text-muted" style="min-width:80px;font-weight:700;text-transform:uppercase;">${g.label}</span>
          ${g.tabs.map(t => `
            <button class="btn ${t.key === configSubTab ? 'btn-primary' : 'btn-sm'}" data-config-subtab="${t.key}">${t.label}</button>
          `).join('')}
        </div>
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
          Mental/Técnico/Condicional son comunes a todas las posiciones. Táctico varía por posición.
          Ofensivas/Defensivas (ficha 1) se seleccionan del Táctico de esa posición. Personalidad (ficha 1) se genera sola desde Mental.
        </p>
        ${state.positions.length === 0 ? '<p class="text-xs text-muted">Define primero al menos una posición en la pestaña Posiciones.</p>' : `
          <div class="flex gap-8 mb-16">
            <button class="btn ${itemsConfigPage === 1 ? 'btn-primary' : 'btn-sm'}" data-items-page="1">Ficha 1</button>
            <button class="btn ${itemsConfigPage === 2 ? 'btn-primary' : 'btn-sm'}" data-items-page="2">Ficha 2</button>
          </div>

          ${itemsConfigPage === 2 ? ASPECTOS_COMUNES_CATEGORIES.map(buildAspectoComunCategoryHTML).join('') : `
            <div class="mb-16">
              <div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Personalidad <span class="text-muted" style="font-weight:400;text-transform:none;font-size:11px;">(automática)</span></div>
              <p class="text-xs text-muted">Se genera desde Mental. Edítala en la pestaña "Ficha 2".</p>
            </div>
          `}

          ${itemsConfigPage === 2
            ? buildTacticoCategoryHTML()
            : `<div class="mb-8" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Competencias</div>`
              + buildPositionSelectorHTML()
              + `<div class="flex gap-24" style="flex-wrap:wrap;">${buildOfenDefCheckboxesHTML('of', 'Ofensivas')}${buildOfenDefCheckboxesHTML('def', 'Defensivas')}</div>`
              + `<div class="mb-8 mt-16" style="font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.02em;">Perfiles</div>`
              + buildPositionSelectorHTML()
              + buildPerfilesCategoryHTML()}
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
      </div>
    </div>
    `}

    ${configSubTab !== 'condicional-refs' ? '' : `
    <div class="card">
      <div class="card-title">Datos condicionales</div>
      <div class="card-body">
        <div class="flex gap-24" style="align-items:flex-start;flex-wrap:wrap;">
          ${buildCondicionalRefsTableHTML()}
          <div class="field-group" style="min-width:220px;">
            <label class="label">Tolerancia (±) para el guion amarillo</label>
            <input class="input" type="text" id="condicional-tolerance" value="${state.condicionalTolerance}" style="max-width:140px;" />
            <p class="text-xs text-muted mt-8">
              En Ficha 2, si el valor del jugador está dentro de ± esta cifra respecto a la media profesional (columna 3), sale guion amarillo. Por encima → check verde. Por debajo → X roja.
            </p>
          </div>
        </div>
      </div>
    </div>
    `}

    ${configSubTab !== 'ficha-colores' ? '' : `
    <div class="card">
      <div class="card-title">Colores de la ficha</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          El fondo general y el de las cabeceras (MENTAL/TÉCNICO/... y PLAN DE ACCIÓN) de la ficha 1 y la ficha 2.
        </p>
        <div class="flex mb-16" style="gap:24px;flex-wrap:wrap;">
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-slate" value="${state.fichaColors.slate}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Fondo general</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-wine" value="${state.fichaColors.wine}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Cabeceras (granate)</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-general" value="${state.fichaColors.textGeneral}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto general</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-header" value="${state.fichaColors.textHeader}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto de las cabeceras</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-aspectos" value="${state.fichaColors.textAspectos}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto de "Aspectos del jugador"</span>
          </label>
          <label class="flex gap-8" style="align-items:center;">
            <input type="color" id="ficha-color-text-subheader" value="${state.fichaColors.textSubheaderWhite}" style="width:40px;height:32px;padding:2px;border-radius:4px;border:1px solid var(--border-default);" />
            <span class="text-xs text-muted">Texto de las cabeceras blancas del plan</span>
          </label>
        </div>
        <div class="flex gap-8">
          <button class="btn" id="ficha-colors-reset">Restaurar valores por defecto</button>
          <button class="btn btn-primary" id="ficha-colors-save-default">Guardar como predeterminado</button>
        </div>
        <p class="text-xs text-muted mt-16">
          "Restaurar" vuelve a lo último guardado como predeterminado (o a los de fábrica si nunca has guardado uno).
        </p>
      </div>
    </div>
    `}

    ${configSubTab !== 'dimensiones' ? '' : `
    <div class="card">
      <div class="card-title">Dimensiones oficiales — Ficha 2</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">
          Referencia fija (no editable): son los valores reales de <code>css/ficha.css</code> y <code>js/ficha-detalle.js</code>.
          Lienzo de diseño: ${FICHA2_OFFICIAL_DIMENSIONS.designWidth} × ${FICHA2_OFFICIAL_DIMENSIONS.designHeight}px.
          La Ficha 1 usa un lienzo de 4700px de ancho — sus valores se aplican escalados ×0.6528 (4700/7200) para que se vean del mismo tamaño en pantalla.
        </p>
        <div style="max-width:520px;">
          ${FICHA2_OFFICIAL_DIMENSIONS.groups.map(g => `
            <div class="mb-8">
              <div class="text-xs mb-8" style="font-weight:700;">${safeText(g.title)}</div>
              <table class="table table-compact">
                <tbody>
                  ${g.rows.map(([label, value]) => `
                    <tr><td>${safeText(label)}</td><td style="text-align:right;font-weight:600;white-space:nowrap;">${safeText(value)}</td></tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        </div>
        <p class="text-xs text-muted mt-16">
          ⚠ Ficha 1 ya aplica estos valores escalados en <code>css/ficha1.css</code> (título/subheader/listas/círculo). Lo que no tiene equivalente en Ficha 1 (radar, GPS, plan de acción) no aplica.
        </p>
      </div>
    </div>
    `}

    ${configSubTab !== 'fichas-individual' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas tipo — Individual</div>
      <div class="card-body">
        <p class="text-sm text-muted mb-16">Vista previa de la Ficha 1 y Ficha 2 de cada posición, generadas desde Aspectos.</p>
        ${state.positions.length === 0 ? '<p class="text-xs text-muted">Define primero al menos una posición en la pestaña Posiciones.</p>' : `
          <div class="flex gap-8 mb-16" style="flex-wrap:wrap;">
            ${state.positions.map(p => `<button class="btn ${p.key === fichaTipoPosition ? 'btn-primary' : 'btn-sm'}" data-ficha-tipo-pos="${p.key}">${safeText(p.label)}</button>`).join('')}
          </div>
          <div id="fichas-tipo-wrap"></div>
        `}
      </div>
    </div>
    `}

    ${configSubTab !== 'fichas-campograma' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas tipo — Campograma</div>
      <div class="card-body"><p class="text-xs text-muted">Pendiente de implementar.</p></div>
    </div>
    `}

    ${configSubTab !== 'fichas-mapa-nivel' ? '' : `
    <div class="card mb-16">
      <div class="card-title">Fichas tipo — Mapa de nivel</div>
      <div class="card-body"><p class="text-xs text-muted">Pendiente de implementar.</p></div>
    </div>
    `}
  `;

  container.querySelectorAll('[data-config-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      configSubTab = btn.dataset.configSubtab;
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-ficha-tipo-pos]').forEach(btn => {
    btn.addEventListener('click', () => {
      fichaTipoPosition = btn.dataset.fichaTipoPos;
      renderPanelConfig(container);
    });
  });

  const fichasTipoWrap = container.querySelector('#fichas-tipo-wrap');
  if (fichasTipoWrap) renderPanelFichas(fichasTipoWrap, fichaTipoPosition);

  container.querySelectorAll('[data-crit-copy-btn]').forEach(copyBtn => {
    copyBtn.addEventListener('click', () => {
      const from = copyBtn.parentElement.querySelector('[data-crit-copy-from]')?.value;
      if (!from) { showError('Elige de qué posición copiar.'); return; }
      const source = state.criteriaSchemas[from] || {};
      setState({
        criteriaSchemas: {
          ...state.criteriaSchemas,
          [configCriteriaPosition]: {
            ...(state.criteriaSchemas[configCriteriaPosition] || {}),
            tactico: [...(source.tactico || [])],
            competenciasOfensivas: [...(source.competenciasOfensivas || [])],
            competenciasDefensivas: [...(source.competenciasDefensivas || [])],
          },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
      showSuccess('Items copiados. Revísalos antes de dar por bueno el perfil.');
    });
  });

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

  // Datos condicionales: guarda al salir del campo (change), sin re-renderizar
  // la tabla entera (perdería el foco/scroll en cada tecla).
  container.querySelectorAll('[data-condicional-ref]').forEach(input => {
    input.addEventListener('change', () => {
      const pos = input.dataset.pos;
      const item = input.dataset.item;
      const col = input.dataset.col;
      const raw = input.value.trim();
      const num = raw === '' ? null : parseFloat(raw.replace(',', '.'));
      const value = (num === null || Number.isNaN(num)) ? null : num;
      const posRefs = state.condicionalRefs[pos] || {};
      const itemRefs = posRefs[item] || {};
      setState({
        condicionalRefs: {
          ...state.condicionalRefs,
          [pos]: { ...posRefs, [item]: { ...itemRefs, [col]: value } },
        },
      });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
    });
  });

  container.querySelector('#condicional-tolerance')?.addEventListener('change', e => {
    const raw = e.target.value.trim().replace(',', '.');
    const num = parseFloat(raw);
    const value = (raw === '' || Number.isNaN(num) || num < 0) ? state.condicionalTolerance : num;
    e.target.value = value;
    setState({ condicionalTolerance: value });
    document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
  });

  container.querySelector('#ficha-color-slate')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, slate: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-wine')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, wine: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-general')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textGeneral: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-header')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textHeader: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-aspectos')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textAspectos: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-color-text-subheader')?.addEventListener('change', e => {
    setState({ fichaColors: { ...state.fichaColors, textSubheaderWhite: e.target.value } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
  });
  container.querySelector('#ficha-colors-reset')?.addEventListener('click', () => {
    setState({ fichaColors: { ...(state.fichaColorsDefault || DEFAULT_FICHA_COLORS) } });
    document.dispatchEvent(new CustomEvent('rm:thresholds-changed'));
    renderPanelConfig(container);
    showSuccess('Colores restaurados al predeterminado.');
  });
  container.querySelector('#ficha-colors-save-default')?.addEventListener('click', () => {
    setState({ fichaColorsDefault: { ...state.fichaColors } });
    showSuccess('Guardado como predeterminado. "Restaurar" volverá aquí a partir de ahora.');
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

  container.querySelectorAll('[data-crit-position]').forEach(critSelect => {
    critSelect.addEventListener('change', () => {
      configCriteriaPosition = critSelect.value;
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-items-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      itemsConfigPage = Number(btn.dataset.itemsPage);
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-crit-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const isComun = btn.dataset.scope === 'comun';
      const input = container.querySelector(`[data-crit-new][data-cat="${cat}"]${isComun ? '[data-scope="comun"]' : ''}`);
      // Admite pegar/escribir varias líneas: una por item. Se descartan vacías
      // y duplicados (contra lo ya existente y entre sí, sin distinguir mayúsculas).
      const rawLines = input.value.split('\n').map(l => l.trim()).filter(Boolean);
      if (!rawLines.length) { showError('Escribe el nombre del item (uno por línea si son varios).'); return; }
      const existingItems = isComun
        ? (state.aspectosComunes[cat] || [])
        : ((state.criteriaSchemas[configCriteriaPosition] || {})[cat] || []);
      const existingLower = existingItems.map(l => l.toLowerCase());
      const toAdd = [];
      const skipped = [];
      rawLines.forEach(line => {
        const lower = line.toLowerCase();
        if (existingLower.includes(lower) || toAdd.some(a => a.toLowerCase() === lower)) {
          skipped.push(line);
        } else {
          toAdd.push(line);
        }
      });
      if (!toAdd.length) { showError('Ese item ya existe en este bloque.'); return; }
      if (isComun) {
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: [...existingItems, ...toAdd] } });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: [...existingItems, ...toAdd] } } });
      }
      if (skipped.length) showSuccess(`${toAdd.length} añadido(s). ${skipped.length} ya existían y se han ignorado.`);
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-del-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.scope === 'comun') {
        const items = (state.aspectosComunes[cat] || []).filter((_, i) => i !== idx);
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: items } });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        const items = (schema[cat] || []).filter((_, i) => i !== idx);
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: items } } });
      }
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-move-crit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      const dir = Number(btn.dataset.dir); // -1 sube, +1 baja
      const isComun = btn.dataset.scope === 'comun';
      const items = [...((isComun ? state.aspectosComunes[cat] : state.criteriaSchemas[configCriteriaPosition]?.[cat]) || [])];
      const target = idx + dir;
      if (target < 0 || target >= items.length) return;
      [items[idx], items[target]] = [items[target], items[idx]];
      if (isComun) {
        setState({ aspectosComunes: { ...state.aspectosComunes, [cat]: items } });
      } else {
        const schema = state.criteriaSchemas[configCriteriaPosition] || {};
        setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [cat]: items } } });
      }
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
      renderPanelConfig(container);
    });
  });

  container.querySelectorAll('[data-toggle-comp]').forEach(box => {
    box.addEventListener('change', () => {
      const role = box.dataset.role; // 'of' | 'def'
      const key = role === 'of' ? 'competenciasOfensivas' : 'competenciasDefensivas';
      const label = box.dataset.label;
      const schema = state.criteriaSchemas[configCriteriaPosition] || {};
      const current = schema[key] || [];
      const next = box.checked ? [...current, label] : current.filter(l => l !== label);
      setState({ criteriaSchemas: { ...state.criteriaSchemas, [configCriteriaPosition]: { ...schema, [key]: next } } });
      document.dispatchEvent(new CustomEvent('rm:criteria-changed'));
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
    const wrap = document.querySelector('#fichas-tipo-wrap');
    if (wrap) renderPanelFichas(wrap, fichaTipoPosition);
  });

  document.addEventListener('rm:season-changed', () => {
    const panel = document.querySelector('.tab-panel[data-tab="plantillas"]');
    if (panel) renderPanelPlantillas(panel);
  });

  document.addEventListener('rm:criteria-changed', () => {
    const wrap = document.querySelector('#fichas-tipo-wrap');
    if (wrap) renderPanelFichas(wrap, fichaTipoPosition);
  });
}

// ── BOOT ─────────────────────────────────────────

async function boot() {
  initFirebase();
  await loadConfigFromFirestore(); // trae Configuración guardada antes de pintar
  await loadPlayersFromFirestore(); // trae la lista de jugadores

  renderFooter();
  renderHeader();
  renderTabs();
  renderMain();
  setupEvents();
}

document.addEventListener('DOMContentLoaded', boot);
