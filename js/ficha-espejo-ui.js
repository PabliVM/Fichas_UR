// ================================================
// FICHA-ESPEJO-UI.JS — Configuración → Fichas Espejo.
// Mapa numerado por posición (Ficha 1 / Ficha 2) y editor
// visual de la regla de cada número. SOLO guarda reglas en
// state.fichaEspejoReglas; NO toca las fichas reales.
// ================================================

import { state, setState } from './state.js';
import { safeText, showError, showSuccess } from './utils.js';
import {
  ORIGENES, VACIOS, DECIMALES,
  buildMapaFicha, camposDeOrigen, operacionesDeOrigen, reglaSugerida, resumenRegla,
} from './ficha-espejo.js';

let fePos = null;       // posición activa
let feFicha = 1;        // 1 | 2
let feNum = null;       // número abierto en el editor
let feDraft = null;     // regla en edición (aún sin guardar)
let feVista = 'ficha';  // 'ficha' | 'resumen'

const getRegla = (pos, ficha, num) => state.fichaEspejoReglas?.[pos]?.[ficha]?.[num] || null;

function guardarRegla(pos, ficha, num, regla) {
  const todas = JSON.parse(JSON.stringify(state.fichaEspejoReglas || {}));
  todas[pos] = todas[pos] || {};
  todas[pos][ficha] = todas[pos][ficha] || {};
  if (regla) todas[pos][ficha][num] = regla;
  else delete todas[pos][ficha][num];
  setState({ fichaEspejoReglas: todas });
}

function conScroll(fn) {
  const y = window.scrollY;
  fn();
  requestAnimationFrame(() => window.scrollTo(0, y));
}

const opt = (value, label, sel) => `<option value="${safeText(String(value))}" ${String(sel) === String(value) ? 'selected' : ''}>${safeText(label)}</option>`;

function buildEditorHTML(mapa) {
  const slot = mapa.slots.find(s => s.num === feNum);
  if (!slot) return '';
  const d = feDraft;
  const campos = camposDeOrigen(d.origen, mapa.catalogo);
  const ops = operacionesDeOrigen(d.origen);
  const esEval = d.origen === 'evaluaciones';
  return `
    <div class="card mb-16" style="border:2px solid var(--blue-500, #3b82f6);">
      <div class="card-title">Nº ${slot.num} — ${safeText(slot.label)} <span class="text-muted" style="font-weight:400;">(${safeText(slot.bloqueLabel)})</span></div>
      <div class="card-body">
        <div class="flex gap-12" style="flex-wrap:wrap;">
          <label class="field-group" style="min-width:200px;"><div class="label">Origen</div>
            <select class="select" data-fe-f="origen">${ORIGENES.map(o => opt(o.key, o.label, d.origen)).join('')}</select></label>
          <label class="field-group" style="min-width:260px;"><div class="label">Campo</div>
            <select class="select" data-fe-f="campoId"><option value="">— elige —</option>${campos.map(c => opt(c.id, c.label, d.campoId)).join('')}</select></label>
          <label class="field-group" style="min-width:170px;"><div class="label">Operación</div>
            <select class="select" data-fe-f="operacion">${ops.map(o => opt(o.key, o.label, d.operacion)).join('')}</select></label>
          <label class="field-group" style="min-width:170px;"><div class="label">Valores vacíos</div>
            <select class="select" data-fe-f="vacios" ${esEval ? '' : 'disabled'}>${VACIOS.map(v => opt(v.key, v.label, d.vacios)).join('')}</select></label>
          <label class="field-group" style="min-width:110px;"><div class="label">Decimales</div>
            <select class="select" data-fe-f="decimales">${DECIMALES.map(n => opt(n, String(n), d.decimales)).join('')}</select></label>
        </div>
        <div class="text-xs text-muted mt-16" style="line-height:1.7;">
          ${esEval ? `
            <b>Filtros fijos (no editables):</b> jugador actual de la ficha · evaluación seleccionada · el campo elegido.<br>
            <b>Registros:</b> todos los evaluadores de ese jugador en esa evaluación. Solo cuentan las respuestas válidas; nunca se mezclan otras evaluaciones, fechas ni jugadores.
          ` : d.origen === 'jugadores'
            ? '<b>Filtro fijo:</b> jugador actual de la ficha. Valor directo de su ficha de jugador.'
            : '<b>Filtro fijo:</b> posición de la ficha. Valor de referencia definido en Datos condicionales.'}
        </div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="fe-guardar">Guardar regla</button>
          <button class="btn btn-sm" id="fe-quitar">Quitar regla</button>
          <button class="btn btn-ghost" id="fe-cerrar">Cerrar</button>
        </div>
      </div>
    </div>`;
}

