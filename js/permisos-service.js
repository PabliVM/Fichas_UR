// ================================================
// PERMISOS-SERVICE.JS — Acceso por pantalla
// Perfil en usuarios/{email en minúsculas}:
//   { email, nombre, activo,
//     permisos: { 'registro.bbdd': 'oculta'|'ver'|'editar', 'sucesion': ..., ... },  ← por (sub)pantalla
//     tabs:     { registro: ..., ... } }  ← resumen por pestaña (el máximo); lo usan firestore.rules
// Los super admin (SUPERADMIN_EMAILS) ve y edita todo y tiene la pestaña
// "Super admin". Sin perfil (o activo:false) = sin acceso.
// Esto solo filtra la interfaz: la protección real son firestore.rules.
// ================================================

import { TABS } from './constants.js';
import { readDocument } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';

export const SUPERADMIN_EMAILS = ['pablo.vegamartin@gmail.com', 'pvega@realmadrid.es'];
export const ADMIN_TAB = { key: 'admin', label: 'Super admin' };
export const NIVELES = ['oculta', 'ver', 'editar'];

let _perfil = null;
let _super  = false;

export const emailKey = email => String(email || '').trim().toLowerCase();

export async function cargarPerfil(user) {
  _super = isFirebaseUnconfigured() || SUPERADMIN_EMAILS.includes(emailKey(user?.email));
  _perfil = null;
  if (_super) return;
  try { _perfil = await readDocument('usuarios', emailKey(user.email)); }
  catch (err) { console.error('[Permisos] No se pudo leer el perfil:', err); }
}

export const esSuperadmin = () => _super;

// Subpantallas de cada pestaña (mantener en sintonía con los botones de app.js: registroSubTab,
// jugFichaTab, plVista.modo y CONFIG_GROUPS). La primera de Jugadores y Plantillas es la de entrada.
export const SUBPANTALLAS = {
  registro: [
    { key: 'registro', label: 'Registro' },
    { key: 'bbdd', label: 'BBDD' },
    { key: 'comparativas', label: 'Comparativas' },
  ],
  jugadores: [
    { key: 'lista', label: 'Listado (añadir, importar, editar, borrar)' },
    { key: 'datos', label: 'Ficha › Datos personales' },
    { key: 'fichas', label: 'Ficha › Ficha 1 y Ficha 2' },
  ],
  plantillas: [
    { key: 'grid', label: 'Equipos (listado)' },
    { key: 'datos', label: 'Datos del equipo' },
    { key: 'pres', label: 'Presentación de fichas' },
  ],
  sucesion: [],
  config: [
    { key: 'posiciones', label: 'Contenido › Posiciones' },
    { key: 'items', label: 'Contenido › Aspectos' },
    { key: 'colores', label: 'Contenido › Rango de colores' },
    { key: 'condicional-refs', label: 'Contenido › Datos condicionales' },
    { key: 'fichas-individual', label: 'Fichas tipo › Individual' },
    { key: 'columnas-encuesta', label: 'Fichas tipo › Columnas encuesta' },
    { key: 'fichas-espejo', label: 'Fichas tipo › Fichas Espejo' },
    { key: 'fichas-campograma', label: 'Fichas tipo › Campograma' },
    { key: 'fichas-mapa-nivel', label: 'Fichas tipo › Mapa de nivel' },
    { key: 'ficha-colores', label: 'Diseño › Colores de la ficha' },
    { key: 'ficha-matriz', label: 'Diseño › Matriz' },
    { key: 'dimensiones', label: 'Diseño › Dimensiones' },
    { key: 'flujo', label: 'Ayuda › Flujo de evaluaciones' },
    { key: 'frases', label: 'Ayuda › Frases modelo' },
    { key: 'copia-seguridad', label: 'Ayuda › Copia de seguridad' },
  ],
};

/** Claves de permiso de una pestaña: 'registro.bbdd', … o la propia pestaña si no tiene subpantallas. */
export const clavesDe = tabKey => (SUBPANTALLAS[tabKey] || []).length ? SUBPANTALLAS[tabKey].map(s => `${tabKey}.${s.key}`) : [tabKey];

export const maxNivel = lista => lista.reduce((m, n) => (NIVELES.indexOf(n) > NIVELES.indexOf(m) ? n : m), 'oculta');

/** Nivel de un perfil para una clave ('config.items') o una pestaña ('config' = la subpantalla más alta). */
export function nivelDePerfil(perfil, clave) {
  if (!perfil || perfil.activo === false) return 'oculta';
  const tab = clave.split('.')[0];
  if (!clave.includes('.') && (SUBPANTALLAS[tab] || []).length) return maxNivel(clavesDe(tab).map(c => nivelDePerfil(perfil, c)));
  const n = perfil.permisos?.[clave] ?? perfil.tabs?.[tab]; // perfiles antiguos: solo nivel por pestaña
  return NIVELES.includes(n) ? n : 'oculta';
}

export function nivel(clave) {
  if (_super) return 'editar';
  return nivelDePerfil(_perfil, clave);
}

export const puedeVer    = clave => nivel(clave) !== 'oculta';
export const puedeEditar = clave => nivel(clave) === 'editar';

export function tabsVisibles() {
  const tabs = TABS.filter(t => puedeVer(t.key));
  return _super ? [...tabs, ADMIN_TAB] : tabs;
}
