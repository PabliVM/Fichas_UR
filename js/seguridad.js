// ================================================
// SEGURIDAD.JS — Doble verificación (alta y código al entrar),
// aviso de privacidad (RGPD), registro de actividad y cierre
// de sesión por inactividad. Ver SEGURIDAD.md.
// ================================================

import { tieneDobleFactor, iniciarAltaTotp, completarAltaTotp, resolverDobleFactor, logout } from './auth-service.js';
import { addAuditEntry, readDocument, saveDocument } from './firebase-service.js';
import { emailKey } from './permisos-service.js';
import { LOGO_PATH } from './constants.js';
import { safeText } from './utils.js';

const INACTIVIDAD_MIN = 15;
const PRIVACIDAD_VERSION = '1';

// ── PANTALLA SOBRE LA APP (mismo aspecto que el login) ──
function pantalla(html) {
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
  let el = document.getElementById('rm-login-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'rm-login-overlay'; document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:linear-gradient(160deg, var(--blue-600), var(--blue-400));font-family:var(--font-sans);padding:16px;overflow:auto;';
  el.innerHTML = `
    <div style="background:var(--bg-surface);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:32px 30px;width:100%;max-width:440px;text-align:center;max-height:calc(100vh - 32px);overflow:auto;">
      <img src="${LOGO_PATH}" alt="" style="width:64px;height:64px;object-fit:contain;margin:0 auto 12px;display:block;" />
      ${html}
    </div>`;
  return el;
}
const titulo = t => `<div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:12px;">${t}</div>`;
const salirBtn = '<button class="btn btn-ghost" data-seg-salir style="width:100%;margin-top:8px;">Salir</button>';
const conSalir = el => el.querySelector('[data-seg-salir]')?.addEventListener('click', () => logout().catch(() => {}));

// ── REGISTRO DE ACTIVIDAD ─────────────────────────
let _email = '';
export function iniciarAuditoria(user) { _email = emailKey(user?.email); }
/** Apunta quién hace qué (entrada, salida, ver pantalla, crear/modificar/borrar…). Nunca bloquea la app. */
export function auditar(accion, detalle = '') {
  if (!_email) return;
  addAuditEntry({ email: _email, accion, detalle: String(detalle).slice(0, 300) })
    .catch(err => console.warn('[Auditoría] No se pudo registrar:', err?.code || err));
}

// ── DOBLE VERIFICACIÓN ────────────────────────────

/** Al entrar con contraseña, si la cuenta tiene doble verificación: pide el código de 6 dígitos. */
export function pedirCodigoLogin(err) {
  const terminar = resolverDobleFactor(err);
  const el = pantalla(`
    ${titulo('Verificación en dos pasos')}
    <p class="text-sm text-muted mb-16">Escribe el código de 6 dígitos de tu app autenticadora.</p>
    <input class="input" id="seg-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="width:100%;text-align:center;font-size:22px;letter-spacing:6px;" />
    <p class="text-xs mb-8" id="seg-error" style="display:none;color:#ef4444;margin-top:8px;"></p>
    <button class="btn btn-primary" id="seg-ok" style="width:100%;margin-top:12px;">Entrar</button>
    <button class="btn btn-ghost" id="seg-volver" style="width:100%;margin-top:8px;">Volver</button>`);
  const inp = el.querySelector('#seg-codigo');
  const errEl = el.querySelector('#seg-error');
  inp.focus();
  const enviar = async () => {
    const codigo = inp.value.replace(/\D/g, '');
    if (codigo.length !== 6) { errEl.textContent = 'El código tiene 6 dígitos.'; errEl.style.display = 'block'; return; }
    try {
      await terminar(codigo); // onAuthStateChanged arranca la app
      sessionStorage.setItem('rm-entrada', '1');
    } catch (e) {
      console.error('[Auth] Código:', e);
      errEl.textContent = e?.code === 'auth/invalid-verification-code' ? 'Código incorrecto o caducado.' : 'No se pudo verificar. Vuelve a intentarlo.';
      errEl.style.display = 'block';
    }
  };
  el.querySelector('#seg-ok').addEventListener('click', enviar);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); });
  el.querySelector('#seg-volver').addEventListener('click', () => location.reload());
}

/**
 * Obligatoria para todos: si la cuenta aún no tiene app autenticadora, se da de alta antes de entrar.
 * @returns {Promise<boolean>} true = ya la tiene, se puede continuar; false = se queda en la pantalla de alta.
 */
