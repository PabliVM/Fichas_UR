// ================================================
// EVALUACIONES-SERVICE.JS — Contexto de importación,
// registros individuales y consultas Firestore.
// Colecciones NUEVAS: 'evaluaciones' y 'registros'.
// No toca 'jugadores' ni 'config' (colecciones existentes).
//
// Consultas siempre con where/orderBy — nunca se trae la
// colección entera para filtrar en el cliente (auditoría §14).
// ================================================

import {
  collection, query, where, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDB, addDocument, updateDocument, deleteDocument, readCollection } from './firebase-service.js';

// ── EVALUACIONES (contexto de importación) ────────
// Forma: { temporada, nombre, posicionKey, tipo, fechaInicio, fechaFin }

export async function crearEvaluacion(data) {
  return addDocument('evaluaciones', data);
}

export async function listarEvaluaciones() {
  return readCollection('evaluaciones');
}

export async function actualizarEvaluacion(id, patch) {
  return updateDocument('evaluaciones', id, patch);
}

/** Borra el contexto de evaluación. NO borra sus registros (auditoría §6:
 *  los registros individuales no se eliminan salvo acción explícita sobre
 *  ellos) — si quedan registros huérfanos, la llamada avisa antes con el conteo. */
export async function eliminarEvaluacion(id) {
  return deleteDocument('evaluaciones', id);
}

// ── REGISTROS (una fila = un evaluador puntuando a un jugador) ─
// Forma: { evaluacionId, temporada, posicionKey, tipo, jugadorId,
//   jugadorNombreArchivo, evaluador, puntuaciones:{competencia:valor},
//   rowKey, origen:'csv'|'manual' }

/**
 * Consulta registros combinando filtros (todos opcionales, se combinan
 * con AND). Requiere índice compuesto en Firestore si se combinan varios.
 */
export async function queryRegistros(filtros = {}) {
  const db = getDB();
  const clauses = [];
  const campos = ['evaluacionId', 'temporada', 'posicionKey', 'jugadorId', 'evaluador', 'tipo'];
  campos.forEach(campo => {
    if (filtros[campo]) clauses.push(where(campo, '==', filtros[campo]));
  });
  const q = clauses.length ? query(collection(db, 'registros'), ...clauses) : collection(db, 'registros');
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function crearRegistro(data) {
  return addDocument('registros', data);
}

export async function actualizarRegistro(id, patch) {
  return updateDocument('registros', id, patch);
}
