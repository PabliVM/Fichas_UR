// ================================================
// FICHA-PAGINA1.JS — Página 1 de la ficha individual
// Identidad del jugador, descripción, competencias
// ofensivas/defensivas, personalidad, aspectos
// individuales y campo con la posición.
//
// Los indicadores ✔ / cuadro de color son de estado
// (no una media numérica como en la página 2): los fija
// el técnico a mano, por eso no usan las bandas de color
// configurables (state.scoreBands) — esas solo aplican a
// medias numéricas.
// ================================================

import { safeText } from './utils.js';
import { fitFichaToFrame } from './ficha-detalle.js';

const STATUS_HEX = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };

// Header propio de la página 1 (clases p1-header-*, ver css/ficha1.css).
// Antes usaba buildFichaHeader (compartido con la página 2) — se separó
// para poder escalar sus tamaños ×0.6528 sin tocar la ficha 2.
function buildP1Header(logoPath, pageLabel) {
  return `
    <header class="p1-header">
      <img src="${logoPath}" alt="" class="p1-header-crest" />
      <span class="p1-header-title">INFORME INDIVIDUAL DEL JUGADOR</span>
      ${pageLabel ? `<span class="p1-header-page">${safeText(pageLabel)}</span>` : ''}
    </header>
  `;
}

function statusMarkup(status) {
  if (status === true) return '<span class="p1-check">✔</span>';
  if (status === false || status === 'red') return `<span class="p1-status-box" style="background:${STATUS_HEX.red}"></span>`;
  if (status === 'yellow') return `<span class="p1-status-box" style="background:${STATUS_HEX.yellow}"></span>`;
  if (status === 'green') return `<span class="p1-status-box" style="background:${STATUS_HEX.green}"></span>`;
  return '<span class="p1-status-box p1-status-none"></span>'; // sin dato
}

function barColorHex(color) {
  return color ? STATUS_HEX[color] : '#475569'; // gris si no hay dato
}

// ── CÍRCULO MINI (mismo concepto que la página 2, más pequeño) ──

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildMiniCircle(photoUrl, blockRp) {
  const size = 880;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 424;
  const rInner = 236;
  const midR = (rOuter + rInner) / 2;

  const colorFor = key => barColorHex(blockRp[key]);

  const seg = (a, b, color) => {
    const p1 = polar(cx, cy, rOuter, a);
    const p2 = polar(cx, cy, rOuter, b);
    const p3 = polar(cx, cy, rInner, b);
    const p4 = polar(cx, cy, rInner, a);
    const large = b - a > 180 ? 1 : 0;
    return `<path d="M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z" fill="${color}" stroke="#94a3b8" stroke-width="1.5" />`;
  };
  const arcPath = (id, a, b) => {
    const p1 = polar(cx, cy, midR, a);
    const p2 = polar(cx, cy, midR, b);
    const large = Math.abs(b - a) > 180 ? 1 : 0;
    const sweep = b > a ? 1 : 0;
    return `<path id="${id}" d="M ${p1.x} ${p1.y} A ${midR} ${midR} 0 ${large} ${sweep} ${p2.x} ${p2.y}" fill="none" />`;
  };
  const label = (id, text, color) => {
    const fill = color ? '#0f1117' : '#334155';
    return `<text font-size="50" font-weight="700" fill="${fill}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${text}</textPath></text>`;
  };
  const photo = photoUrl
    ? `<clipPath id="p1-photo-clip"><circle cx="${cx}" cy="${cy}" r="${rInner - 4}" /></clipPath>
       <image href="${photoUrl}" x="${cx - rInner}" y="${cy - rInner}" width="${rInner * 2}" height="${rInner * 2}" clip-path="url(#p1-photo-clip)" preserveAspectRatio="xMidYMid slice" />`
    : `<text x="${cx}" y="${cy}" font-size="46" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">SIN FOTO</text>`;

  return `
    <svg viewBox="0 0 ${size} ${size}" class="p1-central-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${arcPath('p1-arc-mental', 270, 360)}
        ${arcPath('p1-arc-tecnico', 0, 90)}
        ${arcPath('p1-arc-tactico', 180, 90)}
        ${arcPath('p1-arc-condicional', 270, 180)}
      </defs>
      ${seg(270, 360, colorFor('mental'))}
      ${seg(0, 90, colorFor('tecnico'))}
      ${seg(90, 180, colorFor('tactico'))}
      ${seg(180, 270, colorFor('condicional'))}
      <circle cx="${cx}" cy="${cy}" r="${rInner + 4}" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5" />
      ${photo}
      ${label('p1-arc-mental', 'MENTAL', blockRp.mental)}
      ${label('p1-arc-tecnico', 'TÉCNICO', blockRp.tecnico)}
      ${label('p1-arc-tactico', 'TÁCTICO', blockRp.tactico)}
      ${label('p1-arc-condicional', 'CONDICIONAL', blockRp.condicional)}
    </svg>
  `;
}

// ── BLOQUES ───────────────────────────────────────

function buildFacts(player) {
  const rows = [
    player.birthDate || '-',
    `E.Madurativa: ${player.maturationalAge ?? '-'}`,
    player.position || '-',
    `${player.height != null ? player.height + ' m' : '-'} ${player.heightOk === null ? '' : statusMarkup(player.heightOk)}`,
    `${player.weight != null ? player.weight + ' kg' : '-'}`,
    player.foot || '-',
  ];
  return `<ul class="p1-facts">${rows.map(r => `<li>${r}</li>`).join('')}</ul>`;
}

