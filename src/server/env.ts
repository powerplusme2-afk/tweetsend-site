/**
 * Every environment variable the server reads, named once.
 *
 * Values are never logged or returned; `/api/config` reports only whether
 * each is present, so the Settings page can say what is and is not wired
 * without showing anyone a secret.
 */
export const APP_ID =
  process.env.PRIVY_APP_ID || (import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined) || 'cmtwzyj3t013t0ci9h4wew655';

export const SITE_URL = (process.env.PUBLIC_SITE_URL || (import.meta.env.PUBLIC_SITE_URL as string | undefined) || '').replace(/\/$/, '');

export function payLink(id: string, origin?: string): string {
  const base = SITE_URL || origin || '';
  return `${base}/pay/${id}`;
}
