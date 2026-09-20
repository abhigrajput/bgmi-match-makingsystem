import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

/**
 * A server component wrapping a client form.
 *
 * The already-signed-in check happens here rather than in the middleware
 * because it is the inverse of route protection: the middleware guards pages
 * that need a session, and this guards a page that only makes sense without
 * one. Landing a signed-in user on a login form is a dead end -- they sign in
 * again and nothing appears to happen.
 *
 * getUser(), not getSession(): the session cookie is attacker-controlled, and
 * only getUser() revalidates it against the auth server.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  // Set by /auth/callback when a confirmation link is expired, already used, or
  // opened in a different browser than it was requested from. Matched against a
  // known value rather than rendered, so that a crafted ?error= in the URL
  // cannot put arbitrary text on our own login page.
  const calloutError =
    searchParams.error === 'auth_callback_failed'
      ? 'That sign-in link is no longer valid. Sign in with your email and password instead.'
      : null;

  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-600">
        Squad Recommendation System
      </p>

      {calloutError ? (
        <p
          role="alert"
          className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {calloutError}
        </p>
      ) : null}

      <LoginForm />

      <p className="mt-6 text-sm text-neutral-600">
        No account?{' '}
        <Link href="/signup" className="underline">
          Create one
        </Link>
        .
      </p>
    </>
  );
}
