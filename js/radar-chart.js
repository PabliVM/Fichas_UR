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
  const padX         = opts.padX        ?? 78;  // margen extra: etiquetas largas a los lados
  const padY         = opts.padY        ?? 26;  // margen extra arriba/abajo
  const max         = opts.max         ?? 5;
  const rings       = opts.rings       ?? 5;
  const fill        = opts.fill        ?? 'rgba(139,42,68,0.55)';
  const stroke      = opts.stroke      ?? '#c96c8a';
  const gridColor   = opts.gridColor   ?? 'rgba(255,255,255,0.18)';
  const labelColor  = opts.labelColor  ?? 'rgba(255,255,255,0.85)';

  const n = items.length;
  if (n < 3) return '<svg></svg>';

  const cx = padX + size / 2;
  const cy = padY + size / 2;
  const r  = size * 0.32;
  const labelR = size * 0.44;
  const viewW = size + padX * 2;
  const viewH = size + padY * 2;

  const angleFor = i => (Math.PI * 2 * i) / n - Math.PI / 2;
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
    labelsSVG += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="10.5" fill="${labelColor}" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(item.label)}</text>`;
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

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
