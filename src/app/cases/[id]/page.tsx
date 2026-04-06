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
import { TestStatusButtons } from "@/components/cases/TestStatusButtons";
import { CaseDocuments } from "@/components/cases/CaseDocuments";
import { EditTestOrderModal } from "@/components/cases/EditTestOrderModal";

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
    squarePaymentLink: string | null;
    paymentMethod: string | null;
    paymentDate: string | null;
    sentToLabDate: string | null;
    resultsReceivedDate: string | null;
    resultsReleasedDate: string | null;
    schedulingType: string;
    notes: string | null;
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
    oldStatus: string;
    newStatus: string;
    changedAt: string;
    note: string | null;
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
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
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
      .catch(() => {});
  }, []);

  function loadCase() {
    fetch(`/api/cases/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Case not found");
        return res.json();
      })
      .then((data) => { setCaseData(data); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }

  useEffect(() => {
    loadCase();
    if (params.id) loadNotifications(params.id as string);
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
        </div>
        <div className="flex items-center gap-2">
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
          onSaved={() => { setShowEditCase(false); loadCase(); }}
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
                    <h2 className="text-lg font-semibold text-gray-900">{caseData.donor.firstName} {caseData.donor.lastName}</h2>
                    <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                      {caseData.donor.phone && <span>{caseData.donor.phone}</span>}
                      {caseData.donor.email && <span>{caseData.donor.email}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {caseData.donor.phone && (
                      <button
                        onClick={() => {
                          const msg = encodeURIComponent(`Hi ${caseData.donor!.firstName}, please book your appointment at TrueTest Labs here: https://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK`);
                          window.open(`sms:${caseData.donor!.phone}&body=${msg}`, "_blank");
                        }}
                        className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                      >
                        Text Booking
                      </button>
                    )}
                    {caseData.donor.email && (
                      <button
                        onClick={() => {
                          const subject = encodeURIComponent("TrueTest Labs - Schedule Your Appointment");
                          const body = encodeURIComponent(`Hi ${caseData.donor!.firstName},\n\nPlease book your appointment at TrueTest Labs using the link below:\n\nhttps://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK\n\nThank you,\nTrueTest Labs`);
                          window.open(`mailto:${caseData.donor!.email}?subject=${subject}&body=${body}`, "_blank");
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                      >
                        Email Booking
                      </button>
                    )}
                  </div>
                </div>
              ) : <p className="text-gray-400 py-2">No donor assigned</p>}
            </div>

            {/* Test Orders */}
            <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Test Orders ({caseData.testOrders.length})</h3>
              <div className="flex items-center gap-2">
                {caseData.testOrders.some((t) =>
                  ["specimen_collected", "specimen_held", "sent_to_lab", "results_received", "results_released", "closed"].includes(t.testStatus)
                ) && (
                  collectionConfirmed ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white opacity-60 cursor-default" style={{ background: "#059669" }}>
                      ✓ Collection Notice Sent
                    </span>
                  ) : (
                    <button
                      onClick={async () => {
                        setSendingCollection(true);
                        setCollectionSentMsg(null);
                        try {
                          const res = await fetch(`/api/cases/${caseData.id}/send-collection`, { method: "POST" });
                          const data = await res.json();
                          if (res.ok) {
                            setCollectionConfirmed(true);
                          } else {
                            setCollectionSentMsg(data.error || "Failed to send");
                          }
                        } catch { setCollectionSentMsg("Failed to send"); }
                        setSendingCollection(false);
                      }}
                      disabled={sendingCollection}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #059669 0%, #047857 100%)" }}
                    >
                      {sendingCollection ? "Sending…" : "✉ Send Collection Confirmation"}
                    </button>
                  )
                )}
                {collectionSentMsg && !collectionConfirmed && (
                  <span className="text-xs text-red-500 font-medium">{collectionSentMsg}</span>
                )}
                <AddTestOrder caseId={caseData.id} onAdded={loadCase} />
              </div>
            </div>
            {caseData.testOrders.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-400">No test orders yet</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {caseData.testOrders.map((test) => (
                  <div key={test.id} className="px-6 py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p
                          className="font-medium text-gray-900 cursor-pointer hover:text-blue-600"
                          onClick={() => setEditingTestOrder(test.id)}
                          title="Click to edit"
                        >
                          {test.testDescription} <span className="text-xs text-blue-500">edit</span>
                        </p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                          <span className="capitalize">{test.specimenType}</span>
                          <span className="capitalize">{test.lab.replace("_", "/")}</span>
                          <span className="capitalize">{test.collectionType}</span>
                          {test.collectionSite && <span>@ {test.collectionSite}</span>}
                          {test.labAccessionNumber && <span>Accession: {test.labAccessionNumber}</span>}
                        </div>
                        {test.specimenHeld && (
                          <p className="mt-1 text-xs font-semibold text-orange-600">SPECIMEN HELD — Awaiting payment before sending to lab</p>
                        )}
                      </div>
                      {(() => {
                        const isSweatPatch = test.testDescription?.toLowerCase().includes("sweat patch");
                        const testLabel = isSweatPatch && test.testStatus === "order_created" ? "Patch Applied"
                          : isSweatPatch && test.testStatus === "specimen_collected" ? "Patch Removed"
                          : undefined;
                        return <StatusBadge status={test.testStatus} type="test" label={testLabel} />;
                      })()}
                    </div>
                    <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-400">
                      {test.paymentDate && <span>Paid: {new Date(test.paymentDate).toLocaleDateString()}</span>}
                      {test.orderReleasedDate && <span>Released: {new Date(test.orderReleasedDate).toLocaleDateString()}</span>}
                      {test.appointmentDate && <span>Appt: {new Date(test.appointmentDate).toLocaleDateString()}</span>}
                      {test.collectionDate && <span>Collected: {new Date(test.collectionDate).toLocaleDateString()}</span>}
                      {test.sentToLabDate && <span>Sent to Lab: {new Date(test.sentToLabDate).toLocaleDateString()}</span>}
                      {test.resultsReceivedDate && <span>Results In: {new Date(test.resultsReceivedDate).toLocaleDateString()}</span>}
                      {test.resultsReleasedDate && <span>Results Released: {new Date(test.resultsReleasedDate).toLocaleDateString()}</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs">
                      {(() => {
                        const state = getPaymentState(test.paymentMethod);
                        const label = getPaymentLabel(test.paymentMethod);
                        const color = state === "unpaid" ? "text-red-500" : state === "invoiced" ? "text-blue-600" : "text-green-600";
                        return <span className={`font-medium ${color}`}>{label}</span>;
                      })()}
                      {test.clientPrice && <span className="text-gray-500">Client: ${Number(test.clientPrice).toFixed(2)}</span>}
                      {test.invoiceNumber && <span className="text-gray-400">Invoice: {test.invoiceNumber}</span>}
                    </div>
                    {/* Status advance buttons */}
                    <TestStatusButtons
                      caseId={caseData.id}
                      testOrderId={test.id}
                      currentStatus={test.testStatus}
                      testDescription={test.testDescription}
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

          {/* Monitoring Schedules (only for monitored cases) */}
          {caseData.isMonitored && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Random Testing Schedules</h3>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)" }}
                >
                  + Set Up Schedule
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

          {/* Documents */}
          <CaseDocuments caseId={caseData.id} documents={caseData.documents} onUpdated={loadCase} />

          {/* Result Summaries */}
          {caseData.documents.filter((d) => d.documentType === "result_report" && (d.extractedData as { summary?: string } | null)?.summary).length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Result Summaries</h3>
                {caseData.testOrders.some((t) => t.testStatus === "results_released") && (
                  <div className="flex items-center gap-2">
                    {resultsSentMsg && <span className="text-xs text-green-600 font-medium">{resultsSentMsg}</span>}
                    <button
                      onClick={async () => {
                        setSendingResults(true);
                        setResultsSentMsg(null);
                        try {
                          const res = await fetch(`/api/cases/${caseData.id}/send-results`, { method: "POST" });
                          const data = await res.json();
                          if (res.ok) {
                            setResultsSentMsg(`Sent to ${data.sentTo.length} recipient${data.sentTo.length !== 1 ? "s" : ""}`);
                            loadNotifications(caseData.id);
                          } else {
                            setResultsSentMsg(data.error || "Failed to send");
                          }
                        } catch { setResultsSentMsg("Failed to send"); }
                        setSendingResults(false);
                      }}
                      disabled={sendingResults}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2a5490 100%)" }}
                    >
                      {sendingResults ? "Sending…" : "✉ Send Results Email"}
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
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Case Info</h3>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-gray-500">Case Number</dt><dd className="font-medium">{caseData.caseNumber}</dd></div>
              {caseData.courtCaseNumber && <div><dt className="text-gray-500">Court Case #</dt><dd className="font-medium">{caseData.courtCaseNumber}</dd></div>}
              <div><dt className="text-gray-500">Type</dt><dd className="font-medium flex items-center gap-2">{caseTypeInfo?.label || caseData.caseType}{caseData.isMonitored && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Monitored</span>}</dd></div>
              {caseData.county && <div><dt className="text-gray-500">County</dt><dd className="font-medium">{caseData.county}</dd></div>}
              {caseData.judgeName && <div><dt className="text-gray-500">Judge</dt><dd className="font-medium">{caseData.judgeName}</dd></div>}
<div><dt className="text-gray-500">Created</dt><dd className="font-medium">{new Date(caseData.createdAt).toLocaleDateString()}</dd></div>
            </dl>
          </section>

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
              <ul className="space-y-3">
                {caseData.statusLogs.map((log) => (
                  <li key={log.id} className="text-xs border-l-2 border-gray-200 pl-3 py-1">
                    <div className="text-gray-500">{new Date(log.changedAt).toLocaleString()}</div>
                    <div className="text-gray-700 mt-0.5">
                      <span className="capitalize">{log.oldStatus.replace("_", " ")}</span> &rarr; <span className="font-medium capitalize">{log.newStatus.replace("_", " ")}</span>
                    </div>
                    {log.note && <div className="text-gray-400 mt-0.5">{log.note}</div>}
                  </li>
                ))}
              </ul>
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
