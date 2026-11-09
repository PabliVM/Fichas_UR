// ================================================
// SEGURIDAD.JS — Doble verificación (alta y código al entrar),
// aviso de privacidad (RGPD), registro de actividad y cierre
// de sesión por inactividad. Ver SEGURIDAD.md.
// ================================================

import { logout, tokenActual } from './auth-service.js';
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

// ── DOBLE VERIFICACIÓN (propia: api/mfa.js en Vercel, gratis) ──
// Código de 6 dígitos de Google/Microsoft Authenticator. El servidor guarda la clave y, al acertar,
// marca ESTA sesión (las reglas de Firestore lo exigen). Ver SEGURIDAD.md.

/** Llama a una función de Vercel (api/<ruta>) con el token de la sesión. @returns {{ ok, status, ...datos }} */
async function llamarApi(ruta, body) {
  try {
    const token = await tokenActual();
    const r = await fetch(`/api/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const datos = await r.json().catch(() => ({}));
    return { ...datos, ok: r.ok && datos.ok !== false, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || 'sin conexión' };
  }
}

const campoCodigo = '<input class="input" id="seg-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="width:100%;text-align:center;font-size:22px;letter-spacing:6px;" /><p class="text-xs" id="seg-error" style="display:none;color:#ef4444;margin-top:8px;"></p>';

/** Espera a que el usuario escriba un código que el servidor acepte (accion 'activar' o 'verificar'). */
function esperarCodigo(el, accion, textoBoton) {
  return new Promise(resolve => {
    const inp = el.querySelector('#seg-codigo');
    const errEl = el.querySelector('#seg-error');
    const btn = el.querySelector('#seg-ok');
    btn.textContent = textoBoton;
    inp.focus();
    const enviar = async () => {
      const codigo = inp.value.replace(/\D/g, '');
      if (codigo.length !== 6) { errEl.textContent = 'El código tiene 6 dígitos.'; errEl.style.display = 'block'; return; }
      btn.disabled = true;
      const r = await llamarApi('mfa', { accion, codigo });
      btn.disabled = false;
      if (!r.ok) {
        errEl.textContent = r.status === 429 ? 'Demasiados intentos. Espera 15 minutos.' : r.status === 400 ? 'Código incorrecto o caducado.' : `No se pudo verificar (${r.error || r.status}).`;
        errEl.style.display = 'block';
        inp.value = ''; inp.focus();
        return;
      }
      await tokenActual(true); // token nuevo: ya lleva la marca de la verificación
      resolve();
    };
    btn.addEventListener('click', enviar);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); });
  });
}

/**
 * Obligatoria para todos: la primera vez se da de alta la app autenticadora (QR); después, código en cada entrada.
 * @returns {Promise<boolean>} true = verificada, se puede continuar; false = se queda en esta pantalla.
 */
export async function exigirDobleFactor(user) {
  pantalla(`${titulo('Verificación en dos pasos')}<p class="text-sm text-muted">Comprobando…</p>`);
  const estado = await llamarApi('mfa', { accion: 'estado' });
  if (estado.ok && estado.verificada) return true; // esta sesión ya puso el código (p. ej. al recargar la página)

  if (!estado.ok) {
    // Servidor sin configurar todavía (falta la clave en Vercel): se deja entrar para no bloquear a nadie, y queda registrado.
    const sinConfig = estado.status === 503 || estado.status === 404;
    const el = pantalla(`${titulo('Verificación en dos pasos')}
      <p class="text-sm text-muted mb-16">${sinConfig
        ? 'La verificación en dos pasos todavía no está configurada en el servidor (ver SEGURIDAD.md).'
        : `No se pudo contactar con el servidor de verificación (${safeText(estado.error || estado.status)}).`}</p>
      ${sinConfig ? '<button class="btn btn-primary" id="seg-seguir" style="width:100%;margin-top:8px;">Continuar sin verificación (temporal)</button>' : ''}
      ${salirBtn}`);
    conSalir(el);
    if (!sinConfig) return false;
    return new Promise(resolve => el.querySelector('#seg-seguir').addEventListener('click', () => {
      auditar('entrada sin doble factor', 'servidor sin configurar');
      resolve(true);
    }));
  }

  if (estado.alta) {
    const el = pantalla(`
      ${titulo('Verificación en dos pasos')}
      <p class="text-sm text-muted mb-16">Escribe el código de 6 dígitos de tu app autenticadora.</p>
      ${campoCodigo}
      <button class="btn btn-primary" id="seg-ok" style="width:100%;margin-top:12px;"></button>
      ${salirBtn}`);
    conSalir(el);
    await esperarCodigo(el, 'verificar', 'Entrar');
    return true;
  }

  const datos = await llamarApi('mfa', { accion: 'iniciar' });
  if (!datos.ok) {
    conSalir(pantalla(`${titulo('Verificación en dos pasos')}<p class="text-sm text-muted mb-16">No se pudo preparar el alta (${safeText(datos.error || datos.status)}).</p>${salirBtn}`));
    return false;
  }
  let qrSVG = '';
  try {
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
    const qr = qrcode(0, 'M'); qr.addData(datos.url); qr.make();
    qrSVG = qr.createSvgTag(5, 2);
  } catch (e) { console.warn('[Auth] QR no disponible, se muestra solo la clave:', e); }
  const el = pantalla(`
    ${titulo('Activa la verificación en dos pasos')}
    <ol class="text-sm" style="text-align:left;margin:0 0 12px 18px;line-height:1.6;">
      <li>Instala <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> en tu móvil.</li>
      <li>Añade una cuenta escaneando este código QR${qrSVG ? '' : ' (no se pudo dibujar: usa la clave)'}.</li>
      <li>Escribe aquí el código de 6 dígitos que te muestra.</li>
    </ol>
    ${qrSVG ? `<div style="display:flex;justify-content:center;background:#fff;padding:8px;border-radius:8px;margin:0 auto 8px;width:max-content;">${qrSVG}</div>` : ''}
    <p class="text-xs text-muted mb-8">Clave manual: <code style="user-select:all;word-break:break-all;">${safeText(datos.clave)}</code></p>
    ${campoCodigo}
    <button class="btn btn-primary" id="seg-ok" style="width:100%;margin-top:12px;"></button>
    ${salirBtn}`);
  conSalir(el);
  await esperarCodigo(el, 'activar', 'Activar');
  auditar('doble factor activado');
  return true;
}

/** Super admin: borra la verificación de otro usuario (móvil perdido); al entrar escaneará un QR nuevo. */
export async function reiniciarDobleFactor(email) {
  return llamarApi('mfa', { accion: 'reiniciar', email });
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
    return m === 'inactividad' ? `Sesión cerrada tras ${INACTIVIDAD_MIN} minutos sin actividad.`
      : m === 'horario' ? 'Sesión cerrada: ha terminado tu horario de acceso.'
      : m === 'red' ? 'Sesión cerrada: ya no estás conectado a la red del club.' : '';
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

// ── HORARIO Y RED DEL CLUB (por usuario, los pone el super admin) ──
// horario = { dias: [1..7] (1 = lunes), desde, hasta } en minutos, hora de Madrid. exigeRed = solo desde una red de 'redes'.
const DIAS_TXT = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const textoHorario = h => h ? `${(h.dias || []).map(d => DIAS_TXT[d]).join(' ')} de ${hm(h.desde)} a ${hm(h.hasta)}` : 'sin límite';

function ahoraMadrid() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { dia: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1, min: Number(p.hour) * 60 + Number(p.minute) };
}
export function dentroDeHorario(h) {
  if (!h) return true;
  const { dia, min } = ahoraMadrid();
  return (h.dias || []).includes(dia) && min >= h.desde && min < h.hasta;
}

/**
 * Pregunta al servidor (api/red.js) desde qué red se conecta. Si es una red del club, el servidor marca la
 * sesión como "en la red" durante 1 hora (lo comprueban las reglas de Firestore).
 * accion 'registrar' (solo super admin) añade la red actual a la lista. @returns {{ ok, ip, error }}
 */
export async function comprobarRed(accion = 'comprobar', nombre = '') {
  const r = await llamarApi('red', { accion, nombre });
  return { ok: r.ok, ip: r.ip || '', error: r.ok ? null : (r.error || `HTTP ${r.status}`) };
}

function cerrarPor(motivo, detalle) {
  auditar('salida', detalle);
  try { sessionStorage.setItem('rm-cierre', motivo); } catch (_) { /* ignorar */ }
  setTimeout(() => logout().catch(() => {}), 500);
}

/**
 * Al entrar (usuarios que no son super admin): comprueba horario y red, y los vigila durante la sesión.
 * @returns {Promise<boolean>} true = puede entrar.
 */
export async function exigirAcceso(perfil) {
  if (!dentroDeHorario(perfil?.horario)) {
    auditar('acceso denegado', `fuera de horario (${textoHorario(perfil.horario)})`);
    conSalir(pantalla(`${titulo('Fuera de tu horario')}<p class="text-sm text-muted mb-16">Tu horario de acceso es ${safeText(textoHorario(perfil.horario))} (hora de Madrid).</p>${salirBtn}`));
    return false;
  }
  if (perfil?.exigeRed) {
    const r = await comprobarRed();
    if (!r.ok) {
      auditar('acceso denegado', `fuera de la red del club (${r.ip || r.error || '?'})`);
      conSalir(pantalla(`${titulo('Solo desde la red del club')}<p class="text-sm text-muted mb-16">Solo puedes entrar conectado a la WiFi o red del club.${r.ip ? ` Estás conectado desde ${safeText(r.ip)}.` : ''}</p>${salirBtn}`));
      return false;
    }
    await tokenActual(true); // token nuevo: ya lleva la marca de "en la red del club"
    setInterval(async () => { // la marca dura 1 hora: se renueva mientras siga en la red
      const r2 = await comprobarRed();
      if (r2.ok) await tokenActual(true); else cerrarPor('red', `fuera de la red del club (${r2.ip || r2.error || '?'})`);
    }, 45 * 60000);
  }
  if (perfil?.horario) {
    const t = setInterval(() => {
      if (dentroDeHorario(perfil.horario)) return;
      clearInterval(t);
      cerrarPor('horario', `fin del horario (${textoHorario(perfil.horario)})`);
    }, 60000);
  }
  return true;
}
