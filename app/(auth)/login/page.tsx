import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Banner } from '@/components/form/banner';
import { SERVICE_UNAVAILABLE_MESSAGE } from '@/lib/auth/errors';
import { createClient, isSupabaseUnreachable } from '@/lib/supabase/server';

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
  // Skipped when middleware already found Supabase unreachable: asking again
  // would only add a second timeout before the same answer.
  if (!isSupabaseUnreachable()) {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect('/dashboard');
    }
  }

  // Matched against known values rather than rendered, so that a crafted
  // ?error= in the URL cannot put arbitrary text on our own login page.
  //   auth_callback_failed: /auth/callback, for a confirmation link that is
  //     expired, already used, or opened in a different browser.
  //   service: middleware, when a protected page could not check the session
  //     because Supabase did not answer.
  const callout =
    searchParams.error === 'auth_callback_failed'
      ? {
          tone: 'info' as const,
          text: 'That sign-in link is no longer valid. Sign in with your email and password instead.',
        }
      : searchParams.error === 'service'
        ? { tone: 'error' as const, text: SERVICE_UNAVAILABLE_MESSAGE }
        : null;

  return (
    <>
      <h1 className="text-xl font-semibold text-fg">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Welcome back. Your squads are waiting.
      </p>

      {callout ? (
        <Banner tone={callout.tone} className="mb-4">
          {callout.text}
        </Banner>
      ) : null}

      <LoginForm />

      <p className="mt-4 text-sm">
        <Link href="/forgot-password" className="font-medium text-data hover:underline">
          Forgot your password?
        </Link>
      </p>

      <p className="mt-2 text-sm text-muted">
        No account?{' '}
        <Link href="/signup" className="font-medium text-data hover:underline">
          Create one
        </Link>
        .
      </p>
    </>
  );
}
