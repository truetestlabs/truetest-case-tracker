"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/clientErrors";

export default function UploadOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);

    // Build donors
    const donors = [];
    const pet1First = form.get("pet1First") as string;
    const pet1Last = form.get("pet1Last") as string;
    if (pet1First && pet1Last) {
      donors.push({
        firstName: pet1First, lastName: pet1Last,
        email: form.get("pet1Email") || "", phone: form.get("pet1Phone") || "",
        party: "petitioner",
      });
    }
    const resp1First = form.get("resp1First") as string;
    const resp1Last = form.get("resp1Last") as string;
    if (resp1First && resp1Last) {
      donors.push({
        firstName: resp1First, lastName: resp1Last,
        email: form.get("resp1Email") || "", phone: form.get("resp1Phone") || "",
        party: "respondent",
      });
    }

    const parsedData = {
      courtCaseNumber: form.get("courtCaseNumber") || "",
      county: form.get("county") || "Cook County",
      judgeName: form.get("judgeName") || "",
      orderDate: form.get("orderDate") || "",
      whoPays: form.get("whoPays") || "",
      frequency: form.get("frequency") || "",
      testingDuration: "",
      specialInstructions: form.get("specialInstructions") || "",
      notes: form.get("notes") || "",
      donors,
      contacts: [],
      testOrders: [],
    };

    try {
      const res = await fetch("/api/parse-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedData }),
      });
      if (!res.ok) throw await apiError(res, "Failed to create case");
      const result = await res.json();
      router.push(`/cases/${result.caseId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Case from Court Order</h1>
        <p className="text-gray-500 mt-1">
          Enter case info and parties here. After creating, you&apos;ll add attorneys, GALs, contacts, and test orders on the case page.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Case Info */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Case Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Court Case Number</label>
              <input type="text" name="courtCaseNumber" placeholder="e.g., 2025D530167" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">County</label>
              <input type="text" name="county" defaultValue="Cook County" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Judge</label>
              <input type="text" name="judgeName" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Order Date</label>
              <input type="date" name="orderDate" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Testing Frequency</label>
              <select name="frequency" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Not specified</option>
                <option value="One-time">One-time</option>
                <option value="Random">Random</option>
                <option value="Weekly">Weekly</option>
                <option value="Bi-weekly">Bi-weekly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </div>
          </div>
        </section>

        {/* Petitioner */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Petitioner (Donor)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">First Name</label><input type="text" name="pet1First" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label><input type="text" name="pet1Last" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Email</label><input type="email" name="pet1Email" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Phone</label><input type="tel" name="pet1Phone" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          </div>
        </section>

        {/* Respondent */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Respondent (Donor)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">First Name</label><input type="text" name="resp1First" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label><input type="text" name="resp1Last" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Email</label><input type="email" name="resp1Email" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Phone</label><input type="tel" name="resp1Phone" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          </div>
        </section>

        {/* Notes */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Notes</h2>
          <textarea name="specialInstructions" rows={3} placeholder="Special instructions from the court order..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3" />
          <textarea name="notes" rows={2} placeholder="Your internal notes..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </section>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading} className="px-6 py-3 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50">
            {loading ? "Creating..." : "Create Case"}
          </button>
          <button type="button" onClick={() => router.back()} className="px-4 py-3 text-gray-500 text-sm hover:text-gray-700">Cancel</button>
        </div>

        <p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-4">
          After creating the case, you&apos;ll land on the case detail page where you can add unlimited attorneys, GALs, and contacts with full details (firm name, phone, email, distribution settings) and create test orders from your catalog.
        </p>
      </form>
    </div>
  );
}
