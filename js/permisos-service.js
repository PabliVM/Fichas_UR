// ================================================
// PERMISOS-SERVICE.JS — Acceso por pantalla
// Perfil en usuarios/{email en minúsculas}:
//   { email, nombre, activo, tabs: { registro: 'oculta'|'ver'|'editar', ... } }
// El super admin (SUPERADMIN_EMAIL) ve y edita todo y tiene la pestaña
// "Super admin". Sin perfil (o activo:false) = sin acceso.
// Esto solo filtra la interfaz: la protección real son firestore.rules.
// ================================================

import { TABS } from './constants.js';
import { readDocument } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';

export const SUPERADMIN_EMAIL = 'pablo.vegamartin@gmail.com';
export const ADMIN_TAB = { key: 'admin', label: 'Super admin' };
export const NIVELES = ['oculta', 'ver', 'editar'];

let _perfil = null;
let _super  = false;

export const emailKey = email => String(email || '').trim().toLowerCase();

export async function cargarPerfil(user) {
  _super = isFirebaseUnconfigured() || emailKey(user?.email) === SUPERADMIN_EMAIL;
  _perfil = null;
  if (_super) return;
  try { _perfil = await readDocument('usuarios', emailKey(user.email)); }
  catch (err) { console.error('[Permisos] No se pudo leer el perfil:', err); }
}

export const esSuperadmin = () => _super;

export function nivel(tabKey) {
  if (_super) return 'editar';
  if (!_perfil || _perfil.activo === false) return 'oculta';
  const n = _perfil.tabs?.[tabKey];
  return NIVELES.includes(n) ? n : 'oculta';
}

export const puedeVer    = tabKey => nivel(tabKey) !== 'oculta';
export const puedeEditar = tabKey => nivel(tabKey) === 'editar';

export function tabsVisibles() {
  const tabs = TABS.filter(t => puedeVer(t.key));
  return _super ? [...tabs, ADMIN_TAB] : tabs;
}
