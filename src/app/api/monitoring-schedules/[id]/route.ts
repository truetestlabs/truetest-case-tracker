import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chicagoTodayAsUtcMidnight } from "@/lib/dateChicago";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const data: Record<string, unknown> = {};
    const allowed = ["active", "endDate", "autoRescheduleOnMiss", "autoRescheduleDays"];
    for (const field of allowed) {
      if (body[field] !== undefined) {
        data[field] = field === "endDate" && body[field] ? new Date(body[field]) : body[field];
      }
    }

    const updated = await prisma.monitoringSchedule.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating schedule:", error);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Cancel all future pending selections. "Today" is the staff member's
    // Chicago calendar day so a cancellation done in the evening (after
    // UTC midnight) still cancels the current Chicago day's selection
    // instead of starting from tomorrow.
    const today = chicagoTodayAsUtcMidnight();
    await prisma.randomSelection.updateMany({
      where: {
        scheduleId: id,
        selectedDate: { gte: today },
        status: "pending",
      },
      data: { status: "cancelled" },
    });

    // Mark schedule as inactive + stamp endDate so the UI can distinguish
    // "Cancelled" from "Paused" (both previously just set active=false,
    // which made cancel look like a no-op on an already-paused schedule).
    // Leave endDate alone if it was already set to a past date (the
    // schedule already ended naturally).
    const existing = await prisma.monitoringSchedule.findUnique({
      where: { id },
      select: { endDate: true },
    });
    const now = new Date();
    const shouldStampEnd = !existing?.endDate || existing.endDate.getTime() > now.getTime();
    await prisma.monitoringSchedule.update({
      where: { id },
      data: { active: false, ...(shouldStampEnd ? { endDate: now } : {}) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error cancelling schedule:", error);
    return NextResponse.json({ error: "Failed to cancel schedule" }, { status: 500 });
  }
}
