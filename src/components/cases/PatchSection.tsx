"use client";

import { useState } from "react";
import {
  formatChicagoMediumDate,
  formatChicagoShortDate,
} from "@/lib/dateChicago";
import {
  patchLifecycleStatus,
  wearBadgeFor,
  type PatchLifecycleStatus,
} from "@/lib/patchValidation";
import { CancelPatchModal } from "@/components/cases/CancelPatchModal";
import { PendingSelectionBanner } from "@/components/cases/PendingSelectionBanner";
import { ConfirmTestModal } from "@/components/cases/ConfirmTestModal";
import { TestOrderDocuments, type DocSlot } from "@/components/cases/TestOrderDocuments";
import { needsStaffSelection } from "@/lib/case-utils";

/**
 * Sweat-patch lifecycle section for the case detail view. Renders only
 * the patch-bearing TestOrders, separated from the generic Test Orders
 * list. Each row shows the workflow lifecycle badge (WORN/AT_LAB/
 * COMPLETE/CANCELLED) plus, for WORN patches, the wear-overdue chip.
 *
 * Two badge sources:
 *   - patchLifecycleStatus(...) → workflow position (badge label/color)
 *   - wearBadgeFor(...)         → wear-overdue band (chip color)
 *
 * They answer different questions and both render. See patchValidation.ts.
 */

// Shape we receive from the case API — matches the page's CaseData
// testOrders[].patchDetails type. Kept loose here (string ISO dates,
// nullable everywhere) because Prisma's serialization to JSON
// stringifies dates and the page hasn't deserialized them.
export type PatchOrderForUI = {
  id: string;
  testCatalogId: string | null;
  testDescription: string;
  specimenId: string | null;
  lab: string;
  testStatus: string;
  documents: Array<{
    id: string;
    documentType: string;
    fileName: string;
    uploadedAt: string;
  }>;
  labResults?: Array<{ id: string; receivedByUs: string }>;
  patchDetails: {
    id: string;
    panel: "WA07" | "WC82";
    applicationDate: string | null;
    removalDate: string | null;
    cancellationKind:
      | "cancelled"
      | "lab_cancelled"
      | "expired"
      | null;
    cancelledAt: string | null;
    executedDocumentId: string | null;
    workingCopyDocumentId: string | null;
    replacementPatchApplied: boolean | null;
    replacementPatchDate: string | null;
  } | null;
};

type Props = {
  caseId: string;
  // Split upstream in page.tsx using isPatchClosed so the count in the
  // header and the toggle behavior parallel the non-patch Test Orders
  // list (see page.tsx — nonPatchActive / nonPatchClosed).
  patchActive: PatchOrderForUI[];
  patchClosed: PatchOrderForUI[];
  onChanged: () => void; // parent reloads case data
  onEdit: (testOrderId: string) => void; // parent opens EditTestOrderModal
};

