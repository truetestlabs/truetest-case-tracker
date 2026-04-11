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

    // Look up most recent case + its attorneys/GAL/evaluators — wrapped in its own
    // try/catch so a case-lookup failure still returns the basic donor info.
    type LegalContactEntry = { name: string; firm: string; email: string; phone: string; contactId: string };
    type AttorneyEntry = LegalContactEntry & { roleInCase: string };
    let mostRecentCaseId: string | null = null;
    let mostRecentCaseNumber: string | null = null;
    const attorneys: AttorneyEntry[] = [];
    let gal: LegalContactEntry | null = null;
    const evaluators: LegalContactEntry[] = [];

    try {
      const recentCase = await prisma.case.findFirst({
        where: { donorId: donor.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true, caseNumber: true },
      });

      if (recentCase) {
        mostRecentCaseId = recentCase.id;
        mostRecentCaseNumber = recentCase.caseNumber;

        // Fetch ALL case contacts (excluding donor) and classify by the Contact.contactType.
        // We can't filter by roleInCase alone because attorneys/GALs are often stored with
        // roleInCase="other" in the CaseContact table — the Contact.contactType is the
        // source of truth for what role the person plays.
        const caseContacts = await prisma.caseContact.findMany({
          where: {
            caseId: recentCase.id,
            roleInCase: { not: "donor" },
          },
          include: {
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                firmName: true,
                email: true,
                phone: true,
                contactType: true,
              },
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
          // Classify by the Contact's own type (source of truth), falling back to roleInCase
          const isEvaluator = c.contactType === "evaluator" || cc.roleInCase === "evaluator";
          const isGal = c.contactType === "gal" || cc.roleInCase === "gal";
          const isAttorney = c.contactType === "attorney" || cc.roleInCase === "petitioner_attorney" || cc.roleInCase === "respondent_attorney";

          if (isEvaluator) {
            // Dedup by contactId — same evaluator on multiple cases shouldn't duplicate
            if (!evaluators.find((e) => e.contactId === base.contactId)) {
              evaluators.push(base);
            }
          } else if (isGal) {
            if (!gal) gal = base;
          } else if (isAttorney) {
            attorneys.push({ ...base, roleInCase: cc.roleInCase });
          }
          // Contacts with contactType="other" are skipped — they're additional result
          // recipients, not legal contacts the client should see pre-filled.
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
      evaluators,
      hadMultipleAttorneys: attorneys.length > 1,
      hadMultipleEvaluators: evaluators.length > 1,
    });
  } catch {
    return NextResponse.json({ found: false });
  }
}
