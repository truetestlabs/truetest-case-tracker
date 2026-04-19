import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSignedUrl } from "@/lib/storage";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * POST /api/portal/login  (PUBLIC — no session)
 *
 * Donor-facing portal login. Given a 6-digit PIN, returns:
 *   - donor name
 *   - whether they're selected today
 *   - today's selection id + acknowledgment state
 *   - a short-lived signed URL for the attached order PDF (if any)
 *
 * Rate-limited: 10 attempts / minute / IP. PIN brute-force on a 6-digit
 * space is cheap without this brake.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const gate = rateLimit(`portal-login:${ip}`, 10, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = String(body.pin || "").trim();
  if (!pin || pin.length < 4) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
  }

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { checkInPin: pin },
    include: {
      case: { select: { donor: { select: { firstName: true, lastName: true } } } },
      testCatalog: { select: { testName: true } },
    },
  });

  if (!schedule || !schedule.active) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 404 });
  }

  // Today in UTC (matches how selections are stored).
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const selection = await prisma.randomSelection.findFirst({
    where: {
      scheduleId: schedule.id,
      selectedDate: { gte: today, lt: tomorrow },
      status: { in: ["pending", "notified", "completed"] },
    },
    include: {
      documents: {
        where: { documentType: "monitoring_order" },
        orderBy: { uploadedAt: "desc" },
        take: 1,
        select: { id: true, fileName: true, filePath: true },
      },
    },
  });

  // Log the check-in (audit trail — same table as /api/checkin).
  const userAgent = request.headers.get("user-agent") || null;
  await prisma.checkIn.create({
    data: {
      scheduleId: schedule.id,
      wasSelected: !!selection,
      selectionId: selection?.id || null,
      ipAddress: ip === "unknown" ? null : ip,
      userAgent,
    },
  });

  const donorName = schedule.case.donor
    ? `${schedule.case.donor.firstName} ${schedule.case.donor.lastName}`
    : "Donor";

  // Build signed URL for the attached order PDF, if present.
  let orderPdfUrl: string | null = null;
  const doc = selection?.documents[0];
  if (doc) {
    try {
      orderPdfUrl = await createSignedUrl(doc.filePath, 600); // 10 min
    } catch (err) {
      console.error("[portal/login] sign failed for", doc.filePath, err);
      // Non-fatal — show the page without the PDF rather than 500.
    }
  }

  return NextResponse.json({
    donorName,
    testName: schedule.testCatalog.testName,
    selected: !!selection,
    selection: selection
      ? {
          id: selection.id,
          status: selection.status,
          acknowledgedAt: selection.acknowledgedAt,
          orderPdf: doc && orderPdfUrl
            ? { fileName: doc.fileName, url: orderPdfUrl }
            : null,
        }
      : null,
  });
}
