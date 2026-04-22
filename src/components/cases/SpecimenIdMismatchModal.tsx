"use client";

/**
 * Confirmation modal shown when the specimen ID printed on a CoC PDF does
 * not match the specimen ID on the test record. Staff can confirm the
 * upload anyway (rare but real — e.g., a lab printed a corrected form) or
 * cancel, which aborts the upload and cleans up the orphaned storage file.
 *
 * Follows the overlay pattern used by EditTestOrderModal / EditCaseModal:
 * full-screen dim backdrop with click-to-close, rounded white content box,
 * X button in the header. No shadcn dependency.
 */

type Props = {
  pdfId: string;
  recordId: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SpecimenIdMismatchModal({ pdfId, recordId, onConfirm, onCancel }: Props) {
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
            The specimen ID on the PDF doesn&apos;t match the ID on this test record.
          </p>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">PDF</p>
              <p className="font-mono text-gray-900">{pdfId}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Record</p>
              <p className="font-mono text-gray-900">{recordId}</p>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            If you upload anyway, the mismatch will be recorded in the case history.
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
              onClick={onConfirm}
              className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490]"
            >
              Upload Anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
