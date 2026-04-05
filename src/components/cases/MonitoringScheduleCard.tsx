"use client";

import { useState, useEffect, useCallback } from "react";

type Selection = {
  id: string;
  selectedDate: string;
  status: string;
  notifiedAt: string | null;
  testOrder: { id: string; testStatus: string } | null;
};

type Schedule = {
  id: string;
  checkInPin: string;
  collectionType: string;
  patternType: string;
  targetCount: number;
  minSpacingDays: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  autoRescheduleOnMiss: boolean;
  autoRescheduleDays: number;
  testCatalog: { testName: string; specimenType: string };
  selections: Selection[];
};

type Props = {
  caseId: string;
  onChanged?: () => void;
};

function patternLabel(s: Schedule) {
  if (s.patternType === "range_count") return `${s.targetCount} tests over range`;
  if (s.patternType === "per_month") return `${s.targetCount}× per month`;
  if (s.patternType === "per_week") return `${s.targetCount}× per week`;
  return s.patternType;
}

function selectionStatusColor(status: string): string {
  if (status === "pending") return "bg-gray-100 text-gray-600";
  if (status === "notified") return "bg-blue-100 text-blue-700";
  if (status === "completed") return "bg-green-100 text-green-700";
  if (status === "refused") return "bg-red-100 text-red-700";
  if (status === "cancelled") return "bg-gray-100 text-gray-400 line-through";
  return "bg-gray-100 text-gray-600";
}

export function MonitoringScheduleCard({ caseId, onChanged }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  const loadSchedules = useCallback(() => {
    fetch(`/api/cases/${caseId}/monitoring-schedules`)
      .then((r) => r.json())
      .then((data) => { setSchedules(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [caseId]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  async function refuseSelection(selectionId: string) {
    const autoRescheduleStr = prompt("Auto-schedule replacement test? (yes/no)", "yes");
    if (!autoRescheduleStr) return;
    const autoReschedule = autoRescheduleStr.toLowerCase().startsWith("y");

    if (!confirm("This will mark as Refusal to Test and send an email. Continue?")) return;

    const res = await fetch(`/api/random-selections/${selectionId}/refuse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoReschedule }),
    });
    if (res.ok) {
      loadSchedules();
      onChanged?.();
    } else {
      alert("Failed to mark refusal");
    }
  }

  async function cancelSchedule(id: string) {
    if (!confirm("Cancel this schedule? All future pending selections will be cancelled.")) return;
    const res = await fetch(`/api/monitoring-schedules/${id}`, { method: "DELETE" });
    if (res.ok) { loadSchedules(); onChanged?.(); }
  }

  async function sendInstructions(id: string) {
    if (!confirm("Send random testing compliance instructions to the donor's email?")) return;
    const res = await fetch(`/api/monitoring-schedules/${id}/send-instructions`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      alert(`Instructions sent to ${data.sentTo.join(", ")}`);
    } else {
      alert(data.error || "Failed to send instructions");
    }
  }

  async function toggleActive(id: string, active: boolean) {
    const res = await fetch(`/api/monitoring-schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    if (res.ok) { loadSchedules(); onChanged?.(); }
  }

  if (loading) return <div className="text-sm text-gray-400 py-3">Loading schedules...</div>;
  if (schedules.length === 0) return null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return (
    <div className="space-y-4">
      {schedules.map((s) => {
        const upcoming = s.selections.filter((sel) => new Date(sel.selectedDate) >= today);
        const past = s.selections.filter((sel) => new Date(sel.selectedDate) < today);
        return (
          <div key={s.id} className={`border rounded-lg overflow-hidden ${s.active ? "border-gray-200" : "border-gray-200 opacity-60"}`}>
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">{s.testCatalog.testName}</h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  {patternLabel(s)} · {s.collectionType} · PIN: <span className="font-mono font-semibold text-gray-700">{s.checkInPin}</span>
                  {!s.active && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-xs font-medium">Paused</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(s.startDate).toLocaleDateString()} → {s.endDate ? new Date(s.endDate).toLocaleDateString() : "Ongoing"}
                  {s.minSpacingDays ? ` · ≥${s.minSpacingDays} days apart` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/reports/compliance/${s.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-white inline-flex items-center"
                  title="Open compliance report in a new tab"
                >
                  📋 Report
                </a>
                <button
                  onClick={() => sendInstructions(s.id)}
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                  title="Email PIN and compliance instructions to donor"
                >
                  ✉ Send Instructions
                </button>
                <button
                  onClick={() => toggleActive(s.id, s.active)}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-white"
                >
                  {s.active ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => cancelSchedule(s.id)}
                  className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div className="px-5 py-3">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Upcoming ({upcoming.length})</p>
              {upcoming.length === 0 ? (
                <p className="text-xs text-gray-400 mb-2">No upcoming selections</p>
              ) : (
                <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
                  {upcoming.map((sel) => (
                    <div key={sel.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                      <span className="text-gray-700">
                        {new Date(sel.selectedDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${selectionStatusColor(sel.status)}`}>{sel.status}</span>
                        {(sel.status === "pending" || sel.status === "notified") && (
                          <button
                            onClick={() => refuseSelection(sel.id)}
                            className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
                          >
                            Mark Refused
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {past.length > 0 && (
                <>
                  <button
                    onClick={() => setShowPast(!showPast)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {showPast ? "Hide" : "Show"} past selections ({past.length})
                  </button>
                  {showPast && (
                    <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                      {past.map((sel) => (
                        <div key={sel.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                          <span className="text-gray-600">
                            {new Date(sel.selectedDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${selectionStatusColor(sel.status)}`}>{sel.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
