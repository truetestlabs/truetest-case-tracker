"use client";

import { useState } from "react";

type ContactData = {
  id: string; // caseContact id
  roleInCase: string;
  receivesResults: boolean;
  receivesStatus: boolean;
  receivesInvoices: boolean;
  canOrderTests: boolean;
  contact: {
    firstName: string;
    lastName: string;
    firmName: string | null;
    email: string | null;
    phone: string | null;
  };
};

type Props = {
  caseId: string;
  caseContact: ContactData;
  onSaved: () => void;
  onClose: () => void;
};

export function EditContactModal({ caseId, caseContact, onSaved, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const data = {
      caseContactId: caseContact.id,
      roleInCase: form.get("roleInCase"),
      receivesResults: form.get("receivesResults") === "on",
      receivesStatus: form.get("receivesStatus") === "on",
      receivesInvoices: form.get("receivesInvoices") === "on",
      canOrderTests: form.get("canOrderTests") === "on",
      contact: {
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        firmName: form.get("firmName") || null,
        email: form.get("email") || null,
        phone: form.get("phone") || null,
      },
    };

    try {
      const res = await fetch(`/api/cases/${caseId}/contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Edit Contact</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role in Case</label>
            <select name="roleInCase" defaultValue={caseContact.roleInCase} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
              <option value="other">Unknown / Not specified</option>
              <option value="petitioner_attorney">Petitioner&apos;s Attorney</option>
              <option value="respondent_attorney">Respondent&apos;s Attorney</option>
              <option value="gal">Guardian ad Litem (GAL)</option>
              <option value="judge">Judge</option>
              <option value="referring_party">Referring Party</option>
              <option value="court_clerk">Court Clerk</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
              <input type="text" name="firstName" defaultValue={caseContact.contact.firstName} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
              <input type="text" name="lastName" defaultValue={caseContact.contact.lastName} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Firm Name</label>
            <input type="text" name="firmName" defaultValue={caseContact.contact.firmName || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" name="email" defaultValue={caseContact.contact.email || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input type="tel" name="phone" defaultValue={caseContact.contact.phone || ""} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-3">
            <p className="text-xs font-semibold text-gray-700 mb-2">Distribution Settings</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="receivesResults" defaultChecked={caseContact.receivesResults} className="rounded border-gray-300 text-blue-600" />
                <span>Receives test results</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="receivesStatus" defaultChecked={caseContact.receivesStatus} className="rounded border-gray-300 text-blue-600" />
                <span>Receives status updates</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="receivesInvoices" defaultChecked={caseContact.receivesInvoices} className="rounded border-gray-300 text-blue-600" />
                <span>Receives invoices</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="canOrderTests" defaultChecked={caseContact.canOrderTests} className="rounded border-gray-300 text-blue-600" />
                <span>Can order additional tests</span>
              </label>
            </div>
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
