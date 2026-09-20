'use client';

import { useFormState } from 'react-dom';

import { FieldError } from '@/components/form/field-error';
import { SubmitButton } from '@/components/form/submit-button';
import {
  COMM_PREFERENCES,
  PLAYER_ROLES,
  type CommPreference,
  type PlayerPreferences,
  type PlayerRole,
} from '@/types/database';

import { upsertPreferences, type ActionResult } from '../actions';

const initialState: ActionResult | null = null;

/**
 * Labels for the two enums.
 *
 * Keyed by the enum value, and typed as a total Record, so adding a value to
 * `player_role` in a migration -- and therefore to PLAYER_ROLES -- is a type
 * error here until it is labelled. The alternative, a lookup with a fallback to
 * the raw value, would ship `voice_required` to a player as-is and nobody would
 * notice for a release.
 */
const ROLE_LABELS: Record<PlayerRole, string> = {
  igl: 'IGL — in-game leader, shotcalling and rotations',
  assaulter: 'Assaulter — entry fragger',
  sniper: 'Sniper — long range and DMR',
  support: 'Support — utility, revives, resupply',
  flex: 'Flex — fills whichever slot the squad lacks',
};

const COMM_LABELS: Record<CommPreference, string> = {
  voice_required: 'Voice required',
  voice_optional: 'Voice optional',
  text_only: 'Text only',
  silent: 'Silent — no comms',
};

/**
 * The preferences form.
 *
 * `preferences` is null for a player who has never saved: handle_new_user()
 * provisions a profile row and nothing else. The defaults below are then the
 * column defaults from 0001 rather than empty inputs, so the form shows what
 * the database would store if saved untouched -- which is what the player is
 * actually agreeing to when they press save.
 */
export function PreferencesForm({
  preferences,
}: {
  preferences: PlayerPreferences | null;
}) {
  const [state, formAction] = useFormState(upsertPreferences, initialState);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const saved = state?.ok === true;

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}

      {saved ? (
        <p
          role="status"
          className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          Preferences saved.
        </p>
      ) : null}

      <div>
        <label htmlFor="primary_role" className="block text-sm font-medium">
          Primary role
        </label>
        <select
          id="primary_role"
          name="primary_role"
          defaultValue={preferences?.primary_role ?? 'flex'}
          aria-describedby={
            fieldErrors?.primary_role ? 'primary_role-error' : undefined
          }
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          {PLAYER_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <FieldError
          id="primary_role-error"
          messages={fieldErrors?.primary_role}
        />
      </div>

      <div>
        <label htmlFor="secondary_role" className="block text-sm font-medium">
          Secondary role <span className="text-neutral-500">(optional)</span>
        </label>
        <select
          id="secondary_role"
          name="secondary_role"
          defaultValue={preferences?.secondary_role ?? ''}
          aria-describedby="secondary_role-hint secondary_role-error"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          {/*
            The empty option posts "", which the schema maps to NULL. It is
            labelled "None" rather than "Flex" on purpose: 0001 is explicit that
            NULL means "no second role" and 'flex' is a distinct competence, so
            offering flex as the empty-looking default would file a declaration
            the player never made.
          */}
          <option value="">None</option>
          {PLAYER_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <p id="secondary_role-hint" className="mt-1 text-xs text-neutral-600">
          Must differ from your primary role.
        </p>
        <FieldError
          id="secondary_role-error"
          messages={fieldErrors?.secondary_role}
        />
      </div>

      <div>
        <label htmlFor="comm_preference" className="block text-sm font-medium">
          Communication
        </label>
        <select
          id="comm_preference"
          name="comm_preference"
          defaultValue={preferences?.comm_preference ?? 'voice_optional'}
          aria-describedby="comm_preference-hint comm_preference-error"
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          {COMM_PREFERENCES.map((option) => (
            <option key={option} value={option}>
              {COMM_LABELS[option]}
            </option>
          ))}
        </select>
        <p id="comm_preference-hint" className="mt-1 text-xs text-neutral-600">
          A hard filter, not a preference score — you will not be grouped with
          players whose comms requirement conflicts with yours.
        </p>
        <FieldError
          id="comm_preference-error"
          messages={fieldErrors?.comm_preference}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Teammate skill band</legend>
        <p className="mt-1 text-xs text-neutral-600">
          The 0–100 rating range you will accept in teammates. Leave it wide
          unless you have a reason to narrow it — a narrow band means longer
          waits, and an inverted one means no match is possible.
        </p>

        <div className="mt-2 flex gap-4">
          <div className="flex-1">
            <label
              htmlFor="min_teammate_skill"
              className="block text-sm text-neutral-700"
            >
              Minimum
            </label>
            <input
              id="min_teammate_skill"
              name="min_teammate_skill"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={preferences?.min_teammate_skill ?? 0}
              aria-invalid={fieldErrors?.min_teammate_skill ? true : undefined}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <FieldError
              id="min_teammate_skill-error"
              messages={fieldErrors?.min_teammate_skill}
            />
          </div>

          <div className="flex-1">
            <label
              htmlFor="max_teammate_skill"
              className="block text-sm text-neutral-700"
            >
              Maximum
            </label>
            <input
              id="max_teammate_skill"
              name="max_teammate_skill"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={preferences?.max_teammate_skill ?? 100}
              aria-invalid={fieldErrors?.max_teammate_skill ? true : undefined}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <FieldError
              id="max_teammate_skill-error"
              messages={fieldErrors?.max_teammate_skill}
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor="languages" className="block text-sm font-medium">
          Languages
        </label>
        <input
          id="languages"
          name="languages"
          type="text"
          defaultValue={(preferences?.languages ?? ['en']).join(', ')}
          aria-describedby="languages-hint languages-error"
          aria-invalid={fieldErrors?.languages ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <p id="languages-hint" className="mt-1 text-xs text-neutral-600">
          Comma separated, e.g. “en, hi”. Duplicates and blanks are dropped.
        </p>
        <FieldError id="languages-error" messages={fieldErrors?.languages} />
      </div>

      <div>
        <label htmlFor="max_ping_ms" className="block text-sm font-medium">
          Maximum ping <span className="text-neutral-500">(optional)</span>
        </label>
        <input
          id="max_ping_ms"
          name="max_ping_ms"
          type="number"
          min={1}
          max={1000}
          step={1}
          defaultValue={preferences?.max_ping_ms ?? ''}
          aria-describedby="max_ping_ms-hint max_ping_ms-error"
          aria-invalid={fieldErrors?.max_ping_ms ? true : undefined}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <p id="max_ping_ms-hint" className="mt-1 text-xs text-neutral-600">
          Milliseconds. Leave blank for no limit — 0 is not “no limit”, it is a
          limit nothing can meet.
        </p>
        <FieldError id="max_ping_ms-error" messages={fieldErrors?.max_ping_ms} />
      </div>

      <div className="flex items-center gap-2">
        {/*
          An unchecked checkbox is absent from FormData entirely rather than
          posting "false" -- the action reads presence, not a value.
        */}
        <input
          id="wants_ranked"
          name="wants_ranked"
          type="checkbox"
          defaultChecked={preferences?.wants_ranked ?? false}
          className="h-4 w-4 rounded border-neutral-300"
        />
        <label htmlFor="wants_ranked" className="text-sm">
          I want ranked matches
        </label>
      </div>

      <SubmitButton label="Save preferences" />
    </form>
  );
}
