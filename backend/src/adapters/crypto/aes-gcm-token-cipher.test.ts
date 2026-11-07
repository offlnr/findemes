import { describe, expect, it } from 'vitest';
import { createAesGcmTokenCipher } from './aes-gcm-token-cipher.ts';

const key = (fill: number) => new Uint8Array(32).fill(fill);

describe('AES-256-GCM token cipher', () => {
  it('round-trips with a fresh nonce each time and never stores the clear text', () => {
    const cipher = createAesGcmTokenCipher(new Map([[1, key(1)]]), 1);
    const a = cipher.encrypt('link_token_secreto');
    const b = cipher.encrypt('link_token_secreto');
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).toString('utf8')).not.toContain('link_token');
    expect(cipher.decrypt(a)).toBe('link_token_secreto');
  });

  it('rejects tampered ciphertexts and decrypts old tokens after a key rotation', () => {
    const old = createAesGcmTokenCipher(new Map([[1, key(1)]]), 1).encrypt('viejo');
    const rotated = createAesGcmTokenCipher(new Map([[1, key(1)], [2, key(2)]]), 2);
    expect(rotated.decrypt(old)).toBe('viejo');
    expect(rotated.encrypt('nuevo').keyVersion).toBe(2);
    const tampered = { ...old, ciphertext: old.ciphertext.map((byte, i) => (i === 0 ? byte ^ 1 : byte)) };
    expect(() => rotated.decrypt(tampered)).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => createAesGcmTokenCipher(new Map([[1, new Uint8Array(16)]]), 1)).toThrow('32 bytes');
  });
});
