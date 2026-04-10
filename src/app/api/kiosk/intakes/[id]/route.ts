import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCaseNumber } from "@/lib/case-utils";

/** GET /api/kiosk/intakes/[id] — get single intake draft */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const draft = await prisma.intakeDraft.findUnique({ where: { id } });
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(draft);
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** PATCH /api/kiosk/intakes/[id] — approve, reject, or edit a draft */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const draft = await prisma.intakeDraft.findUnique({ where: { id } });
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Approve → create case
    if (body.action === "approve") {
      // Generate case number
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

      // Check for existing case (one case per donor rule)
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

      // Add additional result recipients as CaseContacts (for Personal visits)
      const additionalRecipients = (draft.additionalRecipients as Array<{ name?: string; email: string }>) || [];
      for (const recipient of additionalRecipients) {
        if (!recipient.email?.trim()) continue;
        const email = recipient.email.trim();
        const [firstName, ...rest] = (recipient.name?.trim() || email.split("@")[0]).split(" ");
        const lastName = rest.join(" ") || "";

        // Find existing contact by email
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
        // Link to case if not already linked
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
          changedBy: body.reviewedBy || "admin",
          note: "Case created from kiosk intake",
        },
      });

      // Update the draft
      await prisma.intakeDraft.update({
        where: { id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewedBy: body.reviewedBy || "admin",
          caseId,
        },
      });

      return NextResponse.json({ approved: true, caseId, caseNumber: finalCaseNumber });
    }

    // Reject
    if (body.action === "reject") {
      await prisma.intakeDraft.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: body.reviewedBy || "admin",
        },
      });
      return NextResponse.json({ rejected: true });
    }

    // Edit fields
    const updates: Record<string, unknown> = {};
    const editableFields = ["firstName", "lastName", "phone", "email", "caseType", "courtCaseNumber", "county", "judgeName", "orderedBy", "paymentResponsibility", "notes"];
    for (const field of editableFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    if (Object.keys(updates).length > 0) {
      await prisma.intakeDraft.update({ where: { id }, data: updates });
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error("Intake approve/reject error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
