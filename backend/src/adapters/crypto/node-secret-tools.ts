import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import type { SecretTools } from '../../modules/identity/ports/identity-ports.ts';

/** Secrets from the OS CSPRNG; digests are what the database stores. */
export function createSecretTools(hmacKey: Uint8Array): SecretTools {
  if (hmacKey.length < 32) {
    throw new Error('The HMAC key must have at least 32 bytes');
  }
  return {
    opaqueToken: () => randomBytes(32).toString('base64url'),
    sixDigitCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
    sha256: (secret) => new Uint8Array(createHash('sha256').update(secret, 'utf8').digest()),
    hmac: (value) => new Uint8Array(createHmac('sha256', hmacKey).update(value, 'utf8').digest()),
  };
}
