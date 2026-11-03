// ================================================
// RGPD.JS — Derechos sobre los datos de un jugador:
// exportarlos todos (acceso/portabilidad) y borrarlos
// todos (supresión): ficha, histórico, registros de
// evaluaciones y su sitio en las plantillas.
// ================================================

import { readSubCollection, deleteSubCollection, deleteDocument, readCollection, updateDocument, arrayRemove } from './firebase-service.js';
import { queryRegistros } from './evaluaciones-service.js';

/** Descarga un objeto como archivo .json. */
export function descargarJSON(nombre, datos) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Todos los datos guardados de un jugador, en un solo archivo. */
export async function exportarJugador(jugador) {
  const [historico, registros, plantillas] = await Promise.all([
    readSubCollection('jugadores', jugador.id, 'historico').catch(() => []),
    queryRegistros({ jugadorId: jugador.id }).catch(() => []),
    readCollection('plantillas').catch(() => []),
  ]);
  const nombre = `${jugador.nombre || ''} ${jugador.apellidos || ''}`.trim() || jugador.id;
  descargarJSON(`datos-${nombre.replace(/[^\p{L}\p{N}]+/gu, '-')}.json`, {
    exportado: new Date().toISOString(),
    jugador,
    historico,
    registrosEvaluaciones: registros,
    plantillas: plantillas.filter(p => (p.jugadorIds || []).includes(jugador.id)).map(p => p.id),
  });
}

/**
 * Borra todo lo del jugador. Sigue aunque falle una parte (p. ej. sin permiso sobre registros)
 * y devuelve qué no se pudo borrar, para avisar.
 * @returns {Promise<string[]>} avisos
 */
export async function borrarJugadorCompleto(id) {
  const avisos = [];
  try { await deleteSubCollection('jugadores', id, 'historico'); }
  catch (err) { console.error('[RGPD] Histórico:', err); avisos.push('histórico'); }
  try {
    const regs = await queryRegistros({ jugadorId: id });
    for (const r of regs) await deleteDocument('registros', r.id);
  } catch (err) { console.error('[RGPD] Registros:', err); avisos.push('registros de evaluaciones (hace falta permiso de edición en Registro de datos)'); }
  try {
    const plantillas = (await readCollection('plantillas')).filter(p => (p.jugadorIds || []).includes(id));
    for (const p of plantillas) await updateDocument('plantillas', p.id, { jugadorIds: arrayRemove(id) });
  } catch (err) { console.error('[RGPD] Plantillas:', err); avisos.push('plantillas'); }
  await deleteDocument('jugadores', id); // si esto falla, se lanza: el jugador sigue existiendo
  return avisos;
}
