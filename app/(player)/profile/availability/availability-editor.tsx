'use client';

import { useFormState } from 'react-dom';

import { FieldError } from '@/components/form/field-error';
import { SubmitButton } from '@/components/form/submit-button';
import {
  DAY_NAMES,
  DEFAULT_TIMEZONE_OFFSET,
  TIMEZONE_OFFSETS,
  TIME_SLOTS,
  formatMinutes,
} from '@/lib/player/time';
import type { PlayerAvailability } from '@/types/database';

import {
  addAvailabilityWindow,
  removeAvailabilityWindow,
  type ActionResult,
} from '../../actions';

const initialState: ActionResult | null = null;

/**
 * Remove control for one window.
 *
 * Its own component, and its own `useFormState`, because the hook holds one
 * result per form: a single shared state would put the error from removing
 * Tuesday's window under Friday's row. One form per row also keeps this working
 * without JavaScript, where each button is an ordinary POST.
 */
function RemoveWindowForm({ window }: { window: PlayerAvailability }) {
  const [state, formAction] = useFormState(
    removeAvailabilityWindow,
    initialState,
  );

  const label = `${DAY_NAMES[window.day_of_week]} ${formatMinutes(
    window.start_minute,
  )} to ${formatMinutes(window.end_minute)}`;

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="id" value={window.id} />

      <button
        type="submit"
        // The visible text is just "Remove"; the accessible name says which
        // window, because a screen-reader user tabbing a list of seven
        // identical "Remove" buttons has no way to tell them apart.
        aria-label={`Remove ${label}`}
        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
      >
        Remove
      </button>

      {state && !state.ok ? (
        <span role="alert" className="text-xs text-red-700">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * The weekly window editor: one add form, plus a remove control per row.
 *
 * Windows are grouped by day for reading. The grouping is display only -- each
 * row is an independent player_availability row, and 0001 deliberately keeps
 * every row a plain interval so overlap logic never has to unpick a group.
 */
export function AvailabilityEditor({
  availability,
}: {
  availability: PlayerAvailability[];
}) {
  const [state, formAction] = useFormState(addAvailabilityWindow, initialState);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const added = state?.ok === true;

  const byDay = DAY_NAMES.map((name, day) => ({
    day,
    name,
    windows: availability.filter((window) => window.day_of_week === day),
  }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="add-window-heading" className="space-y-4">
        <h2 id="add-window-heading" className="text-base font-semibold">
          Add a window
        </h2>

        <form action={formAction} noValidate className="space-y-4">
          {state && !state.ok ? (
            <p
              role="alert"
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {state.error}
            </p>
          ) : null}

          {added ? (
            <p
              role="status"
              className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800"
            >
              Window added.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="day_of_week" className="block text-sm font-medium">
                Day
              </label>
              <select
                id="day_of_week"
                name="day_of_week"
                defaultValue={1}
                aria-invalid={fieldErrors?.day_of_week ? true : undefined}
                className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                {DAY_NAMES.map((name, day) => (
                  <option key={name} value={day}>
                    {name}
                  </option>
                ))}
              </select>
              <FieldError
                id="day_of_week-error"
                messages={fieldErrors?.day_of_week}
              />
            </div>

            <div>
              <label
                htmlFor="start_minute"
                className="block text-sm font-medium"
              >
                From
              </label>
              <select
                id="start_minute"
                name="start_minute"
                defaultValue={1200}
                aria-invalid={fieldErrors?.start_minute ? true : undefined}
                className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                {TIME_SLOTS.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
              <FieldError
                id="start_minute-error"
                messages={fieldErrors?.start_minute}
              />
            </div>

            <div>
              <label htmlFor="end_minute" className="block text-sm font-medium">
                To
              </label>
              <select
                id="end_minute"
                name="end_minute"
                defaultValue={1380}
                aria-invalid={fieldErrors?.end_minute ? true : undefined}
                className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                {TIME_SLOTS.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
              <FieldError
                id="end_minute-error"
                messages={fieldErrors?.end_minute}
              />
            </div>

            <div>
              <label
                htmlFor="timezone_offset_minutes"
                className="block text-sm font-medium"
              >
                Timezone
              </label>
              <select
                id="timezone_offset_minutes"
                name="timezone_offset_minutes"
                defaultValue={DEFAULT_TIMEZONE_OFFSET}
                aria-invalid={
                  fieldErrors?.timezone_offset_minutes ? true : undefined
                }
                className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                {TIMEZONE_OFFSETS.map((offset) => (
                  <option key={offset.value} value={offset.value}>
                    {offset.label}
                  </option>
                ))}
              </select>
              <FieldError
                id="timezone_offset_minutes-error"
                messages={fieldErrors?.timezone_offset_minutes}
              />
            </div>
          </div>

          <p className="text-xs text-neutral-600">
            Times are local to the timezone you pick. A window that crosses
            midnight is added as two windows — one ending at 24:00 and one
            starting at 00:00 the next day.
          </p>

          <SubmitButton label="Add window" />
        </form>
      </section>

      <section aria-labelledby="windows-heading" className="space-y-4">
        <h2 id="windows-heading" className="text-base font-semibold">
          Your week
        </h2>

        {availability.length === 0 ? (
          <p className="text-sm text-neutral-600">
            No windows yet.
          </p>
        ) : (
          <dl className="space-y-4">
            {byDay
              .filter((group) => group.windows.length > 0)
              .map((group) => (
                <div key={group.name}>
                  <dt className="text-sm font-medium">{group.name}</dt>
                  <dd className="mt-1">
                    <ul className="space-y-1">
                      {group.windows.map((window) => (
                        <li
                          key={window.id}
                          className="flex items-center gap-3 text-sm"
                        >
                          <span className="tabular-nums">
                            {formatMinutes(window.start_minute)}–
                            {formatMinutes(window.end_minute)}
                          </span>
                          <RemoveWindowForm window={window} />
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
          </dl>
        )}
      </section>
    </div>
  );
}
