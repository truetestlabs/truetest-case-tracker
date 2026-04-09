import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCaseNumber } from "@/lib/case-utils";
import { resolveFormTests, mapReasonToCaseType } from "@/lib/testMapping";
import type { SpecimenType, Lab } from "@prisma/client";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/public/order
 *
 * Public endpoint — accepts data from the website's individual.html order form
 * and creates a Case + Donor + TestOrder(s) + optional Attorney CaseContact.
 *
 * The form also sends via EmailJS (belt + suspenders). If this endpoint fails,
 * the form still shows success since EmailJS worked.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Validate minimum required fields ──
    const donorFirst = body.donorFirst?.trim();
    const donorLast = body.donorLast?.trim();
    if (!donorFirst || !donorLast) {
      return NextResponse.json(
        { error: "Donor first and last name are required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ── Map reason → caseType ──
    const caseType = mapReasonToCaseType(body.reason || "court_ordered");

    // ── Find or create donor contact (avoid duplicates) ──
    let donor = await prisma.contact.findFirst({
      where: {
        firstName: { equals: donorFirst, mode: "insensitive" },
        lastName: { equals: donorLast, mode: "insensitive" },
        contactType: "donor",
      },
    });
    if (donor) {
      const updates: Record<string, string | null> = {};
      if (body.donorEmail?.trim() && body.donorEmail.trim() !== donor.email) updates.email = body.donorEmail.trim();
      if (body.donorPhone?.trim() && body.donorPhone.trim() !== donor.phone) updates.phone = body.donorPhone.trim();
      if (body.dob && !donor.notes?.includes(body.dob)) updates.notes = body.dob ? `DOB: ${body.dob}` : donor.notes;
      if (Object.keys(updates).length > 0) {
        donor = await prisma.contact.update({ where: { id: donor.id }, data: updates });
      }
    } else {
      donor = await prisma.contact.create({
        data: {
          contactType: "donor",
          firstName: donorFirst,
          lastName: donorLast,
          email: body.donorEmail?.trim() || null,
          phone: body.donorPhone?.trim() || null,
          preferredContact: body.donorPhone ? "text" : "email",
          represents: "na",
          notes: body.dob ? `DOB: ${body.dob}` : null,
        },
      });
    }

    // ── One case per donor: find existing case or create new ──
    const existingCase = await prisma.case.findFirst({
      where: { donorId: donor.id },
      orderBy: { updatedAt: "desc" },
    });

    // Build notes from form fields (used for both new and existing cases)
    const noteParts: string[] = [];
    if (body.reason) noteParts.push(`Reason: ${body.reason}`);
    if (body.zipLoc) noteParts.push(`Location ZIP: ${body.zipLoc}`);
    if (body.stateId) noteParts.push(`State ID: ${body.stateId}`);
    if (body.addOns?.length > 0) noteParts.push(`Add-ons requested: ${body.addOns.join(", ")}`);
    if (body.customTest) noteParts.push(`Custom test: ${body.customTest}`);
    if (body.specialInstructions && body.specialInstructions !== "none") {
      noteParts.push(`Special instructions: ${body.specialInstructions}`);
    }
    if (body.otherText) noteParts.push(`Other: ${body.otherText}`);
    noteParts.push("Source: Website order form");

    let caseId: string;
    let caseNumber: string;

    if (existingCase) {
      // Reuse existing case — reopen if closed
      caseId = existingCase.id;
      caseNumber = existingCase.caseNumber;
      if (existingCase.caseStatus === "closed") {
        await prisma.case.update({
          where: { id: existingCase.id },
          data: { caseStatus: "active" },
        });
        await prisma.statusLog.create({
          data: {
            caseId: existingCase.id,
            oldStatus: "closed",
            newStatus: "active",
            changedBy: "website",
            note: "Case reopened — new order from website",
          },
        });
      }
      // Append order notes to existing case
      const existingNotes = existingCase.notes || "";
      const separator = existingNotes ? "\n---\n" : "";
      await prisma.case.update({
        where: { id: existingCase.id },
        data: { notes: existingNotes + separator + noteParts.join("\n") },
      });
    } else {
      // Generate new case number
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
      caseNumber = generateCaseNumber(sequence);

      // Create the case
      const newCase = await prisma.case.create({
        data: {
          caseNumber,
          caseType,
          caseStatus: "active",
          hasCourtOrder: false,
          isMonitored: false,
          notes: noteParts.join("\n"),
          donorId: donor.id,
          createdBy: "website",
        },
      });
      caseId = newCase.id;

      // Add donor as case contact
      await prisma.caseContact.create({
        data: {
          caseId,
          contactId: donor.id,
          roleInCase: "donor",
          receivesResults: false,
          receivesStatus: true,
          receivesInvoices: false,
          canOrderTests: false,
          isPrimaryContact: false,
        },
      });
    }

    // ── Add attorney contact if provided ──
    if (body.attorneyEmail?.trim()) {
      const attorney = await prisma.contact.create({
        data: {
          contactType: "attorney",
          firstName: body.firstName?.trim() || "Attorney",
          lastName: body.lastName?.trim() || "Contact",
          email: body.attorneyEmail.trim(),
          preferredContact: "email",
          represents: "na",
        },
      });
      await prisma.caseContact.create({
        data: {
          caseId: caseId,
          contactId: attorney.id,
          roleInCase: "referring_party",
          receivesResults: true,
          receivesStatus: true,
          receivesInvoices: false,
          canOrderTests: false,
          isPrimaryContact: false,
        },
      });
    }

    // ── Create test orders ──
    const tests: string[] = body.tests || [];
    const collectionType = body.observed === "Yes" ? "observed" : "unobserved";

    if (tests.length > 0) {
      const resolved = await resolveFormTests(tests);
      for (const t of resolved) {
        await prisma.testOrder.create({
          data: {
            caseId: caseId,
            testCatalogId: t.testCatalogId,
            testDescription: t.testDescription,
            specimenType: t.specimenType as SpecimenType,
            lab: t.lab as Lab,
            testStatus: "order_created",
            collectionType,
            schedulingType: "scheduled",
          },
        });
      }
    }

    // ── Log creation ──
    await prisma.statusLog.create({
      data: {
        caseId: caseId,
        oldStatus: "—",
        newStatus: "active",
        changedBy: "website",
        note: `Case created from website order form. Donor: ${donorFirst} ${donorLast}. Tests: ${tests.length > 0 ? tests.join(", ") : "none selected"}.`,
      },
    });

    console.log(`[Order] Website order → case ${caseNumber} created with ${tests.length} test(s)`);

    return NextResponse.json(
      { caseId: caseId, caseNumber },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Order] Website order error:", error);
    return NextResponse.json(
      { error: "Failed to create case" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
