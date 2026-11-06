import { formatYearMonth, parseYearMonth, type Schedule } from '../../core/index.ts';

/** Shared request/response schemas of the routes that take a schedule (registry, household). */

export function strict(properties: Record<string, unknown>, required: string[] = Object.keys(properties)) {
  return { type: 'object', additionalProperties: false, required, properties } as const;
}

export const month = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', examples: ['2026-11'] } as const;
export const nullableMonth = { anyOf: [month, { type: 'null' }] } as const;
export const amount = { type: 'integer', minimum: 1, maximum: 1_000_000_000_000 } as const;
export const label = { type: 'string', minLength: 1, maxLength: 80 } as const;
export const id = { type: 'string', format: 'uuid' } as const;

export const scheduleSchema = {
  description: 'Periodicidad (HU01): un solo mes, todos los meses o cada N meses desde el mes de inicio. until null = sin término.',
  oneOf: [
    strict({ kind: { type: 'string', enum: ['once'] }, month }),
    strict({ kind: { type: 'string', enum: ['monthly'] }, from: month, until: nullableMonth }),
    strict({ kind: { type: 'string', enum: ['every_n_months'] }, intervalMonths: { type: 'integer', minimum: 2, maximum: 24 }, from: month, until: nullableMonth }),
  ],
} as const;

export type ScheduleJson =
  | { kind: 'once'; month: string }
  | { kind: 'monthly'; from: string; until: string | null }
  | { kind: 'every_n_months'; intervalMonths: number; from: string; until: string | null };

export function scheduleFromJson(json: ScheduleJson): Schedule {
  switch (json.kind) {
    case 'once':
      return { kind: 'once', month: parseYearMonth(json.month) };
    case 'monthly':
      return { kind: 'monthly', from: parseYearMonth(json.from), until: json.until === null ? null : parseYearMonth(json.until) };
    case 'every_n_months':
      return {
        kind: 'every_n_months',
        intervalMonths: json.intervalMonths,
        from: parseYearMonth(json.from),
        until: json.until === null ? null : parseYearMonth(json.until),
      };
  }
}

export function scheduleToJson(schedule: Schedule): ScheduleJson {
  switch (schedule.kind) {
    case 'once':
      return { kind: 'once', month: formatYearMonth(schedule.month) };
    case 'monthly':
      return { kind: 'monthly', from: formatYearMonth(schedule.from), until: schedule.until === null ? null : formatYearMonth(schedule.until) };
    case 'every_n_months':
      return {
        kind: 'every_n_months',
        intervalMonths: schedule.intervalMonths,
        from: formatYearMonth(schedule.from),
        until: schedule.until === null ? null : formatYearMonth(schedule.until),
      };
  }
}

