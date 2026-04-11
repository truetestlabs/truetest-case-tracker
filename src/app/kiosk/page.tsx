"use client";

import { useState, useEffect, useCallback } from "react";
import { AttorneySearch } from "./components/AttorneySearch";

type FormData = {
  // Step 1
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  existingDonorId: string | null;
  // Step 2
  caseType: string; // court_ordered | voluntary | by_agreement
  testTypes: string[]; // urine | hair | blood_peth | sweat_patch
  additionalRecipients: Array<{ name: string; email: string }>;
  // Step 3
  hasAttorney: boolean;
  attorneyName: string;
  attorneyEmail: string;
  attorneyContactId: string | null;
  attorneyFirm: string;
  attorneyPhone: string;
  hasGal: boolean;
  galName: string;
  galEmail: string;
  galContactId: string | null;
  galFirm: string;
  galPhone: string;
  hasEvaluator: boolean;
  evaluatorName: string;
  evaluatorEmail: string;
  evaluatorContactId: string | null;
  evaluatorFirm: string;
  evaluatorPhone: string;
  // Returning-client pre-fill tracking
  prefilledFromCaseNumber: string | null;
  prefilledAttorney: boolean;
  prefilledGal: boolean;
  prefilledEvaluator: boolean;
  hadMultipleAttorneysOnPreviousCase: boolean;
  hadMultipleEvaluatorsOnPreviousCase: boolean;
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
  testTypes: [],
  additionalRecipients: [],
  hasAttorney: false,
  attorneyName: "",
  attorneyEmail: "",
  attorneyContactId: null,
  attorneyFirm: "",
  attorneyPhone: "",
  hasGal: false,
  galName: "",
  galEmail: "",
  galContactId: null,
  galFirm: "",
  galPhone: "",
  hasEvaluator: false,
  evaluatorName: "",
  evaluatorEmail: "",
  evaluatorContactId: null,
  evaluatorFirm: "",
  evaluatorPhone: "",
  prefilledFromCaseNumber: null,
  prefilledAttorney: false,
  prefilledGal: false,
  prefilledEvaluator: false,
  hadMultipleAttorneysOnPreviousCase: false,
  hadMultipleEvaluatorsOnPreviousCase: false,
  communicationConsent: false,
  notes: "",
};

const STEPS = ["Your Info", "Visit Type", "Legal Contacts", "Complete"];
const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE = 60 * 1000; // show warning 60s before timeout
// Bump whenever FormData shape changes so stale drafts get discarded on next load
const KIOSK_DRAFT_VERSION = 2;

