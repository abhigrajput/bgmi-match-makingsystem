/**
 * Landing page.
 *
 * States what the product does, shows live counts when they can be read, and
 * keeps the problem/approach write-up underneath. The only per-visitor thing it
 * reads is whether a session exists, so a signed-in visitor gets one way
 * forward instead of two forms that would just redirect them.
 */

import Link from 'next/link';
import {
  BarChart3,
  Brain,
  CalendarClock,
  Crosshair,
  Lock,
  MessageSquareQuote,
  Sparkles,
  Swords,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';

import { ButtonLink } from '@/components/ui/button';
import { loadPublicStats } from '@/lib/public-stats';
import { APP_NAME } from '@/lib/site';
import { createClient } from '@/lib/supabase/server';

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

const STEPS = [
  {
    icon: UserPlus,
    title: 'Build your player card',
    body: 'Role, comms style, languages, the skill band you want in teammates, and when you play each week.',
  },
  {
    icon: Swords,
    title: 'Register for a tournament',
    body: 'Pick an open tournament and, optionally, the role you want to play in it.',
  },
  {
    icon: Brain,
    title: 'Squads are formed',
    body: 'Hard rules veto bad pairs; a scoring engine plus a trained model rank the rest and a greedy optimiser builds squads.',
  },
  {
    icon: MessageSquareQuote,
    title: 'Play, then rate',
    body: 'Rate each teammate after the match. That feedback is the label the model learns from.',
  },
];

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Explainable squads',
    body: 'Every squad ships with the reasons it was formed and its weakest pairing, not just a score.',
  },
  {
    icon: Brain,
    title: 'Learned + rule-based scoring',
    body: 'A logistic-regression model blended with a transparent rule engine. Vetoes always win.',
  },
  {
    icon: BarChart3,
    title: 'Optimiser vs rank-only',
    body: 'Each tournament shows side by side how the optimiser compares with sorting by rating.',
  },
  {
    icon: CalendarClock,
    title: 'Timezone-aware overlap',
    body: 'Weekly windows are normalised to UTC before overlap is scored, midnight and week wrap included.',
  },
  {
    icon: Trophy,
    title: 'Leaderboard & analytics',
    body: 'Ratings, role mix, feedback distribution and the active model’s metrics, all from live data.',
  },
  {
    icon: Lock,
    title: 'Private by default',
    body: 'Preferences and schedules are readable only by their owner, enforced by row-level security.',
  },
];

const TEAM = ['Abhishek GR', 'Shivakumar SH', 'Aishwarya YH', 'Aniketana SD'];

export default async function HomePage() {
  const [signedIn, stats] = await Promise.all([isSignedIn(), loadPublicStats()]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-input bg-accent text-accent-fg">
            <Crosshair aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-fg">{APP_NAME}</span>
        </Link>
        <nav aria-label="Account" className="flex gap-2">
          {signedIn ? (
            <ButtonLink href="/dashboard" size="sm">
              Go to dashboard
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Sign up
              </ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[56rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgb(var(--accent)/0.14),transparent_65%)]"
          />
          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 md:px-8 md:pt-20">
            <p className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              <Swords aria-hidden="true" className="h-3.5 w-3.5" />
              Tournament squad matchmaking for BGMI
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-fg md:text-6xl">
              Squads built on <span className="text-accent">fit</span>, not queue order.
            </h1>
            <p className="mt-5 max-w-2xl text-base text-muted md:text-lg">
              {APP_NAME} forms tournament squads from skill, role coverage,
              comms, language and shared hours, and tells you why each squad
              was put together.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {signedIn ? (
                <ButtonLink href="/dashboard" size="lg">
                  Go to dashboard
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink href="/signup" size="lg">
                    Create your player card
                  </ButtonLink>
                  <ButtonLink href="/login" variant="secondary" size="lg">
                    Log in
                  </ButtonLink>
                </>
              )}
            </div>

            {/*
              Hidden entirely when the counts cannot be read. Printing zeros on
              a failed query would state something false about the product.
            */}
            {stats ? (
              <dl className="mt-12 grid max-w-2xl grid-cols-3 divide-x divide-border rounded-card border border-border bg-surface">
                {[
                  { label: 'Players', value: stats.players, icon: Users },
                  { label: 'Tournaments', value: stats.tournaments, icon: Trophy },
                  { label: 'Squads formed', value: stats.squads_formed, icon: Swords },
                ].map((item) => (
                  <div key={item.label} className="px-4 py-4 md:px-6">
                    <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                      <item.icon aria-hidden="true" className="h-3.5 w-3.5" />
                      {item.label}
                    </dt>
                    <dd className="mt-1 font-mono text-2xl font-semibold tabular text-fg md:text-3xl">
                      {item.value.toLocaleString('en-IN')}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="how-heading" className="border-t border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
            <h2 id="how-heading" className="text-2xl font-semibold tracking-tight text-fg">
              How it works
            </h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-card border border-border bg-surface p-5">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-accent">0{index + 1}</span>
                    <step.icon aria-hidden="true" className="h-5 w-5 text-data" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-fg">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
            <h2 id="features-heading" className="text-2xl font-semibold tracking-tight text-fg">
              What’s inside
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-card border border-border bg-surface p-5 transition-colors duration-150 hover:border-border-strong"
                >
                  <feature.icon aria-hidden="true" className="h-5 w-5 text-accent" />
                  <h3 className="mt-3 text-sm font-semibold text-fg">{feature.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="problem-heading" className="border-t border-border bg-surface/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:px-8">
            <div>
              <h2 id="problem-heading" className="text-xl font-semibold text-fg">
                The problem
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Matchmaking in squad-based battle royale games generally groups
                players by whoever is waiting at the same time, optionally
                filtered by a single skill rating. A squad assembled that way can
                be four players of identical rank who all want to play the same
                role, who cannot agree on when to play, and who do not speak the
                same language. The rating matched; nothing else did.
              </p>
              <p className="mt-3 text-sm leading-6 text-muted">
                Skill is not one number, and a team is not the sum of four
                individual numbers. A squad needs someone calling rotations,
                someone entering fights first, and someone holding angles. It
                needs overlapping hours and a shared idea of whether voice chat
                is expected.
              </p>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-fg">The approach</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Model a player as a vector rather than a rating, and score a
                proposed squad on how well those vectors complement one another.
                Four inputs, kept separate because they change at different
                rates and come from different sources:
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ['Measured skill', 'Aim, game sense, teamwork, clutch and consistency. Computed, not self-reported.'],
                  ['Declared preference', 'Role, teammate skill band, comms and language. Asserted by the player, never inferred.'],
                  ['Availability', 'Weekly recurring windows. A squad that cannot find shared hours is not a squad.'],
                  ['Peer feedback', 'Post-match ratings between teammates: the supervised signal the model learns from.'],
                ].map(([term, detail]) => (
                  <div key={term}>
                    <dt className="font-medium text-fg">{term}</dt>
                    <dd className="mt-0.5 text-muted">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm md:flex-row md:justify-between md:px-8">
          <div>
            <p className="font-medium text-fg">Team</p>
            <p className="mt-1 text-muted">{TEAM.join(' · ')}</p>
            <p className="mt-1 text-muted">Guide: Dr. Vishwanath K</p>
            <p className="mt-1 text-muted">KLE Institute of Technology, Hubballi</p>
          </div>
          <p className="self-end text-xs text-muted">
            Academic prototype. Not affiliated with Krafton or BGMI.
          </p>
        </div>
      </footer>
    </div>
  );
}
