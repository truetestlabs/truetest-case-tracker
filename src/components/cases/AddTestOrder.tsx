"use client";

import { useState, useEffect } from "react";

type CatalogItem = {
  id: string;
  category: string;
  testName: string;
  panelSize: string | null;
  specimenType: string;
  lab: string;
  labTestCode: string | null;
  clientPrice: string;
  description: string | null;
  specialHandling: string | null;
  isAddOn: boolean;
};

type Props = {
  caseId: string;
  onAdded: () => void;
};

export function AddTestOrder({ caseId, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedTest, setSelectedTest] = useState<CatalogItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    if (open && catalog.length === 0) {
      fetch("/api/test-catalog")
        .then((res) => res.json())
        .then((data) => setCatalog(data))
        .catch((e) => console.error("[AddTestOrder.tsx] background fetch failed:", e));
    }
  }, [open]);

  const categories = [...new Set(catalog.map((t) => t.category))];

  const filtered = catalog.filter((t) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      t.testName.toLowerCase().includes(term) ||
      t.category.toLowerCase().includes(term) ||
      (t.description || "").toLowerCase().includes(term) ||
      (t.labTestCode || "").toLowerCase().includes(term) ||
      t.lab.toLowerCase().includes(term) ||
      t.specimenType.toLowerCase().includes(term);
    const matchesCategory = !categoryFilter || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedTest) return;
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const data = {
      testCatalogId: selectedTest.id,
      testDescription: selectedTest.testName,
      specimenType: selectedTest.specimenType,
      lab: selectedTest.lab,
      clientPrice: Number(selectedTest.clientPrice),
      collectionType: form.get("collectionType") || "unobserved",
      collectionSite: form.get("collectionSite") || null,
      collectionSiteType: form.get("collectionSiteType") || null,
      schedulingType: form.get("schedulingType") || "scheduled",
      testStatus: form.get("testStatus") || "order_created",
      squarePaymentLink: form.get("squarePaymentLink") || null,
      paymentMethod: (form.get("payment") as string) === "not_paid" ? null : form.get("payment"),
      notes: form.get("notes") || null,
    };

    try {
      const res = await fetch(`/api/cases/${caseId}/test-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create test order");
      setOpen(false);
      setSelectedTest(null);
      setSearchTerm("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] transition-colors"
      >
        + Add Test Order
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Add Test Order</h3>
            <button onClick={() => { setOpen(false); setSelectedTest(null); }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded mb-4">{error}</p>}

          {/* Step 1: Select a test */}
          {!selectedTest ? (
            <div>
              <p className="text-sm text-gray-600 mb-3">Select a test from the catalog:</p>

              {/* Search and filter */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Search tests..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Test list */}
              <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <div className="p-4 text-center text-gray-400 text-sm">No tests match your search</div>
                ) : (
                  filtered.map((test) => (
                    <button
                      key={test.id}
                      type="button"
                      onClick={() => setSelectedTest(test)}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {test.testName}
                            {test.isAddOn && <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">Add-on</span>}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {test.category} &middot; {test.specimenType} &middot; {test.lab.replace("_", "/")}
                            {test.labTestCode && <span className="font-mono text-gray-600"> &middot; {test.labTestCode}</span>}
                          </p>
                          {test.description && <p className="text-xs text-gray-400 mt-0.5">{test.description}</p>}
                        </div>
                        <span className="text-sm font-semibold text-green-700 whitespace-nowrap ml-4">
                          ${Number(test.clientPrice).toFixed(0)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Step 2: Configure the order */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Selected test summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-blue-900">{selectedTest.testName}</p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      {selectedTest.category} &middot; {selectedTest.specimenType} &middot; {selectedTest.lab.replace("_", "/")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-blue-900">${Number(selectedTest.clientPrice).toFixed(2)}</p>
                    <button
                      type="button"
                      onClick={() => setSelectedTest(null)}
                      className="text-xs text-blue-500 hover:text-blue-700 mt-1"
                    >
                      Change test
                    </button>
                  </div>
                </div>
                {selectedTest.specialHandling && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    <strong>Special handling:</strong> {selectedTest.specialHandling}
                  </div>
                )}
              </div>

              {/* Collection details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Collection Site</label>
                  <input
                    type="text"
                    name="collectionSite"
                    placeholder="e.g., Quest PSC - Chicago Loop"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Site Type</label>
                  <select name="collectionSiteType" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                    <option value="">Select...</option>
                    <option value="electronic">Electronic Order (Network Site)</option>
                    <option value="truetest">TrueTest Labs - EGV</option>
                    <option value="mobile">Mobile / On-site</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Observed / Unobserved</label>
                  <select name="collectionType" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                    <option value="unobserved">Unobserved</option>
                    <option value="observed">Observed</option>
                    <option value="na">N/A</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Appointment Date</label>
                  <input type="datetime-local" name="appointmentDate" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
                </div>
              </div>

              {/* Payment & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Current Status</label>
                  <select name="testStatus" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                    <option value="order_created">Order Created</option>
                    <option value="awaiting_payment">Awaiting Payment</option>
                    <option value="payment_received">Payment Received</option>
                    <option value="specimen_collected">Specimen Collected</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment</label>
                  <select name="payment" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="Any notes about this order..."
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create Test Order"}
                </button>
                <button
                  type="button"
                  onClick={() => { setOpen(false); setSelectedTest(null); }}
                  className="px-4 py-2 text-gray-500 text-sm hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
