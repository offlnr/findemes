import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicError } from '../../http/error-handling.ts';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import type { Actor } from '../../modules/shared/actor.ts';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Deny by default (CLAUDE.md, Autorización): a route that needs a user calls this first and
 * receives the actor that every repository requires. Any problem answers the same 401.
 */
export async function requireActor(request: FastifyRequest, accessTokens: AccessTokenService): Promise<Actor> {
  const match = BEARER.exec(request.headers.authorization ?? '');
  const userId = match?.[1] === undefined ? null : await accessTokens.verify(match[1]);
  if (userId === null) {
    throw new PublicError(401, 'unauthorized', 'Se requiere autenticación.');
  }
  return { userId };
}

/** Responses with tokens or personal data must never be cached by browsers or proxies. */
export function noStore(reply: FastifyReply): void {
  void reply.header('cache-control', 'no-store');
}
