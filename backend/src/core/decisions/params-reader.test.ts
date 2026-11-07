import { describe, expect, it } from 'vitest';
import { MAX_DECISION_AMOUNT, ParamsReader } from './params-reader.ts';

function issuesOf(raw: unknown, read: (reader: ParamsReader) => unknown) {
  const reader = ParamsReader.open(raw, ['value']);
  read(reader);
  return reader.issues;
}

describe('ParamsReader', () => {
  it('rejects arrays and null as params', () => {
    expect(issuesOf([], (r) => r.label('value'))).toEqual([{ field: 'params', message: 'Los parámetros de la decisión deben ser un objeto.' }]);
    expect(issuesOf(null, (r) => r.label('value'))).toHaveLength(1);
  });

  it('bounds names to 80 characters after trimming', () => {
    expect(issuesOf({ value: `  ${'a'.repeat(80)}  ` }, (r) => r.label('value'))).toEqual([]);
    expect(issuesOf({ value: 'a'.repeat(81) }, (r) => r.label('value'))).toEqual([
      { field: 'value', message: 'El nombre admite hasta 80 caracteres.' },
    ]);
  });

  it('accepts only whole-peso amounts within the maximum', () => {
    expect(issuesOf({ value: 10.5 }, (r) => r.amount('value', 'positive'))[0]?.message).toBe('El monto debe ser un número entero de pesos.');
    expect(issuesOf({ value: '100' }, (r) => r.amount('value', 'positive'))).toHaveLength(1);
    expect(issuesOf({ value: -MAX_DECISION_AMOUNT - 1 }, (r) => r.amount('value', 'non_zero'))[0]?.message).toBe(
      'El monto excede el máximo permitido.',
    );
    expect(issuesOf({ value: -1 }, (r) => r.amount('value', 'non_negative'))[0]?.message).toBe('El monto no puede ser negativo.');
    expect(issuesOf({ value: 0 }, (r) => r.amount('value', 'non_negative'))).toEqual([]);
  });

  it('reads ranges strictly', () => {
    expect(issuesOf({ value: '2027-01' }, (r) => r.range('value'))[0]?.field).toBe('value');
    expect(issuesOf({ value: { from: '2027-01', until: null, extra: 1 } }, (r) => r.range('value'))).toEqual([
      { field: 'value.extra', message: 'Campo no reconocido.' },
    ]);
    expect(issuesOf({ value: { from: 202701 } }, (r) => r.range('value'))[0]?.field).toBe('value.from');
    expect(issuesOf({ value: { from: '2027-01', until: '2027-1' } }, (r) => r.range('value'))[0]?.field).toBe('value.until');
  });

  it('defaults an omitted option and rejects values outside the list', () => {
    const reader = ParamsReader.open({}, ['value']);
    expect(reader.oneOf('value', ['a', 'b'], 'a')).toBe('a');
    expect(issuesOf({ value: 3 }, (r) => r.oneOf('value', ['a', 'b'], 'a'))[0]?.message).toBe('Opción no válida.');
  });

  it('requires a non-empty identifier string', () => {
    expect(issuesOf({ value: '' }, (r) => r.string('value'))[0]?.message).toBe('Selecciona un elemento.');
  });
});
