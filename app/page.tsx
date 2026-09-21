/**
 * Landing page.
 *
 * States the problem and the approach in plain text, with the entry points to
 * the app above them. The only thing it reads is whether a session exists, so
 * a signed-in visitor gets one way forward instead of two forms that would
 * just redirect them.
 */

import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';

const primaryButton =
  'rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700';
const secondaryButton =
  'rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-100';

// The try/catch below would also swallow the signal cookies() throws to mark a
// route dynamic, and Next would prerender this page once as signed out. Opting
// out of static rendering explicitly keeps the button per-request.
export const dynamic = 'force-dynamic';

/**
 * Whether the request carries a valid session.
 *
 * getUser(), not getSession(), for the same reason as the login page: only
 * getUser() revalidates the cookie against the auth server. createClient()
 * throws when Supabase is not configured; the landing page should still render
 * in that state, so it is treated as signed out rather than surfaced as a 500.
 */
async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user !== null;
  } catch {
    return false;
  }
}

export default async function HomePage() {
  const signedIn = await isSignedIn();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <nav className="flex justify-end gap-3">
        {signedIn ? (
          <Link href="/dashboard" className={primaryButton}>
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link href="/login" className={secondaryButton}>
              Log in
            </Link>
            <Link href="/signup" className={primaryButton}>
              Sign up
            </Link>
          </>
        )}
      </nav>

      <header className="mt-8 border-b border-neutral-300 pb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">
          Skill-Based Squad Recommendation System
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          A prototype oriented around BGMI squads.
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-neutral-900">
          The problem
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          Matchmaking in squad-based battle royale games generally groups
          players by whoever is waiting at the same time, optionally filtered by
          a single skill rating. A squad assembled that way can be four players
          of identical rank who all want to play the same role, who cannot agree
          on when to play, and who do not speak the same language. The rating
          matched; nothing else did.
        </p>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          Skill is not one number, and a team is not the sum of four individual
          numbers. A squad needs someone calling rotations, someone entering
          fights first, and someone holding angles. It needs overlapping hours
          and a shared idea of whether voice chat is expected. Two players who
          each perform well alone can perform worse together than either would
          with a weaker but better-suited teammate.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-neutral-900">
          The approach
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          Model a player as a vector rather than a rating, and score a proposed
          squad on how well those vectors complement one another. Four inputs,
          kept deliberately separate because they change at different rates and
          come from different sources:
        </p>
        <dl className="mt-5 space-y-4">
          <div>
            <dt className="text-sm font-medium text-neutral-900">
              Measured skill
            </dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">
              Aim, game sense, teamwork, clutch performance, and consistency,
              derived from match history. Computed, not self-reported.
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-neutral-900">
              Declared preference
            </dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">
              Preferred role, acceptable teammate skill range, communication
              expectation, and language. Asserted by the player, never inferred.
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-neutral-900">
              Availability
            </dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">
              Weekly recurring windows. A squad that cannot find shared hours is
              not a squad, however well its skill vectors align.
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-neutral-900">
              Peer feedback
            </dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">
              Post-match ratings between teammates. This is the supervised
              signal the recommender learns from &mdash; the record of whether a
              grouping the system predicted would work actually did.
            </dd>
          </div>
        </dl>
        <p className="mt-5 text-sm leading-6 text-neutral-700">
          Scoring runs in a separate Python service so that the model can be
          trained and served with the same libraries, and redeployed without
          redeploying the site. When that service is unreachable, the web
          application scores squads itself using a deterministic rule over the
          same data. Every match records which of the two produced it, so the
          learned path and the rule-based path stay comparable.
        </p>
      </section>

      <footer className="mt-16 border-t border-neutral-300 pt-6">
        <p className="text-xs text-neutral-500">
          Academic prototype. Not affiliated with Krafton or BGMI.
        </p>
      </footer>
    </main>
  );
}
