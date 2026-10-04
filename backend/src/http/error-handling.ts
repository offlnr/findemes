import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * Error whose code and message are safe to show to the client (neutral Spanish, no personal
 * data). Any other error is answered with a fixed generic message for its status.
 */
export class PublicError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'PublicError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface ErrorBody {
  readonly error: string;
  readonly message: string;
  readonly fields?: readonly string[];
}

const GENERIC_ERRORS: Readonly<Record<number, ErrorBody>> = {
  400: { error: 'bad_request', message: 'La solicitud no es válida.' },
  401: { error: 'unauthorized', message: 'Se requiere autenticación.' },
  404: { error: 'not_found', message: 'Recurso no encontrado.' },
  409: { error: 'conflict', message: 'No se puede completar la solicitud.' },
  413: { error: 'payload_too_large', message: 'La solicitud excede el tamaño permitido.' },
  415: { error: 'unsupported_media_type', message: 'Tipo de contenido no admitido.' },
  429: { error: 'too_many_requests', message: 'Se alcanzó el límite de solicitudes. Intenta más tarde.' },
};
const OTHER_CLIENT_ERROR: ErrorBody = { error: 'client_error', message: 'No se puede completar la solicitud.' };
const INTERNAL_ERROR: ErrorBody = { error: 'internal_error', message: 'Ocurrió un error inesperado.' };

/** Uniform error responses for both APIs. Never echoes error messages, values or URLs. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof PublicError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }

    const status = error.statusCode ?? 500;
    if (status < 400 || status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.status(500).send(INTERNAL_ERROR);
    }

    if (error.validation !== undefined) {
      // Field paths only; never the rejected values.
      const fields = error.validation.map((issue) => issue.instancePath || '/');
      return reply.status(400).send({ error: 'validation_error', message: 'La solicitud no es válida.', fields });
    }

    return reply.status(status).send(GENERIC_ERRORS[status] ?? OTHER_CLIENT_ERROR);
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(GENERIC_ERRORS[404]));
}
