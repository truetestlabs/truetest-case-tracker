import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmailRecipients, sendMroReferralEmail } from "@/lib/email";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/cases/[id]/compose-results?mro=true|false
 *
 * Returns the email data (recipients, subject, plain-text body) for the
 * results email so the user can review and send from their own email client.
 * Does NOT send the email — the client opens a mailto: link.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const mroReview = searchParams.get("mro") === "true";
  const mroComplete = searchParams.get("mro_complete") === "true";

  try {
    const [recipients, caseData] = await Promise.all([
      getEmailRecipients(caseId, "results"),
      prisma.case.findUnique({
        where: { id: caseId },
        select: {
          caseNumber: true,
          courtCaseNumber: true,
          donor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    if (!caseData) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const testOrder = await prisma.testOrder.findFirst({
      where: { caseId, testStatus: { in: ["results_received", "results_released", "at_mro", "mro_released", "closed"] } },
      orderBy: { updatedAt: "desc" },
      select: { testDescription: true, specimenType: true },
    });

    const donorName = caseData.donor
      ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
      : "the donor";
    const lastName = caseData.donor?.lastName ?? donorName;
    const docket = caseData.courtCaseNumber;
    const to = recipients.map((r) => r.email);

    // MRO Complete email — sent after MRO report is uploaded and staff clicks "Release MRO Report"
    if (mroComplete) {
      const mroDoc = await prisma.document.findFirst({
        where: { caseId, documentType: { in: ["correspondence", "other"] } },
        orderBy: { uploadedAt: "desc" },
        select: { extractedData: true },
      });
      const mroSummary = (mroDoc?.extractedData as { summary?: string } | null)?.summary;

      const subject = docket
        ? `${docket} / ${lastName} — MRO Review Complete (${caseData.caseNumber})`
        : `MRO Review Complete — ${lastName} (${caseData.caseNumber})`;

      const lines: string[] = [];
      lines.push("MRO Review Complete");
      lines.push("");
      lines.push(`The Medical Review Officer has completed their review for ${donorName}.`);
      lines.push(`Case No. ${caseData.caseNumber}${testOrder ? ` \u2022 ${testOrder.testDescription}` : ""}`);
      lines.push("");
      if (mroSummary) {
        lines.push(mroSummary);
      } else {
        lines.push("The MRO report is now available. Please contact our office to obtain a copy of the final report.");
      }
      lines.push("");
      lines.push("Questions? Contact our office:");
      lines.push("(847) 258-3966");
      lines.push("2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007");

      return NextResponse.json({ to, subject, body: lines.join("\n"), donorName, caseNumber: caseData.caseNumber });
    }

    // Standard results email (with optional MRO notice)
    const latestResult = await prisma.document.findFirst({
      where: { caseId, documentType: "result_report" },
      orderBy: { uploadedAt: "desc" },
      select: { extractedData: true },
    });

    const summary = (latestResult?.extractedData as { summary?: string } | null)?.summary;

    const subject = docket
      ? `${docket} / ${lastName} — ${testOrder?.testDescription || "Test"} Results (${caseData.caseNumber})`
      : `Test Results Available — ${lastName} (${caseData.caseNumber})`;

    const lines: string[] = [];
    lines.push(`Results are now available for:`);
    lines.push(`${donorName}`);
    lines.push(`Case No. ${caseData.caseNumber}${testOrder ? ` \u2022 ${testOrder.testDescription}` : ""}`);
    lines.push("");

    if (summary) {
      lines.push(summary);
    } else {
      lines.push("Results are now available. Please contact our office to obtain a copy.");
    }

    if (mroReview) {
      lines.push("");
      lines.push("--- MRO Review Notice ---");
      lines.push("Please note: These results are being forwarded to a Medical Review Officer (MRO) for additional review. If the MRO determines that a valid prescription explains the test result, the final report may differ from the laboratory findings above. You will be notified once the MRO review is complete.");
    }

    lines.push("");
    lines.push("Questions? Contact our office:");
    lines.push("(847) 258-3966");
    lines.push("2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007");

    const body = lines.join("\n");

    return NextResponse.json({ to, subject, body, donorName, caseNumber: caseData.caseNumber });
  } catch (error) {
    console.error("Compose results error:", error);
    return NextResponse.json({ error: "Failed to compose email" }, { status: 500 });
  }
}

/**
 * POST /api/cases/[id]/compose-results?mro=true|false
 *
 * Creates an EmailDraft for review before sending. The draft appears in
 * the reminder bell for Michael to review, edit, and approve.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const mroReview = searchParams.get("mro") === "true";
  const mroComplete = searchParams.get("mro_complete") === "true";

  try {
    const [recipients, caseData] = await Promise.all([
      getEmailRecipients(caseId, "results"),
      prisma.case.findUnique({
        where: { id: caseId },
        select: {
          caseNumber: true,
          courtCaseNumber: true,
          donor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    if (!caseData) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const testOrder = await prisma.testOrder.findFirst({
      where: { caseId, testStatus: { in: ["results_received", "results_released", "at_mro", "mro_released", "closed"] } },
      orderBy: { updatedAt: "desc" },
    });

    const donorName = caseData.donor
      ? `${caseData.donor.firstName} ${caseData.donor.lastName}`
      : "the donor";
    const lastName = caseData.donor?.lastName ?? donorName;
    const docket = caseData.courtCaseNumber;
    const to = recipients.map((r) => r.email);

    let subject: string;
    let body: string;
    let draftType: string;

    if (mroComplete) {
      // MRO Complete email — after MRO report uploaded, releasing to parties
      const mroDoc = await prisma.document.findFirst({
        where: { caseId, documentType: { in: ["correspondence", "other"] } },
        orderBy: { uploadedAt: "desc" },
        select: { extractedData: true },
      });
      const mroSummary = (mroDoc?.extractedData as { summary?: string } | null)?.summary;

      subject = docket
        ? `${docket} / ${lastName} — MRO Review Complete (${caseData.caseNumber})`
        : `MRO Review Complete — ${lastName} (${caseData.caseNumber})`;

      const lines: string[] = [];
      lines.push("MRO Review Complete");
      lines.push("");
      lines.push(`The Medical Review Officer has completed their review for ${donorName}.`);
      lines.push(`Case No. ${caseData.caseNumber}${testOrder ? ` \u2022 ${testOrder.testDescription}` : ""}`);
      lines.push("");
      if (mroSummary) {
        lines.push(mroSummary);
      } else {
        lines.push("The MRO report is now available. Please contact our office to obtain a copy of the final report.");
      }
      lines.push("");
      lines.push("Questions? Contact our office:");
      lines.push("(847) 258-3966");
      lines.push("2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007");
      body = lines.join("\n");
      draftType = "results_mro_complete";
    } else {
      // Standard results email (with optional MRO-pending notice)
      const latestResult = await prisma.document.findFirst({
        where: { caseId, documentType: "result_report" },
        orderBy: { uploadedAt: "desc" },
        select: { extractedData: true },
      });
      const summary = (latestResult?.extractedData as { summary?: string } | null)?.summary;

      subject = docket
        ? `${docket} / ${lastName} — ${testOrder?.testDescription || "Test"} Results (${caseData.caseNumber})`
        : `Test Results Available — ${lastName} (${caseData.caseNumber})`;

      const lines: string[] = [];
      lines.push(`Results are now available for:`);
      lines.push(`${donorName}`);
      lines.push(`Case No. ${caseData.caseNumber}${testOrder ? ` \u2022 ${testOrder.testDescription}` : ""}`);
      lines.push("");
      if (summary) {
        lines.push(summary);
      } else {
        lines.push("Results are now available. Please contact our office to obtain a copy.");
      }
      if (mroReview) {
        lines.push("");
        lines.push("--- MRO Review Notice ---");
        lines.push("Please note: These results are being forwarded to a Medical Review Officer (MRO) for additional review. If the MRO determines that a valid prescription explains the test result, the final report may differ from the laboratory findings above. You will be notified once the MRO review is complete.");
      }
      lines.push("");
      lines.push("Questions? Contact our office:");
      lines.push("(847) 258-3966");
      lines.push("2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007");
      body = lines.join("\n");
      draftType = mroReview ? "results_mro" : "results";
    }

    const draft = await prisma.emailDraft.create({
      data: {
        caseId,
        testOrderId: testOrder?.id ?? null,
        draftType,
        recipients: to,
        subject,
        body,
        status: "pending",
        createdBy: "admin",
      },
    });

    // Auto-send MRO referral email to Michael with PDFs attached (initial MRO send only)
    if (mroReview && testOrder?.id) {
      try {
        await sendMroReferralEmail(caseId, testOrder.id);
      } catch (e) {
        console.error("MRO referral email failed (non-blocking):", e);
      }
    }

    return NextResponse.json({ draftId: draft.id, to, subject });
  } catch (error) {
    console.error("Create email draft error:", error);
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 });
  }
}
