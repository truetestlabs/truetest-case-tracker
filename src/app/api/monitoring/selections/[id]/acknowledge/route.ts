import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/portalSession";
import { getClientIp } from "@/lib/rateLimit";
import { logPortalEvent } from "@/lib/portalAudit";

/**
 * POST /api/monitoring/selections/[id]/acknowledge
 *
 * PUBLIC — no staff session. Authorization is either:
 *   - a valid portal session cookie whose scheduleId owns this selection, or
 *   - the schedule's PIN submitted in the body (legacy callers).
 *
 * Stamps `acknowledgedAt` (idempotent) and advances pending → notified,
 * matching the /api/checkin intent. Phase 3's notification cron reads
 * acknowledgedAt to stop escalating.
 *
 * Body: { pin?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: selectionId } = await params;
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;

  let body: { pin?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body optional when authenticated via session cookie.
  }
  const pin = String(body?.pin || "").trim();

  const selection = await prisma.randomSelection.findUnique({
    where: { id: selectionId },
    include: { schedule: { select: { id: true, checkInPin: true, active: true } } },
  });

  if (!selection || !selection.schedule.active) {
    return NextResponse.json({ error: "Selection not found" }, { status: 404 });
  }

  // Authorize — session cookie first, PIN fallback.
  const sess = await getPortalSession(request);
  const authBySession = sess?.scheduleId === selection.schedule.id;
  const authByPin = !!pin && pin === selection.schedule.checkInPin;

  if (!authBySession && !authByPin) {
    logPortalEvent({
      scheduleId: selection.schedule.id,
      action: "acknowledge",
      success: false,
      reason: "unauthorized",
      ipAddress: ip,
      userAgent,
      metadata: { selectionId },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const now = new Date();
  const updated = await prisma.randomSelection.update({
    where: { id: selectionId },
    data: {
      acknowledgedAt: selection.acknowledgedAt ?? now,
      status: selection.status === "pending" ? "notified" : selection.status,
      notifiedAt: selection.notifiedAt ?? now,
    },
    select: { id: true, acknowledgedAt: true, status: true, notifiedAt: true },
  });

  logPortalEvent({
    scheduleId: selection.schedule.id,
    action: "acknowledge",
    success: true,
    reason: authBySession ? "session" : "pin",
    ipAddress: ip,
    userAgent,
    metadata: { selectionId },
  });

  return NextResponse.json({ ok: true, selection: updated });
}
