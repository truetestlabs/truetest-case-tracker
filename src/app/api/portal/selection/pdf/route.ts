import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/portalSession";
import { createSignedUrl } from "@/lib/storage";
import { isUnlockedForSelection } from "@/lib/dateChicago";
import { logPortalEvent } from "@/lib/portalAudit";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * GET /api/portal/selection/pdf
 *
 * Donor-side endpoint that returns a short-lived signed URL for today's
 * order PDF. Gated at 4:00 AM America/Chicago on the selection day — we
 * refuse to sign anything before then, regardless of what the client UI
 * thinks. Signed URL is NOT baked into /api/portal/session because its
 * 10-min TTL would expire while the portal sits open; we re-sign on
 * every tap so the download link is always fresh and we get a per-tap
 * audit row.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;

  const gate = rateLimit(`portal-pdf:${ip}`, 30, 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const sess = await getPortalSession(request);
  if (!sess) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const selection = await prisma.randomSelection.findFirst({
    where: {
      scheduleId: sess.scheduleId,
      selectedDate: { gte: today, lt: tomorrow },
      status: { in: ["pending", "notified", "completed"] },
    },
    include: {
      documents: {
        where: { documentType: "monitoring_order" },
        orderBy: { uploadedAt: "desc" },
        take: 1,
        select: { fileName: true, filePath: true },
      },
    },
  });

  const doc = selection?.documents[0];
  if (!selection || !doc) {
    logPortalEvent({
      scheduleId: sess.scheduleId,
      action: "pdf_fetch",
      success: false,
      reason: "no_document",
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json({ error: "No order document attached" }, { status: 404 });
  }

  if (!isUnlockedForSelection(selection.selectedDate)) {
    logPortalEvent({
      scheduleId: sess.scheduleId,
      action: "pdf_fetch",
      success: false,
      reason: "locked",
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      { error: "Order unlocks at 4:00 AM CT on the selection day" },
      { status: 403 }
    );
  }

  let url: string;
  try {
    url = await createSignedUrl(doc.filePath, 600);
  } catch (err) {
    console.error("[portal/selection/pdf] sign failed:", err);
    logPortalEvent({
      scheduleId: sess.scheduleId,
      action: "pdf_fetch",
      success: false,
      reason: "sign_failed",
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json({ error: "Could not generate download link" }, { status: 500 });
  }

  logPortalEvent({
    scheduleId: sess.scheduleId,
    action: "pdf_fetch",
    success: true,
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({ url, fileName: doc.fileName });
}
