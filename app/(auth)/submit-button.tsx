'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button that disables itself while its form is in flight.
 *
 * Split into its own component because `useFormStatus` reads the status of the
 * nearest enclosing form from context -- it returns `pending: false` forever if
 * called in the same component that renders the <form>. It has to be a child.
 *
 * The disabling is not cosmetic. Signup is not idempotent: a double-click
 * submits twice, and the second attempt collides with the first on either the
 * email or the bgmi_ign UNIQUE constraint, so the user is told their own
 * in-game name is taken.
 */
export function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
    >
      {pending ? 'Working…' : label}
    </button>
  );
}
