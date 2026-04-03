import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const logs = await prisma.statusLog.findMany({
    where: { caseId, notificationSent: true },
    orderBy: { changedAt: "desc" },
    select: {
      id: true,
      newStatus: true,
      changedAt: true,
      notificationRecipients: true,
      note: true,
      testOrder: {
        select: { testDescription: true },
      },
    },
  });

  return NextResponse.json(logs);
}
