'use client';

import { useState } from 'react';
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
import { fieldClass } from '@/components/ui/input';
import { cn } from '@/lib/cn';

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

  /**
   * This component deliberately does NOT notify the parent when its removal
   * succeeds, though that was the obvious first design. It cannot: a successful
   * removal deletes this row, so the parent re-renders without it and this
   * component unmounts in the same commit that delivered the result. An effect
   * watching for `state.ok` never runs -- the success destroys the thing that
   * would report it. The parent watches the list length instead.
   */

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
        className="rounded-input border border-border px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-danger/50 hover:text-danger"
      >
        Remove
      </button>

      {state && !state.ok ? (
        <span role="alert" className="text-xs text-danger">
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

  /**
   * The add form's banner, dismissed when a window disappears.
   *
   * The two forms hold independent `useFormState`, so without this the add
   * form's last result survives a removal -- "You already have that exact
   * window on that day" stays on screen after the duplicate has just been
   * deleted. It is then not stale but false, and it reads as though the removal
   * failed.
   *
   * The trigger is the list getting SHORTER, which is the only thing a removal
   * can be observed by from here. Watching the list grow instead would dismiss
   * the banner on a successful add and swallow "Window added."; watching it
   * change at all would do both.
   *
   * Storing the dismissed RESULT rather than a boolean is what makes this
   * self-resetting: the next submit produces a new object, `state` stops being
   * the dismissed one, and the banner returns with no flag to clear. A boolean
   * would need un-setting on every new result -- the half that gets forgotten.
   *
   * Adjusting state during render, rather than in an effect, is deliberate and
   * is React's documented pattern for deriving from changed props. An effect
   * would paint the false banner for one frame before removing it. It cannot
   * live in RemoveWindowForm at all -- see the note there.
   */
  const [tracked, setTracked] = useState<{
    count: number;
    dismissed: ActionResult | null;
  }>({ count: availability.length, dismissed: null });

  if (tracked.count !== availability.length) {
    setTracked({
      count: availability.length,
      dismissed:
        availability.length < tracked.count ? state : tracked.dismissed,
    });
  }

  const showBanner = state !== null && state !== tracked.dismissed;

  // Gated on the same flag as the banner: the inline field errors come from
  // that same result, so leaving them behind would keep a red "To" field under
  // a dismissed message.
  const fieldErrors =
    showBanner && state && !state.ok ? state.fieldErrors : undefined;
  const added = showBanner && state?.ok === true;

  const byDay = DAY_NAMES.map((name, day) => ({
    day,
    name,
    windows: availability.filter((window) => window.day_of_week === day),
  }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="add-window-heading" className="space-y-4">
        <h2 id="add-window-heading" className="text-base font-semibold text-fg">
          Add a window
        </h2>

        <form action={formAction} noValidate className="space-y-4">
          {showBanner && state && !state.ok ? (
            <p
              role="alert"
              className="rounded-input border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
            >
              {state.error}
            </p>
          ) : null}

          {added ? (
            <p
              role="status"
              className="rounded-input border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success"
            >
              Window added.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="day_of_week" className="mb-1.5 block text-sm font-medium text-fg">
                Day
              </label>
              <select
                id="day_of_week"
                name="day_of_week"
                defaultValue={1}
                aria-invalid={fieldErrors?.day_of_week ? true : undefined}
                className={cn(fieldClass, 'w-auto')}
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
                className="mb-1.5 block text-sm font-medium text-fg"
              >
                From
              </label>
              <select
                id="start_minute"
                name="start_minute"
                defaultValue={1200}
                aria-invalid={fieldErrors?.start_minute ? true : undefined}
                className={cn(fieldClass, 'w-auto')}
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
              <label htmlFor="end_minute" className="mb-1.5 block text-sm font-medium text-fg">
                To
              </label>
              <select
                id="end_minute"
                name="end_minute"
                defaultValue={1380}
                aria-invalid={fieldErrors?.end_minute ? true : undefined}
                className={cn(fieldClass, 'w-auto')}
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
                className="mb-1.5 block text-sm font-medium text-fg"
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
                className={cn(fieldClass, 'w-auto')}
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

          <p className="text-xs text-muted">
            Times are local to the timezone you pick. A window that crosses
            midnight is added as two windows — one ending at 24:00 and one
            starting at 00:00 the next day.
          </p>

          <SubmitButton label="Add window" />
        </form>
      </section>

      <section aria-labelledby="windows-heading" className="space-y-4">
        <h2 id="windows-heading" className="text-base font-semibold text-fg">
          Your week
        </h2>

        {availability.length === 0 ? (
          <p className="text-sm text-muted">
            No windows yet.
          </p>
        ) : (
          <dl className="space-y-4">
            {byDay
              .filter((group) => group.windows.length > 0)
              .map((group) => (
                <div key={group.name}>
                  <dt className="text-sm font-medium text-fg">{group.name}</dt>
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
