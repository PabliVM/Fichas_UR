// ================================================
// API/RED.JS — Función de Vercel: comprueba desde qué red se conecta un usuario.
// La IP la pone Vercel (el navegador no puede falsearla). Si está en la colección
// 'redes', marca la sesión con redHasta (1 hora) para que las reglas de Firestore
// dejen leer/escribir a los usuarios con "Solo red del club".
// accion 'registrar' (solo super admin): añade la red actual a 'redes'.
// Necesita la variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio). Ver SEGURIDAD.md.
// ================================================

import admin from 'firebase-admin';

const SUPERADMIN_EMAILS = ['pablo.vegamartin@gmail.com', 'pvega@realmadrid.es']; // igual que js/permisos-service.js
const DURACION_MS = 60 * 60 * 1000;

function firebase() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin;
}

const ipDe = req => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
// IPv4 exacta; IPv6 por su prefijo /64 (la parte final cambia sola en muchas redes).
const redDe = ip => (ip.includes(':') ? `${ip.split(':').slice(0, 4).join(':')}::/64` : ip);
const idDe = red => red.replace(/[^a-zA-Z0-9.]/g, '_');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método' });
  const red = redDe(ipDe(req));
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(503).json({ error: 'no-configurado', ip: red });
  let usuario;
  try {
    usuario = await firebase().auth().verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  } catch (_) {
    return res.status(401).json({ error: 'sesión no válida', ip: red });
  }
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
  if (ok) {
    const actual = (await firebase().auth().getUser(usuario.uid)).customClaims || {};
    await firebase().auth().setCustomUserClaims(usuario.uid, { ...actual, redHasta: Date.now() + DURACION_MS });
  }
  return res.status(200).json({ ok, ip: red });
}
