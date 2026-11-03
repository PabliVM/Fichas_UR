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
  multiFactor, TotpMultiFactorGenerator, getMultiFactorResolver,
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
 * @returns {boolean|null} true si se creó; false si ya existía; null si el proyecto no deja crear
 *   cuentas desde la web (Authentication › Ajustes › Acciones de usuario: registro desactivado)
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
    if (err?.code === 'auth/admin-restricted-operation') return null;
    throw err;
  }
}

// ── DOBLE VERIFICACIÓN (TOTP: app autenticadora, código de 6 dígitos) ──
// Requiere Firebase con Identity Platform y TOTP activado (ver SEGURIDAD.md).

export const tieneDobleFactor = user => multiFactor(user).enrolledFactors.length > 0;

/** Paso 1 del alta: genera la clave secreta. Devuelve { secret, url (otpauth:// para el QR), clave (texto) }. */
export async function iniciarAltaTotp(user) {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return { secret, url: secret.generateQrCodeUrl(user.email, 'RM Perfiles'), clave: secret.secretKey };
}

/** Paso 2 del alta: confirma con el primer código de la app. */
export async function completarAltaTotp(user, secret, codigo) {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, codigo);
  await multiFactor(user).enroll(assertion, 'App autenticadora');
}

/**
 * Login con doble verificación: si signIn lanza 'auth/multi-factor-auth-required', esto
 * devuelve una función que termina el login con el código de 6 dígitos.
 */
export function resolverDobleFactor(err) {
  const resolver = getMultiFactorResolver(getAuthInstance(), err);
  const hint = resolver.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) || resolver.hints[0];
  return codigo => resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, codigo));
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