export default function KioskPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [optInResponded, setOptInResponded] = useState(false);
  const [error, setError] = useState("");
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [showTimeout, setShowTimeout] = useState(false);

  // Returning donor state
  const [donorChecked, setDonorChecked] = useState(false);
  const [donorFound, setDonorFound] = useState(false);
  const [donorEditing, setDonorEditing] = useState(false);
  const [donorConfirmed, setDonorConfirmed] = useState(false);

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
        setOptInResponded(false);
        setDonorChecked(false);
        setDonorFound(false);
        setDonorConfirmed(false);
        setShowTimeout(false);
        try { localStorage.removeItem("kiosk-draft"); } catch { /* */ }
      } else if (elapsed > INACTIVITY_TIMEOUT - WARNING_BEFORE) {
        setShowTimeout(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [lastActivity]);

  // Auto-save to localStorage (versioned so stale drafts can be discarded)
  useEffect(() => {
    if (!submitted) {
      try {
        localStorage.setItem("kiosk-draft", JSON.stringify({
          version: KIOSK_DRAFT_VERSION,
          step,
          form,
        }));
      } catch { /* */ }
    }
  }, [step, form, submitted]);

  // Load draft on mount — with version gate, merge into INITIAL_FORM, and
  // auto re-check returning-donor data so fresh attorney/GAL/evaluator pre-fill
  // flows in even when the draft predates those features.
  useEffect(() => {
    let restoredFirstName = "";
    let restoredLastName = "";
    try {
      const saved = localStorage.getItem("kiosk-draft");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.version === KIOSK_DRAFT_VERSION && parsed.form) {
          setStep(parsed.step || 1);
          // Merge into INITIAL_FORM so any new fields get their defaults
          setForm({ ...INITIAL_FORM, ...parsed.form });
          restoredFirstName = (parsed.form.firstName || "").trim();
          restoredLastName = (parsed.form.lastName || "").trim();
        } else {
          // Schema mismatch or malformed — discard the stale draft
          localStorage.removeItem("kiosk-draft");
        }
      }
    } catch {
      localStorage.removeItem("kiosk-draft");
    }

    // If the restored draft already had a name, re-query the returning-donor API
    // to pick up fresh attorney/GAL/evaluator data. We call the API directly here
    // instead of checkDonor() because checkDonor() reads from the closure's `form`
    // state, which hasn't been updated yet this render cycle.
    if (restoredFirstName && restoredLastName) {
      (async () => {
        try {
          const res = await fetch(`/api/kiosk/donor-check?firstName=${encodeURIComponent(restoredFirstName)}&lastName=${encodeURIComponent(restoredLastName)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (!data.found) return;
          const firstAttorney = data.attorneys?.[0];
          const galInfo = data.gal;
          const firstEvaluator = data.evaluators?.[0];
          setForm((prev) => ({
            ...prev,
            phone: data.phone || prev.phone,
            email: data.email || prev.email,
            existingDonorId: data.contactId,
            prefilledFromCaseNumber: data.mostRecentCaseNumber || null,
            hadMultipleAttorneysOnPreviousCase: !!data.hadMultipleAttorneys,
            hadMultipleEvaluatorsOnPreviousCase: !!data.hadMultipleEvaluators,
            ...(firstAttorney && {
              hasAttorney: true,
              attorneyName: firstAttorney.name,
              attorneyEmail: firstAttorney.email || "",
              attorneyContactId: firstAttorney.contactId,
              attorneyFirm: firstAttorney.firm || "",
              attorneyPhone: firstAttorney.phone || "",
              prefilledAttorney: true,
            }),
            ...(galInfo && {
              hasGal: true,
              galName: galInfo.name,
              galEmail: galInfo.email || "",
              galContactId: galInfo.contactId,
              galFirm: galInfo.firm || "",
              galPhone: galInfo.phone || "",
              prefilledGal: true,
            }),
            ...(firstEvaluator && {
              hasEvaluator: true,
              evaluatorName: firstEvaluator.name,
              evaluatorEmail: firstEvaluator.email || "",
              evaluatorContactId: firstEvaluator.contactId,
              evaluatorFirm: firstEvaluator.firm || "",
              evaluatorPhone: firstEvaluator.phone || "",
              prefilledEvaluator: true,
            }),
          }));
          setDonorChecked(true);
          setDonorFound(true);
        } catch { /* silent */ }
      })();
    }
  }, []);

  // Check for returning donor
  async function checkDonor() {
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    try {
      const res = await fetch(`/api/kiosk/donor-check?firstName=${encodeURIComponent(form.firstName.trim())}&lastName=${encodeURIComponent(form.lastName.trim())}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found) {
          const firstAttorney = data.attorneys?.[0];
          const galInfo = data.gal;
          const firstEvaluator = data.evaluators?.[0];
          setForm((prev) => ({
            ...prev,
            phone: data.phone || prev.phone,
            email: data.email || prev.email,
            existingDonorId: data.contactId,
            prefilledFromCaseNumber: data.mostRecentCaseNumber || null,
            hadMultipleAttorneysOnPreviousCase: !!data.hadMultipleAttorneys,
            hadMultipleEvaluatorsOnPreviousCase: !!data.hadMultipleEvaluators,
            ...(firstAttorney && {
              hasAttorney: true,
              attorneyName: firstAttorney.name,
              attorneyEmail: firstAttorney.email || "",
              attorneyContactId: firstAttorney.contactId,
              attorneyFirm: firstAttorney.firm || "",
              attorneyPhone: firstAttorney.phone || "",
              prefilledAttorney: true,
            }),
            ...(galInfo && {
              hasGal: true,
              galName: galInfo.name,
              galEmail: galInfo.email || "",
              galContactId: galInfo.contactId,
              galFirm: galInfo.firm || "",
              galPhone: galInfo.phone || "",
              prefilledGal: true,
            }),
            ...(firstEvaluator && {
              hasEvaluator: true,
              evaluatorName: firstEvaluator.name,
              evaluatorEmail: firstEvaluator.email || "",
              evaluatorContactId: firstEvaluator.contactId,
              evaluatorFirm: firstEvaluator.firm || "",
              evaluatorPhone: firstEvaluator.phone || "",
              prefilledEvaluator: true,
            }),
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
      setOptInResponded(false);
      try { localStorage.removeItem("kiosk-draft"); } catch { /* */ }
      // Auto-reset after 30 seconds if the user never taps the opt-in buttons.
      // (If they do tap, the button handler runs its own faster reset.)
      setTimeout(() => {
        setForm(INITIAL_FORM);
        setStep(1);
        setSubmitted(false);
        setOptInResponded(false);
        setDonorChecked(false);
        setDonorFound(false);
        setDonorConfirmed(false);
      }, 30000);
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
          {!optInResponded ? (
            <div className="bg-gray-50 rounded-2xl p-6 mb-8">
              <p className="text-xl font-bold text-gray-900 mb-2">Want to learn more about your test?</p>
              <p className="text-sm text-gray-600 mb-5">
                We&apos;ll send you easy-to-understand info about how long your results take, what drugs the test screens for, and what to expect — tailored to the test you took today.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    updateForm({ communicationConsent: true });
                    setOptInResponded(true);
                    fetch("/api/kiosk/intake", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        firstName: form.firstName,
                        lastName: form.lastName,
                        communicationConsent: true,
                      }),
                    }).catch(() => {});
                    // Fast reset — 2.5 seconds is enough for the user to see the confirmation
                    setTimeout(() => {
                      setForm(INITIAL_FORM);
                      setStep(1);
                      setSubmitted(false);
                      setOptInResponded(false);
                      setDonorChecked(false);
                      setDonorFound(false);
                      setDonorConfirmed(false);
                    }, 2500);
                  }}
                  className="flex-1 py-5 rounded-xl text-lg font-bold bg-white border-2 border-gray-300 text-gray-700 hover:border-[#7AB928] hover:bg-green-50 transition-all"
                >
                  Yes, keep me informed
                </button>
                <button
                  onClick={() => {
                    updateForm({ communicationConsent: false });
                    setOptInResponded(true);
                    fetch("/api/kiosk/intake", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        firstName: form.firstName,
                        lastName: form.lastName,
                        communicationConsent: false,
                      }),
                    }).catch(() => {});
                    setTimeout(() => {
                      setForm(INITIAL_FORM);
                      setStep(1);
                      setSubmitted(false);
                      setOptInResponded(false);
                      setDonorChecked(false);
                      setDonorFound(false);
                      setDonorConfirmed(false);
                    }, 2500);
                  }}
                  className="flex-1 py-5 rounded-xl text-lg font-bold bg-white border-2 border-gray-300 text-gray-700 hover:border-gray-400 transition-all"
                >
                  No thanks
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-8">
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></svg>
                </div>
                <p className="text-lg font-bold text-green-800">
                  {form.communicationConsent ? "Got it — we'll be in touch!" : "Got it — you're all set!"}
                </p>
              </div>
            </div>
          )}

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
                      onChange={(e) => { updateForm({ firstName: e.target.value }); setDonorChecked(false); setDonorFound(false); setDonorConfirmed(false); }}
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
                      onChange={(e) => { updateForm({ lastName: e.target.value }); setDonorChecked(false); setDonorFound(false); setDonorConfirmed(false); }}
                      onBlur={checkDonor}
                      className="w-full text-lg p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                      placeholder="Last name"
                      autoComplete="off"
                    />
                  </div>
                </div>

                {/* Returning donor banner */}
                {donorChecked && donorFound && !donorEditing && !donorConfirmed && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-green-800 font-semibold mb-1">Welcome back!</p>
                    <p className="text-green-700 text-sm mb-3">
                      {(() => {
                        const parts: string[] = [];
                        if (form.prefilledAttorney) parts.push("attorney");
                        if (form.prefilledGal) parts.push("GAL");
                        if (form.prefilledEvaluator) parts.push("court-ordered evaluator");
                        const caseNum = form.prefilledFromCaseNumber;
                        if (parts.length === 0 || !caseNum) {
                          return "We found your info on file. Is everything still correct?";
                        }
                        // Join parts with commas + "and" for the last one
                        let list: string;
                        if (parts.length === 1) list = parts[0];
                        else if (parts.length === 2) list = `${parts[0]} and ${parts[1]}`;
                        else list = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
                        return `We found your info on file, including your ${list} from case ${caseNum}. You can review and update in a moment.`;
                      })()}
                    </p>
                    <div className="text-sm text-gray-700 space-y-1 mb-3">
                      {form.phone && <p>Phone: {form.phone}</p>}
                      {form.email && <p>Email: {form.email}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setDonorConfirmed(true)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">Looks good</button>
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
              <p className="text-gray-500 mb-6">Please select one.</p>

              <div className="grid grid-cols-3 gap-4 mb-6">
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

              {/* Court order / agreement forward notice */}
              {(form.caseType === "court_ordered" || form.caseType === "by_agreement") && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                  <p className="text-sm text-blue-900">
                    <strong>Please forward a copy of the court order or any agreement to:</strong>
                  </p>
                  <p className="text-base font-semibold text-blue-800 mt-1">colleen.truetestlabs@gmail.com</p>
                </div>
              )}

              {/* Additional result recipients — only for Personal visits. Shown ABOVE test type. */}
              {form.caseType === "voluntary" && (
                <div className="border-t border-gray-100 pt-6 mb-6">
                  <p className="text-base font-semibold text-gray-700 mb-1">Should we send results to anyone else?</p>
                  <p className="text-sm text-gray-500 mb-4">Optional — add any additional email addresses that should receive your results.</p>
                  <div className="space-y-3">
                    {form.additionalRecipients.map((r, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <input
                          type="text"
                          value={r.name}
                          onChange={(e) => {
                            const next = [...form.additionalRecipients];
                            next[i] = { ...next[i], name: e.target.value };
                            updateForm({ additionalRecipients: next });
                          }}
                          placeholder="Name (optional)"
                          className="flex-1 text-base p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        />
                        <input
                          type="email"
                          value={r.email}
                          onChange={(e) => {
                            const next = [...form.additionalRecipients];
                            next[i] = { ...next[i], email: e.target.value };
                            updateForm({ additionalRecipients: next });
                          }}
                          placeholder="email@example.com"
                          className="flex-[2] text-base p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#7AB928] focus:border-transparent outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = form.additionalRecipients.filter((_, j) => j !== i);
                            updateForm({ additionalRecipients: next });
                          }}
                          className="p-3 text-gray-400 hover:text-red-500 transition-colors"
                          aria-label="Remove recipient"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateForm({ additionalRecipients: [...form.additionalRecipients, { name: "", email: "" }] })}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-[#7AB928] hover:text-[#7AB928] transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Add recipient
                    </button>
                  </div>
                </div>
              )}

              {/* Test type selection */}
              <div className="border-t border-gray-100 pt-6">
                <p className="text-base font-semibold text-gray-700 mb-3">What type of test(s) do you need to do?</p>
                <p className="text-sm text-gray-500 mb-4">Select all that apply. Not sure? Skip this — our staff will confirm.</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "urine", label: "Urine Drug Test" },
                    { value: "hair", label: "Hair Drug Test" },
                    { value: "blood_peth", label: "Blood / PEth (Alcohol)" },
                    { value: "sweat_patch", label: "Sweat Patch" },
                  ].map((opt) => {
                    const selected = form.testTypes.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          const next = selected
                            ? form.testTypes.filter((t) => t !== opt.value)
                            : [...form.testTypes, opt.value];
                          updateForm({ testTypes: next });
                        }}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${selected ? "border-[#7AB928] bg-green-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${selected ? "bg-[#7AB928] border-[#7AB928]" : "border-gray-300"}`}>
                            {selected && (
                              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></svg>
                            )}
                          </div>
                          <span className={`font-semibold ${selected ? "text-[#7AB928]" : "text-gray-800"}`}>{opt.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
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
                    onClick={() => updateForm({
                      hasAttorney: false,
                      attorneyName: "",
                      attorneyEmail: "",
                      attorneyContactId: null,
                      attorneyFirm: "",
                      attorneyPhone: "",
                      prefilledAttorney: false,
                    })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${!form.hasAttorney ? "border-gray-400 bg-gray-50 text-gray-600" : "border-gray-200 text-gray-700"}`}
                  >
                    No
                  </button>
                </div>
                {form.hasAttorney && (
                  <>
                    {form.prefilledAttorney && form.hadMultipleAttorneysOnPreviousCase && (
                      <p className="text-xs text-gray-500 mb-2">
                        Your previous case had more than one attorney. Tap &ldquo;Change&rdquo; to switch if this isn&apos;t the right one.
                      </p>
                    )}
                    <AttorneySearch
                      type="attorney"
                      label="Attorney"
                      value={form.attorneyName ? { name: form.attorneyName, firm: form.attorneyFirm, email: form.attorneyEmail, phone: form.attorneyPhone, contactId: form.attorneyContactId || undefined } : null}
                      onChange={(atty) => updateForm({
                        attorneyName: atty?.name || "",
                        attorneyEmail: atty?.email || "",
                        attorneyContactId: atty?.contactId || null,
                        attorneyFirm: atty?.firm || "",
                        attorneyPhone: atty?.phone || "",
                        prefilledAttorney: false,
                      })}
                    />
                  </>
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
                    onClick={() => updateForm({
                      hasGal: false,
                      galName: "",
                      galEmail: "",
                      galContactId: null,
                      galFirm: "",
                      galPhone: "",
                      prefilledGal: false,
                    })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${!form.hasGal ? "border-gray-400 bg-gray-50 text-gray-600" : "border-gray-200 text-gray-700"}`}
                  >
                    No
                  </button>
                </div>
                {form.hasGal && (
                  <AttorneySearch
                    type="gal"
                    label="GAL"
                    value={form.galName ? { name: form.galName, firm: form.galFirm, email: form.galEmail, phone: form.galPhone, contactId: form.galContactId || undefined } : null}
                    onChange={(gal) => updateForm({
                      galName: gal?.name || "",
                      galEmail: gal?.email || "",
                      galContactId: gal?.contactId || null,
                      galFirm: gal?.firm || "",
                      galPhone: gal?.phone || "",
                      prefilledGal: false,
                    })}
                  />
                )}
              </div>

              {/* Court-ordered evaluator / doctor */}
              <div className="mb-8">
                <p className="text-base font-semibold text-gray-700 mb-1">Is there a court-ordered evaluator or doctor on your case?</p>
                <p className="text-sm text-gray-500 mb-3">Doctors the court has appointed to assess or treat the parties (they order and receive test results).</p>
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => updateForm({ hasEvaluator: true })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${form.hasEvaluator ? "border-[#7AB928] bg-green-50 text-[#7AB928]" : "border-gray-200 text-gray-700"}`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => updateForm({
                      hasEvaluator: false,
                      evaluatorName: "",
                      evaluatorEmail: "",
                      evaluatorContactId: null,
                      evaluatorFirm: "",
                      evaluatorPhone: "",
                      prefilledEvaluator: false,
                    })}
                    className={`flex-1 py-4 rounded-xl text-lg font-bold border-2 transition-all ${!form.hasEvaluator ? "border-gray-400 bg-gray-50 text-gray-600" : "border-gray-200 text-gray-700"}`}
                  >
                    No
                  </button>
                </div>
                {form.hasEvaluator && (
                  <>
                    {form.prefilledEvaluator && form.hadMultipleEvaluatorsOnPreviousCase && (
                      <p className="text-xs text-gray-500 mb-2">
                        Your previous case had more than one evaluator. Tap &ldquo;Change&rdquo; to switch if this isn&apos;t the right one.
                      </p>
                    )}
                    <AttorneySearch
                      type="evaluator"
                      label="Evaluator"
                      value={form.evaluatorName ? { name: form.evaluatorName, firm: form.evaluatorFirm, email: form.evaluatorEmail, phone: form.evaluatorPhone, contactId: form.evaluatorContactId || undefined } : null}
                      onChange={(evalContact) => updateForm({
                        evaluatorName: evalContact?.name || "",
                        evaluatorEmail: evalContact?.email || "",
                        evaluatorContactId: evalContact?.contactId || null,
                        evaluatorFirm: evalContact?.firm || "",
                        evaluatorPhone: evalContact?.phone || "",
                        prefilledEvaluator: false,
                      })}
                    />
                  </>
                )}
              </div>

              {/* Notes */}
              <div>
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
