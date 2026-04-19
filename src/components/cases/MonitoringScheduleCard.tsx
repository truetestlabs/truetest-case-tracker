"use client";

import { useState, useEffect, useCallback } from "react";

type Selection = {
  id: string;
  selectedDate: string;
  status: string;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  testOrder: { id: string; testStatus: string } | null;
  documents: { id: string; fileName: string }[];
};

type Schedule = {
  id: string;
  caseId: string;
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

type TabId = "selections" | "details" | "call_log";

function patternLabel(s: Schedule) {
  if (s.patternType === "range_count") return `${s.targetCount} tests over range`;
  if (s.patternType === "per_month") return `${s.targetCount}× per month`;
  if (s.patternType === "per_week") return `${s.targetCount}× per week`;
  if (s.patternType === "every_n_days") return `every ${s.targetCount} days`;
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

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(d: string | Date) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MonitoringScheduleCard({ caseId, onChanged }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Record<string, TabId>>({});
  const [showPast, setShowPast] = useState<Record<string, boolean>>({});

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

  async function resendPin(id: string) {
    if (!confirm("Text and email the donor their PIN + portal link?")) return;
    const res = await fetch(`/api/monitoring-schedules/${id}/resend-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channels: ["sms", "email"] }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to send PIN reminder");
      return;
    }
    const parts: string[] = [];
    if (data.result?.sms?.ok) parts.push("SMS ✓");
    else if (data.result?.sms?.error === "no_phone_on_file") parts.push("SMS skipped (no phone on file)");
    else if (data.result?.sms?.error) parts.push(`SMS failed (${data.result.sms.error})`);

    if (data.result?.email?.to?.length) parts.push(`Email → ${data.result.email.to.join(", ")}`);
    else if (data.result?.email?.error === "no_email_on_file") parts.push("Email skipped (no email on file)");
    else if (data.result?.email?.error) parts.push(`Email failed (${data.result.email.error})`);

    alert(`PIN reminder sent:\n${parts.join("\n")}`);
  }

  async function attachOrderPdf(selectionId: string, scheduleCaseId: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        // 1. Presigned upload URL
        const uploadRes = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId: scheduleCaseId,
            fileName: file.name,
            contentType: "application/pdf",
            documentType: "monitoring_order",
          }),
        });
        if (!uploadRes.ok) {
          alert("Could not start upload");
          return;
        }
        const { uploadUrl, storagePath, headers } = await uploadRes.json();

        // 2. PUT file directly to Supabase
        const putRes = await fetch(uploadUrl, { method: "POST", headers, body: file });
        if (!putRes.ok) {
          alert("Upload failed");
          return;
        }

        // 3. Record the document on the selection
        const metaRes = await fetch(`/api/monitoring/selections/${selectionId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath, fileName: file.name }),
        });
        if (!metaRes.ok) {
          alert("Uploaded but failed to attach to selection");
          return;
        }
        loadSchedules();
        onChanged?.();
      } catch (err) {
        console.error(err);
        alert("Attach failed");
      }
    };
    input.click();
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
        const tab: TabId = activeTab[s.id] || "selections";
        const isPastShown = !!showPast[s.id];

        // Build a simple event timeline for the Call Log tab from the data we have.
        const events = s.selections
          .flatMap((sel) => {
            const entries: { when: string; label: string; detail: string; tone: "info" | "good" | "warn" }[] = [
              { when: sel.selectedDate, label: "Selected", detail: `Random pick — ${sel.status}`, tone: "info" },
            ];
            if (sel.notifiedAt) entries.push({ when: sel.notifiedAt, label: "Notified", detail: "Donor acknowledged via PIN check-in", tone: "good" });
            if (sel.status === "refused") entries.push({ when: sel.notifiedAt || sel.selectedDate, label: "Refusal", detail: "Marked as refusal to test", tone: "warn" });
            if (sel.status === "completed") entries.push({ when: sel.notifiedAt || sel.selectedDate, label: "Completed", detail: "Test collected", tone: "good" });
            return entries;
          })
          .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

        return (
          <div key={s.id} className={`border rounded-lg overflow-hidden bg-white ${s.active ? "border-gray-200" : "border-gray-200 opacity-60"}`}>
            {/* Header — always visible */}
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-semibold text-gray-900 leading-tight">{s.testCatalog.testName}</h4>
                {!s.active && <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] font-medium flex-shrink-0">Paused</span>}
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] text-gray-500">
                <span>{patternLabel(s)}</span>
                <span>PIN: <span className="font-mono font-semibold text-gray-700">{s.checkInPin}</span></span>
                <span>{new Date(s.startDate).toLocaleDateString()} → {s.endDate ? new Date(s.endDate).toLocaleDateString() : "Ongoing"}</span>
              </div>
              {/* Action buttons — 2x2 grid */}
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                <a
                  href={`/reports/compliance/${s.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-white text-center"
                >
                  📋 Report
                </a>
                <button
                  onClick={() => sendInstructions(s.id)}
                  className="text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  ✉ Instructions
                </button>
                <button
                  onClick={() => resendPin(s.id)}
                  className="text-[10px] px-2 py-1 rounded bg-slate-700 text-white hover:bg-slate-800"
                  title="Text + email the donor their PIN"
                >
                  🔑 Resend PIN
                </button>
                <button
                  onClick={() => toggleActive(s.id, s.active)}
                  className="text-[10px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-white"
                >
                  {s.active ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => cancelSchedule(s.id)}
                  className="text-[10px] px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-gray-200 bg-white">
              {(
                [
                  { id: "selections" as const, label: `Selections (${upcoming.length})` },
                  { id: "details" as const, label: "Details" },
                  { id: "call_log" as const, label: `Call Log (${events.length})` },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab((m) => ({ ...m, [s.id]: t.id }))}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    tab === t.id
                      ? "text-blue-700 border-b-2 border-blue-600 bg-blue-50/40"
                      : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab body */}
            <div className="px-5 py-3">
              {tab === "selections" && (
                <>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Upcoming ({upcoming.length})</p>
                  {upcoming.length === 0 ? (
                    <p className="text-xs text-gray-400 mb-2">No upcoming selections</p>
                  ) : (
                    <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
                      {upcoming.map((sel) => {
                        const hasPdf = sel.documents.length > 0;
                        return (
                        <div key={sel.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0 flex-wrap gap-1">
                          <span className="text-gray-700">{formatDate(sel.selectedDate)}</span>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${selectionStatusColor(sel.status)}`}>{sel.status}</span>
                            {sel.acknowledgedAt && (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700" title="Donor acknowledged in portal">
                                ✓ acked
                              </span>
                            )}
                            {hasPdf && (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700" title={sel.documents[0].fileName}>
                                PDF attached
                              </span>
                            )}
                            <button
                              onClick={() => attachOrderPdf(sel.id, s.caseId)}
                              className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                            >
                              {hasPdf ? "Replace PDF" : "Attach Order PDF"}
                            </button>
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
                      );})}
                    </div>
                  )}
                  {past.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowPast((m) => ({ ...m, [s.id]: !isPastShown }))}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {isPastShown ? "Hide" : "Show"} past selections ({past.length})
                      </button>
                      {isPastShown && (
                        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                          {past.map((sel) => (
                            <div key={sel.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                              <span className="text-gray-600">{formatDate(sel.selectedDate)}</span>
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${selectionStatusColor(sel.status)}`}>{sel.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {tab === "details" && (
                <dl className="text-xs space-y-2">
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                    <dt className="text-gray-500">Test</dt>
                    <dd className="text-gray-900 font-medium">{s.testCatalog.testName}</dd>

                    <dt className="text-gray-500">Specimen type</dt>
                    <dd className="text-gray-900 capitalize">{s.testCatalog.specimenType}</dd>

                    <dt className="text-gray-500">Collection</dt>
                    <dd className="text-gray-900 capitalize">{s.collectionType}</dd>

                    <dt className="text-gray-500">Pattern</dt>
                    <dd className="text-gray-900">{patternLabel(s)}</dd>

                    <dt className="text-gray-500">Date range</dt>
                    <dd className="text-gray-900">
                      {new Date(s.startDate).toLocaleDateString()} → {s.endDate ? new Date(s.endDate).toLocaleDateString() : <span className="italic text-gray-500">Ongoing</span>}
                    </dd>

                    {s.minSpacingDays ? (
                      <>
                        <dt className="text-gray-500">Min spacing</dt>
                        <dd className="text-gray-900">{s.minSpacingDays} day{s.minSpacingDays === 1 ? "" : "s"} apart</dd>
                      </>
                    ) : null}

                    <dt className="text-gray-500">Check-in PIN</dt>
                    <dd className="text-gray-900 font-mono font-semibold">{s.checkInPin}</dd>

                    <dt className="text-gray-500">Auto-reschedule on miss</dt>
                    <dd className="text-gray-900">
                      {s.autoRescheduleOnMiss ? `Yes — ${s.autoRescheduleDays} business day${s.autoRescheduleDays === 1 ? "" : "s"} later` : "No"}
                    </dd>

                    <dt className="text-gray-500">Status</dt>
                    <dd className="text-gray-900">{s.active ? "Active" : "Paused"}</dd>
                  </div>
                </dl>
              )}

              {tab === "call_log" && (
                <>
                  {events.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">No activity yet</p>
                  ) : (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto">
                      {events.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-gray-100 last:border-0">
                          <span className="text-gray-500 w-32 flex-shrink-0">{formatDateTime(e.when)}</span>
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                              e.tone === "good"
                                ? "bg-green-100 text-green-700"
                                : e.tone === "warn"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {e.label}
                          </span>
                          <span className="text-gray-700">{e.detail}</span>
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
