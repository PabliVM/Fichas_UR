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
 * Exporta el elemento .ficha-detalle a un PDF de una sola página,
 * A4 apaisado (297×210mm), con el mismo aspecto que se ve en pantalla.
 * @param {HTMLElement} fichaEl — el propio nodo .ficha-detalle
 * @param {string} filename
 */
export async function exportFichaAsPDF(fichaEl, filename = 'ficha-jugador.pdf') {
  await ensurePdfLibs();

  const prevTransform = fichaEl.style.transform;
  fichaEl.style.transform = 'none'; // capturar a tamaño natural, máxima calidad

  try {
    const canvas = await window.html2canvas(fichaEl, {
      backgroundColor: '#24313d',
      scale: 1,
      useCORS: true,
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Rellenar toda la hoja con el mismo color de fondo de la ficha,
    // así si sobra margen queda integrado en vez de verse blanco.
    doc.setFillColor(36, 49, 61); // #24313d
    doc.rect(0, 0, 297, 210, 'F');

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

    doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h);
    doc.save(filename);
  } finally {
    fichaEl.style.transform = prevTransform;
  }
}
