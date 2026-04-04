"use client";

import { useState } from "react";

type CaseInfo = {
  id: string;
  caseType: string;
  caseStatus: string;
  courtCaseNumber: string | null;
  county: string | null;
  judgeName: string | null;
  hasCourtOrder: boolean;
  isMonitored: boolean;
  paymentStatus: string;
  notes: string | null;
  donor: { firstName: string; lastName: string; email: string | null; phone: string | null } | null;
};

type Props = {
  caseData: CaseInfo;
  onSaved: () => void;
  onClose: () => void;
};

export function EditCaseModal({ caseData, onSaved, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const data = {
      caseType: form.get("caseType"),
      caseStatus: form.get("caseStatus"),
      hasCourtOrder: form.get("hasCourtOrder") === "yes",
      isMonitored: form.get("isMonitored") === "yes",
      courtCaseNumber: form.get("courtCaseNumber") || null,
      county: form.get("county") || null,
      judgeName: form.get("judgeName") || null,
      notes: form.get("notes") || null,
      donor: {
        firstName: form.get("donorFirstName"),
        lastName: form.get("donorLastName"),
        email: form.get("donorEmail") || null,
        phone: form.get("donorPhone") || null,
      },
    };

    try {
      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update case");
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
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Edit Case</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          {/* Case Classification */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Case Type</label>
              <select name="caseType" defaultValue={caseData.caseType} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="court_ordered">Court Ordered</option>
                <option value="voluntary">Voluntary</option>
                <option value="by_agreement">By Agreement</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Case Status</label>
              <select name="caseStatus" defaultValue={caseData.caseStatus} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="active">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Court Case Number</label>
              <input type="text" name="courtCaseNumber" defaultValue={caseData.courtCaseNumber || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">County</label>
              <input type="text" name="county" defaultValue={caseData.county || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Judge</label>
              <input type="text" name="judgeName" defaultValue={caseData.judgeName || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div className="col-span-2 mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isMonitored"
                  value="yes"
                  defaultChecked={caseData.isMonitored}
                  className="w-4 h-4 text-[#1e3a5f] border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-gray-700">Monitored Case</span>
                <span className="text-xs text-gray-400">— repeated testing / random scheduling</span>
              </label>
            </div>
          </div>

          {/* Donor Info */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Donor Information</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                <input type="text" name="donorFirstName" defaultValue={caseData.donor?.firstName || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                <input type="text" name="donorLastName" defaultValue={caseData.donor?.lastName || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" name="donorEmail" defaultValue={caseData.donor?.email || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input type="tel" name="donorPhone" defaultValue={caseData.donor?.phone || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="border-t border-gray-200 pt-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Case Notes</label>
            <textarea name="notes" rows={3} defaultValue={caseData.notes || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button type="submit" disabled={loading} className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50">
              {loading ? "Saving..." : "Save Changes"}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 text-sm hover:text-gray-700">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
