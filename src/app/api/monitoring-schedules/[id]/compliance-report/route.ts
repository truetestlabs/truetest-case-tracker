import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildComplianceReport, reportToCSV } from "@/lib/compliance";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  // Default date range: schedule.startDate → today
  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id },
    select: { startDate: true },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const from = fromParam ? new Date(fromParam + "T00:00:00Z") : schedule.startDate;
  const to = toParam ? new Date(toParam + "T00:00:00Z") : new Date();

  try {
    const report = await buildComplianceReport(id, from, to);
    if (!report) {
      return NextResponse.json({ error: "Could not build report" }, { status: 404 });
    }

    if (format === "csv") {
      const csv = reportToCSV(report);
      const filename = `compliance-${report.schedule.caseNumber}-${report.period.from}-to-${report.period.to}.csv`;
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("Error building compliance report:", error);
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 });
  }
}
