/**
 * Random schedule generator for monitored cases.
 *
 * Generates a set of random weekday (Mon-Fri) dates within a range,
 * respecting optional minimum-spacing constraints.
 */

export type PatternType = "range_count" | "per_month" | "per_week";

export type GenerateParams = {
  patternType: PatternType;
  targetCount: number;
  minSpacingDays?: number | null;
  fromDate: Date;
  toDate: Date;
  excludeDates?: Date[]; // existing selection dates to avoid
};

export type GenerateResult = {
  dates: Date[];
  warning?: string; // e.g., "Only generated 10 of 12 requested due to spacing"
};

// ---------- Date helpers (operate on UTC midnight dates) ----------

function utcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5; // Mon-Fri
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

/** List every weekday between fromDate and toDate (inclusive). */
function listWeekdays(from: Date, to: Date, excludeKeys: Set<string> = new Set()): Date[] {
  const out: Date[] = [];
  let d = utcDate(from);
  const end = utcDate(to);
  while (d.getTime() <= end.getTime()) {
    if (isWeekday(d) && !excludeKeys.has(dateKey(d))) {
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
  const allWeekdays = listWeekdays(params.fromDate, params.toDate, excludeKeys);

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
    if (isWeekday(d)) added++;
  }
  return d;
}

/** Generate a 6-digit PIN. */
export function generateCheckInPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
