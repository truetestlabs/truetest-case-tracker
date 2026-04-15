import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCalendarEvent } from "@/lib/gcal";
import { getAuthUser, requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

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
        referringAccount: { select: { id: true, name: true, shortCode: true } },
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
            labResults: {
              orderBy: { receivedByUs: "desc" },
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
  request: NextRequest,
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

    // Audit log
    const user = await getAuthUser(request);
    if (user) {
      logAudit({ userId: user.id, action: "delete_case", resource: "case", resourceId: id, metadata: { caseNumber: caseData.caseNumber } });
    }

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

  // Defense-in-depth auth
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const oldCase = await prisma.case.findUnique({ where: { id } });
    if (!oldCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    // Build update data — only include fields that were sent
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      "caseType", "caseStatus", "courtCaseNumber", "county", "jurisdiction",
      "judgeName", "hasCourtOrder", "isMonitored", "notes", "referringAccountId"
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
          changedBy: user.email || user.name || "admin",
          note: body.statusNote || null,
        },
      });
    }

    // Auto-apply account default recipients when a referringAccount is newly assigned
    let accountRecipientsAdded = 0;
    const newAccountId = updateData.referringAccountId as string | null | undefined;
    if (newAccountId && newAccountId !== oldCase.referringAccountId) {
      const defaults = await prisma.accountDefaultRecipient.findMany({
        where: { accountId: newAccountId },
      });
      for (const dr of defaults) {
        // Find or create a Contact record for this default recipient
        let contact = dr.email
          ? await prisma.contact.findFirst({ where: { email: dr.email } })
          : null;
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              firstName: dr.firstName,
              lastName: dr.lastName,
              email: dr.email,
              phone: dr.phone,
              contactType: dr.role as import("@prisma/client").ContactType,
              preferredContact: "email",
              represents: "na",
            },
          });
        }
        // Skip if already a CaseContact in this role
        const exists = await prisma.caseContact.findFirst({
          where: { caseId: id, contactId: contact.id, roleInCase: dr.role as import("@prisma/client").CaseRole },
        });
        if (!exists) {
          await prisma.caseContact.create({
            data: {
              caseId: id,
              contactId: contact.id,
              roleInCase: dr.role as import("@prisma/client").CaseRole,
              receivesResults: dr.receivesResults,
              receivesStatus: dr.receivesStatus,
              receivesInvoices: dr.receivesInvoices,
              canOrderTests: dr.canOrderTests,
            },
          });
          accountRecipientsAdded++;
        }
      }
    }

    logAudit({
      userId: user.id,
      action: "case.update",
      resource: "case",
      resourceId: id,
      metadata: {
        caseNumber: oldCase.caseNumber,
        changedFields: Object.keys(updateData),
        statusChange:
          body.caseStatus && body.caseStatus !== oldCase.caseStatus
            ? { from: oldCase.caseStatus, to: body.caseStatus }
            : undefined,
      },
    }).catch((e) => console.error("[cases/id] audit failed:", e));

    return NextResponse.json({ ...updated, accountRecipientsAdded });
  } catch (error) {
    console.error("Error updating case:", error);
    return NextResponse.json({ error: "Failed to update case" }, { status: 500 });
  }
}
