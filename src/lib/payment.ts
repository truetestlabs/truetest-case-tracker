/**
 * Payment state helpers — paymentMethod is the single source of truth.
 *
 *   paymentMethod === null              → "unpaid"
 *   paymentMethod === "invoiced"        → "invoiced"
 *   paymentMethod === anything else     → "paid" (via that method)
 */

export type PaymentState = "unpaid" | "invoiced" | "paid";

export function getPaymentState(paymentMethod: string | null | undefined): PaymentState {
  if (!paymentMethod) return "unpaid";
  if (paymentMethod === "invoiced") return "invoiced";
  return "paid";
}

export function getPaymentLabel(paymentMethod: string | null | undefined): string {
  const state = getPaymentState(paymentMethod);
  if (state === "unpaid") return "Not Paid";
  if (state === "invoiced") return "Invoiced";
  const method = paymentMethod!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `Paid (${method})`;
}

/** Derive an aggregate payment state for a whole case from its test orders. */
export function getCasePaymentState(
  testOrders: { paymentMethod: string | null }[]
): PaymentState {
  if (testOrders.length === 0) return "unpaid";
  if (testOrders.some((t) => !t.paymentMethod)) return "unpaid";
  if (testOrders.every((t) => t.paymentMethod === "invoiced")) return "invoiced";
  return "paid";
}
