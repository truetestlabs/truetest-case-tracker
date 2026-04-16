"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountSelect } from "@/components/accounts/AccountSelect";

/**
 * Staff-facing phone intake page — optimized for booking an appointment
 * while on the phone with a new client. Goal is ~60 seconds from "hi" to
 * "you're booked."
 *
 * Flow:
 *  1. Search (optional) — pulls up an existing donor
 *  2. Basics form — name, phone, email, case type, test types, notes
 *  3. Slot picker — day tabs + 30-min slot grid
 *  4. Book it — routes through /api/kiosk/intake so it gets change-detection
 *     + one-case-per-donor dedup for free, then creates the Appointment row,
 *     then fires a Twilio confirmation SMS (fire-and-forget).
 */

type DonorResult = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
};

type Slot = {
  start: string;
  end: string;
  status: "available" | "booked" | "past";
  appointmentId?: string;
};

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  caseType: "" | "court_ordered" | "by_agreement" | "voluntary";
  testTypes: string[];
  notes: string;
  existingDonorId: string | null;
  referringAccountId: string | null;
};

const INITIAL_FORM: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  caseType: "",
  testTypes: [],
  notes: "",
  existingDonorId: null,
  referringAccountId: null,
};

const CASE_TYPES = [
  { value: "court_ordered", label: "Court-Ordered" },
  { value: "by_agreement", label: "By Agreement" },
  { value: "voluntary", label: "Voluntary" },
] as const;

const TEST_TYPES = [
  { value: "urine", label: "Urine" },
  { value: "hair", label: "Hair" },
  { value: "blood_peth", label: "PEth Blood" },
  { value: "sweat_patch", label: "Sweat Patch" },
] as const;

function fmtDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Build the 6-week grid for a given month — always 42 cells starting on
 * Sunday of the week containing the 1st, so every month renders with a
 * stable layout.
 */
function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

