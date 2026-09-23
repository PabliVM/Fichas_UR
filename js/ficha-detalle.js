// ================================================
// FICHA-DETALLE.JS — Página 2 de la ficha individual
// 4 bloques: MENTAL, TÉCNICO, CONDICIONAL, TÁCTICO
// + círculo central + Plan de acción.
//
// Colores de media: usan SCORE_THRESHOLDS (constants.js).
// El círculo central usa colores FIJOS de diseño
// (no derivados de las medias) — verde arriba-izda/abajo-izda,
// amarillo arriba-dcha/abajo-dcha — tal como se pidió.
// ================================================

import { scoreColor, safeText } from './utils.js';
import { buildRadarSVG } from './radar-chart.js';

// ── CÍRCULO CENTRAL ──────────────────────────────

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildCentralCircle(photoUrl) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 125;
  const rInner = 68;

  const seg = (startDeg, endDeg, color) => {
    const p1 = polar(cx, cy, rOuter, startDeg);
    const p2 = polar(cx, cy, rOuter, endDeg);
    const p3 = polar(cx, cy, rInner, endDeg);
    const p4 = polar(cx, cy, rInner, startDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `<path d="M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z" fill="${color}" />`;
  };

  const label = (midDeg, text, rotate) => {
    const p = polar(cx, cy, (rOuter + rInner) / 2, midDeg);
    return `<text x="${p.x}" y="${p.y}" font-size="13" font-weight="700" fill="#0f1117" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotate} ${p.x} ${p.y})">${text}</text>`;
  };

  const photo = photoUrl
    ? `<clipPath id="ficha-photo-clip"><circle cx="${cx}" cy="${cy}" r="${rInner - 4}" /></clipPath>
       <image href="${photoUrl}" x="${cx - rInner}" y="${cy - rInner}" width="${rInner * 2}" height="${rInner * 2}" clip-path="url(#ficha-photo-clip)" preserveAspectRatio="xMidYMid slice" />`
    : `<text x="${cx}" y="${cy}" font-size="12" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">SIN FOTO</text>`;

  return `
    <svg viewBox="0 0 ${size} ${size}" class="ficha-central-svg" xmlns="http://www.w3.org/2000/svg">
      ${seg(270, 360, '#22c55e')}
      ${seg(0, 90, '#eab308')}
      ${seg(90, 180, '#eab308')}
      ${seg(180, 270, '#22c55e')}
      <circle cx="${cx}" cy="${cy}" r="${rInner + 4}" fill="#ffffff" />
      ${photo}
      ${label(315, 'MENTAL', -35)}
      ${label(45, 'TÉCNICO', 35)}
      ${label(135, 'TÁCTICO', -35)}
      ${label(225, 'CONDICIONAL', 35)}
    </svg>
  `;
}

/**
 * Coloca el círculo central exactamente en el cruce de los 4
 * cuadrantes, midiendo el DOM real (fiable pase lo que pase con
 * las alturas de MENTAL/TÉCNICO/CONDICIONAL/TÁCTICO).
 */
function centerFichaCircle(root) {
  const grid   = root.querySelector('.ficha-grid');
  const mental = root.querySelector('.q-mental');
  const circle = root.querySelector('.ficha-central');
  if (!grid || !mental || !circle) return;

  const gridRect   = grid.getBoundingClientRect();
  const mentalRect = mental.getBoundingClientRect();

  const crossX = mentalRect.right  - gridRect.left; // borde derecho de MENTAL = línea vertical
  const crossY = mentalRect.bottom - gridRect.top;   // borde inferior de MENTAL = línea horizontal
  const half = circle.offsetWidth / 2;

  circle.style.left = `${crossX - half}px`;
  circle.style.top  = `${crossY - half}px`;
}

// ── BLOQUE CON RADAR (mental / técnico / táctico) ──

