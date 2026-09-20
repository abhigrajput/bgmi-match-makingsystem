import Link from 'next/link';

import type { Completeness } from '@/lib/player/completeness';

/**
 * The profile completeness indicator.
 *
 * A server component: it has no state and no handlers, so it renders inside
 * whichever page includes it without adding anything to the client bundle.
 *
 * Deliberately not a percentage or a progress bar. There are two steps, both
 * required, and "50% complete" invites a reading where the missing half is
 * optional polish. What is actually true is that a player missing either one
 * cannot be matched at all, so the card says that in words and links to the
 * page that fixes it.
 */
export function CompletenessCard({
  completeness,
}: {
  completeness: Completeness;
}) {
  const { steps, readyToMatch, missingCount } = completeness;

  return (
    <section
      aria-labelledby="completeness-heading"
      className={`rounded border p-4 ${
        readyToMatch
          ? 'border-green-300 bg-green-50'
          : 'border-amber-300 bg-amber-50'
      }`}
    >
      <h2 id="completeness-heading" className="text-sm font-semibold">
        {readyToMatch
          ? 'Your profile is ready for matchmaking'
          : `Your profile is missing ${missingCount === 1 ? '1 thing' : `${missingCount} things`}`}
      </h2>

      <p className="mt-1 text-sm text-neutral-700">
        {readyToMatch
          ? 'Preferences and availability are both set. Matchmaking arrives in a later phase.'
          : 'Matchmaking needs both of these. Until they are set, no squad can be built around you.'}
      </p>

      <ul className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.key} className="text-sm">
            <span className="flex items-start gap-2">
              {/*
                aria-hidden on the glyph, with the state repeated as text for
                assistive tech. A check mark alone is announced as "check mark"
                or skipped entirely depending on the reader, and the whole
                content of this row is whether the step is done.
              */}
              <span aria-hidden="true" className="leading-5">
                {step.done ? '✓' : '○'}
              </span>
              <span>
                <span className="sr-only">
                  {step.done ? 'Done: ' : 'Not done: '}
                </span>
                {step.done ? (
                  <span className="text-neutral-700">{step.label}</span>
                ) : (
                  <Link href={step.href} className="font-medium underline">
                    {step.label}
                  </Link>
                )}
                {/* The consequence is shown only when the step is undone --
                    once it is done, it is no longer information. */}
                {step.done ? null : (
                  <span className="mt-0.5 block text-neutral-600">
                    {step.consequence}
                  </span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
