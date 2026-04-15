"use client";

/**
 * /accounts/[id] — account detail. Shows metadata, linked cases, linked
 * contacts, and the default recipient list that pre-fills new cases.
 * "Edit" button reuses the shared AccountFormModal.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AccountFormModal, type AccountDraft } from "@/components/accounts/AccountFormModal";

type DefaultRecipient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: string;
  receivesResults: boolean;
  receivesStatus: boolean;
  receivesInvoices: boolean;
  canOrderTests: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  evaluator: "Evaluator",
  petitioner_attorney: "Petitioner Attorney",
  respondent_attorney: "Respondent Attorney",
  gal: "GAL",
  judge: "Judge",
  referring_party: "Referring Party",
  court_clerk: "Court Clerk",
  other: "Other",
};

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

const BLANK_RECIPIENT = {
  firstName: "", lastName: "", email: "", phone: "", role: "evaluator",
  receivesResults: true, receivesStatus: false, receivesInvoices: false, canOrderTests: false,
};

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  // Default recipients
  const [recipients, setRecipients] = useState<DefaultRecipient[]>([]);
  const [showAddRecipient, setShowAddRecipient] = useState(false);
  const [recipientDraft, setRecipientDraft] = useState({ ...BLANK_RECIPIENT });
  const [savingRecipient, setSavingRecipient] = useState(false);

  const loadAccount = useCallback(() => {
    setLoading(true);
    fetch(`/api/accounts/${params.id}`)
      .then((r) => r.json())
      .then((data) => { setAccount(data); setLoading(false); })
      .catch((e) => { console.error("[account detail] load failed:", e); setLoading(false); });
  }, [params.id]);

  const loadRecipients = useCallback(() => {
    fetch(`/api/accounts/${params.id}/default-recipients`)
      .then((r) => r.json())
      .then(setRecipients)
      .catch((e) => console.error("[default-recipients] load failed:", e));
  }, [params.id]);

  useEffect(() => {
    loadAccount();
    loadRecipients();
  }, [loadAccount, loadRecipients]);

  async function saveRecipient() {
    if (!recipientDraft.firstName.trim() && !recipientDraft.lastName.trim()) return;
    setSavingRecipient(true);
    try {
      const res = await fetch(`/api/accounts/${params.id}/default-recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipientDraft),
      });
      if (res.ok) {
        setRecipientDraft({ ...BLANK_RECIPIENT });
        setShowAddRecipient(false);
        loadRecipients();
      }
    } finally {
      setSavingRecipient(false);
    }
  }

  async function removeRecipient(id: string) {
    if (!confirm("Remove this default recipient?")) return;
    await fetch(`/api/accounts/${params.id}/default-recipients?recipientId=${id}`, { method: "DELETE" });
    loadRecipients();
  }

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

          {/* Default Recipients */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                  Default Recipients
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Auto-added to every new case under this account</p>
              </div>
              <button
                onClick={() => setShowAddRecipient(true)}
                className="text-xs px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg font-medium hover:bg-[#2a5490]"
              >
                + Add
              </button>
            </div>

            {/* Add form */}
            {showAddRecipient && (
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-100">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">First Name</label>
                    <input
                      type="text"
                      value={recipientDraft.firstName}
                      onChange={(e) => setRecipientDraft((d) => ({ ...d, firstName: e.target.value }))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                      placeholder="First"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Last Name</label>
                    <input
                      type="text"
                      value={recipientDraft.lastName}
                      onChange={(e) => setRecipientDraft((d) => ({ ...d, lastName: e.target.value }))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                      placeholder="Last"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Email</label>
                    <input
                      type="email"
                      value={recipientDraft.email}
                      onChange={(e) => setRecipientDraft((d) => ({ ...d, email: e.target.value }))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                      placeholder="email@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Role</label>
                    <select
                      value={recipientDraft.role}
                      onChange={(e) => setRecipientDraft((d) => ({ ...d, role: e.target.value }))}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                    >
                      {Object.entries(ROLE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 mb-3">
                  {[
                    { key: "receivesResults", label: "Results" },
                    { key: "receivesInvoices", label: "Invoices" },
                    { key: "receivesStatus", label: "Status updates" },
                    { key: "canOrderTests", label: "Can order tests" },
                  ].map(({ key, label }) => (
                    <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={recipientDraft[key as keyof typeof recipientDraft] as boolean}
                        onChange={(e) => setRecipientDraft((d) => ({ ...d, [key]: e.target.checked }))}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-xs text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveRecipient}
                    disabled={savingRecipient}
                    className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded text-xs font-medium hover:bg-[#2a5490] disabled:opacity-50"
                  >
                    {savingRecipient ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => { setShowAddRecipient(false); setRecipientDraft({ ...BLANK_RECIPIENT }); }}
                    className="px-3 py-1.5 text-slate-500 text-xs hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {recipients.length === 0 && !showAddRecipient ? (
              <p className="p-5 text-sm text-slate-500">No default recipients yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recipients.map((r) => (
                  <li key={r.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {r.firstName} {r.lastName}
                        <span className="ml-2 text-[10px] font-normal text-slate-400 uppercase tracking-wide">
                          {ROLE_LABELS[r.role] || r.role}
                        </span>
                      </p>
                      {r.email && <p className="text-xs text-slate-500">{r.email}</p>}
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {r.receivesResults && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Results</span>
                        )}
                        {r.receivesInvoices && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Invoices</span>
                        )}
                        {r.receivesStatus && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Status</span>
                        )}
                        {r.canOrderTests && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Orders</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeRecipient(r.id)}
                      className="text-slate-300 hover:text-red-400 text-lg leading-none mt-0.5 shrink-0"
                      title="Remove"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
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
