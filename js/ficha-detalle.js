// ================================================
// FICHA-DETALLE.JS — Página 2 de la ficha individual
// 4 bloques: MENTAL, TÉCNICO, CONDICIONAL, TÁCTICO
// + círculo central + Plan de acción.
//
// Colores de media: usan state.scoreBands (Configuración) —
// número de bandas y color de cada una, configurable.
// El círculo central usa el MISMO color que la media del
// bloque — en blanco cuando aún no hay dato.
// ================================================

import { scoreColor, safeText } from './utils.js';
import { buildRadarSVG } from './radar-chart.js';

/** Color del cuarto del círculo para un bloque: el de su banda, o blanco si no hay dato. */
function blockCircleColor(rp, bands) {
  const avg = rp && rp[0] != null ? rp[0] : null;
  return avg != null ? (scoreColor(avg, bands) || '#ffffff') : '#ffffff';
}

// ── CÍRCULO CENTRAL ──────────────────────────────

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildCentralCircle(photoUrl, blockColors) {
  const size = 1575;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 758;
  const rInner = 420;
  const midR = (rOuter + rInner) / 2;

  const seg = (startDeg, endDeg, color) => {
    const p1 = polar(cx, cy, rOuter, startDeg);
    const p2 = polar(cx, cy, rOuter, endDeg);
    const p3 = polar(cx, cy, rInner, endDeg);
    const p4 = polar(cx, cy, rInner, startDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `<path d="M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z" fill="${color}" stroke="#94a3b8" stroke-width="1.5" />`;
  };

  // Arco invisible por cuadrante (radio medio) para que el texto lo siga.
  // En la mitad inferior (TÁCTICO/CONDICIONAL) se dibuja al revés,
  // si no el texto saldría boca abajo.
  const arcPath = (id, aDeg, bDeg) => {
    const p1 = polar(cx, cy, midR, aDeg);
    const p2 = polar(cx, cy, midR, bDeg);
    const large = Math.abs(bDeg - aDeg) > 180 ? 1 : 0;
    const sweep = bDeg > aDeg ? 1 : 0;
    return `<path id="${id}" d="M ${p1.x} ${p1.y} A ${midR} ${midR} 0 ${large} ${sweep} ${p2.x} ${p2.y}" fill="none" />`;
  };

  const curvedLabel = (id, text, color) => {
    const fill = color === '#ffffff' ? '#334155' : '#0f1117';
    return `<text font-size="87" font-weight="700" fill="${fill}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${text}</textPath></text>`;
  };

  const photo = photoUrl
    ? `<clipPath id="ficha-photo-clip"><circle cx="${cx}" cy="${cy}" r="${rInner - 4}" /></clipPath>
       <image href="${photoUrl}" x="${cx - rInner}" y="${cy - rInner}" width="${rInner * 2}" height="${rInner * 2}" clip-path="url(#ficha-photo-clip)" preserveAspectRatio="xMidYMid slice" />`
    : `<text x="${cx}" y="${cy}" font-size="78" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">SIN FOTO</text>`;

  return `
    <svg viewBox="0 0 ${size} ${size}" class="ficha-central-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${arcPath('arc-mental', 270, 360)}
        ${arcPath('arc-tecnico', 0, 90)}
        ${arcPath('arc-tactico', 180, 90)}
        ${arcPath('arc-condicional', 270, 180)}
      </defs>
      ${seg(270, 360, blockColors.mental)}
      ${seg(0, 90, blockColors.tecnico)}
      ${seg(90, 180, blockColors.tactico)}
      ${seg(180, 270, blockColors.condicional)}
      <circle cx="${cx}" cy="${cy}" r="${rInner + 4}" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5" />
      ${photo}
      ${curvedLabel('arc-mental', 'MENTAL', blockColors.mental)}
      ${curvedLabel('arc-tecnico', 'TÉCNICO', blockColors.tecnico)}
      ${curvedLabel('arc-tactico', 'TÁCTICO', blockColors.tactico)}
      ${curvedLabel('arc-condicional', 'CONDICIONAL', blockColors.condicional)}
    </svg>
  `;
}

/**
 * Coloca el círculo central exactamente en el cruce de los 4
 * cuadrantes, midiendo el DOM real (fiable pase lo que pase con
 * las alturas de MENTAL/TÉCNICO/CONDICIONAL/TÁCTICO).
 */
function centerFichaCircle(root) {
  const grid       = root.querySelector('.ficha-grid');
  const mental     = root.querySelector('.q-mental');
  const condHeader = root.querySelector('.q-condicional .ficha-q-header');
  const circle     = root.querySelector('.ficha-central');
  if (!grid || !mental || !condHeader || !circle) return;

  root.style.transform = 'none'; // medir en tamaño real, no en el ya escalado

  const gridRect   = grid.getBoundingClientRect();
  const mentalRect = mental.getBoundingClientRect();

  const crossX = mentalRect.right - gridRect.left; // borde derecho de MENTAL = línea vertical
  // línea horizontal: no el borde superior de la barra CONDICIONAL/TÁCTICO,
  // sino su mitad — ahí es donde tiene que caer el ecuador del círculo.
  const crossY = (mentalRect.bottom - gridRect.top) + condHeader.offsetHeight / 2;
  const half = circle.offsetWidth / 2;

  circle.style.left = `${crossX - half}px`;
  circle.style.top  = `${crossY - half}px`;
}

// ── BLOQUE CON RADAR (mental / técnico / táctico) ──

function buildRatedBlock({ title, rp, items, side, bands, blockKey }) {
  const rpDisplay = rp && rp[0] != null && rp[1] != null
    ? `${formatNum(rp[0])} / ${formatNum(rp[1])}`
    : '-';

  const listHTML = items.map(item => {
    const color = scoreColor(item.value, bands); // hex de la banda, o null si no hay dato
    const valueText = item.value == null ? '-' : formatNum(item.value);
    const style = `style="color:${color || 'rgba(255,255,255,0.5)'}"`;
    return side === 'left'
      ? `<li><span class="ficha-score" ${style}>${valueText}</span><span class="ficha-item-label">${safeText(item.label)}</span></li>`
      : `<li><span class="ficha-item-label">${safeText(item.label)}</span><span class="ficha-score" ${style}>${valueText}</span></li>`;
  }).join('');

  const radarSVG = buildRadarSVG(
    items.map(i => ({ label: i.label, value: i.value })),
    { size: 300 }
  );

  const listBlock  = `<ul class="ficha-item-list ${side === 'left' ? 'align-left' : 'align-right'}">${listHTML}</ul>`;
  const radarBlock = `<div class="ficha-radar">${radarSVG}</div>`;

  return `
    <section class="ficha-quadrant q-${blockKey} ${side === 'left' ? 'q-left' : 'q-right'}">
      <header class="ficha-q-header">
        ${side === 'left' ? `<span class="ficha-q-rp">${rpDisplay}</span>` : ''}
        <span class="ficha-q-title">${safeText(title)}</span>
        ${side === 'right' ? `<span class="ficha-q-rp">${rpDisplay}</span>` : ''}
      </header>
      <div class="ficha-q-body">
        ${side === 'left' ? listBlock + radarBlock : radarBlock + listBlock}
      </div>
    </section>
  `;
}

// ── BLOQUE CONDICIONAL (valores GPS, editable, sin radar) ──

function gpsIconMarkup(ok) {
  if (ok === null || ok === undefined) return '<span class="gps-icon"></span>';
  return ok
    ? '<span class="gps-icon gps-ok">✔</span>'
    : '<span class="gps-icon gps-fail">✘</span>';
}

function buildCondicionalBlock({ title, rp, items }) {
  const rpDisplay = rp && rp[0] != null && rp[1] != null
    ? `${formatNum(rp[0])} / ${formatNum(rp[1])}`
    : '-';

  const rows = items.map((item, i) => `
    <div class="gps-row" data-row="${i}">
      <span class="gps-val-cell gps-cell-a">
        <input class="gps-input" type="text" data-row="${i}" data-field="valueA" value="${item.valueA ?? ''}" />
        ${gpsIconMarkup(item.valueAOk)}
      </span>
      <span class="gps-val-cell">
        <input class="gps-input" type="text" data-row="${i}" data-field="valueB" value="${item.valueB ?? ''}" />
        ${gpsIconMarkup(item.valueBOk)}
      </span>
      <span class="gps-label">• ${safeText(item.label)}</span>
      <span class="gps-ref-cell gps-cell-a">
        <input class="gps-input gps-ref-input" type="text" data-row="${i}" data-field="refA" value="${item.refA ?? ''}" />
      </span>
      <span class="gps-ref-cell">
        <input class="gps-input gps-ref-input" type="text" data-row="${i}" data-field="refB" value="${item.refB ?? ''}" />
      </span>
    </div>
  `).join('');

  return `
    <section class="ficha-quadrant q-condicional q-left ficha-condicional">
      <header class="ficha-q-header">
        <span class="ficha-q-rp">${rpDisplay}</span>
        <span class="ficha-q-title">${safeText(title)}</span>
      </header>
      <div class="ficha-condicional-body">
        <div class="gps-grid">${rows}</div>
      </div>
    </section>
  `;
}

// ── PLAN DE ACCIÓN ────────────────────────────────

const PLAN_COLUMNS = [
  { key: 'tecnico',     label: 'TÉCNICO',     icon: './balon.png'   },
  { key: 'tactico',     label: 'TÁCTICO',     icon: './pizarra.jpg' },
  { key: 'condicional', label: 'CONDICIONAL', icon: './cohete.png'  },
  { key: 'mental',      label: 'MENTAL',      icon: './cerebro.png' },
];

function buildPlanAccion(plan) {
  const cols = PLAN_COLUMNS.map(col => {
    const items = (plan?.[col.key] ?? ['', '', '', '', '', '', '']);
    const lis = items.map(txt =>
      `<li contenteditable="true" data-plan="${col.key}">${safeText(txt)}</li>`
    ).join('');
    return `
      <div class="plan-col">
        <div class="plan-col-header">
          <span>${col.label}</span><img class="plan-col-icon plan-col-icon-${col.key}" src="${col.icon}" alt="" />
        </div>
        <ul class="plan-col-list">${lis}</ul>
      </div>
    `;
  }).join('');

  return `
    <section class="ficha-plan">
      <header class="ficha-plan-title">PLAN DE ACCIÓN</header>
      <div class="ficha-plan-subheader">ASPECTOS DEL JUGADOR</div>
      <div class="ficha-plan-grid">
        ${cols}
      </div>
    </section>
  `;
}

// ── HEADER DE LA FICHA (azul corporativo, arriba del todo) ──

export function buildFichaHeader(logoPath, pageLabel) {
  return `
    <header class="ficha-header">
      <img src="${logoPath}" alt="" class="ficha-header-crest" />
      <span class="ficha-header-title">INFORME INDIVIDUAL DEL JUGADOR</span>
      ${pageLabel ? `<span class="ficha-header-page">${safeText(pageLabel)}</span>` : ''}
    </header>
  `;
}

// ── FORMATEO ──────────────────────────────────────

function formatNum(n) {
  if (n == null) return '-';
  return Number(n).toFixed(2).replace(/\.00$/, '').replace('.', ',');
}

function parseEsNumber(str) {
  if (str == null || str === '') return null;
  const n = parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/**
 * Recalcula el icono ✔/✘ de una fila GPS comparando valueA/valueB
 * contra el rango [refA, refB] (en cualquier orden).
 */
function recalcGpsRow(rowEl) {
  const get = field => rowEl.querySelector(`[data-field="${field}"]`)?.value ?? '';
  const refA = parseEsNumber(get('refA'));
  const refB = parseEsNumber(get('refB'));
  const hasRange = refA != null && refB != null;
  const min = hasRange ? Math.min(refA, refB) : null;
  const max = hasRange ? Math.max(refA, refB) : null;

  ['valueA', 'valueB'].forEach(field => {
    const input = rowEl.querySelector(`[data-field="${field}"]`);
    const iconSlot = input.parentElement.querySelector('.gps-icon');
    const val = parseEsNumber(input.value);
    let ok = null;
    if (hasRange && val != null) ok = val >= min && val <= max;
    iconSlot.className = 'gps-icon' + (ok === true ? ' gps-ok' : ok === false ? ' gps-fail' : '');
    iconSlot.textContent = ok === true ? '✔' : ok === false ? '✘' : '';
  });
}

/**
 * Conecta los inputs del bloque CONDICIONAL para que el ✔/✘
 * se recalcule solo al escribir. Llamar tras insertar el HTML
 * en el DOM (no persiste en Firestore todavía).
 */
export function wireCondicionalInputs(container) {
  container.querySelectorAll('.gps-row').forEach(rowEl => {
    recalcGpsRow(rowEl);
    rowEl.querySelectorAll('.gps-input').forEach(input => {
      input.addEventListener('input', () => recalcGpsRow(rowEl));
    });
  });
}

// ── RENDER PRINCIPAL ──────────────────────────────

/**
 * Renderiza la página de detalle (4 cuadrantes) dentro de `container`.
 * @param {HTMLElement} container
 * @param {Object} data — { player, blocks: {mental, tecnico, tactico, condicional}, plan }
 * @param {string} logoPath — ruta del escudo (LOGO_PATH de constants.js)
 * @param {Array} bands — state.scoreBands: [{ color, min }, ...]
 * @param {string} [pageLabel] — indicador de página, ej. '2/2'. Vacío/omitido = no se muestra.
 */
export function renderFichaDetalle(container, data, logoPath, bands, pageLabel = '2/2') {
  const { player, blocks, plan } = data;

  const blockColors = {
    mental:      blockCircleColor(blocks.mental.rp,      bands),
    tecnico:     blockCircleColor(blocks.tecnico.rp,      bands),
    tactico:     blockCircleColor(blocks.tactico.rp,      bands),
    condicional: blockCircleColor(blocks.condicional.rp,  bands),
  };

  container.innerHTML = `
    <div class="ficha-a4-frame">
      <div class="ficha-detalle">
        ${buildFichaHeader(logoPath, pageLabel)}
        <div class="ficha-grid">
          ${buildRatedBlock({ title: 'MENTAL',  rp: blocks.mental.rp,  items: blocks.mental.items,  side: 'left',  bands, blockKey: 'mental'  })}
          ${buildRatedBlock({ title: 'TÉCNICO', rp: blocks.tecnico.rp, items: blocks.tecnico.items, side: 'right', bands, blockKey: 'tecnico' })}
          ${buildCondicionalBlock({ title: 'CONDICIONAL', rp: blocks.condicional.rp, items: blocks.condicional.items })}
          ${buildRatedBlock({ title: 'TÁCTICO', rp: blocks.tactico.rp, items: blocks.tactico.items, side: 'right', bands, blockKey: 'tactico' })}
          <div class="ficha-central">${buildCentralCircle(player?.photoUrl, blockColors)}</div>
        </div>
        ${buildPlanAccion(plan)}
      </div>
    </div>
  `;

  wireCondicionalInputs(container);

  const fichaRoot = container.querySelector('.ficha-detalle');
  centerFichaCircle(fichaRoot);
  fitFichaToFrame(container);

  window.addEventListener('resize', () => {
    centerFichaCircle(fichaRoot);
    fitFichaToFrame(container);
  });
  window.addEventListener('beforeprint', () => {
    // Al imprimir NO reescalamos por JS (los tiempos del navegador
    // en beforeprint son poco fiables) — se deja la ficha a tamaño
    // natural y es la opción "Ajustar al área de impresión" del
    // propio diálogo de impresión la que la encoge a una página.
    const ficha = container.querySelector('.ficha-detalle');
    if (ficha) ficha.style.transform = 'none';
  });
  window.addEventListener('afterprint', () => fitFichaToFrame(container));
}

/**
 * Escala la ficha (tamaño de diseño fijo) para que ocupe el ancho
 * disponible en pantalla — SOLO por ancho, sin límite de alto, para
 * que la ficha 1 y la ficha 2 midan siempre el mismo ancho entre sí
 * (antes, la que tenía más contenido —más alta— se paraba antes por
 * el límite de alto y quedaba más estrecha). El marco se ajusta
 * exacto al resultado. Se recalcula solo, no hay que tocar nada a mano.
 */
export function fitFichaToFrame(container) {
  const frame = container.querySelector('.ficha-a4-frame');
  const ficha = container.querySelector('.ficha-detalle');
  if (!frame || !ficha) return;

  frame.style.width  = '';
  frame.style.height = '';
  ficha.style.transform = 'none'; // medir tamaño real, sin escalar todavía

  const maxW = Math.min(frame.parentElement?.clientWidth || 1700, 1700);

  const fichaRect = ficha.getBoundingClientRect();
  if (!fichaRect.width || !fichaRect.height) return;

  const scale = maxW / fichaRect.width; // solo ancho, sin tope de alto
  ficha.style.transform = `scale(${scale})`;

  frame.style.width  = `${fichaRect.width * scale}px`;
  frame.style.height = `${fichaRect.height * scale}px`;
}
