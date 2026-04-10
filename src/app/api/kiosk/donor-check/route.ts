import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/kiosk/donor-check?firstName=X&lastName=Y
 *  Public endpoint — returns basic donor contact info for returning donor pre-fill.
 *  Does NOT expose case data.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const firstName = searchParams.get("firstName")?.trim();
  const lastName = searchParams.get("lastName")?.trim();

  if (!firstName || !lastName) {
    return NextResponse.json({ found: false });
  }

  try {
    const donor = await prisma.contact.findFirst({
      where: {
        contactType: "donor",
        firstName: { equals: firstName, mode: "insensitive" },
        lastName: { equals: lastName, mode: "insensitive" },
      },
      select: { id: true, phone: true, email: true },
    });

    if (donor) {
      return NextResponse.json({
        found: true,
        contactId: donor.id,
        phone: donor.phone,
        email: donor.email,
      });
    }

    return NextResponse.json({ found: false });
  } catch {
    return NextResponse.json({ found: false });
  }
}
