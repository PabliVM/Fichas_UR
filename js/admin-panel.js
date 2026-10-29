// ================================================
// ADMIN-PANEL.JS — Panel Super admin
// Alta de usuarios y tabla de permisos (Oculta / Ver / Editar)
// por pantalla y subpantalla, una columna por usuario.
// Colección 'usuarios', id = email en minúsculas.
// ================================================

import { TABS } from './constants.js';
import { readCollection, saveDocument, deleteDocument } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { crearCuenta, resetPassword } from './auth-service.js';
import { NIVELES, SUPERADMIN_EMAILS, SUBPANTALLAS, emailKey, clavesDe, nivelDePerfil, maxNivel } from './permisos-service.js';
import { showError, showSuccess, safeText } from './utils.js';

const NIVEL_LABEL = { oculta: 'Oculta', ver: 'Ver', editar: 'Editar' };
const ENTRADA = { jugadores: 'lista', plantillas: 'grid' }; // subpantalla por la que se entra a las demás
let usuariosCache = null;

export async function renderPanelAdmin(container) {
  if (isFirebaseUnconfigured()) {
    container.innerHTML = '<div class="card"><div class="card-body">Configura Firebase para gestionar usuarios.</div></div>';
    return;
  }
  if (!usuariosCache) {
    container.innerHTML = '<p class="text-xs text-muted">Cargando usuarios…</p>';
    try { usuariosCache = await readCollection('usuarios'); }
    catch (err) { console.error('[Admin] Usuarios:', err); showError('No se pudieron cargar los usuarios (revisa las reglas de Firestore).'); usuariosCache = []; }
  }
  const usuarios = [...usuariosCache].sort((a, b) => a.id.localeCompare(b.id));
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
                  <div style="margin-top:4px;white-space:nowrap;">
                    <button class="btn btn-sm" data-reset="${safeText(u.id)}" title="Enviar email para poner/cambiar contraseña">✉</button>
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
      try {
        await saveDocument('usuarios', id, { permisos, tabs, activo }, { merge: true });
        Object.assign(usuariosCache.find(u => u.id === id), { permisos, tabs, activo });
      } catch (err) { console.error('[Admin] Guardar:', id, err); fallos.push(id); }
    }
    renderPanelAdmin(container);
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
      renderPanelAdmin(container);
      const nueva = await crearCuenta(email);
      if (nueva) await resetPassword(email);
      if (nueva === null) showSuccess('Usuario añadido. Falta crear su cuenta de login: Firebase Console › Authentication › Añadir usuario (con este email y una contraseña cualquiera); luego pulsa ✉ en su fila para que ponga la suya.', 15000);
      else showSuccess(nueva ? 'Usuario creado. Se le ha enviado un email para poner su contraseña.' : 'Usuario añadido (ya tenía cuenta).');
    } catch (err) {
      console.error('[Admin] Alta:', err);
      showError('No se pudo añadir el usuario: ' + (err.message || err));
    }
  });

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
      renderPanelAdmin(container);
    } catch (err) { console.error('[Admin] Borrar:', err); showError('No se pudo quitar el usuario.'); }
  }));
}