function buildFichaVistaHTML(mapa) {
  const rows = mapa.slots.map(s => {
    const r = getRegla(fePos, feFicha, s.num);
    const desfasado = r && r.labelAlGuardar && r.labelAlGuardar !== s.label;
    return `
      <tr style="${feNum === s.num ? 'background:var(--bg-hover);' : ''}">
        <td><span style="display:inline-block;min-width:34px;text-align:center;font-weight:800;padding:2px 6px;border-radius:6px;background:var(--blue-700, #1d4ed8);color:#fff;">${s.num}</span></td>
        <td class="text-muted">${safeText(s.bloqueLabel)}</td>
        <td>${safeText(s.label)}</td>
        <td class="text-muted">${safeText(s.campoId || '—')}</td>
        <td class="text-xs">${safeText(resumenRegla(r, mapa.catalogo))}${desfasado ? ` <b style="color:#ef4444;">⚠ el ítem de este número ha cambiado (antes: ${safeText(r.labelAlGuardar)})</b>` : ''}</td>
        <td><button class="btn btn-sm" data-fe-num="${s.num}">Configurar</button></td>
      </tr>`;
  }).join('');
  return `
    ${feNum != null ? buildEditorHTML(mapa) : ''}
    ${mapa.avisos.length ? `<div class="text-xs mb-16" style="color:#b45309;line-height:1.7;"><b>Avisos del mapa:</b><br>${mapa.avisos.map(a => '· ' + safeText(a)).join('<br>')}</div>` : ''}
    <div class="flex gap-8 mb-16">
      <button class="btn btn-sm" id="fe-sugeridas">Rellenar sugeridas (solo huecos vacíos)</button>
      <span class="text-xs text-muted" style="align-self:center;">Sugerida = Evaluaciones → su propio campo → Media → ignorar vacíos → 1 decimal.</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="table table-compact">
        <thead><tr><th>Nº</th><th>Bloque</th><th>Dato mostrado</th><th>ID interno</th><th>Regla</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="text-muted">Esta posición no tiene ítems definidos todavía (Configuración → Aspectos).</td></tr>'}</tbody>
      </table>
    </div>`;
}

