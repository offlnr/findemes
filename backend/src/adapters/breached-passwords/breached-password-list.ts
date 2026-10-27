import { readFileSync } from 'node:fs';
import type { BreachedPasswordList } from '../../modules/identity/ports/identity-ports.ts';

const DEFAULT_FILE = new URL('./common-passwords.txt', import.meta.url);

/** Local list loaded once at startup (HU17): no password ever leaves the server. */
export function loadBreachedPasswordList(file: URL = DEFAULT_FILE): BreachedPasswordList {
  const entries = new Set(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  return { contains: (password) => entries.has(password.trim().toLowerCase()) };
}
