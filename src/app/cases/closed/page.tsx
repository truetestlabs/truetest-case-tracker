"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

type CaseRow = {
  id: string;
  caseNumber: string;
  caseType: string;
  courtCaseNumber: string | null;
  hasCourtOrder: boolean;
  updatedAt: string;
  donor: { firstName: string; lastName: string } | null;
  _count: { testOrders: number };
};

export default function ClosedCasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  function loadCases() {
    setLoading(true);
    const params = new URLSearchParams({ status: "closed" });
    if (query) params.set("q", query);

    fetch(`/api/cases?${params}`)
      .then((res) => res.json())
      .then((data) => { setCases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    loadCases();
    const interval = setInterval(loadCases, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") loadCases(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Closed Cases</h1>
        <p className="text-gray-500 mt-1">{cases.length} closed case{cases.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <form onSubmit={(e) => { e.preventDefault(); loadCases(); }} className="flex gap-3">
          <input type="text" placeholder="Search closed cases..." value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          <button type="submit" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Search</button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {loading ? (
          <div className="px-6 py-12 text-center text-gray-400">Loading...</div>
        ) : cases.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <p className="text-lg">No closed cases</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="px-6 py-3">Case #</th>
                  <th className="px-6 py-3">Donor</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Court Order</th>
                  <th className="px-6 py-3">Tests</th>
                  <th className="px-6 py-3">Closed</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <Link href={`/cases/${c.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
                        {c.caseNumber}
                      </Link>
                      {c.courtCaseNumber && <p className="text-xs text-gray-400 mt-0.5">Court: {c.courtCaseNumber}</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {c.donor ? `${c.donor.lastName}, ${c.donor.firstName}` : "—"}
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={c.caseType} type="caseType" /></td>
                    <td className="px-6 py-4">
                      {c.hasCourtOrder ? (
                        <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">Yes</span>
                      ) : (
                        <span className="text-xs font-medium text-gray-400">No</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{c._count.testOrders}</td>
                    <td className="px-6 py-4 text-xs text-gray-400">{new Date(c.updatedAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <button
                        onClick={async () => {
                          if (!confirm(`Reopen case ${c.caseNumber}?`)) return;
                          await fetch(`/api/cases/${c.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ caseStatus: "active" }),
                          });
                          loadCases();
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium"
                      >
                        Reopen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
