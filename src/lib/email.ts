import { Resend } from "resend";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";
import {
  formatChicagoLongDate,
  formatChicagoLongDateKey,
  formatChicagoShortDateKey,
  formatChicagoTime,
} from "@/lib/dateChicago";
import { buildComplianceReport } from "@/lib/compliance";
import { generateComplianceReportPDF } from "@/lib/pdf/compliance-report";

// Lazy client — only instantiated when actually sending, so missing key doesn't break build
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM_EMAIL = process.env.FROM_EMAIL || "TrueTest Labs <noreply@truetestlabs.com>";
// Reply-To falls back to the shared support mailbox, NOT a personal inbox, so that a
// missing env var in any environment never accidentally exposes a private email.
const REPLY_TO = process.env.REPLY_TO_EMAIL || "support@truetestlabs.com";
const OFFICE_PHONE = "(847) 258-3966";
const OFFICE_ADDRESS = "2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007";

// Shared professional email font stack — web-safe with modern fallbacks
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Shared email shell — wraps content in a professional layout */
function emailLayout(opts: {
  headerBg?: string; // header background color (default: navy)
  headerTitle: string;
  body: string; // inner HTML for the body section
  footerNote?: string;
}) {
  const bg = opts.headerBg || "#1e3a5f";
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <div style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:${bg};padding:28px 36px;">
      <p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;font-family:${FONT};">TrueTest Labs</p>
      <h1 style="margin:6px 0 0;color:#ffffff;font-size:21px;font-weight:600;font-family:${FONT};line-height:1.3;">${opts.headerTitle}</h1>
    </div>
    <!-- Body -->
    <div style="padding:32px 36px;font-family:${FONT};color:#334155;font-size:15px;line-height:1.6;">
      ${opts.body}
      <!-- Contact -->
      <div style="border-top:1px solid #e2e8f0;margin-top:28px;padding-top:20px;">
        <p style="color:#64748b;font-size:13px;margin:0 0 6px;font-family:${FONT};">Questions? Contact our office:</p>
        <p style="color:#1e3a5f;font-size:14px;font-weight:600;margin:0;font-family:${FONT};">${OFFICE_PHONE}</p>
        <p style="color:#64748b;font-size:13px;margin:4px 0 0;font-family:${FONT};">${OFFICE_ADDRESS}</p>
      </div>
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 36px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:11px;margin:0;text-align:center;font-family:${FONT};">${opts.footerNote || "This notification was sent by TrueTest Labs. Do not reply to this email."}</p>
    </div>
  </div>
</body>
</html>`;
}

/** Format a summary block — clean proportional font, not monospace */
function summaryBlock(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:24px;margin:20px 0;font-family:${FONT};font-size:14px;line-height:1.75;color:#1e293b;white-space:pre-wrap;">${escaped}</div>`;
}

/** Colored callout box */
function calloutBox(opts: { bg: string; border: string; titleColor: string; textColor: string; title: string; text: string }) {
  return `<div style="background:${opts.bg};border:1px solid ${opts.border};border-radius:6px;padding:16px 20px;margin:20px 0;">
    <p style="color:${opts.titleColor};font-size:13px;font-weight:600;margin:0 0 6px;font-family:${FONT};">${opts.title}</p>
    <p style="color:${opts.textColor};font-size:14px;margin:0;line-height:1.6;font-family:${FONT};">${opts.text}</p>
  </div>`;
}

const MRO_INTERNAL_TO = "mrochains@gmail.com";

type Recipient = { email: string; name: string };