export async function exigirDobleFactor(user) {
  if (tieneDobleFactor(user)) return true;
  let el = pantalla(`${titulo('Activa la verificación en dos pasos')}<p class="text-sm text-muted">Preparando…</p>`);
  let datos;
  try {
    datos = await iniciarAltaTotp(user);
  } catch (err) {
    console.error('[Auth] Alta doble factor:', err);
    const reciente = err?.code === 'auth/requires-recent-login';
    // Mientras no esté activada en Firebase (lo decide el servidor, no el usuario) se deja entrar para no bloquear a nadie.
    el = pantalla(`${titulo('Verificación en dos pasos')}
      <p class="text-sm text-muted mb-16">${reciente
        ? 'Por seguridad, sal y vuelve a iniciar sesión para activarla.'
        : 'La verificación en dos pasos todavía no está activada en Firebase. El administrador debe activarla (ver SEGURIDAD.md).'}</p>
      <p class="text-xs text-muted">${safeText(err?.code || '')}</p>
      ${reciente ? '' : '<button class="btn btn-primary" id="seg-seguir" style="width:100%;margin-top:8px;">Continuar sin verificación (temporal)</button>'}
      ${salirBtn}`);
    conSalir(el);
    if (reciente) return false;
    return new Promise(resolve => el.querySelector('#seg-seguir').addEventListener('click', () => {
      auditar('entrada sin doble factor', err?.code || '');
      resolve(true);
    }));
  }
  let qrSVG = '';
  try {
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
    const qr = qrcode(0, 'M'); qr.addData(datos.url); qr.make();
    qrSVG = qr.createSvgTag(5, 2);
  } catch (e) { console.warn('[Auth] QR no disponible, se muestra solo la clave:', e); }
  el = pantalla(`
    ${titulo('Activa la verificación en dos pasos')}
    <ol class="text-sm" style="text-align:left;margin:0 0 12px 18px;line-height:1.6;">
      <li>Instala <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> en tu móvil.</li>
      <li>Añade una cuenta escaneando este código QR${qrSVG ? '' : ' (no se pudo dibujar: usa la clave)'}.</li>
      <li>Escribe aquí el código de 6 dígitos que te muestra.</li>
    </ol>
    ${qrSVG ? `<div style="display:flex;justify-content:center;background:#fff;padding:8px;border-radius:8px;margin:0 auto 8px;width:max-content;">${qrSVG}</div>` : ''}
    <p class="text-xs text-muted mb-8">Clave manual: <code style="user-select:all;word-break:break-all;">${safeText(datos.clave)}</code></p>
    <input class="input" id="seg-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="width:100%;text-align:center;font-size:22px;letter-spacing:6px;" />
    <p class="text-xs" id="seg-error" style="display:none;color:#ef4444;margin-top:8px;"></p>
    <button class="btn btn-primary" id="seg-ok" style="width:100%;margin-top:12px;">Activar</button>
    ${salirBtn}`);
  conSalir(el);
  const inp = el.querySelector('#seg-codigo');
  const errEl = el.querySelector('#seg-error');
  const activar = async () => {
    const codigo = inp.value.replace(/\D/g, '');
    if (codigo.length !== 6) { errEl.textContent = 'El código tiene 6 dígitos.'; errEl.style.display = 'block'; return; }
    try {
      await completarAltaTotp(user, datos.secret, codigo);
      auditar('doble factor activado');
      pantalla(`${titulo('Verificación activada')}<p class="text-sm text-muted">Vuelve a entrar con tu contraseña y el código de la app.</p>`);
      setTimeout(() => logout().catch(() => {}), 2500); // el token nuevo ya lleva el segundo factor
    } catch (e) {
      console.error('[Auth] Confirmar doble factor:', e);
      errEl.textContent = e?.code === 'auth/invalid-verification-code' ? 'Código incorrecto o caducado.' : 'No se pudo activar. Vuelve a intentarlo.';
      errEl.style.display = 'block';
    }
  };
  el.querySelector('#seg-ok').addEventListener('click', activar);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') activar(); });
  return false;
}

// ── CIERRE POR INACTIVIDAD ────────────────────────
export function iniciarInactividad() {
  let ultima = Date.now();
  const marcar = () => { ultima = Date.now(); };
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, marcar, { passive: true, capture: true }));
  const timer = setInterval(() => {
    if (Date.now() - ultima < INACTIVIDAD_MIN * 60000) return;
    clearInterval(timer);
    auditar('salida', `inactividad (${INACTIVIDAD_MIN} min)`);
    try { sessionStorage.setItem('rm-cierre', 'inactividad'); } catch (_) { /* ignorar */ }
    setTimeout(() => logout().catch(() => {}), 500); // deja salir el registro antes de cerrar
  }, 20000);
}
/** Mensaje para la pantalla de login si la sesión anterior se cerró por inactividad (se muestra una vez). */
export function mensajeCierre() {
  try {
    const m = sessionStorage.getItem('rm-cierre');
    sessionStorage.removeItem('rm-cierre');
    return m === 'inactividad' ? `Sesión cerrada tras ${INACTIVIDAD_MIN} minutos sin actividad.` : '';
  } catch (_) { return ''; }
}

