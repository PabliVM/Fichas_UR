// ================================================
// RENDER-FOOTER.JS — Footer corporativo
// ================================================

import { FOOTER_TEXT } from './constants.js';

export function renderFooter() {
  const footer = document.getElementById('rm-footer');
  if (!footer) return;
  footer.textContent = FOOTER_TEXT;
}
