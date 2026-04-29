"use client";

import { useState } from "react";
import { formatChicagoLongDateKey } from "@/lib/dateChicago";

/**
 * Confirmation modal shown after a chain-of-custody PDF is uploaded.
 * Always appears — confirming the AI-extracted collection date is the
 * whole point of this step. Also surfaces a specimen-ID mismatch (when
 * present) so staff can ack both in one place.
 *
 * Follows the overlay pattern used by EditTestOrderModal: full-screen
 * dim backdrop with click-to-close, rounded white content box, X button
 * in the header.
 */

type Props = {
  fileName: string;
  pdfId: string | null;
  recordId: string | null;
  specimenIdMismatch: boolean;
  extractedDate: string | null; // YYYY-MM-DD
  dateSource: "text" | "vision" | null;
  onConfirm: (collectionDate: string) => void;
  onCancel: () => void;
};

export function CocConfirmModal({
  fileName,
  pdfId,
  recordId,
  specimenIdMismatch,
  extractedDate,
  dateSource,
  onConfirm,
  onCancel,
}: Props) {
  const [date, setDate] = useState<string>(extractedDate ?? "");
  const isValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const dateChanged = !!extractedDate && date !== extractedDate;

  // Format the (possibly edited) date in long form so the year is
  // unmissable. The default <input type="date"> rendering ("04/25/2006")
  // makes a wrong-year misread easy to skim past — showing
  // "Saturday, April 25, 2006" alongside it forces the year into view.
  const formattedDate = isValid
    ? formatChicagoLongDateKey(
        new Date(
          Date.UTC(
            parseInt(date.slice(0, 4), 10),
            parseInt(date.slice(5, 7), 10) - 1,
            parseInt(date.slice(8, 10), 10),
            12,
            0,
            0
          )
        )
      )
    : null;

  const currentYear = new Date().getUTCFullYear();
  const dateYear = isValid ? parseInt(date.slice(0, 4), 10) : currentYear;
  const yearMismatch = isValid && dateYear !== currentYear;

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
            <h3 className="text-lg font-semibold text-gray-900">
              Confirm Chain of Custody
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

          {specimenIdMismatch && (
            <div className="space-y-2">
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
                <p className="text-sm font-medium text-red-800">
                  Specimen ID mismatch
                </p>
                <p className="text-xs text-red-700 mt-0.5">
                  The specimen ID on the PDF doesn&apos;t match the ID on this
                  test record. If you confirm, the mismatch is recorded in the
                  case history.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    PDF
                  </p>
                  <p className="font-mono text-gray-900">{pdfId ?? "—"}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Record
                  </p>
                  <p className="font-mono text-gray-900">{recordId ?? "—"}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-900">
                Collection date
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </label>

            {formattedDate && (
              <div
                className={`rounded-md px-3 py-2 ${
                  yearMismatch
                    ? "bg-red-50 border border-red-300"
                    : "bg-gray-50 border border-gray-200"
                }`}
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">
                  Reads as
                </p>
                <p
                  className={`text-base font-semibold ${
                    yearMismatch ? "text-red-800" : "text-gray-900"
                  }`}
                >
                  {formattedDate}
                </p>
                {yearMismatch && (
                  <p className="text-xs text-red-700 mt-1">
                    ⚠ Year ({dateYear}) is not the current year ({currentYear}). Double-check
                    against the PDF before confirming.
                  </p>
                )}
              </div>
            )}

            {extractedDate === null && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2">
                <p className="text-xs text-yellow-800">
                  Could not extract collection date from the PDF. Please type
                  the date from the chain of custody.
                </p>
              </div>
            )}

            {extractedDate !== null && dateSource === "text" && (
              <p className="text-xs text-green-700">
                ✓ AI-extracted from printed text on the form
                {dateChanged && " — edited"}
              </p>
            )}

            {extractedDate !== null && dateSource === "vision" && (
              <p className="text-xs text-amber-700">
                ⚠ AI-extracted via Vision (handwriting) — please verify against
                the PDF{dateChanged && " — edited"}
              </p>
            )}
          </div>

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
              onClick={() => isValid && onConfirm(date)}
              disabled={!isValid}
              className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Confirm and Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
