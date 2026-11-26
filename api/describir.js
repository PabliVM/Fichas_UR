// ================================================
// API/DESCRIBIR.JS — Propone la "Descripción del jugador" de la Ficha 1 a partir de sus notas
// y de los comentarios de los evaluadores. Solo devuelve texto: la app lo pone en la ficha
// para que el técnico lo revise y lo guarde (nunca se guarda solo).
// Necesita ANTHROPIC_API_KEY en Vercel. Solo usuarios con sesión iniciada en la app.
// ================================================

import Anthropic from '@anthropic-ai/sdk';
import { usuarioDe } from './_firebase.js';

export const config = { maxDuration: 60 };

const MAX_JSON = 30000;

const SISTEMA = `Eres un analista de la cantera de un club de fútbol profesional. Redactas la "Descripción del jugador" de su informe individual.
Reglas:
- Español de España, tono técnico y profesional, en tercera persona y en presente.
- Un solo párrafo de 3 a 6 frases (máximo unas 100 palabras). Sin títulos, listas, comillas ni emojis.
- Basado SOLO en los datos que te dan: notas (escala 1-5) y comentarios de los evaluadores. No inventes datos, partidos, cifras ni rasgos.
- PRIORIDAD: empieza por sus perfiles (los 3 de la ficha): qué tipo de jugador es según ellos, del perfil con nota más alta al más bajo. Después continúa con lo demás (competencias, mental y técnico) y termina con lo que debe mejorar.
- No repitas las notas en número.
- No menciones a los evaluadores ni que el texto sale de una encuesta.
- Si hay frases modelo, úsalas como guía de estilo y vocabulario (puedes reutilizar expresiones), sin copiarlas si no encajan con los datos.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'no-configurado' });
  const usuario = await usuarioDe(req);
  if (!usuario?.email) return res.status(401).json({ error: 'sesión no válida' });

  const d = req.body || {};
  if (!Array.isArray(d.notas) || !d.notas.length) return res.status(400).json({ error: 'sin notas' });
  const datos = JSON.stringify({
    posicion: String(d.posicion || '').slice(0, 60),
    equipo: String(d.equipo || '').slice(0, 60),
    perfiles_ficha: (Array.isArray(d.perfiles) ? d.perfiles : []).slice(0, 3).map(x => ({ perfil: String(x?.perfil || '').slice(0, 60), nota: typeof x?.nota === 'number' ? x.nota : null, nivel: String(x?.nivel || '').slice(0, 30) })),
    notas: d.notas.slice(0, 80),
    rendimiento_y_proyeccion: d.rp || null,
    comentarios_evaluadores: d.comentarios || {},
  });
  const frases = (Array.isArray(d.frasesModelo) ? d.frasesModelo : []).slice(0, 40).map(f => String(f).slice(0, 300));
  if (datos.length > MAX_JSON) return res.status(400).json({ error: 'demasiados datos' });

  const nombre = String(d.jugador || 'El jugador').slice(0, 80);
  const contenido = `Jugador: ${nombre}
<datos>
${datos}
</datos>
${frases.length ? `<frases_modelo>\n${frases.join('\n')}\n</frases_modelo>\n` : ''}
Escribe solo el párrafo de la descripción.`;

  try {
    const client = new Anthropic();
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SISTEMA,
      messages: [{ role: 'user', content: contenido }],
    });
    if (r.stop_reason === 'refusal') return res.status(422).json({ error: 'no se pudo redactar' });
    const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!texto) return res.status(422).json({ error: 'respuesta vacía' });
    return res.status(200).json({ texto });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'demasiadas peticiones: prueba en un minuto' });
    if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'clave de API no válida' });
    console.error('[describir]', err?.status || '', err?.message || err);
    return res.status(500).json({ error: 'error al redactar' });
  }
}
