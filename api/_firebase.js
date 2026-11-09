// Utilidades comunes de las funciones de Vercel (el "_" hace que Vercel no lo publique como ruta).
import admin from 'firebase-admin';

export const SUPERADMIN_EMAILS = ['pablo.vegamartin@gmail.com', 'pvega@realmadrid.es']; // igual que js/permisos-service.js
export const configurado = () => !!process.env.FIREBASE_SERVICE_ACCOUNT;

export function firebase() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin;
}

/** Usuario de la petición (token de Firebase en Authorization: Bearer …) o null. */
export async function usuarioDe(req) {
  try { return await firebase().auth().verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); }
  catch (_) { return null; }
}

/** Añade/cambia permisos especiales de la cuenta sin borrar los demás (redHasta, mfaAuthTime…). */
export async function fijarClaims(uid, cambios) {
  const actual = (await firebase().auth().getUser(uid)).customClaims || {};
  await firebase().auth().setCustomUserClaims(uid, { ...actual, ...cambios });
}
