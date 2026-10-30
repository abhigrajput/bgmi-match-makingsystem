/**
 * Which Supabase settings this build is missing, by NAME. Never a value.
 *
 * Complete `process.env.NEXT_PUBLIC_*` expressions for the reason given in
 * client.ts: this also runs in the browser and on the Edge runtime, where only
 * that exact syntax is substituted at build time.
 *
 * Without these nothing can talk to Supabase, but that is an outage for
 * sign-in, not for the site: public pages render signed out and protected ones
 * go to /login?error=service, the same as when Supabase does not answer.
 */
export function missingSupabaseConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}