/** Auto-send MRO referral email to Michael with result + COC PDFs attached */
export async function sendMroReferralEmail(
  caseId: string,
  testOrderId: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const [caseData, testOrder] = await Promise.all([
    prisma.case.findUnique({
      where: { id: caseId },
      select: {
        caseNumber: true,
        donor: { select: { firstName: true, lastName: true, email: true, phone: true } },
      },
    }),
    prisma.testOrder.findUnique({
      where: { id: testOrderId },
      select: { specimenId: true, testDescription: true },
    }),
  ]);

  if (!caseData || !testOrder) return;

  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "Unknown Donor";
  const specimenId = testOrder.specimenId || "N/A";
  const donorPhone = caseData.donor?.phone;
  const donorEmail = caseData.donor?.email || "N/A";

  const subject = `Specimen ID: ${specimenId}`;

  const phoneLine = donorPhone ? `Phone: ${donorPhone}` : "";
  const bodyLines = [
    `Please review the attached result for ${donorName}`,
    "",
    ...(phoneLine ? [phoneLine] : []),
    `Email: ${donorEmail}`,
  ];

  const html = emailLayout({
    headerBg: "#5b21b6",
    headerTitle: "MRO Referral",
    body: `
      <p style="font-size:15px;margin:0 0 16px;font-family:${FONT};">Please review the attached result for <strong>${donorName}</strong></p>
      ${donorPhone ? `<p style="font-size:14px;margin:0 0 4px;color:#334155;font-family:${FONT};">Phone: ${donorPhone}</p>` : ""}
      <p style="font-size:14px;margin:0 0 4px;color:#334155;font-family:${FONT};">Email: ${donorEmail}</p>
      <p style="font-size:13px;margin:16px 0 0;color:#64748b;font-family:${FONT};">Specimen ID: ${specimenId} &bull; Case ${caseData.caseNumber}</p>`,
  });

  // Attach both result PDF and COC PDF
  type Attachment = { filename: string; content: Buffer };
  const attachments: Attachment[] = [];

  const docs = await prisma.document.findMany({
    where: {
      caseId,
      testOrderId,
      documentType: { in: ["result_report", "chain_of_custody"] },
    },
    orderBy: { uploadedAt: "desc" },
    select: { documentType: true, filePath: true, fileName: true },
  });

  for (const doc of docs) {
    if (doc.filePath && doc.fileName) {
      try {
        const { buffer } = await downloadFile(doc.filePath);
        attachments.push({ filename: doc.fileName, content: buffer });
      } catch (e) {
        console.warn(`[Email] Could not attach ${doc.documentType}:`, e);
      }
    }
  }

  const { error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: [MRO_INTERNAL_TO],
    subject,
    html,
    text: bodyLines.join("\n"),
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  if (sendError) {
    console.error("[Email] MRO referral send error:", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] MRO referral sent to", MRO_INTERNAL_TO);
}

/** Fetch email recipients for a case based on notification type */
export async function getEmailRecipients(
  caseId: string,
  type: "results" | "status"
): Promise<Recipient[]> {
  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      donor: { select: { firstName: true, lastName: true, email: true } },
      caseContacts: {
        include: {
          contact: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  if (!caseData) return [];

  const recipients: Recipient[] = [];

  // Donor always gets both types
  if (caseData.donor?.email) {
    recipients.push({
      email: caseData.donor.email,
      name: `${caseData.donor.firstName} ${caseData.donor.lastName}`,
    });
  }

  // Contacts filtered by notification preference
  for (const cc of caseData.caseContacts) {
    if (!cc.contact.email) continue;
    const include = type === "results" ? cc.receivesResults : cc.receivesStatus;
    if (include) {
      recipients.push({
        email: cc.contact.email,
        name: `${cc.contact.firstName} ${cc.contact.lastName}`,
      });
    }
  }

  // Deduplicate by email address (donor is also added as a case contact on creation)
  const seen = new Set<string>();
  return recipients.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type SendDraftResult =
  | { ok: true; sentTo: string[] }
  | {
      ok: false;
      reason: "not_configured" | "not_found" | "already_sent" | "no_recipients";
    };

/** Send an approved EmailDraft via Resend — builds HTML from the draft's plain-text body */
export async function sendDraftEmail(draftId: string): Promise<SendDraftResult> {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "not_configured" };

  const draft = await prisma.emailDraft.findUnique({
    where: { id: draftId },
    include: {
      case: { select: { caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
      testOrder: { select: { testDescription: true } },
    },
  });

  if (!draft) return { ok: false, reason: "not_found" };
  if (draft.status === "sent") return { ok: false, reason: "already_sent" };

  const isMro = draft.draftType === "results_mro";
  const donorName = draft.case.donor
    ? `${draft.case.donor.firstName} ${draft.case.donor.lastName}`
    : "the donor";

  const attachmentNote = isMro
    ? `<p style="color:#64748b;font-size:13px;margin:16px 0 0;font-family:${FONT};">The MRO report is attached to this email.</p>`
    : "";

  const html = emailLayout({
    headerBg: isMro ? "#5b21b6" : "#1e3a5f",
    headerTitle: isMro ? "MRO Review Complete" : "Test Results Available",
    body: summaryBlock(draft.body) + attachmentNote,
  });

  // `recipients` is a Json column storing string[]; defensively validate at runtime
  // rather than trusting the `as string[]` cast, so malformed rows fail loudly.
  const rawRecipients = draft.recipients;
  const emailList = Array.isArray(rawRecipients)
    ? rawRecipients.filter((r): r is string => typeof r === "string" && r.length > 0)
    : [];
  if (emailList.length === 0) return { ok: false, reason: "no_recipients" };

  // Attach PDFs: for MRO-complete drafts attach the MRO report (correspondence);
  // for standard results drafts attach the lab result report.
  type Attachment = { filename: string; content: Buffer };
  const attachments: Attachment[] = [];

  const docTypesToAttach: DocumentType[] = isMro
    ? [DocumentType.correspondence, DocumentType.result_report] // MRO report first, then lab result as backup
    : [DocumentType.result_report];

  const docsToAttach = await prisma.document.findMany({
    where: {
      caseId: draft.caseId,
      documentType: { in: docTypesToAttach },
      ...(draft.testOrderId ? { testOrderId: draft.testOrderId } : {}),
    },
    orderBy: { uploadedAt: "desc" },
    select: { documentType: true, filePath: true, fileName: true },
  });

  // For MRO drafts: attach MRO correspondence doc; always attach lab result report too
  const seen = new Set<string>();
  for (const docType of docTypesToAttach) {
    const doc = docsToAttach.find((d) => d.documentType === docType && !seen.has(d.filePath ?? ""));
    if (doc?.filePath && doc?.fileName) {
      seen.add(doc.filePath);
      try {
        const { buffer: pdfBuffer } = await downloadFile(doc.filePath);
        attachments.push({ filename: doc.fileName, content: pdfBuffer });
      } catch (e) {
        console.warn(`[Email] Could not attach ${docType}:`, e);
      }
    }
  }

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: draft.subject,
    html,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
  if (sendError) {
    console.error("[Email] Resend error (draft send):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] draft sent, id:", sendData?.id);

  // Mark draft as sent
  await prisma.emailDraft.update({
    where: { id: draftId },
    data: { status: "sent", sentAt: new Date() },
  });

  // Create audit trail
  await prisma.statusLog.create({
    data: {
      caseId: draft.caseId,
      testOrderId: draft.testOrderId,
      oldStatus: "results_released",
      newStatus: "results_released",
      changedBy: "admin",
      note: isMro ? "Results email sent (MRO review)" : "Results email sent",
      notificationSent: true,
      notificationRecipients: emailList,
    },
  });

  return { ok: true, sentTo: emailList };
}

/** Send results-released email with AI-generated summary (legacy — used by other flows) */
export async function sendResultsReleasedEmail(
  caseId: string,
  testOrderId: string,
  options?: { mroReview?: boolean }
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const [recipients, caseData, testOrder] = await Promise.all([
    getEmailRecipients(caseId, "results"),
    prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, donor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.testOrder.findUnique({
      where: { id: testOrderId },
      select: { testDescription: true, specimenType: true },
    }),
  ]);

  if (!recipients.length || !caseData) return [];

  // Get latest result report document (for summary + attachment)
  const latestResult = await prisma.document.findFirst({
    where: { caseId, documentType: "result_report" },
    orderBy: { uploadedAt: "desc" },
    select: { extractedData: true, filePath: true, fileName: true },
  });

  const summary = (latestResult?.extractedData as { summary?: string } | null)?.summary;
  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";

  const summaryContent = summary
    ? summaryBlock(summary)
    : `<p style="color:#64748b;font-family:${FONT};">Results are now available. Please contact our office to obtain a copy.</p>`;

  const mroBlock = options?.mroReview
    ? calloutBox({ bg: "#f5f3ff", border: "#c4b5fd", titleColor: "#5b21b6", textColor: "#4c1d95", title: "Medical Review Officer (MRO) Review", text: "Please note: These results are being forwarded to a Medical Review Officer (MRO) for additional review. If the MRO determines that a valid prescription explains the test result, the final report may differ from the laboratory findings above. You will be notified once the MRO review is complete." })
    : "";

  const html = emailLayout({
    headerTitle: "Test Results Available",
    body: `
      <p style="margin:0 0 4px;">Results are now available for:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:600;margin:0 0 4px;font-family:${FONT};">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px;">Case No. ${caseData.caseNumber}${testOrder ? ` &bull; ${testOrder.testDescription}` : ""}</p>
      ${summaryContent}
      ${mroBlock}`,
  });

  const emailList = recipients.map((r) => r.email);

  // Attach the result PDF if available on disk
  type Attachment = { filename: string; content: Buffer };
  const attachments: Attachment[] = [];
  if (latestResult?.filePath && latestResult?.fileName) {
    try {
      const { buffer: pdfBuffer } = await downloadFile(latestResult.filePath);
      attachments.push({ filename: latestResult.fileName, content: pdfBuffer });
    } catch (e) {
      console.warn("[Email] Could not read result PDF for attachment:", e);
    }
  }

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `Test Results Available — ${caseData.donor?.lastName ?? donorName} (${caseData.caseNumber})`,
    html,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
  if (sendError) {
    console.error("[Email] Resend error (results):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] results sent, id:", sendData?.id);

  return emailList;
}

/** Send a compliance-report email to the case's status recipients, with the PDF attached. */
export async function sendComplianceReportEmail(
  scheduleId: string,
  fromDate: Date,
  toDate: Date
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const report = await buildComplianceReport(scheduleId, fromDate, toDate);
  if (!report) throw new Error("Schedule not found or report could not be built.");

  const recipients = await getEmailRecipients(report.schedule.caseId, "status");
  if (recipients.length === 0) {
    throw new Error("No recipients configured for this case.");
  }

  const pdfBuffer = await generateComplianceReportPDF(report);
  const filename = `compliance-${report.schedule.caseNumber}-${report.period.from}-to-${report.period.to}.pdf`;

  const periodLabel = `${report.period.from} through ${report.period.to}`;
  const { checkInRate, complianceRate, checkInsMade, checkInsMissed, daysSelected, daysTested } = report.summary;

  const html = emailLayout({
    headerTitle: "Random Testing Compliance Report",
    body: `
      <p style="margin:0 0 4px;">Attached is the compliance report for:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:600;margin:0 0 4px;font-family:${FONT};">${report.schedule.donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px;">Case No. ${report.schedule.caseNumber} &bull; ${report.schedule.testName}</p>
      ${summaryBlock(
        `Period: ${periodLabel}\nCheck-ins made: ${checkInsMade}\nCheck-ins missed: ${checkInsMissed}\nDays selected: ${daysSelected}\nDays tested: ${daysTested}\nCheck-in rate: ${checkInRate}%\nCompliance rate: ${complianceRate}%`
      )}
      <p style="margin:0;color:#475569;font-size:14px;">The full report PDF is attached to this email.</p>`,
  });

  const emailList = recipients.map((r) => r.email);

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `Compliance Report — ${report.schedule.donorName} (${report.schedule.caseNumber})`,
    html,
    attachments: [{ filename, content: Buffer.from(pdfBuffer) }],
  });
  if (sendError) {
    console.error("[Email] Resend error (compliance):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] compliance report sent, id:", sendData?.id);

  return emailList;
}

/** Send specimen-collected confirmation email for one or more tests (with combined payment notice if unpaid) */
export async function sendSampleCollectedEmail(
  caseId: string,
  testOrderIds: string[]
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];
  if (!testOrderIds || testOrderIds.length === 0) return [];

  const [recipients, caseData, testOrders] = await Promise.all([
    getEmailRecipients(caseId, "status"),
    prisma.case.findUnique({
      where: { id: caseId },
      select: {
        caseNumber: true,
        donor: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.testOrder.findMany({
      where: { id: { in: testOrderIds } },
      select: { id: true, testDescription: true, collectionDate: true, paymentMethod: true, collectionSiteType: true },
    }),
  ]);

  if (!recipients.length || !caseData || testOrders.length === 0) return [];

  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";

  // Combined payment state across all tests:
  //  - "invoiced": every test has paymentMethod === "invoiced"
  //  - "paid": every test has a paymentMethod set (none "invoiced")
  //  - "unpaid": at least one test has no paymentMethod
  const anyUnpaid = testOrders.some((t) => !t.paymentMethod);
  const allInvoiced = !anyUnpaid && testOrders.every((t) => t.paymentMethod === "invoiced");
  const allPaid = !anyUnpaid && !allInvoiced && testOrders.every((t) => !!t.paymentMethod);

  // Collection location: if all share same site type use it; mixed → default to TTL (more conservative)
  const siteTypes = new Set(testOrders.map((t) => t.collectionSiteType || "truetest"));
  const collectedAtTTL = siteTypes.size !== 1 || siteTypes.has("truetest");

  // Use the first test's collection date (or earliest)
  const firstDate = testOrders.find((t) => t.collectionDate)?.collectionDate;
  const collectionLine = firstDate
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 20px;">Collection date: <strong>${formatChicagoLongDate(firstDate)}</strong></p>`
    : "";

  const unpaidMessage = collectedAtTTL
    ? "Your specimens have been collected and are currently being held at TrueTest Labs pending payment. Once payment is received, your samples will be sent to the lab for processing and results will be released promptly. Please contact our office at your earliest convenience to arrange payment."
    : "Your specimens have been collected at the collection site. Please note that results will be delayed until payment is received. Please contact our office at your earliest convenience to arrange payment so we can process your samples without further delay.";

  const paymentBlock = anyUnpaid
    ? calloutBox({ bg: "#fffbeb", border: "#fde68a", titleColor: "#92400e", textColor: "#78350f", title: "Payment Required", text: unpaidMessage })
    : allInvoiced
    ? calloutBox({ bg: "#eff6ff", border: "#bfdbfe", titleColor: "#1e40af", textColor: "#1e3a8a", title: "Invoice on File", text: "An invoice has been issued. Your specimens will be processed and results released once payment is confirmed." })
    : "";
  // (allPaid → no payment block)
  void allPaid;

  const specimenWord = testOrders.length === 1 ? "specimen" : "specimens";
  const intro = testOrders.length === 1
    ? `A ${specimenWord} has been collected for:`
    : `The following ${specimenWord} have been collected for:`;

  const testListHtml = `<ul style="margin:0 0 20px;padding-left:20px;color:#334155;font-size:14px;line-height:1.8;font-family:${FONT};">${testOrders.map((t) => `<li>${t.testDescription}</li>`).join("")}</ul>`;

  const html = emailLayout({
    headerBg: "#059669",
    headerTitle: `Specimen${testOrders.length === 1 ? "" : "s"} Collected`,
    body: `
      <p style="margin:0 0 4px;">${intro}</p>
      <p style="color:#0f172a;font-size:18px;font-weight:600;margin:0 0 4px;font-family:${FONT};">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Case No. ${caseData.caseNumber}</p>
      ${testListHtml}
      ${collectionLine}
      ${paymentBlock}`,
  });

  const emailList = recipients.map((r) => r.email);

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `Specimen Collected — ${caseData.donor?.lastName ?? donorName} (${caseData.caseNumber})`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (collection):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] collection sent, id:", sendData?.id);

  return emailList;
}

/** Send no-show notification email */
export async function sendNoShowEmail(
  caseId: string,
  testOrderId: string
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const [recipients, caseData, testOrder] = await Promise.all([
    getEmailRecipients(caseId, "status"),
    prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, donor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.testOrder.findUnique({
      where: { id: testOrderId },
      select: { testDescription: true, appointmentDate: true },
    }),
  ]);

  if (!recipients.length || !caseData) return [];

  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";

  const apptDate = testOrder?.appointmentDate ? new Date(testOrder.appointmentDate) : null;
  const apptLine = apptDate
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 24px;">Scheduled appointment: <strong>${formatChicagoLongDate(apptDate)} at ${formatChicagoTime(apptDate)}</strong></p>`
    : "";

  const html = emailLayout({
    headerBg: "#991b1b",
    headerTitle: "No Show — Missed Appointment",
    body: `
      <p style="color:#334155;font-size:15px;margin:0 0 4px;font-family:${FONT};">The following donor did not appear for their scheduled drug test:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;font-family:${FONT};">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;font-family:${FONT};">Case No. ${caseData.caseNumber}${testOrder ? ` &bull; ${testOrder.testDescription}` : ""}</p>
      ${apptLine}
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="color:#991b1b;font-size:13px;font-weight:600;margin:0 0 4px;font-family:${FONT};">Action Required</p>
        <p style="color:#7f1d1d;font-size:13px;margin:0 0 12px;font-family:${FONT};">Please contact TrueTest Labs to reschedule or to discuss next steps regarding compliance.</p>
        <a href="https://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK"
           style="display:inline-block;background:#1e3a5f;color:#ffffff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px;font-family:${FONT};">
          Schedule Online
        </a>
        <a href="tel:+18472583966"
           style="display:inline-block;background:#ffffff;border:1px solid #fecaca;color:#991b1b;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;font-family:${FONT};">
          Call (847) 258-3966
        </a>
      </div>`,
  });

  const emailList = recipients.map((r) => r.email);

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `No Show — ${caseData.donor?.lastName ?? donorName} (${caseData.caseNumber})`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (no-show):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] no-show sent, id:", sendData?.id);

  return emailList;
}

/** Send refusal-to-test email when a donor missed a randomly selected testing day */
export async function sendRefusalToTestEmail(
  caseId: string,
  selectionId: string,
  replacementDate: Date | null
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const [recipients, selection] = await Promise.all([
    getEmailRecipients(caseId, "status"),
    prisma.randomSelection.findUnique({
      where: { id: selectionId },
      include: {
        schedule: {
          select: {
            testCatalog: { select: { testName: true } },
            case: {
              select: {
                caseNumber: true,
                donor: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!recipients.length || !selection) return [];

  const caseData = selection.schedule.case;
  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";
  const missedDate = formatChicagoLongDateKey(selection.selectedDate);

  const replacementBlock = replacementDate
    ? calloutBox({
        bg: "#fef2f2", border: "#fecaca", titleColor: "#991b1b", textColor: "#7f1d1d",
        title: "Replacement Test Scheduled",
        text: `A replacement test has been scheduled for <strong>${formatChicagoLongDateKey(replacementDate)}</strong>. The donor must report to TrueTest Labs on that day by 5:00 PM.`,
      })
    : calloutBox({
        bg: "#fef2f2", border: "#fecaca", titleColor: "#991b1b", textColor: "#7f1d1d",
        title: "No Replacement Scheduled",
        text: "No replacement test has been scheduled. Please contact TrueTest Labs to discuss next steps.",
      });

  const html = emailLayout({
    headerBg: "#991b1b",
    headerTitle: "Refusal to Test",
    body: `
      <p style="color:#334155;font-size:15px;margin:0 0 4px;font-family:${FONT};">The following donor did not appear for their randomly selected drug test:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;font-family:${FONT};">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;font-family:${FONT};">Case No. ${caseData.caseNumber} &bull; ${selection.schedule.testCatalog.testName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 20px;font-family:${FONT};">Selected date: <strong>${missedDate}</strong></p>
      ${replacementBlock}`,
  });

  const emailList = recipients.map((r) => r.email);
  const lastName = caseData.donor?.lastName ?? donorName;

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `Refusal to Test — ${lastName} (${caseData.caseNumber})`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (refusal):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] refusal sent, id:", sendData?.id);

  return emailList;
}

/** Send appointment booking confirmation email to the donor */
export async function sendBookingConfirmationEmail(opts: {
  toEmail: string;
  firstName: string;
  startTime: Date | string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const apptDate = new Date(opts.startTime);
  const dateStr = formatChicagoLongDate(apptDate);
  const timeStr = formatChicagoTime(apptDate);

  const html = emailLayout({
    headerBg: "#1e3a5f",
    headerTitle: "Appointment Confirmed",
    body: `
      <p style="font-size:15px;margin:0 0 20px;font-family:${FONT};">Hi ${opts.firstName}, your appointment has been booked. Here are your details:</p>

      <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;font-family:${FONT};">Date &amp; Time</p>
        <p style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 4px;font-family:${FONT};">${dateStr}</p>
        <p style="color:#475569;font-size:15px;font-weight:600;margin:0;font-family:${FONT};">${timeStr}</p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;font-family:${FONT};">Location</p>
        <p style="color:#0f172a;font-size:14px;font-weight:600;margin:0 0 2px;font-family:${FONT};">TrueTest Labs</p>
        <p style="color:#475569;font-size:13px;margin:0 0 2px;font-family:${FONT};">${OFFICE_ADDRESS}</p>
        <p style="color:#475569;font-size:13px;margin:4px 0 0;font-family:${FONT};">Phone: ${OFFICE_PHONE}</p>
        <p style="color:#64748b;font-size:12px;margin:8px 0 0;font-family:${FONT};">Hours: Mon–Fri 9:00 AM – 5:00 PM</p>
      </div>

      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.6;font-family:${FONT};">
        Please arrive on time and bring a valid photo ID. If you need to reschedule, call us at ${OFFICE_PHONE} as soon as possible.
      </p>`,
    footerNote: "You received this because an appointment was booked on your behalf at TrueTest Labs.",
  });

  const { error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: [opts.toEmail],
    subject: `Appointment Confirmed — ${dateStr} at ${timeStr}`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (booking confirmation):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] booking confirmation sent to:", opts.toEmail);
}

/**
 * Donor-portal one-time login code. Short transactional email sent when a
 * donor signs in from a brand-new device. Plain 6-digit code, 5-min expiry.
 */
export async function sendPortalOtpEmail(opts: {
  toEmail: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY not set — skipping portal OTP email");
    return { ok: false, error: "resend_not_configured" };
  }

  const html = emailLayout({
    headerBg: "#1e3a5f",
    headerTitle: "Your Portal Sign-In Code",
    body: `
      <p style="font-size:15px;margin:0 0 20px;font-family:${FONT};">Enter this code in the TrueTest Labs portal to finish signing in:</p>

      <div style="background:#f1f5f9;border:2px solid #1e3a5f;border-radius:8px;padding:24px;margin:0 0 24px;text-align:center;">
        <p style="color:#1e3a5f;font-size:34px;font-weight:700;letter-spacing:8px;margin:0;font-family:'SF Mono', Menlo, Consolas, monospace;">${opts.code}</p>
      </div>

      <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;font-family:${FONT};">
        This code expires in 5 minutes. You only need to enter a code the first time you sign in on a new device — after that, this device will remember you.
      </p>

      <p style="font-size:13px;color:#94a3b8;margin:0;line-height:1.6;font-family:${FONT};">
        Didn't try to sign in? Ignore this email — your account is safe.
      </p>`,
    footerNote: "This is an automated security email. Do not reply.",
  });

  const { error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: [opts.toEmail],
    subject: `Your TrueTest Labs sign-in code: ${opts.code}`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (portal OTP):", sendError);
    return { ok: false, error: sendError.message };
  }
  console.log("[Email] portal OTP sent to:", opts.toEmail);
  return { ok: true };
}

/** Send donor compliance instructions for a monitoring schedule (PIN, check-in link, rules) */
export async function sendDonorInstructionsEmail(scheduleId: string): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      testCatalog: { select: { testName: true } },
      case: {
        select: {
          caseNumber: true,
          donor: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  if (!schedule || !schedule.case.donor?.email) return [];

  const donor = schedule.case.donor;
  const donorEmail: string = donor.email!;
  const donorName = `${donor.firstName} ${donor.lastName}`;
  const portalUrl =
    (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://truetest-case-tracker.vercel.app").replace(/\/$/, "") +
    "/portal";
  const patternSummary =
    schedule.patternType === "range_count" ? `${schedule.targetCount} random tests through ${schedule.endDate ? formatChicagoShortDateKey(schedule.endDate) : "an ongoing period"}`
    : schedule.patternType === "per_month" ? `${schedule.targetCount} random test${schedule.targetCount === 1 ? "" : "s"} per month`
    : `${schedule.targetCount} random test${schedule.targetCount === 1 ? "" : "s"} per week`;

  const html = emailLayout({
    headerTitle: "Random Testing — Compliance Instructions",
    body: `
      <p style="color:#334155;font-size:15px;margin:0 0 4px;font-family:${FONT};">Hello ${donor.firstName},</p>
      <p style="color:#475569;font-size:14px;margin:0 0 20px;line-height:1.6;font-family:${FONT};">You have been enrolled in a random drug testing schedule. Please read these instructions carefully and save this email — you will need your PIN every weekday.</p>

      <!-- PIN + Case info -->
      <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;font-family:${FONT};">Your Check-In PIN</p>
        <p style="color:#0f172a;font-size:36px;font-weight:700;font-family:monospace;letter-spacing:4px;margin:0 0 12px;">${schedule.checkInPin}</p>
        <p style="color:#475569;font-size:13px;margin:0;font-family:${FONT};">Case: <strong>${schedule.case.caseNumber}</strong> &bull; Test: <strong>${schedule.testCatalog.testName}</strong></p>
        <p style="color:#475569;font-size:13px;margin:4px 0 0;font-family:${FONT};">Schedule: <strong>${patternSummary}</strong></p>
      </div>

      <!-- Portal link -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
        <p style="color:#1e3a8a;font-size:13px;font-weight:600;margin:0 0 10px;font-family:${FONT};">Your Donor Portal</p>
        <p style="margin:0 0 12px;">
          <a href="${portalUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:6px;font-family:${FONT};">Open My Portal</a>
        </p>
        <p style="color:#1e3a8a;font-size:12px;margin:0;font-family:${FONT};word-break:break-all;">
          <a href="${portalUrl}" style="color:#1e3a8a;text-decoration:underline;">${portalUrl}</a>
        </p>
        <p style="color:#475569;font-size:12px;margin:10px 0 0;font-family:${FONT};">Bookmark this page — it's where you'll check in every weekday.</p>
      </div>

      <!-- How it works -->
      <h2 style="color:#0f172a;font-size:16px;font-weight:700;margin:0 0 12px;font-family:${FONT};">How It Works</h2>
      <ol style="color:#334155;font-size:14px;line-height:1.8;margin:0 0 24px;padding-left:20px;font-family:${FONT};">
        <li><strong>Check in EVERY weekday (Monday–Friday)</strong> between 6:00 AM and 12:00 PM.</li>
        <li>Open your portal at <a href="${portalUrl}" style="color:#2563eb;text-decoration:underline;">${portalUrl}</a> and sign in with your PIN.</li>
        <li>The portal will tell you one of two things:
          <ul style="margin:8px 0 0;padding-left:20px;">
            <li><strong style="color:#dc2626;">"You are selected today"</strong> — report to TrueTest Labs that same day by 5:00 PM</li>
            <li><strong style="color:#059669;">"No test today"</strong> — no further action needed; check again tomorrow</li>
          </ul>
        </li>
        <li>The first time you sign in on a new phone or browser, we'll text you a 6-digit code to confirm it's you, then remember that device for next time.</li>
      </ol>

      <!-- Compliance -->
      ${calloutBox({
        bg: "#fef2f2", border: "#fecaca", titleColor: "#991b1b", textColor: "#7f1d1d",
        title: "IMPORTANT — Failure to Comply",
        text: "If you are selected and do not report to TrueTest Labs by 5:00 PM that same day, it will be recorded as a <strong>Refusal to Test</strong>. A Refusal to Test notification will be sent to your case contacts, which may include your attorney, the court, and other parties. This may have the same legal consequences as a positive test result.",
      })}

      <!-- Address -->
      <h2 style="color:#0f172a;font-size:16px;font-weight:700;margin:0 0 12px;font-family:${FONT};">Report To</h2>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="color:#0f172a;font-size:14px;font-weight:600;margin:0 0 4px;font-family:${FONT};">TrueTest Labs</p>
        <p style="color:#475569;font-size:13px;margin:0 0 2px;font-family:${FONT};">${OFFICE_ADDRESS}</p>
        <p style="color:#475569;font-size:13px;margin:0;font-family:${FONT};">Phone: ${OFFICE_PHONE}</p>
        <p style="color:#64748b;font-size:12px;margin:8px 0 0;font-family:${FONT};">Hours: Mon–Fri 9:00 AM – 5:00 PM</p>
      </div>

      <!-- FAQ -->
      <h2 style="color:#0f172a;font-size:16px;font-weight:700;margin:0 0 12px;font-family:${FONT};">Common Questions</h2>
      <div style="color:#334155;font-size:13px;line-height:1.7;font-family:${FONT};">
        <p style="margin:0 0 10px;"><strong>What if I forget to call in?</strong><br>You must call in every weekday, even if you think you won't be selected. Missing a call-in on a day you were selected counts as a Refusal to Test.</p>
        <p style="margin:0 0 10px;"><strong>What about weekends and holidays?</strong><br>You do not need to call in on Saturdays, Sundays, or federal holidays. Tests are only scheduled on weekdays.</p>
        <p style="margin:0 0 10px;"><strong>What if I'm traveling or sick?</strong><br>Contact our office at ${OFFICE_PHONE} immediately to discuss. Unexcused absences from selected tests will be reported.</p>
        <p style="margin:0;"><strong>Can I share my PIN with anyone?</strong><br>No. Your PIN is unique to you. Keep it confidential.</p>
      </div>`,
    footerNote: "This notification was sent by TrueTest Labs. Please save this email for reference.",
  });

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: [donorEmail],
    subject: `Random Testing Instructions — Case ${schedule.case.caseNumber}`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (donor instructions):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] donor instructions sent, id:", sendData?.id, "to:", donorEmail);
  void donorName;

  return [donorEmail];
}

/** Send results-held-pending-payment notification */
export async function sendResultsHeldEmail(
  caseId: string,
  testOrderIds: string[]
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY || !testOrderIds.length) return [];

  const [recipients, caseData, testOrders] = await Promise.all([
    getEmailRecipients(caseId, "status"),
    prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, donor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.testOrder.findMany({
      where: { id: { in: testOrderIds } },
      select: { testDescription: true },
    }),
  ]);

  if (!recipients.length || !caseData) return [];

  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";

  const testList = testOrders.length === 1
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 20px;">${testOrders[0].testDescription}</p>`
    : `<ul style="margin:0 0 20px;padding-left:20px;color:#334155;font-size:14px;line-height:1.8;">${testOrders.map(t => `<li>${t.testDescription}</li>`).join("")}</ul>`;

  const html = emailLayout({
    headerBg: "#b45309",
    headerTitle: "Results Available — Payment Required",
    body: `
      <p style="color:#334155;font-size:15px;margin:0 0 4px;font-family:${FONT};">Lab results have been received for:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;font-family:${FONT};">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;font-family:${FONT};">Case No. ${caseData.caseNumber}</p>
      ${testList}
      ${calloutBox({
        bg: "#fffbeb", border: "#fde68a", titleColor: "#92400e", textColor: "#78350f",
        title: "Payment Required Before Release",
        text: "Your test results have been received by TrueTest Labs and are ready for review. However, results cannot be released until outstanding payment has been received. Please contact our office at your earliest convenience to arrange payment so we can release your results promptly.",
      })}
      <div style="text-align:center;margin:24px 0;">
        <a href="tel:+18472583966" style="display:inline-block;background:#1e3a5f;color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:${FONT};">Call (847) 258-3966</a>
      </div>`,
  });

  const emailList = recipients.map((r) => r.email);

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `Results Available — Payment Required — ${caseData.donor?.lastName ?? donorName} (${caseData.caseNumber})`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (results held):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] results-held sent, id:", sendData?.id);

  return emailList;
}

/** Send payment received + sample shipping to lab notification */
export async function sendPaymentReceivedEmail(
  caseId: string,
  testOrderIds: string[]
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY || !testOrderIds.length) return [];

  const [recipients, caseData, testOrders] = await Promise.all([
    getEmailRecipients(caseId, "status"),
    prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, donor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.testOrder.findMany({
      where: { id: { in: testOrderIds } },
      select: { testDescription: true },
    }),
  ]);

  if (!recipients.length || !caseData) return [];

  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";

  const testList = testOrders.length === 1
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 20px;">${testOrders[0].testDescription}</p>`
    : `<ul style="margin:0 0 20px;padding-left:20px;color:#334155;font-size:14px;line-height:1.8;">${testOrders.map(t => `<li>${t.testDescription}</li>`).join("")}</ul>`;

  const html = emailLayout({
    headerBg: "#059669",
    headerTitle: "Payment Received — Sample Sent to Lab",
    body: `
      <p style="color:#334155;font-size:15px;margin:0 0 4px;font-family:${FONT};">Payment has been received for:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;font-family:${FONT};">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;font-family:${FONT};">Case No. ${caseData.caseNumber}</p>
      ${testList}
      ${calloutBox({
        bg: "#ecfdf5", border: "#a7f3d0", titleColor: "#065f46", textColor: "#064e3b",
        title: "Sample Being Processed",
        text: "Your payment has been received and your specimen is now being sent to the lab for processing. Results generally take 3-6 business days to be available and will be released once testing is complete.",
      })}`,
  });

  const emailList = recipients.map((r) => r.email);

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: emailList,
    subject: `Payment Received — ${caseData.donor?.lastName ?? donorName} (${caseData.caseNumber})`,
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (payment received):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] payment-received sent, id:", sendData?.id);

  return emailList;
}

/**
 * Short "here's your PIN" reminder — sent when a donor forgot or deleted
 * the original instructions email. Same PIN block as the full instructions
 * email but without the compliance wall of text. Returns the email
 * address it was sent to, or [] if no donor email is on file.
 */
export async function sendPinReminderEmail(scheduleId: string): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      testCatalog: { select: { testName: true } },
      case: {
        select: {
          caseNumber: true,
          donor: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  if (!schedule || !schedule.case.donor?.email) return [];

  const donor = schedule.case.donor;
  const donorEmail: string = donor.email!;
  const portalUrl =
    (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://truetest-case-tracker.vercel.app").replace(/\/$/, "") + "/portal";

  const html = emailLayout({
    headerTitle: "Your Check-In PIN",
    body: `
      <p style="color:#334155;font-size:15px;margin:0 0 4px;font-family:${FONT};">Hello ${donor.firstName},</p>
      <p style="color:#475569;font-size:14px;margin:0 0 20px;line-height:1.6;font-family:${FONT};">You (or TrueTest Labs staff on your behalf) requested a PIN reminder. Use this PIN to sign in to the donor portal.</p>

      <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="color:#64748b;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;font-family:${FONT};">Your Check-In PIN</p>
        <p style="color:#0f172a;font-size:36px;font-weight:700;font-family:monospace;letter-spacing:4px;margin:0 0 12px;">${schedule.checkInPin}</p>
        <p style="color:#475569;font-size:13px;margin:0;font-family:${FONT};">Case: <strong>${schedule.case.caseNumber}</strong> &bull; Test: <strong>${schedule.testCatalog.testName}</strong></p>
      </div>

      <!-- Portal button -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center;">
        <p style="margin:0 0 12px;">
          <a href="${portalUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:6px;font-family:${FONT};">Open My Portal</a>
        </p>
        <p style="color:#1e3a8a;font-size:12px;margin:0;font-family:${FONT};word-break:break-all;">
          <a href="${portalUrl}" style="color:#1e3a8a;text-decoration:underline;">${portalUrl}</a>
        </p>
      </div>

      <p style="color:#64748b;font-size:12px;margin:0;font-family:${FONT};">For security, if this is the first time signing in on this device, we'll also text you a 6-digit verification code. Keep this PIN confidential.</p>`,
    footerNote: "This is a PIN reminder. If you didn't request it, contact TrueTest Labs.",
  });

  const { data: sendData, error: sendError } = await getResend().emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    to: donorEmail,
    subject: "Your TrueTest Labs PIN",
    html,
  });
  if (sendError) {
    console.error("[Email] Resend error (pin reminder):", sendError);
    throw new Error(sendError.message);
  }
  console.log("[Email] pin-reminder sent, id:", sendData?.id);
  return [donorEmail];
}
