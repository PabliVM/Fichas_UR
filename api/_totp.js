// TOTP (RFC 6238): el mismo código de 6 dígitos que Google/Microsoft Authenticator. Sin dependencias.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function nuevaClave() {
  const bytes = crypto.randomBytes(20);
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = ((val << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function decodificar(clave) {
  let bits = 0, val = 0;
  const out = [];
  for (const c of clave.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function codigoEn(clave, paso) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', decodificar(clave)).update(b).digest();
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

/** Paso de 30 s en el que encaja el código (acepta ±1 por desfase de reloj) y posterior a `ultimo` (sin reutilizar), o null. */
export function pasoValido(clave, codigo, ultimo = 0, ahora = Date.now()) {
  if (!/^\d{6}$/.test(String(codigo))) return null;
  const t = Math.floor(ahora / 30000);
  for (const d of [-1, 0, 1]) {
    const paso = t + d;
    if (paso > ultimo && crypto.timingSafeEqual(Buffer.from(codigoEn(clave, paso)), Buffer.from(String(codigo)))) return paso;
  }
  return null;
}

export const urlOtpauth = (clave, email) =>
  `otpauth://totp/${encodeURIComponent(`RM Perfiles:${email}`)}?secret=${clave}&issuer=${encodeURIComponent('RM Perfiles')}&algorithm=SHA1&digits=6&period=30`;
