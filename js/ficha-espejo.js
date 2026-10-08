// ================================================
// FICHA-ESPEJO.JS — Mapa numerado de cada ficha + motor
// de reglas (origen → campo → operación). PURO: sin
// Firestore, sin DOM. NO está conectado a las fichas
// reales (pendiente de aprobar el mapa de números).
//
// Regla de oro (origen Evaluaciones): el dato se calcula
// SIEMPRE sobre  JUGADOR ACTUAL + EVALUACIÓN SELECCIONADA
// + CAMPO CONCRETO. Nunca se mezclan otras evaluaciones,
// fechas ni jugadores. Estos filtros NO son configurables.
// ================================================

export const ORIGENES = [
  { key: 'evaluaciones', label: 'Evaluaciones' },
  { key: 'jugadores',    label: 'Jugadores' },
  // 'condicional' (referencias) ya no se ofrece: los valores condicionales salen de
  // la ficha personal del jugador (Jugadores). El resolver sigue entendiendo reglas antiguas.
];

export const OPERACIONES = [
  { key: 'directo', label: 'Valor directo' },
  { key: 'media',   label: 'Media' },
  { key: 'suma',    label: 'Suma' },
  { key: 'max',     label: 'Máximo' },
  { key: 'min',     label: 'Mínimo' },
  { key: 'ultimo',  label: 'Último valor' },
  { key: 'conteo',  label: 'Conteo' },
];

export const VACIOS = [
  { key: 'ignorar', label: 'Ignorar' },
  { key: 'cero',    label: 'Contar como 0' },
];

export const DECIMALES = [0, 1, 2];

