import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q");

  const where: Record<string, unknown> = {};
  if (type) {
    // Support comma-separated list (e.g. "attorney,gal") for cross-type search
    const types = type.split(",").map((t) => t.trim()).filter(Boolean);
    where.contactType = types.length > 1 ? { in: types } : types[0];
  }
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { firmName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  try {
    const contacts = await prisma.contact.findMany({
      where,
      orderBy: { lastName: "asc" },
      include: { _count: { select: { caseContacts: true } } },
    });
    return NextResponse.json(contacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const contact = await prisma.contact.create({
      data: {
        contactType: body.contactType,
        firstName: body.firstName,
        lastName: body.lastName,
        firmName: body.firmName || null,
        email: body.email || null,
        phone: body.phone || null,
        preferredContact: body.preferredContact || "email",
        represents: body.represents || "na",
        barNumber: body.barNumber || null,
        notes: body.notes || null,
      },
    });
    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    console.error("Error creating contact:", error);
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }
}
