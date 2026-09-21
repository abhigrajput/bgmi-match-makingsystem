/**
 * Date and number formatting shared by every page.
 *
 * Explicit locale AND explicit time zone, always. Left to the runtime, the
 * server (UTC on Vercel) and the browser (IST for most players) format the
 * same instant differently, and React reports the difference as a hydration
 * mismatch. Tournaments are scheduled in IST, so that is the zone shown.
 */

export const APP_TIME_ZONE = 'Asia/Kolkata';

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
  }).format(new Date(iso)) + ' IST';
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: APP_TIME_ZONE,
  }).format(new Date(iso));
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
