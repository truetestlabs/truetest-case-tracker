"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

const navigation = [
  { name: "Quick Intake", href: "/intake", icon: ZapIcon },
  { name: "Phone Intake", href: "/dashboard/phone-intake", icon: PhoneIcon },
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { name: "Calendar", href: "/calendar", icon: CalendarIcon },
  { name: "Cases", href: "/cases", icon: BriefcaseIcon },
  { name: "Monitored", href: "/cases/monitored", icon: MonitorIcon },
  { name: "Closed Cases", href: "/cases/closed", icon: ArchiveIcon },
  { name: "Upload Order", href: "/cases/upload-order", icon: UploadIcon },
  { name: "Kiosk Intakes", href: "/dashboard/intakes", icon: ClipboardIcon },
  { name: "Contacts", href: "/contacts", icon: UsersIcon },
  { name: "Audit Log", href: "/dashboard/audit-log", icon: ShieldIcon },
];

const BOOKING_URL = "https://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [bookingModal, setBookingModal] = useState<"text" | "email" | null>(null);
  const [bookingName, setBookingName] = useState("");
  const [bookingContact, setBookingContact] = useState("");

  // Auth
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createSupabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);
  async function handleSignOut() {
    const supabase = createSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Reminders
  type ReminderItem = { id: string; type: string; message: string; caseId: string; caseNumber: string; age: string; draftId?: string };
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [reminderCount, setReminderCount] = useState(0);
  const [showReminders, setShowReminders] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Email draft review modal
  type DraftData = { id: string; subject: string; body: string; recipients: string[]; draftType: string; caseNumber: string; donorName: string };
  const [reviewDraft, setReviewDraft] = useState<DraftData | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftSending, setDraftSending] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  // Load dismissed IDs from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("dismissedReminders") || "{}");
      const now = Date.now();
      // Clean expired (24hr TTL) and build set
      const valid: Record<string, number> = {};
      const ids = new Set<string>();
      for (const [id, ts] of Object.entries(stored)) {
        if (now - (ts as number) < 24 * 60 * 60 * 1000) {
          valid[id] = ts as number;
          ids.add(id);
        }
      }
      localStorage.setItem("dismissedReminders", JSON.stringify(valid));
      setDismissed(ids);
    } catch { /* ignore */ }
  }, []);

  function dismissReminder(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      const stored = JSON.parse(localStorage.getItem("dismissedReminders") || "{}");
      stored[id] = Date.now();
      localStorage.setItem("dismissedReminders", JSON.stringify(stored));
    } catch { /* ignore */ }
  }

  const filteredReminders = reminders.filter((r) => !dismissed.has(r.id));
  const filteredCount = filteredReminders.length;

  const loadReminders = useCallback(() => {
    fetch("/api/reminders")
      .then((r) => r.json())
      .then((data) => { setReminders(data.reminders || []); setReminderCount(data.count || 0); })
      .catch((e) => console.error("[Sidebar.tsx] background fetch failed:", e));
  }, []);

  useEffect(() => {
    loadReminders();
    const interval = setInterval(loadReminders, 5 * 60 * 1000); // poll every 5 min
    // Listen for immediate refresh from other components (e.g. draft created on case page)
    const onRefresh = () => loadReminders();
    window.addEventListener("refreshReminders", onRefresh);
    return () => { clearInterval(interval); window.removeEventListener("refreshReminders", onRefresh); };
  }, [loadReminders]);

  function sendBooking() {
    const name = bookingName.trim() || "there";
    const contact = bookingContact.trim();
    if (!contact) { alert("Please enter a phone number or email"); return; }

    if (bookingModal === "text") {
      const msg = encodeURIComponent(`Hi ${name}, please book your appointment at TrueTest Labs here: ${BOOKING_URL}`);
      window.open(`sms:${contact}&body=${msg}`, "_blank");
    } else {
      const subject = encodeURIComponent("TrueTest Labs - Schedule Your Appointment");
      const body = encodeURIComponent(`Hi ${name},\n\nPlease book your appointment at TrueTest Labs using the link below:\n\n${BOOKING_URL}\n\n`);
      window.open(`mailto:${contact}?subject=${subject}&body=${body}`, "_blank");
    }
    setBookingModal(null);
    setBookingName("");
    setBookingContact("");
  }

  async function openDraftReview(draftId: string) {
    try {
      const res = await fetch(`/api/email-drafts`);
      const data = await res.json();
      const draft = (data.drafts || []).find((d: { id: string }) => d.id === draftId);
      if (!draft) { alert("Draft not found — it may have been sent or discarded."); return; }
      const donorName = draft.case?.donor ? `${draft.case.donor.firstName} ${draft.case.donor.lastName}` : "Unknown";
      setReviewDraft({
        id: draft.id,
        subject: draft.subject,
        body: draft.body,
        recipients: draft.recipients as string[],
        draftType: draft.draftType,
        caseNumber: draft.case?.caseNumber || "",
        donorName,
      });
      setDraftSubject(draft.subject);
      setDraftBody(draft.body);
      setDraftMsg(null);
      setShowReminders(false);
    } catch { alert("Failed to load draft"); }
  }

  async function sendDraft() {
    if (!reviewDraft) return;
    setDraftSending(true);
    setDraftMsg(null);
    try {
      // Save any edits first
      if (draftSubject !== reviewDraft.subject || draftBody !== reviewDraft.body) {
        await fetch(`/api/email-drafts/${reviewDraft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: draftSubject, body: draftBody }),
        });
      }
      const res = await fetch(`/api/email-drafts/${reviewDraft.id}/send`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setDraftMsg(`Sent to ${data.sentTo.length} recipient${data.sentTo.length !== 1 ? "s" : ""}`);
        setTimeout(() => { setReviewDraft(null); loadReminders(); }, 1500);
      } else {
        setDraftMsg(data.error || "Failed to send");
      }
    } catch { setDraftMsg("Failed to send"); }
    setDraftSending(false);
  }

  async function discardDraft() {
    if (!reviewDraft) return;
    if (!confirm("Discard this email draft? This cannot be undone.")) return;
    try {
      await fetch(`/api/email-drafts/${reviewDraft.id}`, { method: "DELETE" });
      setReviewDraft(null);
      loadReminders();
    } catch { alert("Failed to discard"); }
  }

  const draftReminders = filteredReminders.filter((r) => r.type === "email_draft");
  const otherReminders = filteredReminders.filter((r) => r.type !== "email_draft");

  return (
    <aside className="w-60 flex flex-col flex-shrink-0" style={{ background: "linear-gradient(180deg, #1a3352 0%, #162c47 100%)" }}>
      {/* Logo */}
      <div className="px-4 py-4 flex items-center gap-3 border-b border-white/10">
        <img src="/logo.png" alt="TrueTest Labs" className="h-9 w-auto flex-shrink-0" />
        <p className="text-[10px] text-white/40 font-medium uppercase tracking-widest leading-tight">Case Tracker</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navigation.map((item, index) => {
          const isActive =
            item.href === "/cases"
              ? pathname === "/cases" || (pathname?.startsWith("/cases/") && !pathname?.startsWith("/cases/closed") && !pathname?.startsWith("/cases/monitored") && !pathname?.startsWith("/cases/upload"))
              : pathname === item.href || pathname?.startsWith(item.href + "/");
          const isQuickIntake = item.href === "/intake";
          return (
            <span key={item.name}>
              {index === 1 && <div className="my-2 mx-1 border-t border-white/10" />}
              <Link
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? isQuickIntake
                      ? "text-white shadow-sm"
                      : "bg-white/15 text-white shadow-sm"
                    : isQuickIntake
                    ? "text-[#d4a843] hover:bg-white/8 hover:text-[#f0c060]"
                    : "text-white/60 hover:bg-white/8 hover:text-white/90"
                }`}
                style={
                  isActive
                    ? isQuickIntake
                      ? { background: "rgba(212,168,67,0.2)", boxShadow: "inset 3px 0 0 #d4a843" }
                      : { boxShadow: "inset 3px 0 0 rgba(255,255,255,0.6)" }
                    : {}
                }
              >
                <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? (isQuickIntake ? "text-[#d4a843]" : "text-white") : isQuickIntake ? "text-[#d4a843]" : "text-white/50"}`} />
                {item.name}
              </Link>
            </span>
          );
        })}
      </nav>

      {/* Reminders Bell */}
      <div className="px-3 py-2 border-t border-white/10 relative">
        <button
          onClick={() => setShowReminders(!showReminders)}
          onKeyDown={(e) => { if (e.key === "Escape" && showReminders) { setShowReminders(false); e.stopPropagation(); } }}
          aria-expanded={showReminders}
          aria-label={`Reminders${filteredCount > 0 ? ` (${filteredCount} action needed)` : ""}`}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-white/60 hover:bg-white/8 hover:text-white/90 transition-all"
        >
          <BellIcon className="w-4 h-4 flex-shrink-0" />
          <span>Reminders</span>
          {filteredCount > 0 && (
            <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
              {filteredCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {showReminders && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-white rounded-lg shadow-xl border border-gray-200 max-h-[400px] overflow-y-auto z-50">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Action Needed ({filteredCount})</h3>
              {filteredCount > 0 && (
                <button
                  onClick={() => { filteredReminders.forEach((r) => dismissReminder(r.id)); }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear all
                </button>
              )}
            </div>
            {filteredReminders.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">All clear — nothing overdue</div>
            ) : (
              <div>
                {/* Email drafts section */}
                {draftReminders.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
                      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Email Drafts ({draftReminders.length})</p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {draftReminders.map((r) => (
                        <div key={r.id} className="px-4 py-3 hover:bg-blue-50/50 transition-colors">
                          <p className="text-sm text-gray-900 font-medium">{r.message}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{r.caseNumber} · {r.age}</p>
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => r.draftId && openDraftReview(r.draftId)}
                              className="px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
                            >
                              Review & Send
                            </button>
                            <button
                              onClick={async () => {
                                if (r.draftId && confirm("Discard this draft?")) {
                                  await fetch(`/api/email-drafts/${r.draftId}`, { method: "DELETE" });
                                  loadReminders();
                                }
                              }}
                              className="px-3 py-1 text-xs font-medium rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Other reminders */}
                {otherReminders.length > 0 && draftReminders.length > 0 && (
                  <div className="px-4 py-2 bg-gray-50 border-y border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Other Reminders</p>
                  </div>
                )}
                <div className="divide-y divide-gray-100">
                  {otherReminders.map((r) => (
                    <div key={r.id} className="flex items-start hover:bg-gray-50 transition-colors">
                      <Link
                        href={`/cases/${r.caseId}`}
                        onClick={() => setShowReminders(false)}
                        className="flex-1 px-4 py-3"
                      >
                        <p className="text-sm text-gray-900 font-medium">{r.message}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{r.caseNumber} · {r.age}</p>
                      </Link>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissReminder(r.id); }}
                        className="px-3 py-3 text-gray-400 hover:text-gray-600 text-sm"
                        title="Dismiss for 24 hours"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Booking Tools */}
      <div className="px-3 py-3 border-t border-white/10 space-y-1">
        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest px-3 mb-1">Send Booking</p>
        <button
          onClick={() => { setBookingModal("text"); setBookingName(""); setBookingContact(""); }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-green-400 hover:bg-white/8 hover:text-green-300 transition-all"
        >
          <MessageIcon className="w-4 h-4 flex-shrink-0" />
          Text Booking
        </button>
        <button
          onClick={() => { setBookingModal("email"); setBookingName(""); setBookingContact(""); }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-blue-400 hover:bg-white/8 hover:text-blue-300 transition-all"
        >
          <MailIcon className="w-4 h-4 flex-shrink-0" />
          Email Booking
        </button>
      </div>

      {/* Booking Modal */}
      {bookingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBookingModal(null)} onKeyDown={(e) => { if (e.key === "Escape") setBookingModal(null); }}>
          <div className="bg-white rounded-lg w-full max-w-sm p-5" role="dialog" aria-modal="true" aria-label={bookingModal === "text" ? "Text Booking Link" : "Email Booking Link"} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {bookingModal === "text" ? "📱 Text Booking Link" : "✉️ Email Booking Link"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  autoFocus
                  value={bookingName}
                  onChange={(e) => setBookingName(e.target.value)}
                  placeholder="Donor's first name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {bookingModal === "text" ? "Phone Number" : "Email Address"}
                </label>
                <input
                  type={bookingModal === "text" ? "tel" : "email"}
                  value={bookingContact}
                  onChange={(e) => setBookingContact(e.target.value)}
                  placeholder={bookingModal === "text" ? "312-555-1234" : "donor@email.com"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  onKeyDown={(e) => e.key === "Enter" && sendBooking()}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setBookingModal(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={sendBooking}
                disabled={!bookingContact.trim()}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${bookingModal === "text" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                {bookingModal === "text" ? "Open Messages" : "Open Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Draft Review Modal */}
      {reviewDraft && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setReviewDraft(null)} onKeyDown={(e) => { if (e.key === "Escape") setReviewDraft(null); }}>
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" role="dialog" aria-modal="true" aria-label="Review Email Draft" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={`px-6 py-4 rounded-t-xl ${reviewDraft.draftType === "results_mro" ? "bg-purple-700" : "bg-[#1e3a5f]"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/60 font-semibold uppercase tracking-wider">
                    {reviewDraft.draftType === "results_mro" ? "MRO Results Email" : "Results Email"} — Review Before Sending
                  </p>
                  <p className="text-white font-bold mt-1">{reviewDraft.donorName} · {reviewDraft.caseNumber}</p>
                </div>
                <button onClick={() => setReviewDraft(null)} className="text-white/60 hover:text-white text-lg">✕</button>
              </div>
            </div>

            {/* Recipients */}
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
              <p className="text-xs font-medium text-gray-500 mb-1">To:</p>
              <div className="flex flex-wrap gap-1">
                {reviewDraft.recipients.map((email) => (
                  <span key={email} className="inline-flex items-center px-2 py-0.5 rounded-full bg-white border border-gray-200 text-xs text-gray-700">{email}</span>
                ))}
              </div>
            </div>

            {/* Subject */}
            <div className="px-6 py-3 border-b border-gray-200">
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject:</label>
              <input
                type="text"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Body (editable) */}
            <div className="px-6 py-3 flex-1 overflow-y-auto min-h-0">
              <label className="block text-xs font-medium text-gray-500 mb-1">Body (editable):</label>
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={16}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono leading-relaxed resize-y"
              />
            </div>

            {/* Actions */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-xl">
              <button
                onClick={discardDraft}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
              >
                Discard Draft
              </button>
              <div className="flex items-center gap-3">
                {draftMsg && <span className={`text-xs font-medium ${draftMsg.startsWith("Sent") ? "text-green-600" : "text-red-600"}`}>{draftMsg}</span>}
                <button onClick={() => setReviewDraft(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
                <button
                  onClick={sendDraft}
                  disabled={draftSending}
                  className={`px-5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${reviewDraft.draftType === "results_mro" ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"}`}
                >
                  {draftSending ? "Sending..." : "Approve & Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User + Footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-white/70">{userEmail ? userEmail.slice(0, 2).toUpperCase() : "?"}</span>
            </div>
            <span className="text-[11px] text-white/50 truncate">{userEmail || ""}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="text-[10px] text-white/30 hover:text-white/70 font-medium flex-shrink-0"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" style={{ boxShadow: "0 0 6px rgba(74,222,128,0.6)" }} />
          <span className="text-xs text-white/40">Elk Grove Village, IL</span>
        </div>
      </div>
    </aside>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3" />
      <path d="M7 16h10" />
    </svg>
  );
}

function LayoutDashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21,8 21,21 3,21 3,8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
