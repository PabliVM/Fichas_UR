// ================================================
// API/RED.JS — Función de Vercel: comprueba desde qué red se conecta un usuario.
// La IP la pone Vercel (el navegador no puede falsearla). Si está en la colección
// 'redes', marca la sesión con redHasta (1 hora) para que las reglas de Firestore
// dejen leer/escribir a los usuarios con "Solo red del club".
// accion 'registrar' (solo super admin): añade la red actual a 'redes'.
// Necesita la variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio). Ver SEGURIDAD.md.
// ================================================

import admin from 'firebase-admin';
import { SUPERADMIN_EMAILS, configurado, firebase, usuarioDe, fijarClaims } from './_firebase.js';

const DURACION_MS = 60 * 60 * 1000;

const ipDe = req => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
// IPv4 exacta; IPv6 por su prefijo /64 (la parte final cambia sola en muchas redes).
const redDe = ip => (ip.includes(':') ? `${ip.split(':').slice(0, 4).join(':')}::/64` : ip);
const idDe = red => red.replace(/[^a-zA-Z0-9.]/g, '_');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método' });
  const red = redDe(ipDe(req));
  if (!configurado()) return res.status(503).json({ error: 'no-configurado', ip: red });
  const usuario = await usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'sesión no válida', ip: red });
  const db = firebase().firestore();
  const accion = req.body?.accion;

  if (accion === 'registrar') {
    if (!SUPERADMIN_EMAILS.includes(String(usuario.email || '').toLowerCase())) return res.status(403).json({ error: 'solo super admin', ip: red });
    await db.collection('redes').doc(idDe(red)).set({
      clave: red,
      nombre: String(req.body?.nombre || '').slice(0, 80),
      por: usuario.email,
      fecha: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ ok: true, ip: red });
  }

  const ok = (await db.collection('redes').doc(idDe(red)).get()).exists;
  if (ok) await fijarClaims(usuario.uid, { redHasta: Date.now() + DURACION_MS });
  return res.status(200).json({ ok, ip: red });
}
