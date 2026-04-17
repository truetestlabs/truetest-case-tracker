import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/** GET /api/calls — list recent AI phone calls for the dashboard. */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const outcome = searchParams.get("outcome");

  const calls = await prisma.callLog.findMany({
    where: outcome ? { outcome } : undefined,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      matchedCase: { select: { id: true, caseNumber: true } },
    },
  });

  return NextResponse.json({ calls });
}
