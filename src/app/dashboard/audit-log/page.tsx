"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AuditEntry = {
  id: string;
  action: string;
  resource: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: { email: string; name: string };
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  login: { label: "Login", color: "bg-blue-100 text-blue-700" },
  logout: { label: "Logout", color: "bg-gray-100 text-gray-600" },
  login_failed: { label: "Login Failed", color: "bg-red-100 text-red-700" },
  view_case: { label: "View Case", color: "bg-gray-100 text-gray-600" },
  create_case: { label: "Create Case", color: "bg-green-100 text-green-700" },
  update_case: { label: "Update Case", color: "bg-amber-100 text-amber-700" },
  delete_case: { label: "Delete Case", color: "bg-red-100 text-red-700" },
  close_case: { label: "Close Case", color: "bg-gray-100 text-gray-600" },
  create_test_order: { label: "Create Test", color: "bg-green-100 text-green-700" },
  update_test_order: { label: "Update Test", color: "bg-amber-100 text-amber-700" },
  delete_test_order: { label: "Delete Test", color: "bg-red-100 text-red-700" },
  upload_document: { label: "Upload Doc", color: "bg-green-100 text-green-700" },
  download_document: { label: "Download Doc", color: "bg-blue-100 text-blue-700" },
  delete_document: { label: "Delete Doc", color: "bg-red-100 text-red-700" },
  release_results: { label: "Release Results", color: "bg-purple-100 text-purple-700" },
  release_mro: { label: "Release MRO", color: "bg-purple-100 text-purple-700" },
  create_appointment: { label: "Book Appt", color: "bg-green-100 text-green-700" },
  cancel_appointment: { label: "Cancel Appt", color: "bg-red-100 text-red-700" },
  send_email: { label: "Send Email", color: "bg-blue-100 text-blue-700" },
  approve_intake: { label: "Approve Intake", color: "bg-green-100 text-green-700" },
  create_contact: { label: "Create Contact", color: "bg-green-100 text-green-700" },
  update_contact: { label: "Update Contact", color: "bg-amber-100 text-amber-700" },
};

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter) params.set("action", filter);
      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
      setLoading(false);
    }
    load();
  }, [filter]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500">Track all user actions across the system</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", "login", "create_case", "delete_case", "upload_document", "release_results", "create_appointment"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f ? "bg-[#1e3a5f] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "" ? "All" : ACTION_LABELS[f]?.label || f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">No audit entries found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Time</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">User</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Action</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Resource</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const actionInfo = ACTION_LABELS[e.action] || { label: e.action, color: "bg-gray-100 text-gray-600" };
                const caseNumber = (e.metadata as Record<string, string>)?.caseNumber;
                return (
                  <tr key={e.id} className={`border-b border-gray-100 ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                    <td className="px-5 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                      {new Date(e.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-gray-700 font-medium">{e.user.name}</td>
                    <td className="px-5 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${actionInfo.color}`}>
                        {actionInfo.label}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-gray-500">
                      {e.resource && e.resourceId ? (
                        e.resource === "case" && caseNumber ? (
                          <Link href={`/cases/${e.resourceId}`} className="text-blue-600 hover:underline">{caseNumber}</Link>
                        ) : (
                          <span>{e.resource}: {e.resourceId.slice(0, 8)}...</span>
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-gray-400 max-w-[200px] truncate">
                      {e.metadata ? JSON.stringify(e.metadata).slice(0, 80) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