export default function PhoneIntakePage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  // Donor search
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<DonorResult[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>(null);

  // Warm the donor-search endpoint on mount so the first real search
  // doesn't pay the Supabase cold-connection tax (~2s from idle).
  useEffect(() => {
    fetch("/api/contacts?type=donor&limit=1&q=__warmup__").catch((e) => console.error("[page.tsx] background fetch failed:", e));
  }, []);

  // Month calendar + slot picker
  const today = new Date();
  const [viewYear, setViewYear] = useState<number>(today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const monthGrid = buildMonthGrid(viewYear, viewMonth);

  function goPrevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }
  function goNextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }
  function goToday() {
    const n = new Date();
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth());
    setSelectedDay(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ caseId: string; caseNumber: string; slot: Slot } | null>(null);

  // Donor search debounce — hits /api/contacts?type=donor&q=...
  useEffect(() => {
    if (!search.trim() || search.length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      setSearching(false);
      return;
    }
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    setSearching(true);
    setShowSearchDropdown(true); // show the dropdown immediately so the "Searching…" row is visible
    searchDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?type=donor&limit=8&q=${encodeURIComponent(search)}`);
        if (!res.ok) {
          console.warn("[phone-intake] contact search failed:", res.status);
          setSearching(false);
          return;
        }
        const data = await res.json();
        const results = Array.isArray(data) ? data.slice(0, 8) : [];
        setSearchResults(results);
        setSearching(false);
      } catch (e) {
        console.warn("[phone-intake] contact search error:", e);
        setSearching(false);
      }
    }, 120);
  }, [search]);

  // Load slots when day changes
  useEffect(() => {
    async function load() {
      setLoadingSlots(true);
      setSelectedSlot(null);
      try {
        const res = await fetch(`/api/appointments/availability?date=${fmtDateKey(selectedDay)}`);
        if (res.ok) {
          const data = await res.json();
          setSlots(data.slots || []);
        } else {
          setSlots([]);
        }
      } catch {
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    }
    load();
  }, [selectedDay]);

  function selectDonor(d: DonorResult) {
    setForm((f) => ({
      ...f,
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.phone || "",
      email: d.email || "",
      existingDonorId: d.id,
    }));
    setSearch(`${d.firstName} ${d.lastName}`);
    setShowSearchDropdown(false);
  }

  function clearDonor() {
    setForm(INITIAL_FORM);
    setSearch("");
    setSearchResults([]);
    setSelectedSlot(null);
    setError("");
  }

  function toggleTestType(value: string) {
    setForm((f) => ({
      ...f,
      testTypes: f.testTypes.includes(value)
        ? f.testTypes.filter((t) => t !== value)
        : [...f.testTypes, value],
    }));
  }

  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.caseType &&
    form.testTypes.length > 0 &&
    selectedSlot &&
    !submitting;

  async function bookIt() {
    if (!canSubmit || !selectedSlot) return;
    setSubmitting(true);
    setError("");
    try {
      // 1. Submit to the kiosk intake pipeline — reuses change-detection +
      //    one-case-per-donor + approveDraft path. For returning clients with
      //    no changes, the draft is auto-approved on POST.
      const draftRes = await fetch("/api/kiosk/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          existingDonorId: form.existingDonorId,
          caseType: form.caseType,
          testTypes: form.testTypes,
          notes: form.notes.trim() || null,
        }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft.error || "Failed to create intake");

      // 2. Figure out the caseId. If the intake auto-approved, we have it
      //    directly. Otherwise approve it now (phone-intake never parks in
      //    the review queue — staff is on the phone, data is trusted).
      let caseId = draft.caseId as string | undefined;
      let caseNumber = draft.caseNumber as string | undefined;
      if (!caseId) {
        const approveRes = await fetch(`/api/kiosk/intakes/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", reviewedBy: "phone-intake" }),
        });
        const approve = await approveRes.json();
        if (!approveRes.ok) throw new Error(approve.error || "Failed to approve intake");
        caseId = approve.caseId;
        caseNumber = approve.caseNumber;
      }

      // 3. Apply referring account + auto-add default recipients (fire-and-forget)
      if (form.referringAccountId && caseId) {
        fetch(`/api/cases/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referringAccountId: form.referringAccountId }),
        }).catch((e) => console.error("[phone-intake] account patch failed:", e));
      }

      // 4. Create the appointment — race check happens server-side
      const apptRes = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: selectedSlot.start,
          caseId,
          donorId: form.existingDonorId || undefined,
          notes: form.notes.trim() || null,
          createdBy: "phone-intake",
        }),
      });
      const apptData = await apptRes.json();
      if (!apptRes.ok) {
        throw new Error(apptData.error || "Failed to book appointment");
      }
      const appointmentId: string = apptData.appointment.id;

      // 4. Fire confirmation SMS + email (fire-and-forget — failure must
      //    never affect the booking). Send whichever contact methods we have.
      if (form.phone.trim()) {
        fetch("/api/appointments/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId }),
        }).catch((e) => console.error("[page.tsx] SMS fire-and-forget failed:", e));
      }
      if (form.email.trim()) {
        fetch("/api/appointments/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId }),
        }).catch((e) => console.error("[page.tsx] email fire-and-forget failed:", e));
      }

      // 5. Success state
      setResult({
        caseId: caseId!,
        caseNumber: caseNumber || "",
        slot: selectedSlot,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function startNew() {
    setResult(null);
    setForm(INITIAL_FORM);
    setSearch("");
    setSelectedSlot(null);
    setError("");
    // Reload slots for the currently-selected day so the just-booked slot
    // flips to "booked"
    fetch(`/api/appointments/availability?date=${fmtDateKey(selectedDay)}`)
      .then((r) => r.json())
      .then((d) => setSlots(d.slots || []))
      .catch((e) => console.error("[page.tsx] background fetch failed:", e));
  }

  // Success screen
  if (result) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl border-2 border-green-200 shadow-sm p-8 text-center">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Appointment Booked</p>
          <p className="text-3xl font-bold text-[#1e3a5f] mb-2">{result.caseNumber}</p>
          <p className="text-base text-gray-700 mb-1">
            {form.firstName} {form.lastName}
          </p>
          <p className="text-base text-gray-700 mb-6">
            {new Date(result.slot.start).toLocaleString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          {(form.phone || form.email) && (
            <div className="text-sm text-gray-500 mb-6 space-y-1">
              {form.phone && <p>📱 Confirmation SMS sent to {form.phone}</p>}
              {form.email && <p>✉️ Confirmation email sent to {form.email}</p>}
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <Link
              href={`/cases/${result.caseId}`}
              className="px-5 py-3 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50"
            >
              Open Case →
            </Link>
            <button
              onClick={startNew}
              className="px-5 py-3 bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl hover:bg-[#162c47]"
            >
              + New Intake
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phone Intake</h1>
          <p className="text-sm text-gray-500">Quick booking while on the call with a new client</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      )}

      {/* Donor search */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Find existing donor (optional)
        </label>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowSearchDropdown(true)}
            onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
            placeholder="Search by name, phone, or email…"
            className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            autoComplete="off"
          />
          {showSearchDropdown && (searching || searchResults.length > 0 || search.length >= 2) && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto">
              {searching && (
                <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-[#1e3a5f] rounded-full animate-spin" />
                  Searching…
                </div>
              )}
              {!searching && searchResults.length === 0 && search.length >= 2 && (
                <div className="px-4 py-3 text-sm text-gray-400">
                  No donors match &ldquo;{search}&rdquo;
                </div>
              )}
              {!searching && searchResults.map((d) => (
                <button
                  key={d.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectDonor(d)}
                  className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                >
                  <p className="font-semibold text-gray-900">
                    {d.firstName} {d.lastName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {d.phone || "no phone"} • {d.email || "no email"}
                  </p>
                </button>
              ))}
            </div>
          )}
          {form.existingDonorId && (
            <p className="mt-2 text-xs text-green-700 font-medium">
              ✓ Returning donor — form pre-filled.{" "}
              <button onClick={clearDonor} className="underline">
                Clear
              </button>
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Basics form */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Basics</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                autoComplete="given-name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                autoComplete="family-name"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              placeholder="(555) 000-0000"
              autoComplete="tel"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              placeholder="name@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Case Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {CASE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, caseType: t.value }))}
                  className={`py-3 rounded-xl text-sm font-semibold transition-all ${
                    form.caseType === t.value
                      ? "bg-[#1e3a5f] text-white shadow-md"
                      : "bg-white border border-gray-300 text-gray-600 hover:border-[#1e3a5f]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Account <span className="text-gray-400 font-normal">(optional)</span></label>
            <AccountSelect
              value={form.referringAccountId}
              onChange={(id) => setForm((f) => ({ ...f, referringAccountId: id }))}
              placeholder="No referring account"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Test Type(s) *</label>
            <div className="grid grid-cols-2 gap-2">
              {TEST_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => toggleTestType(t.value)}
                  className={`py-3 rounded-xl text-sm font-semibold transition-all ${
                    form.testTypes.includes(t.value)
                      ? "bg-[#7AB928] text-white shadow-md"
                      : "bg-white border border-gray-300 text-gray-600 hover:border-[#7AB928]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full text-sm p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f] resize-none"
              placeholder="Any notes from the call…"
            />
          </div>
        </div>

        {/* Slot picker */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Pick an appointment
          </h2>

          {/* Month header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrevMonth}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-600 text-lg flex items-center justify-center"
                aria-label="Previous month"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={goNextMonth}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-600 text-lg flex items-center justify-center"
                aria-label="Next month"
              >
                ›
              </button>
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </p>
            <button
              type="button"
              onClick={goToday}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1e3a5f] text-white hover:bg-[#162c47]"
            >
              Today
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW_HEADERS.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-semibold text-gray-400 uppercase">
                {d}
              </div>
            ))}
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {monthGrid.map((d) => {
              const isCurrentMonth = d.getMonth() === viewMonth;
              const isSelected = fmtDateKey(d) === fmtDateKey(selectedDay);
              const isToday = fmtDateKey(d) === fmtDateKey(today);
              const dow = d.getDay();
              const isWeekend = dow === 0 || dow === 6;
              const isPast =
                d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
              const disabled = isWeekend || isPast;
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedDay(new Date(d))}
                  className={`aspect-square rounded-lg text-xs font-semibold transition-colors ${
                    isSelected
                      ? "bg-[#1e3a5f] text-white"
                      : disabled
                      ? "text-gray-300 cursor-not-allowed"
                      : !isCurrentMonth
                      ? "text-gray-300 hover:bg-gray-50"
                      : isToday
                      ? "bg-amber-50 text-amber-900 hover:bg-amber-100"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Slot grid */}
          {loadingSlots ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading slots…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No slots available.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots
                .filter((s) => s.status !== "past")
                .map((s) => {
                  const isSelected = selectedSlot?.start === s.start;
                  const isBooked = s.status === "booked";
                  return (
                    <button
                      key={s.start}
                      type="button"
                      disabled={isBooked}
                      onClick={() => setSelectedSlot(s)}
                      className={`py-3 rounded-lg text-sm font-semibold transition-all ${
                        isBooked
                          ? "bg-gray-100 text-gray-400 cursor-not-allowed line-through"
                          : isSelected
                          ? "bg-[#7AB928] text-white shadow-md"
                          : "bg-white border border-gray-300 text-gray-700 hover:border-[#7AB928]"
                      }`}
                    >
                      {fmtSlotTime(s.start)}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Book it */}
      <div className="mt-6 flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="text-sm text-gray-500">
          {selectedSlot ? (
            <>
              Booking{" "}
              <span className="font-semibold text-gray-900">
                {new Date(selectedSlot.start).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </>
          ) : (
            "Pick a slot above"
          )}
        </div>
        <button
          onClick={bookIt}
          disabled={!canSubmit}
          className="px-6 py-3 bg-[#1e3a5f] text-white rounded-xl text-base font-bold hover:bg-[#162c47] disabled:opacity-40 transition-all shadow-md"
        >
          {submitting ? "Booking…" : "Book it"}
        </button>
      </div>
    </div>
  );
}
