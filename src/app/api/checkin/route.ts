import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * POST /api/checkin  (PUBLIC — no auth required)
 * Body: { pin: string }
 *
 * Donor enters their schedule PIN and the system tells them whether they're
 * selected today. Every call is logged to the CheckIn table.
 *
 * Brute-force defense: 10 req/min/IP handler-level rate limit. With 6-digit
 * PINs (1M combos), a single IP can explore at most 10/min = ~69 days to
 * exhaust the space. The middleware also applies a broader 60/min/IP cap.
 * Per-schedule lockout isn't useful here because a wrong PIN returns null
 * (no schedule to lock against).
 */
export async function POST(request: NextRequest) {
  // ── 1. Handler-level rate limit (10/min/IP) ──
  const ip = getClientIp(request.headers);
  const rl = rateLimit(`checkin:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const pin = String(body.pin || "").trim();
  if (!pin || pin.length < 4) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
  }

  // Lookup schedule by PIN
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

  // Today in UTC (matches how selections are stored)
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // Find a selection for today
  const selection = await prisma.randomSelection.findFirst({
    where: {
      scheduleId: schedule.id,
      selectedDate: { gte: today, lt: tomorrow },
      status: { in: ["pending", "notified"] },
    },
  });

  const wasSelected = !!selection;

  // If pending, advance to notified
  if (selection && selection.status === "pending") {
    await prisma.randomSelection.update({
      where: { id: selection.id },
      data: { status: "notified", notifiedAt: new Date() },
    });
  }

  // Log the check-in (audit trail)
  const ipAddress = ip !== "unknown" ? ip : null;
  const userAgent = request.headers.get("user-agent") || null;
  await prisma.checkIn.create({
    data: {
      scheduleId: schedule.id,
      wasSelected,
      selectionId: selection?.id || null,
      ipAddress,
      userAgent,
    },
  });

  const donorName = schedule.case.donor
    ? `${schedule.case.donor.firstName} ${schedule.case.donor.lastName}`
    : "Donor";

  return NextResponse.json({
    selected: wasSelected,
    donorName,
    testDescription: wasSelected ? schedule.testCatalog.testName : undefined,
    message: wasSelected
      ? "You are selected for a drug test today. Report to TrueTest Labs by 5:00 PM."
      : "No test scheduled for you today. Check back tomorrow.",
  });
}
