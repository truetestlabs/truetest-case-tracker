"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { StatusBadge, CourtOrderFlag } from "@/components/ui/StatusBadge";
import { CASE_TYPE_CONFIG } from "@/lib/case-utils";
import { getPaymentState, getPaymentLabel } from "@/lib/payment";
import { AddContactForm } from "@/components/cases/AddContactForm";
import { EditContactModal } from "@/components/cases/EditContactModal";
import { EditCaseModal } from "@/components/cases/EditCaseModal";
import { AddTestOrder } from "@/components/cases/AddTestOrder";
import { CreateScheduleModal } from "@/components/cases/CreateScheduleModal";
import { MonitoringScheduleCard } from "@/components/cases/MonitoringScheduleCard";
import { TestProgressBar } from "@/components/cases/TestProgressBar";
import { TestOrderDocuments } from "@/components/cases/TestOrderDocuments";
import { CaseDocuments } from "@/components/cases/CaseDocuments";
import { EditTestOrderModal } from "@/components/cases/EditTestOrderModal";
import { LabResultCard, type LabResultData } from "@/components/cases/LabResultCard";

type CaseData = {
  id: string;
  caseNumber: string;
  caseType: string;
  caseStatus: string;
  courtCaseNumber: string | null;
  county: string | null;
  judgeName: string | null;
  hasCourtOrder: boolean;
  isMonitored: boolean;
  notes: string | null;
  createdAt: string;
  referringAccountId: string | null;
  referringAccount: { id: string; name: string; shortCode: string | null } | null;
  donor: { firstName: string; lastName: string; email: string | null; phone: string | null } | null;
  caseContacts: Array<{
    id: string;
    roleInCase: string;
    receivesResults: boolean;
    receivesStatus: boolean;
    receivesInvoices: boolean;
    canOrderTests: boolean;
    contact: { firstName: string; lastName: string; firmName: string | null; email: string | null; phone: string | null };
  }>;
  testOrders: Array<{
    id: string;
    testCatalogId: string | null;
    testDescription: string;
    specimenType: string;
    lab: string;
    testStatus: string;
    collectionType: string;
    specimenHeld: boolean;
    labAccessionNumber: string | null;
    clientPrice: string | null;
    invoiceNumber: string | null;
    appointmentDate: string | null;
    collectionDate: string | null;
    collectionSite: string | null;
    collectionSiteType: string | null;
    orderReleasedDate: string | null;
    specimenId: string | null;
    squarePaymentLink: string | null;
    paymentMethod: string | null;
    paymentDate: string | null;
    sentToLabDate: string | null;
    resultsReceivedDate: string | null;
    resultsReleasedDate: string | null;
    schedulingType: string;
    notes: string | null;
    documents: Array<{
      id: string;
      documentType: string;
      fileName: string;
      uploadedAt: string;
    }>;
    labResults?: LabResultData[];
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    documentType: string;
    uploadedAt: string;
    extractedData?: { summary?: string } | null;
  }>;
  courtOrders: Array<{
    id: string;
    courtCaseNumber: string | null;
    judgeName: string | null;
    county: string | null;
    frequency: string | null;
    testingDuration: string | null;
    whoPays: string | null;
    specialInstructions: string | null;
    complianceStatus: string;
    parsedByAi: boolean;
  }>;
  statusLogs: Array<{
    id: string;
    testOrderId: string | null;
    oldStatus: string;
    newStatus: string;
    changedAt: string;
    note: string | null;
    notificationSent: boolean;
  }>;
};

