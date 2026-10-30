/**
 * Product naming, in one place. The spec asks for a product name without
 * fixing one, so this is the single edit that renames the app everywhere.
 */
export const APP_NAME = 'SquadSync';
export const APP_TAGLINE = 'AI squad matchmaking for BGMI';
export const LIVE_URL = 'https://bgmi-match-makingsystem.vercel.app';

/**
 * The app's public origin, no trailing slash: the single source for absolute
 * URLs (email links now; canonical, Open Graph and sitemap as they are added).
 *
 * Never derived from request headers. A forged Host or Origin header would
 * otherwise choose where a password-reset link points.
 *
 * Without NEXT_PUBLIC_SITE_URL, production falls back to the live URL and dev
 * to localhost. Preview builds count as production here, so their emails point
 * at the live site: Supabase's redirect allow-list does not include preview
 * hostnames anyway.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return process.env.NODE_ENV === 'production' ? LIVE_URL : 'http://localhost:3000';
}
