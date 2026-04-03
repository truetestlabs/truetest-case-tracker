import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const firstName = searchParams.get("firstName")?.trim();
  const lastName = searchParams.get("lastName")?.trim();

  if (!firstName || !lastName) {
    return NextResponse.json({ cases: [] });
  }

  try {
    // Search for ALL cases (active + closed) with a matching donor name (case-insensitive)
    const cases = await prisma.case.findMany({
      where: {
        donor: {
          firstName: { equals: firstName, mode: "insensitive" },
          lastName: { equals: lastName, mode: "insensitive" },
        },
      },
      select: {
        id: true,
        caseNumber: true,
        caseStatus: true,
        caseType: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ cases });
  } catch (error) {
    console.error("Error checking duplicates:", error);
    return NextResponse.json({ cases: [] });
  }
}
