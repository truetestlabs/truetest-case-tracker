import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const data: Record<string, unknown> = {};
    const allowed = ["contactType", "firstName", "lastName", "firmName", "email", "phone", "barNumber", "notes", "represents", "preferredContact"];
    for (const field of allowed) {
      if (body[field] !== undefined) data[field] = body[field] || null;
    }
    // firstName and lastName should never be null
    if (body.firstName) data.firstName = body.firstName;
    if (body.lastName) data.lastName = body.lastName;
    if (body.contactType) data.contactType = body.contactType;

    const updated = await prisma.contact.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating contact:", error);
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Check if contact is linked to any cases
    const caseCount = await prisma.caseContact.count({ where: { contactId: id } });

    // Delete case contact links first
    if (caseCount > 0) {
      await prisma.caseContact.deleteMany({ where: { contactId: id } });
    }

    // Also unlink as donor from cases
    await prisma.case.updateMany({
      where: { donorId: id },
      data: { donorId: null },
    });

    await prisma.contact.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting contact:", error);
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 });
  }
}
