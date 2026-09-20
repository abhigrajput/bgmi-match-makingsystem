'use client';

import { useFormState } from 'react-dom';

import { signup, type AuthFormState } from '../actions';
import { FieldError } from '../field-error';
import { SubmitButton } from '../submit-button';

const initialState: AuthFormState = {};

/**
 * The signup form.
 *
 * `display_name` and `bgmi_ign` are collected here but are not written to
 * profiles by this form -- the client has no INSERT privilege on that table.
 * They are passed into `signUp()` as user metadata, land on the auth.users row
 * as raw_user_meta_data, and are read back out by the handle_new_user() trigger
 * inside the same transaction that creates the account. The field names must
 * match what that trigger reads.
 */
export function SignupForm() {
  const [state, formAction] = useFormState(signup, initialState);

  // The confirmation-email path: the account exists and the profile has been
  // provisioned, but there is no session yet, so there is nothing to redirect
  // to. Replacing the form rather than rendering the notice above it, because
  // resubmitting now would only collide with the account just created.
  if (state.notice) {
    return (
      <p
        role="status"
        className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900"
      >
        {state.notice}
      </p>
    );
  }

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
        <label htmlFor="display_name" className="block text-sm font-medium">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          autoComplete="nickname"
          required
          defaultValue={state.values?.display_name ?? ''}
          aria-describedby={
            state.fieldErrors?.display_name
              ? 'display_name-error'
              : 'display_name-hint'
          }
          aria-invalid={state.fieldErrors?.display_name ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <p id="display_name-hint" className="mt-1 text-xs text-neutral-600">
          Shown to other players. You can change this later.
        </p>
        <FieldError
          id="display_name-error"
          messages={state.fieldErrors?.display_name}
        />
      </div>

      <div>
        <label htmlFor="bgmi_ign" className="block text-sm font-medium">
          BGMI in-game name
        </label>
        <input
          id="bgmi_ign"
          name="bgmi_ign"
          type="text"
          required
          defaultValue={state.values?.bgmi_ign ?? ''}
          aria-describedby={
            state.fieldErrors?.bgmi_ign ? 'bgmi_ign-error' : 'bgmi_ign-hint'
          }
          aria-invalid={state.fieldErrors?.bgmi_ign ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <p id="bgmi_ign-hint" className="mt-1 text-xs text-neutral-600">
          Must match your name in BGMI exactly — it is how your matches are
          linked to this account. Must be unique.
        </p>
        <FieldError id="bgmi_ign-error" messages={state.fieldErrors?.bgmi_ign} />
      </div>

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
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby={
            state.fieldErrors?.password ? 'password-error' : 'password-hint'
          }
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <p id="password-hint" className="mt-1 text-xs text-neutral-600">
          At least 8 characters.
        </p>
        <FieldError id="password-error" messages={state.fieldErrors?.password} />
      </div>

      <SubmitButton label="Create account" />
    </form>
  );
}
