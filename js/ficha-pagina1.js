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

// Símbolos por banda ('check'|'dash'|'x'|'box'), los pone renderFichaPagina1 desde data.simbolos
// (Configuración → Colores de las medias). Sin dato → cuadro de color como siempre.
let SIMBOLOS = null;
function statusMarkup(status) {
  if (status === true) return '<span class="p1-check">✔</span>';
  const key = status === false ? 'red' : status;
  if (key === 'green' || key === 'yellow' || key === 'red') {
    const sim = SIMBOLOS?.[key] || 'box';
    const hex = STATUS_HEX[key];
    if (sim === 'check') return `<span class="p1-sym" style="color:${hex}">✔</span>`;
    if (sim === 'dash')  return `<span class="p1-sym" style="color:${hex}">–</span>`;
    if (sim === 'x')     return `<span class="p1-sym" style="color:${hex}">✘</span>`;
    return `<span class="p1-status-box" style="background:${hex}"></span>`;
  }
  return '<span class="p1-status-box p1-status-none"></span>'; // sin dato
}

function barColorHex(color) {
  return color ? STATUS_HEX[color] : '#ffffff'; // blanco si no hay dato (filas Perfil 1/2/3)
}

// Círculo central: en blanco cuando no hay dato de bloque (antes gris).
function circleColorHex(color) {
  return color ? STATUS_HEX[color] : '#ffffff';
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

  const colorFor = key => circleColorHex(blockRp[key]);

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
    return `<text font-size="43" font-weight="700" fill="${fill}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${text}</textPath></text>`;
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
    <div class="p1-rp-group">
      <div class="p1-rp-row">
        <div class="p1-rp-badge p1-rp-badge-r">R</div>
        <div class="p1-rp-badge p1-rp-badge-p">P</div>
      </div>
      <div class="p1-rp-row">
        <div class="p1-rp-box p1-rp-box-r">${player.rValue ?? '-'}</div>
        <div class="p1-rp-box p1-rp-box-p">${player.pValue ?? '-'}</div>
      </div>
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
    `<li><span class="p1-item-label">${safeText(it.label)}</span>${statusMarkup(it.status)}</li>`
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

// ── DESCRIPCIÓN + FRASES MODELO ──────────────────
// Banco de frases (Configuración → Ayuda → Frases modelo). El técnico
// marca las que aplican y "Unir" las junta en el texto editable — no hay
// IA ni cálculo automático, solo concatenar texto tal cual.
function buildDescripcionSection(description, frasesModelo) {
  const hasFrases = (frasesModelo || []).length > 0;
  return `
    <section class="p1-section">
      <div class="p1-desc-wrap">
        <header class="p1-desc-header">
          <span>DESCRIPCIÓN DEL JUGADOR</span>
          ${hasFrases ? '<button type="button" class="p1-frases-btn" title="Unir frases modelo en el texto">+ Frases</button>' : ''}
        </header>
        ${hasFrases ? buildFrasesPicker(frasesModelo) : ''}
      </div>
      <div class="p1-desc-text" contenteditable="true">${safeText(description)}</div>
    </section>
  `;
}

function buildFrasesPicker(frasesModelo) {
  const items = frasesModelo.map((f, i) => `
    <label class="p1-frase-item">
      <input type="checkbox" data-frase-idx="${i}" />
      <span>${safeText(f)}</span>
    </label>
  `).join('');
  return `
    <div class="p1-frases-picker hidden">
      <div class="p1-frases-list">${items}</div>
      <button type="button" class="p1-frases-join-btn">Unir en Descripción</button>
    </div>
  `;
}

function initFrasesPicker(container) {
  const btn = container.querySelector('.p1-frases-btn');
  const panel = container.querySelector('.p1-frases-picker');
  if (!btn || !panel) return;
  btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  const joinBtn = panel.querySelector('.p1-frases-join-btn');
  joinBtn.addEventListener('click', () => {
    const checked = [...panel.querySelectorAll('input[data-frase-idx]:checked')]
      .map(cb => cb.nextElementSibling.textContent.trim());
    if (!checked.length) return;
    const descEl = container.querySelector('.p1-desc-text');
    const current = descEl.textContent.trim();
    const joined = checked.join(' ');
    descEl.textContent = current ? `${current} ${joined}` : joined;
    panel.classList.add('hidden');
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });
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

// Campo + leyenda — antes ocupaban una fila a todo el ancho debajo de
// aspectos; ahora van apilados en la columna izquierda (p1-lower-left),
// alineados bajo Personalidad (ver renderFichaPagina1 → .p1-lower).
// Sin escudo (quitado a petición) — logoPath ya no se usa aquí.
// La(s) camiseta(s) salen ya puestas en el campo (nada que arrastrar desde
// fuera): portero → portería izquierda; jugador → centro del campo, y el
// botón "+" deja poner una segunda (máx. 2, solo para jugador de campo).
function buildPitchAndLegend(isGoalkeeper) {
  return `
    <div class="p1-pitch">
      ${isGoalkeeper ? '' : '<button type="button" class="p1-jersey-add" title="Añadir otra camiseta">+</button>'}
    </div>
    <div class="p1-legend">
      <div class="p1-legend-item"><span class="p1-legend-dot" style="background:${STATUS_HEX.green}"></span>POTENCIAR</div>
      <div class="p1-legend-item"><span class="p1-legend-dot" style="background:${STATUS_HEX.yellow}"></span>DESARROLLAR</div>
      <div class="p1-legend-item"><span class="p1-legend-dot" style="background:${STATUS_HEX.red}"></span>MEJORAR</div>
    </div>
  `;
}

// ── CAMISETA(S) EN EL CAMPO (posición del/de los jugador(es)) ──
// No persiste aquí — emite 'p1:pitch-markers-changed' con el array de
// camisetas para que el código que guarda cada ficha de jugador (aún no
// existe) lo enganche a Firestore. Si `data.pitchMarkers` viene informado,
// se pinta tal cual (para cuando sí se cargue guardada) y no se aplica la
// posición por defecto.
let nextMarkerId = 1;

// Posición por defecto en el campo según la posición del jugador (clave de
// PROFILES en constants.js). El TIPO de camiseta (imagen) sigue siendo
// binario: solo hay 2 imágenes (portero / resto).
const POSITION_DEFAULT_XY = {
  portero:     { x: 8,  y: 50 }, // portería izquierda
  central:     { x: 18, y: 50 }, // centro línea del área propia
  lateral:     { x: 25, y: 74 }, // lateral derecho
  mediocentro: { x: 50, y: 50 }, // centro del campo
  interior:    { x: 58, y: 66 }, // derecha del centro del campo, abajo
  extremo:     { x: 85, y: 74 }, // como lateral, en el otro área (más a la derecha)
  delantero:   { x: 92, y: 50 }, // como portero, en el otro área
};

function defaultMarkers(positionKey) {
  const isGoalkeeper = positionKey === 'portero';
  const xy = POSITION_DEFAULT_XY[positionKey] || POSITION_DEFAULT_XY.mediocentro;
  return isGoalkeeper
    ? [{ id: nextMarkerId++, type: 'portero', xPct: xy.x, yPct: xy.y }]
    : [{ id: nextMarkerId++, type: 'jugador', xPct: xy.x, yPct: xy.y }];
}

function renderMarkers(pitchEl, markers, onRemove) {
  pitchEl.querySelectorAll('.p1-jersey-marker').forEach(el => {
    if (!markers.some(m => String(m.id) === el.dataset.markerId)) el.remove();
  });
  const jugadorCount = markers.filter(m => m.type === 'jugador').length;
  markers.forEach(m => {
    let wrap = pitchEl.querySelector(`.p1-jersey-marker[data-marker-id="${m.id}"]`);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'p1-jersey-marker';
      wrap.draggable = true;
      wrap.dataset.markerId = String(m.id);
      wrap.innerHTML = `
        <img class="p1-jersey-img" alt="Posición del jugador" />
        <button type="button" class="p1-jersey-remove" title="Quitar camiseta">×</button>
      `;
      pitchEl.appendChild(wrap);
      wrap.querySelector('.p1-jersey-remove').addEventListener('click', e => {
        e.stopPropagation();
        onRemove(m.id);
      });
    }
    wrap.querySelector('.p1-jersey-img').src = m.type === 'portero' ? '../camisetaportero.png' : '../camiseta.png';
    wrap.style.left = `${m.xPct}%`;
    wrap.style.top = `${m.yPct}%`;
    // Solo se puede quitar una camiseta de jugador cuando hay 2 puestas (la extra).
    wrap.querySelector('.p1-jersey-remove').style.display = (m.type === 'jugador' && jugadorCount > 1) ? '' : 'none';
  });
}

function initPitchDragDrop(container, data, positionKey) {
  const pitchEl = container.querySelector('.p1-pitch');
  if (!pitchEl) return;
  const addBtn = container.querySelector('.p1-jersey-add');
  let markers = data.pitchMarkers || defaultMarkers(positionKey);

  const emitChange = () => {
    container.dispatchEvent(new CustomEvent('p1:pitch-markers-changed', {
      detail: { markers: markers.map(m => ({ ...m })) },
      bubbles: true,
    }));
  };

  const syncAddBtn = () => {
    if (!addBtn) return;
    const count = markers.filter(m => m.type === 'jugador').length;
    addBtn.style.display = count >= 2 ? 'none' : '';
  };

  const removeMarker = id => {
    markers = markers.filter(m => m.id !== id);
    renderMarkers(pitchEl, markers, removeMarker);
    syncAddBtn();
    emitChange();
  };

  renderMarkers(pitchEl, markers, removeMarker);
  syncAddBtn();

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (markers.filter(m => m.type === 'jugador').length >= 2) return;
      markers.push({ id: nextMarkerId++, type: 'jugador', xPct: 60, yPct: 65 });
      renderMarkers(pitchEl, markers, removeMarker);
      syncAddBtn();
      emitChange();
    });
  }

  // Arrastrar una camiseta ya puesta para reposicionarla.
  pitchEl.addEventListener('dragstart', e => {
    const id = e.target?.closest?.('.p1-jersey-marker')?.dataset?.markerId;
    if (!id) return;
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  });

  pitchEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  pitchEl.addEventListener('drop', e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const m = markers.find(mk => String(mk.id) === id);
    if (!m) return;
    const rect = pitchEl.getBoundingClientRect();
    m.xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    m.yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    renderMarkers(pitchEl, markers, removeMarker);
    emitChange();
  });
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
  SIMBOLOS = data.simbolos || null;
  const { player } = data;
  const isGoalkeeper = /porter[oa]/i.test(player.position || '');
  const positionKey = (player.position || '').toLowerCase().trim(); // coincide con las keys de PROFILES (constants.js)

  const colorStyle = colors ? ` style="--slate:${colors.slate}; --wine:${colors.wine}; --text-general:${colors.textGeneral}; --text-header:${colors.textHeader}; --text-aspectos:${colors.textAspectos}; --text-subheader-white:${colors.textSubheaderWhite};"` : '';

  container.innerHTML = `
    <div class="ficha-a4-frame">
      <div class="ficha-detalle p1-detalle"${colorStyle}>
        ${buildP1Header(logoPath, '1/2')}
        <div class="p1-top">
          <div class="p1-left">
            <header class="p1-name-header">${safeText(player.name) || '&nbsp;'}</header>
            <div class="p1-identity-row">
              ${buildFacts(player)}
              ${buildRpBadges(player)}
            </div>
            ${buildStatusBars(data.statusBars)}
            ${buildPersonalidad(data.personalidad)}
          </div>
          <div class="p1-right">
            ${buildDescripcionSection(data.description, data.frasesModelo)}
            ${buildCompetencias('COMPETENCIAS OFENSIVAS', data.competenciasOfensivas)}
            ${buildCompetencias('COMPETENCIAS DEFENSIVAS', data.competenciasDefensivas)}
          </div>
          <div class="p1-central">${buildMiniCircle(player.photoUrl, data.blockRp)}</div>
        </div>
        <div class="p1-lower">
          <div class="p1-lower-left">
            ${buildPitchAndLegend(isGoalkeeper)}
          </div>
          <div class="p1-lower-right">
            ${buildAspectos('ASPECTOS INDIVIDUALES OFENSIVOS', data.aspectosOfensivos)}
            ${buildAspectos('ASPECTOS INDIVIDUALES DEFENSIVOS', data.aspectosDefensivos)}
          </div>
        </div>
      </div>
    </div>
  `;

  fitFichaToFrame(container);
  window.addEventListener('resize', () => fitFichaToFrame(container));
  initPitchDragDrop(container, data, positionKey);
  initFrasesPicker(container);
}
