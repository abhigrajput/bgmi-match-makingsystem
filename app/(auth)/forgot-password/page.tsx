import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotForm } from './forgot-form';

export const metadata: Metadata = {
  title: 'Reset your password',
};

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Enter your account email and we will send you a link to choose a new password.
      </p>

      <ForgotForm />

      <p className="mt-6 text-sm text-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-data hover:underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
