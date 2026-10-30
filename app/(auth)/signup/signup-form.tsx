'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';

import { signup, type AuthFormState } from '../actions';
import { ResendConfirmation } from '../resend-confirmation';
import { FieldError } from '@/components/form/field-error';
import { SubmitButton } from '@/components/form/submit-button';
import { fieldClass } from '@/components/ui/input';
import { ROLE_LABELS } from '@/lib/roles';
import { SIGNUP_REGIONS } from '@/lib/validation/auth';
import { PLAYER_ROLES } from '@/types/database';

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
      <>
        <p
          role="status"
          className="rounded-input border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success"
        >
          {state.notice}
        </p>
        {state.unconfirmedEmail ? <ResendConfirmation email={state.unconfirmedEmail} /> : null}
      </>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.formError ? (
        <p
          role="alert"
          className="rounded-input border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          {state.formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="display_name" className="mb-1.5 block text-sm font-medium text-fg">
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
          className={fieldClass}
        />
        <p id="display_name-hint" className="mt-1 text-xs text-muted">
          Shown to other players. You can change this later.
        </p>
        <FieldError
          id="display_name-error"
          messages={state.fieldErrors?.display_name}
        />
      </div>

      <div>
        <label htmlFor="bgmi_ign" className="mb-1.5 block text-sm font-medium text-fg">
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
          className={fieldClass}
        />
        <p id="bgmi_ign-hint" className="mt-1 text-xs text-muted">
          Must match your name in BGMI exactly: it is how your matches are
          linked to this account. Must be unique.
        </p>
        <FieldError id="bgmi_ign-error" messages={state.fieldErrors?.bgmi_ign} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="region" className="mb-1.5 block text-sm font-medium text-fg">
            Region
          </label>
          <select
            id="region"
            name="region"
            required
            defaultValue={state.values?.region ?? ''}
            aria-describedby={state.fieldErrors?.region ? 'region-error' : 'region-hint'}
            aria-invalid={state.fieldErrors?.region ? true : undefined}
            className={fieldClass}
          >
            <option value="" disabled>
              Choose a region
            </option>
            {SIGNUP_REGIONS.map((region) => (
              <option key={region} value={region}>
                {region.replace('-', ' ')}
              </option>
            ))}
          </select>
          <p id="region-hint" className="mt-1 text-xs text-muted">
            You are matched with players in the same region.
          </p>
          <FieldError id="region-error" messages={state.fieldErrors?.region} />
        </div>

        <div>
          <label htmlFor="primary_role" className="mb-1.5 block text-sm font-medium text-fg">
            Main role
          </label>
          <select
            id="primary_role"
            name="primary_role"
            required
            defaultValue={state.values?.primary_role ?? ''}
            aria-describedby={
              state.fieldErrors?.primary_role ? 'primary_role-error' : 'primary_role-hint'
            }
            aria-invalid={state.fieldErrors?.primary_role ? true : undefined}
            className={fieldClass}
          >
            <option value="" disabled>
              Choose a role
            </option>
            {PLAYER_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <p id="primary_role-hint" className="mt-1 text-xs text-muted">
            You confirm it with your other preferences after signing up.
          </p>
          <FieldError id="primary_role-error" messages={state.fieldErrors?.primary_role} />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-fg">
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
          className={fieldClass}
        />
        <FieldError id="email-error" messages={state.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-fg">
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
          className={fieldClass}
        />
        <p id="password-hint" className="mt-1 text-xs text-muted">
          At least 10 characters.
        </p>
        <FieldError id="password-error" messages={state.fieldErrors?.password} />
      </div>

      <div>
        <div className="flex items-start gap-2">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            required
            defaultChecked={state.values?.consent === 'on'}
            aria-describedby={state.fieldErrors?.consent ? 'consent-error' : undefined}
            aria-invalid={state.fieldErrors?.consent ? true : undefined}
            className="mt-3.5 h-4 w-4 shrink-0 rounded border-border accent-[rgb(var(--accent))]"
          />
          <label htmlFor="consent" className="min-h-11 py-2.5 text-sm text-muted">
            I am at least 16 and agree to the{' '}
            <Link href="/terms" target="_blank" className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-data hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-data hover:underline">
              Privacy Policy
            </Link>
            .
          </label>
        </div>
        <FieldError id="consent-error" messages={state.fieldErrors?.consent} />
      </div>

      <SubmitButton label="Create account" />
    </form>
  );
}
