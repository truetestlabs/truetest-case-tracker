"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { properCase } from "@/lib/format";
import { formatChicagoLongDate, formatChicagoTime } from "@/lib/dateChicago";
import type { DetectedChanges } from "@/lib/kiosk-changes";

type Draft = {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  existingDonorId: string | null;
  caseType: string;
  courtCaseNumber: string | null;
  county: string | null;
  judgeName: string | null;
  hasCourtOrder: boolean;
  courtOrderPath: string | null;
  attorneys: Array<{ name: string; firm: string; email: string; phone: string; contactId?: string }> | null;
  galInfo: { name: string; firm: string; email: string; phone: string; contactId?: string } | null;
  evaluators: Array<{ name: string; firm: string; email: string; phone: string; contactId?: string }> | null;
  testTypes: string[] | null;
  additionalRecipients: Array<{ name?: string; email: string }> | null;
  orderedBy: string | null;
  paymentResponsibility: string | null;
  notes: string | null;
  changes: DetectedChanges | null;
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
  caseId: string | null;
};

export default function IntakeDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/kiosk/intakes/${id}`)
      .then((r) => r.json())
      .then((data) => { setDraft(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  async function approve() {
    setActing(true);
    setMessage("");
    try {
      const res = await fetch(`/api/kiosk/intakes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const data = await res.json();
      if (data.approved) {
        setMessage(`Case ${data.caseNumber} created`);
        setTimeout(() => router.push(`/cases/${data.caseId}`), 1500);
      } else {
        setMessage(data.error || "Failed to approve");
      }
    } catch { setMessage("Failed to approve"); }
    setActing(false);
  }

  async function reject() {
    if (!confirm("Reject this intake?")) return;
    setActing(true);
    try {
      await fetch(`/api/kiosk/intakes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      router.push("/dashboard/intakes");
    } catch { setMessage("Failed to reject"); }
    setActing(false);
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!draft) return <div className="p-8 text-red-500">Intake not found</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/dashboard/intakes" className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block">&larr; Back to intakes</Link>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{properCase(draft.firstName)} {properCase(draft.lastName)}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Submitted {formatChicagoLongDate(new Date(draft.createdAt))} at {formatChicagoTime(new Date(draft.createdAt))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {draft.reviewedBy === "kiosk-auto" && (
              <span className="text-xs px-3 py-1 rounded-full font-semibold bg-green-50 text-green-700 border border-green-200">Auto-approved</span>
            )}
            <span className={`text-xs px-3 py-1 rounded-full font-semibold ${
              draft.status === "pending_review" ? "bg-amber-100 text-amber-700" :
              draft.status === "approved" ? "bg-green-100 text-green-700" :
              "bg-red-100 text-red-700"
            }`}>
              {draft.status === "pending_review" ? "Pending Review" : draft.status === "approved" ? "Approved" : "Rejected"}
            </span>
          </div>
        </div>

        {/* Changes banner — only shown when a returning client updated their info */}
        {draft.changes && (
          <div className="mx-6 mt-6 bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
            <p className="text-sm font-bold text-amber-900 mb-2">⚠ New info — please verify</p>
            <p className="text-xs text-amber-800 mb-3">
              This returning client updated some of their info. Review carefully before approving.
            </p>
            <ul className="space-y-1 text-sm text-amber-900 list-disc pl-5">
              {draft.changes.phone && (
                <li><strong>Phone:</strong> {draft.changes.phone.old || "(none)"} → {draft.changes.phone.new}</li>
              )}
              {draft.changes.email && (
                <li><strong>Email:</strong> {draft.changes.email.old || "(none)"} → {draft.changes.email.new}</li>
              )}
              {draft.changes.caseType && (
                <li><strong>Visit type:</strong> {draft.changes.caseType.old.replace(/_/g, " ")} → {draft.changes.caseType.new.replace(/_/g, " ")}</li>
              )}
              {draft.changes.attorneysAdded?.map((a, i) => (
                <li key={`att-${i}`}><strong>New attorney:</strong> {a.name}{a.firm ? ` (${a.firm})` : ""}</li>
              ))}
              {draft.changes.galAdded && (
                <li><strong>New GAL:</strong> {draft.changes.galAdded.name}{draft.changes.galAdded.firm ? ` (${draft.changes.galAdded.firm})` : ""}</li>
              )}
              {draft.changes.evaluatorsAdded?.map((e, i) => (
                <li key={`ev-${i}`}><strong>New evaluator:</strong> {e.name}{e.firm ? ` (${e.firm})` : ""}</li>
              ))}
              {draft.changes.recipientsAdded?.map((r, i) => (
                <li key={`rec-${i}`}><strong>New result recipient:</strong> {r.name ? `${r.name} — ` : ""}{r.email}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Details */}
        <div className="p-6 space-y-6">
          {/* Contact Info */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contact Info</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Phone:</span> <span className="text-gray-900 font-medium">{draft.phone || "—"}</span></div>
              <div><span className="text-gray-500">Email:</span> <span className="text-gray-900 font-medium">{draft.email || "—"}</span></div>
              {draft.existingDonorId && <div><span className="text-green-600 text-xs font-medium">Returning donor</span></div>}
            </div>
          </section>

          {/* Visit Type */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Visit</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Type:</span> <span className="text-gray-900 font-medium capitalize">{draft.caseType.replace(/_/g, " ")}</span></div>
              {draft.courtCaseNumber && <div><span className="text-gray-500">Court Case #:</span> <span className="text-gray-900 font-medium">{draft.courtCaseNumber}</span></div>}
              {draft.county && <div><span className="text-gray-500">County:</span> <span className="text-gray-900 font-medium">{draft.county}</span></div>}
              {draft.judgeName && <div><span className="text-gray-500">Judge:</span> <span className="text-gray-900 font-medium">{draft.judgeName}</span></div>}
              {draft.hasCourtOrder && <div><span className="text-green-600 text-xs font-medium">Court order uploaded</span></div>}
              {draft.testTypes && draft.testTypes.length > 0 && (
                <div className="col-span-2">
                  <span className="text-gray-500">Tests requested:</span>{" "}
                  <span className="text-gray-900 font-medium">{draft.testTypes.map((t) => t.replace(/_/g, " ")).join(", ")}</span>
                </div>
              )}
            </div>
            {draft.additionalRecipients && draft.additionalRecipients.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Additional Result Recipients</p>
                <div className="space-y-1">
                  {draft.additionalRecipients.map((r, i) => (
                    <div key={i} className="text-sm text-gray-700 bg-blue-50 rounded-lg px-3 py-2">
                      {r.name && <span className="font-medium">{r.name} — </span>}
                      <span>{r.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Legal Contacts */}
          {((draft.attorneys && draft.attorneys.length > 0) || draft.galInfo || (draft.evaluators && draft.evaluators.length > 0)) && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Legal Contacts</h3>
              <div className="space-y-2 text-sm">
                {draft.attorneys?.map((a, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3">
                    <p className="font-medium text-gray-900">Attorney: {a.name}</p>
                    {a.firm && <p className="text-gray-500">{a.firm}</p>}
                    {a.email && <p className="text-gray-500">{a.email}</p>}
                    {a.phone && <p className="text-gray-500">{a.phone}</p>}
                  </div>
                ))}
                {draft.galInfo && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="font-medium text-gray-900">GAL: {draft.galInfo.name}</p>
                    {draft.galInfo.firm && <p className="text-gray-500">{draft.galInfo.firm}</p>}
                    {draft.galInfo.email && <p className="text-gray-500">{draft.galInfo.email}</p>}
                  </div>
                )}
                {draft.evaluators?.map((e, i) => (
                  <div key={`ev-${i}`} className="bg-gray-50 rounded-lg p-3">
                    <p className="font-medium text-gray-900">Evaluator: {e.name}</p>
                    {e.firm && <p className="text-gray-500">{e.firm}</p>}
                    {e.email && <p className="text-gray-500">{e.email}</p>}
                    {e.phone && <p className="text-gray-500">{e.phone}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Other */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Other</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {draft.orderedBy && <div><span className="text-gray-500">Ordered by:</span> <span className="text-gray-900 font-medium capitalize">{draft.orderedBy}</span></div>}
              {draft.paymentResponsibility && <div><span className="text-gray-500">Payment:</span> <span className="text-gray-900 font-medium capitalize">{draft.paymentResponsibility.replace(/_/g, " ")}</span></div>}
            </div>
            {draft.notes && <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg p-3">{draft.notes}</p>}
          </section>
        </div>

        {/* Actions */}
        {draft.status === "pending_review" && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={reject}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Reject
            </button>
            <div className="flex items-center gap-3">
              {message && <span className={`text-sm font-medium ${message.startsWith("Case") ? "text-green-600" : "text-red-600"}`}>{message}</span>}
              <button
                onClick={approve}
                disabled={acting}
                className="px-6 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-bold hover:bg-[#162c47] disabled:opacity-50"
              >
                {acting ? "Creating case..." : "Approve & Create Case"}
              </button>
            </div>
          </div>
        )}

        {draft.caseId && (
          <div className="px-6 py-4 bg-green-50 border-t border-green-100 text-center">
            <Link href={`/cases/${draft.caseId}`} className="text-sm font-semibold text-green-700 hover:text-green-900">
              View Case &rarr;
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
