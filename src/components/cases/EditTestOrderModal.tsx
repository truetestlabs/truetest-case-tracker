"use client";

import { useState, useEffect } from "react";

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
  squarePaymentLink: string | null;
  paymentMethod: string | null;
  paymentReceived: boolean;
  clientPrice: string | null;
  invoiceNumber: string | null;
  labAccessionNumber: string | null;
  appointmentDate: string | null;
  notes: string | null;
  paymentStatus: string | null;
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

  useEffect(() => {
    if (changingTest && catalog.length === 0) {
      fetch("/api/test-catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
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
      collectionSite: form.get("collectionSite") || null,
      collectionSiteType: form.get("collectionSiteType") || null,
      schedulingType: form.get("schedulingType") || testOrder.schedulingType || "scheduled",
      paymentMethod: (form.get("payment") as string) === "not_paid" ? null : form.get("payment"),
      paymentStatus: (form.get("payment") as string) === "not_paid" ? "unpaid"
        : (form.get("payment") as string) === "invoiced" ? "invoiced"
        : "paid",
      invoiceNumber: form.get("invoiceNumber") || null,
      labAccessionNumber: form.get("labAccessionNumber") || null,
      notes: form.get("notes") || null,
    };

    const apptDate = form.get("appointmentDate") as string;
    if (apptDate) data.appointmentDate = new Date(apptDate).toISOString();

    try {
      const res = await fetch(`/api/cases/${caseId}/test-orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update test order");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
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
            <select name="testStatus" defaultValue={testOrder.testStatus} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
              <option value="order_created">Order Created</option>
              <option value="specimen_collected">Specimen Collected</option>
              <option value="results_received">Results Received</option>
              <option value="results_released">Results Released</option>
              <option value="at_mro">At MRO</option>
              <option value="closed">Closed</option>
              <option value="no_show">No Show</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Collection details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Collection Site</label>
              <input type="text" name="collectionSite" defaultValue={testOrder.collectionSite || ""} placeholder="e.g., Quest PSC - Chicago Loop" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
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
              <input type="datetime-local" name="appointmentDate" defaultValue={testOrder.appointmentDate ? testOrder.appointmentDate.slice(0, 16) : ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>

          {/* Payment */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Payment</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment</label>
                <select name="payment" defaultValue={testOrder.paymentMethod || "not_paid"} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                  <option value="not_paid">Not Paid</option>
                  <option value="square">Square</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="direct_deposit">Direct Deposit</option>
                  <option value="attorney_pays">Attorney Pays</option>
                  <option value="invoiced">Invoiced</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Invoice # (QuickBooks)</label>
                <input type="text" name="invoiceNumber" defaultValue={testOrder.invoiceNumber || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
            </div>
          </div>

          {/* Lab tracking */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Lab Tracking</h4>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Lab Accession Number</label>
              <input type="text" name="labAccessionNumber" defaultValue={testOrder.labAccessionNumber || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
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
                  if (!res.ok) throw new Error("Failed to delete");
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
    </div>
  );
}
