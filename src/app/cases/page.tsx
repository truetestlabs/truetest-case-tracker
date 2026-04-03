"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge, CourtOrderFlag } from "@/components/ui/StatusBadge";

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

type CaseRow = {
  id: string;
  caseNumber: string;
  caseType: string;
  caseStatus: string;
  courtCaseNumber: string | null;
  hasCourtOrder: boolean;
  isMonitored: boolean;
  paymentStatus: string;
  updatedAt: string;
  donor: { firstName: string; lastName: string } | null;
  caseContacts: Array<{
    roleInCase: string;
    contact: { lastName: string };
  }>;
  testOrders: Array<{
    testStatus: string;
    appointmentDate: string | null;
    schedulingType: string;
    testDescription: string;
    collectionSite: string | null;
    collectionSiteType: string | null;
    paymentReceived: boolean;
    paymentMethod: string | null;
  }>;
  _count: { testOrders: number; documents: number };
};

export default function CasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  function loadCases() {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    // Default to open cases only; use status filter to override
    params.set("status", statusFilter || "active");
    if (typeFilter) params.set("type", typeFilter);

    fetch(`/api/cases?${params}`)
      .then((res) => res.json())
      .then((data) => { setCases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadCases(); }, []);

  function handleFilter(e: React.FormEvent) {
    e.preventDefault();
    loadCases();
  }

  async function togglePayment(e: React.MouseEvent, caseId: string, currentStatus: string) {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = currentStatus === "paid" ? "unpaid" : "paid";
    // Optimistic update
    setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, paymentStatus: newStatus } : c));
    try {
      await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: newStatus }),
      });
    } catch {
      // Revert on failure
      setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, paymentStatus: currentStatus } : c));
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cases</h1>
          <p className="text-sm text-slate-500 mt-0.5">{cases.length} case{cases.length !== 1 ? "s" : ""}</p>
        </div>
        <Link
          href="/cases/new"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2a5490 100%)" }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Case
        </Link>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-5 shadow-sm">
        <form onSubmit={handleFilter} className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search by name, case #, or court case #…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            <option value="">All Statuses</option>
            <option value="active">Open</option>
            <option value="closed">Closed</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            <option value="">All Types</option>
            <option value="court_ordered">Court Ordered</option>
            <option value="voluntary">Voluntary</option>
            <option value="by_agreement">By Agreement</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors">
            Search
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Loading cases…</p>
            </div>
          </div>
        ) : cases.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            </div>
            <p className="text-sm font-medium text-slate-600 mb-1">No cases found</p>
            <Link href="/cases/new" className="text-xs text-blue-600 hover:underline">Create your first case</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#f8fafc" }} className="border-b border-slate-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Case #</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Donor</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Test Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Tests</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link href={`/cases/${c.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                        {c.caseNumber}
                      </Link>
                      {c.courtCaseNumber && <p className="text-xs text-slate-400 mt-0.5">Court: {c.courtCaseNumber}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      {c.donor ? (
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarColor(`${c.donor.firstName} ${c.donor.lastName}`)}`}>
                            {getInitials(c.donor.firstName, c.donor.lastName)}
                          </div>
                          <span className="text-sm text-slate-800">{c.donor.lastName}, {c.donor.firstName}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1 flex-wrap">
                        <StatusBadge status={c.caseType} type="caseType" />
                        {c.isMonitored && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">Monitored</span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {c.testOrders.length > 0 ? (
                        <div>
                          {(() => {
                            const test = c.testOrders[0];
                            const preCollectionStatuses = ["order_created", "awaiting_payment", "payment_received"];
                            const isPreCollection = preCollectionStatuses.includes(test.testStatus);
                            const hasAppt = test.appointmentDate;
                            const site = test.collectionSiteType === "truetest" ? "TTL"
                              : test.collectionSiteType === "electronic" ? "Electronic Order"
                              : test.collectionSiteType === "mobile" ? "Mobile / On-site"
                              : test.collectionSite || null;
                            if (hasAppt && isPreCollection) {
                              return (
                                <>
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                    Scheduled{site ? ` @ ${site}` : ""}
                                  </span>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {new Date(test.appointmentDate!).toLocaleDateString()} {new Date(test.appointmentDate!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                  </p>
                                </>
                              );
                            }
                            const isSweatPatch = test.testDescription?.toLowerCase().includes("sweat patch");
                            const testLabel = isSweatPatch && test.testStatus === "order_created" ? "Patch Applied"
                              : isSweatPatch && test.testStatus === "specimen_collected" ? "Patch Removed"
                              : undefined;
                            return (
                              <>
                                {site && <p className="text-xs text-slate-500 mb-1">{site}</p>}
                                <StatusBadge status={test.testStatus} type="test" label={testLabel} />
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No tests</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={(e) => togglePayment(e, c.id, c.paymentStatus)}
                        title="Click to toggle paid/unpaid"
                        className="cursor-pointer hover:opacity-75 active:scale-95 transition-all"
                      >
                        <StatusBadge status={c.paymentStatus} type="payment" />
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {c._count.testOrders}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-400">
                      {new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
