// ================================================
// ADMIN-PANEL.JS — Panel Super admin
// Alta de usuarios y tabla de permisos (Oculta / Ver / Editar)
// por pantalla y subpantalla, una columna por usuario.
// Colección 'usuarios', id = email en minúsculas.
// También: registro de actividad (colección 'auditoria') y
// conservación de datos (jugadores sin plantilla reciente).
// ================================================

import { TABS } from './constants.js';
import { readCollection, saveDocument, deleteDocument, readRecent } from './firebase-service.js';
import { state, setState } from './state.js';
import { comprobarRed, reiniciarDobleFactor } from './seguridad.js';
import { exportarJugador, borrarJugadorCompleto } from './rgpd.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { crearCuenta, resetPassword } from './auth-service.js';
import { NIVELES, SUPERADMIN_EMAILS, SUBPANTALLAS, emailKey, clavesDe, nivelDePerfil, maxNivel } from './permisos-service.js';
import { showError, showSuccess, safeText } from './utils.js';

const NIVEL_LABEL = { oculta: 'Oculta', ver: 'Ver', editar: 'Editar' };
// Horario de acceso: { dias: [1..7] (1 = lunes), desde, hasta } en minutos del día, hora de Madrid. null = sin límite.
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const aMin = t => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function accesoHTML(u) {
  const id = safeText(u.id), h = u.horario;
  const lbl = 'class="text-xs" style="display:flex;gap:4px;align-items:center;font-weight:400;margin-top:4px;"';
  return `
    <label ${lbl} title="Solo puede entrar conectado a una red registrada en Super admin › Redes del club"><input type="checkbox" data-u="${id}" data-red ${u.exigeRed ? 'checked' : ''} /> Solo red del club</label>
    <label ${lbl}><input type="checkbox" data-u="${id}" data-hor-on ${h ? 'checked' : ''} /> Limitar horario</label>
    <div data-u="${id}" data-hor-box style="${h ? '' : 'display:none;'}font-weight:400;">
      <div style="display:flex;gap:3px;margin-top:2px;">${DIAS.map((d, i) => `<label class="text-xs" style="display:flex;flex-direction:column;align-items:center;"><input type="checkbox" data-u="${id}" data-hor-dia="${i + 1}" ${(h ? (h.dias || []).includes(i + 1) : i < 5) ? 'checked' : ''} />${d}</label>`).join('')}</div>
      <div style="display:flex;gap:3px;align-items:center;margin-top:2px;">
        <input class="input" type="time" data-u="${id}" data-hor-desde value="${hm(h?.desde ?? 480)}" style="padding:1px 3px;font-size:11px;width:78px;" />–
        <input class="input" type="time" data-u="${id}" data-hor-hasta value="${hm(h?.hasta ?? 1200)}" style="padding:1px 3px;font-size:11px;width:78px;" />
      </div>
    </div>`;
}
const ENTRADA = { jugadores: 'lista', plantillas: 'grid' }; // subpantalla por la que se entra a las demás
let usuariosCache = null;

let adminVista = 'usuarios'; // 'usuarios' | 'actividad' | 'conservacion'

export async function renderPanelAdmin(container) {
  const VISTAS = [['usuarios', 'Usuarios y permisos'], ['redes', 'Redes del club'], ['actividad', 'Registro de actividad'], ['conservacion', 'Conservación de datos']];
  container.innerHTML = `
    <div class="rm-sticky mb-16 flex gap-8" style="padding:6px 0;flex-wrap:wrap;">
      ${VISTAS.map(([k, l]) => `<button class="btn ${adminVista === k ? 'btn-primary' : 'btn-sm'}" data-adm-vista="${k}">${l}</button>`).join('')}
    </div>
    <div id="adm-sub"></div>`;
  container.querySelectorAll('[data-adm-vista]').forEach(b => b.addEventListener('click', () => { adminVista = b.dataset.admVista; renderPanelAdmin(container); }));
  const sub = container.querySelector('#adm-sub');
  if (adminVista === 'actividad') return renderActividad(sub);
  if (adminVista === 'redes') return renderRedes(sub);
  if (adminVista === 'conservacion') return renderConservacion(sub);
  return renderUsuarios(sub);
}

