import { prisma } from "@/lib/prisma";
import { generateCaseNumber } from "@/lib/case-utils";

/**
 * Shared helper: approve an IntakeDraft and materialize it into a Case.
 *
 * Called by BOTH the auto-approve path (POST /api/kiosk/intake when a
 * returning client confirms with no changes) and the manual staff-approve
 * path (PATCH /api/kiosk/intakes/[id] with action=approve). Having a single
 * implementation means there's one code path for creating cases from drafts,
 * and the auto path inherits every dedup/safety check the manual path had.
 *
 * Behavior:
 *  - Generates the next TTL-FL-YYYY-NNNN case number
 *  - Finds or creates the donor Contact
 *  - One-case-per-donor: reuses an existing case if the donor already has one
 *    (reopening it if closed); otherwise creates a new case
 *  - Adds attorney / GAL / evaluator contacts with dedup via caseContact.findFirst
 *  - Adds additional result recipients as "other" CaseContacts
 *  - Creates placeholder TestOrders for each selected test type
 *  - Uploads the court order document link if present
 *  - Writes a StatusLog entry (changedBy = reviewedBy, e.g. "kiosk-auto" or "admin")
 *  - Stamps the draft: status=approved, reviewedAt=now, reviewedBy, caseId
 *
 * Throws on any database error — callers should wrap in try/catch and
 * fall through to a pending-review response if they want to be defensive.
 */
