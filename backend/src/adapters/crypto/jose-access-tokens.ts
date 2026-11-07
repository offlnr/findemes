import { SignJWT, jwtVerify } from 'jose';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import type { UserId } from '../../modules/shared/actor.ts';
import type { Clock } from '../../modules/shared/ports.ts';

const ALGORITHM = 'HS256';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenConfig {
  /** At least 32 random bytes, from the environment (never committed). */
  readonly secret: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
  readonly lifetimeMs: number;
  readonly clock: Clock;
}

/**
 * JWT access tokens (CLAUDE.md, Sesiones): the algorithm is fixed on both sides, so `alg: none`
 * or a switched algorithm is rejected, and `iss`, `aud` and `exp` are always validated.
 */
export function createAccessTokenService(config: AccessTokenConfig): AccessTokenService {
  if (config.secret.length < 32) {
    throw new Error('The access token secret must have at least 32 bytes');
  }
  return {
    async issue(userId: UserId) {
      const now = config.clock.now().getTime();
      const expiresAt = new Date(now + config.lifetimeMs);
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setIssuedAt(Math.floor(now / 1000))
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(config.secret);
      return { token, expiresAt };
    },
    async verify(token: string) {
      try {
        const { payload } = await jwtVerify(token, config.secret, {
          algorithms: [ALGORITHM],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims: ['exp', 'sub'],
          currentDate: config.clock.now(),
        });
        return typeof payload.sub === 'string' && UUID.test(payload.sub) ? (payload.sub as UserId) : null;
      } catch {
        return null;
      }
    },
  };
}
