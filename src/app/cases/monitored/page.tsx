"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getCasePaymentState } from "@/lib/payment";

type CaseRow = {
  id: string;
  caseNumber: string;
  caseType: string;
  caseStatus: string;
  courtCaseNumber: string | null;
  hasCourtOrder: boolean;
  isMonitored: boolean;
  updatedAt: string;
  donor: { firstName: string; lastName: string } | null;
  testOrders: Array<{
    testStatus: string;
    appointmentDate: string | null;
    schedulingType: string;
    testDescription: string;
    collectionSite: string | null;
    collectionSiteType: string | null;
    paymentMethod: string | null;
  }>;
  _count: { testOrders: number; documents: number };
};

export default function MonitoredCasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  function loadCases() {
    setLoading(true);
    const params = new URLSearchParams({ status: "active", monitored: "true" });
    if (query) params.set("q", query);

    fetch(`/api/cases?${params}`)
      .then((res) => res.json())
      .then((data) => { setCases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    loadCases();
    const interval = setInterval(loadCases, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") loadCases(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitored Cases</h1>
          <p className="text-gray-500 mt-1">{cases.length} monitored case{cases.length !== 1 ? "s" : ""} — repeated testing with random scheduling</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <form onSubmit={(e) => { e.preventDefault(); loadCases(); }} className="flex gap-3">
          <input type="text" placeholder="Search monitored cases..." value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          <button type="submit" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Search</button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {loading ? (
          <div className="px-6 py-12 text-center text-gray-400">Loading...</div>
        ) : cases.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <p className="text-lg">No monitored cases</p>
            <p className="text-sm mt-1">Mark a case as &quot;Monitored&quot; during intake or in Edit Case to see it here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="px-6 py-3">Case #</th>
                  <th className="px-6 py-3">Donor</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Latest Test</th>
                  <th className="px-6 py-3">Payment</th>
                  <th className="px-6 py-3">Tests</th>
                  <th className="px-6 py-3">Updated</th>
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
                    <td className="px-6 py-4">
                      <StatusBadge status={c.caseType} type="caseType" />
                    </td>
                    <td className="px-6 py-4">
                      {c.testOrders.filter((t) => t.testStatus !== "closed").length > 0 ? (
                        <div>
                          {(() => {
                            const test = c.testOrders.filter((t) => t.testStatus !== "closed")[0];
                            const isSweatPatch = test.testDescription?.toLowerCase().includes("sweat patch");
                            const testLabel = isSweatPatch && test.testStatus === "order_created" ? "Patch Applied"
                              : isSweatPatch && test.testStatus === "specimen_collected" ? "Patch Removed"
                              : undefined;
                            return <StatusBadge status={test.testStatus} type="test" label={testLabel} />;
                          })()}
                          {c.testOrders.filter((t) => t.testStatus !== "closed")[0].appointmentDate && (
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(c.testOrders[0].appointmentDate).toLocaleDateString()} {new Date(c.testOrders[0].appointmentDate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">No tests</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={getCasePaymentState(c.testOrders)} type="payment" />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{c._count.testOrders}</td>
                    <td className="px-6 py-4 text-xs text-gray-400">{new Date(c.updatedAt).toLocaleDateString()}</td>
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
