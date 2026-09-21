/**
 * Caller authentication for API route handlers.
 *
 * Always the cookie client with getUser() -- which revalidates the JWT with the
 * auth server -- and always BEFORE a route creates its service-role client.
 * The order is the security property: the admin client answers as the
 * database owner, so a route must know who is asking before it has one.
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export type Caller = { userId: string; profileId: string | null };

export async function authenticate(): Promise<Caller | NextResponse> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to do that.' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return { userId: user.id, profileId: profile?.id ?? null };
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
