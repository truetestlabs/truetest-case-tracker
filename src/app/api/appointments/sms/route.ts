import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSms, formatAppointmentConfirmation } from "@/lib/sms";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/appointments/sms
 * Body: { appointmentId: string }
 *
 * Loads the appointment + linked donor, formats the confirmation text,
 * and hands it to Twilio. Isolated in its own route so the SMS call is
 * fire-and-forget from the phone-intake page — if it fails, the booking
 * is unaffected.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  try {
    const { appointmentId } = await request.json();
    if (!appointmentId) {
      return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
    }

    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        donor: { select: { firstName: true, phone: true } },
        case: {
          include: {
            donor: { select: { firstName: true, phone: true } },
          },
        },
      },
    });

    if (!appt) {
      return NextResponse.json({ error: "appointment not found" }, { status: 404 });
    }

    // Prefer the directly-linked donor, fall back to case.donor
    const donor = appt.donor ?? appt.case?.donor ?? null;
    if (!donor?.phone || !donor?.firstName) {
      return NextResponse.json({ ok: false, error: "no_phone_on_donor" });
    }

    const body = formatAppointmentConfirmation(donor.firstName, appt.startTime);
    const result = await sendSms(donor.phone, body);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[appointments/sms] error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
