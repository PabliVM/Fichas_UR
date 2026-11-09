// ================================================
// API/MFA.JS — Doble verificación propia (gratis, sin Identity Platform ni claves de servicio).
// La clave secreta de cada usuario se guarda en mfa/{email} (solo la lee la cuenta servidor).
// Al acertar el código se apunta sesiones/{email}.authTime = auth_time del token: solo vale para
// ESA sesión (un login nuevo, aunque sepa la contraseña, vuelve a necesitar código). Las reglas lo exigen.
// Acciones: estado · iniciar · activar · verificar · reiniciar (solo super admin).
// Necesita SERVIDOR_PASSWORD en Vercel (ver SEGURIDAD.md).
// ================================================

import { SUPERADMIN_EMAILS, configurado, usuarioDe, emailKey, leer, guardar, borrar } from './_firebase.js';
import { nuevaClave, pasoValido, urlOtpauth } from './_totp.js';

const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método' });
  if (!configurado()) return res.status(503).json({ error: 'no-configurado' });
  const usuario = await usuarioDe(req);
  if (!usuario?.email) return res.status(401).json({ error: 'sesión no válida' });
  const yo = emailKey(usuario.email);
  const { accion, codigo, email } = req.body || {};

  try {
    const sesionVerificada = async () => (await leer('sesiones', yo))?.authTime === usuario.auth_time;
    const doc = await leer('mfa', yo);

    if (accion === 'estado') return res.status(200).json({ alta: !!doc?.activo, verificada: await sesionVerificada() });

    if (accion === 'iniciar') {
      if (doc?.activo) return res.status(409).json({ error: 'ya tiene la verificación activada' });
      const clave = nuevaClave();
      await guardar('mfa', yo, { clave, activo: false, fallos: 0, ultimoPaso: 0, bloqueadoHasta: 0 }, false);
      return res.status(200).json({ clave, url: urlOtpauth(clave, yo) });
    }

    if (accion === 'activar' || accion === 'verificar') {
      if (!doc || (accion === 'verificar' && !doc.activo) || (accion === 'activar' && doc.activo)) return res.status(409).json({ error: 'estado no válido' });
      if (doc.bloqueadoHasta > Date.now()) return res.status(429).json({ error: 'demasiados intentos: espera 15 minutos' });
      const paso = pasoValido(doc.clave, String(codigo || ''), doc.ultimoPaso || 0);
      if (paso == null) {
        const fallos = (doc.fallos || 0) + 1;
        await guardar('mfa', yo, fallos >= MAX_FALLOS ? { fallos: 0, bloqueadoHasta: Date.now() + BLOQUEO_MS } : { fallos });
        return res.status(400).json({ error: 'código incorrecto' });
      }
      await guardar('mfa', yo, { activo: true, ultimoPaso: paso, fallos: 0, bloqueadoHasta: 0 });
      await guardar('sesiones', yo, { authTime: usuario.auth_time });
      return res.status(200).json({ ok: true });
    }

    if (accion === 'reiniciar') { // móvil perdido: el usuario volverá a escanear un QR al entrar
      if (!SUPERADMIN_EMAILS.includes(yo) || !(await sesionVerificada())) return res.status(403).json({ error: 'solo super admin' });
      const otro = emailKey(email);
      await borrar('mfa', otro);
      await guardar('sesiones', otro, { authTime: 0 });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'acción desconocida' });
  } catch (err) {
    console.error('[mfa]', err);
    return res.status(500).json({ error: err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password' ? 'contraseña del servidor incorrecta' : 'error del servidor' });
  }
}
