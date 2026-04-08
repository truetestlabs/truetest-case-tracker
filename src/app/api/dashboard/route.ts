import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [totalCases, openCases, closedCases, totalTestOrders, awaitingPayment] = await Promise.all([
      prisma.case.count(),
      prisma.case.count({ where: { caseStatus: { not: "closed" } } }),
      prisma.case.count({ where: { caseStatus: "closed" } }),
      prisma.testOrder.count(),
      prisma.testOrder.count({ where: { paymentMethod: null, testStatus: { notIn: ["closed", "cancelled"] } } }),
    ]);

    const noShowsThisMonth = await prisma.testOrder.count({
      where: {
        testStatus: "no_show",
        updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    });

    const recentCases = await prisma.case.findMany({
      where: { caseStatus: { not: "closed" } },
      take: 10,
      orderBy: { updatedAt: "desc" },
      include: {
        donor: true,
        testOrders: { select: { paymentMethod: true }, take: 1, orderBy: { updatedAt: "desc" } },
        _count: { select: { testOrders: true } },
      },
    });

    return NextResponse.json({
      totalCases,
      activeCases: openCases,
      closedCases,
      totalTestOrders,
      awaitingPayment,
      specimensHeld: 0,
      awaitingRelease: 0,
      noShowsThisMonth,
      recentCases,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({
      totalCases: 0, activeCases: 0, closedCases: 0, totalTestOrders: 0,
      awaitingPayment: 0, specimensHeld: 0, awaitingRelease: 0, noShowsThisMonth: 0,
      recentCases: [],
    });
  }
}