// ── AVISO DE PRIVACIDAD (RGPD) ────────────────────
// BORRADOR: debe revisarlo y completarlo el Delegado de Protección de Datos del club (lo que va entre [corchetes]).
// Si se cambia el texto de forma relevante, subir PRIVACIDAD_VERSION para que todos lo vuelvan a aceptar.
const AVISO_PRIVACIDAD_HTML = `
  <p><b>Responsable del tratamiento:</b> [Nombre de la entidad responsable] · [Dirección] · Contacto del Delegado de Protección de Datos: [email del DPD].</p>
  <p><b>Qué datos se tratan:</b> datos identificativos de jugadores de cantera (nombre, fecha de nacimiento, fotografía), datos deportivos y físicos (equipo, posición, peso, altura, datos condicionales, edad madurativa) y valoraciones de rendimiento. De los usuarios de la aplicación: email, permisos y registro de actividad.</p>
  <p><b>Finalidad:</b> seguimiento deportivo y formativo de los jugadores por parte del cuerpo técnico autorizado.</p>
  <p><b>Base legal:</b> [consentimiento de los padres o tutores legales / interés legítimo / relación contractual — a definir por el DPD]. Muchos de los jugadores son menores de edad.</p>
  <p><b>Quién accede:</b> solo el personal autorizado, cada uno a las pantallas que le asigna el administrador. Proveedores tecnológicos (encargados del tratamiento): Google (Firebase) y Vercel, con [ubicación de los datos / garantías de transferencia].</p>
  <p><b>Conservación:</b> mientras el jugador pertenezca al club y [plazo] después; el administrador revisa periódicamente los jugadores sin actividad y elimina sus datos.</p>
  <p><b>Derechos:</b> acceso, rectificación, supresión, oposición, limitación y portabilidad, escribiendo a [email del DPD]. También se puede reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>
  <p><b>Tu compromiso como usuario:</b> usar estos datos solo para la finalidad indicada, no descargarlos ni compartirlos fuera de los canales autorizados, y no compartir tus credenciales.</p>`;

/** Ventana de solo lectura con el aviso (enlace del pie de página). */
export function verAvisoPrivacidad() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
  el.innerHTML = `<div style="background:var(--bg-surface);color:var(--text-primary);border-radius:var(--radius-lg);padding:24px;max-width:640px;max-height:85vh;overflow:auto;font-size:13px;line-height:1.5;">
    ${titulo('Aviso de privacidad')}${AVISO_PRIVACIDAD_HTML}
    <button class="btn btn-primary" style="margin-top:12px;">Cerrar</button></div>`;
  el.addEventListener('click', e => { if (e.target === el || e.target.tagName === 'BUTTON') el.remove(); });
  document.body.appendChild(el);
}

/**
 * Cada usuario acepta el aviso una vez (y otra vez si cambia la versión).
 * Se guarda en usuarios/{email}.privacidadAceptada. @returns {Promise<void>} cuando lo acepta.
 */
export async function exigirPrivacidad(user) {
  const id = emailKey(user.email);
  let perfil = null;
  try { perfil = await readDocument('usuarios', id); } catch (err) { console.warn('[Privacidad] No se pudo leer:', err?.code || err); }
  if (perfil?.privacidadAceptada?.version === PRIVACIDAD_VERSION) return;
  await new Promise(resolve => {
    const el = pantalla(`
      ${titulo('Aviso de privacidad')}
      <div class="text-xs" style="text-align:left;max-height:45vh;overflow:auto;border:1px solid var(--border-default);border-radius:8px;padding:10px 12px;line-height:1.5;">${AVISO_PRIVACIDAD_HTML}</div>
      <label class="text-sm" style="display:flex;gap:8px;align-items:flex-start;text-align:left;margin-top:12px;">
        <input type="checkbox" id="seg-acepto" style="margin-top:3px;" /> He leído el aviso y me comprometo a usar los datos solo para la finalidad indicada.
      </label>
      <p class="text-xs" id="seg-error" style="display:none;color:#ef4444;margin-top:8px;"></p>
      <button class="btn btn-primary" id="seg-ok" style="width:100%;margin-top:12px;" disabled>Aceptar y entrar</button>
      ${salirBtn}`);
    conSalir(el);
    const ok = el.querySelector('#seg-ok');
    el.querySelector('#seg-acepto').addEventListener('change', e => { ok.disabled = !e.target.checked; });
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        await saveDocument('usuarios', id, { privacidadAceptada: { version: PRIVACIDAD_VERSION, fecha: new Date().toISOString() } }, { merge: true });
        auditar('privacidad aceptada', `versión ${PRIVACIDAD_VERSION}`);
        resolve();
      } catch (err) {
        console.error('[Privacidad] Guardar:', err);
        // Reglas de Firestore antiguas (aún sin permiso para apuntarlo): se deja entrar y queda en el registro.
        if (err?.code === 'permission-denied') { auditar('privacidad aceptada', `versión ${PRIVACIDAD_VERSION} (sin guardar: reglas antiguas)`); resolve(); return; }
        const errEl = el.querySelector('#seg-error');
        errEl.textContent = 'No se pudo guardar la aceptación (revisa las reglas de Firestore).';
        errEl.style.display = 'block';
        ok.disabled = false;
      }
    });
  });
}
