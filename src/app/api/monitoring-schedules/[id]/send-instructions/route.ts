import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendDonorInstructionsEmail } from "@/lib/email";
import { requireAuth } from "@/lib/auth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(_request);
  if (auth.response) return auth.response;

  const { id } = await params;

  try {
    const sentTo = await sendDonorInstructionsEmail(id);

    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "No donor email on file for this case — add one to the donor contact first" },
        { status: 400 }
      );
    }

    // Log it
    const schedule = await prisma.monitoringSchedule.findUnique({
      where: { id },
      select: { caseId: true },
    });
    if (schedule) {
      await prisma.statusLog.create({
        data: {
          caseId: schedule.caseId,
          oldStatus: "—",
          newStatus: "—",
          changedBy: "admin",
          note: "Random testing compliance instructions emailed to donor",
          notificationSent: true,
          notificationRecipients: sentTo,
        },
      });
    }

    return NextResponse.json({ sentTo });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send instructions";
    console.error("Send donor instructions error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
