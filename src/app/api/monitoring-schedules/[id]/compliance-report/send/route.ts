import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendComplianceReportEmail } from "@/lib/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { from?: string; to?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is allowed — falls back to schedule defaults below.
  }

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id },
    select: { startDate: true },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const from = body.from ? new Date(body.from + "T00:00:00Z") : schedule.startDate;
  const to = body.to ? new Date(body.to + "T00:00:00Z") : new Date();

  try {
    const sentTo = await sendComplianceReportEmail(id, from, to);
    if (sentTo.length === 0) {
      return NextResponse.json(
        { error: "Email is not configured (missing RESEND_API_KEY)." },
        { status: 503 }
      );
    }
    return NextResponse.json({ sentTo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send compliance report.";
    console.error("[compliance-report:send] error:", err);
    const status = message.toLowerCase().includes("no recipients") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