async function renderUsuarios(container) {
  if (isFirebaseUnconfigured()) {
    container.innerHTML = '<div class="card"><div class="card-body">Configura Firebase para gestionar usuarios.</div></div>';
    return;
  }
  if (!usuariosCache) {
    container.innerHTML = '<p class="text-xs text-muted">Cargando usuarios…</p>';
    try { usuariosCache = await readCollection('usuarios'); }
    catch (err) { console.error('[Admin] Usuarios:', err); showError('No se pudieron cargar los usuarios (revisa las reglas de Firestore).'); usuariosCache = []; }
  }
  const usuarios = usuariosCache.filter(u => !SUPERADMIN_EMAILS.includes(u.id)).sort((a, b) => a.id.localeCompare(b.id)); // los super admin solo tienen doc por el aviso de privacidad
  const opciones = (actual, conMixto) =>
    (conMixto ? `<option value="" ${actual === '' ? 'selected' : ''}>—</option>` : '') +
    NIVELES.map(n => `<option value="${n}" ${n === actual ? 'selected' : ''}>${NIVEL_LABEL[n]}</option>`).join('');
  const mixto = (u, tabKey) => { const v = clavesDe(tabKey).map(c => nivelDePerfil({ ...u, activo: true }, c)); return v.every(x => x === v[0]) ? v[0] : ''; };
  const STICKY = 'position:sticky;left:0;z-index:1;background:var(--bg-surface);';
  const celda = 'padding:4px 6px;';
  const sel = 'padding:2px 4px;font-size:12px;min-width:84px;';

  const filas = TABS.map(t => {
    const subs = SUBPANTALLAS[t.key] || [];
    const cab = `
      <tr style="background:var(--bg-hover);">
        <td style="${STICKY}${celda}background:var(--bg-hover);font-weight:700;">${safeText(t.label)}${subs.length ? ' <span class="text-xs text-muted">(toda la pestaña)</span>' : ''}</td>
        ${usuarios.map(u => `<td style="${celda}">${subs.length
          ? `<select class="select" style="${sel}" data-u="${safeText(u.id)}" data-grupo="${t.key}">${opciones(mixto(u, t.key), true)}</select>`
          : `<select class="select" style="${sel}" data-u="${safeText(u.id)}" data-clave="${t.key}">${opciones(nivelDePerfil({ ...u, activo: true }, t.key))}</select>`}</td>`).join('')}
      </tr>`;
    return cab + subs.map(sp => {
      const clave = `${t.key}.${sp.key}`;
      return `
      <tr>
        <td style="${STICKY}${celda}padding-left:22px;">${safeText(sp.label)}</td>
        ${usuarios.map(u => `<td style="${celda}"><select class="select" style="${sel}" data-u="${safeText(u.id)}" data-clave="${clave}" data-de="${t.key}">${opciones(nivelDePerfil({ ...u, activo: true }, clave))}</select></td>`).join('')}
      </tr>`;
    }).join('');
  }).join('');

  container.innerHTML = `
    <div class="card mb-16">
      <div class="card-title">Añadir usuario</div>
      <div class="card-body">
        <div class="flex gap-8" style="flex-wrap:wrap;align-items:center;">
          <input class="input" type="email" id="adm-email" placeholder="Email" style="min-width:240px;" />
          <input class="input" type="text" id="adm-nombre" placeholder="Nombre (opcional)" />
          <button class="btn btn-primary" id="adm-add">Añadir</button>
        </div>
        <p class="text-xs text-muted" style="margin-top:8px;">Si el email no tiene cuenta se crea y se le envía un email para poner su contraseña. Entra sin pantallas: asígnaselas abajo y pulsa Guardar.</p>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Permisos por pantalla</div>
      <div class="card-body">
        <p class="text-xs text-muted mb-8">Super admin: ${safeText(SUPERADMIN_EMAILS.join(', '))} (acceso total, no aparece aquí). Oculta = no la ve · Ver = solo lectura · Editar = puede guardar.
          La fila de cada pestaña cambia de golpe todas sus subpantallas. Para entrar en una ficha o en Datos/Presentación hace falta ver el listado: se pone en "Ver" solo si hace falta.
          Los cambios se aplican cuando el usuario recarga la página.</p>
        ${usuarios.length ? `
        <div class="flex gap-8 mb-8"><button class="btn btn-primary adm-guardar" disabled>Guardar cambios</button></div>
        <div style="overflow:auto;max-height:70vh;border:1px solid var(--border-default);border-radius:var(--radius-md);">
          <table class="table" style="font-size:12px;width:auto;">
            <thead style="position:sticky;top:0;z-index:2;background:var(--bg-surface);">
              <tr>
                <th style="${STICKY}${celda}z-index:3;min-width:240px;">Pantalla</th>
                ${usuarios.map(u => `
                <th style="${celda}text-transform:none;letter-spacing:0;vertical-align:top;min-width:120px;">
                  <div style="font-weight:700;color:var(--text-primary);">${safeText(u.nombre || u.id.split('@')[0])}</div>
                  <div class="text-xs text-muted" style="font-weight:400;">${safeText(u.id)}</div>
                  <label class="text-xs" style="display:flex;gap:4px;align-items:center;font-weight:400;margin-top:4px;"><input type="checkbox" data-u="${safeText(u.id)}" data-activo ${u.activo === false ? '' : 'checked'} /> Activo</label>
                  ${accesoHTML(u)}
                  <div style="margin-top:4px;white-space:nowrap;">
                    <button class="btn btn-sm" data-reset="${safeText(u.id)}" title="Enviar email para poner/cambiar contraseña">✉</button>
                    <button class="btn btn-sm" data-mfa-reset="${safeText(u.id)}" title="Ha perdido el móvil: al entrar volverá a escanear un QR">🔑</button>
                    <button class="btn btn-sm" data-borrar="${safeText(u.id)}" title="Quitar acceso">×</button>
                  </div>
                </th>`).join('')}
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
        <div class="flex gap-8 mt-16"><button class="btn btn-primary adm-guardar" disabled>Guardar cambios</button></div>` : '<p class="text-sm text-muted">Aún no hay usuarios.</p>'}
      </div>
    </div>
  `;

  // Cambios pendientes por usuario (se guardan todos juntos con "Guardar cambios").
  const pendientes = new Set();
  const marcar = id => {
    pendientes.add(id);
    container.querySelectorAll('.adm-guardar').forEach(b => { b.disabled = false; b.textContent = `Guardar cambios (${pendientes.size} usuario${pendientes.size === 1 ? '' : 's'})`; });
  };
  const selDe = (id, attr, v) => [...container.querySelectorAll(`select[${attr}="${v}"]`)].filter(s => s.dataset.u === id);
  container.querySelectorAll('select[data-grupo]').forEach(g => g.addEventListener('change', () => {
    if (!g.value) return;
    selDe(g.dataset.u, 'data-de', g.dataset.grupo).forEach(s => { s.value = g.value; });
    marcar(g.dataset.u);
  }));
  container.querySelectorAll('select[data-clave]').forEach(s => s.addEventListener('change', () => {
    if (s.dataset.de) {
      const hijos = selDe(s.dataset.u, 'data-de', s.dataset.de).map(x => x.value);
      const g = selDe(s.dataset.u, 'data-grupo', s.dataset.de)[0];
      if (g) g.value = hijos.every(x => x === hijos[0]) ? hijos[0] : '';
    }
    marcar(s.dataset.u);
  }));
  container.querySelectorAll('[data-activo]').forEach(cb => cb.addEventListener('change', () => marcar(cb.dataset.u)));
  const elDe = (id, sel) => [...container.querySelectorAll(sel)].filter(x => x.dataset.u === id);
  container.querySelectorAll('[data-red], [data-hor-dia], [data-hor-desde], [data-hor-hasta]').forEach(el => el.addEventListener('change', () => marcar(el.dataset.u)));
  container.querySelectorAll('[data-hor-on]').forEach(cb => cb.addEventListener('change', () => {
    elDe(cb.dataset.u, '[data-hor-box]')[0].style.display = cb.checked ? '' : 'none';
    marcar(cb.dataset.u);
  }));

  container.querySelectorAll('.adm-guardar').forEach(btn => btn.addEventListener('click', async () => {
    const ids = [...pendientes];
    container.querySelectorAll('.adm-guardar').forEach(b => { b.disabled = true; b.textContent = 'Guardando…'; });
    const fallos = [];
    for (const id of ids) {
      const permisos = {};
      container.querySelectorAll('select[data-clave]').forEach(s => { if (s.dataset.u === id) permisos[s.dataset.clave] = s.value; });
      // Jugadores/Plantillas: las demás subpantallas se abren desde el listado.
      Object.entries(ENTRADA).forEach(([tab, sub]) => {
        const k = `${tab}.${sub}`;
        if (permisos[k] === 'oculta' && clavesDe(tab).some(c => permisos[c] !== 'oculta')) permisos[k] = 'ver';
      });
      const tabs = Object.fromEntries(TABS.map(t => [t.key, maxNivel(clavesDe(t.key).map(c => permisos[c]))]));
      const activo = [...container.querySelectorAll('[data-activo]')].find(c => c.dataset.u === id)?.checked !== false;
      const exigeRed = !!elDe(id, '[data-red]')[0]?.checked;
      let horario = null;
      if (elDe(id, '[data-hor-on]')[0]?.checked) {
        horario = {
          dias: elDe(id, '[data-hor-dia]').filter(c => c.checked).map(c => Number(c.dataset.horDia)),
          desde: aMin(elDe(id, '[data-hor-desde]')[0].value),
          hasta: aMin(elDe(id, '[data-hor-hasta]')[0].value),
        };
        if (!horario.dias.length || horario.desde >= horario.hasta) { fallos.push(`${id} (horario: elige días y una hora de fin posterior a la de inicio)`); continue; }
      }
      try {
        await saveDocument('usuarios', id, { permisos, tabs, activo, exigeRed, horario }, { merge: true });
        Object.assign(usuariosCache.find(u => u.id === id), { permisos, tabs, activo, exigeRed, horario });
      } catch (err) { console.error('[Admin] Guardar:', id, err); fallos.push(id); }
    }
    renderUsuarios(container);
    if (fallos.length) showError(`No se pudieron guardar: ${fallos.join(', ')}`);
    else showSuccess('Permisos guardados. Se aplican cuando el usuario recargue la página.');
  }));

  container.querySelector('#adm-add').addEventListener('click', async () => {
    const email = emailKey(container.querySelector('#adm-email').value);
    const nombre = container.querySelector('#adm-nombre').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError('Email no válido.'); return; }
    if (SUPERADMIN_EMAILS.includes(email)) { showError('Ese es el super admin.'); return; }
    if (usuariosCache.some(u => u.id === email)) { showError('Ese usuario ya está en la lista.'); return; }
    try {
      const permisos = Object.fromEntries(TABS.flatMap(t => clavesDe(t.key)).map(c => [c, 'oculta']));
      const data = { email, nombre, activo: true, permisos, tabs: Object.fromEntries(TABS.map(t => [t.key, 'oculta'])) };
      await saveDocument('usuarios', email, data);
      usuariosCache.push({ id: email, ...data });
      renderUsuarios(container);
      const nueva = await crearCuenta(email);
      if (nueva) await resetPassword(email);
      if (nueva === null) showSuccess('Usuario añadido. Falta crear su cuenta de login: Firebase Console › Authentication › Añadir usuario (con este email y una contraseña cualquiera); luego pulsa ✉ en su fila para que ponga la suya.', 15000);
      else showSuccess(nueva ? 'Usuario creado. Se le ha enviado un email para poner su contraseña.' : 'Usuario añadido (ya tenía cuenta).');
    } catch (err) {
      console.error('[Admin] Alta:', err);
      showError('No se pudo añadir el usuario: ' + (err.message || err));
    }
  });

  container.querySelectorAll('[data-mfa-reset]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.mfaReset;
    if (!confirm(`¿Reiniciar la verificación en dos pasos de ${id}? La próxima vez que entre tendrá que escanear un QR nuevo con su móvil.`)) return;
    const r = await reiniciarDobleFactor(id);
    if (r.ok) showSuccess('Verificación reiniciada.'); else showError('No se pudo reiniciar: ' + (r.error || r.status));
  }));
  container.querySelectorAll('[data-reset]').forEach(btn => btn.addEventListener('click', async () => {
    try { await resetPassword(btn.dataset.reset); showSuccess('Email enviado.'); }
    catch (err) { console.error('[Admin] Reset:', err); showError('No se pudo enviar el email.'); }
  }));

  container.querySelectorAll('[data-borrar]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.borrar;
    if (!confirm(`¿Quitar el acceso a ${id}? Su cuenta de login sigue existiendo, pero no verá nada.`)) return;
    try {
      await deleteDocument('usuarios', id);
      usuariosCache = usuariosCache.filter(u => u.id !== id);
      renderUsuarios(container);
    } catch (err) { console.error('[Admin] Borrar:', err); showError('No se pudo quitar el usuario.'); }
  }));
}

