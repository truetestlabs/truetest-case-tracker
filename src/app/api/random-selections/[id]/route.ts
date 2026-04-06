import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/random-selections/[id]
 * Update a selection's status (notified, completed, cancelled).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const data: Record<string, unknown> = {};

    if (body.status) {
      data.status = body.status;
      if (body.status === "notified" && body.notifiedAt !== null) {
        data.notifiedAt = new Date();
      }
      if (body.status === "completed") {
        data.completedAt = new Date();
      }
    }

    if (body.testOrderId !== undefined) data.testOrderId = body.testOrderId;

    // Allow rescheduling to a new date
    if (body.selectedDate) {
      data.selectedDate = new Date(body.selectedDate);
    }

    const updated = await prisma.randomSelection.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating selection:", error);
    return NextResponse.json({ error: "Failed to update selection" }, { status: 500 });
  }
}
