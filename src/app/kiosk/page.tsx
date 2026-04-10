"use client";

import { useState, useEffect, useCallback } from "react";
import { AttorneySearch } from "./components/AttorneySearch";
import { CourtOrderUpload } from "./components/CourtOrderUpload";

type FormData = {
  // Step 1
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  existingDonorId: string | null;
  // Step 2
  caseType: string; // court_ordered | voluntary | by_agreement
  courtCaseNumber: string;
  county: string;
  judgeName: string;
  hasCourtOrder: boolean;
  courtOrderPath: string | null;
  // Step 3
  hasAttorney: boolean;
  attorneys: Array<{ name: string; firm: string; email: string; phone: string; role?: string; contactId?: string }>;
  hasGal: boolean;
  galInfo: { name: string; firm: string; email: string; phone: string; contactId?: string } | null;
  orderedBy: string;
  paymentResponsibility: string;
  // Step 4
  communicationConsent: boolean;
  notes: string;
};

const INITIAL_FORM: FormData = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  existingDonorId: null,
  caseType: "",
  courtCaseNumber: "",
  county: "",
  judgeName: "",
  hasCourtOrder: false,
  courtOrderPath: null,
  hasAttorney: false,
  attorneys: [],
  hasGal: false,
  galInfo: null,
  orderedBy: "",
  paymentResponsibility: "",
  communicationConsent: false,
  notes: "",
};

const STEPS = ["Your Info", "Visit Type", "Legal Contacts", "Complete"];
const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE = 60 * 1000; // show warning 60s before timeout

