/**
 * Selection-day unlock gate — the donor-portal order PDF unlocks at 4:00 AM
 * America/Chicago on the day they were randomly selected. Staff can stage
 * the PDF the day before; the donor can't see any of its contents until
 * 4 AM CT the morning of. This preserves the blind-random property of the
 * selection (no previewing tomorrow's collection site tonight).
 *
 * We roll our own tz math instead of pulling in a tz lib: we only ever
 * need one zone and two operations, Intl.DateTimeFormat handles DST.
 */

const CHICAGO_TZ = "America/Chicago";

/**
 * UTC offset (in ms) of America/Chicago at the given instant. Negative,
 * e.g. -5h during CDT, -6h during CST. Handles DST transitions.
 */
function chicagoOffsetMs(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  const hour = p.hour === "24" ? "0" : p.hour;
  const chicagoAsIfUtc = Date.UTC(
    parseInt(p.year, 10),
    parseInt(p.month, 10) - 1,
    parseInt(p.day, 10),
    parseInt(hour, 10),
    parseInt(p.minute, 10),
    parseInt(p.second, 10)
  );
  return chicagoAsIfUtc - utcMs;
}

/**
 * The UTC instant corresponding to 4:00:00 AM America/Chicago on the
 * calendar day encoded by `selectedDate` (interpreted via its UTC year/
 * month/day — matches how the rest of the codebase stores selectedDate
 * as midnight UTC of the intended calendar day).
 *
 * Converges in two passes across DST transitions.
 */
export function unlockInstantForSelection(selectedDate: Date): Date {
  const y = selectedDate.getUTCFullYear();
  const m = selectedDate.getUTCMonth();
  const d = selectedDate.getUTCDate();
  const target = Date.UTC(y, m, d, 4, 0, 0);

  let guess = target;
  for (let i = 0; i < 2; i++) {
    const offset = chicagoOffsetMs(guess);
    guess = target - offset;
  }
  return new Date(guess);
}

/**
 * Has the 4 AM Chicago unlock for the given selectedDate passed? Accepts
 * an injected `now` for unit testing.
 */
export function isUnlockedForSelection(selectedDate: Date, now: Date = new Date()): boolean {
  return now.getTime() >= unlockInstantForSelection(selectedDate).getTime();
}

/**
 * UTC-midnight Date corresponding to today's America/Chicago calendar day.
 * Matches the convention `selectedDate` is stored under ("UTC midnight of
 * the intended Chicago calendar day"), so a range query `gte today()` /
 * `lt tomorrow()` selects rows for the donor's local "today" rather than
 * the UTC "today" — which rolls over ~7 PM CT and would otherwise skip
 * the current day's selection during Chicago evening hours.
 */
export function chicagoTodayAsUtcMidnight(now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  return new Date(
    Date.UTC(parseInt(p.year, 10), parseInt(p.month, 10) - 1, parseInt(p.day, 10))
  );
}
