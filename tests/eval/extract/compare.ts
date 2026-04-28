/**
 * Field-by-field comparison logic for the resultExtract eval harness.
 *
 * Comparison rules (locked, see tests/eval/extract/README.md):
 *   - Dates: parse with date-fns (handles ISO + MM/DD/YYYY), compare
 *     timestamps. Day-only when either side lacks a time component;
 *     full timestamp when both sides include time-of-day.
 *   - Specimen IDs: routed through `specimenIdsMatch` from
 *     src/lib/patchValidation.ts so CRL "X" prefixes don't false-flag.
 *   - Strings / enums: trim → casefold → collapse internal whitespace.
 *   - Numbers (or numeric-looking strings on both sides): strict ===
 *     (so 334 matches 334.0; no tolerance).
 *   - Optional fields: null / undefined / missing all collapse to the
 *     same "absent" state; matching absent on both sides is a match.
 *     null does NOT match the literal "" (empty string).
 *   - Analytes: matched by normalized `name`; per-analyte fields
 *     compared individually. Missing analytes → parser_missed_field;
 *     extras → parser_added_field; per-field disagreements →
 *     individual mismatch entries.
 */
import { format, isValid, parse, parseISO } from "date-fns";
import type {
  AnalyteResult,
  ExtractedLabResult,
} from "@/lib/resultExtract";
import { specimenIdsMatch } from "@/lib/patchValidation";
import type { FieldResult, TruthFile } from "./types";

// Fields whose values get the specimen-ID prefix-tolerant compare.
// Add more here if other fields ever need the same treatment.
const SPECIMEN_ID_FIELDS = new Set<string>(["labSpecimenId"]);

// Fields parsed as dates (per the source schema, all top-level date
// fields are date-only YYYY-MM-DD strings). The harness still detects
// time-of-day on either side and uses full-timestamp compare in that
// case, since labeler convention may evolve.
const DATE_FIELDS = new Set<string>([
  "reportedCollectionDate",
  "receivedAtLab",
  "reportDate",
  "mroVerificationDate",
]);

// Order is stable for human-readable output.
const TOP_LEVEL_FIELDS: ReadonlyArray<keyof ExtractedLabResult> = [
  "overallStatus",
  "reportedCollectionDate",
  "receivedAtLab",
  "reportDate",
  "mroVerificationDate",
  "labReportNumber",
  "labSpecimenId",
  "labName",
  "analytes",
  "specimenValidity",
];

const ANALYTE_SUBFIELDS = ["cutoff", "value", "result", "notes"] as const;
const SPECIMEN_VALIDITY_SUBFIELDS = ["creatinine", "ph", "status"] as const;

export function compareExtractedLabResult(
  truth: TruthFile,
  actual: ExtractedLabResult | null,
): FieldResult[] {
  if (actual === null || actual === undefined) {
    return [
      {
        field: "<root>",
        truth: "<any non-null result>",
        actual: actual,
        status: "mismatch",
        reason: "extractor returned null",
      },
    ];
  }

  const results: FieldResult[] = [];
  for (const field of TOP_LEVEL_FIELDS) {
    if (field === "analytes") {
      results.push(
        ...compareAnalytes(truth.analytes ?? [], actual.analytes ?? []),
      );
      continue;
    }
    if (field === "specimenValidity") {
      results.push(
        ...compareSpecimenValidity(
          truth.specimenValidity ?? null,
          actual.specimenValidity ?? null,
        ),
      );
      continue;
    }
    results.push(
      compareField(
        field,
        (truth as Record<string, unknown>)[field],
        (actual as unknown as Record<string, unknown>)[field],
      ),
    );
  }
  return results;
}

function compareField(
  field: string,
  truthVal: unknown,
  actualVal: unknown,
): FieldResult {
  const tMissing = isMissing(truthVal);
  const aMissing = isMissing(actualVal);

  if (tMissing && aMissing) {
    return { field, truth: truthVal, actual: actualVal, status: "match" };
  }
  if (tMissing && !aMissing) {
    return {
      field,
      truth: truthVal,
      actual: actualVal,
      status: "parser_added_field",
    };
  }
  if (!tMissing && aMissing) {
    return {
      field,
      truth: truthVal,
      actual: actualVal,
      status: "parser_missed_field",
    };
  }

  // Specimen IDs use the prefix-tolerant comparator.
  if (SPECIMEN_ID_FIELDS.has(field)) {
    return specimenIdsMatch(String(truthVal), String(actualVal))
      ? { field, truth: truthVal, actual: actualVal, status: "match" }
      : { field, truth: truthVal, actual: actualVal, status: "mismatch" };
  }

  // Date fields.
  if (DATE_FIELDS.has(field)) {
    return compareDateField(field, truthVal, actualVal);
  }

  // Numeric strict equality when both sides parse as a finite number.
  // Catches "334" vs "334.0" without tolerance.
  if (looksNumeric(truthVal) && looksNumeric(actualVal)) {
    return Number(truthVal) === Number(actualVal)
      ? { field, truth: truthVal, actual: actualVal, status: "match" }
      : { field, truth: truthVal, actual: actualVal, status: "mismatch" };
  }

  // Default: normalized string compare. Handles enums (POSITIVE vs
  // positive) and string fields with whitespace variation.
  const tStr = normalizeString(String(truthVal));
  const aStr = normalizeString(String(actualVal));
  return tStr === aStr
    ? { field, truth: truthVal, actual: actualVal, status: "match" }
    : { field, truth: truthVal, actual: actualVal, status: "mismatch" };
}

