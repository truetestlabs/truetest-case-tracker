import type { PatchCancellationKind } from "@prisma/client";
import { chicagoDateKey } from "./dateChicago";

/**
 * Pure helpers for sweat-patch lifecycle validation and display state.
 * No DB, no Prisma calls — every function in this file should be safely
 * importable from server, edge, and browser contexts. Side effects belong
 * elsewhere (see `src/lib/patchStatus.ts` for the Prisma-aware helpers).
 *
 * Why these live in their own file: the cross-cutting concerns
 * (wear-day status, date validation, specimen ID matching) are reused
 * across (a) the case detail page UI badges, (b) the lab result
 * crosscheck pipeline, and (c) the result extraction prompts. Keeping
 * them pure and dependency-free avoids dragging the Prisma client into
 * the result-extraction model context.
 *
 * Date semantics: all calendar-day math is Chicago-local. Staff apply
 * patches and pick application/removal dates in Chicago time, so wear
 * days and "is this date in the future?" both bucket by the donor's
 * Chicago calendar day. This matches the rest of the system
 * (`dateChicago.ts`, monitoring selection windows).
 */

// Internal: convert a UTC instant to the UTC-midnight epoch of the
// Chicago calendar day containing it. Lets us subtract two of these
// to get a Chicago-local day diff that's stable across DST.
function chicagoDayMs(d: Date): number {
  const [y, m, day] = chicagoDateKey(d).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

// ──────────────────────────────────────────────────────────────────────
// Wear-day status thresholds
// ──────────────────────────────────────────────────────────────────────
//
// Days are calendar-day counts from application to "as of." The bands:
//   1–6  → neutral  (typical wear window; no concern)
//   7–9  → yellow   (approaching/at standard removal — should remove soon)
//   10–29 → orange  (overdue removal; flag for action)
//   30+  → red      (very overdue; eligible for manual cancel as `expired`)
//
// 0 days (application today) is treated as neutral — it's day 1 of wear.

export const PATCH_WEAR_THRESHOLDS = {
  neutralMax: 6,
  yellowMax: 9,
  orangeMax: 29,
  // 30+ = red; manual cancel as PatchCancellationKind.expired allowed past this
  expiredCancelMin: 30,
} as const;

export type PatchWearStatus = "neutral" | "yellow" | "orange" | "red";

// ──────────────────────────────────────────────────────────────────────
// computeWearDays
// ──────────────────────────────────────────────────────────────────────
//
// Calendar-day diff between application and "as of," counted in
// Chicago-local days. Both inputs are bucketed to their Chicago
// calendar day before the diff — so a patch applied at 11pm Chicago
// is "1 day worn" by 1am Chicago the next morning, which is what
// staff intuitively expect. Negative results clamp to 0; a future
// application is shown as "0 days" rather than a confusing negative.
//
// Returns whole days as a non-negative integer.

export function computeWearDays(applicationDate: Date, asOf: Date): number {
  const a = chicagoDayMs(applicationDate);
  const b = chicagoDayMs(asOf);
  const diffDays = Math.floor((b - a) / 86_400_000);
  return Math.max(0, diffDays);
}

// ──────────────────────────────────────────────────────────────────────
// computeWearStatus
// ──────────────────────────────────────────────────────────────────────
//
// Maps a non-negative day count to a status band. See thresholds above.

export function computeWearStatus(days: number): PatchWearStatus {
  if (days <= PATCH_WEAR_THRESHOLDS.neutralMax) return "neutral";
  if (days <= PATCH_WEAR_THRESHOLDS.yellowMax) return "yellow";
  if (days <= PATCH_WEAR_THRESHOLDS.orangeMax) return "orange";
  return "red";
}

// ──────────────────────────────────────────────────────────────────────
// wearBadgeFor — the UI-facing summary
// ──────────────────────────────────────────────────────────────────────
//
// Discriminated union so callers can render the right thing per kind:
//   - 'no_application': PatchDetails exists but applicationDate is null
//   - 'cancelled': PatchDetails was cancelled (any kind), don't show wear
//   - 'removed': removalDate is set; show static wear-days summary
//   - 'wearing': in-flight; show live wear-days + status band
//
// Cancellation takes precedence over removal: if a patch was cancelled
// after application, we don't pretend it was a normal removal even if
// `removalDate` happens to be set. Removal takes precedence over wearing.

interface PatchDetailsForBadge {
  applicationDate: Date | null;
  removalDate: Date | null;
  cancellationKind: PatchCancellationKind | null;
  cancelledAt: Date | null;
}

export type WearBadge =
  | { kind: "no_application" }
  | {
      kind: "cancelled";
      reason: PatchCancellationKind;
      at: Date | null; // cancelledAt may be null on legacy rows
    }
  | { kind: "removed"; removedAt: Date; wearDays: number }
  | { kind: "wearing"; days: number; status: PatchWearStatus };

export function wearBadgeFor(
  details: PatchDetailsForBadge,
  now: Date,
): WearBadge {
  if (details.cancellationKind) {
    return {
      kind: "cancelled",
      reason: details.cancellationKind,
      at: details.cancelledAt,
    };
  }
  if (!details.applicationDate) {
    return { kind: "no_application" };
  }
  if (details.removalDate) {
    return {
      kind: "removed",
      removedAt: details.removalDate,
      wearDays: computeWearDays(details.applicationDate, details.removalDate),
    };
  }
  const days = computeWearDays(details.applicationDate, now);
  return { kind: "wearing", days, status: computeWearStatus(days) };
}

// ──────────────────────────────────────────────────────────────────────
// patchLifecycleStatus — workflow position, NOT wear-overdue band
// ──────────────────────────────────────────────────────────────────────
//
// Four states answer "where is this patch in the workflow":
//   WORN      — applied to donor, awaiting removal/CoC upload
//   AT_LAB    — executed CoC has been uploaded, awaiting results
//   COMPLETE  — lab results received
//   CANCELLED — cancellationKind stamped (any kind: cancelled, lab_cancelled, expired)
//
// Returns null when applicationDate is missing — the record exists but
// the patch hasn't started, so no lifecycle label applies. Callers
// should hide the badge in that case.
//
// Why this lives next to wearBadgeFor instead of replacing it: the two
// answer different questions. wearBadgeFor drives the wear-overdue
// color band (yellow at 7, orange at 10, red at 30) for an in-flight
// WORN patch. patchLifecycleStatus drives the workflow badge label.
// A WORN patch can simultaneously be in the orange wear band; both
// are valid and both render.
//
// Cancellation precedence: cancelled patches always return CANCELLED,
// even if a LabResult was later attached (lab might process a
// cancelled-but-already-shipped specimen). Mirrors wearBadgeFor's
// "cancellation takes precedence over removal" rule.
//
// COMPLETE requires BOTH a LabResult AND an executed CoC (executedDocumentId).
// A lab result without the linked executed CoC is treated as an
// incomplete record and stays at AT_LAB — promoting it to COMPLETE
// would silently paper over missing chain-of-custody documentation,
// which has real evidentiary consequences in custody cases.
//
// AT_LAB therefore covers two paths: (a) executed CoC uploaded but no
// result yet (the normal "in transit / at lab" state), and (b) a
// result arrived without our executedDocumentId being set (data
// integrity gap — surfaces as AT_LAB so staff can investigate the
// missing CoC linkage).
//
// removalDate alone does NOT trigger AT_LAB — it's a transient state
// (staff typed the date but hasn't run executePatchCoc yet). The spec
// ties the AT_LAB transition explicitly to CoC upload + extraction.

export type PatchLifecycleStatus = "WORN" | "AT_LAB" | "COMPLETE" | "CANCELLED";

interface PatchDetailsForLifecycle {
  applicationDate: Date | null;
  cancellationKind: PatchCancellationKind | null;
  executedDocumentId: string | null;
  hasLabResult: boolean;
}

export function patchLifecycleStatus(
  details: PatchDetailsForLifecycle,
): PatchLifecycleStatus | null {
  if (details.cancellationKind) return "CANCELLED";
  if (!details.applicationDate) return null;
  if (details.hasLabResult && details.executedDocumentId) return "COMPLETE";
  if (details.executedDocumentId || details.hasLabResult) return "AT_LAB";
  return "WORN";
}

// ──────────────────────────────────────────────────────────────────────
// validatePatchDates
// ──────────────────────────────────────────────────────────────────────
//
// Field-level validation for application/removal date pickers. Returns
// an array of error strings (empty when valid). Caller decides whether
// to surface as field errors or a banner.
//
// Rules enforced:
//   - applicationDate cannot be in the future (≥ asOf+1 calendar day)
//   - removalDate cannot be in the future (same rule)
//   - removalDate must be on-or-after applicationDate when both set
//
// Same-day application + removal IS allowed — a patch can be applied
// and immediately removed (e.g., adverse skin reaction in the chair).

export function validatePatchDates(input: {
  applicationDate?: Date | null;
  removalDate?: Date | null;
  asOf?: Date;
}): string[] {
  const errors: string[] = [];
  const now = input.asOf ?? new Date();
  const todayChi = chicagoDayMs(now);

  if (input.applicationDate) {
    if (chicagoDayMs(input.applicationDate) > todayChi) {
      errors.push("Application date cannot be in the future.");
    }
  }
  if (input.removalDate) {
    if (chicagoDayMs(input.removalDate) > todayChi) {
      errors.push("Removal date cannot be in the future.");
    }
  }
  if (input.applicationDate && input.removalDate) {
    if (input.removalDate.getTime() < input.applicationDate.getTime()) {
      errors.push("Removal date cannot be before application date.");
    }
  }
  return errors;
}

// ──────────────────────────────────────────────────────────────────────
// stripNonDigitPrefix
// ──────────────────────────────────────────────────────────────────────
//
// Strip any leading non-digit characters from a specimen ID. CRL
// prefixes its accession numbers with "X" (and sometimes other
// non-digit junk), which breaks raw `===` comparisons against our own
// numeric specimen IDs. Trim whitespace first; we don't otherwise
// alter the body of the string.
//
//   "X12345"      → "12345"
//   "  X 12345 "  → "12345"  (trim + strip)
//   "12345"       → "12345"  (no change)
//   "X"           → ""       (degenerate; caller should treat as no-match)

export function stripNonDigitPrefix(s: string): string {
  return s.trim().replace(/^\D+/, "");
}

// ──────────────────────────────────────────────────────────────────────
// specimenIdsMatch
// ──────────────────────────────────────────────────────────────────────
//
// Tolerant equality for cross-system specimen-ID compare. Both sides
// are stripped of leading non-digits, then compared as strings.
//
// Returns false (not throws) for nullish inputs and for inputs that
// reduce to empty after stripping — there's no defensible "match" for
// a missing or all-junk ID, and silent false is friendlier in
// crosscheck pipelines that batch many comparisons.

export function specimenIdsMatch(
  ourId: string | null | undefined,
  theirId: string | null | undefined,
): boolean {
  if (!ourId || !theirId) return false;
  const a = stripNonDigitPrefix(ourId);
  const b = stripNonDigitPrefix(theirId);
  if (!a || !b) return false;
  return a === b;
}
