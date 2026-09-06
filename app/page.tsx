/**
 * Landing page.
 *
 * Phase 1: this is the only route. It states the problem and the approach in
 * plain text. It is deliberately not a dashboard, not a marketing page, and it
 * fetches nothing -- there is no database connection in this phase, so any
 * number shown here would be invented.
 */

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="border-b border-neutral-300 pb-6">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          Phase 1 &middot; Architecture and foundation
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-900">
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

      <section className="mt-10">
        <h2 className="text-base font-semibold text-neutral-900">
          Current state
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          This phase covers structure only: the folder boundaries, the
          architecture and database documents, the initial schema migration
          (written, not applied), and the TypeScript types describing it. There
          is no authentication, no database connection, no matchmaking queue,
          and no model. This page is the entire user interface.
        </p>
        <ul className="mt-5 space-y-2 text-sm leading-6 text-neutral-700">
          <li>
            <code className="text-xs text-neutral-900">
              docs/architecture.md
            </code>{' '}
            &mdash; system context, why two runtimes, fallback path
          </li>
          <li>
            <code className="text-xs text-neutral-900">docs/database.md</code>{' '}
            &mdash; ER diagram and table-by-table rationale
          </li>
          <li>
            <code className="text-xs text-neutral-900">
              supabase/migrations/0001_init.sql
            </code>{' '}
            &mdash; eight tables, unapplied
          </li>
        </ul>
      </section>

      <footer className="mt-16 border-t border-neutral-300 pt-6">
        <p className="text-xs text-neutral-500">
          Academic prototype. Not affiliated with Krafton or BGMI.
        </p>
      </footer>
    </main>
  );
}
