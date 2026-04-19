import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSelections, generateCheckInPin, type PatternType } from "@/lib/randomSchedule";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const schedules = await prisma.monitoringSchedule.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: {
      testCatalog: { select: { testName: true, specimenType: true } },
      selections: {
        orderBy: { selectedDate: "asc" },
        include: {
          testOrder: { select: { id: true, testStatus: true } },
          documents: {
            where: { documentType: "monitoring_order" },
            select: { id: true, fileName: true },
            orderBy: { uploadedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  return NextResponse.json(schedules);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const body = await request.json();

  try {
    // Validate required fields
    if (!body.testCatalogId || !body.patternType || !body.targetCount || !body.startDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const patternType = body.patternType as PatternType;
    if (!["range_count", "per_month", "per_week", "every_n_days"].includes(patternType)) {
      return NextResponse.json({ error: "Invalid patternType" }, { status: 400 });
    }

    // Generate a unique PIN (retry if collision)
    let pin = generateCheckInPin();
    for (let i = 0; i < 5; i++) {
      const existing = await prisma.monitoringSchedule.findUnique({ where: { checkInPin: pin } });
      if (!existing) break;
      pin = generateCheckInPin();
    }

    const startDate = new Date(body.startDate);
    const endDate = body.endDate ? new Date(body.endDate) : null;

    // Determine the generation horizon: end date, or 60 days out for ongoing
    const horizonEnd = endDate ?? new Date(startDate.getTime() + 60 * 24 * 60 * 60 * 1000);

    // Create the schedule
    const schedule = await prisma.monitoringSchedule.create({
      data: {
        caseId,
        testCatalogId: body.testCatalogId,
        collectionType: body.collectionType || "unobserved",
        checkInPin: pin,
        patternType,
        targetCount: body.targetCount,
        minSpacingDays: body.minSpacingDays ?? null,
        allowedDays: body.allowedDays ?? [1, 2, 3, 4, 5],
        startDate,
        endDate,
        autoRescheduleOnMiss: body.autoRescheduleOnMiss ?? true,
        autoRescheduleDays: body.autoRescheduleDays ?? 1,
        lastGeneratedThrough: horizonEnd,
        createdBy: "admin",
      },
    });

    // Generate selections
    const result = generateSelections({
      patternType,
      targetCount: body.targetCount,
      minSpacingDays: body.minSpacingDays,
      fromDate: startDate,
      toDate: horizonEnd,
      allowedDays: body.allowedDays ?? [1, 2, 3, 4, 5],
    });

    // Create RandomSelection rows
    if (result.dates.length > 0) {
      await prisma.randomSelection.createMany({
        data: result.dates.map((d) => ({
          scheduleId: schedule.id,
          selectedDate: d,
          status: "pending",
        })),
      });
    }

    return NextResponse.json({
      schedule,
      selectionsGenerated: result.dates.length,
      warning: result.warning,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating monitoring schedule:", error);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
