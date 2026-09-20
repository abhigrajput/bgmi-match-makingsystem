/**
 * The vocabulary for rendering and entering weekly availability windows.
 *
 * player_availability stores minutes from local midnight, 0-1440, and a
 * separate UTC offset. Nothing here converts between the two or computes
 * overlap -- that is the matcher's job in a later phase. This is presentation
 * and form options only.
 */

/**
 * Index is the stored `day_of_week`. 0 = Sunday, matching both JS `getDay()`
 * and Postgres `extract(dow)`, which is why 0001 chose that encoding: no
 * translation is needed on either side of the wire, so this array can be
 * indexed directly by the column value.
 */
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Renders a stored minute count as a 24-hour clock time.
 *
 * 1440 is deliberately rendered as "24:00" rather than "00:00". It is the
 * permitted end-of-day value, and showing it as 00:00 would make a window
 * reading "20:00 - 00:00" look like it ends four hours before it starts --
 * which is precisely the midnight-crossing case the schema does not allow, so
 * the display would be describing an impossible row.
 */
export function formatMinutes(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Half-hour slots from 00:00 to 24:00 inclusive, for the start/end selects.
 *
 * A `<select>` of minute values rather than `<input type="time">`, for two
 * reasons. A time input posts "HH:MM", which would need converting to minutes
 * somewhere -- and the only honest place is the action, which would then accept
 * a format the column does not use. And a time input cannot express 24:00 at
 * all (its maximum is 23:59), so "available until midnight" would be
 * unrepresentable in the UI while being perfectly legal in the database.
 *
 * Half-hour granularity is a UI choice, not a constraint: the column accepts
 * any minute, and a row written by another client at 20:15 renders fine.
 */
export const TIME_SLOTS: readonly { value: number; label: string }[] =
  Array.from({ length: 49 }, (_, index) => {
    const value = index * 30;
    return { value, label: formatMinutes(value) };
  });

/**
 * Offsets for the timezone select, in the Postgres sign convention: minutes to
 * ADD to UTC, so IST is +330.
 *
 * This is the opposite of JavaScript's `getTimezoneOffset()`, which returns
 * -330 for the same zone. Offering a labelled select instead of a number input
 * is the point: getting the sign backwards produces an in-range value, a window
 * that lands hours away from where the player meant, and no error anywhere.
 *
 * Whole hours across the legal -720..+840 range, plus the half- and
 * quarter-hour zones that real players are in. Sorted, so the list reads from
 * UTC-12 upward.
 */
export const TIMEZONE_OFFSETS: readonly { value: number; label: string }[] =
  (() => {
    const wholeHours = Array.from({ length: 27 }, (_, i) => (i - 12) * 60);
    // 05:30 India/Sri Lanka, 05:45 Nepal, 09:30 central Australia,
    // 10:30 Lord Howe, 12:45 Chatham.
    const partialHours = [330, 345, 570, 630, 765];

    return [...new Set([...wholeHours, ...partialHours])]
      .sort((a, b) => a - b)
      .map((value) => {
        const sign = value < 0 ? '-' : '+';
        const absolute = Math.abs(value);
        const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
        const minutes = String(absolute % 60).padStart(2, '0');
        return { value, label: `UTC${sign}${hours}:${minutes}` };
      });
  })();

/** IST. The default selection -- most of this project's players are in it. */
export const DEFAULT_TIMEZONE_OFFSET = 330;
