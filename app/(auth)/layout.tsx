import type { Metadata } from 'next';

import { Wordmark } from '@/components/shell/wordmark';
import { NO_INDEX } from '@/lib/seo';

export const metadata: Metadata = { robots: NO_INDEX };

/**
 * Shell for the login and signup pages.
 *
 * `(auth)` is a route group: the parentheses keep it out of the URL, so these
 * pages are /login and /signup, not /auth/login. The group exists to give both
 * forms this layout without imposing it on the rest of the app, and to keep the
 * two Server Actions they share in one place alongside them.
 *
 * Note the distinction from the sibling `app/auth/` directory, which is not a
 * group and does appear in URLs: /auth/callback and /auth/signout are machine
 * endpoints, not pages, and they deliberately do not inherit this layout.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-12">
      {/* Decorative amber glow behind the card; aria-hidden, no content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgb(var(--accent)/0.14),transparent_65%)]"
      />
      <div className="relative w-full max-w-sm">
        <Wordmark tagline className="mb-8 flex justify-center" />
        <div className="rounded-card border border-border bg-surface p-6">
          {children}
        </div>
      </div>
    </main>
  );
}
