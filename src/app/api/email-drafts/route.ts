import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/email-drafts — list all pending email drafts */
export async function GET() {
  try {
    const drafts = await prisma.emailDraft.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      include: {
        case: { select: { id: true, caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
        testOrder: { select: { testDescription: true } },
      },
    });

    return NextResponse.json({ drafts });
  } catch (error) {
    console.error("List email drafts error:", error);
    return NextResponse.json({ error: "Failed to list drafts" }, { status: 500 });
  }
}
