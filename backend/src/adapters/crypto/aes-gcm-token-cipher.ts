import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SealedToken, TokenCipher } from '../../modules/aggregation/ports/aggregation-ports.ts';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM with a random 96-bit nonce per token. The ciphertext stores the authentication tag
 * at its end. Keys are versioned so they can be rotated: new tokens use `currentVersion`, old ones
 * still decrypt with their own key. The database never sees a token in clear.
 */
export function createAesGcmTokenCipher(keys: ReadonlyMap<number, Uint8Array>, currentVersion: number): TokenCipher {
  for (const [version, key] of keys) {
    if (key.length !== 32) throw new Error(`Token key version ${String(version)} must have 32 bytes`);
  }
  const keyFor = (version: number) => {
    const key = keys.get(version);
    if (key === undefined) throw new Error(`Unknown token key version ${String(version)}`);
    return key;
  };
  keyFor(currentVersion);

  return {
    encrypt(plaintext: string): SealedToken {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', keyFor(currentVersion), nonce);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return { ciphertext: new Uint8Array(body), nonce: new Uint8Array(nonce), keyVersion: currentVersion };
    },
    decrypt(sealed: SealedToken): string {
      const data = Buffer.from(sealed.ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', keyFor(sealed.keyVersion), Buffer.from(sealed.nonce));
      decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
      return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_BYTES)), decipher.final()]).toString('utf8');
    },
  };
}
