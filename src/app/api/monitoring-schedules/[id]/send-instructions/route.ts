import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendDonorInstructionsEmail } from "@/lib/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const sentTo = await sendDonorInstructionsEmail(id);

    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "No donor email on file for this case — add one to the donor contact first" },
        { status: 400 }
      );
    }

    // Stamp the schedule so the card UI can disable this button going
    // forward (and enable "Resend PIN"). Stamp on every successful send —
    // the UI gate prevents second clicks in practice, and treating this as
    // "last sent" vs "first sent" collapses to the same truthy check.
    const schedule = await prisma.monitoringSchedule.update({
      where: { id },
      data: { instructionsSentAt: new Date() },
      select: { caseId: true },
    });
    if (schedule?.caseId) {
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