function buildResumenHTML() {
  const filas = state.positions.map(p => {
    const celda = ficha => {
      const m = buildMapaFicha(state, p.key, ficha);
      const porBloque = {};
      m.slots.forEach(s => { porBloque[s.bloqueLabel] = (porBloque[s.bloqueLabel] || 0) + 1; });
      const cfg = m.slots.filter(s => getRegla(p.key, ficha, s.num)).length;
      return `<b>${m.slots.length}</b> nº · ${Object.entries(porBloque).map(([b, n]) => `${safeText(b)} ${n}`).join(' · ')}<br>
        <span class="text-muted">${cfg}/${m.slots.length} con regla</span>
        ${m.avisos.length ? `<br><span style="color:#b45309;">${m.avisos.map(a => '· ' + safeText(a)).join('<br>')}</span>` : ''}`;
    };
    return `<tr><td><b>${safeText(p.label)}</b></td><td class="text-xs">${celda(1)}</td><td class="text-xs">${celda(2)}</td></tr>`;
  }).join('');
  return `
    <div class="flex gap-8 mb-16"><button class="btn btn-sm" id="fe-csv">Descargar mapa completo (CSV)</button></div>
    <div style="overflow-x:auto;"><table class="table table-compact">
      <thead><tr><th>Posición</th><th>Ficha 1</th><th>Ficha 2</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
}

function descargarCSV() {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [['Posicion', 'Ficha', 'Num', 'Bloque', 'Dato', 'ID', 'Regla'].map(esc).join(';')];
  state.positions.forEach(p => {
    [1, 2].forEach(f => {
      const m = buildMapaFicha(state, p.key, f);
      m.slots.forEach(s => lineas.push([p.label, f, s.num, s.bloqueLabel, s.label, s.campoId || '', resumenRegla(getRegla(p.key, f, s.num), m.catalogo)].map(esc).join(';')));
    });
  });
  const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mapa-fichas-espejo.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function renderFichasEspejo(container) {
  if (!state.positions.length) { container.innerHTML = '<p class="text-xs text-muted">Define primero al menos una posición.</p>'; return; }
  if (!fePos || !state.positions.some(p => p.key === fePos)) fePos = state.positions[0].key;
  const mapa = buildMapaFicha(state, fePos, feFicha);

  container.innerHTML = `
    <div class="flex gap-8 mb-16" style="flex-wrap:wrap;align-items:center;">
      ${state.positions.map(p => `<button class="btn ${p.key === fePos && feVista === 'ficha' ? 'btn-primary' : 'btn-sm'}" data-fe-pos="${p.key}">${safeText(p.label)}</button>`).join('')}
      <span style="width:16px;"></span>
      <button class="btn ${feFicha === 1 && feVista === 'ficha' ? 'btn-primary' : 'btn-sm'}" data-fe-ficha="1">Ficha 1</button>
      <button class="btn ${feFicha === 2 && feVista === 'ficha' ? 'btn-primary' : 'btn-sm'}" data-fe-ficha="2">Ficha 2</button>
      <span style="width:16px;"></span>
      <button class="btn ${feVista === 'resumen' ? 'btn-primary' : 'btn-sm'}" data-fe-vista="resumen">Mapa completo</button>
    </div>
    ${feVista === 'resumen' ? buildResumenHTML() : buildFichaVistaHTML(mapa)}
  `;

  const rerender = () => conScroll(() => renderFichasEspejo(container));

  container.querySelectorAll('[data-fe-pos]').forEach(b => b.addEventListener('click', () => { fePos = b.dataset.fePos; feVista = 'ficha'; feNum = null; feDraft = null; rerender(); }));
  container.querySelectorAll('[data-fe-ficha]').forEach(b => b.addEventListener('click', () => { feFicha = Number(b.dataset.feFicha); feVista = 'ficha'; feNum = null; feDraft = null; rerender(); }));
  container.querySelector('[data-fe-vista]')?.addEventListener('click', () => { feVista = 'resumen'; feNum = null; feDraft = null; rerender(); });
  container.querySelector('#fe-csv')?.addEventListener('click', descargarCSV);

  container.querySelectorAll('[data-fe-num]').forEach(b => b.addEventListener('click', () => {
    feNum = Number(b.dataset.feNum);
    const slot = mapa.slots.find(s => s.num === feNum);
    feDraft = { ...(getRegla(fePos, feFicha, feNum) || reglaSugerida(slot) || { origen: 'evaluaciones', campoId: '', operacion: 'media', vacios: 'ignorar', decimales: 1 }) };
    rerender();
  }));

  container.querySelectorAll('[data-fe-f]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.feF;
    feDraft[k] = k === 'decimales' ? Number(el.value) : el.value;
    if (k === 'origen') {
      feDraft.campoId = '';
      if (!operacionesDeOrigen(feDraft.origen).some(o => o.key === feDraft.operacion)) feDraft.operacion = 'directo';
      if (feDraft.origen !== 'evaluaciones') feDraft.vacios = 'ignorar';
    }
    rerender();
  }));

  container.querySelector('#fe-guardar')?.addEventListener('click', () => {
    if (!feDraft.campoId) { showError('Elige el campo.'); return; }
    const slot = mapa.slots.find(s => s.num === feNum);
    guardarRegla(fePos, feFicha, feNum, { ...feDraft, labelAlGuardar: slot.label });
    showSuccess(`Regla del nº ${feNum} guardada.`);
    feNum = null; feDraft = null;
    rerender();
  });
  container.querySelector('#fe-quitar')?.addEventListener('click', () => { guardarRegla(fePos, feFicha, feNum, null); feNum = null; feDraft = null; rerender(); });
  container.querySelector('#fe-cerrar')?.addEventListener('click', () => { feNum = null; feDraft = null; rerender(); });

  container.querySelector('#fe-sugeridas')?.addEventListener('click', () => {
    const todas = JSON.parse(JSON.stringify(state.fichaEspejoReglas || {}));
    todas[fePos] = todas[fePos] || {};
    todas[fePos][feFicha] = todas[fePos][feFicha] || {};
    let n = 0;
    mapa.slots.forEach(s => {
      if (todas[fePos][feFicha][s.num]) return;
      const r = reglaSugerida(s);
      if (r) { todas[fePos][feFicha][s.num] = r; n++; }
    });
    setState({ fichaEspejoReglas: todas });
    showSuccess(`${n} reglas sugeridas añadidas.`);
    rerender();
  });
}
