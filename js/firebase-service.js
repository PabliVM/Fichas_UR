// ================================================
// FIREBASE-SERVICE.JS — Operaciones Firestore
// Usa CDN ESM. Compatible con Vercel sin bundler.
// SIN fallback local. Si falla, lanza error.
// ================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { firebaseConfig, isFirebaseUnconfigured } from './firebase-config.js';

let _app = null;
let _db  = null;

// ── INIT ────────────────────────────────────────

export function initFirebase() {
  if (isFirebaseUnconfigured()) {
    console.warn('[Firebase] Credenciales sin configurar. Firestore desactivado.');
    return false;
  }
  if (!_app) {
    _app = initializeApp(firebaseConfig);
    _db  = getFirestore(_app);
  }
  return true;
}

export function getDB() {
  if (!_db) throw new Error('Firebase no inicializado. Llama a initFirebase() primero.');
  return _db;
}

// ── CRUD BASE ────────────────────────────────────

/**
 * Escucha una colección en tiempo real.
 * @param {string}   collectionName
 * @param {Function} callback  (docs[]) => void
 * @param {Function} onError   (err) => void
 * @returns {Function} unsubscribe
 */
export function listenCollection(collectionName, callback, onError) {
  const db = getDB();
  return onSnapshot(
    collection(db, collectionName),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err  => onError(err),
  );
}

/**
 * Guarda (crea o sobreescribe) un documento con ID conocido.
 */
export async function saveDocument(collectionName, documentId, data) {
  const db = getDB();
  await setDoc(doc(db, collectionName, documentId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Añade un documento con ID generado por Firestore.
 * @returns {string} ID del documento creado
 */
export async function addDocument(collectionName, data) {
  const db  = getDB();
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Actualiza campos concretos de un documento existente.
 */
export async function updateDocument(collectionName, documentId, patch) {
  const db = getDB();
  await updateDoc(doc(db, collectionName, documentId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Elimina un documento.
 */
export async function deleteDocument(collectionName, documentId) {
  const db = getDB();
  await deleteDoc(doc(db, collectionName, documentId));
}

/**
 * Lee un documento una sola vez.
 * @returns {Object|null}
 */
export async function readDocument(collectionName, documentId) {
  const db   = getDB();
  const snap = await getDoc(doc(db, collectionName, documentId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
