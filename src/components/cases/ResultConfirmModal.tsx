"use client";

import type { MismatchFinding } from "@/lib/labResultCrosscheck";

/**
 * Confirmation modal shown after a lab-result PDF is uploaded AND the
 * server's crosschecks against the test order's specimen ID / collection
 * date / lab accession number turned up at least one finding.
 *
 * Clean-match uploads never reach this modal — the server commits silently.
 *
 * Three render modes:
 *   - hasCriticalMismatch === true: red banner + Cancel only. Hard block.
 *     Staff must investigate (wrong test order? wrong file?) and resolve
 *     offline before retrying.
 *   - warnings only: amber "Confirm and save with mismatch noted" button.
 *     Mismatches are persisted to LabResult.mismatches.
 */

type Props = {
  fileName: string;
  extracted: { specimenId: string | null; collectionDate: string | null };
  order: { specimenId: string | null; collectionDate: string | null };
  findings: MismatchFinding[];
  hasCriticalMismatch: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const SEVERITY_STYLES: Record<
  MismatchFinding["severity"],
  { icon: string; color: string; chipBg: string; chipText: string }
> = {
  critical: {
    icon: "✕",
    color: "text-red-700",
    chipBg: "bg-red-100",
    chipText: "text-red-700",
  },
  warning: {
    icon: "!",
    color: "text-amber-700",
    chipBg: "bg-amber-100",
    chipText: "text-amber-700",
  },
  info: {
    icon: "i",
    color: "text-blue-700",
    chipBg: "bg-blue-100",
    chipText: "text-blue-700",
  },
};

export function ResultConfirmModal({
  fileName,
  extracted,
  order,
  findings,
  hasCriticalMismatch,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Review Lab Result Upload
            </h3>
            <button
              type="button"
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          <p className="text-xs text-gray-500 truncate">{fileName}</p>

          {hasCriticalMismatch && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
              <p className="text-sm font-semibold text-red-800">
                Critical mismatch — upload blocked
              </p>
              <p className="text-xs text-red-700 mt-1">
                The lab&apos;s specimen ID does not match the chain of
                custody. This could indicate a specimen mix-up. Cancel this
                upload and investigate before retrying — check that the
                result PDF matches the correct test order, and confirm with
                the lab if needed.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Specimen ID — Lab
                </p>
                <p className="font-mono text-gray-900">
                  {extracted.specimenId ?? "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Specimen ID — Record
                </p>
                <p className="font-mono text-gray-900">
                  {order.specimenId ?? "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Collection date — Lab
                </p>
                <p className="font-mono text-gray-900">
                  {extracted.collectionDate ?? "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Collection date — Record
                </p>
                <p className="font-mono text-gray-900">
                  {order.collectionDate ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {findings.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Findings
              </p>
              <ul className="space-y-2">
                {findings.map((f, i) => {
                  const s = SEVERITY_STYLES[f.severity];
                  return (
                    <li
                      key={i}
                      className="flex gap-2 text-xs items-start"
                    >
                      <span
                        className={`flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full font-bold ${s.chipBg} ${s.chipText}`}
                      >
                        {s.icon}
                      </span>
                      <div className="flex-1">
                        <p className={`font-medium ${s.color}`}>
                          {f.severity.toUpperCase()} — {f.type.replace(/_/g, " ")}
                        </p>
                        <p className="text-gray-700">{f.message}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800"
            >
              Cancel
            </button>
            {!hasCriticalMismatch && (
              <button
                type="button"
                onClick={onConfirm}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
              >
                Confirm and save with mismatch noted
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
