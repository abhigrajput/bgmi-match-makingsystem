import Link from 'next/link';
import { CheckCircle2, Circle } from 'lucide-react';

import { cn } from '@/lib/cn';
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
      className={cn(
        'rounded-card border p-5',
        readyToMatch
          ? 'border-success/40 bg-success/5'
          : 'border-warning/40 bg-warning/5',
      )}
    >
      <h2
        id="completeness-heading"
        className={cn(
          'text-sm font-semibold',
          readyToMatch ? 'text-success' : 'text-warning',
        )}
      >
        {readyToMatch
          ? 'Your profile is ready for matchmaking'
          : `Your profile is missing ${missingCount === 1 ? '1 thing' : `${missingCount} things`}`}
      </h2>

      <p className="mt-1 text-sm text-muted">
        {readyToMatch
          ? 'Preferences and availability are both set, so you can register for tournaments and be placed in a squad.'
          : 'Squad formation needs both of these. Until they are set, you cannot register for a tournament.'}
      </p>

      <ul className="mt-4 space-y-2.5">
        {steps.map((step) => (
          <li key={step.key} className="text-sm">
            <span className="flex items-start gap-2.5">
              {/*
                aria-hidden on the icon, with the state repeated as text for
                assistive tech. An icon alone is announced as nothing at all,
                and the whole content of this row is whether the step is done.
              */}
              {step.done ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              )}
              <span>
                <span className="sr-only">
                  {step.done ? 'Done: ' : 'Not done: '}
                </span>
                {step.done ? (
                  <span className="text-muted">{step.label}</span>
                ) : (
                  <Link href={step.href} className="font-medium text-fg underline decoration-warning/60 underline-offset-4 hover:decoration-warning">
                    {step.label}
                  </Link>
                )}
                {/* The consequence is shown only when the step is undone --
                    once it is done, it is no longer information. */}
                {step.done ? null : (
                  <span className="mt-0.5 block text-muted">
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