export default function CaseDetailPage() {
  const params = useParams();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editingTestOrder, setEditingTestOrder] = useState<string | null>(null);
  const [showEditCase, setShowEditCase] = useState(false);
  const [showDistribution, setShowDistribution] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);
  const [sendingResults, setSendingResults] = useState(false);
  const [resultsSentMsg, setResultsSentMsg] = useState<string | null>(null);
  const [sendingCollection, setSendingCollection] = useState(false);
  const [collectionSentMsg, setCollectionSentMsg] = useState<string | null>(null);
  const [collectionConfirmed, setCollectionConfirmed] = useState(false);
  const [sendingResultsHeld, setSendingResultsHeld] = useState(false);
  const [resultsHeldSent, setResultsHeldSent] = useState(false);
  const [sendingPaymentReceived, setSendingPaymentReceived] = useState(false);
  const [paymentReceivedSent, setPaymentReceivedSent] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    newStatus: string;
    changedAt: string;
    notificationRecipients: string[] | null;
    testOrder: { testDescription: string } | null;
  }>>([]);

  const loadNotifications = useCallback((caseId: string) => {
    fetch(`/api/cases/${caseId}/notifications`)
      .then((r) => r.json())
      .then(setNotifications)
      .catch((e) => console.error("[case page] load notifications failed:", e));
  }, []);

  function loadCase() {
    fetch(`/api/cases/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Case not found");
        return res.json();
      })
      .then((data) => {
        setCaseData(data);
        setLoading(false);
        // Check if "Results held" notification was already sent
        if (data.statusLogs?.some((log: { note?: string; notificationSent?: boolean }) => log.notificationSent && log.note?.toLowerCase().includes("results held"))) {
          setResultsHeldSent(true);
        }
        if (data.statusLogs?.some((log: { note?: string; notificationSent?: boolean }) => log.notificationSent && log.note?.toLowerCase().includes("collection confirmation"))) {
          setCollectionConfirmed(true);
        }
        if (data.statusLogs?.some((log: { note?: string; notificationSent?: boolean }) => log.notificationSent && log.note?.toLowerCase().includes("payment received"))) {
          setPaymentReceivedSent(true);
        }
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }

  useEffect(() => {
    loadCase();
    if (params.id) loadNotifications(params.id as string);
    const interval = setInterval(() => { loadCase(); if (params.id) loadNotifications(params.id as string); }, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") { loadCase(); if (params.id) loadNotifications(params.id as string); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [params.id, loadNotifications]);

  if (loading) return <div className="text-center py-12 text-gray-400">Loading case...</div>;
  if (error || !caseData) return <div className="text-center py-12 text-red-500">Case not found</div>;

  const caseTypeInfo = CASE_TYPE_CONFIG[caseData.caseType as keyof typeof CASE_TYPE_CONFIG];
  const resultRecipients = caseData.caseContacts.filter((cc) => cc.receivesResults);
  const attorneys = caseData.caseContacts.filter(
    (cc) => cc.roleInCase === "petitioner_attorney" || cc.roleInCase === "respondent_attorney"
  );
  const gals = caseData.caseContacts.filter((cc) => cc.roleInCase === "gal");

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href="/cases" className="text-gray-400 hover:text-gray-600 text-sm">&larr; Cases</Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{caseData.caseNumber}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <StatusBadge status={caseData.caseStatus} type="case" />
            <StatusBadge status={caseData.caseType} type="caseType" />
          </div>
          {(caseData.courtCaseNumber || caseData.county || caseData.judgeName) && (
            <p className="text-xs text-gray-500 mt-1.5">
              {[
                caseData.courtCaseNumber && `Court: ${caseData.courtCaseNumber}`,
                caseData.county,
                caseData.judgeName && `Judge ${caseData.judgeName}`,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {caseData.referringAccount && (
            <p className="text-xs text-gray-500 mt-1">
              Account: <span className="font-medium text-gray-700">{caseData.referringAccount.name}</span>
              {caseData.referringAccount.shortCode && <span className="text-gray-400"> ({caseData.referringAccount.shortCode})</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/cases/${caseData.id}/export`}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ⬇ Export
          </a>
          <button
            onClick={() => setShowEditCase(true)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Edit Case
          </button>
          {caseData.caseStatus !== "closed" ? (
            <button
              onClick={async () => {
                if (!confirm(`Close case ${caseData.caseNumber}?\n\nIt will move to Closed Cases.`)) return;
                await fetch(`/api/cases/${caseData.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ caseStatus: "closed" }),
                });
                window.location.href = "/cases";
              }}
              className="px-4 py-2 text-gray-500 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Close Case
            </button>
          ) : (
            <button
              onClick={async () => {
                await fetch(`/api/cases/${caseData.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ caseStatus: "active" }),
                });
                window.location.href = "/cases";
              }}
              className="px-4 py-2 text-blue-500 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors"
            >
              Reopen Case
            </button>
          )}
          <button
            onClick={async () => {
              if (!confirm(`Delete case ${caseData.caseNumber}?\n\nThis will delete all test orders, contacts, documents, and history.\n\nThis cannot be undone.`)) return;
              const res = await fetch(`/api/cases/${caseData.id}`, { method: "DELETE" });
              if (res.ok) window.location.href = "/cases";
              else alert("Failed to delete case");
            }}
            className="px-4 py-2 text-red-500 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Edit Case Modal */}
      {showEditCase && (
        <EditCaseModal
          caseData={caseData}
          onSaved={(recipientsAdded) => {
            setShowEditCase(false);
            loadCase();
            if (recipientsAdded && recipientsAdded > 0) {
              alert(`Case saved. ${recipientsAdded} default recipient${recipientsAdded > 1 ? "s" : ""} from the account were automatically added to this case.`);
            }
          }}
          onClose={() => setShowEditCase(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Donor + Test Orders — Combined */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Donor header */}
            <div className="px-6 py-4 border-b border-gray-200">
              {caseData.donor ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-900">{caseData.donor.firstName} {caseData.donor.lastName}</h2>
                      {caseData.notes && (
                        <div className="relative group">
                          <span className="cursor-default text-amber-500 text-sm" title="Case has notes">📝</span>
                          <div className="absolute left-0 top-7 z-20 hidden group-hover:block w-72 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-pre-wrap">
                            {caseData.notes}
                            <div className="absolute -top-1 left-3 w-2 h-2 bg-gray-900 rotate-45" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                      {caseData.donor.phone && <span>{caseData.donor.phone}</span>}
                      {caseData.donor.email && <span>{caseData.donor.email}</span>}
                      {!caseData.donor.email && (
                        <span className="text-xs text-amber-600 font-medium">⚠ No email — notifications won't be delivered to donor</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : <p className="text-gray-400 py-2">No donor assigned</p>}
            </div>

            {/* Test Orders */}
            <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Test Orders ({caseData.testOrders.length})</h3>
              <div className="flex items-center gap-2">
                <AddTestOrder caseId={caseData.id} onAdded={loadCase} />
              </div>
            </div>
            {caseData.testOrders.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-400">No test orders yet</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {caseData.testOrders.map((test) => (
                  <div key={test.id} className="px-6 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p
                          className="font-medium text-gray-900 cursor-pointer hover:text-blue-600 text-sm"
                          onClick={() => setEditingTestOrder(test.id)}
                          title="Click to edit"
                        >
                          {test.testDescription} <span className="text-xs text-blue-500">edit</span>
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                          {test.specimenId && <span className="font-mono font-medium text-gray-700">{test.specimenId}</span>}
                          <span className="capitalize">{test.specimenType}</span>
                          <span className="capitalize">{test.lab.replace("_", "/")}</span>
                          {test.collectionType === "observed" && <span className="font-medium text-orange-600">Observed</span>}
                          {test.collectionDate && (
                            <span className="text-gray-600">
                              {test.testDescription?.toLowerCase().includes("sweat patch") ? "Applied" : "Collected"}: {new Date(test.collectionDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                          )}
                        </div>
                      </div>
                      {test.notes && (
                        <div className="relative group flex-shrink-0">
                          <span className="cursor-default text-gray-400 hover:text-gray-600 text-sm" title="View notes">📝</span>
                          <div className="absolute right-0 top-6 z-20 hidden group-hover:block w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-pre-wrap">
                            {test.notes}
                            <div className="absolute -top-1 right-3 w-2 h-2 bg-gray-900 rotate-45" />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Per-test-order documents (COC, Results, MRO) */}
                    <TestOrderDocuments
                      caseId={caseData.id}
                      testOrderId={test.id}
                      documents={test.documents || []}
                      onUpdated={loadCase}
                    />
                    {/* Edit Test Order Modal */}
                    {editingTestOrder === test.id && (
                      <EditTestOrderModal
                        caseId={caseData.id}
                        testOrder={test}
                        onSaved={() => { setEditingTestOrder(null); loadCase(); }}
                        onClose={() => setEditingTestOrder(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Lab Results (structured data from uploaded result PDFs) */}
          {caseData.testOrders.some((t) => (t.labResults?.length ?? 0) > 0) && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
                Lab Results
              </h3>
              <div className="space-y-3">
                {caseData.testOrders
                  .filter((t) => (t.labResults?.length ?? 0) > 0)
                  .flatMap((t) =>
                    (t.labResults || []).map((r) => (
                      <LabResultCard
                        key={r.id}
                        result={r}
                        testDescription={t.testDescription}
                        onResolved={loadCase}
                      />
                    ))
                  )}
              </div>
            </section>
          )}

          {/* Documents */}
          <CaseDocuments caseId={caseData.id} documents={caseData.documents} onUpdated={loadCase} />

          {/* Result Summaries */}
          {caseData.documents.filter((d) => d.documentType === "result_report" && (d.extractedData as { summary?: string } | null)?.summary).length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Result Summaries</h3>
                {caseData.testOrders.some((t) => ["results_released", "at_mro", "results_received"].includes(t.testStatus)) && (
                  <div className="flex items-center gap-2">
                    {resultsSentMsg && <span className="text-xs text-green-600 font-medium">{resultsSentMsg}</span>}
                    <button
                      onClick={async () => {
                        setSendingResults(true);
                        setResultsSentMsg(null);
                        try {
                          const res = await fetch(`/api/cases/${caseData.id}/compose-results`, { method: "POST" });
                          if (res.ok) {
                            window.dispatchEvent(new Event("refreshReminders"));
                            setResultsSentMsg("Draft saved — review in Reminders bell");
                          } else {
                            const data = await res.json();
                            setResultsSentMsg(data.error || "Failed to create draft");
                          }
                        } catch { setResultsSentMsg("Failed to create draft"); }
                        setSendingResults(false);
                      }}
                      disabled={sendingResults}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2a5490 100%)" }}
                    >
                      {sendingResults ? "Creating draft…" : "✉ Draft Results Email"}
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {caseData.documents
                  .filter((d) => d.documentType === "result_report" && (d.extractedData as { summary?: string } | null)?.summary)
                  .map((doc) => {
                    const summary = (doc.extractedData as { summary?: string })?.summary!;
                    const isExpanded = expandedSummary === doc.id;
                    return (
                      <div key={doc.id} className="border border-slate-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpandedSummary(isExpanded ? null : doc.id)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                        >
                          <div>
                            <p className="text-xs font-semibold text-slate-700">{doc.fileName}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{new Date(doc.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                          </div>
                          <span className="text-xs text-blue-600 font-medium">{isExpanded ? "Hide" : "View Summary"}</span>
                        </button>
                        {isExpanded && (
                          <div className="px-4 py-4 bg-white">
                            <pre className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">{summary}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-3">Test Status</h3>
            {caseData.testOrders.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No tests ordered</p>
            ) : (
              <div className="space-y-3">
                {caseData.testOrders.map((test) => {
                  const state = getPaymentState(test.paymentMethod);
                  const label = getPaymentLabel(test.paymentMethod);
                  const payColor = state === "unpaid" ? "text-red-600" : state === "invoiced" ? "text-blue-600" : "text-green-600";
                  return (
                    <div
                      key={test.id}
                      className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => setEditingTestOrder(test.id)}
                      title="Click to edit"
                    >
                      <p className="text-sm font-semibold text-gray-900 truncate">{test.testDescription}</p>
                      {test.specimenId && (
                        <p className="text-xs text-gray-500 mt-0.5">Specimen ID: <span className="font-mono font-medium text-gray-700">{test.specimenId}</span></p>
                      )}
                      <div className="mt-2.5 mb-1">
                        <TestProgressBar currentStatus={test.testStatus} caseId={caseData.id} testOrderId={test.id} testDescription={test.testDescription} hasMroHistory={test.documents.some((d) => d.documentType === "correspondence")} onUpdated={loadCase} />
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <span className={`font-medium ${payColor}`}>{label}</span>
                        {test.clientPrice && <span className="text-gray-500">${Number(test.clientPrice).toFixed(2)}</span>}
                      </div>
                      {/* Per-test action button */}
                      {(() => {
                        const testLogs = caseData.statusLogs?.filter((l) => l.testOrderId === test.id) || [];
                        const hasSentNotification = (keyword: string) => testLogs.some((l) => l.notificationSent && l.note?.toLowerCase().includes(keyword));

                        // Specimen collected → send collection confirmation
                        if (test.testStatus === "specimen_collected" && !test.paymentMethod) {
                          const sent = hasSentNotification("collection confirmation");
                          return sent
                            ? <p className="text-[10px] text-green-600 mt-1.5">✓ Collection notice sent</p>
                            : <button onClick={async (e) => { e.stopPropagation(); const r = await fetch(`/api/cases/${caseData.id}/send-collection`, { method: "POST" }); if (r.ok) loadCase(); else alert((await r.json()).error || "Failed"); }} className="mt-1.5 w-full text-[10px] px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-semibold">✉ Send Collection Notice</button>;
                        }
                        // Collected + paid → payment received, send to lab
                        if ((test.testStatus === "specimen_collected" || test.testStatus === "specimen_held") && !!test.paymentMethod) {
                          const sent = hasSentNotification("payment received");
                          return sent
                            ? <p className="text-[10px] text-green-600 mt-1.5">✓ Sent to lab notice sent</p>
                            : <button onClick={async (e) => { e.stopPropagation(); const r = await fetch(`/api/cases/${caseData.id}/send-payment-received`, { method: "POST" }); if (r.ok) loadCase(); else alert((await r.json()).error || "Failed"); }} className="mt-1.5 w-full text-[10px] px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-semibold">✉ Payment Received — Send to Lab</button>;
                        }
                        // Results received + paid → two options: release or release → MRO
                        if (test.testStatus === "results_received" && !!test.paymentMethod) {
                          return (
                            <div className="mt-1.5 flex gap-1">
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                const res = await fetch(`/api/cases/${caseData.id}/test-orders`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testOrderId: test.id, testStatus: "results_released" }) });
                                await fetch(`/api/cases/${caseData.id}/compose-results`, { method: "POST" });
                                window.dispatchEvent(new Event("refreshReminders"));
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data.promptCloseCase) {
                                    const shouldClose = confirm("All tests on this case are now closed.\n\nWould you like to close the case?");
                                    if (shouldClose) {
                                      await fetch(`/api/cases/${caseData.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseStatus: "closed" }) });
                                    }
                                  }
                                }
                                loadCase();
                              }} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 font-semibold">Release Results</button>
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                await fetch(`/api/cases/${caseData.id}/test-orders`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testOrderId: test.id, testStatus: "at_mro" }) });
                                await fetch(`/api/cases/${caseData.id}/compose-results?mro=true`, { method: "POST" });
                                window.dispatchEvent(new Event("refreshReminders"));
                                loadCase();
                              }} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-purple-700 text-white hover:bg-purple-800 font-semibold">Release → MRO</button>
                            </div>
                          );
                        }
                        // At MRO → show button only after MRO document has been uploaded
                        if (test.testStatus === "at_mro") {
                          const hasMroDoc = test.documents.some((d) => d.documentType === "correspondence");
                          if (hasMroDoc) {
                            return (
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                // Advance to mro_released → auto-close fires via PATCH handler
                                const res = await fetch(`/api/cases/${caseData.id}/test-orders`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ testOrderId: test.id, testStatus: "mro_released" }),
                                });
                                // Compose MRO-complete email for the distribution list
                                await fetch(`/api/cases/${caseData.id}/compose-results?mro_complete=true`, { method: "POST" });
                                window.dispatchEvent(new Event("refreshReminders"));
                                // Check if all tests are now closed → prompt to close case
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data.promptCloseCase) {
                                    const shouldClose = confirm("All tests on this case are now closed.\n\nWould you like to close the case?");
                                    if (shouldClose) {
                                      await fetch(`/api/cases/${caseData.id}`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ caseStatus: "closed" }),
                                      });
                                    }
                                  }
                                }
                                loadCase();
                              }} className="mt-1.5 w-full text-[10px] px-2 py-1.5 rounded bg-purple-700 text-white hover:bg-purple-800 font-semibold">
                                ✉ Release MRO Report
                              </button>
                            );
                          }
                          // No MRO doc yet — show waiting message
                          return (
                            <p className="mt-1.5 text-[10px] text-purple-600 font-medium">
                              ⏳ Awaiting MRO report upload
                            </p>
                          );
                        }
                        // Results received/held + unpaid → results held notice
                        if ((test.testStatus === "results_received" || test.testStatus === "results_held") && !test.paymentMethod) {
                          const sent = hasSentNotification("results held");
                          return sent
                            ? <p className="text-[10px] text-amber-600 mt-1.5">✓ Payment notice sent</p>
                            : <button onClick={async (e) => { e.stopPropagation(); const r = await fetch(`/api/cases/${caseData.id}/send-results-held`, { method: "POST" }); if (r.ok) loadCase(); else alert((await r.json()).error || "Failed"); }} className="mt-1.5 w-full text-[10px] px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 font-semibold">✉ Results Held — Request Payment</button>;
                        }
                        return null;
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Monitoring Schedules (sidebar, for monitored cases) */}
          {caseData.isMonitored && (
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Schedules</h3>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="text-xs px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700"
                >
                  + New
                </button>
              </div>
              <MonitoringScheduleCard key={scheduleRefreshKey} caseId={caseData.id} onChanged={loadCase} />
              {showScheduleModal && (
                <CreateScheduleModal
                  caseId={caseData.id}
                  onSaved={() => { setShowScheduleModal(false); setScheduleRefreshKey((k) => k + 1); loadCase(); }}
                  onClose={() => setShowScheduleModal(false)}
                />
              )}
            </section>
          )}

          {/* Combined Contacts & Distribution */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                Contacts & Distribution List
              </h3>
              {(caseData.donor?.email || caseData.caseContacts.filter((cc) => cc.roleInCase !== "donor" && cc.contact.email).length > 0) && (
                <button
                  onClick={() => setShowDistribution(true)}
                  className="text-xs bg-[#1e3a5f] text-white px-3 py-1.5 rounded-lg hover:bg-[#2a5490] font-medium flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Copy Emails
                </button>
              )}
            </div>

            {/* Distribution List Popup */}
            {showDistribution && (() => {
              const donorEmail = caseData.donor?.email || null;
              const contacts = caseData.caseContacts.filter((cc) => cc.roleInCase !== "donor");
              const resultsEmails = [...(donorEmail ? [donorEmail] : []), ...contacts.filter((cc) => cc.receivesResults && cc.contact.email).map((cc) => cc.contact.email!)];
              const statusEmails = [...(donorEmail ? [donorEmail] : []), ...contacts.filter((cc) => cc.receivesStatus && cc.contact.email).map((cc) => cc.contact.email!)];
              const invoiceEmails = contacts.filter((cc) => cc.receivesInvoices && cc.contact.email).map((cc) => cc.contact.email!);
              const contactEmails = contacts.filter((cc) => cc.contact.email).map((cc) => cc.contact.email!);
              const allEmails = [...new Set([...(donorEmail ? [donorEmail] : []), ...contactEmails])];

              const copyToClipboard = (emails: string[], field: string) => {
                navigator.clipboard.writeText(emails.join("; "));
                setCopiedField(field);
                setTimeout(() => setCopiedField(null), 2000);
              };

              return (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowDistribution(false)}>
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="text-lg font-semibold text-gray-900">Distribution List</h3>
                        <button onClick={() => setShowDistribution(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                      </div>

                      <div className="space-y-4">
                        {/* All Emails */}
                        {allEmails.length > 0 && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">All Contacts</span>
                              <button
                                onClick={() => copyToClipboard(allEmails, "all")}
                                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${copiedField === "all" ? "bg-green-100 text-green-700" : "bg-white text-[#1e3a5f] border border-gray-200 hover:bg-gray-100"}`}
                              >
                                {copiedField === "all" ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <p className="text-sm text-gray-700 break-all select-all">{allEmails.join("; ")}</p>
                          </div>
                        )}

                        {/* Results Recipients */}
                        {resultsEmails.length > 0 && (
                          <div className="bg-green-50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-green-700 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                Results Recipients
                              </span>
                              <button
                                onClick={() => copyToClipboard(resultsEmails, "results")}
                                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${copiedField === "results" ? "bg-green-100 text-green-700" : "bg-white text-green-700 border border-green-200 hover:bg-green-100"}`}
                              >
                                {copiedField === "results" ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <p className="text-sm text-gray-700 break-all select-all">{resultsEmails.join("; ")}</p>
                          </div>
                        )}

                        {/* Status Recipients */}
                        {statusEmails.length > 0 && (
                          <div className="bg-blue-50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                Status Recipients
                              </span>
                              <button
                                onClick={() => copyToClipboard(statusEmails, "status")}
                                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${copiedField === "status" ? "bg-blue-100 text-blue-700" : "bg-white text-blue-700 border border-blue-200 hover:bg-blue-100"}`}
                              >
                                {copiedField === "status" ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <p className="text-sm text-gray-700 break-all select-all">{statusEmails.join("; ")}</p>
                          </div>
                        )}

                        {/* Invoice Recipients */}
                        {invoiceEmails.length > 0 && (
                          <div className="bg-yellow-50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                                Invoice Recipients
                              </span>
                              <button
                                onClick={() => copyToClipboard(invoiceEmails, "invoices")}
                                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${copiedField === "invoices" ? "bg-yellow-100 text-yellow-700" : "bg-white text-yellow-700 border border-yellow-200 hover:bg-yellow-100"}`}
                              >
                                {copiedField === "invoices" ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <p className="text-sm text-gray-700 break-all select-all">{invoiceEmails.join("; ")}</p>
                          </div>
                        )}

                        {/* Contact Details */}
                        <div className="border-t border-gray-200 pt-3 mt-3">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact Details</span>
                          <div className="mt-2 space-y-2">
                            {donorEmail && caseData.donor && (
                              <div className="text-sm text-gray-700 flex items-start gap-2">
                                <span className="font-medium whitespace-nowrap">{caseData.donor.firstName} {caseData.donor.lastName}</span>
                                <span className="text-gray-400">—</span>
                                <span className="text-gray-500 capitalize text-xs mt-0.5">Donor</span>
                                <span className="text-gray-400">|</span>
                                <span className="text-blue-600 text-xs mt-0.5">{donorEmail}</span>
                              </div>
                            )}
                            {contacts.map((cc) => (
                              <div key={cc.id} className="text-sm text-gray-700 flex items-start gap-2">
                                <span className="font-medium whitespace-nowrap">{cc.contact.firstName} {cc.contact.lastName}</span>
                                <span className="text-gray-400">—</span>
                                <span className="text-gray-500 capitalize text-xs mt-0.5">{cc.roleInCase.replace(/_/g, " ")}</span>
                                {cc.contact.email && (
                                  <>
                                    <span className="text-gray-400">|</span>
                                    <span className="text-blue-600 text-xs mt-0.5">{cc.contact.email}</span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {caseData.caseContacts.filter((cc) => cc.roleInCase !== "donor").length === 0 ? (
              <p className="text-sm text-amber-600 font-medium mb-3">
                No attorneys, GALs, or contacts added yet. Add contacts below to define who receives results.
              </p>
            ) : (
              <ul className="space-y-3 mb-4">
                {caseData.caseContacts.filter((cc) => cc.roleInCase !== "donor").map((cc) => (
                  <li key={cc.id} className="text-sm border-b border-gray-100 pb-3 last:border-0">
                    <div className="flex items-start justify-between">
                      <div
                        className="cursor-pointer hover:bg-gray-50 rounded p-1 -m-1 flex-1"
                        onClick={() => setEditingContact(cc.id)}
                        title="Click to edit"
                      >
                        <div className="font-medium text-gray-900">
                          {cc.contact.firstName} {cc.contact.lastName}
                          {cc.contact.firmName && <span className="text-gray-400 font-normal"> — {cc.contact.firmName}</span>}
                          <span className="text-xs text-blue-500 ml-1">edit</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          <span className="capitalize font-medium">{cc.roleInCase.replace(/_/g, " ")}</span>
                          {cc.contact.email && <span> | {cc.contact.email}</span>}
                          {cc.contact.phone && <span> | {cc.contact.phone}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {cc.receivesResults && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Results</span>}
                          {cc.receivesStatus && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Status</span>}
                          {cc.receivesInvoices && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">Invoices</span>}
                          {cc.canOrderTests && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Can Order</span>}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!confirm(`Remove ${cc.contact.firstName} ${cc.contact.lastName} from this case?`)) return;
                          await fetch(`/api/cases/${caseData.id}/contacts?caseContactId=${cc.id}`, { method: "DELETE" });
                          loadCase();
                        }}
                        className="text-xs text-red-400 hover:text-red-600 ml-2 shrink-0"
                        title="Remove from case"
                      >
                        &times;
                      </button>
                    </div>
                    {/* Edit Contact Modal */}
                    {editingContact === cc.id && (
                      <EditContactModal
                        caseId={caseData.id}
                        caseContact={cc}
                        onSaved={() => { setEditingContact(null); loadCase(); }}
                        onClose={() => setEditingContact(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            <AddContactForm caseId={caseData.id} onAdded={loadCase} />
          </section>

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Activity Log</h3>
            {caseData.statusLogs.length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet</p>
            ) : (
              <>
                <ul className="space-y-3">
                  {caseData.statusLogs.slice(0, showAllLogs ? undefined : 3).map((log) => (
                    <li key={log.id} className="text-xs border-l-2 border-gray-200 pl-3 py-1">
                      <div className="text-gray-500">{new Date(log.changedAt).toLocaleString()}</div>
                      <div className="text-gray-700 mt-0.5">
                        <span className="capitalize">{log.oldStatus.replace("_", " ")}</span> &rarr; <span className="font-medium capitalize">{log.newStatus.replace("_", " ")}</span>
                      </div>
                      {log.note && <div className="text-gray-400 mt-0.5">{log.note}</div>}
                    </li>
                  ))}
                </ul>
                {caseData.statusLogs.length > 3 && (
                  <button
                    onClick={() => setShowAllLogs(!showAllLogs)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-3"
                  >
                    {showAllLogs ? "Show less" : `Show all (${caseData.statusLogs.length})`}
                  </button>
                )}
              </>
            )}
          </section>

          {/* Notifications Sent */}
          {notifications.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                Notifications Sent
              </h3>
              <ul className="space-y-3">
                {notifications.map((n) => {
                  const recipients = Array.isArray(n.notificationRecipients) ? n.notificationRecipients : [];
                  const label = n.newStatus === "results_released" ? "Results Released" : n.newStatus === "no_show" ? "No Show" : n.newStatus.replace(/_/g, " ");
                  return (
                    <li key={n.id} className="border-l-2 border-green-300 pl-3 py-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700 capitalize">{label}</span>
                        <span className="text-xs text-slate-400">{new Date(n.changedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                      {n.testOrder && <p className="text-xs text-slate-500 mt-0.5">{n.testOrder.testDescription}</p>}
                      <p className="text-xs text-slate-400 mt-0.5">{recipients.length} recipient{recipients.length !== 1 ? "s" : ""}: {recipients.join(", ")}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {caseData.notes && (
            <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Notes</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{caseData.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
