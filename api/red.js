// ================================================
// API/RED.JS — Función de Vercel: comprueba desde qué red se conecta un usuario.
// La IP la pone Vercel (el navegador no puede falsearla). Si está en la colección
// 'redes', apunta sesiones/{email}.redHasta (1 hora) para que las reglas de Firestore
// dejen leer/escribir a los usuarios con "Solo red del club".
// accion 'registrar' (solo super admin): añade la red actual a 'redes'.
// Necesita SERVIDOR_PASSWORD en Vercel. Ver SEGURIDAD.md.
// ================================================

import { SUPERADMIN_EMAILS, configurado, usuarioDe, emailKey, leer, guardar, serverTimestamp } from './_firebase.js';

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
  if (!usuario?.email) return res.status(401).json({ error: 'sesión no válida', ip: red });
  const yo = emailKey(usuario.email);

  try {
    if (req.body?.accion === 'registrar') {
      const verificada = (await leer('sesiones', yo))?.authTime === usuario.auth_time; // con la doble verificación hecha
      if (!SUPERADMIN_EMAILS.includes(yo) || !verificada) return res.status(403).json({ error: 'solo super admin', ip: red });
      await guardar('redes', idDe(red), { clave: red, nombre: String(req.body?.nombre || '').slice(0, 80), por: yo, fecha: serverTimestamp() }, false);
      return res.status(200).json({ ok: true, ip: red });
    }
    const ok = !!(await leer('redes', idDe(red)));
    if (ok) await guardar('sesiones', yo, { redHasta: Date.now() + DURACION_MS });
    return res.status(200).json({ ok, ip: red });
  } catch (err) {
    console.error('[red]', err);
    return res.status(500).json({ error: 'error del servidor', ip: red });
  }
}
