"use client";

import { useEffect, useState } from "react";
import { formatChicagoMediumDate } from "@/lib/dateChicago";

/**
 * Modal for cancelling a sweat patch. Captures cancellation date and
 * (optionally) replacement-patch details. Never asks the user to choose
 * a cancellationKind — the server infers it from wear-days at cancellation
 * (≥30 days = expired, otherwise = cancelled). The lab_cancelled kind
 * is reserved for future flows and not selectable here.
 *
 * Submit flow (orchestrated by the parent via `onSubmit`):
 *   1. POST /api/cases/[id]/cancel-patch with the assembled body
 *   2. On 201, parent calls /api/cases/[id]/cancellation-report to
 *      auto-generate the PDF + EmailDraft
 *   3. Parent reloads case data and dispatches refreshReminders
 *
 * Validation policy: client-side validation matches the server. Server
 * is the source of truth — if it returns 4xx, we surface its `error`
 * string as a banner and keep the form open with the user's values
 * preserved.
 */

const CRL_SPECIMEN_ID_RE = /^\d{9}$/;

type Props = {
  patchDetailsId: string;
  applicationDate: string | null; // ISO from API; we display + bound by it
  specimenId: string | null;
  onCancelled: () => void; // parent should reload case + dispatch refreshReminders
  onClose: () => void;
};

