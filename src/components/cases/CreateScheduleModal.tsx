"use client";

import { useState, useEffect } from "react";

type CatalogItem = {
  id: string;
  testName: string;
  specimenType: string;
  lab: string;
  category: string;
};

type Props = {
  caseId: string;
  onSaved: () => void;
  onClose: () => void;
};

export function CreateScheduleModal({ caseId, onSaved, onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    testCatalogId: "",
    collectionType: "unobserved",
    patternType: "per_month",
    targetCount: 2,
    minSpacingDays: 3,
    startDate: today,
    endDate: "",
    noEndDate: false,
    autoRescheduleOnMiss: true,
    autoRescheduleDays: 1,
    allowedDays: [1, 2, 3, 4, 5] as number[], // Mon-Fri default
  });

  useEffect(() => {
    fetch("/api/test-catalog")
      .then((r) => r.json())
      .then((data) => setCatalog(data))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const body = {
        testCatalogId: form.testCatalogId,
        collectionType: form.collectionType,
        patternType: form.patternType,
        targetCount: Number(form.targetCount),
        minSpacingDays: form.minSpacingDays ? Number(form.minSpacingDays) : null,
        startDate: form.startDate,
        endDate: form.noEndDate ? null : form.endDate || null,
        autoRescheduleOnMiss: form.autoRescheduleOnMiss,
        autoRescheduleDays: Number(form.autoRescheduleDays),
        allowedDays: form.allowedDays,
      };

      const res = await fetch(`/api/cases/${caseId}/monitoring-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create schedule");
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const countLabel =
    form.patternType === "range_count" ? "Total tests"
    : form.patternType === "every_n_days" ? "Every how many days?"
    : form.patternType === "per_month" ? "Tests per month"
    : "Tests per week";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Set Up Random Schedule</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Test Type <span className="text-red-500">*</span></label>
              <select
                value={form.testCatalogId}
                onChange={(e) => setForm({ ...form, testCatalogId: e.target.value })}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">— Select a test —</option>
                {catalog.map((t) => (
                  <option key={t.id} value={t.id}>{t.testName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Collection Type</label>
              <div className="flex gap-2">
                {(["unobserved", "observed"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm({ ...form, collectionType: type })}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                      form.collectionType === type
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300"
                    }`}
                  >
                    {type === "unobserved" ? "Unobserved" : "Observed"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Pattern <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "range_count", label: "Over Range" },
                  { value: "per_month", label: "Per Month" },
                  { value: "per_week", label: "Per Week" },
                  { value: "every_n_days", label: "Every N Days" },
                ].map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm({ ...form, patternType: p.value })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                      form.patternType === p.value
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{countLabel} <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  value={form.targetCount}
                  onChange={(e) => setForm({ ...form, targetCount: Number(e.target.value) })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min Days Apart</label>
                <input
                  type="number"
                  min="0"
                  value={form.minSpacingDays}
                  onChange={(e) => setForm({ ...form, minSpacingDays: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="Optional"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Eligible Days</label>
              <div className="flex gap-1">
                {[
                  { day: 0, label: "Sun" },
                  { day: 1, label: "Mon" },
                  { day: 2, label: "Tue" },
                  { day: 3, label: "Wed" },
                  { day: 4, label: "Thu" },
                  { day: 5, label: "Fri" },
                  { day: 6, label: "Sat" },
                ].map(({ day, label }) => {
                  const checked = form.allowedDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        const next = checked
                          ? form.allowedDays.filter((d) => d !== day)
                          : [...form.allowedDays, day].sort();
                        setForm({ ...form, allowedDays: next });
                      }}
                      className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-all ${
                        checked
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={form.endDate}
                  disabled={form.noEndDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100"
                />
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.noEndDate}
                onChange={(e) => setForm({ ...form, noEndDate: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">No end date (ongoing — auto-extends monthly)</span>
            </label>

            <div className="border-t border-gray-200 pt-4">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoRescheduleOnMiss}
                  onChange={(e) => setForm({ ...form, autoRescheduleOnMiss: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium text-gray-700">Auto-reschedule missed tests by default</span>
              </label>
              {form.autoRescheduleOnMiss && (
                <div className="mt-2 ml-6">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Reschedule this many business days later</label>
                  <input
                    type="number"
                    min="1"
                    max="7"
                    value={form.autoRescheduleDays}
                    onChange={(e) => setForm({ ...form, autoRescheduleDays: Number(e.target.value) })}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !form.testCatalogId}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Schedule"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
