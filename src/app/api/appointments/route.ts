import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BUSINESS_HOURS, isSlotFree } from "@/lib/appointments";
import { createCalendarEvent } from "@/lib/gcal";

/**
 * GET /api/appointments?from=ISO&to=ISO — list appointments in a range
 * (used by a future calendar view; phone-intake doesn't currently call this)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        ...(from && to
          ? { startTime: { gte: new Date(from), lt: new Date(to) } }
          : {}),
        status: { in: ["booked", "completed"] },
      },
      include: {
        case: { select: { id: true, caseNumber: true } },
        donor: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
      orderBy: { startTime: "asc" },
      take: 500,
    });
    return NextResponse.json({ appointments });
  } catch (error) {
    console.error("[appointments] GET error:", error);
    return NextResponse.json({ error: "failed to list appointments" }, { status: 500 });
  }
}

/**
 * POST /api/appointments
 * Body: { startTime: ISO, caseId?, donorId?, notes?, createdBy? }
 *
 * Validates the slot is still free (race protection), then creates the
 * appointment. Returns 409 if a competing booking beat this one.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.startTime) {
      return NextResponse.json({ error: "startTime required" }, { status: 400 });
    }
    const start = new Date(body.startTime);
    if (isNaN(start.getTime())) {
      return NextResponse.json({ error: "invalid startTime" }, { status: 400 });
    }
    const end = new Date(start.getTime() + BUSINESS_HOURS.slotMinutes * 60 * 1000);

    // Race check: someone else may have booked this slot between when
    // the staff member saw it and when they clicked Book it.
    const free = await isSlotFree(start);
    if (!free) {
      return NextResponse.json(
        { error: "Slot no longer available — please pick a different time" },
        { status: 409 }
      );
    }

    const appointment = await prisma.appointment.create({
      data: {
        startTime: start,
        endTime: end,
        caseId: body.caseId || null,
        donorId: body.donorId || null,
        notes: body.notes || null,
        createdBy: body.createdBy || "dashboard",
      },
      include: {
        donor: { select: { firstName: true, lastName: true, email: true, phone: true } },
        case: {
          select: {
            caseNumber: true,
            donor: { select: { firstName: true, lastName: true, email: true, phone: true } },
          },
        },
      },
    });

    // If this appointment is linked to a case, stamp the appointment date
    // onto any pre-collection TestOrders on that case so the cases list
    // renders "Scheduled @ TTL <date/time>" instead of "Order Created".
    // Only touches order_created rows that don't already have an
    // appointmentDate — existing scheduled tests are left alone.
    if (appointment.caseId) {
      await prisma.testOrder.updateMany({
        where: {
          caseId: appointment.caseId,
          testStatus: "order_created",
          appointmentDate: null,
        },
        data: {
          appointmentDate: start,
          collectionSiteType: "truetest",
        },
      });
    }

    // Sync to Google Calendar — inline, before returning response
    const donor = appointment.donor ?? appointment.case?.donor ?? null;
    const donorName = donor ? `${donor.firstName ?? ""} ${donor.lastName ?? ""}`.trim() : "Client";
    const caseRef = appointment.case?.caseNumber ?? "(new case)";
    const descLines = [
      `Case: ${caseRef}`,
      donor?.phone ? `Phone: ${donor.phone}` : null,
      appointment.notes || null,
    ].filter(Boolean);

    const eventId = await createCalendarEvent({
      summary: `TrueTest — ${donorName}`,
      description: descLines.join("\n"),
      start: appointment.startTime,
      end: appointment.endTime,
      attendeeEmail: donor?.email ?? undefined,
    });

    if (eventId) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { googleEventId: eventId },
      });
    }

    console.log(`[appointments] POST complete: appt=${appointment.id} gcalEvent=${eventId ?? "NONE"}`);

    return NextResponse.json(
      { appointment: { ...appointment, googleEventId: eventId } },
      { status: 201 }
    );
  } catch (error) {
    console.error("[appointments] POST error:", error);
    return NextResponse.json({ error: "failed to create appointment" }, { status: 500 });
  }
}
