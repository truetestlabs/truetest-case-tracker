import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendBookingConfirmationEmail } from "@/lib/email";

/**
 * POST /api/appointments/email
 * Body: { appointmentId: string }
 *
 * Loads the appointment + linked donor, then sends a booking confirmation
 * email via Resend. Isolated as fire-and-forget from the phone-intake page —
 * if it fails, the booking is unaffected.
 */
export async function POST(request: NextRequest) {
  try {
    const { appointmentId } = await request.json();
    if (!appointmentId) {
      return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
    }

    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        donor: { select: { firstName: true, email: true } },
        case: {
          include: {
            donor: { select: { firstName: true, email: true } },
          },
        },
      },
    });

    if (!appt) {
      return NextResponse.json({ error: "appointment not found" }, { status: 404 });
    }

    // Prefer the directly-linked donor, fall back to case.donor
    const donor = appt.donor ?? appt.case?.donor ?? null;
    if (!donor?.email || !donor?.firstName) {
      return NextResponse.json({ ok: false, error: "no_email_on_donor" });
    }

    await sendBookingConfirmationEmail({
      toEmail: donor.email,
      firstName: donor.firstName,
      startTime: appt.startTime,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[appointments/email] error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
