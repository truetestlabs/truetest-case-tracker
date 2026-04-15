"use client";

/**
 * /accounts — list every referring organization (law firm, counseling
 * practice, etc.). Lets the user search by name/shortCode, filter by
 * active status, create new accounts, and click into /accounts/[id] for
 * the detail view.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountFormModal, type AccountDraft } from "@/components/accounts/AccountFormModal";

type AccountRow = {
  id: string;
  name: string;
  shortCode: string | null;
  type: string;
  active: boolean;
  primaryContact: { firstName: string; lastName: string; email: string | null } | null;
  _count: { cases: number; contacts: number };
};

const TYPE_LABELS: Record<string, string> = {
  law_firm: "Law Firm",
  counseling_practice: "Counseling",
  evaluator_office: "Evaluator",
  court: "Court",
  state_agency: "State Agency",
  other: "Other",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("active"); // "active" | "inactive" | ""
  const [modalOpen, setModalOpen] = useState(false);

  function loadAccounts() {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (activeFilter === "active") params.set("active", "true");
    if (activeFilter === "inactive") params.set("active", "false");

    fetch(`/api/accounts?${params}`)
      .then((r) => r.json())
      .then((data) => { setAccounts(data); setLoading(false); })
      .catch((e) => { console.error("[accounts page] load failed:", e); setLoading(false); });
  }

  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilter(e: React.FormEvent) {
    e.preventDefault();
    loadAccounts();
  }

  function handleCreated(_account: AccountDraft) {
    loadAccounts();
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2a5490 100%)" }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Account
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-5 shadow-sm">
        <form onSubmit={handleFilter} className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search by name or short code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
          >
            Search
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Loading accounts…</p>
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-600 mb-1">No accounts found</p>
            <button
              onClick={() => setModalOpen(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              Create your first account
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#f8fafc" }} className="border-b border-slate-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Short</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Cases</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Contacts</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Primary</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, idx) => (
                  <tr
                    key={a.id}
                    className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/50 ${idx % 2 === 1 ? "bg-slate-50/50" : ""}`}
                  >
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/accounts/${a.id}`}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                      >
                        {a.name}
                      </Link>
                      {!a.active && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-xs font-mono text-slate-600">
                      {a.shortCode || "—"}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-700">
                      {TYPE_LABELS[a.type] || a.type}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                        {a._count.cases}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                        {a._count.contacts}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-600">
                      {a.primaryContact
                        ? `${a.primaryContact.firstName} ${a.primaryContact.lastName}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AccountFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleCreated}
      />
    </div>
  );
}
