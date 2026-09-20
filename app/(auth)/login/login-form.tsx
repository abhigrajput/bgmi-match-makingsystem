'use client';

import { useFormState } from 'react-dom';

import { login, type AuthFormState } from '../actions';
import { FieldError } from '../field-error';
import { SubmitButton } from '../submit-button';

const initialState: AuthFormState = {};

/**
 * The login form.
 *
 * A client component only because `useFormState` needs to be one. The
 * submission itself is a Server Action -- there is no fetch here, no client
 * state holding the password, and the form works with JavaScript disabled,
 * falling back to a full-page post.
 *
 * `noValidate` turns off the browser's own email-format checking. Otherwise the
 * browser rejects the field before the action runs, and the user sees a native
 * tooltip in one style while every other error appears in ours. The zod schema
 * is the single source of what counts as valid.
 */
export function LoginForm() {
  const [state, formAction] = useFormState(login, initialState);

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.formError ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email ?? ''}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <FieldError id="email-error" messages={state.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        {/*
          No defaultValue: the action never echoes the password back, so there
          is nothing to restore. Re-rendering it would put the plaintext into
          the HTML response.
        */}
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={
            state.fieldErrors?.password ? 'password-error' : undefined
          }
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <FieldError id="password-error" messages={state.fieldErrors?.password} />
      </div>

      <SubmitButton label="Sign in" />
    </form>
  );
}
