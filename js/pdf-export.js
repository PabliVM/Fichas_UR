// ================================================
// PDF-EXPORT.JS — Exporta la ficha a PDF (A4 apaisado, 1 página)
//
// Usa html2canvas + jsPDF, cargadas desde CDN solo la primera vez
// que se exporta (no en cada carga de la app). Genera el PDF
// directamente en el navegador, sin pasar por el diálogo de
// impresión — así el resultado es siempre exactamente lo que se
// ve en pantalla, una sola página, A4 apaisado, sin depender de
// que el driver de la impresora respete la orientación o la
// escala (que es justo lo que ha fallado hasta ahora).
// ================================================

const CDN = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

async function ensurePdfLibs() {
  if (!window.html2canvas) await loadScriptOnce(CDN.html2canvas);
  if (!window.jspdf) await loadScriptOnce(CDN.jspdf);
}

/**
 * html2canvas no pinta bien el texto de un <input> (aparece descentrado,
 * a veces duplicado) — se sustituye cada input por un span idéntico con
 * su valor actual justo antes de capturar, y se restaura al terminar.
 * @param {HTMLElement} fichaEl
 * @returns {() => void} función para deshacer el cambio
 */
function swapInputsForStaticText(fichaEl) {
  const inputs = Array.from(fichaEl.querySelectorAll('input.gps-input'));
  const swapped = inputs.map(input => {
    const span = document.createElement('span');
    span.className = input.className.replace('gps-input', 'gps-input gps-input-static');
    span.textContent = input.value ?? '';
    if (input.style.color) span.style.color = input.style.color;
    input.insertAdjacentElement('afterend', span);
    input.style.display = 'none';
    return { input, span };
  });
  return () => {
    swapped.forEach(({ input, span }) => {
      span.remove();
      input.style.display = '';
    });
  };
}

/**
 * html2canvas no soporta <textPath> (el texto curvo de MENTAL/TÉCNICO/
 * CONDICIONAL/TÁCTICO y R/P en el círculo central): en el PDF sale sin
 * curvar. Se sustituye cada <text><textPath> por una letra suelta por
 * carácter, colocada y girada donde el navegador la pinta sobre el arco
 * (getStartPositionOfChar / getRotationOfChar), y se restaura al terminar.
 * @param {HTMLElement} fichaEl
 * @returns {() => void} función para deshacer el cambio
 */
function flattenTextPaths(fichaEl) {
  const restores = [];
  const NS = 'http://www.w3.org/2000/svg';
  fichaEl.querySelectorAll('svg text > textPath').forEach(textPath => {
    const oldText = textPath.parentElement;
    const svg = oldText.closest('svg');
    const total = (typeof oldText.getNumberOfChars === 'function') ? oldText.getNumberOfChars() : 0;
    if (!svg || !total) return;

    // Cada letra se coloca donde el navegador la pinta sobre el arco (posición + giro reales),
    // así el texto sigue la curvatura del círculo también en el PDF.
    const g = document.createElementNS(NS, 'g');
    const chars = Array.from(oldText.textContent || '');
    for (let i = 0; i < total && i < chars.length; i++) {
      if (chars[i].trim() === '') continue;
      const pos = oldText.getStartPositionOfChar(i);
      const rot = oldText.getRotationOfChar(i);
      const t = document.createElementNS(NS, 'text');
      Array.from(oldText.attributes).forEach(attr => {
        if (!['x', 'y', 'dx', 'dy', 'text-anchor', 'transform', 'textLength'].includes(attr.name)) t.setAttribute(attr.name, attr.value);
      });
      t.setAttribute('x', pos.x);
      t.setAttribute('y', pos.y);
      t.setAttribute('text-anchor', 'start');
      t.setAttribute('transform', `rotate(${rot} ${pos.x} ${pos.y})`);
      t.textContent = chars[i];
      g.appendChild(t);
    }
    oldText.replaceWith(g);
    restores.push({ g, oldText });
  });
  return () => {
    restores.forEach(({ g, oldText }) => g.replaceWith(oldText));
  };
}

