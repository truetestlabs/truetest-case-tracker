"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { properCase } from "@/lib/format";

type Draft = {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  caseType: string;
  createdAt: string;
  reviewedAt: string | null;
  caseId: string | null;
};

export default function IntakesPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState("pending_review");

  useEffect(() => {
    fetch(`/api/kiosk/intakes${filter ? `?status=${filter}` : ""}`)
      .then((r) => r.json())
      .then((data) => { setDrafts(data.drafts || []); setPendingCount(data.pendingCount || 0); })
      .catch(() => {});
  }, [filter]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kiosk Intakes</h1>
          <p className="text-sm text-gray-500">{pendingCount} pending review</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { value: "pending_review", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "", label: "All" },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === tab.value ? "bg-[#1e3a5f] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Drafts list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {drafts.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">No intake drafts found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Donor</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Contact</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Submitted</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={d.id} className={`border-b border-gray-100 hover:bg-blue-50/50 transition-colors ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-gray-900">{properCase(d.lastName)}, {properCase(d.firstName)}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{d.caseType.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {d.phone && <p>{d.phone}</p>}
                    {d.email && <p>{d.email}</p>}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                    {new Date(d.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      d.status === "pending_review" ? "bg-amber-100 text-amber-700" :
                      d.status === "approved" ? "bg-green-100 text-green-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {d.status === "pending_review" ? "Pending" : d.status === "approved" ? "Approved" : "Rejected"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {d.status === "pending_review" ? (
                      <Link href={`/dashboard/intakes/${d.id}`} className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                        Review
                      </Link>
                    ) : d.caseId ? (
                      <Link href={`/cases/${d.caseId}`} className="text-xs font-medium text-gray-500 hover:text-blue-600">
                        View Case
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
