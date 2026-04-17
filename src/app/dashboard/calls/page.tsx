"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type TranscriptEntry = { role: "agent" | "caller" | "system"; text: string; at: string };

type Call = {
  id: string;
  twilioCallSid: string;
  fromNumber: string;
  callerName: string | null;
  callbackNumber: string | null;
  intent: string | null;
  segment: string | null;
  urgency: string | null;
  language: string | null;
  outcome: string | null;
  summary: string | null;
  transcript: TranscriptEntry[] | null;
  durationSec: number | null;
  recapSmsSentAt: string | null;
  startedAt: string;
  endedAt: string | null;
  matchedCase: { id: string; caseNumber: string } | null;
};

const OUTCOME_STYLES: Record<string, string> = {
  message_taken: "bg-green-100 text-green-700",
  booked_appointment: "bg-green-100 text-green-700",
  status_given: "bg-blue-100 text-blue-700",
  transferred: "bg-amber-100 text-amber-700",
  hung_up: "bg-gray-100 text-gray-600",
  failed: "bg-red-100 text-red-700",
};

const URGENCY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  normal: "bg-gray-100 text-gray-600",
  low: "bg-gray-50 text-gray-500",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

function fmtDuration(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPhone(p: string) {
  const d = p.replace(/\D/g, "").replace(/^1/, "");
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Call | null>(null);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter) params.set("outcome", filter);
      const res = await fetch(`/api/calls?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCalls(data.calls || []);
      }
      setLoading(false);
    }
    load();
  }, [filter]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Phone Calls</h1>
          <p className="text-sm text-gray-500">
            Inbound calls the virtual receptionist answered after no-answer forwarding.
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {["", "message_taken", "hung_up", "failed"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f ? "bg-[#1e3a5f] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "" ? "All" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : calls.length === 0 ? (
        <div className="text-sm text-gray-400 bg-white border border-gray-200 rounded-lg p-8 text-center">
          No calls yet. Once the Twilio number is wired up, calls will appear here.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">When</th>
                <th className="text-left px-4 py-2 font-semibold">Caller</th>
                <th className="text-left px-4 py-2 font-semibold">Intent</th>
                <th className="text-left px-4 py-2 font-semibold">Outcome</th>
                <th className="text-left px-4 py-2 font-semibold">Duration</th>
                <th className="text-left px-4 py-2 font-semibold">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calls.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtTime(c.startedAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{c.callerName || "Unknown"}</div>
                    <div className="text-xs text-gray-500">{fmtPhone(c.callbackNumber || c.fromNumber)}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs">
                    <div className="flex flex-wrap gap-1">
                      {c.intent && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                          {c.intent.replace("_", " ")}
                        </span>
                      )}
                      {c.segment && c.segment !== "unknown" && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                          {c.segment.replace("_", " ")}
                        </span>
                      )}
                      {c.urgency && (
                        <span className={`px-1.5 py-0.5 rounded ${URGENCY_STYLES[c.urgency] || "bg-gray-100 text-gray-600"}`}>
                          {c.urgency}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.outcome ? (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          OUTCOME_STYLES[c.outcome] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {c.outcome.replace("_", " ")}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtDuration(c.durationSec)}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-md truncate" title={c.summary || ""}>
                    {c.summary || <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <CallDetail call={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CallDetail({ call, onClose }: { call: Call; onClose: () => void }) {
  const turns = Array.isArray(call.transcript) ? call.transcript : [];
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">AI Call</p>
            <p className="text-lg font-bold text-gray-900 mt-1">
              {call.callerName || "Unknown caller"} · {fmtPhone(call.callbackNumber || call.fromNumber)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {fmtTime(call.startedAt)} · {fmtDuration(call.durationSec)}
              {call.outcome ? ` · ${call.outcome.replace("_", " ")}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
            ✕
          </button>
        </div>

        {call.summary && (
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50/40">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1">Summary</p>
            <p className="text-sm text-gray-800">{call.summary}</p>
          </div>
        )}

        <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap gap-2">
          {call.intent && (
            <span className="px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-700">
              intent: {call.intent.replace("_", " ")}
            </span>
          )}
          {call.segment && (
            <span className="px-2 py-0.5 rounded bg-indigo-50 text-xs text-indigo-700">
              segment: {call.segment.replace("_", " ")}
            </span>
          )}
          {call.urgency && (
            <span className={`px-2 py-0.5 rounded text-xs ${URGENCY_STYLES[call.urgency] || "bg-gray-100 text-gray-600"}`}>
              urgency: {call.urgency}
            </span>
          )}
          {call.language && (
            <span className="px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-700">
              lang: {call.language}
            </span>
          )}
          {call.recapSmsSentAt && (
            <span className="px-2 py-0.5 rounded bg-green-50 text-xs text-green-700">recap SMS sent</span>
          )}
          {call.matchedCase && (
            <Link
              href={`/cases/${call.matchedCase.id}`}
              className="px-2 py-0.5 rounded bg-blue-50 text-xs text-blue-700 hover:bg-blue-100"
            >
              {call.matchedCase.caseNumber} →
            </Link>
          )}
        </div>

        <div className="px-6 py-4 flex-1 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Transcript</p>
          {turns.length === 0 ? (
            <p className="text-sm text-gray-400">No transcript captured.</p>
          ) : (
            <div className="space-y-2">
              {turns
                .filter((t) => t.role !== "system")
                .map((t, i) => (
                  <div
                    key={i}
                    className={`flex ${t.role === "agent" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        t.role === "agent"
                          ? "bg-gray-100 text-gray-900"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider opacity-60 mb-0.5">
                        {t.role}
                      </p>
                      <p>{t.text}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl text-xs text-gray-500">
          Call SID: <span className="font-mono">{call.twilioCallSid}</span>
        </div>
      </div>
    </div>
  );
}
