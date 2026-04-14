"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Phase = "form" | "success";

type TestOption = { id: string; testName: string; category: string; specimenType: string };

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  caseType: "court_ordered" | "voluntary";
  apptDate: string;
  apptTime: string;
  testCatalogId: string;
};

type CreatedCase = {
  id: string;
  caseNumber: string;
  donor: {
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
};

function getDefaults(): Pick<FormState, "apptDate" | "apptTime"> {
  const now = new Date();
  const apptDate = now.toISOString().split("T")[0];
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  const apptTime = nextHour.toTimeString().slice(0, 5);
  return { apptDate, apptTime };
}

function buildGCalUrl(params: {
  firstName: string;
  lastName: string;
  phone: string | null;
  caseNumber: string;
  apptDate: string;
  apptTime: string;
}): string {
  // Split manually — do NOT use new Date("YYYY-MM-DD"):
  // browsers parse bare date strings as UTC midnight, which shifts the time
  // backward in negative-offset timezones (e.g. Chicago is UTC-5/UTC-6).
  const [y, mo, d] = params.apptDate.split("-").map(Number);
  const [h, min] = params.apptTime.split(":").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  // No "Z" suffix = floating local time (Google Calendar honors the device's timezone)
  const start = `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(min)}00`;
  const endH = h + 1 < 24 ? h + 1 : 23;
  const endMin = h + 1 < 24 ? min : 59;
  const end = `${y}${pad(mo)}${pad(d)}T${pad(endH)}${pad(endMin)}00`;

  const title = encodeURIComponent(`TrueTest Labs — ${params.firstName} ${params.lastName}`);
  const details = encodeURIComponent(
    `Case No. ${params.caseNumber}\nPhone: ${params.phone ?? "N/A"}\nTrueTest Labs`
  );
  const loc = encodeURIComponent("2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007");

  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${title}&dates=${start}/${end}&details=${details}&location=${loc}`
  );
}

const HEADER = (
  <div
    className="px-5 py-4 flex items-center gap-3"
    style={{ background: "linear-gradient(180deg, #1a3352 0%, #162c47 100%)" }}
  >
    <span className="text-xl">⚡</span>
    <div>
      <h1 className="text-base font-semibold text-white leading-tight">Quick Intake</h1>
      <p className="text-xs text-white/50">TrueTest Labs</p>
    </div>
  </div>
);

export default function QuickIntakePage() {
  const defaults = getDefaults();
  const [phase, setPhase] = useState<Phase>("form");
  const [form, setForm] = useState<FormState>({
    firstName: "",
    lastName: "",
    phone: "",
    caseType: "voluntary",
    apptDate: defaults.apptDate,
    apptTime: defaults.apptTime,
    testCatalogId: "",
  });
  const [tests, setTests] = useState<TestOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createdCase, setCreatedCase] = useState<CreatedCase | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // Fetch test catalog on mount
  useEffect(() => {
    fetch("/api/test-catalog")
      .then((r) => r.json())
      .then((data: TestOption[]) => setTests(data))
      .catch((e) => console.error("[page.tsx] background fetch failed:", e));
  }, []);

  // Re-focus first name when form resets (handles iOS Safari autoFocus blocking)
  useEffect(() => {
    if (phase === "form") {
      const t = setTimeout(() => firstNameRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [phase]);

  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseType: form.caseType,
          donor: {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            phone: form.phone.trim() || null,
          },
          apptDate: form.apptDate || null,
          apptTime: form.apptTime || null,
          testCatalogId: form.testCatalogId || null,
        }),
      });

      const data = await res.json();

      // Case was reopened — redirect to existing case
      if (data.reopened) {
        window.location.href = `/cases/${data.caseId}`;
        return;
      }

      // Donor already has an active case — show link
      if (res.status === 409) {
        const caseId = data.existingCaseId || data.duplicates?.[0]?.id;
        const caseNum = data.existingCaseNumber || data.duplicates?.[0]?.caseNumber || "";
        throw new Error(`This donor already has an active case (${caseNum}). Go to: /cases/${caseId}`);
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to create case");
      }

      setCreatedCase(data as CreatedCase);
      setPhase("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    const d = getDefaults();
    setForm({
      firstName: "",
      lastName: "",
      phone: "",
      caseType: "voluntary",
      apptDate: d.apptDate,
      apptTime: d.apptTime,
      testCatalogId: "",
    });
    setCreatedCase(null);
    setError("");
    setPhase("form");
  }

  const inputClass =
    "w-full px-4 py-3.5 text-base border border-gray-300 rounded-xl " +
    "focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent " +
    "bg-white shadow-sm outline-none";

  if (phase === "success" && createdCase) {
    const donorFirst = createdCase.donor?.firstName ?? form.firstName;
    const donorLast = createdCase.donor?.lastName ?? form.lastName;
    const donorPhone = createdCase.donor?.phone ?? null;

    const calUrl = buildGCalUrl({
      firstName: donorFirst,
      lastName: donorLast,
      phone: donorPhone,
      caseNumber: createdCase.caseNumber,
      apptDate: form.apptDate,
      apptTime: form.apptTime,
    });

    // Format date/time for display
    const [apptY, apptMo, apptD] = form.apptDate.split("-").map(Number);
    const [apptH, apptMin] = form.apptTime.split(":").map(Number);
    const displayDate = new Date(apptY, apptMo - 1, apptD).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const displayTime = new Date(apptY, apptMo - 1, apptD, apptH, apptMin).toLocaleTimeString(
      "en-US",
      { hour: "numeric", minute: "2-digit" }
    );

    return (
      <div className="min-h-screen flex flex-col bg-[#f8fafc]">
        {HEADER}

        <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-4">
          {/* Success card */}
          <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">✅</span>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                  Case Created
                </p>
                <p className="text-2xl font-bold text-[#1e3a5f]">{createdCase.caseNumber}</p>
              </div>
            </div>
            <div className="space-y-1 text-sm text-gray-600 border-t border-gray-100 pt-3">
              <p className="font-semibold text-gray-900 text-base">
                {donorFirst} {donorLast}
              </p>
              {donorPhone && <p className="text-gray-500">{donorPhone}</p>}
              <p className="text-gray-500">
                {form.caseType === "court_ordered" ? "Court-Ordered" : "Voluntary"} &bull;{" "}
                {displayDate} at {displayTime}
              </p>
            </div>
          </div>

          {/* Primary action — Add to Google Calendar */}
          <a
            href={calUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl
                       text-base font-semibold text-white shadow-md
                       active:scale-[0.98] transition-all"
            style={{ background: "#d4a843" }}
          >
            <span>📅</span> Add to Google Calendar
          </a>

          {/* Secondary actions */}
          <div className="grid grid-cols-2 gap-3">
            <Link
              href={`/cases/${createdCase.id}`}
              className="flex items-center justify-center gap-1.5 py-3.5
                         bg-white border border-gray-300 text-gray-700 text-sm font-medium
                         rounded-xl hover:bg-gray-50 active:scale-[0.98] transition-all shadow-sm"
            >
              Open Full Case →
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="py-3.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium
                         rounded-xl hover:bg-gray-50 active:scale-[0.98] transition-all shadow-sm"
            >
              + New Intake
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Form phase
  const canSubmit = form.firstName.trim().length > 0 && form.lastName.trim().length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      {HEADER}

      <div className="flex-1 px-4 py-5 space-y-4 max-w-lg mx-auto w-full">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {/* First Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            ref={firstNameRef}
            type="text"
            autoFocus
            autoComplete="given-name"
            autoCapitalize="words"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            className={inputClass}
            placeholder="Jane"
          />
        </div>

        {/* Last Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            autoComplete="family-name"
            autoCapitalize="words"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            className={inputClass}
            placeholder="Smith"
          />
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Phone{" "}
            <span className="text-gray-400 font-normal text-xs">(optional)</span>
          </label>
          <input
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className={inputClass}
            placeholder="(555) 000-0000"
          />
        </div>

        {/* Case Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Case Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(["voluntary", "court_ordered"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm((f) => ({ ...f, caseType: type }))}
                className={`py-3.5 rounded-xl text-sm font-semibold transition-all ${
                  form.caseType === type
                    ? "text-white shadow-md"
                    : "bg-white border border-gray-300 text-gray-600 hover:border-[#1e3a5f]"
                }`}
                style={
                  form.caseType === type ? { background: "#1e3a5f" } : {}
                }
              >
                {type === "voluntary" ? "Voluntary" : "Court-Ordered"}
              </button>
            ))}
          </div>
        </div>

        {/* Test Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Test Type{" "}
            <span className="text-gray-400 font-normal text-xs">(optional)</span>
          </label>
          <select
            value={form.testCatalogId}
            onChange={(e) => setForm((f) => ({ ...f, testCatalogId: e.target.value }))}
            className={inputClass}
          >
            <option value="">— Select a test —</option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.testName}
              </option>
            ))}
          </select>
        </div>

        {/* Appointment Date + Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Appt. Date</label>
            <input
              type="date"
              value={form.apptDate}
              onChange={(e) => setForm((f) => ({ ...f, apptDate: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Appt. Time</label>
            <input
              type="time"
              value={form.apptTime}
              onChange={(e) => setForm((f) => ({ ...f, apptTime: e.target.value }))}
              className={inputClass}
            />
          </div>
        </div>

        {/* Submit */}
        <button
          type="button"
          disabled={loading || !canSubmit}
          onClick={handleSubmit}
          className="w-full py-4 text-white rounded-xl text-base font-semibold
                     hover:opacity-90 active:scale-[0.98] disabled:opacity-40
                     transition-all shadow-lg mt-2"
          style={{ background: "#1e3a5f" }}
        >
          {loading ? "Creating Case…" : "Create Case"}
        </button>
      </div>
    </div>
  );
}
