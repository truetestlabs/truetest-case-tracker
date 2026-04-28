"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { apiError } from "@/lib/clientErrors";

type TestOrderData = {
  id: string;
  testDescription: string;
  testCatalogId: string | null;
  specimenType: string;
  lab: string;
  testStatus: string;
  collectionType: string;
  schedulingType: string;
  collectionSite: string | null;
  collectionSiteType: string | null;
  specimenId: string | null;
  squarePaymentLink: string | null;
  paymentMethod: string | null;
  clientPrice: string | null;
  invoiceNumber: string | null;
  labAccessionNumber: string | null;
  appointmentDate: string | null;
  collectionDate: string | null;
  notes: string | null;
  // Present only when specimenType === 'sweat_patch'. Null otherwise.
  patchDetails?: { panel: "WA07" | "WC82" } | null;
};

type CatalogItem = {
  id: string;
  category: string;
  testName: string;
  specimenType: string;
  lab: string;
  clientPrice: string;
};

type Props = {
  caseId: string;
  testOrder: TestOrderData;
  onSaved: () => void;
  onClose: () => void;
};

export function EditTestOrderModal({ caseId, testOrder, onSaved, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notifSent, setNotifSent] = useState(false);
  const [changingTest, setChangingTest] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentTest, setCurrentTest] = useState({
    id: testOrder.testCatalogId,
    name: testOrder.testDescription,
    specimenType: testOrder.specimenType,
    lab: testOrder.lab,
    clientPrice: testOrder.clientPrice,
  });
  // Tracked so we can conditionally require the collection-date picker when
  // advancing to specimen_collected. The server also enforces this (the
  // PATCH returns 400 if collectionDate is missing), but blocking submit
  // on the client is a cleaner UX than a round-trip error.
  const [currentStatus, setCurrentStatus] = useState(testOrder.testStatus);
  const collectionDateRequired = currentStatus === "specimen_collected";
  // Sweat-patch panel selection. Only meaningful when this is a sweat patch
  // order; the rest of the UI conditionally renders on isSweatPatchOrder.
  const isSweatPatchOrder = testOrder.specimenType === "sweat_patch";
  const [patchPanel, setPatchPanel] = useState<"WA07" | "WC82">(
    testOrder.patchDetails?.panel ?? "WA07",
  );

  // Mount gate so createPortal(..., document.body) doesn't run during
  // SSR. Conditional render on click means it shouldn't anyway, but
  // this is the standard idiom and avoids hydration mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (changingTest && catalog.length === 0) {
      fetch("/api/test-catalog").then((r) => r.json()).then(setCatalog).catch((e) => console.error("[EditTestOrderModal.tsx] background fetch failed:", e));
    }
  }, [changingTest]);

  const filtered = catalog.filter((t) =>
    !searchTerm ||
    t.testName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      testOrderId: testOrder.id,
      testStatus: form.get("testStatus"),
      testDescription: currentTest.name,
      testCatalogId: currentTest.id || null,
      specimenType: currentTest.specimenType,
      lab: currentTest.lab,
      clientPrice: currentTest.clientPrice ? Number(currentTest.clientPrice) : null,
      collectionType: form.get("collectionType"),
      collectionSiteType: form.get("collectionSiteType") || null,
      schedulingType: form.get("schedulingType") || testOrder.schedulingType || "scheduled",
      specimenId: form.get("specimenId") || null,
      paymentMethod: (form.get("payment") as string) === "not_paid" ? null : form.get("payment"),
      notes: form.get("notes") || null,
      // Sweat-patch panel side channel — server ignores when not sweat_patch.
      ...(isSweatPatchOrder ? { patchPanel } : {}),
    };

    const apptDate = form.get("appointmentDate") as string;
    if (apptDate) data.appointmentDate = new Date(apptDate + "T12:00:00").toISOString();

    const collDate = form.get("collectionDate") as string;
    if (collDate) data.collectionDate = new Date(collDate + "T12:00:00").toISOString();
    else data.collectionDate = null;

    try {
      const res = await fetch(`/api/cases/${caseId}/test-orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw await apiError(res, "Failed to update test order");
      if (data.testStatus === "no_show") {
        setNotifSent(true);
        setTimeout(() => onSaved(), 2000);
      } else {
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Edit Test Order</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          {/* Test Selection */}
          {!changingTest ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-blue-900">{currentTest.name}</p>
                  <p className="text-xs text-blue-600 mt-0.5 capitalize">
                    {currentTest.specimenType} {" · "} {currentTest.lab.replace("_", "/")}
                    {currentTest.clientPrice && ` · $${Number(currentTest.clientPrice).toFixed(2)}`}
                  </p>
                </div>
                <button type="button" onClick={() => setChangingTest(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  Change test
                </button>
              </div>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Select a different test:</p>
              <input
                type="text"
                placeholder="Search tests..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
                autoFocus
              />
              <div className="max-h-[200px] overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
                {filtered.slice(0, 20).map((test) => (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => {
                      setCurrentTest({
                        id: test.id,
                        name: test.testName,
                        specimenType: test.specimenType,
                        lab: test.lab,
                        clientPrice: test.clientPrice,
                      });
                      setChangingTest(false);
                      setSearchTerm("");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                  >
                    <span className="font-medium">{test.testName}</span>
                    <span className="text-gray-400 ml-2">${Number(test.clientPrice).toFixed(0)}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setChangingTest(false)} className="text-xs text-gray-500 mt-2">Cancel</button>
            </div>
          )}

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            {(() => {
              const isSweat = testOrder.testDescription?.toLowerCase().includes("sweat patch");
              return (
                <select
                  name="testStatus"
                  value={currentStatus}
                  onChange={(e) => setCurrentStatus(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                >
                  <option value="order_created">{isSweat ? "Patch Applied" : "Order Created"}</option>
                  <option value="specimen_collected">{isSweat ? "Patch Removed" : "Specimen Collected"}</option>
                  <option value="sent_to_lab">Sent to Lab</option>
                  <option value="results_received">Lab Results Received</option>
                  <option value="results_held">Results Held — Payment Required</option>
                  <option value="results_released">Lab Results Released</option>
                  <option value="at_mro">Results at MRO</option>
                  <option value="mro_released">MRO Results Released</option>
                  <option value="closed">Test Closed</option>
                  <option value="no_show">No Show</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              );
            })()}
            {notifSent && (
              <p className="text-xs text-green-600 mt-1">✓ No Show notification sent</p>
            )}
          </div>

          {/* Patch Panel (sweat patch only) */}
          {isSweatPatchOrder && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Patch Panel
              </label>
              <select
                value={patchPanel}
                onChange={(e) => setPatchPanel(e.target.value as "WA07" | "WC82")}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="WA07">WA07 — Standard panel</option>
                <option value="WC82">WC82 — Expanded panel</option>
              </select>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Standard panel (WA07) is the default. Switch to expanded (WC82) when the case requires it.
              </p>
            </div>
          )}

          {/* Specimen ID + Collection Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Specimen ID</label>
              <input type="text" name="specimenId" defaultValue={testOrder.specimenId || ""} placeholder="e.g., TTL-2026-04-001" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {testOrder.testDescription?.toLowerCase().includes("sweat patch") ? "Application Date" : "Collection Date"}
                {collectionDateRequired && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input
                type="date"
                name="collectionDate"
                defaultValue={testOrder.collectionDate ? new Date(testOrder.collectionDate).toISOString().split("T")[0] : ""}
                required={collectionDateRequired}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              />
              {collectionDateRequired && (
                <p className="text-[10px] text-gray-500 mt-0.5">Required when marking specimen collected.</p>
              )}
            </div>
          </div>

          {/* Collection details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Site Type</label>
              <select name="collectionSiteType" defaultValue={testOrder.collectionSiteType || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="">Select...</option>
                <option value="electronic">Electronic Order (Network Site)</option>
                <option value="truetest">TrueTest Labs - EGV</option>
                <option value="mobile">Mobile / On-site</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Observed / Unobserved</label>
              <select name="collectionType" defaultValue={testOrder.collectionType} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="unobserved">Unobserved</option>
                <option value="observed">Observed</option>
                <option value="na">N/A</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Appointment Date</label>
              <input type="date" name="appointmentDate" defaultValue={testOrder.appointmentDate ? new Date(testOrder.appointmentDate).toISOString().split("T")[0] : ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>

          {/* Payment */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Payment</h4>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment</label>
              <select name="payment" defaultValue={testOrder.paymentMethod || "not_paid"} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="not_paid">Not Paid</option>
                <option value="square">Square</option>
                <option value="stripe">Stripe</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="credit_card">Credit Card</option>
                <option value="direct_deposit">Direct Deposit</option>
                <option value="attorney_pays">Attorney Pays</option>
                <option value="invoiced">Invoiced</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="border-t border-gray-200 pt-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea name="notes" rows={3} defaultValue={testOrder.notes || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <button type="submit" disabled={loading} className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50">
                {loading ? "Saving..." : "Save Changes"}
              </button>
              <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 text-sm hover:text-gray-700">Cancel</button>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                if (!confirm(`Delete this test order?\n\n${testOrder.testDescription}\n\nThis cannot be undone.`)) return;
                setLoading(true);
                try {
                  const res = await fetch(`/api/cases/${caseId}/test-orders?testOrderId=${testOrder.id}`, { method: "DELETE" });
                  if (!res.ok) throw await apiError(res, "Failed to delete test order");
                  onSaved();
                } catch {
                  setError("Failed to delete test order");
                  setLoading(false);
                }
              }}
              className="px-4 py-2 text-red-500 text-sm font-medium hover:text-red-700 hover:bg-red-50 rounded-lg disabled:opacity-50"
            >
              Delete Order
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
