"use client";

const STEPS = [
  { key: "order_created", label: "Ordered" },
  { key: "specimen_collected", label: "Collected" },
  { key: "sent_to_lab", label: "Sent to Lab" },
  { key: "results_received", label: "Results" },
  { key: "results_released", label: "Released" },
];

const SPECIAL_STATUSES: Record<string, { label: string; color: string }> = {
  no_show: { label: "No Show", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
  at_mro: { label: "At MRO", color: "bg-purple-100 text-purple-700" },
  closed: { label: "Closed", color: "bg-gray-200 text-gray-600" },
  specimen_held: { label: "Held", color: "bg-amber-100 text-amber-700" },
};

type Props = {
  currentStatus: string;
};

export function TestProgressBar({ currentStatus }: Props) {
  // Check if it's a special status that doesn't fit the linear flow
  const special = SPECIAL_STATUSES[currentStatus];
  const stepIndex = STEPS.findIndex((s) => s.key === currentStatus);

  // For closed, show all steps completed
  const effectiveIndex = currentStatus === "closed" ? STEPS.length : stepIndex;

  return (
    <div>
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isCompleted = effectiveIndex > i;
          const isCurrent = effectiveIndex === i;
          const isFuture = effectiveIndex < i;
          const isLast = i === STEPS.length - 1;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* Step dot */}
              <div className="flex flex-col items-center">
                <div
                  className={`rounded-full flex items-center justify-center ${
                    isCurrent
                      ? "w-3.5 h-3.5 ring-2 ring-offset-1 ring-blue-400 bg-blue-600"
                      : isCompleted
                      ? "w-2.5 h-2.5 bg-blue-600"
                      : "w-2.5 h-2.5 bg-gray-300"
                  }`}
                />
                <span
                  className={`text-[9px] mt-1 leading-tight text-center ${
                    isCurrent ? "font-semibold text-blue-700" : isCompleted ? "text-blue-600" : isFuture ? "text-gray-400" : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {/* Connector line */}
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
      {/* Special status badge (shown below the bar) */}
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