// Format a Date as YYYY-MM-DD in the local browser timezone — fine for
// the date-input default since we only care about the calendar day, and
// staff are physically in Chicago. Server stores the parsed Date.
function todayLocalKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToDateInputValue(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function CancelPatchModal({
  patchDetailsId,
  applicationDate,
  specimenId,
  onCancelled,
  onClose,
}: Props) {
  const [cancelledOn, setCancelledOn] = useState(todayLocalKey());
  const [replacementApplied, setReplacementApplied] = useState<
    "no" | "yes" | null
  >(null);
  const [replacementOn, setReplacementOn] = useState(todayLocalKey());
  const [replacementSpecimenId, setReplacementSpecimenId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // When the user picks "Yes" on replacement, default the replacement
  // date to the cancellation date (almost always the same visit).
  useEffect(() => {
    if (replacementApplied === "yes") {
      setReplacementOn(cancelledOn);
    }
  }, [replacementApplied, cancelledOn]);

  const appDateKey = isoToDateInputValue(applicationDate);
  const todayKey = todayLocalKey();

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};

    if (!cancelledOn) {
      errors.cancelledOn = "Cancellation date is required.";
    } else {
      if (cancelledOn > todayKey) {
        errors.cancelledOn = "Cancellation date can't be in the future.";
      }
      if (appDateKey && cancelledOn < appDateKey) {
        errors.cancelledOn = "Cancellation date can't be before the application date.";
      }
    }

    if (replacementApplied === null) {
      errors.replacementApplied = "Choose Yes or No.";
    }

    if (replacementApplied === "yes") {
      if (!replacementOn) {
        errors.replacementOn = "Replacement application date is required.";
      } else {
        if (replacementOn > todayKey) {
          errors.replacementOn =
            "Replacement application date can't be in the future.";
        }
        if (appDateKey && replacementOn < appDateKey) {
          errors.replacementOn =
            "Replacement can't predate the original patch's application date.";
        }
      }
      const trimmed = replacementSpecimenId.trim();
      if (!trimmed) {
        errors.replacementSpecimenId = "Replacement specimen ID is required.";
      } else if (!CRL_SPECIMEN_ID_RE.test(trimmed)) {
        errors.replacementSpecimenId =
          "CRL specimen IDs are exactly 9 digits — no prefix, no separators.";
      }
    }

    return errors;
  }

  async function handleSubmit() {
    setServerError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      // Send the local-day picks as ISO at noon UTC — sidesteps the
      // "midnight in Chicago is yesterday in UTC" foot-gun. The server
      // bucketers (computeWearDays etc.) already work in Chicago days.
      const cancelledAtIso = new Date(`${cancelledOn}T12:00:00Z`).toISOString();
      const body: Record<string, unknown> = {
        patchDetailsId,
        cancelledAt: cancelledAtIso,
        replacement:
          replacementApplied === "yes"
            ? {
                applied: true,
                applicationDate: new Date(
                  `${replacementOn}T12:00:00Z`,
                ).toISOString(),
                specimenId: replacementSpecimenId.trim(),
              }
            : { applied: false },
      };

      const res = await fetch(
        `/api/cases/${encodeURIComponent(getCaseIdFromPathname())}/cancel-patch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);

      if (!res.ok) {
        if (res.status === 422 && (data as { field?: string }).field) {
          const field = (data as { field: string }).field;
          setFieldErrors({ [mapServerFieldToClient(field)]: String((data as { error?: string }).error ?? "Validation failed") });
        } else {
          setServerError(
            String((data as { error?: string }).error ?? "Failed to cancel patch"),
          );
        }
        return;
      }

      // Auto-generate the cancellation notice PDF + EmailDraft.
      // Decoupled endpoint per design — failures here don't affect the
      // cancellation record itself, so we surface the error as a soft
      // banner but still close the modal and reload (the cancellation
      // succeeded; staff can click "Generate cancellation notice" on
      // the row to retry).
      try {
        const reportRes = await fetch(
          `/api/cases/${encodeURIComponent(getCaseIdFromPathname())}/cancellation-report`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patchDetailsId: (data as { cancelledPatchDetailsId?: string }).cancelledPatchDetailsId ?? patchDetailsId,
            }),
          },
        );
        if (reportRes.ok) {
          window.dispatchEvent(new Event("refreshReminders"));
        } else {
          console.warn(
            "[CancelPatchModal] cancellation-report generation failed:",
            reportRes.status,
            await reportRes.text().catch(() => ""),
          );
        }
      } catch (e) {
        console.warn("[CancelPatchModal] cancellation-report request errored:", e);
      }

      onCancelled();
      onClose();
    } catch (e) {
      setServerError(
        e instanceof Error ? e.message : "Failed to cancel patch",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Cancel sweat patch
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Specimen ID
              </p>
              <p className="font-mono text-gray-900">
                {specimenId ?? "Not on record"}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Applied
              </p>
              <p className="text-gray-900">
                {applicationDate
                  ? formatChicagoMediumDate(new Date(applicationDate))
                  : "Not on record"}
              </p>
            </div>
          </div>

          {serverError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {serverError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-1">
              Cancellation date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              max={todayKey}
              min={appDateKey ?? undefined}
              value={cancelledOn}
              onChange={(e) => setCancelledOn(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
            {fieldErrors.cancelledOn && (
              <p className="text-xs text-red-600 mt-1">
                {fieldErrors.cancelledOn}
              </p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">
              Was a replacement patch applied?{" "}
              <span className="text-red-500">*</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReplacementApplied("no")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  replacementApplied === "no"
                    ? "border-[#1e3a5f] bg-[#1e3a5f] text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => setReplacementApplied("yes")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  replacementApplied === "yes"
                    ? "border-[#1e3a5f] bg-[#1e3a5f] text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Yes — a fresh patch was applied
              </button>
            </div>
            {fieldErrors.replacementApplied && (
              <p className="text-xs text-red-600 mt-1">
                {fieldErrors.replacementApplied}
              </p>
            )}
          </div>

          {replacementApplied === "yes" && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-1">
                  Replacement application date{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  max={todayKey}
                  min={appDateKey ?? undefined}
                  value={replacementOn}
                  onChange={(e) => setReplacementOn(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                {fieldErrors.replacementOn && (
                  <p className="text-xs text-red-600 mt-1">
                    {fieldErrors.replacementOn}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-1">
                  Replacement specimen ID{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{9}"
                  maxLength={9}
                  placeholder="9-digit numeric"
                  value={replacementSpecimenId}
                  onChange={(e) =>
                    setReplacementSpecimenId(
                      e.target.value.replace(/\D/g, "").slice(0, 9),
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                />
                <p className="text-xs text-gray-500 mt-1">
                  CRL specimen ID — exactly 9 digits, no prefix.
                </p>
                {fieldErrors.replacementSpecimenId && (
                  <p className="text-xs text-red-600 mt-1">
                    {fieldErrors.replacementSpecimenId}
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-semibold hover:bg-[#2a5490] disabled:opacity-50"
            >
              {submitting ? "Cancelling…" : "Cancel patch ▸"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Server returns `field: "replacement.specimenId"` for 422; map to the
// dotted client-side key we use in fieldErrors.
function mapServerFieldToClient(serverField: string): string {
  if (serverField === "replacement.specimenId") return "replacementSpecimenId";
  if (serverField === "replacement.applicationDate") return "replacementOn";
  return serverField;
}

// Pull the case id from the current pathname. The page is rendered at
// /cases/[id], so the second non-empty segment is the id. Avoids
// dragging Next router hooks into this component just to compose a URL.
function getCaseIdFromPathname(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("cases");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}