export async function approveDraft(
  draftId: string,
  reviewedBy: string
): Promise<{ caseId: string; caseNumber: string }> {
  const draft = await prisma.intakeDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error(`IntakeDraft ${draftId} not found`);

  // Generate case number (only used if we end up creating a new case)
  const currentYear = new Date().getFullYear();
  const lastCase = await prisma.case.findFirst({
    where: { caseNumber: { startsWith: `TTL-FL-${currentYear}` } },
    orderBy: { caseNumber: "desc" },
  });
  let sequence = 1;
  if (lastCase) {
    const lastNum = parseInt(lastCase.caseNumber.split("-").pop() || "0");
    sequence = lastNum + 1;
  }
  const caseNumber = generateCaseNumber(sequence);

  // Find or create donor contact
  let donorId = draft.existingDonorId;
  if (!donorId) {
    let donor = await prisma.contact.findFirst({
      where: {
        contactType: "donor",
        firstName: { equals: draft.firstName, mode: "insensitive" },
        lastName: { equals: draft.lastName, mode: "insensitive" },
      },
    });
    if (donor) {
      // Update with latest info
      const updates: Record<string, string | null> = {};
      if (draft.email && draft.email !== donor.email) updates.email = draft.email;
      if (draft.phone && draft.phone !== donor.phone) updates.phone = draft.phone;
      if (Object.keys(updates).length > 0) {
        donor = await prisma.contact.update({ where: { id: donor.id }, data: updates });
      }
      donorId = donor.id;
    } else {
      donor = await prisma.contact.create({
        data: {
          contactType: "donor",
          firstName: draft.firstName,
          lastName: draft.lastName,
          email: draft.email,
          phone: draft.phone,
          preferredContact: draft.phone ? "text" : "email",
          represents: "na",
        },
      });
      donorId = donor.id;
    }
  }

  // One case per donor rule
  const existingCase = await prisma.case.findFirst({
    where: { donorId },
    orderBy: { updatedAt: "desc" },
  });

  let caseId: string;
  let finalCaseNumber: string;

  if (existingCase) {
    caseId = existingCase.id;
    finalCaseNumber = existingCase.caseNumber;
    if (existingCase.caseStatus === "closed") {
      await prisma.case.update({
        where: { id: existingCase.id },
        data: { caseStatus: "active" },
      });
    }
    // Update case fields from intake if provided
    const caseUpdates: Record<string, unknown> = {};
    if (draft.courtCaseNumber && !existingCase.courtCaseNumber) caseUpdates.courtCaseNumber = draft.courtCaseNumber;
    if (draft.county && !existingCase.county) caseUpdates.county = draft.county;
    if (draft.judgeName && !existingCase.judgeName) caseUpdates.judgeName = draft.judgeName;
    if (draft.hasCourtOrder) caseUpdates.hasCourtOrder = true;
    if (Object.keys(caseUpdates).length > 0) {
      await prisma.case.update({ where: { id: existingCase.id }, data: caseUpdates });
    }
  } else {
    const newCase = await prisma.case.create({
      data: {
        caseNumber,
        caseType: draft.caseType as "court_ordered" | "voluntary" | "by_agreement",
        caseStatus: "active",
        hasCourtOrder: draft.hasCourtOrder,
        isMonitored: false,
        courtCaseNumber: draft.courtCaseNumber,
        county: draft.county,
        judgeName: draft.judgeName,
        notes: draft.notes,
        donorId,
        createdBy: "kiosk",
      },
    });
    caseId = newCase.id;
    finalCaseNumber = caseNumber;

    // Add donor as case contact
    await prisma.caseContact.create({
      data: {
        caseId,
        contactId: donorId,
        roleInCase: "donor",
        receivesResults: false,
        receivesStatus: true,
        receivesInvoices: false,
        canOrderTests: false,
        isPrimaryContact: false,
      },
    });
  }

  // Add attorney contacts
  const attorneys = (draft.attorneys as Array<{ name: string; firm: string; email: string; phone: string; contactId?: string }>) || [];
  for (const atty of attorneys) {
    let contactId = atty.contactId;
    if (!contactId && atty.name) {
      const [firstName, ...rest] = atty.name.split(" ");
      const lastName = rest.join(" ") || firstName;
      const existing = await prisma.contact.findFirst({
        where: {
          contactType: "attorney",
          firstName: { equals: firstName, mode: "insensitive" },
          lastName: { equals: lastName, mode: "insensitive" },
        },
      });
      if (existing) {
        contactId = existing.id;
      } else {
        const created = await prisma.contact.create({
          data: {
            contactType: "attorney",
            firstName,
            lastName,
            firmName: atty.firm || null,
            email: atty.email || null,
            phone: atty.phone || null,
            preferredContact: "email",
            represents: "na",
          },
        });
        contactId = created.id;
      }
    }
    if (contactId) {
      const exists = await prisma.caseContact.findFirst({ where: { caseId, contactId } });
      if (!exists) {
        await prisma.caseContact.create({
          data: {
            caseId,
            contactId,
            roleInCase: "petitioner_attorney",
            receivesResults: true,
            receivesStatus: true,
          },
        });
      }
    }
  }

  // Add GAL contact
  const galInfo = draft.galInfo as { name: string; firm: string; email: string; phone: string; contactId?: string } | null;
  if (galInfo?.name) {
    let galContactId = galInfo.contactId;
    if (!galContactId) {
      const [firstName, ...rest] = galInfo.name.split(" ");
      const lastName = rest.join(" ") || firstName;
      const existing = await prisma.contact.findFirst({
        where: {
          contactType: "gal",
          firstName: { equals: firstName, mode: "insensitive" },
          lastName: { equals: lastName, mode: "insensitive" },
        },
      });
      if (existing) {
        galContactId = existing.id;
      } else {
        const created = await prisma.contact.create({
          data: {
            contactType: "gal",
            firstName,
            lastName,
            firmName: galInfo.firm || null,
            email: galInfo.email || null,
            phone: galInfo.phone || null,
            preferredContact: "email",
            represents: "child",
          },
        });
        galContactId = created.id;
      }
    }
    const exists = await prisma.caseContact.findFirst({ where: { caseId, contactId: galContactId } });
    if (!exists) {
      await prisma.caseContact.create({
        data: {
          caseId,
          contactId: galContactId,
          roleInCase: "gal",
          receivesResults: true,
          receivesStatus: true,
        },
      });
    }
  }

  // Add court-ordered evaluator contacts (doctors appointed by the court)
  const evaluators = (draft.evaluators as Array<{ name: string; firm: string; email: string; phone: string; contactId?: string }>) || [];
  for (const ev of evaluators) {
    if (!ev.name?.trim()) continue;
    let evContactId = ev.contactId;
    if (!evContactId) {
      const [firstName, ...rest] = ev.name.split(" ");
      const lastName = rest.join(" ") || firstName;
      const existing = await prisma.contact.findFirst({
        where: {
          contactType: "evaluator",
          firstName: { equals: firstName, mode: "insensitive" },
          lastName: { equals: lastName, mode: "insensitive" },
        },
      });
      if (existing) {
        evContactId = existing.id;
      } else {
        const created = await prisma.contact.create({
          data: {
            contactType: "evaluator",
            firstName,
            lastName,
            firmName: ev.firm || null,
            email: ev.email || null,
            phone: ev.phone || null,
            preferredContact: "email",
            represents: "na",
          },
        });
        evContactId = created.id;
      }
    }
    const existsEv = await prisma.caseContact.findFirst({ where: { caseId, contactId: evContactId } });
    if (!existsEv) {
      await prisma.caseContact.create({
        data: {
          caseId,
          contactId: evContactId,
          roleInCase: "evaluator",
          receivesResults: true,
          receivesStatus: true,
        },
      });
    }
  }

  // Add additional result recipients as CaseContacts (for Personal visits)
  const additionalRecipients = (draft.additionalRecipients as Array<{ name?: string; email: string }>) || [];
  for (const recipient of additionalRecipients) {
    if (!recipient.email?.trim()) continue;
    const email = recipient.email.trim();
    const [firstName, ...rest] = (recipient.name?.trim() || email.split("@")[0]).split(" ");
    const lastName = rest.join(" ") || "";

    let existing = await prisma.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!existing) {
      existing = await prisma.contact.create({
        data: {
          contactType: "other",
          firstName: firstName || "Unknown",
          lastName: lastName || "",
          email,
          preferredContact: "email",
          represents: "na",
        },
      });
    }
    const alreadyLinked = await prisma.caseContact.findFirst({
      where: { caseId, contactId: existing.id },
    });
    if (!alreadyLinked) {
      await prisma.caseContact.create({
        data: {
          caseId,
          contactId: existing.id,
          roleInCase: "other",
          receivesResults: true,
          receivesStatus: false,
          receivesInvoices: false,
          canOrderTests: false,
          isPrimaryContact: false,
        },
      });
    }
  }

  // Create placeholder test orders for each test type the client selected
  const testTypes = (draft.testTypes as string[]) || [];
  const testTypeLabels: Record<string, { description: string; specimenType: "urine" | "hair" | "blood" | "sweat_patch" }> = {
    urine: { description: "Urine Drug Test (pending staff selection)", specimenType: "urine" },
    hair: { description: "Hair Drug Test (pending staff selection)", specimenType: "hair" },
    blood_peth: { description: "PEth Blood Alcohol Test (pending staff selection)", specimenType: "blood" },
    sweat_patch: { description: "Sweat Patch Test (pending staff selection)", specimenType: "sweat_patch" },
  };
  for (const tt of testTypes) {
    const meta = testTypeLabels[tt];
    if (meta) {
      await prisma.testOrder.create({
        data: {
          caseId,
          testDescription: meta.description,
          specimenType: meta.specimenType,
          lab: "usdtl",
          testStatus: "order_created",
          collectionType: "unobserved",
          schedulingType: "walk_in",
        },
      });
    }
  }

  // Upload court order document if present
  if (draft.courtOrderPath) {
    await prisma.document.create({
      data: {
        caseId,
        documentType: "court_order",
        fileName: "Court Order (from kiosk intake)",
        filePath: draft.courtOrderPath,
        uploadedBy: "kiosk",
      },
    });
  }

  // Create status log
  await prisma.statusLog.create({
    data: {
      caseId,
      oldStatus: "intake",
      newStatus: "active",
      changedBy: reviewedBy,
      note: reviewedBy === "kiosk-auto"
        ? "Case auto-approved from kiosk intake (no changes from returning client)"
        : "Case created from kiosk intake",
    },
  });

  // Update the draft
  await prisma.intakeDraft.update({
    where: { id: draftId },
    data: {
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy,
      caseId,
    },
  });

  return { caseId, caseNumber: finalCaseNumber };
}
