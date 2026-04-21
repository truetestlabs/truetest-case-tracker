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
import { chicagoDateKey, formatChicagoMediumDate } from "@/lib/dateChicago";

export type MismatchSeverity = "info" | "warning" | "critical";
export type MismatchType = "collection_date" | "specimen_id" | "other";

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
};

/**
 * Parse an ISO YYYY-MM-DD string from the extractor into a Date. Returns
 * null on unparseable input rather than throwing — missing is expected.
 *
 * We construct at noon UTC (not local-tz noon) so the resulting instant
 * is stable across servers: a UTC server and a CT-local dev machine
 * produce the same `Date` for the same input. Noon is chosen so the
 * instant renders as the same calendar day in every continental-US
 * timezone (DST-safe).
 */
function parseIsoDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const match = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Compare two instants by Chicago calendar day. Using server-local
 * getFullYear/getMonth/getDate here would false-positive whenever
 * `order.collectionDate` straddles UTC midnight — e.g. a 9 PM CT
 * collection is stored as the next UTC day, so its local-tz Y/M/D on a
 * UTC server reads as tomorrow while the lab's `"YYYY-MM-DD"` string
 * reads as today. Both represent the same Chicago day; the mismatch
 * warning fires a false specimen-mixup alert on the reviewer.
 */
function sameDay(a: Date, b: Date): boolean {
  return chicagoDateKey(a) === chicagoDateKey(b);
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
  // at order creation). Only flag if it matches NEITHER of the ones we have.
  const theirId = extracted.labSpecimenId?.trim();
  if (theirId) {
    const candidates = [order.specimenId, order.labAccessionNumber]
      .filter((v): v is string => !!v)
      .map((v) => v.trim());
    if (candidates.length > 0 && !candidates.includes(theirId)) {
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

  return findings;
}
