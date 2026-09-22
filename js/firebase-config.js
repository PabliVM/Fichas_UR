// ================================================
// FIREBASE-CONFIG.JS — Credenciales Firebase
// Sustituir los placeholders antes de usar.
// ================================================

export const firebaseConfig = {
  apiKey:            'AIzaSyAllp03rHd98dUAtHL8YHNrqRxR5VT5Cs0',
  authDomain:        'fichasur-f9d61.firebaseapp.com',
  projectId:         'fichasur-f9d61',
  storageBucket:     'fichasur-f9d61.firebasestorage.app',
  messagingSenderId: '1093958036122',
  appId:             '1:1093958036122:web:5f72454086c11b7afc8d23',
};

/**
 * Devuelve true si las credenciales siguen siendo placeholders.
 */
export function isFirebaseUnconfigured() {
  return firebaseConfig.apiKey === 'TU_API_KEY';
}