export default function KioskPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [showTimeout, setShowTimeout] = useState(false);

  // Returning donor state
  const [donorChecked, setDonorChecked] = useState(false);
  const [donorFound, setDonorFound] = useState(false);
  const [donorEditing, setDonorEditing] = useState(false);

  // Activity tracking
  const touch = useCallback(() => {
    setLastActivity(Date.now());
    setShowTimeout(false);
  }, []);

  useEffect(() => {
    const events = ["touchstart", "mousedown", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, touch));
  }, [touch]);

  // Inactivity timeout
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivity;
      if (elapsed > INACTIVITY_TIMEOUT) {
        // Reset
        setForm(INITIAL_FORM);
        setStep(1);
        setSubmitted(false);
        setDonorChecked(false);
        setDonorFound(false);
        setShowTimeout(false);
        try { localStorage.removeItem("kiosk-draft"); } catch { /* */ }
      } else if (elapsed > INACTIVITY_TIMEOUT - WARNING_BEFORE) {
        setShowTimeout(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [lastActivity]);

  // Auto-save to localStorage
  useEffect(() => {
    if (!submitted) {
      try { localStorage.setItem("kiosk-draft", JSON.stringify({ step, form })); } catch { /* */ }
    }
  }, [step, form, submitted]);

  // Load draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kiosk-draft");
      if (saved) {
        const { step: s, form: f } = JSON.parse(saved);
        setStep(s);
        setForm(f);
      }
    } catch { /* */ }
  }, []);

  // Check for returning donor
  async function checkDonor() {
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    try {
      const res = await fetch(`/api/kiosk/donor-check?firstName=${encodeURIComponent(form.firstName.trim())}&lastName=${encodeURIComponent(form.lastName.trim())}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found) {
          setForm((prev) => ({
            ...prev,
            phone: data.phone || prev.phone,
            email: data.email || prev.email,
            existingDonorId: data.contactId,
          }));
          setDonorFound(true);
        }
      }
    } catch { /* silent */ }
    setDonorChecked(true);
  }

  // Submit intake
  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/kiosk/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Submission failed");
      }
      setSubmitted(true);
      try { localStorage.removeItem("kiosk-draft"); } catch { /* */ }
      // Auto-reset after 60 seconds
      setTimeout(() => {
        setForm(INITIAL_FORM);
        setStep(1);
        setSubmitted(false);
        setDonorChecked(false);
        setDonorFound(false);
      }, 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setSubmitting(false);
  }

  function updateForm(updates: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...updates }));
  }

  function canAdvance(): boolean {
    if (step === 1) return !!form.firstName.trim() && !!form.lastName.trim();
    if (step === 2) return !!form.caseType;
    if (step === 3) return true; // all optional
    return true;
  }

  // Thank you / submitted screen
  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-white">
        <div className="max-w-lg text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Thank You!</h1>
          <p className="text-lg text-gray-600 mb-8">A technician will be with you shortly.</p>

          {/* Communication opt-in */}
          <div className="bg-gray-50 rounded-2xl p-6 mb-8 text-left">
            <p className="text-base text-gray-700 mb-4">
              We&apos;d like to text/email you helpful information about your test and your case. Do you consent?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  updateForm({ communicationConsent: true });
                  // Fire update to backend
                  fetch("/api/kiosk/intake", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, communicationConsent: true }),
                  }).catch(() => {});
                }}
                className={`flex-1 py-4 rounded-xl text-lg font-bold transition-all ${form.communicationConsent ? "bg-green-600 text-white" : "bg-white border-2 border-gray-200 text-gray-700 hover:border-green-500"}`}
              >
                Yes, please
              </button>
              <button
                onClick={() => updateForm({ communicationConsent: false })}
                className={`flex-1 py-4 rounded-xl text-lg font-bold transition-all ${!form.communicationConsent ? "bg-gray-200 text-gray-600" : "bg-white border-2 border-gray-200 text-gray-700"}`}
              >
                No thanks
              </button>
            </div>
          </div>

          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700">(847) 258-3966</p>
            <p>2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white" onClick={touch}>
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="TrueTest Labs" className="h-10" />
        </div>
        <p className="text-sm text-gray-400">Client Intake</p>
      </div>

      {/* Progress Bar */}
      <div className="px-8 pt-6 pb-2 flex-shrink-0">
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          {STEPS.map((label, i) => {
            const stepNum = i + 1;
            const isComplete = step > stepNum;
            const isCurrent = step === stepNum;
            return (
              <div key={label} className="flex-1">
                <div className={`h-2 rounded-full transition-all ${isComplete ? "bg-[#7AB928]" : isCurrent ? "bg-[#7AB928]/60" : "bg-gray-200"}`} />
                <p className={`text-xs mt-1 text-center ${isCurrent ? "text-[#7AB928] font-semibold" : "text-gray-400"}`}>{label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto">

          {/* Step 1: Your Info */}
          {step === 1 && (
            <div>
              <h2 className="text-2xl font-bold text-[#4A4A4A] mb-1">Welcome to TrueTest Labs</h2>
              <p className="text-gray-500 mb-8">Please enter your information below.</p>

              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">First Name *</label>
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={(e) => { updateForm({ firstName: e.target.value }); setDonorChecked(false); setDonorFound(false); }}
                      className="w-full text-lg p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                      placeholder="First name"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">Last Name *</label>
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={(e) => { updateForm({ lastName: e.target.value }); setDonorChecked(false); setDonorFound(false); }}
                      onBlur={checkDonor}
                      className="w-full text-lg p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                      placeholder="Last name"
                      autoComplete="off"
                    />
                  </div>
                </div>

                {/* Returning donor banner */}
                {donorChecked && donorFound && !donorEditing && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-green-800 font-semibold mb-1">Welcome back!</p>
                    <p className="text-green-700 text-sm mb-3">We found your info on file. Is everything still correct?</p>
                    <div className="text-sm text-gray-700 space-y-1 mb-3">
                      {form.phone && <p>Phone: {form.phone}</p>}
                      {form.email && <p>Email: {form.email}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setDonorEditing(false)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">Looks good</button>
                      <button onClick={() => setDonorEditing(true)} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700">Update my info</button>
                    </div>
                  </div>
                )}

                {(!donorFound || donorEditing) && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1.5">Phone Number</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => updateForm({ phone: e.target.value })}
                        className="w-full text-lg p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        placeholder="(312) 555-1234"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1.5">Email Address</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => updateForm({ email: e.target.value })}
                        className="w-full text-lg p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        placeholder="your@email.com"
                        autoComplete="off"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Visit Type */}
          {step === 2 && (
            <div>
              <h2 className="text-2xl font-bold text-[#4A4A4A] mb-1">Type of Visit</h2>
              <p className="text-gray-500 mb-8">Please select one.</p>

              <div className="grid grid-cols-3 gap-4 mb-8">
                {[
                  { value: "court_ordered", label: "Court Ordered", desc: "Required by a judge or court" },
                  { value: "voluntary", label: "Personal", desc: "Your own decision to test" },
                  { value: "by_agreement", label: "By Agreement", desc: "Agreed between parties" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateForm({ caseType: opt.value })}
                    className={`p-5 rounded-xl border-2 text-left transition-all min-h-[100px] ${form.caseType === opt.value ? "border-[#7AB928] bg-green-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                  >
                    <p className={`text-lg font-bold ${form.caseType === opt.value ? "text-[#7AB928]" : "text-gray-800"}`}>{opt.label}</p>
                    <p className="text-sm text-gray-500 mt-1">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Court order fields */}
              {form.caseType === "court_ordered" && (
                <div className="space-y-5 border-t border-gray-100 pt-6">
                  <p className="text-base font-semibold text-gray-700">Court Order Details (optional)</p>

                  <CourtOrderUpload
                    onUploaded={(path) => updateForm({ courtOrderPath: path, hasCourtOrder: true })}
                    uploadedPath={form.courtOrderPath}
                  />

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1.5">Court Case #</label>
                      <input
                        type="text"
                        value={form.courtCaseNumber}
                        onChange={(e) => updateForm({ courtCaseNumber: e.target.value })}
                        className="w-full text-base p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        placeholder="e.g., 2024 D 080196"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1.5">County</label>
                      <input
                        type="text"
                        value={form.county}
                        onChange={(e) => updateForm({ county: e.target.value })}
                        className="w-full text-base p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        placeholder="e.g., Cook"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1.5">Judge Name</label>
                      <input
                        type="text"
                        value={form.judgeName}
                        onChange={(e) => updateForm({ judgeName: e.target.value })}
                        className="w-full text-base p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        placeholder="e.g., Hon. Mitchell Goldberg"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Legal Contacts */}
          {step === 3 && (
            <div>
              <h2 className="text-2xl font-bold text-[#4A4A4A] mb-1">Legal Contacts</h2>
              <p className="text-gray-500 mb-8">Help us connect the right people to your case.</p>

              {/* Attorney */}
              <div className="mb-8">
                <p className="text-base font-semibold text-gray-700 mb-3">Do you have an attorney?</p>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => updateForm({ hasAttorney: true })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${form.hasAttorney ? "border-[#7AB928] bg-green-50 text-[#7AB928]" : "border-gray-200 text-gray-700"}`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => updateForm({ hasAttorney: false, attorneys: [] })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${!form.hasAttorney ? "border-gray-400 bg-gray-50 text-gray-600" : "border-gray-200 text-gray-700"}`}
                  >
                    No
                  </button>
                </div>
                {form.hasAttorney && (
                  <AttorneySearch
                    type="attorney"
                    label="Attorney"
                    value={form.attorneys[0] || null}
                    onChange={(atty) => updateForm({ attorneys: atty ? [atty] : [] })}
                  />
                )}
              </div>

              {/* GAL */}
              <div className="mb-8">
                <p className="text-base font-semibold text-gray-700 mb-3">Is there a Guardian ad Litem (GAL)?</p>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => updateForm({ hasGal: true })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${form.hasGal ? "border-[#7AB928] bg-green-50 text-[#7AB928]" : "border-gray-200 text-gray-700"}`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => updateForm({ hasGal: false, galInfo: null })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${!form.hasGal ? "border-gray-400 bg-gray-50 text-gray-600" : "border-gray-200 text-gray-700"}`}
                  >
                    No
                  </button>
                </div>
                {form.hasGal && (
                  <AttorneySearch
                    type="gal"
                    label="GAL"
                    value={form.galInfo || null}
                    onChange={(gal) => updateForm({ galInfo: gal })}
                  />
                )}
              </div>

              {/* Who ordered / who pays */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-base font-semibold text-gray-700 mb-3">Who ordered this test?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["Attorney", "Judge", "Self", "Other"].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => updateForm({ orderedBy: opt.toLowerCase() })}
                        className={`py-3 rounded-xl text-sm font-semibold border-2 transition-all ${form.orderedBy === opt.toLowerCase() ? "border-[#7AB928] bg-green-50 text-[#7AB928]" : "border-gray-200 text-gray-700"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-700 mb-3">Who is responsible for payment?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["Self", "Attorney", "Other Party", "Unknown"].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => updateForm({ paymentResponsibility: opt.toLowerCase().replace(/ /g, "_") })}
                        className={`py-3 rounded-xl text-sm font-semibold border-2 transition-all ${form.paymentResponsibility === opt.toLowerCase().replace(/ /g, "_") ? "border-[#7AB928] bg-green-50 text-[#7AB928]" : "border-gray-200 text-gray-700"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Anything else we should know?</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateForm({ notes: e.target.value })}
                  className="w-full text-base p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                  rows={3}
                  placeholder="Optional notes..."
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex-shrink-0 px-8 py-5 bg-white border-t border-gray-100">
        <div className="max-w-2xl mx-auto flex gap-4">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-4 rounded-xl text-lg font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              onClick={() => { if (canAdvance()) setStep(step + 1); }}
              disabled={!canAdvance()}
              className="flex-1 py-4 rounded-xl text-lg font-bold bg-[#7AB928] text-white hover:bg-[#6aa322] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          ) : step === 3 ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 py-4 rounded-xl text-lg font-bold bg-[#7AB928] text-white hover:bg-[#6aa322] disabled:opacity-50 transition-colors"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          ) : null}
        </div>
        {error && <p className="text-center text-red-600 text-sm mt-2">{error}</p>}
      </div>

      {/* Inactivity Warning */}
      {showTimeout && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-8">
          <div className="bg-white rounded-2xl p-8 max-w-sm text-center shadow-2xl">
            <p className="text-xl font-bold text-gray-900 mb-3">Are you still there?</p>
            <p className="text-gray-600 mb-6">Your session will reset in 60 seconds.</p>
            <button
              onClick={touch}
              className="w-full py-4 rounded-xl text-lg font-bold bg-[#7AB928] text-white"
            >
              I&apos;m still here
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
