// ================================================
// ELEGIR-HOJA.JS — Si un Excel tiene varias pestañas, pregunta cuál cargar.
// elegirHoja(wb, sugerida?) → nombre de la pestaña, o null si se cancela.
// Con una sola pestaña no pregunta.
// ================================================

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function elegirHoja(wb, sugerida = '') {
  const nombres = (wb?.SheetNames || []).filter(n => wb.Sheets[n]);
  if (nombres.length <= 1) return Promise.resolve(nombres[0] || null);
  const s = norm(sugerida);
  const marcada = (s && nombres.find(n => norm(n).startsWith(s) || s.startsWith(norm(n)))) || nombres[0];
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  return new Promise(resolve => {
    const capa = document.createElement('div');
    capa.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    capa.innerHTML = `
      <div class="card" style="max-width:420px;width:100%;margin:0;">
        <div class="card-title">📑 ¿Qué pestaña cargo?</div>
        <div class="card-body">
          <p class="text-sm mb-8">El Excel tiene ${nombres.length} pestañas.</p>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto;">
            ${nombres.map(n => `<label class="text-sm" style="display:flex;gap:8px;align-items:center;cursor:pointer;"><input type="radio" name="eh-hoja" value="${esc(n)}" ${n === marcada ? 'checked' : ''}/> ${esc(n)}</label>`).join('')}
          </div>
          <div class="flex gap-8 mt-16">
            <button class="btn btn-primary" data-eh="ok">Cargar</button>
            <button class="btn btn-ghost" data-eh="no">Cancelar</button>
          </div>
        </div>
      </div>`;
    const cerrar = v => { capa.remove(); document.removeEventListener('keydown', tecla); resolve(v); };
    const tecla = e => { if (e.key === 'Escape') cerrar(null); if (e.key === 'Enter') cerrar(capa.querySelector('input[name=eh-hoja]:checked')?.value || null); };
    capa.addEventListener('click', e => {
      if (e.target === capa || e.target.dataset.eh === 'no') cerrar(null);
      else if (e.target.dataset.eh === 'ok') cerrar(capa.querySelector('input[name=eh-hoja]:checked')?.value || null);
    });
    capa.addEventListener('dblclick', e => { if (e.target.name === 'eh-hoja') cerrar(e.target.value); });
    document.addEventListener('keydown', tecla);
    document.body.appendChild(capa);
  });
}
