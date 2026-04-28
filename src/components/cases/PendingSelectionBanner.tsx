"use client";

/**
 * Amber warning banner shown above a TestOrder row when the order has
 * no testCatalogId set — meaning intake/parsing didn't match a real
 * test in the catalog and a staff member needs to pick one before the
 * order can progress.
 *
 * The terminal-status skip (closed/cancelled/no_show) lives at the
 * call site via needsStaffSelection() — this component just renders.
 */
export function PendingSelectionBanner() {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 px-4 py-2 mb-2 text-sm rounded-r">
      <p className="font-medium text-amber-900">
        ⚠ Action required — test selection incomplete
      </p>
      <p className="text-amber-800 mt-0.5">
        Staff must select the correct test before this order can progress.
      </p>
    </div>
  );
}
