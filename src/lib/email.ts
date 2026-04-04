import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";

// Lazy client — only instantiated when actually sending, so missing key doesn't break build
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM_EMAIL = process.env.FROM_EMAIL || "TrueTest Labs <noreply@truetestlabs.com>";
const REPLY_TO = process.env.REPLY_TO_EMAIL || "Mgammel@truetestlabs.com";
const OFFICE_PHONE = "(847) 258-3966";
const OFFICE_ADDRESS = "2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007";

type Recipient = { email: string; name: string };

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

/** Send results-released email with AI-generated summary */
export async function sendResultsReleasedEmail(
  caseId: string,
  testOrderId: string
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

  const summaryHtml = summary
    ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;font-family:monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;">${summary.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
    : `<p style="color:#64748b;">Results are now available. Please contact our office to obtain a copy.</p>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <!-- Header -->
    <div style="background:#1e3a5f;padding:24px 32px;">
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">TrueTest Labs</p>
      <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;">Test Results Available</h1>
    </div>
    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="color:#334155;font-size:15px;margin:0 0 4px;">Results are now available for:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px;">Case No. ${caseData.caseNumber}${testOrder ? ` &bull; ${testOrder.testDescription}` : ""}</p>

      ${summaryHtml}

      <div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:20px;">
        <p style="color:#475569;font-size:13px;margin:0 0 8px;">Questions? Contact our office:</p>
        <p style="color:#1e3a5f;font-size:14px;font-weight:600;margin:0;">${OFFICE_PHONE}</p>
        <p style="color:#64748b;font-size:13px;margin:4px 0 0;">${OFFICE_ADDRESS}</p>
      </div>
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:11px;margin:0;text-align:center;">This notification was sent by TrueTest Labs Case Management System. Do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  const emailList = recipients.map((r) => r.email);

  // Attach the result PDF if available on disk
  type Attachment = { filename: string; content: Buffer };
  const attachments: Attachment[] = [];
  if (latestResult?.filePath && latestResult?.fileName) {
    try {
      const pdfBuffer = await readFile(latestResult.filePath);
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

/** Send specimen-collected confirmation email (with payment status notice if unpaid) */
export async function sendSampleCollectedEmail(
  caseId: string,
  testOrderId: string
): Promise<string[]> {
  if (!process.env.RESEND_API_KEY) return [];

  const [recipients, caseData, testOrder] = await Promise.all([
    getEmailRecipients(caseId, "status"),
    prisma.case.findUnique({
      where: { id: caseId },
      select: {
        caseNumber: true,
        donor: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.testOrder.findUnique({
      where: { id: testOrderId },
      select: { testDescription: true, collectionDate: true, paymentReceived: true, paymentMethod: true, collectionSiteType: true },
    }),
  ]);

  if (!recipients.length || !caseData) return [];

  const donorName = caseData.donor
    ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
    : "the donor";

  // Payment state: match case detail UI exactly — only check paymentMethod.
  // (paymentReceived can be stale from old auto-advance logic; paymentMethod is the source of truth)
  const isInvoiced = testOrder?.paymentMethod === "invoiced";
  const isPaid = !isInvoiced && !!testOrder?.paymentMethod;

  // Collection location: "truetest" (or unset) = collected at TTL; anything else = external site
  const collectedAtTTL = !testOrder?.collectionSiteType || testOrder.collectionSiteType === "truetest";

  const collectionLine = testOrder?.collectionDate
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 20px;">Collection date: <strong>${new Date(testOrder.collectionDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong></p>`
    : "";

  const unpaidMessage = collectedAtTTL
    ? "Your specimen has been collected and is currently being held at TrueTest Labs pending payment. Once payment is received, your sample will be sent to the lab for processing and results will be released promptly. Please contact our office at your earliest convenience to arrange payment."
    : "Your specimen has been collected at the collection site. Please note that results will be delayed until payment is received. Please contact our office at your earliest convenience to arrange payment so we can process your sample without further delay.";

  const paymentBlock = !isPaid && !isInvoiced
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 6px;">Payment Required</p>
        <p style="color:#78350f;font-size:13px;margin:0;">${unpaidMessage}</p>
      </div>`
    : isInvoiced
    ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#1e40af;font-size:13px;font-weight:600;margin:0 0 6px;">Invoice on File</p>
        <p style="color:#1e3a8a;font-size:13px;margin:0;">An invoice has been issued for this test. Your specimen will be processed and results released once payment is confirmed.</p>
      </div>`
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#059669;padding:24px 32px;">
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">TrueTest Labs</p>
      <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;">Specimen Collected</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#334155;font-size:15px;margin:0 0 4px;">A specimen has been collected for:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 20px;">Case No. ${caseData.caseNumber}${testOrder?.testDescription ? ` &bull; ${testOrder.testDescription}` : ""}</p>
      ${collectionLine}
      ${paymentBlock}
      <div style="border-top:1px solid #e2e8f0;margin-top:${paymentBlock ? "4px" : "20px"};padding-top:20px;">
        <p style="color:#475569;font-size:13px;margin:0 0 8px;">Questions? Contact our office:</p>
        <p style="color:#1e3a5f;font-size:14px;font-weight:600;margin:0;">${OFFICE_PHONE}</p>
        <p style="color:#64748b;font-size:13px;margin:4px 0 0;">${OFFICE_ADDRESS}</p>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:11px;margin:0;text-align:center;">This notification was sent by TrueTest Labs Case Management System. Do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

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

  const apptLine = testOrder?.appointmentDate
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 24px;">Scheduled appointment: <strong>${new Date(testOrder.appointmentDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</strong></p>`
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <!-- Header -->
    <div style="background:#991b1b;padding:24px 32px;">
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">TrueTest Labs</p>
      <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;">No Show — Missed Appointment</h1>
    </div>
    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="color:#334155;font-size:15px;margin:0 0 4px;">The following donor did not appear for their scheduled drug test:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Case No. ${caseData.caseNumber}${testOrder ? ` &bull; ${testOrder.testDescription}` : ""}</p>
      ${apptLine}
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="color:#991b1b;font-size:13px;font-weight:600;margin:0 0 4px;">Action Required</p>
        <p style="color:#7f1d1d;font-size:13px;margin:0 0 12px;">Please contact TrueTest Labs to reschedule or to discuss next steps regarding compliance.</p>
        <a href="https://book.squareup.com/appointments/vktpg026o844b6/location/NRHN4SKCVGFSD/services/362SUMWGC5H55J2MCVTJF4FK"
           style="display:inline-block;background:#1e3a5f;color:#ffffff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px;">
          Schedule Online
        </a>
        <a href="tel:+18472583966"
           style="display:inline-block;background:#ffffff;border:1px solid #fecaca;color:#991b1b;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Call (847) 258-3966
        </a>
      </div>
      <div style="border-top:1px solid #e2e8f0;padding-top:20px;">
        <p style="color:#475569;font-size:13px;margin:0 0 8px;">Contact our office:</p>
        <p style="color:#1e3a5f;font-size:14px;font-weight:600;margin:0;">${OFFICE_PHONE}</p>
        <p style="color:#64748b;font-size:13px;margin:4px 0 0;">${OFFICE_ADDRESS}</p>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:11px;margin:0;text-align:center;">This notification was sent by TrueTest Labs Case Management System. Do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

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