function buildRpBadges(player) {
  return `
    <div class="p1-rp-row">
      <div class="p1-rp-badge p1-rp-badge-r">R</div>
      <div class="p1-rp-badge p1-rp-badge-p">P</div>
    </div>
    <div class="p1-rp-row">
      <div class="p1-rp-box p1-rp-box-r">${player.rValue ?? '-'}</div>
      <div class="p1-rp-box p1-rp-box-p">${player.pValue ?? '-'}</div>
    </div>
  `;
}

function buildStatusBars(bars) {
  return `
    <div class="p1-status-bars">
      ${bars.map(b => `<div class="p1-status-bar" style="background:${barColorHex(b.color)}">${safeText(b.label)}</div>`).join('')}
    </div>
  `;
}

function buildPersonalidad(personalidad) {
  const col = items => items.map(it =>
    `<li>${safeText(it.label)} ${statusMarkup(it.status)}</li>`
  ).join('');
  return `
    <section class="p1-section">
      <header class="p1-subheader">PERSONALIDAD</header>
      <div class="p1-personalidad-grid">
        <ul class="p1-plain-list">${col(personalidad.col1)}</ul>
        <ul class="p1-plain-list">${col(personalidad.col2)}</ul>
      </div>
    </section>
  `;
}

function buildCompetencias(title, items) {
  const cells = items.map(it => `
    <div class="p1-comp-cell">
      <div class="p1-comp-label">${safeText(it.label)}</div>
      <div class="p1-comp-status">${statusMarkup(it.status)}</div>
    </div>
  `).join('');
  return `
    <section class="p1-section">
      <header class="p1-subheader">${safeText(title)}</header>
      <div class="p1-comp-grid" style="grid-template-columns: repeat(${items.length}, 1fr);">${cells}</div>
    </section>
  `;
}

function buildAspectos(title, data) {
  const col = (arr, key) => arr.map(txt =>
    `<li contenteditable="true" data-aspecto="${key}">${safeText(txt)}</li>`
  ).join('');
  return `
    <section class="p1-section">
      <header class="p1-subheader">${safeText(title)}</header>
      <div class="p1-aspectos-grid">
        <div class="p1-aspectos-col">
          <div class="p1-aspectos-col-header">POTENCIAR</div>
          <ul class="p1-editable-list">${col(data.potenciar, 'potenciar')}</ul>
        </div>
        <div class="p1-aspectos-col">
          <div class="p1-aspectos-col-header">MEJORAR</div>
          <ul class="p1-editable-list">${col(data.mejorar, 'mejorar')}</ul>
        </div>
      </div>
    </section>
  `;
}

function buildBottom(logoPath) {
  return `
    <div class="p1-bottom">
      <div class="p1-pitch">
        <div class="p1-pitch-marker" title="Posición del jugador (sin dato aún)"></div>
      </div>
      <div class="p1-legend">
        <img class="p1-legend-crest" src="${logoPath}" alt="" />
        <div class="p1-legend-item"><span class="p1-legend-dot" style="background:${STATUS_HEX.green}"></span>POTENCIAR</div>
        <div class="p1-legend-item"><span class="p1-legend-dot" style="background:${STATUS_HEX.yellow}"></span>DESARROLLAR</div>
        <div class="p1-legend-item"><span class="p1-legend-dot" style="background:${STATUS_HEX.red}"></span>MEJORAR</div>
      </div>
    </div>
  `;
}

// ── RENDER PRINCIPAL ──────────────────────────────

/**
 * Renderiza la página 1 (identidad + descripción + competencias +
 * personalidad + aspectos individuales + campo) dentro de `container`.
 * @param {HTMLElement} container
 * @param {Object} data — ver ficha-pagina1-demo-data.js para la forma
 * @param {string} logoPath
 */
export function renderFichaPagina1(container, data, logoPath, colors) {
  const { player } = data;

  const colorStyle = colors ? ` style="--slate:${colors.slate}; --wine:${colors.wine}; --text-general:${colors.textGeneral}; --text-header:${colors.textHeader}; --text-aspectos:${colors.textAspectos}; --text-subheader-white:${colors.textSubheaderWhite};"` : '';

  container.innerHTML = `
    <div class="ficha-a4-frame">
      <div class="ficha-detalle p1-detalle"${colorStyle}>
        ${buildP1Header(logoPath, '1/2')}
        <div class="p1-top">
          <div class="p1-left">
            <header class="p1-name-header">${safeText(player.name) || '&nbsp;'}</header>
            ${buildFacts(player)}
            ${buildRpBadges(player)}
            ${buildStatusBars(data.statusBars)}
            ${buildPersonalidad(data.personalidad)}
          </div>
          <div class="p1-right">
            <header class="p1-desc-header">DESCRIPCIÓN DEL JUGADOR</header>
            <div class="p1-desc-text" contenteditable="true">${safeText(data.description)}</div>
            ${buildCompetencias('COMPETENCIAS OFENSIVAS', data.competenciasOfensivas)}
            ${buildCompetencias('COMPETENCIAS DEFENSIVAS', data.competenciasDefensivas)}
          </div>
          <div class="p1-central">${buildMiniCircle(player.photoUrl, data.blockRp)}</div>
        </div>
        ${buildAspectos('ASPECTOS INDIVIDUALES OFENSIVOS', data.aspectosOfensivos)}
        ${buildAspectos('ASPECTOS INDIVIDUALES DEFENSIVOS', data.aspectosDefensivos)}
        ${buildBottom(logoPath)}
      </div>
    </div>
  `;

  fitFichaToFrame(container);
  window.addEventListener('resize', () => fitFichaToFrame(container));
}
