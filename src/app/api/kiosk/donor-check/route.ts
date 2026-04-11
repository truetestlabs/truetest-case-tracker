import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/kiosk/donor-check?firstName=X&lastName=Y
 *  Public endpoint — returns basic donor contact info for returning donor pre-fill,
 *  plus attorney/GAL from their most recent case so Step 3 can be pre-populated.
 *  Does NOT expose full case data.
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

    if (!donor) {
      return NextResponse.json({ found: false });
    }

    // Look up most recent case + its attorneys/GAL — wrapped in its own try/catch
    // so a case-lookup failure still returns the basic donor info.
    type AttorneyEntry = { name: string; firm: string; email: string; phone: string; contactId: string; roleInCase: string };
    type GalEntry = { name: string; firm: string; email: string; phone: string; contactId: string };
    let mostRecentCaseId: string | null = null;
    let mostRecentCaseNumber: string | null = null;
    let attorneys: AttorneyEntry[] = [];
    let gal: GalEntry | null = null;

    try {
      const recentCase = await prisma.case.findFirst({
        where: { donorId: donor.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true, caseNumber: true },
      });

      if (recentCase) {
        mostRecentCaseId = recentCase.id;
        mostRecentCaseNumber = recentCase.caseNumber;

        const caseContacts = await prisma.caseContact.findMany({
          where: {
            caseId: recentCase.id,
            roleInCase: { in: ["petitioner_attorney", "respondent_attorney", "gal"] },
          },
          include: {
            contact: {
              select: { id: true, firstName: true, lastName: true, firmName: true, email: true, phone: true },
            },
          },
        });

        for (const cc of caseContacts) {
          const c = cc.contact;
          const base = {
            name: `${c.firstName} ${c.lastName}`.trim(),
            firm: c.firmName || "",
            email: c.email || "",
            phone: c.phone || "",
            contactId: c.id,
          };
          if (cc.roleInCase === "gal") {
            if (!gal) gal = base;
          } else {
            attorneys.push({ ...base, roleInCase: cc.roleInCase });
          }
        }
      }
    } catch (e) {
      console.warn("[donor-check] case lookup failed:", e);
      // Swallow — still return donor info below
    }

    return NextResponse.json({
      found: true,
      contactId: donor.id,
      phone: donor.phone,
      email: donor.email,
      mostRecentCaseId,
      mostRecentCaseNumber,
      attorneys,
      gal,
      hadMultipleAttorneys: attorneys.length > 1,
    });
  } catch {
    return NextResponse.json({ found: false });
  }
}