// ── REGISTRO DE ACTIVIDAD ─────────────────────────
// Últimas entradas de 'auditoria' (quién entra, qué ve, qué cambia). Solo lectura: nadie puede modificarlas.
let actividadCache = null;
const actFiltro = { email: '', accion: '' };
const fechaTxt = f => (f?.seconds ? new Date(f.seconds * 1000).toLocaleString('es-ES') : '');

async function renderActividad(container) {
  if (isFirebaseUnconfigured()) { container.innerHTML = '<p class="text-sm text-muted">Configura Firebase.</p>'; return; }
  if (!actividadCache) {
    container.innerHTML = '<p class="text-xs text-muted">Cargando actividad…</p>';
    try { actividadCache = await readRecent('auditoria', 'fecha', 1000); }
    catch (err) { console.error('[Admin] Actividad:', err); showError('No se pudo leer el registro (revisa las reglas de Firestore para "auditoria").'); actividadCache = []; }
  }
  const emails = [...new Set(actividadCache.map(a => a.email))].sort();
  const acciones = [...new Set(actividadCache.map(a => a.accion))].sort();
  const lista = actividadCache.filter(a => (!actFiltro.email || a.email === actFiltro.email) && (!actFiltro.accion || a.accion === actFiltro.accion));
  container.innerHTML = `
    <div class="card">
      <div class="card-title">Registro de actividad (últimas ${actividadCache.length} entradas)</div>
      <div class="card-body">
        <div class="flex gap-8 mb-8" style="flex-wrap:wrap;align-items:center;">
          <select class="select" id="act-email"><option value="">Todos los usuarios</option>${emails.map(e => `<option ${e === actFiltro.email ? 'selected' : ''}>${safeText(e)}</option>`).join('')}</select>
          <select class="select" id="act-accion"><option value="">Todas las acciones</option>${acciones.map(a => `<option ${a === actFiltro.accion ? 'selected' : ''}>${safeText(a)}</option>`).join('')}</select>
          <button class="btn btn-sm" id="act-recargar">Actualizar</button>
          <button class="btn btn-sm" id="act-csv">⬇ Exportar CSV</button>
        </div>
        <div style="overflow:auto;max-height:65vh;">
          <table class="table table-compact">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
            <tbody>${lista.map(a => `<tr><td style="white-space:nowrap;">${fechaTxt(a.fecha)}</td><td>${safeText(a.email)}</td><td>${safeText(a.accion)}</td><td>${safeText(a.detalle || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">Sin actividad.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  container.querySelector('#act-email').addEventListener('change', e => { actFiltro.email = e.target.value; renderActividad(container); });
  container.querySelector('#act-accion').addEventListener('change', e => { actFiltro.accion = e.target.value; renderActividad(container); });
  container.querySelector('#act-recargar').addEventListener('click', () => { actividadCache = null; renderActividad(container); });
  container.querySelector('#act-csv').addEventListener('click', () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Fecha;Usuario;Acción;Detalle', ...lista.map(a => [fechaTxt(a.fecha), a.email, a.accion, a.detalle].map(esc).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    const enlace = Object.assign(document.createElement('a'), { href: url, download: `actividad-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(enlace); enlace.click(); enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// ── CONSERVACIÓN DE DATOS ─────────────────────────
// Jugadores sin plantilla en las últimas N temporadas: se avisan aquí y el super admin decide si los borra. Nada se borra solo.
let consTemporadas = 2;
let consSeleccion = new Set();
const inicioTemporada = t => parseInt(String(t || '').slice(0, 4), 10);

async function renderConservacion(container) {
  if (isFirebaseUnconfigured()) { container.innerHTML = '<p class="text-sm text-muted">Configura Firebase.</p>'; return; }
  container.innerHTML = '<p class="text-xs text-muted">Calculando…</p>';
  let plantillas = [];
  try { plantillas = await readCollection('plantillas'); }
  catch (err) { console.error('[Admin] Plantillas:', err); showError('No se pudieron leer las plantillas.'); }
  const ultima = {}; // jugadorId → año de inicio de su última temporada en una plantilla
  plantillas.forEach(p => {
    const anio = inicioTemporada(p.temporada || p.id.split('__')[0]);
    if (Number.isNaN(anio)) return;
    (p.jugadorIds || []).forEach(id => { if (!(ultima[id] >= anio)) ultima[id] = anio; });
  });
  const actual = inicioTemporada(state.season);
  const candidatos = state.players.map(j => {
    const alta = j.createdAt?.seconds ? new Date(j.createdAt.seconds * 1000).getFullYear() : null;
    return { j, ultima: ultima[j.id] ?? null, ref: ultima[j.id] ?? alta }; // sin plantilla nunca: cuenta desde el alta
  }).filter(x => x.ref != null && actual - x.ref >= consTemporadas)
    .sort((a, b) => a.ref - b.ref);
  consSeleccion = new Set([...consSeleccion].filter(id => candidatos.some(c => c.j.id === id)));
  const nombre = j => `${j.apellidos || ''}, ${j.nombre || ''}`.replace(/^, |, $/g, '');

  container.innerHTML = `
    <div class="card">
      <div class="card-title">Conservación de datos</div>
      <div class="card-body">
        <p class="text-sm mb-8">Jugadores que no están en ninguna plantilla desde hace al menos
          <input class="input" type="number" min="1" max="20" id="cons-n" value="${consTemporadas}" style="width:64px;display:inline-block;" /> temporadas (respecto a ${safeText(state.season)}).
          Según el RGPD sus datos no deben guardarse más tiempo del necesario: exporta lo que haga falta conservar y bórralos. Nada se borra solo.</p>
        <div style="overflow:auto;max-height:60vh;">
          <table class="table table-compact">
            <thead><tr><th><input type="checkbox" id="cons-all" ${candidatos.length && consSeleccion.size === candidatos.length ? 'checked' : ''} /></th><th>Jugador</th><th>Última temporada en plantilla</th><th></th></tr></thead>
            <tbody>${candidatos.map(c => `
              <tr>
                <td><input type="checkbox" data-cons="${c.j.id}" ${consSeleccion.has(c.j.id) ? 'checked' : ''} /></td>
                <td>${safeText(nombre(c.j))}</td>
                <td>${c.ultima != null ? `${c.ultima}/${c.ultima + 1}` : `Nunca (alta en ${c.ref})`}</td>
                <td><button class="btn btn-sm" data-cons-exp="${c.j.id}">⬇ Exportar</button></td>
              </tr>`).join('') || '<tr><td colspan="4" class="text-muted">Ningún jugador supera el plazo.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="flex gap-8 mt-16"><button class="btn btn-primary" id="cons-borrar" ${consSeleccion.size ? '' : 'disabled'} style="background:#b91c1c;border-color:#b91c1c;">Borrar definitivamente (${consSeleccion.size})</button></div>
      </div>
    </div>`;
  container.querySelector('#cons-n').addEventListener('change', e => { consTemporadas = Math.max(1, parseInt(e.target.value, 10) || 2); renderConservacion(container); });
  container.querySelector('#cons-all')?.addEventListener('change', e => { consSeleccion = new Set(e.target.checked ? candidatos.map(c => c.j.id) : []); renderConservacion(container); });
  container.querySelectorAll('[data-cons]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) consSeleccion.add(cb.dataset.cons); else consSeleccion.delete(cb.dataset.cons);
    renderConservacion(container);
  }));
  container.querySelectorAll('[data-cons-exp]').forEach(b => b.addEventListener('click', async () => {
    const j = state.players.find(x => x.id === b.dataset.consExp);
    try { await exportarJugador(j); } catch (err) { console.error(err); showError('No se pudo exportar.'); }
  }));
  container.querySelector('#cons-borrar').addEventListener('click', async e => {
    const ids = [...consSeleccion];
    if (!confirm(`¿Borrar DEFINITIVAMENTE ${ids.length} jugador(es) con su ficha, histórico, evaluaciones y sitio en plantillas? No se puede deshacer.`)) return;
    e.currentTarget.disabled = true;
    const avisos = [], fallos = [];
    for (const id of ids) {
      try {
        avisos.push(...await borrarJugadorCompleto(id));
        setState({ players: state.players.filter(p => p.id !== id) });
      } catch (err) { console.error('[RGPD] Borrar', id, err); fallos.push(id); }
    }
    consSeleccion = new Set();
    renderConservacion(container);
    if (ids.length - fallos.length) showSuccess(`${ids.length - fallos.length} jugador(es) borrado(s).`);
    if (avisos.length) showError(`No se pudo borrar: ${[...new Set(avisos)].join(', ')}.`, 12000);
    if (fallos.length) showError(`Fallaron ${fallos.length} jugador(es).`, 12000);
  });
}

// ── REDES DEL CLUB ────────────────────────────────
// IPs públicas desde las que pueden entrar los usuarios marcados "Solo red del club". Se registran desde la propia red
// (el servidor ve la IP real; el navegador no puede falsearla). Colección 'redes', escrita por api/red.js.
async function renderRedes(container) {
  if (isFirebaseUnconfigured()) { container.innerHTML = '<p class="text-sm text-muted">Configura Firebase.</p>'; return; }
  container.innerHTML = '<p class="text-xs text-muted">Cargando…</p>';
  const [redes, aqui] = await Promise.all([
    readCollection('redes').catch(err => { console.error('[Admin] Redes:', err); return []; }),
    comprobarRed(),
  ]);
  container.innerHTML = `
    <div class="card">
      <div class="card-title">Redes del club</div>
      <div class="card-body">
        <p class="text-sm mb-8">Los usuarios con <b>Solo red del club</b> solo pueden entrar conectados a una de estas redes (WiFi o cable del club). Para añadir una, conéctate a ella y pulsa el botón.
          Si la red cambia de IP habrá que registrarla otra vez.</p>
        ${aqui.error === 'no-configurado'
          ? '<p class="text-sm" style="color:#ef4444;">El servidor no está configurado todavía (falta FIREBASE_SERVICE_ACCOUNT en Vercel, ver SEGURIDAD.md).</p>'
          : aqui.error ? `<p class="text-sm" style="color:#ef4444;">No se pudo consultar el servidor (${safeText(aqui.error)}).</p>`
          : `<p class="text-sm mb-8">Ahora estás conectado desde <code>${safeText(aqui.ip)}</code> ${aqui.ok ? '— <b style="color:#22c55e;">red registrada</b>' : '— no registrada'}</p>
             ${aqui.ok ? '' : `<div class="flex gap-8 mb-16" style="flex-wrap:wrap;"><input class="input" id="red-nombre" placeholder="Nombre (p. ej. WiFi Valdebebas)" /><button class="btn btn-primary" id="red-add">Registrar la red desde la que estoy</button></div>`}`}
        <table class="table table-compact">
          <thead><tr><th>Nombre</th><th>Red</th><th>Registrada</th><th></th></tr></thead>
          <tbody>${redes.map(r => `<tr><td>${safeText(r.nombre || '')}</td><td><code>${safeText(r.clave)}</code></td><td class="text-xs">${fechaTxt(r.fecha)} · ${safeText(r.por || '')}</td><td><button class="btn btn-sm" data-red-del="${safeText(r.id)}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">Ninguna red registrada.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  container.querySelector('#red-add')?.addEventListener('click', async () => {
    const r = await comprobarRed('registrar', container.querySelector('#red-nombre').value.trim());
    if (r.ok) showSuccess('Red registrada.'); else showError('No se pudo registrar: ' + (r.error || 'error'));
    renderRedes(container);
  });
  container.querySelectorAll('[data-red-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('¿Quitar esta red? Los usuarios con "Solo red del club" ya no podrán entrar desde ella.')) return;
    try { await deleteDocument('redes', b.dataset.redDel); } catch (err) { console.error(err); showError('No se pudo quitar.'); }
    renderRedes(container);
  }));
}
