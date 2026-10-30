import type { Metadata } from 'next';

import { AcceptInvite } from '../accept-invite/accept-invite';

export const metadata: Metadata = {
  title: 'Choose a new password',
};

/**
 * Where a password-reset email lands. The session is in the URL fragment, which
 * only the browser can read, so the work happens in the same client component
 * that handles invite links.
 */
export default function ResetPasswordPage() {
  return <AcceptInvite next="/dashboard" mode="reset" />;
}
