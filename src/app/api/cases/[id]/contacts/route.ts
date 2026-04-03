import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  try {
    const body = await request.json();
    const { caseContactId, ...updateData } = body;

    if (!caseContactId) {
      return NextResponse.json({ error: "caseContactId required" }, { status: 400 });
    }

    // Update the contact info if provided
    if (updateData.contact) {
      const cc = await prisma.caseContact.findUnique({ where: { id: caseContactId }, include: { contact: true } });
      if (cc && cc.caseId === caseId) {
        await prisma.contact.update({
          where: { id: cc.contactId },
          data: {
            ...(updateData.contact.firstName && { firstName: updateData.contact.firstName }),
            ...(updateData.contact.lastName && { lastName: updateData.contact.lastName }),
            ...(updateData.contact.firmName !== undefined && { firmName: updateData.contact.firmName || null }),
            ...(updateData.contact.email !== undefined && { email: updateData.contact.email || null }),
            ...(updateData.contact.phone !== undefined && { phone: updateData.contact.phone || null }),
          },
        });
      }
    }

    // Update the case-contact link
    const updated = await prisma.caseContact.update({
      where: { id: caseContactId },
      data: {
        ...(updateData.roleInCase && { roleInCase: updateData.roleInCase }),
        ...(updateData.receivesResults !== undefined && { receivesResults: updateData.receivesResults }),
        ...(updateData.receivesStatus !== undefined && { receivesStatus: updateData.receivesStatus }),
        ...(updateData.receivesInvoices !== undefined && { receivesInvoices: updateData.receivesInvoices }),
        ...(updateData.canOrderTests !== undefined && { canOrderTests: updateData.canOrderTests }),
      },
      include: { contact: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating contact:", error);
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    const body = await request.json();

    // Create or find the contact
    let contact;

    if (body.contactId) {
      // Use existing contact
      contact = await prisma.contact.findUnique({ where: { id: body.contactId } });
      if (!contact) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
    } else {
      // Create new contact
      contact = await prisma.contact.create({
        data: {
          contactType: body.contactType,
          firstName: body.firstName || "Unknown",
          lastName: body.lastName || "Unknown",
          firmName: body.firmName || null,
          email: body.email || null,
          phone: body.phone || null,
          preferredContact: body.preferredContact || "email",
          represents: body.represents || "na",
          barNumber: body.barNumber || null,
        },
      });
    }

    // Check if this contact is already linked to this case in this role
    const existing = await prisma.caseContact.findFirst({
      where: { caseId, contactId: contact.id, roleInCase: body.roleInCase },
    });

    if (existing) {
      // Update the existing link
      const updated = await prisma.caseContact.update({
        where: { id: existing.id },
        data: {
          receivesResults: body.receivesResults ?? existing.receivesResults,
          receivesStatus: body.receivesStatus ?? existing.receivesStatus,
          receivesInvoices: body.receivesInvoices ?? existing.receivesInvoices,
          canOrderTests: body.canOrderTests ?? existing.canOrderTests,
          isPrimaryContact: body.isPrimaryContact ?? existing.isPrimaryContact,
        },
        include: { contact: true },
      });
      return NextResponse.json(updated);
    }

    // Create the case-contact link
    const caseContact = await prisma.caseContact.create({
      data: {
        caseId,
        contactId: contact.id,
        roleInCase: body.roleInCase,
        receivesResults: body.receivesResults ?? false,
        receivesStatus: body.receivesStatus ?? false,
        receivesInvoices: body.receivesInvoices ?? false,
        canOrderTests: body.canOrderTests ?? false,
        isPrimaryContact: body.isPrimaryContact ?? false,
      },
      include: { contact: true },
    });

    // Log it
    await prisma.statusLog.create({
      data: {
        caseId,
        oldStatus: "—",
        newStatus: "contact_added",
        changedBy: "admin",
        note: `Added ${contact.firstName} ${contact.lastName} as ${body.roleInCase.replace("_", " ")}`,
      },
    });

    return NextResponse.json(caseContact, { status: 201 });
  } catch (error) {
    console.error("Error adding contact to case:", error);
    return NextResponse.json({ error: "Failed to add contact" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const caseContactId = searchParams.get("caseContactId");

  if (!caseContactId) {
    return NextResponse.json({ error: "caseContactId required" }, { status: 400 });
  }

  try {
    const caseContact = await prisma.caseContact.findUnique({
      where: { id: caseContactId },
      include: { contact: true },
    });

    if (!caseContact || caseContact.caseId !== caseId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.caseContact.delete({ where: { id: caseContactId } });

    await prisma.statusLog.create({
      data: {
        caseId,
        oldStatus: "contact_removed",
        newStatus: "—",
        changedBy: "admin",
        note: `Removed ${caseContact.contact.firstName} ${caseContact.contact.lastName}`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing contact:", error);
    return NextResponse.json({ error: "Failed to remove contact" }, { status: 500 });
  }
}
