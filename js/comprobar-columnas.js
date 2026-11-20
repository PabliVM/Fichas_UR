// ================================================
// COMPROBAR-COLUMNAS.JS — Al importar una encuesta, compara la PREGUNTA
// de cada columna (filas de cabecera del Excel) con el criterio al que
// se va a guardar, y propone el criterio que mejor encaja.
// Solo sugiere: el usuario decide (botón "Colocar según el Excel").
// ================================================

const VACIAS = new Set(['de', 'la', 'el', 'en', 'y', 'del', 'para', 'con', 'por', 'a', 'al', 'las', 'los', 'sin', 'o', 'u', 'e', 'su', 'sus', 'un', 'una', 'que', 'capacidad', 'habilidad', 'dominio', 'situaciones', 'situacion', 'mediante', 'zonas', 'zona']);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palabras = s => norm(s).split(/[^a-z0-9]+/).filter(w => w && !VACIAS.has(w));
const raiz = w => w.slice(0, 5);

/** Pregunta de cada columna: la celda de cabecera con más texto, su primera línea. */
export function preguntasDeCabecera(filasCabecera, headers) {
  const out = {};
  headers.forEach(h => {
    const celdas = filasCabecera.map(r => String(r?.[h] ?? '').trim()).filter(t => /[a-záéíóúñ]{3}/i.test(t));
    if (!celdas.length) return;
    const larga = celdas.sort((a, b) => b.length - a.length)[0];
    out[h] = larga.split(/\r?\n/)[0].replace(/^"+|"+$/g, '').trim().slice(0, 160);
  });
  return out;
}

/** 0..1: parte de las palabras del criterio que aparecen (por raíz) en la pregunta. */
function parecido(pregunta, criterio) {
  const cw = [...new Set(palabras(criterio))];
  if (!cw.length) return 0;
  const qr = new Set(palabras(pregunta).map(raiz));
  const hit = cw.filter(w => qr.has(raiz(w))).length;
  return hit / cw.length + 0.3 * hit / Math.max(qr.size, 1); // + lo que cubre de la pregunta (desempata)
}

/**
 * @param preguntas  {header: texto}
 * @param mapping    {header: destino}
 * @param criterios  nombres de criterio que se pueden comparar (perfiles y competencias)
 * @returns {{ porColumna: {header: {estado:'ok'|'aviso'|'?', sugerido?:string}}, propuesta: {header: criterio}, avisos: number }}
 */
export function comprobarColumnas(preguntas, mapping, criterios) {
  const set = new Set(criterios);
  const cols = Object.keys(preguntas).filter(h => set.has(mapping[h]));
  // Reparto: cada criterio a la columna que mejor encaja, sin repetir (mayor parecido primero).
  const pares = [];
  cols.forEach(h => criterios.forEach(c => { const p = parecido(preguntas[h], c); if (p >= 0.5) pares.push({ h, c, p }); }));
  pares.sort((a, b) => b.p - a.p);
  const propuesta = {}, usados = new Set();
  pares.forEach(({ h, c }) => { if (!(h in propuesta) && !usados.has(c)) { propuesta[h] = c; usados.add(c); } });
  // Mejora: intercambiar criterios entre dos columnas (o pasar a uno libre) si encaja mejor en total.
  const sc = (h, c) => { if (!c) return 0; const p = parecido(preguntas[h], c); return p >= 0.5 ? p : -1; };
  for (let vuelta = 0, mejora = true; mejora && vuelta < 50; vuelta++) {
    mejora = false;
    for (const h1 of cols) for (const h2 of cols) {
      if (h1 >= h2) continue;
      const a = propuesta[h1], b = propuesta[h2];
      // h1 se queda con b; h2 con a si le encaja, si no se queda sin criterio. (Y al revés.)
      for (const [x, y, cx, cy] of [[h1, h2, a, b], [h2, h1, b, a]]) {
        if (!cy || sc(x, cy) < 0) continue;
        const nuevoY = cx && sc(y, cx) >= 0 ? cx : null;
        if (sc(x, cy) + sc(y, nuevoY) > sc(x, cx) + sc(y, cy) + 1e-9) {
          propuesta[x] = cy;
          if (nuevoY) propuesta[y] = nuevoY; else { delete propuesta[y]; if (cx) usados.delete(cx); }
          mejora = true;
          break;
        }
      }
      if (mejora) break;
    }
    for (const h of cols) for (const c of criterios) {
      if (usados.has(c) && Object.values(propuesta).includes(c)) continue;
      if (sc(h, c) > sc(h, propuesta[h]) + 1e-9) { if (propuesta[h]) usados.delete(propuesta[h]); propuesta[h] = c; usados.add(c); mejora = true; }
    }
  }
  const porColumna = {};
  let avisos = 0;
  cols.forEach(h => {
    const sug = propuesta[h];
    if (!sug) porColumna[h] = { estado: '?' };
    else if (sug === mapping[h]) porColumna[h] = { estado: 'ok' };
    else { porColumna[h] = { estado: 'aviso', sugerido: sug }; avisos++; }
  });
  return { porColumna, propuesta, avisos };
}

/** Igual, pero cada columna solo se compara con los criterios de su mismo bloque (perfiles, táctico, mental, técnico). */
export function comprobarPorBloques(preguntas, mapping, bloques) {
  const out = { porColumna: {}, propuesta: {}, avisos: 0 };
  Object.values(bloques).forEach(criterios => {
    const r = comprobarColumnas(preguntas, mapping, criterios.filter(Boolean));
    Object.assign(out.porColumna, r.porColumna);
    Object.assign(out.propuesta, r.propuesta);
    out.avisos += r.avisos;
  });
  return out;
}
