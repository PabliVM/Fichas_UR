// ================================================
// RENDER-FOOTER.JS — Footer corporativo
// ================================================

import { FOOTER_TEXT } from './constants.js';
import { verAvisoPrivacidad } from './seguridad.js';

export function renderFooter() {
  const footer = document.getElementById('rm-footer');
  if (!footer) return;
  footer.textContent = FOOTER_TEXT + ' · ';
  const enlace = document.createElement('a');
  enlace.href = '#';
  enlace.textContent = 'Aviso de privacidad';
  enlace.style.color = 'inherit';
  enlace.addEventListener('click', e => { e.preventDefault(); verAvisoPrivacidad(); });
  footer.appendChild(enlace);
}
