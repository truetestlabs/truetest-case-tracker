import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { uploadFile } from "@/lib/storage";
import { getEmailRecipients } from "@/lib/email";
import {
  generateCancelledTestReportPDF,
  buildCancellationReportFilename,
} from "@/lib/pdf/cancelled-test-report";

// POST /api/cases/[id]/cancellation-report
//
// Generates the patch cancellation notice PDF for a previously-cancelled
// PatchDetails record, uploads it to Supabase storage, creates a Document
// row (documentType: "cancellation_notice"), and creates a pending
// EmailDraft addressed to the case's results-distribution list.
//
// Decoupled from POST /cancel-patch on purpose: a PDF or storage failure
// here must not affect the cancellation record. The cancellation is
// authoritative in the DB; this endpoint can be retried independently.
//
// Body: { patchDetailsId: string }
// Returns 201 with { documentId, draftId, filePath, fileName }.

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let body: { patchDetailsId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.patchDetailsId) {
    return NextResponse.json(
      { error: "patchDetailsId is required" },
      { status: 400 },
    );
  }

  // ── Load all the data the PDF needs in one round-trip ───────────────
  const patch = await prisma.patchDetails.findUnique({
    where: { id: body.patchDetailsId },
    include: {
      testOrder: {
        select: {
          id: true,
          caseId: true,
          specimenId: true,
          case: {
            select: {
              caseNumber: true,
              courtCaseNumber: true,
              donor: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  });

  if (!patch) {
    return NextResponse.json(
      { error: "PatchDetails not found" },
      { status: 404 },
    );
  }
  if (patch.testOrder.caseId !== caseId) {
    return NextResponse.json(
      { error: "PatchDetails does not belong to this case" },
      { status: 400 },
    );
  }
  if (!patch.cancellationKind || !patch.cancelledAt) {
    return NextResponse.json(
      { error: "Patch is not cancelled — cannot generate cancellation report" },
      { status: 409 },
    );
  }

  const caseData = patch.testOrder.case;
  const donorFirst = caseData.donor?.firstName ?? "Unknown";
  const donorLast = caseData.donor?.lastName ?? "Donor";
  const donorName = caseData.donor
    ? `${donorFirst} ${donorLast}`
    : "Donor name not on record";

  // ── Generate the PDF ────────────────────────────────────────────────
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateCancelledTestReportPDF({
      caseNumber: caseData.caseNumber,
      courtCaseNumber: caseData.courtCaseNumber,
      donorName,
      specimenId: patch.testOrder.specimenId,
      applicationDate: patch.applicationDate,
      cancellationDate: patch.cancelledAt,
      replacement:
        patch.replacementPatchApplied && patch.replacementPatchDate
          ? { applied: true, applicationDate: patch.replacementPatchDate }
          : { applied: false },
    });
  } catch (e) {
    console.error("[cancellation-report] PDF generation failed:", e);
    return NextResponse.json(
      { error: "Failed to generate cancellation notice PDF" },
      { status: 500 },
    );
  }

  // ── Upload to Supabase ──────────────────────────────────────────────
  const fileName = buildCancellationReportFilename(
    donorFirst,
    donorLast,
    patch.cancelledAt,
  );
  const timestamp = Date.now();
  const storagePath = `${caseId}/cancellation_notice_${timestamp}_${fileName}`;
  try {
    await uploadFile(storagePath, pdfBuffer, "application/pdf");
  } catch (e) {
    console.error("[cancellation-report] Storage upload failed:", e);
    return NextResponse.json(
      { error: "Failed to store cancellation notice" },
      { status: 502 },
    );
  }

  // ── Create the Document row ─────────────────────────────────────────
  const document = await prisma.document.create({
    data: {
      caseId,
      testOrderId: patch.testOrder.id,
      documentType: "cancellation_notice",
      fileName,
      filePath: storagePath,
      uploadedBy: user.email || user.name || "admin",
      notes: null,
    },
  });

  // ── Create the EmailDraft ──────────────────────────────────────────
  // Same recipient list as lab results (per spec).
  const recipients = await getEmailRecipients(caseId, "results");
  const recipientEmails = recipients.map((r) => r.email);

  const lastName = caseData.donor?.lastName ?? "Donor";
  const docket = caseData.courtCaseNumber;
  const subject = docket
    ? `${docket} / ${lastName} — Patch Cancellation Notice (${caseData.caseNumber})`
    : `Patch Cancellation Notice — ${lastName} (${caseData.caseNumber})`;

  const bodyLines: string[] = [];
  bodyLines.push(
    `A patch cancellation notice has been issued for ${donorName}.`,
  );
  bodyLines.push(`Case No. ${caseData.caseNumber}`);
  bodyLines.push("");
  bodyLines.push("The notice is attached to this email.");
  bodyLines.push("");
  bodyLines.push("Questions? Contact our office:");
  bodyLines.push("(847) 258-3966");
  bodyLines.push("2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007");

  const draft = await prisma.emailDraft.create({
    data: {
      caseId,
      testOrderId: patch.testOrder.id,
      draftType: "patch_cancellation",
      recipients: recipientEmails,
      subject,
      body: bodyLines.join("\n"),
      status: "pending",
      createdBy: user.email || user.name || "admin",
    },
  });

  await prisma.statusLog.create({
    data: {
      caseId,
      testOrderId: patch.testOrder.id,
      oldStatus: "—",
      newStatus: "cancellation_notice_generated",
      changedBy: user.email || user.name || "admin",
      note: `Cancellation notice generated and queued for distribution: ${fileName}`,
    },
  });

  logAudit({
    userId: user.id,
    action: "patch.cancellation_report.generate",
    resource: "document",
    resourceId: document.id,
    metadata: {
      caseId,
      patchDetailsId: patch.id,
      draftId: draft.id,
      recipientCount: recipientEmails.length,
    },
  }).catch((e) =>
    console.error("[cancellation-report] audit failed:", e),
  );

  return NextResponse.json(
    {
      documentId: document.id,
      draftId: draft.id,
      filePath: storagePath,
      fileName,
      recipientCount: recipientEmails.length,
    },
    { status: 201 },
  );
}
