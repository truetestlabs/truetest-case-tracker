import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

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
  const auth = await requireAuth(_request);
  if (auth.response) return auth.response;

  const { id } = await params;

  try {
    // Cancel all future pending selections
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.randomSelection.updateMany({
      where: {
        scheduleId: id,
        selectedDate: { gte: today },
        status: "pending",
      },
      data: { status: "cancelled" },
    });

    // Mark schedule as inactive (preserve history)
    await prisma.monitoringSchedule.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error cancelling schedule:", error);
    return NextResponse.json({ error: "Failed to cancel schedule" }, { status: 500 });
  }
}
