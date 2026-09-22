// ================================================
// FICHA-DEMO-DATA.JS — Datos de EJEMPLO
// Solo para ver la plantilla renderizada.
// Las etiquetas vienen de los formularios de evaluación;
// los valores son inventados, no son de ningún jugador real.
// Sustituir por datos reales de Firestore cuando exista el CSV.
// ================================================

export const FICHA_DEMO_DATA = {
  player: {
    name: 'Jugador de ejemplo',
    photoUrl: null, // null → círculo "SIN FOTO"
  },
  blocks: {
    mental: {
      rp: [3.8, 3.5],
      items: [
        { label: 'Autoconfianza',              value: 4 },
        { label: 'Act. y Preparación mental',   value: 3.5 },
        { label: 'Control del estrés',          value: 4 },
        { label: 'Concentración',               value: 3.5 },
        { label: 'Motivación',                  value: 4.5 },
        { label: 'Comunicación',                value: 3 },
        { label: 'Capacidad de adaptación',     value: 4 },
        { label: 'Autonomía',                   value: null },
        { label: 'Determinación',               value: null },
      ],
    },
    tecnico: {
      rp: [3.4, 3.2],
      items: [
        { label: 'Pase',                        value: 3.5 },
        { label: 'Control',                     value: 4 },
        { label: 'Conducción',                  value: 3 },
        { label: 'Manejo pie no dominante',      value: 2.5 },
        { label: 'Perfiles',                    value: 3.5 },
        { label: 'Cambios de orientación',      value: 3.5 },
        { label: 'Velocidad de juego',          value: 3 },
        { label: 'Capacidad de anticipación',   value: 4 },
        { label: 'Disputas aéreas',             value: 4 },
        { label: 'Duelos defensivos 1vs1',      value: 3.5 },
        { label: 'Contundencia defensiva',      value: 4 },
        { label: 'Despejes',                    value: 3.5 },
      ],
    },
    tactico: {
      rp: [3.6, 3.4],
      items: [
        { label: 'Circulación / Timing',            value: 4 },
        { label: 'Progresión en conducción',        value: 4 },
        { label: 'Pase ULDF.',                      value: 3 },
        { label: '1vs1 en banda',                   value: 3 },
        { label: 'Progresión juego interior',       value: 2.8 },
        { label: 'Juego asociativo en banda',       value: 4 },
        { label: 'Cap. asociativa bajo presión',    value: 3.5 },
        { label: 'Pase ULDF',                       value: 4.5 },
        { label: 'Defensa espalda',                 value: 3 },
        { label: 'Continuidad en el juego',         value: 4 },
        { label: 'Defensa Juego directo.',          value: 4 },
        { label: 'Defensa de área llegando.',       value: 3.8 },
      ],
    },
    condicional: {
      rp: null,
      items: [
        { label: 'V.MAX.',           valueA: '31,85', valueAOk: false, valueB: '33,05', valueBOk: true,  refA: '32,5',    refB: '35,1' },
        { label: 'D.Sprint.',        valueA: '210,40', valueAOk: false, valueB: '297,73', valueBOk: true,  refA: '255',     refB: '455' },
        { label: 'D.A Int.',         valueA: '515,81', valueAOk: true,  valueB: '679,50', valueBOk: true,  refA: '511',     refB: '875' },
        { label: 'N°Sprint.',        valueA: '11,50',  valueAOk: false, valueB: '16',     valueBOk: false, refA: '15',      refB: '41' },
        { label: 'Ac.Max.',          valueA: '4,43',   valueAOk: false, valueB: '4,90',   valueBOk: false, refA: '5,4',     refB: '7,28' },
        { label: 'N° Ac Max.',       valueA: '36,13',  valueAOk: false, valueB: '46',     valueBOk: false, refA: '56',      refB: '56' },
        { label: 'D.Total.',         valueA: '10488,99', valueAOk: true, valueB: '11137', valueBOk: true, refA: '9.383',   refB: '13.000' },
        { label: 'M/min.',           valueA: '105,16', valueAOk: true,  valueB: '108,47', valueBOk: true,  refA: '104',     refB: '144' },
        { label: 'CMJ',              valueA: '-',       valueAOk: null,  valueB: '44,6',   valueBOk: null,  refA: '40',      refB: '47' },
        { label: 'Índice Lesional.', valueA: '-',       valueAOk: null,  valueB: '-',      valueBOk: null,  refA: '5',       refB: '5' },
        { label: 'Perfil Físico.',   valueA: '-',       valueAOk: null,  valueB: '-',      valueBOk: null,  refA: '5',       refB: '5' },
        { label: 'Edad Madurativa.', valueA: '4,5',     valueAOk: null,  valueB: '4,54',   valueBOk: null,  refA: '5',       refB: '5' },
      ],
    },
  },
  plan: {
    tecnico:     ['', '', ''],
    tactico:     ['', '', ''],
    condicional: ['', '', ''],
    mental:      ['', '', ''],
  },
};
