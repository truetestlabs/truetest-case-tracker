"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AccountSelect } from "@/components/accounts/AccountSelect";

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
  const [referringAccountId, setReferringAccountId] = useState<string | null>(null);
  // bypassDup removed — one case per donor, no bypass allowed

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
      }
    } catch {
      // Silently fail — don't block case creation
    }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // If duplicates found, block submission — one case per donor
    if (duplicates.length > 0) {
      setError("This donor already has an existing case. Use the buttons below to go to it.");
      return;
    }

    setLoading(true);
    setError("");

    // Safety: run duplicate check synchronously before submit if it hasn't happened yet
    const formEl = e.currentTarget;
    const firstNameVal = (formEl.elements.namedItem("donorFirstName") as HTMLInputElement)?.value?.trim() || "";
    const lastNameVal = (formEl.elements.namedItem("donorLastName") as HTMLInputElement)?.value?.trim() || "";
    if (firstNameVal && lastNameVal && !dupChecked) {
      const res = await fetch(`/api/cases/check-duplicate?firstName=${encodeURIComponent(firstNameVal)}&lastName=${encodeURIComponent(lastNameVal)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.cases?.length > 0) {
          setDuplicates(data.cases);
          setDupChecked(true);
          setError("This donor already has an existing case. Use the buttons below to go to it.");
          return;
        }
      }
    }

    const form = new FormData(formEl);
    const data = {
      caseType: form.get("caseType"),
      hasCourtOrder: form.get("hasCourtOrder") === "yes",
      isMonitored: form.get("isMonitored") === "yes",
      courtCaseNumber: form.get("courtCaseNumber") || null,
      county: form.get("county") || null,
      judgeName: form.get("judgeName") || null,
      notes: form.get("notes") || null,
      referringAccountId: referringAccountId || null,
      // confirmDuplicate removed — one case per donor, no bypass
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

      const result = await res.json();

      // Case was reopened instead of created — redirect to existing case
      if (result.reopened) {
        router.push(`/cases/${result.caseId}`);
        return;
      }

      if (res.status === 409) {
        setDuplicates(result.duplicates || []);
        setDupChecked(true);
        setError(result.message || "This donor already has an active case.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(result.error || "Failed to create case");
      }

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
            {/* Court Case Number, County, Judge Name removed to declutter —
                can be added later from Edit Case if needed */}
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

        {/* Referring Account */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Referring Account</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-gray-400 font-normal">(optional)</span></label>
            <AccountSelect value={referringAccountId} onChange={setReferringAccountId} placeholder="No referring account" />
            <p className="text-xs text-gray-400 mt-1">Law firm or organization referring this case. Create a new account inline if needed.</p>
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
                      This donor already has a case — one case per donor:
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
                              Reopen & Add Test
                            </button>
                          )}
                          {c.caseStatus !== "closed" && (
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
                    <p className="text-xs text-amber-700 mt-3">If this is a different person with the same name, contact admin.</p>
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

        {/* Scheduling section removed — booking moved to sidebar + phone intake */}

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
