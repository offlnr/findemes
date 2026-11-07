/**
 * 400 response shared by every route: `issues` comes from domain rules (field + message),
 * `fields` from schema validation in the uniform error handler (paths only, never values).
 * Both shapes must serialize, or a schema failure would surface as a 500.
 */
export const badRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'message'],
        properties: { field: { type: 'string' }, message: { type: 'string' } },
      },
    },
    fields: { type: 'array', items: { type: 'string' } },
  },
} as const;
