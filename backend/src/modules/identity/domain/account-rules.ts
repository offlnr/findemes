/** Field problem shown to the user in neutral Spanish. Never echoes the submitted value. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound so a huge password cannot make argon2id expensive (denial of service). */
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 40;

const graphemes = new Intl.Segmenter('es', { granularity: 'grapheme' });

// Pragmatic shape check (RFC 5321 lengths); deliverability is proven by the verification email.
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/** Emails are stored and compared trimmed and in lower case (matches the database CHECK). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailIssue(email: string): FieldIssue | null {
  const normalized = normalizeEmail(email);
  if (normalized.length < 3 || normalized.length > 254 || !EMAIL_SHAPE.test(normalized)) {
    return { field: 'email', message: 'Ingresa un correo válido.' };
  }
  return null;
}

/** Alias shown in the app (CU-08); not the legal name (data minimization, Ley 21.719). */
export function displayNameIssue(displayName: string): FieldIssue | null {
  const length = displayName.trim().length;
  if (length < DISPLAY_NAME_MIN_LENGTH || length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      field: 'displayName',
      message: `El nombre debe tener entre ${String(DISPLAY_NAME_MIN_LENGTH)} y ${String(DISPLAY_NAME_MAX_LENGTH)} caracteres.`,
    };
  }
  return null;
}

/**
 * HU17: at least ten characters and not in the local list of breached passwords (checked
 * without external calls). Length is counted in user-perceived characters (graphemes), so an
 * emoji or an accented letter counts as one.
 */
export function passwordIssue(password: string, isBreached: (password: string) => boolean, field = 'password'): FieldIssue | null {
  const length = [...graphemes.segment(password)].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return { field, message: `La contraseña debe tener al menos ${String(PASSWORD_MIN_LENGTH)} caracteres.` };
  }
  // Code units are bounded too: a few graphemes can hide thousands of combining characters.
  if (length > PASSWORD_MAX_LENGTH || password.length > PASSWORD_MAX_LENGTH * 4) {
    return { field, message: `La contraseña admite hasta ${String(PASSWORD_MAX_LENGTH)} caracteres.` };
  }
  if (isBreached(password)) {
    return { field, message: 'Esa contraseña aparece en filtraciones conocidas. Elige otra.' };
  }
  return null;
}
