// ================================================
// FIREBASE-CONFIG.JS — Credenciales Firebase
// Sustituir los placeholders antes de usar.
// ================================================

export const firebaseConfig = {
  apiKey:            'TU_API_KEY',
  authDomain:        'TU_AUTH_DOMAIN',
  projectId:         'TU_PROJECT_ID',
  storageBucket:     'TU_STORAGE_BUCKET',
  messagingSenderId: 'TU_MESSAGING_SENDER_ID',
  appId:             'TU_APP_ID',
};

/**
 * Devuelve true si las credenciales siguen siendo placeholders.
 */
export function isFirebaseUnconfigured() {
  return firebaseConfig.apiKey === 'TU_API_KEY';
}
