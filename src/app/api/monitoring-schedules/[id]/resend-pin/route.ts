import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPinReminderEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";

/**
 * POST /api/monitoring-schedules/[id]/resend-pin   (staff-only)
 *
 * Sends the schedule's PIN to the donor via SMS + email. Lighter than
 * /send-instructions — a short reminder, not the full compliance doc.
 * Used when a client calls the lab saying "I lost my PIN."
 *
 * Body: { channels?: ("sms" | "email")[] } — defaults to both.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { channels?: Array<"sms" | "email"> } = {};
  try {
    body = await request.json();
  } catch {
    // No body OK → use defaults.
  }
  const channels = new Set(body.channels && body.channels.length > 0 ? body.channels : ["sms", "email"]);

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id },
    include: {
      testCatalog: { select: { testName: true } },
      case: {
        select: {
          caseNumber: true,
          donor: { select: { firstName: true, email: true, phone: true } },
        },
      },
    },
  });
  if (!schedule || !schedule.active) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const donor = schedule.case.donor;
  if (!donor) {
    return NextResponse.json(
      { error: "No donor on the case — set a donor contact first" },
      { status: 400 }
    );
  }

  const portalUrl =
    (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://truetest-case-tracker.vercel.app").replace(/\/$/, "") +
    "/portal";

  const result: { sms: { ok: boolean; error?: string } | null; email: { to: string[]; error?: string } | null } = {
    sms: null,
    email: null,
  };

  if (channels.has("sms")) {
    if (!donor.phone) {
      result.sms = { ok: false, error: "no_phone_on_file" };
    } else {
      const firstName = donor.firstName;
      const body =
        `TrueTest Labs: Hi ${firstName}, your PIN is ${schedule.checkInPin}. ` +
        `Sign in at ${portalUrl} to check today's status. Keep this PIN private.`;
      const r = await sendSms(donor.phone, body);
      result.sms = { ok: r.ok, error: r.error };
    }
  }

  if (channels.has("email")) {
    if (!donor.email) {
      result.email = { to: [], error: "no_email_on_file" };
    } else {
      try {
        const to = await sendPinReminderEmail(id);
        result.email = { to };
      } catch (e) {
        result.email = {
          to: [],
          error: e instanceof Error ? e.message : "send_failed",
        };
      }
    }
  }

  // StatusLog row so staff see the action in the case history.
  await prisma.statusLog.create({
    data: {
      caseId: schedule.caseId,
      oldStatus: "—",
      newStatus: "—",
      changedBy: "staff",
      note: `PIN reminder sent (${[
        result.sms?.ok ? "SMS" : null,
        result.email && result.email.to.length > 0 ? "Email" : null,
      ]
        .filter(Boolean)
        .join(" + ") || "no channels succeeded"})`,
      notificationSent: !!(result.sms?.ok || (result.email && result.email.to.length > 0)),
      notificationRecipients: [
        ...(result.sms?.ok && donor.phone ? [donor.phone] : []),
        ...(result.email?.to || []),
      ],
    },
  });

  return NextResponse.json({ ok: true, result });
}
