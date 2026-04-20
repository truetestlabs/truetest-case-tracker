import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chicagoTodayAsUtcMidnight } from "@/lib/dateChicago";

/**
 * POST /api/checkin  (PUBLIC — no auth required)
 * Body: { pin: string }
 *
 * Donor enters their schedule PIN and the system tells them whether they're
 * selected today. Every call is logged to the CheckIn table.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
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

  // "Today" is the donor's America/Chicago calendar day. selectedDate is
  // stored as UTC-midnight of that Chicago day; using a UTC clock here
  // would skip the current-day selection from ~7 PM CT to midnight CT
  // each night.
  const today = chicagoTodayAsUtcMidnight();
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
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
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
