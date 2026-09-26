// ================================================
// CONSTANTS.JS — Constantes de RM Perfiles
// ================================================

export const APP_NAME       = 'RM Perfiles';
export const DEFAULT_SEASON = '2026/2027';
export const LOGO_PATH      = './rm.png';
export const FOOTER_TEXT    = 'Cantera del Real Madrid CF — RM Perfiles';

export const SEASONS = ['2026/2027', '2025/2026'];

// Dimensiones "oficiales" de la Ficha 2 (documentación de referencia,
// no editable desde la UI — son valores fijos en css/ficha.css y
// js/ficha-detalle.js). Sirven para: 1) consulta rápida, 2) base de
// escalado al aplicar la misma proporción a la Ficha 1 (ancho de
// diseño 4700px vs 7200px → factor 0.6528).
export const FICHA2_OFFICIAL_DIMENSIONS = {
  designWidth: 7200,
  designHeight: 5014,
  groups: [
    {
      title: 'Header superior',
      rows: [
        ['Ancho', '100% de la página (7200px)'],
        ['Alto', '280px (fijo: escudo 260px + padding 10px arriba/abajo)'],
        ['Escudo', '260 × 260px'],
        ['Título', '104px'],
        ['Badge página', '72px'],
      ],
    },
    {
      title: 'Subheader granate (bloques)',
      rows: [
        ['Ancho', '100% de su columna (mitad de página, ~3600px)'],
        ['Alto', '≈114px (no fijo: line-height del título 75px + padding 12px×2)'],
        ['Título de bloque', '75px'],
        ['Padding', '12px 16px'],
      ],
    },
    {
      title: 'Radar',
      rows: [
        ['Ancho máx.', '1950px'],
        ['Tamaño base (diámetro datos)', '300 (≤12 items) · 380 (13–18) · 460 (>18)'],
        ['Etiquetas', 'variable según el bloque (ej. Táctico portero: 24)'],
      ],
    },
    {
      title: 'Listas de items',
      rows: [
        ['Texto', '55px (≤18 items del bloque) · 38px (>18 items)'],
      ],
    },
    {
      title: 'Condicional (GPS)',
      rows: [
        ['Texto / input', '55px'],
        ['Icono ✔/✘', '40px'],
      ],
    },
    {
      title: 'Círculo central',
      rows: [
        ['Tamaño', '1420 × 1420px'],
        ['Radio exterior', '683'],
        ['Radio interior', '378'],
        ['Nombre de bloque', '79px'],
        ['R/P', '42px'],
      ],
    },
    {
      title: 'Plan de acción',
      rows: [
        ['Ancho (título / subheader)', '100% de la página (7200px)'],
        ['Alto (título)', '≈114px (no fijo, según texto 75px)'],
        ['Título', '75px'],
        ['Alto (subheader aspectos)', '≈68px (no fijo, según texto 50px)'],
        ['Subheader "Aspectos del jugador"', '50px'],
        ['Ancho (cabecera blanca)', '100% de su columna (1/4 de página, ~1800px)'],
        ['Cabecera blanca (alto fijo)', '73px / 150px'],
        ['Icono balón', '88 × 88px'],
        ['Texto de lista', '62px'],
      ],
    },
  ],
};

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
  { key: 'registro',   label: 'Registro de datos' },
  { key: 'jugadores',  label: 'Jugadores'         },
  { key: 'config',     label: 'Configuración'     },
];