export function PatchSection({
  caseId,
  patchActive,
  patchClosed,
  onChanged,
  onEdit,
}: Props) {
  const [cancellingPatchId, setCancellingPatchId] = useState<string | null>(
    null,
  );
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(
    null,
  );
  const [reportError, setReportError] = useState<string | null>(null);
  const [confirmingTestOrderId, setConfirmingTestOrderId] = useState<string | null>(null);
  // Mirror non-patch Test Orders toggle (page.tsx — showClosedTests).
  // Default collapsed so the closed history doesn't dominate the view.
  const [showClosed, setShowClosed] = useState(false);

  if (patchActive.length === 0 && patchClosed.length === 0) return null;

  // Active: ascending by applicationDate (oldest first); orders without
  // an applicationDate sort to the end (typically just-created orders
  // that haven't been applied yet).
  const sortedActive = [...patchActive].sort((a, b) => {
    const aTs = a.patchDetails?.applicationDate
      ? new Date(a.patchDetails.applicationDate).getTime()
      : Number.POSITIVE_INFINITY;
    const bTs = b.patchDetails?.applicationDate
      ? new Date(b.patchDetails.applicationDate).getTime()
      : Number.POSITIVE_INFINITY;
    return aTs - bTs;
  });

  // Closed: descending by applicationDate (most recent first) — the
  // non-patch list doesn't apply a specific sort to its closed
  // sublist, so this is the choice we're making for patches.
  // Application-less rows sort to the end (same tail convention as the
  // active list).
  const sortedClosed = [...patchClosed].sort((a, b) => {
    const aTs = a.patchDetails?.applicationDate
      ? new Date(a.patchDetails.applicationDate).getTime()
      : Number.NEGATIVE_INFINITY;
    const bTs = b.patchDetails?.applicationDate
      ? new Date(b.patchDetails.applicationDate).getTime()
      : Number.NEGATIVE_INFINITY;
    return bTs - aTs;
  });

  const closedIds = new Set(patchClosed.map((o) => o.id));
  const rowsToRender = showClosed
    ? [...sortedActive, ...sortedClosed]
    : sortedActive;

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">
          Sweat patches ({patchActive.length}
          {patchClosed.length > 0 ? ` · ${patchClosed.length} closed` : ""})
        </h3>
      </div>
      <div className="divide-y divide-gray-100">
        {sortedActive.length === 0 && (
          <div className="px-6 py-6 text-center text-gray-400 text-sm">
            No active patches
          </div>
        )}
        {rowsToRender.map((order) => (
          <PatchRow
            key={order.id}
            order={order}
            caseId={caseId}
            dimmed={closedIds.has(order.id)}
            onChanged={onChanged}
            onCancelClick={() => setCancellingPatchId(order.patchDetails?.id ?? null)}
            onConfirmClick={() => setConfirmingTestOrderId(order.id)}
            onEdit={() => onEdit(order.id)}
            onGenerateReport={async () => {
              if (!order.patchDetails) return;
              setGeneratingReportId(order.patchDetails.id);
              setReportError(null);
              try {
                const res = await fetch(
                  `/api/cases/${caseId}/cancellation-report`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      patchDetailsId: order.patchDetails.id,
                    }),
                  },
                );
                if (res.ok) {
                  window.dispatchEvent(new Event("refreshReminders"));
                  onChanged();
                } else {
                  const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                  };
                  setReportError(
                    data.error ?? "Failed to generate cancellation notice",
                  );
                }
              } catch (e) {
                setReportError(
                  e instanceof Error ? e.message : "Network error",
                );
              } finally {
                setGeneratingReportId(null);
              }
            }}
            generating={generatingReportId === order.patchDetails?.id}
          />
        ))}
        {patchClosed.length > 0 && (
          <div className="px-6 py-2 bg-gray-50 text-center">
            <button
              onClick={() => setShowClosed((v) => !v)}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              {showClosed ? "Hide" : "Show"} {patchClosed.length} closed patch
              {patchClosed.length === 1 ? "" : "es"}
            </button>
          </div>
        )}
      </div>
      {reportError && (
        <div className="px-6 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700">
          {reportError}
        </div>
      )}

      {cancellingPatchId &&
        (() => {
          const target =
            patchActive.find(
              (o) => o.patchDetails?.id === cancellingPatchId,
            ) ??
            patchClosed.find(
              (o) => o.patchDetails?.id === cancellingPatchId,
            );
          if (!target?.patchDetails) return null;
          return (
            <CancelPatchModal
              patchDetailsId={target.patchDetails.id}
              applicationDate={target.patchDetails.applicationDate}
              specimenId={target.specimenId}
              onCancelled={onChanged}
              onClose={() => setCancellingPatchId(null)}
            />
          );
        })()}

      {confirmingTestOrderId &&
        (() => {
          const target =
            patchActive.find((o) => o.id === confirmingTestOrderId) ??
            patchClosed.find((o) => o.id === confirmingTestOrderId);
          if (!target) return null;
          return (
            <ConfirmTestModal
              caseId={caseId}
              testOrderId={target.id}
              specimenType="sweat_patch"
              onConfirmed={() => {
                setConfirmingTestOrderId(null);
                onChanged();
              }}
              onClose={() => setConfirmingTestOrderId(null)}
            />
          );
        })()}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Individual patch row
// ─────────────────────────────────────────────────────────────────────

