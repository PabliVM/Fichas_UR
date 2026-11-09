// ================================================
// API/MFA.JS — Doble verificación propia (gratis, sin Identity Platform).
// La clave secreta de cada usuario se guarda en la colección 'mfa' (las reglas no
// dejan leerla desde el navegador). Al acertar el código, la sesión queda marcada
// con mfaAuthTime = auth_time del token: solo vale para ESA sesión (un login nuevo,
// aunque sepa la contraseña, vuelve a necesitar código). Las reglas de Firestore lo exigen.
// Acciones: estado · iniciar · activar · verificar · reiniciar (solo super admin).
// Necesita FIREBASE_SERVICE_ACCOUNT en Vercel (ver SEGURIDAD.md).
// ================================================

import { SUPERADMIN_EMAILS, configurado, firebase, usuarioDe, fijarClaims } from './_firebase.js';
import { nuevaClave, pasoValido, urlOtpauth } from './_totp.js';

const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método' });
  if (!configurado()) return res.status(503).json({ error: 'no-configurado' });
  const usuario = await usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'sesión no válida' });

  const db = firebase().firestore();
  const ref = db.collection('mfa').doc(usuario.uid);
  const { accion, codigo, email } = req.body || {};
  const doc = (await ref.get()).data() || null;

  if (accion === 'estado') return res.status(200).json({ alta: !!doc?.activo, verificada: usuario.mfaAuthTime === usuario.auth_time });

  if (accion === 'iniciar') {
    if (doc?.activo) return res.status(409).json({ error: 'ya tiene la verificación activada' });
    const clave = nuevaClave();
    await ref.set({ clave, activo: false, email: usuario.email || '', fallos: 0, ultimoPaso: 0 });
    return res.status(200).json({ clave, url: urlOtpauth(clave, usuario.email || usuario.uid) });
  }

  if (accion === 'activar' || accion === 'verificar') {
    if (!doc || (accion === 'verificar' && !doc.activo) || (accion === 'activar' && doc.activo)) return res.status(409).json({ error: 'estado no válido' });
    if (doc.bloqueadoHasta && doc.bloqueadoHasta > Date.now()) return res.status(429).json({ error: 'demasiados intentos: espera 15 minutos' });
    const paso = pasoValido(doc.clave, String(codigo || ''), doc.ultimoPaso || 0);
    if (paso == null) {
      const fallos = (doc.fallos || 0) + 1;
      await ref.update(fallos >= MAX_FALLOS ? { fallos: 0, bloqueadoHasta: Date.now() + BLOQUEO_MS } : { fallos });
      return res.status(400).json({ error: 'código incorrecto' });
    }
    await ref.update({ activo: true, ultimoPaso: paso, fallos: 0, bloqueadoHasta: 0 });
    await fijarClaims(usuario.uid, { mfaAuthTime: usuario.auth_time });
    return res.status(200).json({ ok: true });
  }

  if (accion === 'reiniciar') { // móvil perdido: el usuario volverá a escanear un QR al entrar
    if (!SUPERADMIN_EMAILS.includes(String(usuario.email || '').toLowerCase()) || usuario.mfaAuthTime !== usuario.auth_time) return res.status(403).json({ error: 'solo super admin' });
    try {
      const otro = await firebase().auth().getUserByEmail(String(email || ''));
      await db.collection('mfa').doc(otro.uid).delete();
      await fijarClaims(otro.uid, { mfaAuthTime: null });
      return res.status(200).json({ ok: true });
    } catch (_) {
      return res.status(404).json({ error: 'no existe esa cuenta' });
    }
  }

  return res.status(400).json({ error: 'acción desconocida' });
}
