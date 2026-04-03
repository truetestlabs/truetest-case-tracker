"use client";

import { useState } from "react";
import { TEST_STATUS_FLOW, TEST_STATUS_CONFIG } from "@/lib/case-utils";

type Props = {
  caseId: string;
  testOrderId: string;
  currentStatus: string;
  testDescription?: string;
  onUpdated: () => void;
};

const statusButtonColors: Record<string, string> = {
  awaiting_payment: "bg-orange-500 hover:bg-orange-600",
  payment_received: "bg-green-500 hover:bg-green-600",
  order_released: "bg-blue-500 hover:bg-blue-600",
  awaiting_collection: "bg-indigo-500 hover:bg-indigo-600",
  specimen_collected: "bg-indigo-600 hover:bg-indigo-700",
  specimen_held: "bg-amber-500 hover:bg-amber-600",
  sent_to_lab: "bg-purple-500 hover:bg-purple-600",
  at_mro: "bg-purple-600 hover:bg-purple-700",
  results_received: "bg-teal-500 hover:bg-teal-600",
  awaiting_payment_for_release: "bg-orange-500 hover:bg-orange-600",
  results_released: "bg-green-600 hover:bg-green-700",
  cancelled: "bg-red-500 hover:bg-red-600",
  no_show: "bg-red-500 hover:bg-red-600",
  order_created: "bg-gray-500 hover:bg-gray-600",
};

export function TestStatusButtons({ caseId, testOrderId, currentStatus, testDescription, onUpdated }: Props) {
  const isSweatPatch = testDescription?.toLowerCase().includes("sweat patch");
  const [loading, setLoading] = useState(false);

  const nextStatuses = TEST_STATUS_FLOW[currentStatus] || [];

  if (nextStatuses.length === 0) return null;

  async function advanceTo(newStatus: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/test-orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testOrderId, testStatus: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {nextStatuses.map((status) => {
        const config = TEST_STATUS_CONFIG[status as keyof typeof TEST_STATUS_CONFIG];
        const colorClass = statusButtonColors[status] || "bg-gray-500 hover:bg-gray-600";
        return (
          <button
            key={status}
            onClick={() => advanceTo(status)}
            disabled={loading}
            className={`px-2.5 py-1 text-xs font-medium text-white rounded ${colorClass} disabled:opacity-50 transition-colors`}
          >
            {loading ? "..." : `→ ${
              isSweatPatch && status === "order_created" ? "Patch Applied"
              : isSweatPatch && status === "specimen_collected" ? "Patch Removed"
              : config?.label || status
            }`}
          </button>
        );
      })}
    </div>
  );
}
