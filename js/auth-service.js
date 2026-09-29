// ================================================
// AUTH-SERVICE.JS — Login con email/contraseña
// (Firebase Auth). Gate mínimo: cualquier usuario
// autenticado tiene acceso completo — sin roles
// todavía (no se ha pedido esa funcionalidad).
// Si Firebase no está configurado, se comporta como
// "siempre autenticado" — igual que el resto del app
// en modo local/sin credenciales.
// ================================================

import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initFirebase, getFirebaseApp } from './firebase-service.js';
import { isFirebaseUnconfigured } from './firebase-config.js';

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
