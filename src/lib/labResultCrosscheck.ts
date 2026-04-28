/**
 * Cross-check extracted lab-result data against what we already have on the
 * TestOrder. Returns an array of mismatch findings (empty = everything
 * matched or we had nothing to compare). Never mutates anything — the caller
 * stores the findings on the LabResult row and surfaces them in the UI, and
 * the human decides whether to accept the lab's value, keep ours, or
 * investigate.
 *
 * Policy: "flag and wait for human review" (per the Piece 1 design).
 */
import type { ExtractedLabResult } from "@/lib/resultExtract";
import type { PatchPanel } from "@prisma/client";
import { formatChicagoMediumDate } from "@/lib/dateChicago";
import {
  computeWearDays,
  specimenIdsMatch,
} from "@/lib/patchValidation";

export type MismatchSeverity = "info" | "warning" | "critical";
export type MismatchType =
  | "collection_date"
  | "specimen_id"
  // Sweat-patch lifecycle crosschecks. Only fire when TestOrderSnapshot
  // carries a non-null `patchDetails`. `panel_completeness` (verifying
  // every expected analyte for WA07/WC82 actually appears in results)
  // is intentionally NOT in this list — gated on getting redacted CRL
  // PDFs to learn the format. See the locked-decisions table.
  | "patch_application_date"
  | "patch_removal_date"
  | "patch_wear_days"
  | "other";

export type MismatchFinding = {
  type: MismatchType;
  severity: MismatchSeverity;
  ourValue: string;
  theirValue: string;
  message: string;
};

export type TestOrderSnapshot = {
  collectionDate: Date | null;
  specimenId: string | null;
  labAccessionNumber: string | null;
  // Present only for sweat-patch orders. Optional + nullable so existing
  // callers (which only carry TestOrder fields) keep working — they
  // simply don't trigger the patch-specific checks. Item #7 of the
  // sweat-patch rollout threads this through every LabResult.create
  // call site.
  patchDetails?: {
    applicationDate: Date | null;
    removalDate: Date | null;
    panel: PatchPanel;
  } | null;
};

/**
 * Parse an ISO YYYY-MM-DD string from the extractor into a Date. Returns
 * null on unparseable input rather than throwing — missing is expected.
 */
function parseIsoDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const match = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDate(d: Date): string {
  return formatChicagoMediumDate(d);
}

/**
 * Run all cross-checks. Currently:
 *   1. reportedCollectionDate vs TestOrder.collectionDate (WARNING on >1 day gap)
 *   2. labSpecimenId vs TestOrder.specimenId OR TestOrder.labAccessionNumber (CRITICAL on mismatch — possible specimen mix-up)
 *
 * Easy to add more as we discover them.
 */
export function runLabResultCrosschecks(
  extracted: ExtractedLabResult,
  order: TestOrderSnapshot
): MismatchFinding[] {
  const findings: MismatchFinding[] = [];

  // ── Collection date ──
  const theirDate = parseIsoDate(extracted.reportedCollectionDate);
  if (theirDate && order.collectionDate) {
    if (!sameDay(theirDate, order.collectionDate)) {
      findings.push({
        type: "collection_date",
        severity: "warning",
        ourValue: formatDate(order.collectionDate),
        theirValue: formatDate(theirDate),
        message:
          "Collection date on the lab report doesn't match what we recorded. Could be a data-entry fix, a lab typo, or a specimen mix-up — please verify before accepting.",
      });
    }
  }

  // ── Specimen ID ──
  // The lab's ID could legitimately match EITHER our specimenId (control
  // number from the COC) OR our labAccessionNumber (if we pre-assigned one
  // at order creation). Only flag if it matches NEITHER. Uses
  // `specimenIdsMatch` (strips leading non-digits before compare) so
  // CRL's "X"-prefixed specimen IDs don't false-flag against our raw
  // numeric IDs — that prefix tolerance is the only crosscheck change
  // for the sweat-patch rollout, but it applies to all specimen types
  // since CRL also runs urine for us.
  const theirId = extracted.labSpecimenId?.trim();
  if (theirId) {
    const candidates = [order.specimenId, order.labAccessionNumber]
      .filter((v): v is string => !!v)
      .map((v) => v.trim());
    const anyMatch = candidates.some((c) => specimenIdsMatch(c, theirId));
    if (candidates.length > 0 && !anyMatch) {
      findings.push({
        type: "specimen_id",
        severity: "critical",
        ourValue: candidates.join(" / "),
        theirValue: theirId,
        message:
          "The lab's specimen ID does NOT match our chain-of-custody number. This could indicate a specimen mix-up and should be investigated before releasing the result.",
      });
    }
  }

  // ── Sweat-patch lifecycle crosschecks ──
  // Only meaningful when this is a sweat-patch order — gated on the
  // optional `patchDetails` snapshot. Each check needs both sides
  // (a date from us + a date from the lab) to fire.
  if (order.patchDetails && theirDate) {
    const { applicationDate, removalDate } = order.patchDetails;

    // Application after collection — physically impossible. Either our
    // applicationDate is wrong or the lab report is for a different
    // patch. CRITICAL.
    if (applicationDate && applicationDate.getTime() > theirDate.getTime()) {
      findings.push({
        type: "patch_application_date",
        severity: "critical",
        ourValue: formatDate(applicationDate),
        theirValue: formatDate(theirDate),
        message:
          "Patch application date is AFTER the lab's reported collection date. This is impossible — verify the patch was applied before it was sent to the lab and check both dates for a typo.",
      });
    }

    // Removal after collection — suspicious but not impossible (could be
    // a transit-day rounding difference). WARNING.
    if (removalDate && removalDate.getTime() > theirDate.getTime()) {
      findings.push({
        type: "patch_removal_date",
        severity: "warning",
        ourValue: formatDate(removalDate),
        theirValue: formatDate(theirDate),
        message:
          "Patch removal date is AFTER the lab's reported collection date. Could be a date-entry error on either side, or the lab's collection date is referring to receipt rather than removal — verify before releasing.",
      });
    }

    // Wear-days outside the expected 1–14 day band. INFO when short
    // (0-wear: applied and removed same day — could be legit but worth
    // flagging), WARNING when long (>14 = past standard removal).
    // Skip when either date is null or if removal precedes application
    // (already flagged at validation time).
    if (
      applicationDate &&
      removalDate &&
      removalDate.getTime() >= applicationDate.getTime()
    ) {
      const wear = computeWearDays(applicationDate, removalDate);
      if (wear < 1) {
        findings.push({
          type: "patch_wear_days",
          severity: "info",
          ourValue: `${wear} days`,
          theirValue: "expected 1–14",
          message:
            "Patch wear duration was less than 1 day. If the patch was applied and removed the same day on purpose (e.g., adverse skin reaction), this is fine — confirm before releasing.",
        });
      } else if (wear > 14) {
        findings.push({
          type: "patch_wear_days",
          severity: "warning",
          ourValue: `${wear} days`,
          theirValue: "expected 1–14",
          message:
            "Patch wear duration exceeded 14 days. Standard wear is 7 days; >14 may indicate a delayed removal or a stale order — verify the dates.",
        });
      }
    }
  }

  return findings;
}
