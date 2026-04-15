"use client";

/**
 * /accounts/[id] — account detail. Shows metadata, linked cases, and
 * linked contacts. "Edit" button reuses the shared AccountFormModal.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AccountFormModal, type AccountDraft } from "@/components/accounts/AccountFormModal";

type AccountDetail = {
  id: string;
  name: string;
  shortCode: string | null;
  type: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  invoiceGrouping: string;
  active: boolean;
  primaryContact: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    contactType: string;
  }>;
  cases: Array<{
    id: string;
    caseNumber: string;
    caseType: string;
    caseStatus: string;
    isMonitored: boolean;
    updatedAt: string;
    donor: { firstName: string; lastName: string } | null;
    _count: { testOrders: number };
  }>;
  _count: { cases: number; contacts: number };
};

const TYPE_LABELS: Record<string, string> = {
  law_firm: "Law Firm",
  counseling_practice: "Counseling Practice",
  evaluator_office: "Evaluator Office",
  court: "Court",
  state_agency: "State Agency",
  other: "Other",
};

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const loadAccount = useCallback(() => {
    setLoading(true);
    fetch(`/api/accounts/${params.id}`)
      .then((r) => r.json())
      .then((data) => { setAccount(data); setLoading(false); })
      .catch((e) => { console.error("[account detail] load failed:", e); setLoading(false); });
  }, [params.id]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center text-slate-400">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm">Loading account…</p>
      </div>
    );
  }

  if (!account || !account.id) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center">
        <p className="text-slate-500 text-sm">Account not found.</p>
        <Link href="/accounts" className="text-blue-600 text-xs hover:underline mt-2 inline-block">
          ← Back to Accounts
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/accounts" className="text-xs text-slate-500 hover:text-slate-700">
          ← Accounts
        </Link>
        <div className="flex items-start justify-between mt-1">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{account.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500">
                {TYPE_LABELS[account.type] || account.type}
              </span>
              {account.shortCode && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700">
                  {account.shortCode}
                </span>
              )}
              {!account.active && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                  Inactive
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setEditOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Cases */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                Cases ({account._count.cases})
              </h2>
            </div>
            {account.cases.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No cases linked to this account yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "#f8fafc" }} className="border-b border-slate-100">
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase">Case #</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase">Donor</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase">Tests</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.cases.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/50">
                        <td className="px-4 py-2">
                          <Link href={`/cases/${c.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
                            {c.caseNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-sm text-slate-700">
                          {c.donor ? `${c.donor.firstName} ${c.donor.lastName}` : "—"}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${c.caseStatus === "closed" ? "bg-slate-100 text-slate-600" : "bg-green-100 text-green-700"}`}>
                            {c.caseStatus}
                          </span>
                          {c.isMonitored && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                              Monitored
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">{c._count.testOrders}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Contacts */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                People ({account._count.contacts})
              </h2>
            </div>
            {account.contacts.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No contacts linked yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {account.contacts.map((c) => (
                  <li key={c.id} className="px-5 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {c.firstName} {c.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.contactType.replace("_", " ")}
                        {c.email && ` · ${c.email}`}
                        {c.phone && ` · ${c.phone}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Details
            </h3>
            <dl className="space-y-2 text-sm">
              {account.phone && (
                <div>
                  <dt className="text-[11px] uppercase text-slate-400 tracking-wider">Phone</dt>
                  <dd className="text-slate-800">{account.phone}</dd>
                </div>
              )}
              {account.email && (
                <div>
                  <dt className="text-[11px] uppercase text-slate-400 tracking-wider">Email</dt>
                  <dd className="text-slate-800 break-words">
                    <a href={`mailto:${account.email}`} className="text-blue-600 hover:underline">
                      {account.email}
                    </a>
                  </dd>
                </div>
              )}
              {account.website && (
                <div>
                  <dt className="text-[11px] uppercase text-slate-400 tracking-wider">Website</dt>
                  <dd className="text-slate-800 break-words">
                    <a
                      href={account.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {account.website}
                    </a>
                  </dd>
                </div>
              )}
              {account.address && (
                <div>
                  <dt className="text-[11px] uppercase text-slate-400 tracking-wider">Address</dt>
                  <dd className="text-slate-800 whitespace-pre-wrap">{account.address}</dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] uppercase text-slate-400 tracking-wider">Invoice grouping</dt>
                <dd className="text-slate-800">
                  {account.invoiceGrouping === "consolidated"
                    ? "Consolidated monthly"
                    : "Per case"}
                </dd>
              </div>
              {account.notes && (
                <div>
                  <dt className="text-[11px] uppercase text-slate-400 tracking-wider">Notes</dt>
                  <dd className="text-slate-700 whitespace-pre-wrap">{account.notes}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      </div>

      <AccountFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(_saved: AccountDraft) => loadAccount()}
        account={account}
      />
    </div>
  );
}
