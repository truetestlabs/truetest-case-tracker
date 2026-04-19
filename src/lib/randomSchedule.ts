/**
 * Random schedule generator for monitored cases.
 *
 * Generates a set of random weekday (Mon-Fri) dates within a range,
 * respecting optional minimum-spacing constraints.
 */

import { randomInt } from "crypto";

export type PatternType = "range_count" | "per_month" | "per_week" | "every_n_days";

export type GenerateParams = {
  patternType: PatternType;
  targetCount: number;
  minSpacingDays?: number | null;
  fromDate: Date;
  toDate: Date;
  excludeDates?: Date[]; // existing selection dates to avoid
  allowedDays?: number[]; // days of week [0-6], 0=Sun. Default [1,2,3,4,5]
};

export type GenerateResult = {
  dates: Date[];
  warning?: string; // e.g., "Only generated 10 of 12 requested due to spacing"
};

// ---------- US Federal Holidays ----------

/** Returns a Set of "YYYY-MM-DD" strings for US federal holidays in the given year. */
function getUSHolidays(year: number): Set<string> {
  const holidays: Date[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;

  // Fixed-date holidays
  holidays.push(new Date(Date.UTC(year, 0, 1)));   // New Year's Day
  holidays.push(new Date(Date.UTC(year, 6, 4)));   // Independence Day
  holidays.push(new Date(Date.UTC(year, 10, 11))); // Veterans Day
  holidays.push(new Date(Date.UTC(year, 11, 25))); // Christmas Day

  // Nth-weekday holidays
  const nthWeekday = (month: number, weekday: number, n: number): Date => {
    const first = new Date(Date.UTC(year, month, 1));
    let day = first.getUTCDay();
    let offset = (weekday - day + 7) % 7 + (n - 1) * 7;
    return new Date(Date.UTC(year, month, 1 + offset));
  };
  const lastWeekday = (month: number, weekday: number): Date => {
    const last = new Date(Date.UTC(year, month + 1, 0));
    let day = last.getUTCDay();
    let offset = (day - weekday + 7) % 7;
    return new Date(Date.UTC(year, month + 1, -offset));
  };

  holidays.push(nthWeekday(0, 1, 3));  // MLK Day: 3rd Monday of January
  holidays.push(nthWeekday(1, 1, 3));  // Presidents' Day: 3rd Monday of February
  holidays.push(lastWeekday(4, 1));    // Memorial Day: last Monday of May
  holidays.push(nthWeekday(5, 1, 3));  // Juneteenth observed (nearest weekday handled below)
  holidays.push(nthWeekday(8, 1, 1));  // Labor Day: 1st Monday of September
  holidays.push(nthWeekday(9, 1, 2));  // Columbus Day: 2nd Monday of October
  holidays.push(nthWeekday(10, 4, 4)); // Thanksgiving: 4th Thursday of November
  // Day after Thanksgiving (common lab closure)
  const tgiving = nthWeekday(10, 4, 4);
  holidays.push(new Date(Date.UTC(year, tgiving.getUTCMonth(), tgiving.getUTCDate() + 1)));

  // Juneteenth: June 19 (if weekend, observed on nearest weekday)
  const juneteenth = new Date(Date.UTC(year, 5, 19));
  if (juneteenth.getUTCDay() === 0) holidays.push(new Date(Date.UTC(year, 5, 20))); // Sun→Mon
  else if (juneteenth.getUTCDay() === 6) holidays.push(new Date(Date.UTC(year, 5, 18))); // Sat→Fri
  else holidays.push(juneteenth);

  const keys = new Set<string>();
  for (const h of holidays) keys.add(h.toISOString().slice(0, 10));

  // Observed rule for fixed holidays: Sat→Fri, Sun→Mon
  for (const d of [
    new Date(Date.UTC(year, 0, 1)),
    new Date(Date.UTC(year, 6, 4)),
    new Date(Date.UTC(year, 10, 11)),
    new Date(Date.UTC(year, 11, 25)),
  ]) {
    if (d.getUTCDay() === 6) keys.add(key(d.getUTCMonth() + 1, d.getUTCDate() - 1)); // Fri
    if (d.getUTCDay() === 0) keys.add(key(d.getUTCMonth() + 1, d.getUTCDate() + 1)); // Mon
  }

  return keys;
}

/** Check if a date falls on a US federal holiday. */
export function isUSHoliday(d: Date): boolean {
  return getUSHolidays(d.getUTCFullYear()).has(d.toISOString().slice(0, 10));
}

// ---------- Date helpers (operate on UTC midnight dates) ----------

function utcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5; // Mon-Fri
}

