import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const tests = await prisma.testCatalog.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { clientPrice: "asc" }],
      select: {
        id: true,
        category: true,
        testName: true,
        panelSize: true,
        specimenType: true,
        lab: true,
        labTestCode: true,
        clientPrice: true,
        // labCost intentionally excluded — NEVER sent to frontend
        description: true,
        specialHandling: true,
        isAddOn: true,
      },
    });
    return NextResponse.json(tests);
  } catch (error) {
    console.error("Error fetching test catalog:", error);
    return NextResponse.json([]);
  }
}
