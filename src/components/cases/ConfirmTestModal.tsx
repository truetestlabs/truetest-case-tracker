"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { apiError } from "@/lib/clientErrors";

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
  testOrderId: string;
  specimenType: string;
  onConfirmed: () => void;
  onClose: () => void;
};

export function ConfirmTestModal({ caseId, testOrderId, specimenType, onConfirmed, onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [selectedTest, setSelectedTest] = useState<CatalogItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Mount gate so createPortal(..., document.body) doesn't run during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch("/api/test-catalog")
      .then((res) => res.json())
      .then((data) => setCatalog(data))
      .catch((e) => console.error("[ConfirmTestModal.tsx] catalog fetch failed:", e))
      .finally(() => setLoadingCatalog(false));
  }, []);

  // Pre-filter by specimenType — the server enforces this with a 422,
  // so showing other types would just produce confirm failures.
  const eligible = catalog.filter((t) => t.specimenType === specimenType);
  const categories = [...new Set(eligible.map((t) => t.category))];

  const filtered = eligible.filter((t) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      t.testName.toLowerCase().includes(term) ||
      t.category.toLowerCase().includes(term) ||
      (t.description || "").toLowerCase().includes(term) ||
      (t.labTestCode || "").toLowerCase().includes(term) ||
      t.lab.toLowerCase().includes(term);
    const matchesCategory = !categoryFilter || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  async function handleConfirm() {
    if (!selectedTest) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/test-orders/${testOrderId}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testCatalogId: selectedTest.id }),
      });
      if (!res.ok) throw await apiError(res, "Failed to confirm test");
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Confirm Test</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded mb-4">{error}</p>}

          {!selectedTest ? (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Select a test from the catalog. Only <span className="font-medium">{specimenType}</span> tests are shown.
              </p>

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

              <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {loadingCatalog ? (
                  <div className="p-4 text-center text-gray-400 text-sm">Loading catalog…</div>
                ) : eligible.length === 0 ? (
                  <div className="p-4 text-center text-gray-400 text-sm">
                    No catalog items found for specimen type &ldquo;{specimenType}&rdquo;.
                  </div>
                ) : filtered.length === 0 ? (
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
            <div className="space-y-4">
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

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting}
                  className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50"
                >
                  {submitting ? "Confirming..." : "Confirm Test"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-500 text-sm hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
