import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/** GET /api/audit-log — list recent audit entries */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);

  try {
    const entries = await prisma.auditLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { email: true, name: true } },
      },
    });
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Audit log error:", error);
    return NextResponse.json({ entries: [] });
  }
}
