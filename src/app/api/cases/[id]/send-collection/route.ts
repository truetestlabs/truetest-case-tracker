import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSampleCollectedEmail } from "@/lib/email";
import type { TestStatus } from "@prisma/client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    const collectedStatuses: TestStatus[] = [
      "specimen_collected",
      "specimen_held",
      "sent_to_lab",
      "results_received",
      "results_released",
      "closed",
    ];

    const testOrder = await prisma.testOrder.findFirst({
      where: { caseId, testStatus: { in: collectedStatuses } },
      orderBy: { updatedAt: "desc" },
    });

    if (!testOrder) {
      return NextResponse.json({ error: "No collected test order found" }, { status: 400 });
    }

    const sentTo = await sendSampleCollectedEmail(caseId, testOrder.id);
    console.log("[Email] collection confirmation manual send to:", sentTo);

    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "No recipients found — add contacts with Receives Status checked" },
        { status: 400 }
      );
    }

    await prisma.statusLog.create({
      data: {
        caseId,
        testOrderId: testOrder.id,
        oldStatus: testOrder.testStatus,
        newStatus: testOrder.testStatus,
        changedBy: "admin",
        note: "Specimen collection confirmation email manually sent",
        notificationSent: true,
        notificationRecipients: sentTo,
      },
    });

    return NextResponse.json({ sentTo });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send email";
    console.error("Send collection email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
