import type { Metadata } from 'next';

import { AcceptInvite } from '../accept-invite/accept-invite';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Choose a new password · SquadSync',
  description:
    'Choose a new SquadSync password from the link in your reset email.',
  path: '/reset-password',
});

/**
 * Where a password-reset email lands. The session is in the URL fragment, which
 * only the browser can read, so the work happens in the same client component
 * that handles invite links.
 */
export default function ResetPasswordPage() {
  return <AcceptInvite next="/dashboard" mode="reset" />;
}
