// Utilidades comunes de las funciones de Vercel (el "_" hace que Vercel no lo publique como ruta).
// No usa claves de cuenta de servicio (las políticas de Google Cloud pueden prohibirlas):
//  - los tokens de los usuarios se verifican con firebase-admin, que solo necesita el id del proyecto;
//  - para leer/escribir, el servidor entra con una cuenta normal de Firebase (SERVIDOR_EMAIL) cuya
//    contraseña está en Vercel (SERVIDOR_PASSWORD). Las reglas solo le dejan tocar mfa, sesiones y redes.
import admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore/lite';
import { firebaseConfig } from '../js/firebase-config.js';

export const SUPERADMIN_EMAILS = ['pablo.vegamartin@gmail.com', 'pvega@realmadrid.es']; // igual que js/permisos-service.js
export const SERVIDOR_EMAIL = 'servidor@fichasur-f9d61.firebaseapp.com';               // igual que firestore.rules
export const configurado = () => !!process.env.SERVIDOR_PASSWORD;
export const emailKey = e => String(e || '').trim().toLowerCase();
export { serverTimestamp };

/** Usuario de la petición (token de Firebase en Authorization: Bearer …) o null. */
export async function usuarioDe(req) {
  if (!admin.apps.length) admin.initializeApp({ projectId: firebaseConfig.projectId });
  try { return await admin.auth().verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); }
  catch (_) { return null; }
}

/** Firestore con la sesión de la cuenta servidor (se reutiliza entre peticiones mientras la función siga viva). */
async function db() {
  const app = getApps().find(a => a.name === 'servidor') || initializeApp(firebaseConfig, 'servidor');
  const auth = getAuth(app);
  if (!auth.currentUser) await signInWithEmailAndPassword(auth, SERVIDOR_EMAIL, process.env.SERVIDOR_PASSWORD);
  return getFirestore(app);
}

export async function leer(coleccion, id) {
  const snap = await getDoc(doc(await db(), coleccion, id));
  return snap.exists() ? snap.data() : null;
}
export async function guardar(coleccion, id, datos, merge = true) { await setDoc(doc(await db(), coleccion, id), datos, { merge }); }
export async function borrar(coleccion, id) { await deleteDoc(doc(await db(), coleccion, id)); }