/** "Juego aéreo" → "juego_aereo" */
export function slugify(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── CATÁLOGO DE CAMPOS (IDs estables) ─────────────
// El ID sale del nombre visible, pero la ficha referencia SIEMPRE el ID.
// `clave` = clave real con la que hoy se guarda en registros.puntuaciones.

/** Campos de Evaluaciones disponibles para una posición. */
export function buildCatalogo(state, positionKey) {
  const schema = state.criteriaSchemas?.[positionKey] || {};
  const lista = [];
  const usados = new Set();
  const avisos = [];
  const add = (aspecto, label, clave, variante = null, etiqueta = label) => {
    let id = slugify(label) + (variante === 'B' ? '_b' : '');
    if (usados.has(id)) {
      avisos.push(`ID duplicado "${id}" (${aspecto}: "${label}") — hay dos items con nombre casi idéntico.`);
      let n = 2;
      while (usados.has(`${id}_${n}`)) n++;
      id = `${id}_${n}`;
    }
    usados.add(id);
    lista.push({ id, label: etiqueta, aspecto, clave, variante });
  };
  (schema.perfiles || []).forEach(l => add('perfil', l, l));
  (state.aspectosComunes?.mental || []).forEach(l => add('mental', l, l));
  (schema.tecnico ?? state.aspectosComunes?.tecnico ?? []).forEach(l => add('tecnico', l, l));
  (schema.tactico || []).forEach(l => add('tactico', l, l));
  (state.aspectosComunes?.condicional || []).forEach(l => {
    add('condicional', l, l, 'A', l);
    add('condicional', l, `${l}__B`, 'B', `${l} (valor 2)`); // solo para el import (::B); NO genera número en las fichas
  });
  const porId = {};
  lista.forEach(c => { porId[c.id] = c; });
  return { lista, porId, avisos };
}

export const CAMPOS_JUGADOR = [
  { id: 'altura',           label: 'Altura',           prop: 'height' },
  { id: 'peso',             label: 'Peso',             prop: 'weight' },
  { id: 'complexion',       label: 'Complexión',       prop: 'complexion' },
  { id: 'fecha_nacimiento', label: 'Fecha de nacimiento', prop: 'birthDate' },
  { id: 'pie',              label: 'Pie dominante',    prop: 'foot' },
  { id: 'edad_madurativa',  label: 'Edad madurativa',  prop: 'maturationalAge' },
];

/** Campos disponibles por origen (para el desplegable CAMPO). */
export function camposDeOrigen(origen, catalogo) {
  if (origen === 'evaluaciones') return catalogo.lista.filter(c => c.variante !== 'B').map(c => ({ id: c.id, label: `${c.label} · ${c.aspecto}` }));
  if (origen === 'condicional') {
    return catalogo.lista.filter(c => c.aspecto === 'condicional' && c.variante !== 'B').flatMap(c => [
      { id: `${c.id}__ref1`, label: `${c.label} — referencia 1` },
      { id: `${c.id}__ref2`, label: `${c.label} — referencia 2` },
    ]);
  }
  if (origen === 'jugadores') {
    return [
      ...CAMPOS_JUGADOR.map(c => ({ id: c.id, label: c.label })),
      ...catalogo.lista.filter(c => c.aspecto === 'condicional' && c.variante !== 'B').map(c => ({ id: `cond_${c.id}`, label: `${c.label} · condicional (ficha personal)` })),
    ];
  }
  return [];
}

/** Operaciones permitidas por origen (jugadores/condicional solo guardan 1 valor). */
export function operacionesDeOrigen(origen) {
  return origen === 'evaluaciones' ? OPERACIONES : OPERACIONES.filter(o => o.key === 'directo');
}

// ── MAPA NUMERADO ─────────────────────────────────
// Orden FIJO (no depende de la matriz visual, para que los números no
// cambien al reordenar bloques):
//   Ficha 1: Perfiles → Personalidad → Ofensivas → Defensivas
//   Ficha 2: Mental → Técnico → Condicional (valor 1 y 2) → Táctico
// Esperado (lo indicado por Pablo): 9 mentales, 12 técnicas, 12 tácticas,
// 12 condicionales. Si no cuadra se avisa, NO se corrige solo.

export const ESPERADO = { mental: 9, tecnico: 12, tactico: 12, condicional: 12, perfiles: 3 };

export function buildMapaFicha(state, positionKey, ficha) {
  const catalogo = buildCatalogo(state, positionKey);
  const schema = state.criteriaSchemas?.[positionKey] || {};
  const slots = [];
  const avisos = [...catalogo.avisos];
  let num = 0;
  const idDe = (aspecto, label, variante = 'A') =>
    catalogo.lista.find(c => c.aspecto === aspecto && c.clave === (variante === 'B' ? `${label}__B` : label))?.id || null;
  const push = (bloque, bloqueLabel, label, aspecto, clave, variante = null) => {
    num += 1;
    slots.push({ num, bloque, bloqueLabel, label: variante ? `${clave.replace(/__B$/, '')} (valor ${variante === 'B' ? 2 : 1})` : label, campoId: idDe(aspecto, clave.replace(/__B$/, ''), variante || 'A'), variante });
  };
  const tactico = schema.tactico || [];
  const mental = state.aspectosComunes?.mental || [];
  const tecnico = schema.tecnico ?? state.aspectosComunes?.tecnico ?? [];
  const condicional = state.aspectosComunes?.condicional || [];

  if (ficha === 1) {
    const perfiles = schema.perfiles || [];
    perfiles.forEach(p => push('perfiles', 'Perfiles', p, 'perfil', p));
    if (perfiles.length !== ESPERADO.perfiles) avisos.push(`Perfiles: ${perfiles.length} (esperado ${ESPERADO.perfiles}).`);
    mental.forEach(l => push('personalidad', 'Personalidad', l, 'mental', l));
    const filt = sel => tactico.filter(t => (sel || []).includes(t));
    const of = filt(schema.competenciasOfensivas);
    const df = filt(schema.competenciasDefensivas);
    of.forEach(l => push('ofensivas', 'Competencias ofensivas', l, 'tactico', l));
    df.forEach(l => push('defensivas', 'Competencias defensivas', l, 'tactico', l));
    if (of.length + df.length !== ESPERADO.tactico) avisos.push(`Ofensivas (${of.length}) + Defensivas (${df.length}) = ${of.length + df.length} (esperado ${ESPERADO.tactico}).`);
    if (mental.length !== ESPERADO.mental) avisos.push(`Mental: ${mental.length} (esperado ${ESPERADO.mental}).`);
  } else {
    mental.forEach(l => push('mental', 'Mental', l, 'mental', l));
    tecnico.forEach(l => push('tecnico', 'Técnico', l, 'tecnico', l));
    // Un único número por ítem condicional (un valor que sale de varias notas
    // de la BBDD o de la ficha personal del jugador).
    condicional.forEach(l => push('condicional', 'Condicional', l, 'condicional', l));
    tactico.forEach(l => push('tactico', 'Táctico', l, 'tactico', l));
    if (mental.length !== ESPERADO.mental) avisos.push(`Mental: ${mental.length} (esperado ${ESPERADO.mental}).`);
    if (tecnico.length !== ESPERADO.tecnico) avisos.push(`Técnico: ${tecnico.length} (esperado ${ESPERADO.tecnico}).`);
    if (condicional.length !== ESPERADO.condicional) avisos.push(`Condicional: ${condicional.length} (esperado ${ESPERADO.condicional}).`);
    if (tactico.length !== ESPERADO.tactico) avisos.push(`Táctico: ${tactico.length} (esperado ${ESPERADO.tactico}).`);
  }
  return { slots, avisos, catalogo };
}

/** Regla sugerida para un slot (solo se aplica si el usuario pulsa "Rellenar sugeridas"). */
export function reglaSugerida(slot) {
  if (!slot.campoId) return null;
  if (slot.bloque === 'condicional') {
    return { origen: 'jugadores', campoId: `cond_${slot.campoId}`, operacion: 'directo', vacios: 'ignorar', decimales: 1, labelAlGuardar: slot.label };
  }
  return { origen: 'evaluaciones', campoId: slot.campoId, operacion: 'media', vacios: 'ignorar', decimales: 1, labelAlGuardar: slot.label };
}

/** Resumen corto de una regla para listados. */
export function resumenRegla(regla, catalogo) {
  if (!regla) return 'Sin configurar';
  const origen = ORIGENES.find(o => o.key === regla.origen)?.label || regla.origen;
  let campo = regla.campoId;
  if (regla.origen === 'jugadores') {
    campo = String(regla.campoId).startsWith('cond_')
      ? (catalogo.porId[String(regla.campoId).slice(5)]?.label || campo) + ' (condicional)'
      : CAMPOS_JUGADOR.find(c => c.id === regla.campoId)?.label || campo;
  }
  else if (regla.origen === 'condicional') {
    const base = catalogo.porId[String(regla.campoId).replace(/__ref[12]$/, '')];
    campo = base ? `${base.label} — referencia ${String(regla.campoId).endsWith('__ref2') ? 2 : 1}` : `${campo} (¡no existe!)`;
  } else campo = catalogo.porId[regla.campoId]?.label || `${campo} (¡no existe!)`;
  const op = OPERACIONES.find(o => o.key === regla.operacion)?.label || regla.operacion;
  return `${origen} → ${campo} → ${op} → vacíos: ${regla.vacios === 'cero' ? 'como 0' : 'ignorar'} → ${regla.decimales} dec.`;
}

// ── MOTOR ─────────────────────────────────────────

const esVacio = v => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** "15/01/2026 10:30:00" · "2026-01-15 10:30" → ms (o null si no se entiende). */
export function parseFecha(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}

function redondear(n, dec) {
  return Number(Math.round(Number(`${n}e${dec}`)) + `e-${dec}`);
}

export function formatear(n, dec) {
  if (n == null) return '—';
  return redondear(n, dec).toFixed(dec).replace('.', ',');
}

/**
 * @param {Object} regla  {origen, campoId, operacion, vacios, decimales}
 * @param {Object} ctx    { jugador, jugadorId, evaluacionId, temporada, posicionKey,
 *                          registros (cualquiera: se filtra aquí), catalogo, condicionalRefs }
 * @returns {{valor:number|string|null, texto:string, n:number, avisos:string[]}}
 */
export function resolverDato(regla, ctx) {
  const out = (valor, n, avisos, dec) => ({
    valor,
    texto: valor == null ? '—' : typeof valor === 'number' ? formatear(valor, dec) : String(valor),
    n, avisos,
  });
  const dec = Number.isInteger(regla?.decimales) ? regla.decimales : 1;
  if (!regla) return out(null, 0, ['Sin regla configurada'], dec);

  // ── Jugadores: valor directo de la ficha del jugador
  if (regla.origen === 'jugadores') {
    if (String(regla.campoId || '').startsWith('cond_')) {
      // Valor condicional guardado en la ficha personal: jugador.condicional[id]
      const base = String(regla.campoId).slice(5);
      if (!ctx.catalogo?.porId?.[base]) return out(null, 0, [`Campo "${regla.campoId}" no existe`], dec);
      // Valor ligado a la evaluación: jugador.condicionalPorEval[evaluacionId][slug del ítem]
      if (!ctx.evaluacionId) return out(null, 0, ['Falta evaluación seleccionada'], dec);
      const vc = ctx.jugador?.condicionalPorEval?.[ctx.evaluacionId]?.[slugify(ctx.catalogo.porId[base].clave)];
      return out(esVacio(vc) ? null : vc, esVacio(vc) ? 0 : 1, esVacio(vc) ? ['Sin valor condicional del jugador en esta evaluación'] : [], dec);
    }
    const campo = CAMPOS_JUGADOR.find(c => c.id === regla.campoId);
    if (!campo) return out(null, 0, [`Campo "${regla.campoId}" no existe`], dec);
    const v = ctx.jugador?.[campo.prop];
    return out(esVacio(v) ? null : v, esVacio(v) ? 0 : 1, [], dec);
  }

  // ── Datos condicionales: referencia fija por posición (referencia 1 = col.3, 2 = col.4)
  if (regla.origen === 'condicional') {
    const m = String(regla.campoId || '').match(/^(.*)__ref([12])$/);
    const campo = m && ctx.catalogo?.porId?.[m[1]];
    if (!campo || campo.aspecto !== 'condicional') return out(null, 0, [`Campo "${regla.campoId}" no existe`], dec);
    const ref = ctx.condicionalRefs?.[ctx.posicionKey]?.[campo.clave] || {};
    const v = m[2] === '2' ? ref.col4 : ref.col3;
    return out(esVacio(v) ? null : v, esVacio(v) ? 0 : 1, [], dec);
  }

  if (regla.origen !== 'evaluaciones') return out(null, 0, [`Origen "${regla.origen}" no soportado`], dec);

  // ── Evaluaciones: JUGADOR ACTUAL + EVALUACIÓN SELECCIONADA + CAMPO. Nada más.
  const avisos = [];
  if (!ctx.jugadorId || !ctx.evaluacionId) {
    return out(null, 0, ['Falta jugador o evaluación seleccionada: no se calcula (nunca se mezclan evaluaciones)'], dec);
  }
  const campo = ctx.catalogo?.porId?.[regla.campoId];
  if (!campo) return out(null, 0, [`Campo "${regla.campoId}" no existe`], dec);

  const regs = (ctx.registros || []).filter(r => r.jugadorId === ctx.jugadorId && r.evaluacionId === ctx.evaluacionId);
  if (!regs.length) return out(null, 0, ['Sin registros de este jugador en esta evaluación'], dec);

  const pares = regs.map(r => {
    // Preferido: ID estable (registros nuevos). Fallback: nombre visible (registros antiguos).
    const bruto = r.puntuacionesId && r.puntuacionesId[campo.id] !== undefined ? r.puntuacionesId[campo.id] : r.puntuaciones?.[campo.clave];
    const vacio = esVacio(bruto);
    return { v: vacio ? (regla.vacios === 'cero' ? 0 : null) : bruto, t: parseFecha(r.fechaRegistro) };
  }).filter(p => p.v !== null);

  const vals = pares.map(p => p.v);
  const n = vals.length;
  if (!n) return out(null, 0, ['Ningún evaluador ha respondido este campo'], dec);

  switch (regla.operacion) {
    case 'directo':
      if (n > 1) return out(null, n, [`Valor directo pero hay ${n} respuestas: usa Media/Último valor`], dec);
      return out(vals[0], n, avisos, dec);
    case 'media':  return out(vals.reduce((a, b) => a + b, 0) / n, n, avisos, dec); // entre respuestas REALES
    case 'suma':   return out(vals.reduce((a, b) => a + b, 0), n, avisos, dec);
    case 'max':    return out(Math.max(...vals), n, avisos, dec);
    case 'min':    return out(Math.min(...vals), n, avisos, dec);
    case 'conteo': return out(n, n, avisos, 0);
    case 'ultimo': {
      const conFecha = pares.filter(p => p.t != null);
      if (conFecha.length !== pares.length) avisos.push('Alguna fecha de registro no se pudo leer: "Último valor" puede no ser fiable');
      const ord = (conFecha.length ? conFecha : pares).slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      return out(ord[ord.length - 1].v, n, avisos, dec);
    }
    default: return out(null, n, [`Operación "${regla.operacion}" no soportada`], dec);
  }
}
