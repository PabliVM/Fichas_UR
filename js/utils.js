// ================================================
// UTILS.JS — Funciones comunes
// ================================================

/** Alias querySelector */
export const qs  = (sel, ctx = document) => ctx.querySelector(sel);

/** Alias querySelectorAll → Array */
export const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/**
 * Crea un elemento DOM con atributos opcionales y children.
 * @param {string} tag
 * @param {Object} attrs  — className, id, dataset, on* eventos
 * @param {...(string|Node)} children
 */
export function createEl(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string'
      ? document.createTextNode(child)
      : child);
  }
  return el;
}

/**
 * Escapa caracteres HTML para inserción segura.
 */
export function safeText(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formatea una Date como "dd/mm/yyyy".
 */
export function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return [
    d.getDate().toString().padStart(2, '0'),
    (d.getMonth() + 1).toString().padStart(2, '0'),
    d.getFullYear(),
  ].join('/');
}

let _toastTimer;

/**
 * Muestra el toast global durante `ms` milisegundos.
 * @param {string} msg
 * @param {'error'|'success'|'info'} type
 * @param {number} ms
 */
function showToast(msg, type = 'info', ms = 4000) {
  const toast = document.getElementById('rm-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = 'toast hidden'; }, ms);
}

export const showError   = (msg, ms) => showToast(msg,   'error',   ms);
export const showSuccess = (msg, ms) => showToast(msg,   'success', ms);
export const showInfo    = (msg, ms) => showToast(msg,   'info',    ms);

/**
 * Devuelve 'green' | 'yellow' | 'red' según los umbrales definidos
 * en constants.js (SCORE_THRESHOLDS). null/undefined → null (sin dato).
 */
export function scoreColor(value, thresholds) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value >= thresholds.green)  return 'green';
  if (value >= thresholds.yellow) return 'yellow';
  return 'red';
}

/** Nota/media para mostrar: como mucho 2 decimales (redondeado); si tiene 1 o ninguno, se deja así. Coma decimal. */
export function fmtDec(v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return null;
  return String(Math.round(Number(v) * 100) / 100).replace('.', ',');
}
