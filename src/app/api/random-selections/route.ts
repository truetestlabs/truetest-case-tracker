import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/random-selections?date=YYYY-MM-DD  → selections on that specific date
 * GET /api/random-selections?month=YYYY-MM    → selections in that month
 * GET /api/random-selections?caseId=xxx        → all selections for a case
 * GET /api/random-selections?status=pending    → filter by status
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const month = searchParams.get("month");
  const caseId = searchParams.get("caseId");
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};

  if (date) {
    const [y, m, d] = date.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));
    const end = new Date(Date.UTC(y, m - 1, d + 1));
    where.selectedDate = { gte: start, lt: end };
  } else if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    where.selectedDate = { gte: start, lt: end };
  }

  if (status) where.status = status;

  if (caseId) {
    where.schedule = { caseId };
  }

  const selections = await prisma.randomSelection.findMany({
    where,
    orderBy: { selectedDate: "asc" },
    include: {
      schedule: {
        select: {
          id: true,
          caseId: true,
          collectionType: true,
          case: {
            select: {
              id: true,
              caseNumber: true,
              donor: { select: { firstName: true, lastName: true } },
            },
          },
          testCatalog: { select: { testName: true, specimenType: true } },
        },
      },
    },
  });

  return NextResponse.json(selections);
}