/** A valid business day: allowed day-of-week AND not a US federal holiday. */
function isBusinessDay(d: Date, allowedDays?: number[]): boolean {
  const day = d.getUTCDay();
  const allowed = allowedDays ?? [1, 2, 3, 4, 5]; // default Mon-Fri
  return allowed.includes(day) && !isUSHoliday(d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** List every eligible day (allowed days of week, non-holiday) between fromDate and toDate (inclusive). */
function listWeekdays(from: Date, to: Date, excludeKeys: Set<string> = new Set(), allowedDays?: number[]): Date[] {
  const out: Date[] = [];
  let d = utcDate(from);
  const end = utcDate(to);
  while (d.getTime() <= end.getTime()) {
    if (isBusinessDay(d, allowedDays) && !excludeKeys.has(dateKey(d))) {
      out.push(new Date(d));
    }
    d = addDays(d, 1);
  }
  return out;
}

/** Shuffle in place (Fisher-Yates). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick up to `count` dates from `candidates`, each at least `minSpacing`
 * days away from every other picked date. Returns as many as possible.
 */
function pickWithSpacing(candidates: Date[], count: number, minSpacing: number): Date[] {
  const picked: Date[] = [];
  const pool = shuffle([...candidates]);
  for (const c of pool) {
    if (picked.length >= count) break;
    const tooClose = picked.some((p) => Math.abs(diffDays(c, p)) < minSpacing);
    if (!tooClose) picked.push(c);
  }
  return picked.sort((a, b) => a.getTime() - b.getTime());
}

// ---------- ISO week helpers ----------

/** Return ISO week identifier (YYYY-Www) for a date. */
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- Main generator ----------

export function generateSelections(params: GenerateParams): GenerateResult {
  const minSpacing = params.minSpacingDays ?? 0;
  const excludeKeys = new Set((params.excludeDates || []).map((d) => dateKey(utcDate(d))));
  const allWeekdays = listWeekdays(params.fromDate, params.toDate, excludeKeys, params.allowedDays);

  if (allWeekdays.length === 0) {
    return { dates: [], warning: "No weekdays available in the selected range." };
  }

  if (params.patternType === "range_count") {
    const picked = pickWithSpacing(allWeekdays, params.targetCount, minSpacing);
    const warning =
      picked.length < params.targetCount
        ? `Only ${picked.length} of ${params.targetCount} tests could be scheduled with ${minSpacing}-day spacing.`
        : undefined;
    return { dates: picked, warning };
  }

  if (params.patternType === "per_month") {
    // Group weekdays by month
    const byMonth = new Map<string, Date[]>();
    for (const d of allWeekdays) {
      const k = monthKey(d);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k)!.push(d);
    }
    const out: Date[] = [];
    let totalShortfall = 0;
    for (const [, days] of byMonth) {
      const picked = pickWithSpacing(days, params.targetCount, minSpacing);
      out.push(...picked);
      if (picked.length < params.targetCount) totalShortfall += params.targetCount - picked.length;
    }
    return {
      dates: out.sort((a, b) => a.getTime() - b.getTime()),
      warning: totalShortfall > 0 ? `Some months couldn't fit the full ${params.targetCount} tests.` : undefined,
    };
  }

  if (params.patternType === "per_week") {
    // Group weekdays by ISO week
    const byWeek = new Map<string, Date[]>();
    for (const d of allWeekdays) {
      const k = isoWeek(d);
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k)!.push(d);
    }
    const out: Date[] = [];
    let totalShortfall = 0;
    for (const [, days] of byWeek) {
      const picked = pickWithSpacing(days, params.targetCount, minSpacing);
      out.push(...picked);
      if (picked.length < params.targetCount) totalShortfall += params.targetCount - picked.length;
    }
    return {
      dates: out.sort((a, b) => a.getTime() - b.getTime()),
      warning: totalShortfall > 0 ? `Some weeks couldn't fit the full ${params.targetCount} tests.` : undefined,
    };
  }

  if (params.patternType === "every_n_days") {
    // Place one test every N days (targetCount = N), picking the nearest eligible day
    const interval = params.targetCount;
    const out: Date[] = [];
    let cursor = utcDate(params.fromDate);
    const end = utcDate(params.toDate);
    while (cursor.getTime() <= end.getTime()) {
      // Find the nearest eligible day at or after cursor
      let d = new Date(cursor);
      let attempts = 0;
      while (!isBusinessDay(d, params.allowedDays) && attempts < 10) {
        d = addDays(d, 1);
        attempts++;
      }
      if (d.getTime() <= end.getTime() && isBusinessDay(d, params.allowedDays) && !excludeKeys.has(dateKey(d))) {
        out.push(new Date(d));
      }
      cursor = addDays(cursor, interval);
    }
    return { dates: out };
  }

  return { dates: [], warning: "Unknown pattern type" };
}

/**
 * Find the next weekday (Mon-Fri) after the given date plus `addBusinessDays`.
 * `addBusinessDays=1` = next weekday after `from`.
 */
export function nextWeekday(from: Date, addBusinessDays = 1): Date {
  let d = utcDate(from);
  let added = 0;
  while (added < addBusinessDays) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) added++;
  }
  return d;
}

/** Generate an 8-digit PIN using crypto-strength randomness. */
export function generateCheckInPin(): string {
  // 10000000–99999999 → always 8 digits, no leading-zero ambiguity.
  const n = randomInt(10_000_000, 100_000_000);
  return String(n);
}
