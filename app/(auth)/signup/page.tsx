import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient, isSupabaseUnreachable } from '@/lib/supabase/server';

import { SignupForm } from './signup-form';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Create an account · SquadSync',
  description:
    'Create a SquadSync player card with your in-game name, region and main role.',
  path: '/signup',
});

export default async function SignupPage() {
  // Same reasoning as the login page: a signed-in user on a signup form can
  // only create a second account, which is not what they meant to do. Skipped
  // when middleware already found Supabase unreachable.
  if (!isSupabaseUnreachable()) {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect('/dashboard');
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-fg">Create an account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Set up your player profile in under a minute.
      </p>

      <SignupForm />

      <p className="mt-6 text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center font-medium text-data hover:underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