function buildRatedBlock({ title, rp, items, side, thresholds, blockKey }) {
  const rpDisplay = rp && rp[0] != null && rp[1] != null
    ? `${formatNum(rp[0])} / ${formatNum(rp[1])}`
    : '-';

  const listHTML = items.map(item => {
    const color = scoreColor(item.value, thresholds);
    const valueText = item.value == null ? '-' : formatNum(item.value);
    const colorClass = color ? `score-${color}` : 'score-none';
    return side === 'left'
      ? `<li><span class="ficha-score ${colorClass}">${valueText}</span><span class="ficha-item-label">${safeText(item.label)}</span></li>`
      : `<li><span class="ficha-item-label">${safeText(item.label)}</span><span class="ficha-score ${colorClass}">${valueText}</span></li>`;
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
      <span class="gps-val-cell">
        <input class="gps-input" type="text" data-row="${i}" data-field="valueA" value="${item.valueA ?? ''}" />
        ${gpsIconMarkup(item.valueAOk)}
      </span>
      <span class="gps-val-cell">
        <input class="gps-input" type="text" data-row="${i}" data-field="valueB" value="${item.valueB ?? ''}" />
        ${gpsIconMarkup(item.valueBOk)}
      </span>
      <span class="gps-label">• ${safeText(item.label)}</span>
      <span class="gps-ref-cell">
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
      <div class="gps-grid">${rows}</div>
    </section>
  `;
}

// ── PLAN DE ACCIÓN ────────────────────────────────

const PLAN_COLUMNS = [
  { key: 'tecnico',     label: 'TÉCNICO',     icon: './img/balon.png'   },
  { key: 'tactico',     label: 'TÁCTICO',     icon: './img/pizarra.jpg' },
  { key: 'condicional', label: 'CONDICIONAL', icon: './img/cohete.png'  },
  { key: 'mental',      label: 'MENTAL',      icon: './img/cerebro.png' },
];

function buildPlanAccion(plan) {
  const cols = PLAN_COLUMNS.map(col => {
    const items = (plan?.[col.key] ?? ['', '', '', '', '', '']);
    const lis = items.map(txt =>
      `<li contenteditable="true" data-plan="${col.key}">${safeText(txt)}</li>`
    ).join('');
    return `
      <div class="plan-col">
        <div class="plan-col-header">
          <span>${col.label}</span><img class="plan-col-icon" src="${col.icon}" alt="" />
        </div>
        <ul class="plan-col-list">${lis}</ul>
      </div>
    `;
  }).join('');

  return `
    <section class="ficha-plan">
      <header class="ficha-plan-title">PLAN DE ACCIÓN</header>
      <div class="ficha-plan-grid">
        <div class="plan-col plan-col-crest">
          <div class="plan-col-header plan-col-header-dark">ASPECTOS DEL<br/>JUGADOR</div>
        </div>
        ${cols}
      </div>
    </section>
  `;
}

// ── HEADER DE LA FICHA (azul corporativo, arriba del todo) ──

function buildFichaHeader(logoPath, pageLabel) {
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
 * @param {Object} thresholds — { green, yellow }
 * @param {string} [pageLabel] — indicador de página, ej. '2/2'. Vacío/omitido = no se muestra.
 */
export function renderFichaDetalle(container, data, logoPath, thresholds, pageLabel = '2/2') {
  const { player, blocks, plan } = data;

  container.innerHTML = `
    <div class="ficha-detalle">
      ${buildFichaHeader(logoPath, pageLabel)}
      <div class="ficha-grid">
        ${buildRatedBlock({ title: 'MENTAL',  rp: blocks.mental.rp,  items: blocks.mental.items,  side: 'left',  thresholds, blockKey: 'mental'  })}
        ${buildRatedBlock({ title: 'TÉCNICO', rp: blocks.tecnico.rp, items: blocks.tecnico.items, side: 'right', thresholds, blockKey: 'tecnico' })}
        ${buildCondicionalBlock({ title: 'CONDICIONAL', rp: blocks.condicional.rp, items: blocks.condicional.items })}
        ${buildRatedBlock({ title: 'TÁCTICO', rp: blocks.tactico.rp, items: blocks.tactico.items, side: 'right', thresholds, blockKey: 'tactico' })}
        <div class="ficha-central">${buildCentralCircle(player?.photoUrl)}</div>
      </div>
      ${buildPlanAccion(plan)}
    </div>
  `;

  wireCondicionalInputs(container);

  const fichaRoot = container.querySelector('.ficha-detalle');
  centerFichaCircle(fichaRoot);
  window.addEventListener('resize', () => centerFichaCircle(fichaRoot));
}
