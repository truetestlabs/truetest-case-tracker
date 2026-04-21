/**
 * Chicago-timezone date helpers. All Vercel/Node servers run UTC; every
 * donor/client-facing surface should render in America/Chicago. The
 * helpers here split into two categories — they are NOT interchangeable:
 *
 *   1. Instant formatters — for real UTC timestamps like `appointmentDate`,
 *      `collectionDate`, `createdAt`. These apply
 *      `timeZone: "America/Chicago"` so a 3:30 PM CT appointment renders
 *      as "3:30 PM CT", not "8:30 PM UTC". Helpers:
 *      `formatChicagoLongDate`, `formatChicagoShortDate`,
 *      `formatChicagoTime`.
 *
 *   2. Date-key formatters — for UTC-midnight markers of a Chicago
 *      calendar day (`RandomSelection.selectedDate`,
 *      `MonitoringSchedule.endDate`, `<input type="date">` values).
 *      These read the stored UTC Y/M/D directly (via ISO slice or
 *      `timeZone: "UTC"`) because the stored UTC Y/M/D *is* the
 *      intended Chicago day. Helpers: `chicagoDateKey`,
 *      `formatChicagoLongDateKey`, `formatChicagoShortDateKey`.
 *
 * Mixing these up will cause dates to display off by one day.
 * Passing a date-key through an instant formatter subtracts 5-6h and
 * renders the prior Chicago day; passing a real instant through a
 * date-key formatter renders the UTC clock reading as the calendar
 * day (wrong after ~7 PM CT, once UTC has rolled to the next day).
 *
 * We roll our own tz math instead of pulling in a tz lib: we only
 * ever need one zone and a handful of operations, and
 * `Intl.DateTimeFormat` handles DST. See `unlockInstantForSelection`
 * for the 4 AM CT selection-day unlock gate.
 */

const CHICAGO_TZ = "America/Chicago";

const MORNING_UNLOCK_HOUR_CT = 4;
const EVENING_CUTOFF_HOUR_CT = 22;

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

/**
 * "YYYY-MM-DD" for the America/Chicago calendar day containing the given
 * instant. Use for bucketing timestamped rows (check-ins, audits) by the
 * donor's local day rather than by UTC day.
 */
export function chicagoDateKey(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * Long-form human-readable date for a UTC-midnight date-key — e.g.
 * `"Tuesday, May 20, 2026"`. Use for fields stored as UTC midnight of
 * a Chicago calendar day: `RandomSelection.selectedDate`,
 * `MonitoringSchedule.endDate`, replacement dates derived from
 * `nextWeekday(selectedDate, ...)`, and anything else built from a
 * `<input type="date">` value.
 *
 * **Do NOT pass a real UTC instant to this** (`appointmentDate`,
 * `collectionDate`, `createdAt`, etc.). For those, use
 * `formatChicagoLongDate` — it applies the Chicago offset. Passing a
 * real instant here would render the raw UTC clock reading as the
 * calendar day, which shifts to the next day after ~7 PM CT.
 *
 * Implementation note: we use `timeZone: "UTC"` because the stored
 * value is `YYYY-MM-DDT00:00:00Z` and we want exactly that Y/M/D on
 * the label. Using `America/Chicago` would subtract 5-6 hours from
 * midnight UTC and render the prior day.
 */
export function formatChicagoLongDateKey(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Compact human-readable date for a UTC-midnight date-key — e.g.
 * `"May 20, 2026"`. Same input contract as `formatChicagoLongDateKey`
 * (date-keys only, never real instants); drop the weekday for inline
 * list views or short sentences embedded in paragraphs.
 *
 * Same `timeZone: "UTC"` rationale as `formatChicagoLongDateKey` — see
 * that helper and the file header for the instant-vs-date-key split.
 * For real timestamps, use `formatChicagoShortDate`.
 */
export function formatChicagoShortDateKey(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Human-readable America/Chicago date for a stored UTC instant —
 * e.g. "Tuesday, April 21, 2026". Use for donor/client-facing emails
 * and SMS where the row holds a real timestamp (appointmentDate,
 * collectionDate). Do NOT use for date-key rows like `selectedDate`,
 * which are already UTC-midnight markers of a Chicago day — see
 * `chicagoDateKey` or `iso.slice(0,10)` for those.
 */
export function formatChicagoLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: CHICAGO_TZ,
  });
}

/**
 * America/Chicago clock time for a stored UTC instant, suffixed " CT"
 * — e.g. "3:30 PM CT". Same caveat as `formatChicagoLongDate`: only for
 * rows that hold a real instant, never for date-key rows.
 */
