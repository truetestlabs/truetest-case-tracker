import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendResultsHeldEmail } from "@/lib/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    // Find tests at results_received that are unpaid
    const testOrders = await prisma.testOrder.findMany({
      where: {
        caseId,
        testStatus: { in: ["results_received", "results_held"] },
        paymentMethod: null,
      },
    });

    if (testOrders.length === 0) {
      return NextResponse.json(
        { error: "No unpaid tests with results received or held" },
        { status: 400 }
      );
    }

    const sentTo = await sendResultsHeldEmail(caseId, testOrders.map((t) => t.id));

    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "No recipients found — add contacts with Receives Status checked" },
        { status: 400 }
      );
    }

    for (const t of testOrders) {
      await prisma.statusLog.create({
        data: {
          caseId,
          testOrderId: t.id,
          oldStatus: t.testStatus,
          newStatus: t.testStatus,
          changedBy: "admin",
          note: "Results held — payment required notification sent",
          notificationSent: true,
          notificationRecipients: sentTo,
        },
      });
    }

    return NextResponse.json({ sentTo, testsIncluded: testOrders.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send email";
    console.error("Send results-held email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
