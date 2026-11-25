// ================================================
// API/VERSION.JS — Versión publicada ahora mismo (commit de Vercel). La app la consulta
// cada pocos minutos y, si cambia, avisa de que hay una versión nueva para recargar.
// Solo devuelve el identificador del despliegue: nada de datos.
// ================================================

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ v: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '' });
}
