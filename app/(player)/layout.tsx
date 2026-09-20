import Link from 'next/link';

/**
 * Shell for the signed-in player pages: /profile, /profile/availability,
 * /players and /players/[id].
 *
 * `(player)` is a route group -- the parentheses keep it out of the URL -- so
 * these are /profile and /players, not /player/profile. The group exists to
 * give all four pages one nav without imposing it on /login, and to keep
 * actions.ts beside the pages that call it.
 *
 * /dashboard is deliberately NOT in this group. It sits at app/dashboard and
 * predates these pages; moving it would change nothing about its URL but would
 * put an unrelated route's history into this group's directory. It renders its
 * own nav instead, which is two links' worth of duplication against a move that
 * would touch a file Phase 2 owns.
 */

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'My profile' },
  { href: '/profile/availability', label: 'Availability' },
  { href: '/players', label: 'Players' },
] as const;

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <nav aria-label="Player" className="flex flex-wrap gap-4 text-sm">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          A plain POST form, matching /dashboard. /auth/signout is POST-only
          because a sign-out reachable by GET can be fired by any <img> tag on
          any site, and a form is how you issue a POST with no JavaScript.
        */}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Sign out
          </button>
        </form>
      </header>

      {children}
    </div>
  );
}
