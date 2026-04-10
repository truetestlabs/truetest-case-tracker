import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/kiosk/intakes — list intake drafts for staff review */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  try {
    const drafts = await prisma.intakeDraft.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const pendingCount = await prisma.intakeDraft.count({ where: { status: "pending_review" } });

    return NextResponse.json({ drafts, pendingCount });
  } catch (error) {
    console.error("List intakes error:", error);
    return NextResponse.json({ drafts: [], pendingCount: 0 });
  }
}
