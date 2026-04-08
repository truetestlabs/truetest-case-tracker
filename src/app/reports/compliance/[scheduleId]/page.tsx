"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useSearchParams } from "next/navigation";

type ComplianceEntry = {
  date: string;
  dayName: string;
  checkedIn: boolean;
  checkInTime: string | null;
  wasSelected: boolean;
  selectionStatus: string | null;
  outcome: "none" | "tested" | "refused" | "pending";
};

type ComplianceReport = {
  schedule: {
    scheduleId: string;
    caseId: string;
    caseNumber: string;
    donorName: string;
    testName: string;
    patternSummary: string;
    pin: string;
    startDate: string;
    endDate: string | null;
    collectionType: string;
  };
  period: { from: string; to: string };
  entries: ComplianceEntry[];
  summary: {
    totalWeekdays: number;
    checkInsMade: number;
    checkInsMissed: number;
    daysSelected: number;
    daysTested: number;
    daysRefused: number;
    checkInRate: number;
    complianceRate: number;
  };
};

function complianceColor(rate: number): string {
  if (rate >= 90) return "bg-green-100 text-green-800 border-green-300";
  if (rate >= 70) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-red-100 text-red-800 border-red-300";
}

function outcomeLabel(outcome: string, status: string | null): string {
  if (outcome === "tested") return "Tested ✓";
  if (outcome === "refused") return "Refused ✗";
  if (outcome === "pending") return `Pending (${status})`;
  return "";
}