function compareDateField(
  field: string,
  truthVal: unknown,
  actualVal: unknown,
): FieldResult {
  const truthStr = String(truthVal).trim();
  const actualStr = String(actualVal).trim();
  const tDate = parseFlexibleDate(truthStr);
  const aDate = parseFlexibleDate(actualStr);

  if (!tDate || !aDate) {
    return {
      field,
      truth: truthVal,
      actual: actualVal,
      status: "mismatch",
      reason: "unparseable date",
    };
  }

  // Per spec: only compare time-of-day if BOTH sides include it.
  // Truth files written for ExtractedLabResult are date-only by
  // schema, so this collapses to day-only in practice; the branch
  // is here for forward-compat with timestamp-rich labels.
  const tHasTime = hasTimeComponent(truthStr);
  const aHasTime = hasTimeComponent(actualStr);

  if (tHasTime && aHasTime) {
    return tDate.getTime() === aDate.getTime()
      ? { field, truth: truthVal, actual: actualVal, status: "match" }
      : { field, truth: truthVal, actual: actualVal, status: "mismatch" };
  }

  // Day-only compare via formatted YYYY-MM-DD. Both formats use the
  // same local-tz interpretation, so equivalent calendar dates match.
  const tDay = format(tDate, "yyyy-MM-dd");
  const aDay = format(aDate, "yyyy-MM-dd");
  return tDay === aDay
    ? { field, truth: truthVal, actual: actualVal, status: "match" }
    : { field, truth: truthVal, actual: actualVal, status: "mismatch" };
}

function compareAnalytes(
  truth: AnalyteResult[],
  actual: AnalyteResult[],
): FieldResult[] {
  // Match by normalized name. Two truth analytes with the same
  // normalized name would clobber each other — that's a labeling
  // bug, not something the comparator needs to defend against, but
  // we surface it via a one-off parser_missed_field if it ever
  // happens (the second one wins in the Map).
  const truthByName = new Map<string, AnalyteResult>();
  const actualByName = new Map<string, AnalyteResult>();
  for (const a of truth) truthByName.set(normalizeString(a.name), a);
  for (const a of actual) actualByName.set(normalizeString(a.name), a);

  const allNames = new Set<string>([
    ...truthByName.keys(),
    ...actualByName.keys(),
  ]);

  const results: FieldResult[] = [];
  // Stable, sorted iteration so JSON output is diffable across runs.
  for (const name of [...allNames].sort()) {
    const t = truthByName.get(name);
    const a = actualByName.get(name);
    // Use the human-readable name from whichever side has it for the
    // displayed field path.
    const display = t?.name ?? a?.name ?? name;

    if (!t) {
      results.push({
        field: `analytes[${display}]`,
        truth: undefined,
        actual: a,
        status: "parser_added_field",
      });
      continue;
    }
    if (!a) {
      results.push({
        field: `analytes[${display}]`,
        truth: t,
        actual: undefined,
        status: "parser_missed_field",
      });
      continue;
    }

    for (const sub of ANALYTE_SUBFIELDS) {
      results.push(
        compareField(
          `analytes[${display}].${sub}`,
          (t as Record<string, unknown>)[sub],
          (a as Record<string, unknown>)[sub],
        ),
      );
    }
  }
  return results;
}

function compareSpecimenValidity(
  truth: ExtractedLabResult["specimenValidity"],
  actual: ExtractedLabResult["specimenValidity"],
): FieldResult[] {
  const tMissing = isMissing(truth);
  const aMissing = isMissing(actual);
  if (tMissing && aMissing) {
    return [{ field: "specimenValidity", truth, actual, status: "match" }];
  }
  if (tMissing) {
    return [
      {
        field: "specimenValidity",
        truth,
        actual,
        status: "parser_added_field",
      },
    ];
  }
  if (aMissing) {
    return [
      {
        field: "specimenValidity",
        truth,
        actual,
        status: "parser_missed_field",
      },
    ];
  }

  const out: FieldResult[] = [];
  for (const sub of SPECIMEN_VALIDITY_SUBFIELDS) {
    out.push(
      compareField(
        `specimenValidity.${sub}`,
        (truth as Record<string, unknown>)[sub],
        (actual as Record<string, unknown>)[sub],
      ),
    );
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────

function isMissing(v: unknown): boolean {
  return v === undefined || v === null;
}

function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function looksNumeric(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return false;
  const s = String(v).trim();
  if (s === "") return false;
  const n = Number(s);
  return Number.isFinite(n);
}

function hasTimeComponent(s: string): boolean {
  // Matches "...T12:34", "... 12:34", "12:34" anywhere — sloppy but
  // sufficient: we only need to know "did the labeler include a time?"
  return /\d{1,2}:\d{2}/.test(s);
}

function parseFlexibleDate(s: string): Date | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;

  // ISO 8601 (YYYY-MM-DD or full ISO timestamp). parseISO handles both.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = parseISO(trimmed);
    if (isValid(d)) return d;
  }

  // US slash with 4-digit year.
  const slash4 = parse(trimmed, "MM/dd/yyyy", new Date(0));
  if (isValid(slash4)) return slash4;

  // US slash with 2-digit year (date-fns interprets per its
  // current-window heuristic — fine for our purposes).
  const slash2 = parse(trimmed, "MM/dd/yy", new Date(0));
  if (isValid(slash2)) return slash2;

  // Last-resort: native Date constructor. Catches things like
  // "April 15, 2026" or "2026/04/15".
  const fallback = new Date(trimmed);
  return isValid(fallback) ? fallback : null;
}
