// ================================================
// AUTH-SERVICE.JS — Login con email/contraseña
// (Firebase Auth). Qué ve cada usuario lo decide
// permisos-service.js.
// Si Firebase no está configurado, se comporta como
// "siempre autenticado" — igual que el resto del app
// en modo local/sin credenciales.
// ================================================

import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { initFirebase, getFirebaseApp } from './firebase-service.js';
import { firebaseConfig, isFirebaseUnconfigured } from './firebase-config.js';

let _auth = null;

function getAuthInstance() {
  if (!_auth) {
    initFirebase();
    _auth = getAuth(getFirebaseApp());
  }
  return _auth;
}

export function login(email, password) {
  return signInWithEmailAndPassword(getAuthInstance(), email, password);
}

export function logout() {
  return signOut(getAuthInstance());
}

export function resetPassword(email) {
  return sendPasswordResetEmail(getAuthInstance(), email);
}

/**
 * Crea la cuenta de login de otra persona (panel Super admin) con una contraseña
 * aleatoria; luego se le envía el email de restablecer. Usa una segunda instancia
 * de Firebase para no cerrar la sesión del admin.
 * @returns {boolean} true si se creó; false si ya existía
 */
export async function crearCuenta(email) {
  const app2 = getApps().find(a => a.name === 'rm-alta') || initializeApp(firebaseConfig, 'rm-alta');
  const auth2 = getAuth(app2);
  try {
    await createUserWithEmailAndPassword(auth2, email, crypto.randomUUID() + 'Aa1!');
    await signOut(auth2);
    return true;
  } catch (err) {
    if (err?.code === 'auth/email-already-in-use') return false;
    throw err;
  }
}

/**
 * @param {(user: Object|null) => void} callback
 * @returns {Function} unsubscribe
 */
export function watchAuthState(callback) {
  if (isFirebaseUnconfigured()) {
    callback({ email: 'local (sin Firebase)' }); // modo local: siempre "autenticado"
    return () => {};
  }
  return onAuthStateChanged(getAuthInstance(), callback);
}
