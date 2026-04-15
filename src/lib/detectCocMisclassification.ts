/**
 * Detect when a PDF uploaded with documentType="result_report" actually looks
 * like a chain-of-custody form (the specimen was collected but the lab
 * hasn't posted results yet). Catching these saves us from writing garbage
 * LabResult rows where every analyte is "inconclusive" — which is what
 * happened on the benjamin hawkinson case before this check existed.
 *
 * Returns a warning message explaining why the upload looks wrong, or null
 * if it looks like a legitimate result report.
 *
 * Two signals are combined:
 *   1. Narrative-summary phrase match. The generateResultSummary prompt
 *      consistently uses phrases like "awaiting laboratory results" and
 *      "Result: PENDING" when it's summarizing a COC. These are the most
 *      reliable tell.
 *   2. Structured-extraction shape. If Claude's tool_use call came back
 *      with all analytes as "inconclusive" + no cutoff + no value, it's
 *      almost certainly a COC or order form, not a finished report.
 *
 * Either signal alone is enough to flag; we combine both so a scanned COC
 * that Claude summarizes differently still gets caught by the structured
 * check, and vice versa.
 */
import type { ExtractedLabResult } from "@/lib/resultExtract";

const COC_SUMMARY_PHRASES = [
  "awaiting laboratory results",
  "awaiting laboratory analysis",
  "specimen awaiting",
  "result: pending",
  "specimen collected, awaiting",
  "laboratory analysis are still pending",
  "laboratory analysis and mro review are still pending",
  "chain of custody form provided",
  "this form documents step",
  "not yet available on this document",
];

export function detectCocMisclassification(
  summary: string | null | undefined,
  structured: ExtractedLabResult | null
): string | null {
  // ── Signal 1: summary text ───────────────────────────────────────────
  if (summary) {
    const lower = summary.toLowerCase();
    const matched = COC_SUMMARY_PHRASES.find((p) => lower.includes(p));
    if (matched) {
      return (
        `This PDF looks like a chain-of-custody form, not a completed lab results report. ` +
        `The AI summary says "${matched}", which is a phrase our system uses when the specimen was collected but the lab hasn't posted results yet. ` +
        `We saved the file, but didn't extract structured lab data or advance the test order status. ` +
        `If this really is a results report, upload it again as a chain_of_custody document first so we parse it correctly, or verify you selected the right PDF.`
      );
    }
  }

  // ── Signal 2: structured-extraction shape ────────────────────────────
  if (structured && structured.analytes && structured.analytes.length > 0) {
    const allInconclusive = structured.analytes.every(
      (a) => a.result === "inconclusive" && !a.value && !a.cutoff
    );
    const pendingStatus = ["pending", "mro_pending", "unknown"].includes(
      structured.overallStatus
    );
    if (allInconclusive && pendingStatus) {
      return (
        `This PDF extracted with every analyte marked inconclusive and no quantitative values or cutoffs, ` +
        `which almost always means it's a chain-of-custody or order form rather than a finished lab results report. ` +
        `We saved the file, but didn't create a LabResult row or advance the test order status. ` +
        `Verify you have the completed Quest/USDTL/CRL results PDF before uploading again.`
      );
    }
  }

  return null;
}
