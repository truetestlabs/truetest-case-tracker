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
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 20px;">Collection date: <strong>${new Date(firstDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong></p>`
    : "";

  // Render a list of tests
  const testList = `
    <ul style="margin:0 0 20px;padding-left:20px;color:#334155;font-size:14px;line-height:1.8;">
      ${testOrders.map((t) => `<li>${t.testDescription}</li>`).join("")}
    </ul>`;

  const unpaidMessage = collectedAtTTL
    ? "Your specimens have been collected and are currently being held at TrueTest Labs pending payment. Once payment is received, your samples will be sent to the lab for processing and results will be released promptly. Please contact our office at your earliest convenience to arrange payment."
    : "Your specimens have been collected at the collection site. Please note that results will be delayed until payment is received. Please contact our office at your earliest convenience to arrange payment so we can process your samples without further delay.";

  const paymentBlock = anyUnpaid
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 6px;">Payment Required</p>
        <p style="color:#78350f;font-size:13px;margin:0;">${unpaidMessage}</p>
      </div>`
    : allInvoiced
    ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#1e40af;font-size:13px;font-weight:600;margin:0 0 6px;">Invoice on File</p>
        <p style="color:#1e3a8a;font-size:13px;margin:0;">An invoice has been issued. Your specimens will be processed and results released once payment is confirmed.</p>
      </div>`
    : "";
  // (allPaid → no payment block)
  void allPaid;

  const specimenWord = testOrders.length === 1 ? "specimen" : "specimens";
  const intro = testOrders.length === 1
    ? `A ${specimenWord} has been collected for:`
    : `The following ${specimenWord} have been collected for:`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#059669;padding:24px 32px;">
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">TrueTest Labs</p>
      <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;">Specimen${testOrders.length === 1 ? "" : "s"} Collected</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#334155;font-size:15px;margin:0 0 4px;">${intro}</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Case No. ${caseData.caseNumber}</p>
      ${testList}
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
  const missedDate = new Date(selection.selectedDate).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const replacementBlock = replacementDate
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="color:#991b1b;font-size:13px;font-weight:600;margin:0 0 4px;">Replacement Test Scheduled</p>
        <p style="color:#7f1d1d;font-size:13px;margin:0;">A replacement test has been scheduled for <strong>${new Date(replacementDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong>. The donor must report to TrueTest Labs on that day by 5:00 PM.</p>
      </div>`
    : `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="color:#991b1b;font-size:13px;font-weight:600;margin:0 0 4px;">No Replacement Scheduled</p>
        <p style="color:#7f1d1d;font-size:13px;margin:0;">No replacement test has been scheduled. Please contact TrueTest Labs to discuss next steps.</p>
      </div>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#991b1b;padding:24px 32px;">
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">TrueTest Labs</p>
      <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;">Refusal to Test</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#334155;font-size:15px;margin:0 0 4px;">The following donor did not appear for their randomly selected drug test:</p>
      <p style="color:#0f172a;font-size:18px;font-weight:700;margin:0 0 4px;">${donorName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Case No. ${caseData.caseNumber} &bull; ${selection.schedule.testCatalog.testName}</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 20px;">Selected date: <strong>${missedDate}</strong></p>
      ${replacementBlock}
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
