'use client';

import { useFormStatus } from 'react-dom';

import { Button, type ButtonVariant } from '@/components/ui/button';

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
export function SubmitButton({
  label,
  variant = 'primary',
  fullWidth = true,
}: {
  label: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      loading={pending}
      className={fullWidth ? 'w-full' : undefined}
    >
      {pending ? 'Working…' : label}
    </Button>
  );
}
