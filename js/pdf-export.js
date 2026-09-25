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
 * Exporta el elemento .ficha-detalle a un PDF de una sola página,
 * A4 apaisado (297×210mm), con el mismo aspecto que se ve en pantalla.
 * @param {HTMLElement} fichaEl — el propio nodo .ficha-detalle
 * @param {string} filename
 */
export async function exportFichaAsPDF(fichaEl, filename = 'ficha-jugador.pdf') {
  await ensurePdfLibs();

  const prevTransform = fichaEl.style.transform;
  fichaEl.style.transform = 'none'; // capturar a tamaño natural, máxima calidad
  const restoreInputs = swapInputsForStaticText(fichaEl);

  try {
    const canvas = await window.html2canvas(fichaEl, {
      backgroundColor: '#24313d',
      scale: 1,
      useCORS: true,
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const marginMm = 2;
    const pageW = 297 - marginMm * 2;
    const pageH = 210 - marginMm * 2;

    const imgRatio = canvas.width / canvas.height;
    let w = pageW;
    let h = w / imgRatio;
    if (h > pageH) {
      h = pageH;
      w = h * imgRatio;
    }
    const x = (297 - w) / 2;
    const y = (210 - h) / 2;

    // JPEG, no PNG: jsPDF incrusta la imagen sin re-comprimirla, y con
    // PNG a este tamaño (7200×5014px) el PDF salía de ~144MB — un archivo
    // así de pesado es lo que hacía que "se cortara" al abrirlo (muchos
    // visores no aguantan una imagen de ese peso). JPEG calidad 0.92 se ve
    // igual y pesa un par de MB.
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h);
    doc.save(filename);
  } finally {
    fichaEl.style.transform = prevTransform;
    restoreInputs();
  }
}
