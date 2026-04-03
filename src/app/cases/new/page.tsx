"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DuplicateCase = {
  id: string;
  caseNumber: string;
  caseStatus: string;
  caseType: string;
};

export default function NewCasePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateCase[]>([]);
  const [dupChecked, setDupChecked] = useState(false);
  const [bypassDup, setBypassDup] = useState(false);

  // Check for existing cases with same donor name
  const checkDuplicates = useCallback(async (firstName: string, lastName: string) => {
    if (!firstName.trim() || !lastName.trim()) {
      setDuplicates([]);
      setDupChecked(false);
      return;
    }
    try {
      const res = await fetch(`/api/cases/check-duplicate?firstName=${encodeURIComponent(firstName.trim())}&lastName=${encodeURIComponent(lastName.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setDuplicates(data.cases || []);
        setDupChecked(true);
        setBypassDup(false);
      }
    } catch {
      // Silently fail — don't block case creation
    }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // If duplicates found and user hasn't acknowledged, block submission
    if (duplicates.length > 0 && !bypassDup) {
      setError("This donor already has an existing case. Check the warning below, then confirm if you still want to create a new one.");
      return;
    }

    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const data = {
      caseType: form.get("caseType"),
      hasCourtOrder: form.get("hasCourtOrder") === "yes",
      isMonitored: form.get("isMonitored") === "yes",
      courtCaseNumber: form.get("courtCaseNumber") || null,
      county: form.get("county") || null,
      judgeName: form.get("judgeName") || null,
      paymentResponsibility: form.get("paymentResponsibility") || null,
      notes: form.get("notes") || null,
      donor: {
        firstName: form.get("donorFirstName"),
        lastName: form.get("donorLastName"),
        email: form.get("donorEmail") || null,
        phone: form.get("donorPhone") || null,
      },
    };

    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create case");
      }

      const result = await res.json();
      router.push(`/cases/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Case — Intake</h1>
        <p className="text-gray-500 mt-1">
          Create a new Family Law testing case
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Case Classification */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Case Classification
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Case Type <span className="text-red-500">*</span>
              </label>
              <select
                name="caseType"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select type...</option>
                <option value="court_ordered">Court Ordered</option>
                <option value="voluntary">Voluntary</option>
                <option value="by_agreement">By Agreement</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Court Case Number
              </label>
              <input
                type="text"
                name="courtCaseNumber"
                placeholder="e.g., 2026-D-001234"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                County / Jurisdiction
              </label>
              <input
                type="text"
                name="county"
                placeholder="e.g., Cook County"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Judge Name
              </label>
              <input
                type="text"
                name="judgeName"
                placeholder="Judge's name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Who Pays?
              </label>
              <select
                name="paymentResponsibility"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Not specified</option>
                <option value="petitioner">Petitioner</option>
                <option value="respondent">Respondent</option>
                <option value="split">Split</option>
                <option value="donor">Donor (self-pay)</option>
                <option value="attorney">Attorney firm</option>
              </select>
            </div>
            <div className="md:col-span-2 mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isMonitored"
                  value="yes"
                  className="w-4 h-4 text-[#1e3a5f] border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Monitored Case</span>
                <span className="text-xs text-gray-400">— repeated testing over time with random scheduling</span>
              </label>
            </div>
          </div>
        </section>

        {/* Donor Information */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Donor Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="donorFirstName"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                onBlur={(e) => {
                  const lastName = (document.querySelector('input[name="donorLastName"]') as HTMLInputElement)?.value;
                  if (lastName) checkDuplicates(e.target.value, lastName);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="donorLastName"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                onBlur={(e) => {
                  const firstName = (document.querySelector('input[name="donorFirstName"]') as HTMLInputElement)?.value;
                  if (firstName) checkDuplicates(firstName, e.target.value);
                }}
              />
            </div>

            {/* Duplicate warning */}
            {dupChecked && duplicates.length > 0 && (
              <div className="md:col-span-2 bg-amber-50 border border-amber-300 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-amber-600 text-xl mt-0.5">⚠️</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-800">
                      This donor already has {duplicates.length} existing case{duplicates.length > 1 ? "s" : ""}:
                    </p>
                    <ul className="mt-2 space-y-2">
                      {duplicates.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 text-sm flex-wrap">
                          <Link
                            href={`/cases/${c.id}`}
                            className="text-blue-600 hover:text-blue-800 font-medium underline"
                            target="_blank"
                          >
                            {c.caseNumber}
                          </Link>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.caseStatus === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                            {c.caseStatus}
                          </span>
                          <span className="text-xs text-gray-500 capitalize">{c.caseType.replace(/_/g, " ")}</span>
                          {c.caseStatus === "closed" && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm(`Reopen case ${c.caseNumber}?`)) return;
                                const res = await fetch(`/api/cases/${c.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ caseStatus: "active" }),
                                });
                                if (res.ok) router.push(`/cases/${c.id}`);
                                else alert("Failed to reopen case");
                              }}
                              className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700"
                            >
                              Reopen
                            </button>
                          )}
                          {c.caseStatus === "active" && (
                            <Link
                              href={`/cases/${c.id}`}
                              className="text-xs px-2 py-0.5 bg-green-600 text-white rounded font-medium hover:bg-green-700 no-underline"
                            >
                              Go to Case
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                    <label className="inline-flex items-center gap-2 mt-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bypassDup}
                        onChange={(e) => setBypassDup(e.target.checked)}
                        className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                      />
                      <span className="text-sm text-amber-800 font-medium">
                        I understand — create a new case anyway
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                name="donorEmail"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                name="donorPhone"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        {/* Scheduling */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Scheduling</h2>
          <p className="text-sm text-gray-600 mb-3">Send the donor a link to book their appointment:</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                const donorPhone = (document.querySelector('input[name="donorPhone"]') as HTMLInputElement)?.value;
                const donorName = (document.querySelector('input[name="donorFirstName"]') as HTMLInputElement)?.value || "there";
                const msg = encodeURIComponent(`Hi ${donorName}, please book your appointment at TrueTest Labs here: https://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK`);
                if (donorPhone) {
                  window.open(`sms:${donorPhone}&body=${msg}`, "_blank");
                } else {
                  alert("Enter the donor's phone number first");
                }
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              Text Booking Link
            </button>
            <button
              type="button"
              onClick={() => {
                const donorEmail = (document.querySelector('input[name="donorEmail"]') as HTMLInputElement)?.value;
                const donorName = (document.querySelector('input[name="donorFirstName"]') as HTMLInputElement)?.value || "there";
                const subject = encodeURIComponent("TrueTest Labs - Schedule Your Appointment");
                const body = encodeURIComponent(`Hi ${donorName},\n\nPlease book your appointment at TrueTest Labs using the link below:\n\nhttps://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK\n\nThank you,\nTrueTest Labs`);
                if (donorEmail) {
                  window.open(`mailto:${donorEmail}?subject=${subject}&body=${body}`, "_blank");
                } else {
                  alert("Enter the donor's email first");
                }
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Email Booking Link
            </button>
            <a
              href="https://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Open Booking Page
            </a>
          </div>
        </section>

        {/* Notes */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Notes</h2>
          <textarea
            name="notes"
            rows={4}
            placeholder="Any additional notes about this case (intake details, special instructions, etc.)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </section>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2a5490] disabled:opacity-50 transition-colors"
          >
            {loading ? "Creating..." : "Create Case"}
          </button>
        </div>
      </form>
    </div>
  );
}
