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
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 105;
  const rInner = 58;

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
    return `<text x="${p.x}" y="${p.y}" font-size="11" font-weight="700" fill="#0f1117" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotate} ${p.x} ${p.y})">${text}</text>`;
  };

  const photo = photoUrl
    ? `<clipPath id="ficha-photo-clip"><circle cx="${cx}" cy="${cy}" r="${rInner - 4}" /></clipPath>
       <image href="${photoUrl}" x="${cx - rInner}" y="${cy - rInner}" width="${rInner * 2}" height="${rInner * 2}" clip-path="url(#ficha-photo-clip)" preserveAspectRatio="xMidYMid slice" />`
    : `<text x="${cx}" y="${cy}" font-size="10" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">SIN FOTO</text>`;

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

// ── BLOQUE CON RADAR (mental / técnico / táctico) ──

function buildRatedBlock({ title, rp, items, side, thresholds }) {
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
    <section class="ficha-quadrant ${side === 'left' ? 'q-left' : 'q-right'}">
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

// ── BLOQUE CONDICIONAL (valores GPS, sin radar) ──

function okIcon(ok) {
  if (ok === null || ok === undefined) return '';
  return ok
    ? '<span class="gps-ok">✔</span>'
    : '<span class="gps-fail">✘</span>';
}

function buildCondicionalBlock({ title, rp, items }) {
  const rpDisplay = rp && rp[0] != null && rp[1] != null
    ? `${formatNum(rp[0])} / ${formatNum(rp[1])}`
    : '-';

  const rows = items.map(item => `
    <div class="gps-row">
      <span class="gps-val">${item.valueA ?? '-'}</span>${okIcon(item.valueAOk)}
      <span class="gps-val">${item.valueB ?? '-'}</span>${okIcon(item.valueBOk)}
      <span class="gps-label">• ${safeText(item.label)}</span>
      <span class="gps-ref">${item.refA ?? ''}</span>
      <span class="gps-ref">${item.refB ?? ''}</span>
    </div>
  `).join('');

  return `
    <section class="ficha-quadrant q-left ficha-condicional">
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
  { key: 'tecnico',     label: 'TÉCNICO',     icon: '⚽' },
  { key: 'tactico',     label: 'TÁCTICO',     icon: '🗺️' },
  { key: 'condicional', label: 'CONDICIONAL', icon: '🚀' },
  { key: 'mental',      label: 'MENTAL',      icon: '🧠' },
];

function buildPlanAccion(plan, logoPath) {
  const cols = PLAN_COLUMNS.map(col => {
    const items = (plan?.[col.key] ?? ['', '', '']);
    const lis = items.map(txt =>
      `<li contenteditable="true" data-plan="${col.key}">${safeText(txt)}</li>`
    ).join('');
    return `
      <div class="plan-col">
        <div class="plan-col-header">
          <span>${col.label}</span><span class="plan-col-icon">${col.icon}</span>
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
          <div class="plan-crest"><img src="${logoPath}" alt="" /></div>
        </div>
        ${cols}
      </div>
    </section>
  `;
}

// ── FORMATEO ──────────────────────────────────────

function formatNum(n) {
  if (n == null) return '-';
  return Number(n).toFixed(2).replace(/\.00$/, '').replace('.', ',');
}

// ── RENDER PRINCIPAL ──────────────────────────────

/**
 * Renderiza la página de detalle (4 cuadrantes) dentro de `container`.
 * @param {HTMLElement} container
 * @param {Object} data — { player, blocks: {mental, tecnico, tactico, condicional}, plan }
 * @param {string} logoPath — ruta del escudo (LOGO_PATH de constants.js)
 */
export function renderFichaDetalle(container, data, logoPath, thresholds) {
  const { player, blocks, plan } = data;

  container.innerHTML = `
    <div class="ficha-detalle">
      <div class="ficha-grid">
        ${buildRatedBlock({ title: 'MENTAL',  rp: blocks.mental.rp,  items: blocks.mental.items,  side: 'left',  thresholds })}
        ${buildRatedBlock({ title: 'TÉCNICO', rp: blocks.tecnico.rp, items: blocks.tecnico.items, side: 'right', thresholds })}
        ${buildCondicionalBlock({ title: 'CONDICIONAL', rp: blocks.condicional.rp, items: blocks.condicional.items })}
        ${buildRatedBlock({ title: 'TÁCTICO', rp: blocks.tactico.rp, items: blocks.tactico.items, side: 'right', thresholds })}
        <div class="ficha-central">${buildCentralCircle(player?.photoUrl)}</div>
      </div>
      ${buildPlanAccion(plan, logoPath)}
    </div>
  `;
}
