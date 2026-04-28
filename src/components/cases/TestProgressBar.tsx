"use client";

import { needsStaffSelection } from "@/lib/case-utils";

const STANDARD_STEPS = [
  { key: "order_created", label: "Ordered" },
  { key: "specimen_collected", label: "Collected" },
  { key: "sent_to_lab", label: "Sent to Lab" },
  { key: "results_received", label: "Lab Results" },
  { key: "results_released", label: "Lab Released" },
];

const MRO_STEPS = [
  ...STANDARD_STEPS,
  { key: "at_mro", label: "At MRO" },
  { key: "mro_released", label: "MRO Released" },
];

const MRO_STATUSES = ["at_mro", "mro_released"];

const SPECIAL_STATUSES: Record<string, { label: string; color: string }> = {
  no_show: { label: "No Show", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
  closed: { label: "Test Closed", color: "bg-gray-200 text-gray-600" },
  specimen_held: { label: "Held", color: "bg-amber-100 text-amber-700" },
  results_held: { label: "Results Held — Payment Required", color: "bg-amber-100 text-amber-700" },
};

type Props = {
  currentStatus: string;
  testCatalogId?: string | null;
  caseId?: string;
  testOrderId?: string;
  testDescription?: string;
  hasMroHistory?: boolean;
  onUpdated?: () => void;
};

export function TestProgressBar({ currentStatus, testCatalogId, caseId, testOrderId, testDescription, hasMroHistory, onUpdated }: Props) {
  const isSweatPatch = testDescription?.toLowerCase().includes("sweat patch");
  // Block progression when the order has no catalog row linked. The
  // banner above each row explains the why; here we just gate the dots.
  const pending = needsStaffSelection({
    testCatalogId: testCatalogId ?? null,
    testStatus: currentStatus,
  });
  // Show MRO steps if the test is currently in MRO, OR if it was closed
  // after going through MRO (closed status loses the MRO context otherwise).
  // The hasMroHistory prop is passed from the parent when the test has an
  // MRO document (correspondence type) uploaded.
  const isMROPath = MRO_STATUSES.includes(currentStatus) || (currentStatus === "closed" && hasMroHistory);
  const baseSteps = isMROPath ? MRO_STEPS : STANDARD_STEPS;
  const steps = isSweatPatch
    ? baseSteps.map((s) =>
        s.key === "order_created" ? { ...s, label: "Patch Applied" }
        : s.key === "specimen_collected" ? { ...s, label: "Patch Removed" }
        : s
      )
    : baseSteps;

  const special = SPECIAL_STATUSES[currentStatus];
  const stepIndex = steps.findIndex((s) => s.key === currentStatus);
  // results_held is at the same position as results_received in the bar
  const effectiveIndex = currentStatus === "closed" ? steps.length
    : currentStatus === "results_held" ? steps.findIndex((s) => s.key === "results_received")
    : stepIndex;

  async function advanceTo(statusKey: string) {
    if (!caseId || !testOrderId) return;
    try {
      const res = await fetch(`/api/cases/${caseId}/test-orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testOrderId, testStatus: statusKey }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated?.();
        // If all tests are closed, prompt to close the case
        if (data.promptCloseCase) {
          const shouldClose = confirm("All tests on this case are now closed.\n\nWould you like to close the case?");
          if (shouldClose) {
            await fetch(`/api/cases/${caseId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ caseStatus: "closed" }),
            });
            onUpdated?.();
          }
        }
      }
    } catch {
      // silent fail — user can retry
    }
  }

  return (
    <div>
      {/* Dots + lines row */}
      <div className="flex items-center">
        {steps.map((step, i) => {
          const isCompleted = effectiveIndex > i;
          const isCurrent = effectiveIndex === i;
          const isNext = effectiveIndex === i - 1;
          const isLast = i === steps.length - 1;
          const canClick = isNext && caseId && testOrderId && !pending;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div
                className={`flex-shrink-0 relative ${
                  canClick ? "cursor-pointer group"
                  : pending && isNext ? "cursor-not-allowed group"
                  : ""
                }`}
                onClick={canClick ? (e) => { e.stopPropagation(); advanceTo(step.key); } : undefined}
                onKeyDown={canClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); advanceTo(step.key); } } : undefined}
                role={canClick ? "button" : undefined}
                tabIndex={canClick ? 0 : undefined}
                title={
                  pending && isNext
                    ? undefined
                    : canClick ? `Click to advance to ${step.label}` : step.label
                }
              >
                <div
                  className={`rounded-full transition-all ${
                    isCurrent
                      ? "w-3 h-3 ring-2 ring-offset-1 ring-blue-400 bg-blue-600"
                      : isCompleted
                      ? "w-2 h-2 bg-blue-600"
                      : canClick
                      ? "w-2 h-2 bg-gray-300 group-hover:bg-blue-400 group-hover:w-2.5 group-hover:h-2.5 group-hover:ring-2 group-hover:ring-blue-200"
                      : "w-2 h-2 bg-gray-300"
                  }`}
                />
                {pending && isNext && (
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 hidden group-hover:block whitespace-nowrap bg-gray-900 text-white text-xs rounded px-2 py-1 shadow-lg pointer-events-none">
                    Select a test before advancing this order.
                  </span>
                )}
              </div>
              {!isLast && (
                <div className={`flex-1 h-[1.5px] mx-0.5 ${isCompleted ? "bg-blue-500" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>
      {/* Labels row */}
      <div className="flex justify-between mt-1">
        {steps.map((step, i) => {
          const isCompleted = effectiveIndex > i;
          const isCurrent = effectiveIndex === i;
          const isNext = effectiveIndex === i - 1;
          const canClick = isNext && caseId && testOrderId && !pending;
          return (
            <span
              key={step.key}
              className={`text-[8px] leading-tight text-center flex-1 ${
                isCurrent ? "font-bold text-blue-700"
                : isCompleted ? "text-blue-600 font-medium"
                : canClick ? "text-gray-400 cursor-pointer hover:text-blue-600"
                : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
          );
        })}
      </div>
      {/* Special status badge */}
      {special && stepIndex === -1 && currentStatus !== "closed" && currentStatus !== "results_held" && (
        <div className="mt-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${special.color}`}>
            {special.label}
          </span>
        </div>
      )}
      {/* Results Held badge */}
      {currentStatus === "results_held" && (
        <div className="mt-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
            ⚠ Results Held — Payment Required
          </span>
        </div>
      )}
      {/* After results released — only option is to close the test (MRO decision was made earlier) */}
      {currentStatus === "results_released" && caseId && testOrderId && (
        <div className="mt-2">
          <button
            onClick={(e) => { e.stopPropagation(); advanceTo("closed"); }}
            className="w-full px-2 py-1.5 text-[10px] font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Close Test
          </button>
        </div>
      )}
    </div>
  );
}
