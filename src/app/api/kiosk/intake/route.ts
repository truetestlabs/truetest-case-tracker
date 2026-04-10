import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** POST /api/kiosk/intake — create an IntakeDraft from the kiosk form */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.firstName?.trim() || !body.lastName?.trim() || !body.caseType) {
      return NextResponse.json({ error: "Name and visit type are required" }, { status: 400 });
    }

    // Check for existing donor
    let existingDonorId: string | null = body.existingDonorId || null;
    if (!existingDonorId) {
      const donor = await prisma.contact.findFirst({
        where: {
          contactType: "donor",
          firstName: { equals: body.firstName.trim(), mode: "insensitive" },
          lastName: { equals: body.lastName.trim(), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (donor) existingDonorId = donor.id;
    }

    // Convert flat attorney/gal fields to JSON shape expected by approval flow
    const attorneysJson = body.attorneyName?.trim()
      ? [{ name: body.attorneyName.trim(), firm: "", email: body.attorneyEmail?.trim() || "", phone: "", contactId: body.attorneyContactId || undefined }]
      : undefined;

    const galJson = body.galName?.trim()
      ? { name: body.galName.trim(), firm: "", email: body.galEmail?.trim() || "", phone: "", contactId: body.galContactId || undefined }
      : undefined;

    const draft = await prisma.intakeDraft.create({
      data: {
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        existingDonorId,
        caseType: body.caseType,
        testTypes: body.testTypes?.length > 0 ? body.testTypes : undefined,
        attorneys: attorneysJson,
        galInfo: galJson,
        notes: body.notes?.trim() || null,
        communicationConsent: body.communicationConsent || false,
        status: "pending_review",
      },
    });

    return NextResponse.json({ success: true, id: draft.id }, { status: 201 });
  } catch (error) {
    console.error("Kiosk intake error:", error);
    return NextResponse.json({ error: "Failed to submit intake" }, { status: 500 });
  }
}

/** PATCH /api/kiosk/intake — update communication consent after submit */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.firstName || !body.lastName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    // Find the most recent draft for this donor
    const draft = await prisma.intakeDraft.findFirst({
      where: {
        firstName: { equals: body.firstName.trim(), mode: "insensitive" },
        lastName: { equals: body.lastName.trim(), mode: "insensitive" },
        status: "pending_review",
      },
      orderBy: { createdAt: "desc" },
    });

    if (draft && body.communicationConsent !== undefined) {
      await prisma.intakeDraft.update({
        where: { id: draft.id },
        data: { communicationConsent: body.communicationConsent },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
