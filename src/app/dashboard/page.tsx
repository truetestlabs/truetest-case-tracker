"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDonorName } from "@/lib/format";

type RecentCase = {
  id: string;
  caseNumber: string;
  caseType: string;
  caseStatus: string;
  hasCourtOrder: boolean;
  updatedAt: string;
  donor: { firstName: string; lastName: string } | null;
  testOrders: { paymentMethod: string | null }[];
  _count: { testOrders: number };
};

type Stats = {
  totalCases: number;
  activeCases: number;
  closedCases: number;
  totalTestOrders: number;
  awaitingPayment: number;
  noShowsThisMonth: number;
  recentCases: RecentCase[];
};

function getInitials(donor: { firstName: string; lastName: string } | null) {
  if (!donor) return "?";
  return `${donor.firstName[0] ?? ""}${donor.lastName[0] ?? ""}`.toUpperCase();
}

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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalCases: 0, activeCases: 0, closedCases: 0, totalTestOrders: 0,
    awaitingPayment: 0, noShowsThisMonth: 0, recentCases: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function loadStats() {
      fetch("/api/dashboard")
        .then((res) => res.json())
        .then((data) => { setStats(data); setLoading(false); })
        .catch(() => setLoading(false));
    }
    loadStats();
    const interval = setInterval(loadStats, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") loadStats(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const statCards = [
    {
      label: "Open Cases",
      value: stats.activeCases,
      icon: <FolderOpenIcon className="w-5 h-5" />,
      iconBg: "bg-emerald-500",
      iconColor: "text-white",
      valueColor: "text-emerald-700",
      href: "/cases",
    },
    {
      label: "Total Cases",
      value: stats.totalCases,
      icon: <BriefcaseIcon className="w-5 h-5" />,
      iconBg: "bg-blue-500",
      iconColor: "text-white",
      valueColor: "text-blue-700",
      href: "/cases",
    },
    {
      label: "Test Orders",
      value: stats.totalTestOrders,
      icon: <ClipboardIcon className="w-5 h-5" />,
      iconBg: "bg-indigo-500",
      iconColor: "text-white",
      valueColor: "text-indigo-700",
    },
    {
      label: "Awaiting Payment",
      value: stats.awaitingPayment,
      icon: <AlertIcon className="w-5 h-5" />,
      iconBg: "bg-amber-500",
      iconColor: "text-white",
      valueColor: "text-amber-700",
      alert: stats.awaitingPayment > 0,
    },
    {
      label: "No Shows (Month)",
      value: stats.noShowsThisMonth,
      icon: <XCircleIcon className="w-5 h-5" />,
      iconBg: "bg-red-500",
      iconColor: "text-white",
      valueColor: "text-red-600",
    },
  ];

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1">{today}</p>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/cases/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-150 hover:brightness-110"
            style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2a5490 100%)" }}
          >
            <PlusIcon className="w-4 h-4" />
            New Case
          </Link>
          <Link
            href="/cases/upload-order"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150"
          >
            <UploadIcon className="w-4 h-4" />
            Upload Order
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading dashboard…</p>
          </div>
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
            {statCards.map((card) => {
              const inner = (
                <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all duration-150 hover:-translate-y-0.5">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${card.iconBg} ${card.iconColor}`}>
                      {card.icon}
                    </div>
                    {card.alert && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                        Action needed
                      </span>
                    )}
                  </div>
                  <p className={`text-3xl font-bold ${card.valueColor}`}>{card.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">{card.label}</p>
                </div>
              );
              return card.href ? <Link href={card.href} key={card.label}>{inner}</Link> : <div key={card.label}>{inner}</div>;
            })}
          </div>

          {/* Today's Random Selections */}
          <TodaysSelections />

          {/* Recent Cases */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Recent Cases</h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                  {stats.recentCases.length}
                </span>
              </div>
              <Link href="/cases" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1">
                View all <ChevronRightIcon className="w-3 h-3" />
              </Link>
            </div>

            {stats.recentCases.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                  <BriefcaseIcon className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600 mb-1">No cases yet</p>
                <Link href="/cases/new" className="text-xs text-blue-600 hover:underline">Create your first case</Link>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left border-b border-slate-100" style={{ background: "#f8fafc" }}>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Case #</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Donor</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Court Order</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tests</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentCases.map((c, i) => {
                    const donorName = c.donor ? `${c.donor.firstName} ${c.donor.lastName}` : "";
                    const initials = getInitials(c.donor);
                    const color = avatarColor(donorName);
                    return (
                      <tr key={c.id} className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/50 transition-colors ${i % 2 === 1 ? "bg-slate-50/50" : ""}`}>
                        <td className="px-5 py-2.5">
                          <Link href={`/cases/${c.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                            {c.caseNumber}
                          </Link>
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${color}`}>
                              {initials}
                            </div>
                            <span className="text-sm text-slate-800">
                              {c.donor ? formatDonorName(c.donor) : <span className="text-slate-400">—</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-600 capitalize">
                          {c.caseType.replace(/_/g, " ")}
                        </td>
                        <td className="px-5 py-2.5">
                          {c.hasCourtOrder ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                              <CheckIcon className="w-3 h-3" /> Yes
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                              No
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          {(() => {
                            const method = c.testOrders?.[0]?.paymentMethod;
                            if (!method) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">Unpaid</span>;
                            if (method === "invoiced") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">Invoiced</span>;
                            return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">Paid</span>;
                          })()}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                            {c._count.testOrders}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-400">
                          {new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Icons
function PlusIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function UploadIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}
function FolderOpenIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
}
function BriefcaseIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
}
function ClipboardIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>;
}
function AlertIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function XCircleIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
}
function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>;
}
function ChevronRightIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>;
}

type TodaySelection = {
  id: string;
  status: string;
  schedule: {
    caseId: string;
    case: {
      caseNumber: string;
      donor: { firstName: string; lastName: string } | null;
    };
    testCatalog: { testName: string };
  };
};

function TodaysSelections() {
  const [selections, setSelections] = useState<TodaySelection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    fetch(`/api/random-selections?date=${dateStr}`)
      .then((r) => r.json())
      .then((data) => { setSelections(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading || selections.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Today&apos;s Random Selections</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
            {selections.length}
          </span>
        </div>
        <Link href="/calendar" className="text-xs font-medium text-blue-600 hover:text-blue-700">Calendar →</Link>
      </div>
      <div className="divide-y divide-slate-100">
        {selections.map((sel) => {
          const donor = sel.schedule.case.donor;
          const name = donor ? `${donor.lastName}, ${donor.firstName}` : "—";
          return (
            <Link key={sel.id} href={`/cases/${sel.schedule.caseId}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-900 text-sm">{name}</span>
                <span className="text-xs text-slate-500">{sel.schedule.case.caseNumber}</span>
                <span className="text-xs text-slate-400">{sel.schedule.testCatalog.testName}</span>
              </div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${sel.status === "notified" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                {sel.status}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
