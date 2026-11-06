import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 defaults that every authenticator app supports: SHA-1, 6 digits, 30-second steps. */
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept one step before and after, for small clock differences. */
const WINDOW = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31] ?? '';
  return output;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

/** RFC 4226 HOTP value for one counter. */
export function hotp(secret: Uint8Array, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | ((digest[offset + 1] ?? 0) << 16) | ((digest[offset + 2] ?? 0) << 8) | (digest[offset + 3] ?? 0);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const totpStep = (now: Date) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/**
 * Checks a TOTP code (RNF22). Returns the matching time step, so the caller can refuse a code
 * that was already used (replay), or `null`. Comparison is constant time.
 */
export function verifyTotp(base32Secret: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(base32Secret);
  const current = totpStep(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const expected = Buffer.from(hotp(secret, current + delta));
    if (timingSafeEqual(expected, Buffer.from(code))) return current + delta;
  }
  return null;
}

/** A new 160-bit secret, base32, as authenticator apps expect. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI for the authenticator app (QR code or manual entry). */
export function otpauthUri(base32Secret: string, account: string, issuer = 'Fin de Mes Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${String(DIGITS)}&period=${String(STEP_SECONDS)}`;
}
