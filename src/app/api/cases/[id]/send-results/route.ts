import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendResultsReleasedEmail } from "@/lib/email";
import { requireAuth } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const mroReview = searchParams.get("mro") === "true";

  try {
    // Find the most recent released or at_mro test order
    const testOrder = await prisma.testOrder.findFirst({
      where: { caseId, testStatus: { in: ["results_released", "at_mro"] } },
      orderBy: { updatedAt: "desc" },
    });

    if (!testOrder) {
      return NextResponse.json({ error: "No released test order found" }, { status: 400 });
    }

    const sentTo = await sendResultsReleasedEmail(caseId, testOrder.id, { mroReview });
    console.log("[Email] results manual send to:", sentTo, mroReview ? "(MRO)" : "");

    if (sentTo.length === 0) {
      return NextResponse.json({ error: "No recipients found — add contacts with Receives Results checked" }, { status: 400 });
    }

    // Log it
    const log = await prisma.statusLog.create({
      data: {
        caseId,
        testOrderId: testOrder.id,
        oldStatus: testOrder.testStatus,
        newStatus: testOrder.testStatus,
        changedBy: "admin",
        note: mroReview ? "Results email sent (with MRO review notice)" : "Results email manually sent",
        notificationSent: true,
        notificationRecipients: sentTo,
      },
    });

    return NextResponse.json({ sentTo, logId: log.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send email";
    console.error("Send results email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
