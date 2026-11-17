// ================================================
// FOTO-EDITOR.JS — Ventana para poner la foto de un jugador sin abrir
// "Editar": pegar (Ctrl+V o botón) o elegir archivo, ajustar en el
// círculo (arrastrar + zoom) y guardar. Mismo recorte y formato que el
// formulario del jugador (400×400, WebP/PNG/JPEG ≤ 450 KB).
// ================================================

import { safeText, showError } from './utils.js';

const CROP_V = 180;

/** Recorte visible → archivo 400×400 (conserva transparencia si puede). */
function exportar(crop) {
  return new Promise(resolve => {
    const OUT = 400;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const scale = crop.min * crop.zoom;
    canvas.getContext('2d').drawImage(crop.img, -crop.x / scale, -crop.y / scale, CROP_V / scale, CROP_V / scale, 0, 0, OUT, OUT);
    const aJpeg = () => {
      const c2 = document.createElement('canvas'); c2.width = c2.height = OUT;
      const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, OUT, OUT); x2.drawImage(canvas, 0, 0);
      c2.toBlob(b => resolve(b ? new File([b], 'foto.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
    };
    canvas.toBlob(wp => {
      if (wp && wp.type === 'image/webp' && wp.size <= 450000) { resolve(new File([wp], 'foto.webp', { type: 'image/webp' })); return; }
      canvas.toBlob(png => {
        if (png && png.size <= 450000) { resolve(new File([png], 'foto.png', { type: 'image/png' })); return; }
        aJpeg();
      }, 'image/png');
    }, 'image/webp', 0.92);
  });
}

/**
 * @param {{ titulo: string, fotoActual?: string, onGuardar: (file: File) => Promise<void> }} opts
 */
export function abrirEditorFoto({ titulo, fotoActual, onGuardar }) {
  const capa = document.createElement('div');
  capa.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
  capa.innerHTML = `
    <div class="card" style="width:100%;max-width:360px;text-align:center;">
      <div class="card-title" style="justify-content:center;">Foto · ${safeText(titulo)}</div>
      <div id="fe-vista" style="width:${CROP_V}px;height:${CROP_V}px;border-radius:50%;overflow:hidden;position:relative;margin:4px auto 8px;background:var(--bg-hover);cursor:grab;touch-action:none;border:2px solid var(--blue-500, #3b82f6);">
        <img id="fe-img" alt="" draggable="false" style="position:absolute;left:0;top:0;max-width:none;user-select:none;pointer-events:none;" />
        <div id="fe-vacio" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;color:var(--text-muted);font-size:12px;padding:20px;">
          ${fotoActual ? `<img src="${fotoActual}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.35;" />` : ''}
          <span style="position:relative;font-size:28px;">📷</span><span style="position:relative;">Pega una imagen (Ctrl+V) o elige un archivo</span>
        </div>
      </div>
      <input type="range" id="fe-zoom" min="1" max="3" step="0.01" value="1" style="width:${CROP_V}px;display:none;margin:0 auto 4px;" />
      <div class="text-xs text-muted mb-8" id="fe-ayuda" style="display:none;">Arrastra para mover · desliza para ampliar</div>
      <div class="flex gap-8" style="justify-content:center;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm" type="button" id="fe-pegar">📋 Pegar foto copiada</button>
        <label class="btn btn-sm" style="cursor:pointer;">📁 Elegir archivo<input type="file" id="fe-archivo" accept="image/*" style="display:none;" /></label>
      </div>
      <div class="flex gap-8" style="justify-content:center;">
        <button class="btn btn-primary" type="button" id="fe-guardar" disabled>Guardar foto</button>
        <button class="btn btn-ghost" type="button" id="fe-cancelar">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const $ = sel => capa.querySelector(sel);
  const imgEl = $('#fe-img'), vista = $('#fe-vista'), zoomEl = $('#fe-zoom');
  let crop = null, drag = null, url = null;

  const aplicar = () => {
    const scale = crop.min * crop.zoom;
    const w = crop.natW * scale, h = crop.natH * scale;
    crop.x = Math.min(0, Math.max(CROP_V - w, crop.x));
    crop.y = Math.min(0, Math.max(CROP_V - h, crop.y));
    Object.assign(imgEl.style, { width: w + 'px', height: h + 'px', left: crop.x + 'px', top: crop.y + 'px' });
  };
  const cargar = blob => {
    if (!blob || !String(blob.type).startsWith('image/')) { showError('Eso no es una imagen.'); return; }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const min = Math.max(CROP_V / img.naturalWidth, CROP_V / img.naturalHeight);
      crop = { img, natW: img.naturalWidth, natH: img.naturalHeight, min, zoom: 1,
               x: (CROP_V - img.naturalWidth * min) / 2, y: (CROP_V - img.naturalHeight * min) / 2 };
      imgEl.src = url;
      zoomEl.value = 1;
      $('#fe-vacio').style.display = 'none';
      zoomEl.style.display = 'block';
      $('#fe-ayuda').style.display = 'block';
      $('#fe-guardar').disabled = false;
      aplicar();
    };
    img.onerror = () => showError('No se pudo leer esa imagen.');
    img.src = url;
  };

  // Ctrl+V mientras la ventana está abierta (antes que cualquier otro "pegar" de la página).
  const alPegar = e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cargar(item.getAsFile());
  };
  const alTeclear = e => { if (e.key === 'Escape') cerrar(); };
  window.addEventListener('paste', alPegar, true);
  document.addEventListener('keydown', alTeclear);
  const cerrar = () => {
    window.removeEventListener('paste', alPegar, true);
    document.removeEventListener('keydown', alTeclear);
    if (url) URL.revokeObjectURL(url);
    capa.remove();
  };

  $('#fe-pegar').addEventListener('click', async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const tipo = item.types.find(t => t.startsWith('image/'));
        if (tipo) { cargar(await item.getType(tipo)); return; }
      }
      showError('No hay ninguna imagen copiada. Copia una foto (clic derecho → Copiar imagen) y vuelve a pulsar.');
    } catch (_) {
      showError('El navegador no deja leer el portapapeles con el botón: pulsa Ctrl+V (⌘+V en Mac).', 7000);
    }
  });
  $('#fe-archivo').addEventListener('change', e => { if (e.target.files[0]) cargar(e.target.files[0]); });
  zoomEl.addEventListener('input', () => {
    if (!crop) return;
    const old = crop.min * crop.zoom;
    const cx = (CROP_V / 2 - crop.x) / old, cy = (CROP_V / 2 - crop.y) / old;
    crop.zoom = Number(zoomEl.value);
    const nuevo = crop.min * crop.zoom;
    crop.x = CROP_V / 2 - cx * nuevo;
    crop.y = CROP_V / 2 - cy * nuevo;
    aplicar();
  });
  vista.addEventListener('pointerdown', e => {
    if (!crop) return;
    drag = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
    vista.setPointerCapture(e.pointerId);
    vista.style.cursor = 'grabbing';
  });
  vista.addEventListener('pointermove', e => {
    if (!drag) return;
    crop.x = drag.x + (e.clientX - drag.px);
    crop.y = drag.y + (e.clientY - drag.py);
    aplicar();
  });
  const fin = () => { drag = null; vista.style.cursor = 'grab'; };
  vista.addEventListener('pointerup', fin);
  vista.addEventListener('pointercancel', fin);

  $('#fe-cancelar').addEventListener('click', cerrar);
  capa.addEventListener('click', e => { if (e.target === capa) cerrar(); });
  $('#fe-guardar').addEventListener('click', async e => {
    if (!crop) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const file = await exportar(crop);
      if (!file) throw new Error('no se pudo preparar la imagen');
      await onGuardar(file);
      cerrar();
    } catch (err) {
      console.error('[Foto]', err);
      showError(`No se pudo guardar la foto [${err?.code || err?.message || 'error'}].`, 9000);
      btn.disabled = false; btn.textContent = 'Guardar foto';
    }
  });
}
