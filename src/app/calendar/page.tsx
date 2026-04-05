"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

type Selection = {
  id: string;
  selectedDate: string;
  status: string;
  schedule: {
    id: string;
    caseId: string;
    collectionType: string;
    case: {
      id: string;
      caseNumber: string;
      donor: { firstName: string; lastName: string } | null;
    };
    testCatalog: { testName: string; specimenType: string };
  };
};

function statusColor(status: string): string {
  if (status === "pending") return "bg-slate-200 text-slate-700";
  if (status === "notified") return "bg-blue-200 text-blue-800";
  if (status === "completed") return "bg-green-200 text-green-800";
  if (status === "refused") return "bg-red-200 text-red-800";
  return "bg-gray-200 text-gray-600";
}

function buildCalendarGrid(year: number, month: number): (Date | null)[] {
  // month is 0-indexed. Build 6 rows × 7 columns = 42 cells
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const dayOfWeek = firstOfMonth.getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < dayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month, d)));
  while (cells.length < 42) cells.push(null);
  return cells;
}

function fmtMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selections, setSelections] = useState<Selection[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSelections = useCallback(() => {
    setLoading(true);
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
    fetch(`/api/random-selections?month=${monthStr}`)
      .then((r) => r.json())
      .then((data) => { setSelections(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { loadSelections(); }, [loadSelections]);

  function prev() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }
  function next() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }
  function goToday() {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
  }

  const cells = buildCalendarGrid(year, month);

  // Group selections by date key
  const byDate = new Map<string, Selection[]>();
  for (const sel of selections) {
    const key = sel.selectedDate.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(sel);
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Random Testing Calendar</h1>
          <p className="text-sm text-slate-500 mt-0.5">{selections.length} selection{selections.length !== 1 ? "s" : ""} this month</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prev} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">←</button>
          <button onClick={goToday} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">Today</button>
          <button onClick={next} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">→</button>
          <span className="ml-3 text-lg font-semibold text-slate-900 min-w-[160px]">{fmtMonth(year, month)}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-xs font-semibold text-slate-600 text-center uppercase tracking-wider">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={idx} className="min-h-[110px] border-r border-b border-slate-100 bg-slate-50/30" />;
            const key = dateKey(cell);
            const daySelections = byDate.get(key) || [];
            const isToday = key === todayKey;
            return (
              <div key={idx} className={`min-h-[110px] border-r border-b border-slate-100 p-1.5 ${isToday ? "bg-blue-50" : ""}`}>
                <div className={`text-xs font-semibold mb-1 ${isToday ? "text-blue-700" : "text-slate-500"}`}>
                  {cell.getUTCDate()}
                </div>
                <div className="space-y-1">
                  {daySelections.map((sel) => {
                    const donor = sel.schedule.case.donor;
                    const name = donor ? `${donor.lastName}, ${donor.firstName[0]}.` : "—";
                    return (
                      <Link
                        key={sel.id}
                        href={`/cases/${sel.schedule.case.id}`}
                        className={`block text-xs px-1.5 py-0.5 rounded truncate hover:ring-2 hover:ring-blue-400 transition-all ${statusColor(sel.status)}`}
                        title={`${name} · ${sel.schedule.testCatalog.testName} · ${sel.status}`}
                      >
                        {name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {loading && <div className="text-center text-slate-400 py-6">Loading...</div>}

      <div className="mt-4 flex items-center gap-4 text-xs text-slate-600">
        <span>Legend:</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-slate-200"></span>Pending</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-blue-200"></span>Notified</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-200"></span>Completed</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-200"></span>Refused</span>
      </div>
    </div>
  );
}
