"use client";

/**
 * LabResultCard — renders a single LabResult (the structured data extracted
 * from a result PDF) as a card on the case detail page. Shows the overall
 * verdict, dates line, per-analyte table, mismatch warning banner, and
 * source-PDF link.
 *
 * Mismatch actions (accept lab's value / keep ours / flag) POST to
 * /api/lab-results/[id]/resolve, which updates the TestOrder if appropriate
 * and writes a StatusLog entry.
 */
import { useState } from "react";
import { apiError } from "@/lib/clientErrors";
import { formatChicagoShortDate } from "@/lib/dateChicago";

export type Analyte = {
  name: string;
  cutoff?: string | null;
  value?: string | null;
  result: "negative" | "positive" | "inconclusive";
  notes?: string | null;
};

export type Mismatch = {
  type: "collection_date" | "specimen_id" | "other";
  severity: "info" | "warning" | "critical";
  ourValue: string;
  theirValue: string;
  message: string;
  resolved?: boolean;
  resolvedAction?: "accept_theirs" | "keep_ours" | "flag";
  resolvedAt?: string;
  resolvedBy?: string;
  reviewNote?: string | null;
};

export type LabResultData = {
  id: string;
  overallStatus: string;
  reportedCollectionDate?: string | null;
  receivedAtLab?: string | null;
  reportDate?: string | null;
  mroVerificationDate?: string | null;
  receivedByUs: string;
  labReportNumber?: string | null;
  labSpecimenId?: string | null;
  labName?: string | null;
  analytes?: Analyte[] | null;
  specimenValidity?: { creatinine?: string | null; ph?: string | null; status?: string | null } | null;
  mismatches?: Mismatch[] | null;
  source: string;
};

type Props = {
  result: LabResultData;
  testDescription: string;
  onResolved?: () => void;
};

// ── Tiny helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatChicagoShortDate(d);
}

function overallStatusStyle(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    negative: { label: "✓ NEGATIVE", className: "bg-green-50 text-green-800 border-green-200" },
    positive: { label: "✕ POSITIVE", className: "bg-red-50 text-red-800 border-red-200" },
    dilute: { label: "⚠ DILUTE", className: "bg-amber-50 text-amber-800 border-amber-200" },
    adulterated: { label: "⚠ ADULTERATED", className: "bg-red-50 text-red-800 border-red-200" },
    invalid: { label: "⚠ INVALID", className: "bg-red-50 text-red-800 border-red-200" },
    mixed: { label: "● MIXED", className: "bg-amber-50 text-amber-800 border-amber-200" },
    mro_pending: { label: "◐ MRO PENDING", className: "bg-blue-50 text-blue-800 border-blue-200" },
    mro_verified_negative: { label: "✓ MRO VERIFIED NEGATIVE", className: "bg-green-50 text-green-800 border-green-200" },
    pending: { label: "◐ PARSING...", className: "bg-gray-50 text-gray-600 border-gray-200" },
    unknown: { label: "? UNKNOWN", className: "bg-gray-50 text-gray-600 border-gray-200" },
  };
  return map[status] || map.unknown;
}

function analyteRowStyle(result: string): string {
  if (result === "positive") return "bg-red-50 text-red-900 font-medium";
  if (result === "inconclusive") return "bg-amber-50 text-amber-900";
  return "text-gray-700";
}

function severityBadge(severity: string): string {
  if (severity === "critical") return "bg-red-600 text-white";
  if (severity === "warning") return "bg-amber-500 text-white";
  return "bg-blue-500 text-white";
}

// ── Component ─────────────────────────────────────────────────────────────

