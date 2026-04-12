import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCalendarEvent } from "@/lib/gcal";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const caseData = await prisma.case.findUnique({
      where: { id },
      include: {
        donor: true,
        caseContacts: {
          include: { contact: true },
          orderBy: { roleInCase: "asc" },
        },
        testOrders: {
          orderBy: { createdAt: "desc" },
          include: {
            testCatalog: true,
            documents: {
              orderBy: { uploadedAt: "desc" },
              select: { id: true, documentType: true, fileName: true, uploadedAt: true },
            },
          },
        },
        documents: { orderBy: { uploadedAt: "desc" } },
        courtOrders: { include: { document: true } },
        statusLogs: { orderBy: { changedAt: "desc" }, take: 20 },
      },
    });

    if (!caseData) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    return NextResponse.json(caseData);
  } catch (error) {
    console.error("Error fetching case:", error);
    return NextResponse.json({ error: "Failed to fetch case" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const caseData = await prisma.case.findUnique({ where: { id } });
    if (!caseData) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    // Cancel linked appointments on Google Calendar before deleting
    const appointments = await prisma.appointment.findMany({
      where: { caseId: id, status: "booked" },
      select: { id: true, googleEventId: true },
    });
    for (const appt of appointments) {
      if (appt.googleEventId) {
        await deleteCalendarEvent(appt.googleEventId);
      }
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: "cancelled" },
      });
    }

    // Delete in order due to foreign keys
    await prisma.statusLog.deleteMany({ where: { caseId: id } });
    await prisma.message.deleteMany({ where: { caseId: id } });
    await prisma.courtOrder.deleteMany({ where: { caseId: id } });
    await prisma.document.deleteMany({ where: { caseId: id } });
    await prisma.testOrder.deleteMany({ where: { caseId: id } });
    await prisma.caseContact.deleteMany({ where: { caseId: id } });
    await prisma.case.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting case:", error);
    return NextResponse.json({ error: "Failed to delete case" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const oldCase = await prisma.case.findUnique({ where: { id } });
    if (!oldCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    // Build update data — only include fields that were sent
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      "caseType", "caseStatus", "courtCaseNumber", "county", "jurisdiction",
      "judgeName", "hasCourtOrder", "isMonitored", "notes"
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    // Update donor info if provided
    if (body.donor && oldCase.donorId) {
      await prisma.contact.update({
        where: { id: oldCase.donorId },
        data: {
          ...(body.donor.firstName && { firstName: body.donor.firstName }),
          ...(body.donor.lastName && { lastName: body.donor.lastName }),
          ...(body.donor.email !== undefined && { email: body.donor.email || null }),
          ...(body.donor.phone !== undefined && { phone: body.donor.phone || null }),
        },
      });
    }

    const updated = await prisma.case.update({
      where: { id },
      data: updateData,
      include: { donor: true },
    });

    // Log status change if status changed
    if (body.caseStatus && body.caseStatus !== oldCase.caseStatus) {
      await prisma.statusLog.create({
        data: {
          caseId: id,
          oldStatus: oldCase.caseStatus,
          newStatus: body.caseStatus,
          changedBy: "admin",
          note: body.statusNote || null,
        },
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating case:", error);
    return NextResponse.json({ error: "Failed to update case" }, { status: 500 });
  }
}
