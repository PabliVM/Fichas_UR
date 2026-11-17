// ================================================
// RADAR-CHART.JS — Gráfico de tela de araña en SVG
// Sin librerías externas.
// ================================================

/**
 * Construye un SVG de radar a partir de items {label, value}.
 * @param {{label:string, value:number|null}[]} items
 * @param {Object} opts
 */
export function buildRadarSVG(items, opts = {}) {
  const size        = opts.size        ?? 300; // diámetro del área de datos
  const padX        = opts.padX        ?? 75;  // margen extra: etiquetas largas a los lados
  const padY         = opts.padY        ?? 25;  // margen extra arriba/abajo
  const max         = opts.max         ?? 5;
  const rings       = opts.rings       ?? 5;
  const fill        = opts.fill        ?? 'rgba(139,42,68,0.55)';
  const stroke      = opts.stroke      ?? '#c96c8a';
  const gridColor   = opts.gridColor   ?? 'rgba(255,255,255,0.18)';
  const labelColor  = opts.labelColor  ?? 'rgba(255,255,255,0.85)';

  const n = items.length;
  if (n < 3) return '<svg></svg>';

  const r  = size * 0.32;
  const labelR = size * 0.44;
  const angleFor = i => (Math.PI * 2 * i) / n - Math.PI / 2;
  // Etiquetas largas en el lado de la lista de aspectos (opts.ladoLista: 'left' | 'right'; p. ej. Táctico del
  // portero): si alguna se saldría del dibujo y pisaría la lista, se amplía SOLO ese margen. El otro lado no cambia.
  let padL = padX, padR = padX;
  if (opts.ladoLista === 'left' || opts.ladoLista === 'right') {
    items.forEach((item, i) => {
      const cos = Math.cos(angleFor(i));
      if (Math.abs(cos * labelR) < 4 || (cos > 0) !== (opts.ladoLista === 'right')) return;
      const necesario = Math.abs(cos * labelR) + Math.max(...wrapLabel(item.label).map(medirTexto)) - size / 2 + 10;
      if (opts.ladoLista === 'right') padR = Math.max(padR, necesario); else padL = Math.max(padL, necesario);
    });
  }

  const cx = padL + size / 2;
  const cy = padY + size / 2;
  const viewW = size + padL + padR;
  const viewH = size + padY * 2;

  const point = (radius, i) => {
    const a = angleFor(i);
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };

  let gridSVG = '';
  for (let ring = 1; ring <= rings; ring++) {
    const ringR = (r * ring) / rings;
    const pts = items.map((_, i) => point(ringR, i).join(',')).join(' ');
    gridSVG += `<polygon points="${pts}" fill="none" stroke="${gridColor}" stroke-width="1" />`;
  }

  let axesSVG = '';
  items.forEach((_, i) => {
    const [x, y] = point(r, i);
    axesSVG += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${gridColor}" stroke-width="1" />`;
  });

  const dataPts = items
    .map((item, i) => {
      const v = Math.max(0, Math.min(max, item.value ?? 0));
      return point((r * v) / max, i).join(',');
    })
    .join(' ');
  const dataSVG = `<polygon points="${dataPts}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;

  let labelsSVG = '';
  items.forEach((item, i) => {
    const [x, y] = point(labelR, i);
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : (x > cx ? 'start' : 'end');
    const lines = wrapLabel(item.label);
    const tspans = lines
      .map((line, li) => `<tspan x="${x.toFixed(1)}" dy="${li === 0 ? -((lines.length - 1) * 5.5) : 11}">${escapeXml(line)}</tspan>`)
      .join('');
    labelsSVG += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="13" fill="${labelColor}" text-anchor="${anchor}" dominant-baseline="middle">${tspans}</text>`;
  });

  return `
    <svg viewBox="0 0 ${viewW} ${viewH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;overflow:visible;">
      ${gridSVG}
      ${axesSVG}
      ${dataSVG}
      ${labelsSVG}
    </svg>
  `;
}

/** Ancho aproximado (unidades del SVG) de una línea de etiqueta a 13px con la letra de la ficha. */
let _ctx = null;
function medirTexto(texto) {
  try {
    if (!_ctx) {
      _ctx = document.createElement('canvas').getContext('2d');
      const fuente = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
      _ctx.font = `13px ${fuente}`;
    }
    return _ctx.measureText(String(texto)).width;
  } catch (_) {
    return String(texto).length * 7; // sin canvas: estimación
  }
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Si la etiqueta es larga, la parte en 2 líneas por el espacio
 * más cercano al centro del texto. Si no hay espacio o es corta,
 * la deja en una sola línea.
 */
function wrapLabel(label, maxLen = 14) {
  const text = String(label ?? '');
  if (text.length <= maxLen) return [text];

  const spaces = [...text].reduce((acc, ch, i) => (ch === ' ' ? [...acc, i] : acc), []);
  if (spaces.length === 0) return [text];

  const mid = text.length / 2;
  const splitAt = spaces.reduce((best, i) =>
    Math.abs(i - mid) < Math.abs(best - mid) ? i : best
  , spaces[0]);

  return [text.slice(0, splitAt).trim(), text.slice(splitAt + 1).trim()];
}
