import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendResultsReleasedEmail } from "@/lib/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    // Find the most recent released test order
    const testOrder = await prisma.testOrder.findFirst({
      where: { caseId, testStatus: "results_released" },
      orderBy: { updatedAt: "desc" },
    });

    if (!testOrder) {
      return NextResponse.json({ error: "No released test order found" }, { status: 400 });
    }

    const sentTo = await sendResultsReleasedEmail(caseId, testOrder.id);
    console.log("[Email] results manual send to:", sentTo);

    if (sentTo.length === 0) {
      return NextResponse.json({ error: "No recipients found — add contacts with Receives Results checked" }, { status: 400 });
    }

    // Log it
    const log = await prisma.statusLog.create({
      data: {
        caseId,
        testOrderId: testOrder.id,
        oldStatus: "results_released",
        newStatus: "results_released",
        changedBy: "admin",
        note: "Results email manually sent",
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
