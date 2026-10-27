import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../../modules/identity/ports/identity-ports.ts';

/**
 * OWASP Password Storage Cheat Sheet: argon2id, 19 MiB, 2 iterations, 1 lane.
 * `algorithm: 2` is Algorithm.Argon2id (an ambient const enum, not importable as a value here).
 */
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const argon2PasswordHasher: PasswordHasher = {
  hash: (password) => hash(password, OPTIONS),
  verify: async (passwordHash, password) => {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash is a failed verification, never an exception for the caller.
      return false;
    }
  },
};
