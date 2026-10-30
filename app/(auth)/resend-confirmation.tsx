'use client';

import { useEffect, useState } from 'react';
import { useFormState } from 'react-dom';

import { resendConfirmation, type AuthFormState } from './actions';
import { SubmitButton } from '@/components/form/submit-button';

const initialState: AuthFormState = {};

/**
 * "Send the email again", with a visible countdown.
 *
 * Shown on the signup notice and when a login fails because the email is not
 * confirmed. Its own form, not a button inside the parent's, because the two
 * submit to different actions.
 */
export function ResendConfirmation({ email }: { email: string }) {
  const [state, formAction] = useFormState(resendConfirmation, initialState);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (state.retryAfter) setSecondsLeft(state.retryAfter);
  }, [state]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  return (
    <form action={formAction} className="mt-4 space-y-2">
      <input type="hidden" name="email" value={email} />
      {state.notice ? (
        <p role="status" className="text-sm text-success">
          {state.notice}
        </p>
      ) : null}
      {state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      {secondsLeft > 0 ? (
        <p className="text-sm text-muted">You can ask again in {secondsLeft} seconds.</p>
      ) : (
        <SubmitButton label="Send the confirmation email again" variant="secondary" />
      )}
    </form>
  );
}
