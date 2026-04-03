/**
 * Generate a case number in the format TTL-FL-YYYY-NNNN
 */
export function generateCaseNumber(sequenceNumber: number): string {
  const year = new Date().getFullYear();
  const paddedNum = String(sequenceNumber).padStart(4, "0");
  return `TTL-FL-${year}-${paddedNum}`;
}

/**
 * Case status display labels and colors
 */
export const CASE_STATUS_CONFIG = {
  intake: { label: "Open", color: "bg-green-100 text-green-700", icon: "activity" },
  order_received: { label: "Open", color: "bg-green-100 text-green-700", icon: "activity" },
  active: { label: "Open", color: "bg-green-100 text-green-700", icon: "activity" },
  on_hold: { label: "Open", color: "bg-green-100 text-green-700", icon: "activity" },
  closed: { label: "Closed", color: "bg-gray-200 text-gray-500", icon: "check-circle" },
} as const;

/**
 * Test status display labels and colors
 */
export const TEST_STATUS_CONFIG = {
  order_created: { label: "Order Created", color: "bg-gray-100 text-gray-700" },
  awaiting_payment: { label: "Awaiting Payment", color: "bg-orange-100 text-orange-700" },
  payment_received: { label: "Payment Received", color: "bg-green-100 text-green-700" },
  specimen_collected: { label: "Specimen Collected", color: "bg-indigo-100 text-indigo-700" },
  results_received: { label: "Results Received", color: "bg-teal-100 text-teal-700" },
  results_released: { label: "Results Released", color: "bg-green-100 text-green-700" },
  at_mro: { label: "At MRO", color: "bg-purple-100 text-purple-700" },
  closed: { label: "Closed", color: "bg-gray-200 text-gray-500" },
  no_show: { label: "No Show", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
} as const;

/**
 * Family Law test status flow:
 * Order Created → Awaiting Payment → Payment Received → Specimen Collected →
 * Results Received → Results Released → At MRO (if needed)
 *
 * MRO comes AFTER results are released (family law specific)
 */
export const TEST_STATUS_FLOW: Record<string, string[]> = {
  order_created: ["specimen_collected", "no_show", "cancelled"],
  specimen_collected: ["results_received", "cancelled"],
  results_received: ["results_released"],
  results_released: ["at_mro", "closed"],
  at_mro: ["closed"],
  closed: [],
  no_show: ["order_created"],
  cancelled: [],
};

/**
 * Case type display labels
 */
export const CASE_TYPE_CONFIG = {
  court_ordered: { label: "Court Ordered", color: "bg-blue-100 text-blue-800", icon: "gavel" },
  voluntary: { label: "Voluntary", color: "bg-green-100 text-green-800", icon: "hand" },
  by_agreement: { label: "By Agreement", color: "bg-yellow-100 text-yellow-800", icon: "handshake" },
} as const;

/**
 * Payment status display
 */
export const PAYMENT_STATUS_CONFIG = {
  unpaid: { label: "Unpaid", color: "bg-red-100 text-red-700" },
  partial: { label: "Partial", color: "bg-orange-100 text-orange-700" },
  paid: { label: "Paid", color: "bg-green-100 text-green-700" },
  invoiced: { label: "Invoiced", color: "bg-blue-100 text-blue-700" },
} as const;
