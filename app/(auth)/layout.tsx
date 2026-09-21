import Link from 'next/link';
import { Crosshair } from 'lucide-react';

import { APP_NAME, APP_TAGLINE } from '@/lib/site';

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
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-input bg-accent text-accent-fg">
            <Crosshair aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-semibold text-fg">{APP_NAME}</span>
            <span className="block text-xs text-muted">{APP_TAGLINE}</span>
          </span>
        </Link>
        <div className="rounded-card border border-border bg-surface p-6">
          {children}
        </div>
      </div>
    </main>
  );
}
