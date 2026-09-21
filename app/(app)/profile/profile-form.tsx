'use client';

import { useFormState } from 'react-dom';

import { FieldError } from '@/components/form/field-error';
import { SubmitButton } from '@/components/form/submit-button';
import type { Profile } from '@/types/database';
import { fieldClass } from '@/components/ui/input';

import { updateProfile, type ActionResult } from '../actions';

const initialState: ActionResult | null = null;

/**
 * Edit form for the five profile columns a client may write.
 *
 * A client component only because `useFormState` requires one. The submission
 * is a Server Action: no fetch, no client-side copy of the profile, and the
 * form still works with JavaScript disabled as a full-page post.
 *
 * `defaultValue` from the row, not `value` -- these are uncontrolled inputs.
 * Controlled ones would need state for all five fields and a reset when the
 * server row changes, and would buy nothing: nothing here reacts to a keystroke.
 *
 * `noValidate` for the same reason as the auth forms: without it the browser
 * rejects the URL field first, in its own styling, before the zod message that
 * actually explains the rule can be produced.
 */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, formAction] = useFormState(updateProfile, initialState);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const saved = state?.ok === true;

  return (
    <form action={formAction} noValidate className="space-y-4">
      {/*
        Both banners are live regions, so the outcome is announced rather than
        only rendered -- on a successful save nothing else on the page visibly
        changes, and a sighted user's confirmation is this line.
      */}
      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-input border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {saved ? (
        <p
          role="status"
          className="rounded-input border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success"
        >
          Profile saved.
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
          required
          defaultValue={profile.display_name}
          aria-describedby={
            fieldErrors?.display_name ? 'display_name-error' : undefined
          }
          aria-invalid={fieldErrors?.display_name ? true : undefined}
          className={fieldClass}
        />
        <FieldError
          id="display_name-error"
          messages={fieldErrors?.display_name}
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
          defaultValue={profile.bgmi_ign}
          aria-describedby="bgmi_ign-hint bgmi_ign-error"
          aria-invalid={fieldErrors?.bgmi_ign ? true : undefined}
          className={fieldClass}
        />
        <p id="bgmi_ign-hint" className="mt-1 text-xs text-muted">
          Must be unique, and must match your name in BGMI — it is how match
          records are matched back to you.
        </p>
        <FieldError id="bgmi_ign-error" messages={fieldErrors?.bgmi_ign} />
      </div>

      <div>
        <label htmlFor="region" className="mb-1.5 block text-sm font-medium text-fg">
          Region <span className="text-muted">(optional)</span>
        </label>
        <input
          id="region"
          name="region"
          type="text"
          defaultValue={profile.region ?? ''}
          aria-describedby="region-hint region-error"
          aria-invalid={fieldErrors?.region ? true : undefined}
          className={fieldClass}
        />
        <p id="region-hint" className="mt-1 text-xs text-muted">
          Free text, e.g. “Asia” or “India”. Used as a hard filter before
          matching, so spelling it the same way as your squadmates matters.
        </p>
        <FieldError id="region-error" messages={fieldErrors?.region} />
      </div>

      <div>
        <label htmlFor="avatar_url" className="mb-1.5 block text-sm font-medium text-fg">
          Avatar URL <span className="text-muted">(optional)</span>
        </label>
        <input
          id="avatar_url"
          name="avatar_url"
          type="url"
          defaultValue={profile.avatar_url ?? ''}
          aria-describedby={
            fieldErrors?.avatar_url ? 'avatar_url-error' : undefined
          }
          aria-invalid={fieldErrors?.avatar_url ? true : undefined}
          className={fieldClass}
        />
        <FieldError id="avatar_url-error" messages={fieldErrors?.avatar_url} />
      </div>

      <div>
        <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-fg">
          Bio <span className="text-muted">(optional)</span>
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={500}
          defaultValue={profile.bio ?? ''}
          aria-describedby={fieldErrors?.bio ? 'bio-error' : undefined}
          aria-invalid={fieldErrors?.bio ? true : undefined}
          className={fieldClass}
        />
        <FieldError id="bio-error" messages={fieldErrors?.bio} />
      </div>

      <SubmitButton label="Save profile" />
    </form>
  );
}
