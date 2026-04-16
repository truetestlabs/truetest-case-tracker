import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSampleCollectedEmail } from "@/lib/email";
import type { TestStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(_request);
  if (auth.response) return auth.response;

  const { id: caseId } = await params;

  try {
    const collectedStatus: TestStatus = "specimen_collected";

    // Find all tests currently in specimen_collected status for this case
    const testOrders = await prisma.testOrder.findMany({
      where: { caseId, testStatus: collectedStatus },
      orderBy: { collectionDate: "desc" },
    });

    if (testOrders.length === 0) {
      return NextResponse.json(
        { error: "No tests in Specimen Collected status" },
        { status: 400 }
      );
    }

    const testOrderIds = testOrders.map((t) => t.id);
    const sentTo = await sendSampleCollectedEmail(caseId, testOrderIds);
    console.log("[Email] collection confirmation manual send to:", sentTo, "tests:", testOrderIds.length);

    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "No recipients found — add contacts with Receives Status checked" },
        { status: 400 }
      );
    }

    // Log a notification entry for each test included in the email
    for (const t of testOrders) {
      await prisma.statusLog.create({
        data: {
          caseId,
          testOrderId: t.id,
          oldStatus: t.testStatus,
          newStatus: t.testStatus,
          changedBy: "admin",
          note: `Collection confirmation email manually sent (${testOrders.length} test${testOrders.length === 1 ? "" : "s"} included)`,
          notificationSent: true,
          notificationRecipients: sentTo,
        },
      });
    }

    return NextResponse.json({ sentTo, testsIncluded: testOrders.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send email";
    console.error("Send collection email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
