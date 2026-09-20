import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Create an account',
};

export default async function SignupPage() {
  const supabase = createClient();

  // Same reasoning as the login page: a signed-in user on a signup form can
  // only create a second account, which is not what they meant to do.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Create an account</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-600">
        Squad Recommendation System
      </p>

      <SignupForm />

      <p className="mt-6 text-sm text-neutral-600">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
