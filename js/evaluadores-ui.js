// ================================================
// EVALUADORES-UI.JS — Configuración › Evaluadores.
// Lista los evaluadores que aparecen en los registros (JESUS, Jesús, jesus… = el mismo)
// y deja ponerles nombre completo, rol y equipo. Se guarda en state.evaluadores
// ({ claveNormalizada: { nombre, rol, teamKey } }). Solo informativo: no cambia notas ni medias.
// ================================================

import { state, setState } from './state.js';
import { TEAMS } from './constants.js';
import { queryRegistros } from './evaluaciones-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { safeText, showError } from './utils.js';

export const ROLES_EVALUADOR = ['Entrenador', '2º entrenador', 'Asistente', 'Asistente UR', 'Preparador físico', 'Analista', 'Coordinador', 'Psicólogo', 'Ojeador', 'Otro'];

export const claveEvaluador = nombre => String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Unificar: un evaluador puede ser "el mismo que" otro (MARC = Marc Carrasco) → se usan los datos de ese otro.
function claveFinal(k) {
  const ev = state.evaluadores || {};
  for (let i = 0; i < 5 && ev[k]?.igualA && ev[ev[k].igualA]; i++) k = ev[k].igualA;
  return k;
}

/** Datos guardados de un evaluador (por el nombre tal cual sale en el registro; si está unificado, los del otro) o null. */
export function infoEvaluador(nombre) {
  return (state.evaluadores || {})[claveFinal(claveEvaluador(nombre))] || null;
}

/** Texto para el "title" de una celda: "Jesús García · Entrenador · Infantil A". */
export function tituloEvaluador(nombre) {
  const i = infoEvaluador(nombre);
  if (!i) return 'Sin identificar: ponle nombre y rol en Configuración › Evaluadores';
  const eq = [i.teamKey, i.teamKey2].map(k => TEAMS.find(t => t.key === k)?.label).filter(Boolean).join(' / ');
  return [i.nombre || nombre, i.rol, eq].filter(Boolean).join(' · ');
}

let _cache = null; // { clave: { variantes:Set, n } } de los registros (se carga una vez por sesión)

export async function renderEvaluadores(wrap) {
  if (!_cache) {
    wrap.innerHTML = '<p class="text-xs text-muted">Buscando evaluadores en los registros…</p>';
    _cache = {};
    if (!isFirebaseUnconfigured()) {
      try {
        (await queryRegistros({})).forEach(r => {
          const k = claveEvaluador(r.evaluador); if (!k) return;
          const e = (_cache[k] = _cache[k] || { variantes: new Set(), n: 0 });
          e.variantes.add(String(r.evaluador).trim()); e.n++;
        });
      } catch (err) { console.error('[Evaluadores]', err); showError('No se pudieron leer los registros para listar evaluadores.'); }
    }
  }
  const guardados = state.evaluadores || {};
  const claves = [...new Set([...Object.keys(_cache), ...Object.keys(guardados)])].sort();
  const opt = (v, l, sel) => `<option value="${safeText(v)}" ${v === sel ? 'selected' : ''}>${safeText(l)}</option>`;
  wrap.innerHTML = !claves.length ? '<p class="text-sm text-muted">Todavía no hay evaluadores: aparecen solos al importar encuestas.</p>' : `
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>En la encuesta</th><th>Registros</th><th>Es el mismo que</th><th>Nombre completo</th><th>Rol</th><th>Equipo</th><th>2º equipo</th></tr></thead>
      <tbody>${claves.map(k => {
        const c = _cache[k], g = guardados[k] || {};
        const etiqueta = x => _cache[x] ? [..._cache[x].variantes].join(' · ') : (guardados[x]?.alias || x);
        const variantes = etiqueta(k);
        const unido = g.igualA && claves.includes(g.igualA);
        const otros = claves.filter(x => x !== k && !guardados[x]?.igualA); // solo a uno "principal" (sin cadenas)
        const dis = unido ? 'disabled title="Usa los datos del evaluador con el que está unificado"' : '';
        return `<tr ${unido ? 'style="opacity:.6;"' : ''}>
          <td style="font-weight:700;">${safeText(variantes)}</td>
          <td class="text-muted">${c ? c.n : 0}</td>
          <td><select class="select" data-ev-k="${safeText(k)}" data-ev-campo="igualA" title="Unificar: MARC = Marc Carrasco"><option value="">— (es él mismo)</option>${otros.map(x => opt(x, etiqueta(x), g.igualA)).join('')}</select></td>
          <td><input class="input" data-ev-k="${safeText(k)}" data-ev-campo="nombre" value="${safeText(g.nombre || '')}" placeholder="Nombre y apellidos" style="min-width:200px;" ${dis} /></td>
          <td><select class="select" data-ev-k="${safeText(k)}" data-ev-campo="rol" ${dis}><option value="">—</option>${ROLES_EVALUADOR.map(r => opt(r, r, g.rol)).join('')}</select></td>
          <td><select class="select" data-ev-k="${safeText(k)}" data-ev-campo="teamKey" ${dis}><option value="">—</option>${TEAMS.filter(t => !(state.equiposOcultos || []).includes(t.key) || t.key === g.teamKey).map(t => opt(t.key, t.label, g.teamKey)).join('')}</select></td>
          <td><select class="select" data-ev-k="${safeText(k)}" data-ev-campo="teamKey2" ${dis}><option value="">—</option>${TEAMS.filter(t => !(state.equiposOcultos || []).includes(t.key) || t.key === g.teamKey2).map(t => opt(t.key, t.label, g.teamKey2)).join('')}</select></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  wrap.querySelectorAll('[data-ev-k]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.evK, campo = el.dataset.evCampo;
    const actual = { ...(state.evaluadores || {}) };
    const fila = { ...(actual[k] || {}), alias: _cache[k] ? [..._cache[k].variantes][0] : (actual[k]?.alias || k) };
    const v = el.value.trim();
    if (v) fila[campo] = v; else delete fila[campo];
    actual[k] = fila;
    setState({ evaluadores: actual }); // se guarda en la configuración (como el resto de Configuración)
    if (campo === 'igualA') renderEvaluadores(wrap);
  }));
}
