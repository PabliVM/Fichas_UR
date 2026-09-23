// ================================================
// CONSTANTS.JS — Constantes de RM Perfiles
// ================================================

export const APP_NAME       = 'RM Perfiles';
export const DEFAULT_SEASON = '2026/2027';
export const LOGO_PATH      = './rm.png';
export const FOOTER_TEXT    = 'Cantera del Real Madrid CF — RM Perfiles';

export const SEASONS = ['2026/2027', '2025/2026'];

export const TEAMS = [
  { key: 'rmc',       label: 'Real Madrid C' },
  { key: 'juvenil-a', label: 'Juvenil A'     },
];

export const PROFILES = [
  { key: 'portero',     label: 'Portero'     },
  { key: 'central',     label: 'Central'     },
  { key: 'lateral',     label: 'Lateral'     },
  { key: 'mediocentro', label: 'Mediocentro' },
  { key: 'interior',    label: 'Interior'    },
  { key: 'extremo',     label: 'Extremo'     },
  { key: 'delantero',   label: 'Delantero'   },
];

export const TABS = [
  { key: 'inicio',     label: 'Inicio'            },
  { key: 'importar',   label: 'Importar CSV'      },
  { key: 'registro',   label: 'Registro de datos' },
  { key: 'plantillas', label: 'Plantillas'        },
  { key: 'jugadores',  label: 'Jugadores'         },
  { key: 'fichas',     label: 'Fichas'            },
  { key: 'config',     label: 'Configuración'     },
];

// Umbrales de color para medias (definidos por Pablo)
export const SCORE_THRESHOLDS = {
  green:  4,   // media >= 4        → verde
  yellow: 3,   // 3 <= media < 4    → amarillo
  // media < 3                      → rojo
};
