// ================================================
// FICHA-DEMO-DATA.JS — Datos de EJEMPLO
// Solo para ver la ESTRUCTURA de la plantilla.
// Todos los valores en blanco (null) a propósito:
// vendrán del CSV importado por bloque (mental, técnico,
// táctico, condicional) — a mano o desde Firestore, aún
// por decidir. Sin valores no hay colores (score-none).
// ================================================

export const FICHA_DEMO_DATA = {
  player: {
    name: 'Jugador de ejemplo',
    photoUrl: null, // null → círculo "SIN FOTO"
  },
  blocks: {
    mental: {
      rp: [null, null],
      items: [
        { label: 'Autoconfianza',              value: null },
        { label: 'Act. y Preparación mental',   value: null },
        { label: 'Control del estrés',          value: null },
        { label: 'Concentración',               value: null },
        { label: 'Motivación',                  value: null },
        { label: 'Comunicación',                value: null },
        { label: 'Capacidad de adaptación',     value: null },
        { label: 'Autonomía',                   value: null },
        { label: 'Determinación',               value: null },
      ],
    },
    tecnico: {
      rp: [null, null],
      items: [
        { label: 'Pase',                        value: null },
        { label: 'Control',                     value: null },
        { label: 'Conducción',                  value: null },
        { label: 'Manejo pie no dominante',      value: null },
        { label: 'Perfiles',                    value: null },
        { label: 'Cambios de orientación',      value: null },
        { label: 'Velocidad de juego',          value: null },
        { label: 'Capacidad de anticipación',   value: null },
        { label: 'Disputas aéreas',             value: null },
        { label: 'Duelos defensivos 1vs1',      value: null },
        { label: 'Contundencia defensiva',      value: null },
        { label: 'Despejes',                    value: null },
      ],
    },
    tactico: {
      rp: [null, null],
      items: [
        { label: 'Circulación / Timing',            value: null },
        { label: 'Progresión en conducción',        value: null },
        { label: 'Pase ULDF.',                      value: null },
        { label: '1vs1 en banda',                   value: null },
        { label: 'Progresión juego interior',       value: null },
        { label: 'Juego asociativo en banda',       value: null },
        { label: 'Cap. asociativa bajo presión',    value: null },
        { label: 'Pase ULDF',                       value: null },
        { label: 'Defensa espalda',                 value: null },
        { label: 'Continuidad en el juego',         value: null },
        { label: 'Defensa Juego directo.',          value: null },
        { label: 'Defensa de área llegando.',       value: null },
      ],
    },
    condicional: {
      rp: null,
      items: [
        { label: 'V.MAX.',           valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'D.Sprint.',        valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'D.A Int.',         valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'N°Sprint.',        valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'Ac.Max.',          valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'N° Ac Max.',       valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'D.Total.',         valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'M/min.',           valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'CMJ',              valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'Índice Lesional.', valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'Perfil Físico.',   valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
        { label: 'Edad Madurativa.', valueA: null, valueAOk: null, valueB: null, valueBOk: null, refA: null, refB: null },
      ],
    },
  },
  plan: {
    tecnico:     ['', '', '', '', '', ''],
    tactico:     ['', '', '', '', '', ''],
    condicional: ['', '', '', '', '', ''],
    mental:      ['', '', '', '', '', ''],
  },
};
