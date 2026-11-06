import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totpStep, verifyTotp } from './totp.ts';

// RFC 6238 appendix B: ASCII secret "12345678901234567890", SHA-1, 8 digits. With 6 digits the
// expected values are the last six digits of the published ones.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('matches the published test vectors', () => {
    const secret = base32Decode(RFC_SECRET);
    expect(hotp(secret, totpStep(new Date(59_000)))).toBe('287082');
    expect(hotp(secret, totpStep(new Date(1_111_111_109_000)))).toBe('081804');
    expect(hotp(secret, totpStep(new Date(2_000_000_000_000)))).toBe('279037');
  });

  it('accepts one step of clock drift and returns the step for replay checks', () => {
    const now = new Date(1_111_111_109_000);
    expect(verifyTotp(RFC_SECRET, '081804', now)).toBe(totpStep(now));
    expect(verifyTotp(RFC_SECRET, '081804', new Date(now.getTime() + 30_000))).toBe(totpStep(now));
    expect(verifyTotp(RFC_SECRET, '081804', new Date(now.getTime() + 90_000))).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32 and builds the authenticator URI', () => {
    expect(Buffer.from(base32Decode(base32Encode(Buffer.from('hola mundo')))).toString()).toBe('hola mundo');
    expect(otpauthUri('ABC', 'ana@findemes.cl')).toBe(
      'otpauth://totp/Fin%20de%20Mes%20Admin%3Aana%40findemes.cl?secret=ABC&issuer=Fin%20de%20Mes%20Admin&algorithm=SHA1&digits=6&period=30',
    );
  });
});
