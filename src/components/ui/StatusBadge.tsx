import { TEST_STATUS_CONFIG, CASE_STATUS_CONFIG, CASE_TYPE_CONFIG, PAYMENT_STATUS_CONFIG } from "@/lib/case-utils";

type BadgeProps = {
  status: string;
  type: "test" | "case" | "caseType" | "payment";
  label?: string;
};

const CONFIG_MAP = {
  test: TEST_STATUS_CONFIG,
  case: CASE_STATUS_CONFIG,
  caseType: CASE_TYPE_CONFIG,
  payment: PAYMENT_STATUS_CONFIG,
} as const;

export function StatusBadge({ status, type, label }: BadgeProps) {
  const config = CONFIG_MAP[type] as Record<string, { label: string; color: string }>;
  const entry = config[status] || { label: status, color: "bg-gray-100 text-gray-600" };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${entry.color}`}>
      {label || entry.label}
    </span>
  );
}

export function CourtOrderFlag({ hasOrder }: { hasOrder: boolean }) {
  return hasOrder ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
      Court Order
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      No Order
    </span>
  );
}
