"use client";

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
};

type Props = {
  currentStatus: string;
  caseId?: string;
  testOrderId?: string;
  testDescription?: string;
  onUpdated?: () => void;
};

export function TestProgressBar({ currentStatus, caseId, testOrderId, testDescription, onUpdated }: Props) {
  const isSweatPatch = testDescription?.toLowerCase().includes("sweat patch");
  const isMROPath = MRO_STATUSES.includes(currentStatus);
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
  const effectiveIndex = currentStatus === "closed" ? steps.length : stepIndex;

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
      <div className="flex items-center justify-between">
        {steps.map((step, i) => {
          const isCompleted = effectiveIndex > i;
          const isCurrent = effectiveIndex === i;
          const isNext = effectiveIndex === i - 1;
          const isLast = i === steps.length - 1;
          const canClick = isNext && caseId && testOrderId;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div
                className={`flex flex-col items-center ${canClick ? "cursor-pointer group" : ""}`}
                onClick={canClick ? (e) => { e.stopPropagation(); advanceTo(step.key); } : undefined}
                title={canClick ? `Click to advance to ${step.label}` : undefined}
              >
                <div
                  className={`rounded-full flex items-center justify-center transition-all ${
                    isCurrent
                      ? "w-3.5 h-3.5 ring-2 ring-offset-1 ring-blue-400 bg-blue-600"
                      : isCompleted
                      ? "w-2.5 h-2.5 bg-blue-600"
                      : canClick
                      ? "w-2.5 h-2.5 bg-gray-300 group-hover:bg-blue-400 group-hover:w-3 group-hover:h-3 group-hover:ring-2 group-hover:ring-blue-200"
                      : "w-2.5 h-2.5 bg-gray-300"
                  }`}
                />
                <span
                  className={`text-[9px] mt-1 leading-tight text-center transition-colors ${
                    isCurrent ? "font-semibold text-blue-700"
                    : isCompleted ? "text-blue-600"
                    : canClick ? "text-gray-400 group-hover:text-blue-600 group-hover:font-semibold"
                    : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 h-[2px] mx-1 mt-[-12px] ${
                    isCompleted ? "bg-blue-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {special && stepIndex === -1 && currentStatus !== "closed" && (
        <div className="mt-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${special.color}`}>
            {special.label}
          </span>
        </div>
      )}
    </div>
  );
}
