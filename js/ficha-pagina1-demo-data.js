// ================================================
// FICHA-PAGINA1-DEMO-DATA.JS — Datos de EJEMPLO
// Solo para ver la ESTRUCTURA de la página 1.
// Etiquetas basadas en tu imagen de referencia (perfil portero);
// todos los valores/colores en blanco (null) hasta que haya CSV real.
// ================================================

export const FICHA1_DEMO_DATA = {
  player: {
    name: '',
    photoUrl: null,
    birthDate: '',
    maturationalAge: null,
    position: '',
    height: null,
    heightOk: null,      // true/false/null → ✔ / ✘ / sin dato
    weight: null,
    foot: '',
    rValue: null,
    pValue: null,
  },

  description: '',

  // Barras de estado específicas del perfil (aquí: portero).
  // color: 'green' | 'yellow' | 'red' | null (sin dato → gris)
  statusBars: [
    { label: 'Dominador de Área',    color: null },
    { label: 'Acción bajo palos',    color: null },
    { label: 'Juego con los pies',   color: null },
  ],

  personalidad: {
    col1: [
      { label: 'Autoconfianza',            status: null },
      { label: 'Act. y Prep. mental',      status: null },
      { label: 'Control del estrés',       status: null },
      { label: 'Concentración',            status: null },
      { label: 'Motivación',               status: null },
    ],
    col2: [
      { label: 'Comunicación',             status: null },
      { label: 'Cap. adaptación',          status: null },
      { label: 'Autonomía',                status: null },
      { label: 'Determinación',            status: null },
    ],
  },

  // status: true → ✔ · false/'yellow'/'red' → cuadro de color · null → sin dato (gris)
  competenciasOfensivas: [
    { label: 'Continuidad en circulación',                status: null },
    { label: 'Pase largo para progresar',                 status: null },
    { label: 'Progresión con pase desde juego interior',  status: null },
    { label: 'Capacidad asociativa bajo presión',         status: null },
    { label: 'Capacidad para iniciar acciones ofensivas', status: null },
  ],

  competenciasDefensivas: [
    { label: 'Dominio del juego aéreo',                                  status: null },
    { label: 'Defensa espalda ULDF acciones divididas',                  status: null },
    { label: 'Defensa juego directo',                                    status: null },
    { label: 'Acciones bajo palos',                                      status: null },
    { label: 'Comunicación línea defensiva llegada a área',              status: null },
    { label: 'Gestión línea defensiva organizando marcas y equilibrio',  status: null },
    { label: 'Dominio interpretar y actuar ABP',                         status: null },
  ],

  aspectosOfensivos:  { potenciar: ['', '', ''], mejorar: ['', '', ''] },
  aspectosDefensivos: { potenciar: ['', '', ''], mejorar: ['', '', ''] },

  // Colores fijos del círculo mini (igual que en la página 2: derivados
  // de la media de cada bloque, en blanco si no hay dato).
  blockRp: { mental: null, tecnico: null, condicional: null, tactico: null },
};
