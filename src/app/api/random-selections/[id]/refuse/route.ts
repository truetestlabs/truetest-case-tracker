import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextWeekday } from "@/lib/randomSchedule";
import { sendRefusalToTestEmail } from "@/lib/email";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/random-selections/[id]/refuse
 * Body: { autoReschedule: boolean }
 *
 * Marks a selection as refused. If autoReschedule=true, creates a replacement
 * selection for the next business day (respecting schedule's autoRescheduleDays).
 * Sends a "Refusal to Test" email including the replacement date if any.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await request.json();
  const autoReschedule = !!body.autoReschedule;

  try {
    const selection = await prisma.randomSelection.findUnique({
      where: { id },
      include: { schedule: { select: { caseId: true, autoRescheduleDays: true, active: true } } },
    });

    if (!selection) {
      return NextResponse.json({ error: "Selection not found" }, { status: 404 });
    }
    if (selection.status === "refused") {
      return NextResponse.json({ error: "Already marked as refused" }, { status: 400 });
    }

    // Mark original as refused
    await prisma.randomSelection.update({
      where: { id },
      data: { status: "refused" },
    });

    // Create replacement selection if requested
    let replacementDate: Date | null = null;
    let replacementId: string | null = null;
    if (autoReschedule && selection.schedule.active) {
      replacementDate = nextWeekday(selection.selectedDate, selection.schedule.autoRescheduleDays);
      const replacement = await prisma.randomSelection.create({
        data: {
          scheduleId: selection.scheduleId,
          selectedDate: replacementDate,
          status: "pending",
          replacesSelectionId: selection.id,
        },
      });
      replacementId = replacement.id;
    }

    // Send refusal email
    let sentTo: string[] = [];
    try {
      sentTo = await sendRefusalToTestEmail(
        selection.schedule.caseId,
        selection.id,
        replacementDate
      );
    } catch (e) {
      console.error("[Email] refusal send error:", e);
    }

    // Log it
    await prisma.statusLog.create({
      data: {
        caseId: selection.schedule.caseId,
        oldStatus: "pending",
        newStatus: "refused",
        changedBy: "admin",
        note: autoReschedule && replacementDate
          ? `Refusal to test — auto-rescheduled for ${replacementDate.toISOString().slice(0, 10)}`
          : "Refusal to test — no replacement scheduled",
        notificationSent: sentTo.length > 0,
        notificationRecipients: sentTo,
      },
    });

    return NextResponse.json({
      refused: true,
      replacementId,
      replacementDate,
      sentTo,
    });
  } catch (error) {
    console.error("Error marking refusal:", error);
    return NextResponse.json({ error: "Failed to mark refusal" }, { status: 500 });
  }
}
