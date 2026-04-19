import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/monitoring/selections/[id]/acknowledge
 *
 * PUBLIC — no session. Authorization is PIN-based: the caller must present
 * the schedule's check-in PIN in the body, and it must match the schedule
 * that owns this selection. Stamps `acknowledgedAt` so Phase 3's
 * notification cron stops escalating.
 *
 * Also advances a pending selection to "notified" (matching the intent of
 * "donor knows"), mirroring the existing /api/checkin behavior.
 *
 * Body: { pin: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: selectionId } = await params;

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = String(body.pin || "").trim();
  if (!pin) {
    return NextResponse.json({ error: "PIN required" }, { status: 400 });
  }

  const selection = await prisma.randomSelection.findUnique({
    where: { id: selectionId },
    include: { schedule: { select: { checkInPin: true, active: true } } },
  });

  if (!selection || !selection.schedule.active) {
    return NextResponse.json({ error: "Selection not found" }, { status: 404 });
  }
  if (selection.schedule.checkInPin !== pin) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 403 });
  }

  // Idempotent: don't clobber an existing acknowledgedAt.
  const now = new Date();
  const updated = await prisma.randomSelection.update({
    where: { id: selectionId },
    data: {
      acknowledgedAt: selection.acknowledgedAt ?? now,
      // Advance pending → notified on first ack (matches /api/checkin intent).
      status: selection.status === "pending" ? "notified" : selection.status,
      notifiedAt: selection.notifiedAt ?? now,
    },
    select: { id: true, acknowledgedAt: true, status: true, notifiedAt: true },
  });

  return NextResponse.json({ ok: true, selection: updated });
}