function PatchRow({
  order,
  caseId,
  dimmed,
  onChanged,
  onCancelClick,
  onConfirmClick,
  onEdit,
  onGenerateReport,
  generating,
}: {
  order: PatchOrderForUI;
  caseId: string;
  // Mirrors the non-patch closed-row treatment (page.tsx:425 — opacity-60).
  // Per-row affordances stay clickable; the rule is presentation-only.
  dimmed?: boolean;
  onChanged: () => void;
  onCancelClick: () => void;
  onConfirmClick: () => void;
  onEdit: () => void;
  onGenerateReport: () => void;
  generating: boolean;
}) {
  const pd = order.patchDetails;
  const lifecycle: PatchLifecycleStatus | null = pd
    ? patchLifecycleStatus({
        applicationDate: pd.applicationDate ? new Date(pd.applicationDate) : null,
        cancellationKind: pd.cancellationKind ?? null,
        executedDocumentId: pd.executedDocumentId,
        hasLabResult: (order.labResults?.length ?? 0) > 0,
      })
    : null;

  const wearBadge =
    pd && lifecycle === "WORN"
      ? wearBadgeFor(
          {
            applicationDate: pd.applicationDate
              ? new Date(pd.applicationDate)
              : null,
            removalDate: pd.removalDate ? new Date(pd.removalDate) : null,
            cancellationKind: pd.cancellationKind ?? null,
            cancelledAt: pd.cancelledAt ? new Date(pd.cancelledAt) : null,
          },
          new Date(),
        )
      : null;

  const hasCancellationDoc = order.documents.some(
    (d) => d.documentType === "cancellation_notice",
  );

  return (
    <div className={`px-6 py-4 ${dimmed ? "opacity-60" : ""}`}>
      {needsStaffSelection({ testCatalogId: order.testCatalogId, testStatus: order.testStatus }) && (
        <PendingSelectionBanner />
      )}
      {needsStaffSelection({ testCatalogId: order.testCatalogId, testStatus: order.testStatus }) && (
        <button
          type="button"
          onClick={onConfirmClick}
          className="text-xs font-medium text-white bg-[#1e3a5f] hover:bg-[#2a5490] px-3 py-1 rounded-lg mb-2"
        >
          Confirm test
        </button>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            {needsStaffSelection({ testCatalogId: order.testCatalogId, testStatus: order.testStatus }) && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-medium text-xs rounded-full">
                Pending staff selection
              </span>
            )}
            {order.specimenId && (
              <span className="font-mono font-semibold text-gray-900 text-sm">
                {order.specimenId}
              </span>
            )}
            <span className="text-xs text-gray-500">
              {pd?.panel ?? "—"} · {order.lab.replace("_", "/")}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {pd?.applicationDate
              ? `Applied ${formatChicagoMediumDate(new Date(pd.applicationDate))}`
              : "Not yet applied"}
          </p>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {lifecycle && <LifecycleBadge status={lifecycle} />}
            {wearBadge && wearBadge.kind === "wearing" && (
              <WearChip days={wearBadge.days} status={wearBadge.status} />
            )}
            <SubtitleForStatus order={order} lifecycle={lifecycle} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {lifecycle === "WORN" && (
            <button
              type="button"
              onClick={onCancelClick}
              className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 font-medium"
            >
              Cancel patch
            </button>
          )}
          {lifecycle === "CANCELLED" && (
            <button
              type="button"
              onClick={onGenerateReport}
              disabled={generating}
              className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium disabled:opacity-50"
            >
              {generating
                ? "Generating…"
                : hasCancellationDoc
                  ? "Regenerate cancellation notice"
                  : "Generate cancellation notice"}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
          >
            Edit
          </button>
        </div>
      </div>
      <TestOrderDocuments
        caseId={caseId}
        testOrderId={order.id}
        documents={order.documents}
        onUpdated={onChanged}
        slots={buildPatchDocSlots(order.documents)}
      />
    </div>
  );
}

// Patch-specific document slots. The PharmChek workflow uses two
// distinct CoCs for the same physical form: an application-time partial
// CoC and a removal-time fully-completed CoC. The Legacy CoC row is
// only included when the test order still has a pre-split single
// chain_of_custody document attached — new patches never produce one,
// so the row stays hidden in steady state.
function buildPatchDocSlots(
  documents: PatchOrderForUI["documents"],
): DocSlot[] {
  const hasLegacyCoc = documents.some(
    (d) => d.documentType === "chain_of_custody",
  );
  return [
    { type: "coc_application", label: "Application CoC", icon: "🔗" },
    { type: "coc_removal", label: "Removal CoC", icon: "🔗" },
    ...(hasLegacyCoc
      ? [{ type: "chain_of_custody", label: "Legacy CoC", icon: "📜" }]
      : []),
    { type: "result_report", label: "Results", icon: "🧪" },
    { type: "correspondence", label: "MRO", icon: "👨‍⚕️" },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Badges + chips
// ─────────────────────────────────────────────────────────────────────

const LIFECYCLE_STYLES: Record<
  PatchLifecycleStatus,
  { bg: string; text: string; label: string }
> = {
  WORN: { bg: "bg-[#1e3a5f]", text: "text-white", label: "Worn" },
  AT_LAB: { bg: "bg-[#4338ca]", text: "text-white", label: "At Lab" },
  COMPLETE: { bg: "bg-[#059669]", text: "text-white", label: "Complete" },
  CANCELLED: { bg: "bg-[#475569]", text: "text-white", label: "Cancelled" },
};

function LifecycleBadge({ status }: { status: PatchLifecycleStatus }) {
  const s = LIFECYCLE_STYLES[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

function WearChip({
  days,
  status,
}: {
  days: number;
  status: "neutral" | "yellow" | "orange" | "red";
}) {
  const dayLabel = `${days} ${days === 1 ? "day" : "days"}`;
  let cls = "bg-gray-100 text-gray-700";
  let suffix = "";
  if (status === "yellow") {
    cls = "bg-yellow-100 text-yellow-800";
    suffix = " · approaching removal";
  } else if (status === "orange") {
    cls = "bg-orange-100 text-orange-800";
    suffix = " · overdue";
  } else if (status === "red") {
    cls = "bg-red-100 text-red-800";
    suffix = " · expired";
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}
    >
      {dayLabel}
      {suffix}
    </span>
  );
}

function SubtitleForStatus({
  order,
  lifecycle,
}: {
  order: PatchOrderForUI;
  lifecycle: PatchLifecycleStatus | null;
}) {
  const pd = order.patchDetails;
  if (!pd) return null;

  if (lifecycle === "AT_LAB") {
    return (
      <span className="text-xs text-gray-500">
        {pd.removalDate
          ? `Removed ${formatChicagoShortDate(new Date(pd.removalDate))}`
          : "Awaiting CoC"}
      </span>
    );
  }
  if (lifecycle === "COMPLETE") {
    // The page query already pulls receivedByUs on each LabResult; show
    // the date from the most recent row (the API orders by receivedByUs
    // desc, so labResults[0] is latest). Fall back to a date-less label
    // when the field is null on the latest row rather than rendering a
    // blank — null can happen on legacy rows pre-receivedByUs default.
    const latest = order.labResults?.[0];
    if (latest?.receivedByUs) {
      return (
        <span className="text-xs text-gray-500">
          Results received {formatChicagoShortDate(new Date(latest.receivedByUs))}
        </span>
      );
    }
    return <span className="text-xs text-gray-500">Results received</span>;
  }
  if (lifecycle === "CANCELLED") {
    const cancelledStr = pd.cancelledAt
      ? formatChicagoShortDate(new Date(pd.cancelledAt))
      : null;
    let replacementClause: string;
    if (pd.replacementPatchApplied === true && pd.replacementPatchDate) {
      replacementClause = `A replacement patch was applied ${formatChicagoShortDate(new Date(pd.replacementPatchDate))}`;
    } else if (pd.replacementPatchApplied === false) {
      replacementClause = "No replacement applied";
    } else {
      replacementClause = "";
    }
    return (
      <span className="text-xs text-gray-500">
        {cancelledStr ? `Cancelled ${cancelledStr}` : "Cancelled"}
        {replacementClause && ` · ${replacementClause}`}
      </span>
    );
  }
  return null;
}
