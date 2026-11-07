import { describe, expect, it } from 'vitest';
import { displayNameIssue, emailIssue, normalizeEmail, passwordIssue } from './account-rules.ts';
import { accountLockMs } from './session-policy.ts';

const never = () => false;

describe('account rules', () => {
  it('normalizes emails the way the database expects', () => {
    expect(normalizeEmail('  Ana.Perez@Example.CL ')).toBe('ana.perez@example.cl');
  });

  it('accepts plausible emails and rejects malformed ones', () => {
    expect(emailIssue('ana@example.cl')).toBeNull();
    for (const bad of ['', 'ana', 'ana@', '@example.cl', 'ana@example', 'ana @example.cl', `${'a'.repeat(65)}@example.cl`]) {
      expect(emailIssue(bad)).toEqual({ field: 'email', message: 'Ingresa un correo válido.' });
    }
  });

  it('requires a display name of 2 to 40 characters', () => {
    expect(displayNameIssue('Jo')).toBeNull();
    expect(displayNameIssue(' A ')?.field).toBe('displayName');
    expect(displayNameIssue('a'.repeat(41))?.field).toBe('displayName');
  });

  it('requires at least ten characters, counting emoji as one', () => {
    expect(passwordIssue('123456789', never)?.message).toBe('La contraseña debe tener al menos 10 caracteres.');
    expect(passwordIssue('🔑🔑🔑🔑🔑🔑🔑🔑🔑', never)).not.toBeNull();
    expect(passwordIssue('correcto caballo batería', never)).toBeNull();
  });

  it('bounds the length so hashing stays cheap', () => {
    expect(passwordIssue('a'.repeat(129), never)?.message).toBe('La contraseña admite hasta 128 caracteres.');
    // Ten graphemes, but 610 code units: 600 combining acute accents (U+0301) on the last letter.
    expect(passwordIssue(`abcdefghij${String.fromCodePoint(0x301).repeat(600)}`, never)?.message).toBe(
      'La contraseña admite hasta 128 caracteres.',
    );
  });

  it('rejects passwords found in the breached list', () => {
    expect(passwordIssue('contraseña123', (p) => p === 'contraseña123')?.message).toBe(
      'Esa contraseña aparece en filtraciones conocidas. Elige otra.',
    );
  });
});

describe('accountLockMs (HU17.1)', () => {
  it('does not lock before the fifth consecutive failure', () => {
    expect([0, 1, 4].map(accountLockMs)).toEqual([0, 0, 0]);
  });

  it('locks for one minute at five failures and doubles up to one hour', () => {
    expect([5, 6, 7, 10, 11, 50].map(accountLockMs)).toEqual([60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000]);
  });
});
