// ================================================
// API/EXTRAER.JS — Convierte una FOTO de una tabla o una LISTA DE TEXTO libre en filas de
// jugadores (fila 1 = títulos de las columnas de la app). La app las enseña en la vista previa
// de "Cargar datos" antes de guardar nada.
// Necesita ANTHROPIC_API_KEY en Vercel. Solo usuarios con sesión iniciada en la app.
// ================================================

import Anthropic from '@anthropic-ai/sdk';
import { usuarioDe } from './_firebase.js';

export const config = { maxDuration: 60 };

const MAX_TEXTO = 20000;
const MAX_IMAGEN = 6 * 1024 * 1024; // base64
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const ESQUEMA = {
  type: 'object',
  properties: { filas: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
  required: ['filas'],
  additionalProperties: false,
};

const instrucciones = columnas => `Extrae los datos de jugadores de fútbol de lo que te paso y devuélvelos como tabla.

Columnas que admite la app (título exacto · qué va):
${columnas.map(c => `- ${c.titulo}${c.nota ? ' · ' + c.nota : ''}`).join('\n')}

Reglas:
- "filas"[0] = los títulos que uses, copiados EXACTAMENTE de la lista. Usa solo las columnas que aparezcan en los datos (siempre "Nombre"; "Apellidos" si los hay).
- Una fila más por jugador, con los valores en el mismo orden que los títulos.
- Si un dato de un jugador no está o no se lee con seguridad, deja "" (cadena vacía). No inventes ni deduzcas nada.
- Copia los números tal cual (vale la coma decimal). Fechas en dd/mm/aaaa.
- Para valoraciones con símbolos usa ✔ (bien), ▬ (regular) o ✘ (mal).
- Si el nombre viene junto ("Sotres García, Alfredo" o "Alfredo Sotres"), sepáralo en Nombre y Apellidos.
- Si no hay ningún jugador, devuelve "filas": [].`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'no-configurado' });
  const usuario = await usuarioDe(req);
  if (!usuario?.email) return res.status(401).json({ error: 'sesión no válida' });

  const { texto, imagen, mediaType, columnas } = req.body || {};
  if (!Array.isArray(columnas) || !columnas.length || columnas.length > 80) return res.status(400).json({ error: 'columnas' });
  const cols = columnas.map(c => ({ titulo: String(c?.titulo || '').slice(0, 80), nota: String(c?.nota || '').replace(/<[^>]+>/g, '').slice(0, 300) })).filter(c => c.titulo);

  const contenido = [];
  if (imagen) {
    if (!TIPOS.includes(mediaType) || typeof imagen !== 'string' || imagen.length > MAX_IMAGEN) return res.status(400).json({ error: 'imagen no válida (JPG/PNG, máx. ~4 MB)' });
    contenido.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imagen } });
  } else if (typeof texto === 'string' && texto.trim()) {
    if (texto.length > MAX_TEXTO) return res.status(400).json({ error: 'texto demasiado largo' });
    contenido.push({ type: 'text', text: '<datos>\n' + texto + '\n</datos>' });
  } else {
    return res.status(400).json({ error: 'falta la foto o el texto' });
  }
  contenido.push({ type: 'text', text: instrucciones(cols) });

  try {
    const client = new Anthropic();
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{ role: 'user', content: contenido }],
    });
    if (r.stop_reason === 'refusal') return res.status(422).json({ error: 'no se pudo leer' });
    if (r.stop_reason === 'max_tokens') return res.status(422).json({ error: 'demasiados datos: divide la foto o el texto' });
    const txt = r.content.find(b => b.type === 'text')?.text || '';
    const filas = JSON.parse(txt).filas;
    return res.status(200).json({ filas: Array.isArray(filas) ? filas : [] });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'demasiadas peticiones: prueba en un minuto' });
    if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'clave de API no válida' });
    console.error('[extraer]', err?.status || '', err?.message || err);
    return res.status(500).json({ error: 'error al leer' });
  }
}
