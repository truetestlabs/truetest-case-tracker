"use client";

import { useState } from "react";

/**
 * Confirmation modal shown when the specimen ID printed on a CoC PDF does
 * not match the specimen ID on the test record. Staff enter the correct
 * specimen ID; on confirm the upload proceeds and the corrected ID is
 * written back to the test order.
 *
 * Three signals are surfaced:
 *   - PDF: what Claude Vision read off the barcode/printed field.
 *   - Filename: numeric token at the start of the uploaded filename, if any.
 *     Staff routinely rename CoC PDFs as `<specimen_id> <donor>.pdf`, so
 *     this is a strong tiebreaker when Vision misreads.
 *   - Record: what's already on the test order in the DB.
 *
 * Pre-fill priority: filename if it agrees with record (one-click confirm
 * path), else record (the safe fallback), else empty.
 */

type Props = {
  parsedSpecimenId: string;
  filenameSpecimenId: string | null;
  recordSpecimenId: string;
  onConfirm: (correctedSpecimenId: string) => void;
  onCancel: () => void;
};

export function SpecimenIdMismatchModal({
  parsedSpecimenId,
  filenameSpecimenId,
  recordSpecimenId,
  onConfirm,
  onCancel,
}: Props) {
  // Pre-fill priority:
  //   - filename + record agree → high confidence, use that value
  //   - record empty (typical: order_created status, no specimenId yet) →
  //     trust the filename token; the user named the file deliberately
  //   - record present but disagrees with filename → fall back to record
  //     so the user has to actively replace it, not just confirm
  const initial = (() => {
    if (filenameSpecimenId && filenameSpecimenId === recordSpecimenId) {
      return filenameSpecimenId;
    }
    if (!recordSpecimenId && filenameSpecimenId) {
      return filenameSpecimenId;
    }
    return recordSpecimenId || "";
  })();
  const [value, setValue] = useState(initial);

  const trimmed = value.trim();
  const isValid = /^\d{5,}$/.test(trimmed);

  function handleSubmit() {
    if (!isValid) return;
    onConfirm(trimmed);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Specimen ID Mismatch</h3>
            <button
              type="button"
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          <p className="text-sm text-gray-700">
            The specimen ID Vision read from the PDF doesn&apos;t match this
            test record. Confirm the correct ID and we&apos;ll save it to the
            test order.
          </p>

          <div className="grid grid-cols-3 gap-2 text-sm">
            <IdBox label="PDF" value={parsedSpecimenId} highlight />
            <IdBox
              label="Filename"
              value={filenameSpecimenId ?? "—"}
              highlight={filenameSpecimenId !== null && filenameSpecimenId !== recordSpecimenId}
            />
            <IdBox label="Record" value={recordSpecimenId || "—"} />
          </div>

          <div>
            <label htmlFor="corrected-specimen-id" className="block text-xs font-medium text-gray-700 mb-1">
              Correct specimen ID
            </label>
            <input
              id="corrected-specimen-id"
              type="text"
              inputMode="numeric"
              pattern="\d*"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. 4070522"
            />
          </div>

          <p className="text-xs text-gray-500">
            The mismatch and your correction will be recorded in the case history.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid}
              className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm and Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IdBox({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-red-50 border border-red-200" : "bg-gray-50"}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-mono text-sm ${highlight ? "text-red-900" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}
