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
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

import { firebaseConfig, isFirebaseUnconfigured } from './firebase-config.js';

let _app = null;
let _db  = null;
let _storage = null;

// ── INIT ────────────────────────────────────────

export function initFirebase() {
  if (isFirebaseUnconfigured()) {
    console.warn('[Firebase] Credenciales sin configurar. Firestore desactivado.');
    return false;
  }
  if (!_app) {
    _app     = initializeApp(firebaseConfig);
    _db      = getFirestore(_app);
    _storage = getStorage(_app);
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

/**
 * Lee TODOS los documentos de una colección una sola vez (sin listener).
 * @returns {Array<Object>}
 */
export async function readCollection(collectionName) {
  const db   = getDB();
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── SUBCOLECCIONES (ej. jugadores/{id}/historico) ─
// Genéricas: cualquier entidad con histórico (jugadores, y en el futuro
// otras) reutiliza esto en vez de tener su propia lógica de subcolección.

/**
 * Añade un documento a una subcolección de un documento padre.
 * @returns {string} ID del documento creado
 */
export async function addSubDocument(parentCollection, parentId, subCollection, data) {
  const db  = getDB();
  const ref = await addDoc(collection(db, parentCollection, parentId, subCollection), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Lee todos los documentos de una subcolección de un documento padre.
 * @returns {Array<Object>}
 */
export async function readSubCollection(parentCollection, parentId, subCollection) {
  const db   = getDB();
  const snap = await getDocs(collection(db, parentCollection, parentId, subCollection));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── STORAGE (fotos) ───────────────────────────────

function getStorageInstance() {
  if (!_storage) throw new Error('Firebase Storage no inicializado. Llama a initFirebase() primero.');
  return _storage;
}

/**
 * Sube la foto de un jugador (1 archivo por jugador, se sobrescribe al
 * cambiarla — nunca se acumulan copias) y devuelve su URL de descarga.
 * Esa misma URL es la que se guarda en jugadores/{id}.fotoUrl y se
 * reutiliza en perfil, Ficha 1, Ficha 2 e Informes — nunca se sube dos
 * veces la misma imagen para pantallas distintas.
 * @param {string} playerId
 * @param {File} file
 * @returns {string} URL de descarga
 */
export async function uploadPlayerPhoto(playerId, file) {
  const storage = getStorageInstance();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `jugadores/${playerId}/foto.${ext}`;
  const ref  = storageRef(storage, path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}
