// Links from the landing into the app. The app uses hash routes (#/registro, #/demo...).
const DEFAULT_APP_URL = 'http://localhost:4321/';

const base = import.meta.env.PUBLIC_APP_URL ?? DEFAULT_APP_URL;

/** Builds a link to an app route, e.g. appLink('/registro', { plan: 'familiar' }). */
export function appLink(route: string, params: Readonly<Record<string, string>> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `${base}#${route}${query === '' ? '' : `?${query}`}`;
}
