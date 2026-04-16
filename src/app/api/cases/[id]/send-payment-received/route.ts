import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPaymentReceivedEmail } from "@/lib/email";
import type { TestStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/cases/[id]/send-payment-received
 *
 * Finds tests at specimen_collected/specimen_held that are now paid,
 * sends "payment received, sample sent to lab" email, and advances
 * those tests to sent_to_lab.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(_request);
  if (auth.response) return auth.response;

  const { id: caseId } = await params;

  try {
    // Find collected tests that are paid
    const collectedStatuses: TestStatus[] = ["specimen_collected", "specimen_held"];
    const testOrders = await prisma.testOrder.findMany({
      where: {
        caseId,
        testStatus: { in: collectedStatuses },
        paymentMethod: { not: null },
      },
    });

    if (testOrders.length === 0) {
      return NextResponse.json(
        { error: "No paid collected tests found" },
        { status: 400 }
      );
    }

    // Send email
    const sentTo = await sendPaymentReceivedEmail(caseId, testOrders.map((t) => t.id));

    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "No recipients found — add contacts with Receives Status checked" },
        { status: 400 }
      );
    }

    // Advance tests to sent_to_lab
    for (const t of testOrders) {
      await prisma.testOrder.update({
        where: { id: t.id },
        data: {
          testStatus: "sent_to_lab",
          sentToLabDate: new Date(),
        },
      });
      await prisma.statusLog.create({
        data: {
          caseId,
          testOrderId: t.id,
          oldStatus: t.testStatus,
          newStatus: "sent_to_lab",
          changedBy: "admin",
          note: "Payment received — sample sent to lab, notification sent",
          notificationSent: true,
          notificationRecipients: sentTo,
        },
      });
    }

    return NextResponse.json({ sentTo, testsAdvanced: testOrders.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send email";
    console.error("Send payment-received email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