export function formatChicagoTime(d: Date): string {
  const t = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CHICAGO_TZ,
  });
  return `${t} CT`;
}

/**
 * Compact America/Chicago date for a stored UTC instant —
 * e.g. "Apr 20, 2026". For inline list views (document cards, test
 * rows) where the long weekday form is too verbose. Same caveats as
 * `formatChicagoLongDate`.
 */
export function formatChicagoShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: CHICAGO_TZ,
  });
}

/**
 * "Today" in America/Chicago, represented as noon UTC of that calendar
 * day — e.g. `2026-04-20T12:00:00Z` on April 20 CT. Use as a safe
 * fallback when a date needs to be saved without a real timestamp
 * (e.g. CoC upload where the printed date couldn't be parsed). Noon
 * UTC renders as the same calendar day in every continental-US tz,
 * which avoids the "date shifted a day" bug that `new Date()` hits
 * during the 7 PM CT → midnight UTC window.
 */
export function chicagoTodayAtUtcNoon(now: Date = new Date()): Date {
  return new Date(`${chicagoDateKey(now)}T12:00:00Z`);
}

/**
 * Given a UTC-midnight marker of a Chicago calendar day (the same
 * representation `selectedDate` uses), return the actual UTC instant
 * corresponding to 00:00:00 America/Chicago on that day. Use for
 * timestamp range queries (e.g. `checkedInAt`) that need to span the
 * donor's real local day.
 *
 * Converges in two passes across DST transitions — same approach as
 * `unlockInstantForSelection`.
 */
export function utcInstantForChicagoDayStart(utcMidnight: Date): Date {
  const y = utcMidnight.getUTCFullYear();
  const m = utcMidnight.getUTCMonth();
  const d = utcMidnight.getUTCDate();
  const target = Date.UTC(y, m, d, 0, 0, 0);

  let guess = target;
  for (let i = 0; i < 2; i++) {
    const offset = chicagoOffsetMs(guess);
    guess = target - offset;
  }
  return new Date(guess);
}

/** Wall-clock hour 0-23 in Chicago for the given instant. */
function chicagoHour(instant: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    hour: "2-digit",
    hour12: false,
  });
  const raw = fmt.formatToParts(instant).find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(raw === "24" ? "0" : raw, 10);
}

/** 0=Sun, 1=Mon, ..., 6=Sat — weekday in Chicago for the given instant. */
function chicagoWeekday(instant: Date): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    weekday: "short",
  }).format(instant);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

/** Full weekday name in Chicago, e.g. "Tuesday". */
function chicagoWeekdayName(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    weekday: "long",
  }).format(instant);
}

export type PortalWindow =
  | { state: "open" }
  | { state: "blackout"; nextOpenISO: string; nextOpenLabel: string };

/**
 * Portal visibility gate: the donor view is "open" on weekdays between
 * 4:00 AM CT and 10:00 PM CT. Outside that window we return "blackout"
 * with the next open instant (next weekday 4 AM CT). This preserves the
 * blind-random rule — once a donor's Monday obligation is over at 10 PM
 * CT, the portal stops revealing Monday's selection so the Tuesday
 * selection can't leak via the portal before its own 4 AM CT unlock.
 *
 * Friday 10 PM CT → Monday 4 AM CT (weekends skipped). Holidays are NOT
 * currently handled; we'll add a holiday list later if needed.
 */
export function portalCheckWindow(now: Date = new Date()): PortalWindow {
  const hour = chicagoHour(now);
  const todayWeekday = chicagoWeekday(now);
  const isWeekday = todayWeekday >= 1 && todayWeekday <= 5;
  const isOpenHour = hour >= MORNING_UNLOCK_HOUR_CT && hour < EVENING_CUTOFF_HOUR_CT;
  if (isWeekday && isOpenHour) return { state: "open" };

  // Candidate day for the next open: today (if we're still pre-4 AM) or
  // tomorrow onward. Walk forward until we land on a weekday.
  const todayUtcMid = chicagoTodayAsUtcMidnight(now);
  let candidate = todayUtcMid;
  if (hour >= MORNING_UNLOCK_HOUR_CT) {
    candidate = new Date(candidate.getTime() + 86_400_000);
  }
  for (let i = 0; i < 7; i++) {
    const instant = unlockInstantForSelection(candidate);
    const wday = chicagoWeekday(instant);
    if (wday >= 1 && wday <= 5) {
      return {
        state: "blackout",
        nextOpenISO: instant.toISOString(),
        nextOpenLabel: chicagoWeekdayName(instant),
      };
    }
    candidate = new Date(candidate.getTime() + 86_400_000);
  }
  // Unreachable: any 7-day window contains a weekday.
  return { state: "open" };
}