export function LabResultCard({ result, testDescription, onResolved }: Props) {
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [error, setError] = useState<string>("");
  // For "clean" negatives we collapse the analyte table by default and
  // let the user expand it if they want to verify which substances were
  // tested. Anything other than a pure negative (positive, dilute,
  // adulterated, MRO pending, etc.) always shows the full table
  // because each row may contain the important quantitative value.
  const [showAnalytes, setShowAnalytes] = useState(false);

  const status = overallStatusStyle(result.overallStatus);
  const analytes = result.analytes || [];
  const mismatches = result.mismatches || [];
  const unresolvedMismatches = mismatches.filter((m) => !m.resolved);

  // Collapse behavior: only when the overall verdict is a clean negative
  // (or MRO-verified negative). Any other status keeps the full table
  // expanded so positive/inconclusive/invalid details are always visible.
  const isCleanNegative =
    (result.overallStatus === "negative" ||
      result.overallStatus === "mro_verified_negative") &&
    analytes.length > 0 &&
    analytes.every((a) => a.result === "negative");
  const shouldCollapse = isCleanNegative && !showAnalytes;

  async function resolveMismatch(index: number, action: Mismatch["resolvedAction"]) {
    if (!action) return;
    setBusyIndex(index);
    setError("");
    try {
      const res = await fetch(`/api/lab-results/${result.id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, findingIndex: index }),
      });
      if (!res.ok) throw await apiError(res, "Failed to resolve mismatch");
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyIndex(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900 truncate">{testDescription}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {result.labName ? result.labName.toUpperCase() : "Unknown lab"}
            {result.labReportNumber ? ` · Report #${result.labReportNumber}` : ""}
            {result.source === "pdf_upload" ? " · Extracted from PDF" : result.source === "hl7_webhook" ? " · via HL7" : ""}
          </p>
        </div>
        <div
          className={`shrink-0 px-3 py-1 rounded-full border text-xs font-semibold ${status.className}`}
        >
          {status.label}
        </div>
      </div>

      {/* Dates line */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
        <span>
          <span className="text-gray-400">Collected:</span> {formatDate(result.reportedCollectionDate)}
        </span>
        <span>
          <span className="text-gray-400">Received at lab:</span> {formatDate(result.receivedAtLab)}
        </span>
        <span>
          <span className="text-gray-400">Reported:</span> {formatDate(result.reportDate)}
        </span>
        {result.mroVerificationDate && (
          <span>
            <span className="text-gray-400">MRO verified:</span> {formatDate(result.mroVerificationDate)}
          </span>
        )}
        <span>
          <span className="text-gray-400">Received by us:</span> {formatDate(result.receivedByUs)}
        </span>
      </div>

      {/* Mismatch banner */}
      {unresolvedMismatches.length > 0 && (
        <div className="mb-4 border-l-4 border-amber-500 bg-amber-50 rounded-r-md p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-700 font-semibold text-sm">
              ⚠ {unresolvedMismatches.length} mismatch{unresolvedMismatches.length === 1 ? "" : "es"} need review
            </span>
          </div>
          {mismatches.map((m, i) => {
            if (m.resolved) return null;
            return (
              <div key={i} className="text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${severityBadge(m.severity)}`}>
                    {m.severity.toUpperCase()}
                  </span>
                  <span className="font-semibold">{m.type.replace("_", " ")}</span>
                </div>
                <div className="pl-2">
                  <div>
                    <span className="text-gray-500">What we have:</span> {m.ourValue}
                  </div>
                  <div>
                    <span className="text-gray-500">What the lab says:</span> {m.theirValue}
                  </div>
                  <div className="italic text-gray-600 mt-1">{m.message}</div>
                </div>
                <div className="flex gap-2 pl-2 pt-1">
                  {m.type === "collection_date" && (
                    <button
                      onClick={() => resolveMismatch(i, "accept_theirs")}
                      disabled={busyIndex === i}
                      className="px-3 py-1 bg-white text-amber-800 border border-amber-300 rounded text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
                    >
                      Accept lab's date
                    </button>
                  )}
                  <button
                    onClick={() => resolveMismatch(i, "keep_ours")}
                    disabled={busyIndex === i}
                    className="px-3 py-1 bg-white text-gray-700 border border-gray-300 rounded text-xs font-medium hover:bg-gray-100 disabled:opacity-50"
                  >
                    Keep ours
                  </button>
                  <button
                    onClick={() => resolveMismatch(i, "flag")}
                    disabled={busyIndex === i}
                    className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    Flag for investigation
                  </button>
                </div>
              </div>
            );
          })}
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}

      {/* Analyte table (collapsed by default for clean negatives) */}
      {analytes.length > 0 && shouldCollapse && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-md px-3 py-2">
          <p className="text-xs text-green-800 font-medium">
            ✓ All {analytes.length} substances tested negative
          </p>
          <button
            onClick={() => setShowAnalytes(true)}
            className="text-xs text-green-700 hover:text-green-900 hover:underline font-medium"
          >
            Show analytes
          </button>
        </div>
      )}
      {analytes.length > 0 && !shouldCollapse && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-1.5 pr-3 font-medium">Analyte</th>
                <th className="py-1.5 pr-3 font-medium">Cutoff</th>
                <th className="py-1.5 pr-3 font-medium">Value</th>
                <th className="py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {analytes.map((a, i) => (
                <tr key={i} className={`border-b border-gray-100 ${analyteRowStyle(a.result)}`}>
                  <td className="py-1.5 pr-3">{a.name}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{a.cutoff || "—"}</td>
                  <td className="py-1.5 pr-3">{a.value || "—"}</td>
                  <td className="py-1.5 font-medium uppercase">{a.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isCleanNegative && (
            <button
              onClick={() => setShowAnalytes(false)}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700 hover:underline"
            >
              Hide analytes
            </button>
          )}
        </div>
      )}

      {analytes.length === 0 && result.overallStatus === "pending" && (
        <p className="text-xs text-gray-500 italic">
          No structured data was extracted from this PDF. The narrative summary may still be available in the Result Summaries section below, and the source PDF is always linked in Documents.
        </p>
      )}

      {/* Specimen validity (urine) */}
      {result.specimenValidity && (result.specimenValidity.creatinine || result.specimenValidity.ph || result.specimenValidity.status) && (
        <div className="mt-3 text-xs text-gray-600">
          <span className="text-gray-400">Specimen validity:</span>{" "}
          {result.specimenValidity.status || "—"}
          {result.specimenValidity.creatinine ? ` · creatinine ${result.specimenValidity.creatinine}` : ""}
          {result.specimenValidity.ph ? ` · pH ${result.specimenValidity.ph}` : ""}
        </div>
      )}
    </div>
  );
}
