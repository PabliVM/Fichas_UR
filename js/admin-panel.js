// ================================================
// ADMIN-PANEL.JS — Panel Super admin
// Alta de usuarios y nivel por pantalla (Oculta / Ver / Editar).
// Colección 'usuarios', id = email en minúsculas.
// ================================================

import { TABS } from './constants.js';
import { readCollection, saveDocument, deleteDocument } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';
import { crearCuenta, resetPassword } from './auth-service.js';
import { NIVELES, SUPERADMIN_EMAILS, emailKey } from './permisos-service.js';
import { showError, showSuccess, safeText } from './utils.js';

const NIVEL_LABEL = { oculta: 'Oculta', ver: 'Ver', editar: 'Editar' };
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
  const selNivel = (id, tabKey, actual) => `
    <select class="select" data-u="${safeText(id)}" data-tab-nivel="${tabKey}">
      ${NIVELES.map(n => `<option value="${n}" ${n === (actual || 'oculta') ? 'selected' : ''}>${NIVEL_LABEL[n]}</option>`).join('')}
    </select>`;

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
      <div class="card-title">Usuarios y permisos</div>
      <div class="card-body" style="overflow-x:auto;">
        <p class="text-xs text-muted mb-16">Super admin: ${safeText(SUPERADMIN_EMAILS.join(', '))} (acceso total, no aparece aquí).</p>
        ${usuarios.length ? `
        <table class="table">
          <thead><tr><th>Usuario</th><th>Activo</th>${TABS.map(t => `<th>${safeText(t.label)}</th>`).join('')}<th></th></tr></thead>
          <tbody>
            ${usuarios.map(u => `
              <tr>
                <td><strong>${safeText(u.nombre || '')}</strong><br><span class="text-xs text-muted">${safeText(u.id)}</span></td>
                <td><input type="checkbox" data-u="${safeText(u.id)}" data-activo ${u.activo === false ? '' : 'checked'} /></td>
                ${TABS.map(t => `<td>${selNivel(u.id, t.key, u.tabs?.[t.key])}</td>`).join('')}
                <td style="white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" data-guardar="${safeText(u.id)}">Guardar</button>
                  <button class="btn btn-sm" data-reset="${safeText(u.id)}" title="Enviar email para poner/cambiar contraseña">✉</button>
                  <button class="btn btn-sm" data-borrar="${safeText(u.id)}" title="Quitar acceso">×</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="text-sm text-muted">Aún no hay usuarios.</p>'}
      </div>
    </div>
  `;

  container.querySelector('#adm-add').addEventListener('click', async () => {
    const email = emailKey(container.querySelector('#adm-email').value);
    const nombre = container.querySelector('#adm-nombre').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError('Email no válido.'); return; }
    if (SUPERADMIN_EMAILS.includes(email)) { showError('Ese es el super admin.'); return; }
    if (usuariosCache.some(u => u.id === email)) { showError('Ese usuario ya está en la lista.'); return; }
    try {
      const data = { email, nombre, activo: true, tabs: Object.fromEntries(TABS.map(t => [t.key, 'oculta'])) };
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

  container.querySelectorAll('[data-guardar]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.guardar;
    const fila = btn.closest('tr');
    const tabs = {};
    fila.querySelectorAll('[data-tab-nivel]').forEach(s => { tabs[s.dataset.tabNivel] = s.value; });
    const activo = fila.querySelector('[data-activo]').checked;
    try {
      await saveDocument('usuarios', id, { tabs, activo }, { merge: true });
      Object.assign(usuariosCache.find(u => u.id === id), { tabs, activo });
      showSuccess('Permisos guardados. Se aplican cuando el usuario recargue la página.');
    } catch (err) { console.error('[Admin] Guardar:', err); showError('No se pudieron guardar los permisos.'); }
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
      renderPanelAdmin(container);
    } catch (err) { console.error('[Admin] Borrar:', err); showError('No se pudo quitar el usuario.'); }
  }));
}
