// ================================================
// COLUMNAS-ENCUESTA-UI.JS — Configuración → Columnas encuesta.
// Las 51 columnas del archivo de la encuesta, por posición: nombre en la
// BBDD y competencia a la que va cada nota. Guarda solo los cambios sobre
// la plantilla en state.columnasEncuesta.
// ================================================

import { state, setState } from './state.js';
import { safeText } from './utils.js';
import { buildAspectoPorCompetencia } from './medias.js';
import { columnasEfectivas } from './importar-plantilla.js';

let cePos = null;

function guardar(pos, n, patch) {
  const todo = JSON.parse(JSON.stringify(state.columnasEncuesta || {}));
  todo[pos] = todo[pos] || {};
  todo[pos][n] = { ...(todo[pos][n] || {}), ...patch };
  setState({ columnasEncuesta: todo });
}

export function renderColumnasEncuesta(container) {
  if (!state.positions.length) { container.innerHTML = '<p class="text-xs text-muted">Define primero al menos una posición.</p>'; return; }
  if (!cePos || !state.positions.some(p => p.key === cePos)) cePos = state.positions[0].key;
  const cols = columnasEfectivas(state, cePos);
  const aspecto = buildAspectoPorCompetencia(state, cePos);
  const competencias = Object.keys(aspecto).filter(c => aspecto[c] !== 'condicional');
  const perfiles = (state.criteriaSchemas[cePos]?.perfiles || []).filter(Boolean);
  const ESPECIALES = { '@fecha': 'Fecha y hora', '@evaluador': 'Evaluador', '@jugador': 'Jugador', 'equipo': 'Equipo (opcional)' };
  const usos = {};
  cols.forEach(c => { if (c.destino) usos[c.destino] = (usos[c.destino] || 0) + 1; });
  const hayCambios = Object.keys(state.columnasEncuesta?.[cePos] || {}).length > 0;
  const opt = (v, l, sel) => `<option value="${safeText(v)}" ${v === sel ? 'selected' : ''}>${safeText(l)}</option>`;

  const filas = cols.map(c => {
    const dup = c.destino && usos[c.destino] > 1;
    return `<tr>
      <td style="font-weight:700;">${c.num}</td>
      <td class="text-muted">${safeText(c.tipo)}</td>
      <td><input class="input" type="text" style="min-width:260px;" data-ce-nombre="${c.num}" value="${safeText(c.nombre)}" /></td>
      <td><select class="select" data-ce-destino="${c.num}">
        <option value="">— No se importa —</option>
        ${Object.entries(ESPECIALES).map(([k, l]) => opt(k, l, c.destino)).join('')}
        ${perfiles.map(p => opt(p, `Perfil: ${p}`, c.destino)).join('')}
        ${competencias.map(k => opt(k, `${k} (${aspecto[k]})`, c.destino)).join('')}
      </select>${dup ? ' <span title="Dos columnas van al mismo destino: la última pisa a la primera" style="color:#ef4444;">⚠ repetida</span>' : ''}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="flex gap-8 mb-16" style="flex-wrap:wrap;align-items:center;">
      ${state.positions.map(p => `<button class="btn ${p.key === cePos ? 'btn-primary' : 'btn-sm'}" data-ce-pos="${p.key}">${safeText(p.label)}</button>`).join('')}
      <span style="width:16px;"></span>
      <button class="btn btn-sm" id="ce-reset" ${hayCambios ? '' : 'disabled'}>Restaurar plantilla de esta posición</button>
    </div>
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Nº</th><th>Plantilla</th><th>Nombre en la BBDD</th><th>Va a (competencia)</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;

  const rerender = () => { const y = window.scrollY; renderColumnasEncuesta(container); requestAnimationFrame(() => window.scrollTo(0, y)); };
  container.querySelectorAll('[data-ce-pos]').forEach(b => b.addEventListener('click', () => { cePos = b.dataset.cePos; rerender(); }));
  container.querySelectorAll('[data-ce-nombre]').forEach(i => i.addEventListener('change', () => {
    guardar(cePos, Number(i.dataset.ceNombre), { nombre: i.value.trim() });
    rerender();
  }));
  container.querySelectorAll('[data-ce-destino]').forEach(sel => sel.addEventListener('change', () => {
    const n = Number(sel.dataset.ceDestino);
    const patch = { destino: sel.value };
    if (sel.value && !(state.columnasEncuesta?.[cePos]?.[n]?.nombre)) patch.nombre = ESPECIALES[sel.value] || sel.value; // el nombre sigue al destino si no lo has cambiado
    guardar(cePos, n, patch);
    rerender();
  }));
  container.querySelector('#ce-reset')?.addEventListener('click', () => {
    const todo = JSON.parse(JSON.stringify(state.columnasEncuesta || {}));
    delete todo[cePos];
    setState({ columnasEncuesta: todo });
    rerender();
  });
}