/** Captura una ficha a tamaño natural (con inputs y textos curvos ya preparados) y la deja como estaba. */
async function capturarFicha(fichaEl) {
  const prevTransform = fichaEl.style.transform;
  fichaEl.style.transform = 'none'; // capturar a tamaño natural, máxima calidad
  const restoreInputs = swapInputsForStaticText(fichaEl);
  const restoreTextPaths = flattenTextPaths(fichaEl);
  try {
    return await window.html2canvas(fichaEl, {
      backgroundColor: '#24313d',
      scale: 1,
      useCORS: true,
    });
  } finally {
    fichaEl.style.transform = prevTransform;
    restoreInputs();
    restoreTextPaths();
  }
}

/**
 * Exporta una o varias fichas a UN solo PDF, A4 apaisado (297×210mm),
 * una ficha por página, con el mismo aspecto que se ve en pantalla.
 * @param {HTMLElement[]} fichaEls — nodos .ficha-detalle, en el orden de las páginas
 * @param {string} filename
 */
/**
 * Miniatura JPEG de una diapositiva/ficha (para la pestaña Observaciones).
 * Se captura sobre un clon a tamaño natural (transform: none solo en el clon), así la pantalla no parpadea.
 * @param {HTMLElement} el — .pl-slide, .p1-detalle o .ficha-detalle
 * @param {number} ancho — ancho final en px
 * @returns {Promise<string>} data URL JPEG
 */
export async function capturarMiniatura(el, ancho = 520) {
  await ensurePdfLibs();
  const natural = el.offsetWidth || 1920; // offsetWidth ignora el transform
  const canvas = await window.html2canvas(el, {
    backgroundColor: '#24313d',
    scale: ancho / natural,
    useCORS: true,
    onclone: (_doc, clon) => { if (clon && clon.style) clon.style.transform = 'none'; },
  });
  return canvas.toDataURL('image/jpeg', 0.6);
}

export async function exportFichasAsPDF(fichaEls, filename = 'fichas-jugador.pdf') {
  await ensurePdfLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const marginMm = 2;
  const pageW = 297 - marginMm * 2;
  const pageH = 210 - marginMm * 2;

  for (let i = 0; i < fichaEls.length; i++) {
    const canvas = await capturarFicha(fichaEls[i]);
    // Pie pequeño con la fecha de la EVALUACIÓN (no la de impresión): texto en data-pie del elemento o de un ancestro.
    const pie = fichaEls[i].dataset?.pie || fichaEls[i].closest?.('[data-pie]')?.dataset.pie || '';
    const pieH = pie ? 5 : 0;
    const imgRatio = canvas.width / canvas.height;
    let w = pageW;
    let h = w / imgRatio;
    if (h > pageH - pieH) {
      h = pageH - pieH;
      w = h * imgRatio;
    }
    const x = (297 - w) / 2;
    const y = (210 - pieH - h) / 2;
    if (i > 0) doc.addPage('a4', 'landscape');
    if (pie) {
      doc.setFontSize(7); doc.setTextColor(90, 100, 110);
      doc.text(pie, 297 / 2, 210 - 2.5, { align: 'center' });
    }
    // JPEG, no PNG: con PNG a este tamaño el PDF salía de ~144MB y muchos visores no lo aguantan.
    // JPEG calidad 0.92 se ve igual y pesa un par de MB por página.
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h);
  }
  doc.save(filename);
}

/**
 * Exporta el elemento .ficha-detalle a un PDF de una sola página.
 * @param {HTMLElement} fichaEl — el propio nodo .ficha-detalle
 * @param {string} filename
 */
export async function exportFichaAsPDF(fichaEl, filename = 'ficha-jugador.pdf') {
  return exportFichasAsPDF([fichaEl], filename);
}