function formatDateDisplay(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function ComplianceReportPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = use(params);
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(fromParam || "");
  const [to, setTo] = useState(toParam || "");

  const loadReport = useCallback(() => {
    setLoading(true);
    setError("");
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    fetch(`/api/monitoring-schedules/${scheduleId}/compliance-report?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        setReport(data);
        if (!from) setFrom(data.period.from);
        if (!to) setTo(data.period.to);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load report"); setLoading(false); });
  }, [scheduleId, from, to]);

  useEffect(() => { loadReport(); }, [scheduleId]); // eslint-disable-line react-hooks/exhaustive-deps

  function downloadCsv() {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("format", "csv");
    window.location.href = `/api/monitoring-schedules/${scheduleId}/compliance-report?${qs}`;
  }

  if (loading) return <div className="p-8 text-slate-500">Loading report...</div>;
  if (error || !report) return <div className="p-8 text-red-600">{error || "Report not found"}</div>;

  return (
    <div className="min-h-screen bg-white print:bg-white">
      <div className="max-w-5xl mx-auto px-8 py-8 print:px-0 print:py-0">
        {/* Action bar - hidden in print */}
        <div className="print:hidden mb-6 pb-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">From:</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm" />
            <label className="text-xs font-medium text-slate-600 ml-2">To:</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm" />
            <button onClick={loadReport}
              className="px-3 py-1 bg-slate-100 text-slate-700 rounded text-sm font-medium hover:bg-slate-200">
              Update
            </button>
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => window.print()}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700">
              🖨 Print / Save as PDF
            </button>
            <button onClick={() => {
              const qs = new URLSearchParams();
              if (from) qs.set("from", from);
              if (to) qs.set("to", to);
              qs.set("format", "pdf");
              window.location.href = `/api/monitoring-schedules/${scheduleId}/compliance-report?${qs}`;
            }}
              className="px-4 py-2 bg-red-700 text-white rounded text-sm font-semibold hover:bg-red-800">
              ⬇ Download PDF
            </button>
            <button onClick={downloadCsv}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded text-sm font-semibold hover:bg-slate-50">
              ⬇ Download CSV
            </button>
          </div>
        </div>

        {/* Header */}
        <div className="border-b-2 border-slate-900 pb-4 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">TrueTest Labs</p>
              <h1 className="text-2xl font-bold text-slate-900 mt-1">Random Testing Compliance Report</h1>
              <p className="text-sm text-slate-600 mt-1">Court-Ordered Drug & Alcohol Testing Monitoring</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>Generated: {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}</p>
              <p>{new Date().toLocaleTimeString()}</p>
            </div>
          </div>
        </div>

        {/* Case info */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Case</p>
            <p className="text-lg font-bold text-slate-900">{report.schedule.caseNumber}</p>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-3 mb-1">Donor</p>
            <p className="text-base font-semibold text-slate-900">{report.schedule.donorName}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Test Type</p>
            <p className="text-base font-semibold text-slate-900">{report.schedule.testName}</p>
            <p className="text-xs text-slate-600 capitalize">{report.schedule.collectionType}</p>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-3 mb-1">Schedule</p>
            <p className="text-sm text-slate-900">{report.schedule.patternSummary}</p>
            <p className="text-xs text-slate-600">
              {formatDateDisplay(report.schedule.startDate)} → {report.schedule.endDate ? formatDateDisplay(report.schedule.endDate) : "Ongoing"}
            </p>
          </div>
        </div>

        {/* Report period */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6 print:bg-white">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Report Period</p>
          <p className="text-base font-semibold text-slate-900">
            {formatDateDisplay(report.period.from)} through {formatDateDisplay(report.period.to)}
          </p>
          <p className="text-xs text-slate-600 mt-1">{report.summary.totalWeekdays} weekdays included</p>
        </div>

        {/* Summary stats */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-3">Summary</h2>
          <div className="grid grid-cols-5 gap-3">
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">Check-Ins Made</p>
              <p className="text-2xl font-bold text-slate-900">{report.summary.checkInsMade}</p>
              <p className="text-xs text-slate-500">of {report.summary.totalWeekdays}</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">Check-Ins Missed</p>
              <p className="text-2xl font-bold text-slate-900">{report.summary.checkInsMissed}</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">Days Selected</p>
              <p className="text-2xl font-bold text-slate-900">{report.summary.daysSelected}</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">Tested</p>
              <p className="text-2xl font-bold text-green-700">{report.summary.daysTested}</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">Refused</p>
              <p className="text-2xl font-bold text-red-700">{report.summary.daysRefused}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className={`border-2 rounded-lg p-4 ${complianceColor(report.summary.checkInRate)}`}>
              <p className="text-xs font-semibold uppercase tracking-wider">Check-In Rate</p>
              <p className="text-3xl font-bold mt-1">{report.summary.checkInRate}%</p>
              <p className="text-xs mt-1">Called in {report.summary.checkInsMade}/{report.summary.totalWeekdays} weekdays</p>
            </div>
            <div className={`border-2 rounded-lg p-4 ${complianceColor(report.summary.complianceRate)}`}>
              <p className="text-xs font-semibold uppercase tracking-wider">Compliance Rate</p>
              <p className="text-3xl font-bold mt-1">{report.summary.complianceRate}%</p>
              <p className="text-xs mt-1">Tested on {report.summary.daysTested}/{report.summary.daysSelected} selected days</p>
            </div>
          </div>
        </div>

        {/* Day-by-day table */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-3">Day-by-Day Log</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300 text-left">
                <th className="py-2 pr-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">Date</th>
                <th className="py-2 pr-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">Checked In</th>
                <th className="py-2 pr-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">Time</th>
                <th className="py-2 pr-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">Selected?</th>
                <th className="py-2 text-xs font-semibold text-slate-700 uppercase tracking-wider">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((e) => (
                <tr key={e.date} className={`border-b border-slate-100 ${e.wasSelected ? "bg-blue-50 print:bg-blue-50" : ""}`}>
                  <td className="py-2 pr-4">
                    <span className="font-medium text-slate-900">{e.dayName.slice(0, 3)} {formatDateDisplay(e.date)}</span>
                  </td>
                  <td className="py-2 pr-4">
                    {e.checkedIn
                      ? <span className="text-green-700 font-medium">✓ Yes</span>
                      : <span className="text-red-600 font-medium">✗ Missed</span>}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{e.checkInTime || "—"}</td>
                  <td className="py-2 pr-4">
                    {e.wasSelected
                      ? <span className="inline-block px-2 py-0.5 rounded bg-blue-200 text-blue-900 text-xs font-semibold">SELECTED</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-2">
                    {e.outcome === "tested" && <span className="text-green-700 font-semibold">Tested ✓</span>}
                    {e.outcome === "refused" && <span className="text-red-700 font-semibold">Refused ✗</span>}
                    {e.outcome === "pending" && <span className="text-amber-700">{outcomeLabel(e.outcome, e.selectionStatus)}</span>}
                    {e.outcome === "none" && <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-300 pt-4 mt-8 text-xs text-slate-500">
          <div className="flex justify-between">
            <div>
              <p className="font-semibold text-slate-700">TrueTest Labs</p>
              <p>2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007</p>
              <p>(847) 258-3966</p>
            </div>
            <div className="text-right">
              <p>This report is generated from direct check-in and selection records.</p>
              <p>Report period: {report.summary.totalWeekdays} weekdays</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
