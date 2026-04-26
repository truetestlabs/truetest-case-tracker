import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createTestOrderWithPatchDetails } from "@/lib/createTestOrder";

// This endpoint receives extracted court order data (parsed client-side or by AI)
// and creates the full case with contacts, distribution list, and test orders
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = body.parsedData;

    if (!parsed) {
      return NextResponse.json({ error: "No parsed data provided" }, { status: 400 });
    }

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
    const caseNumber = `TTL-FL-${currentYear}-${String(sequence).padStart(4, "0")}`;

    // Create donors
    const donorIds: string[] = [];
    for (const donor of parsed.donors || []) {
      const contact = await prisma.contact.create({
        data: {
          contactType: "donor",
          firstName: donor.firstName || "Unknown",
          lastName: donor.lastName || "Unknown",
          email: donor.email || null,
          phone: donor.phone || null,
          preferredContact: donor.phone ? "text" : "email",
          represents: donor.party || "na",
        },
      });
      donorIds.push(contact.id);
    }

    // Use first donor as primary
    const primaryDonorId = donorIds[0] || null;

    // Create the case
    const newCase = await prisma.case.create({
      data: {
        caseNumber,
        caseType: "court_ordered",
        caseStatus: "active",
        courtCaseNumber: parsed.courtCaseNumber || null,
        county: parsed.county || "Cook County",
        judgeName: parsed.judgeName || null,
        hasCourtOrder: true,
        notes: parsed.notes || null,
        donorId: primaryDonorId,
        createdBy: "admin",
      },
    });

    // Add donors as case contacts
    for (let i = 0; i < donorIds.length; i++) {
      await prisma.caseContact.create({
        data: {
          caseId: newCase.id,
          contactId: donorIds[i],
          roleInCase: "donor",
          receivesResults: false,
          receivesStatus: true,
        },
      });
    }

    // Create attorneys, GALs, and other contacts
    for (const person of parsed.contacts || []) {
      const contact = await prisma.contact.create({
        data: {
          contactType: person.type || "attorney",
          firstName: person.firstName || "Unknown",
          lastName: person.lastName || "Unknown",
          firmName: person.firmName || null,
          email: person.email || null,
          phone: person.phone || null,
          represents: person.represents || "na",
          barNumber: person.barNumber || null,
        },
      });

      await prisma.caseContact.create({
        data: {
          caseId: newCase.id,
          contactId: contact.id,
          roleInCase: person.role || "other",
          receivesResults: person.receivesResults ?? true,
          receivesStatus: person.receivesStatus ?? true,
          receivesInvoices: person.receivesInvoices ?? false,
          canOrderTests: person.canOrderTests ?? false,
        },
      });
    }

    // Create test orders
    for (const test of parsed.testOrders || []) {
      // Try to match to catalog
      let catalogMatch = null;
      if (test.catalogSearch) {
        catalogMatch = await prisma.testCatalog.findFirst({
          where: {
            OR: [
              { testName: { contains: test.catalogSearch, mode: "insensitive" } },
              { labTestCode: { contains: test.catalogSearch, mode: "insensitive" } },
            ],
          },
        });
      }

      // Wrapped in tx so sweat-patch order + PatchDetails commit atomically.
      await prisma.$transaction((tx) =>
        createTestOrderWithPatchDetails(tx, {
          caseId: newCase.id,
          testCatalogId: catalogMatch?.id || null,
          testDescription: test.description || "Unknown test",
          specimenType: test.specimenType || "urine",
          lab: test.lab || "usdtl",
          testStatus: "order_created",
          collectionType: test.observed ? "observed" : "unobserved",
          schedulingType: test.scheduling || "scheduled",
          clientPrice: catalogMatch?.clientPrice || null,
          labCost: catalogMatch?.labCost || null,
          notes: test.notes || null,
        }),
      );
    }

    // Create court order record
    await prisma.courtOrder.create({
      data: {
        caseId: newCase.id,
        documentId: newCase.id, // placeholder — will link to actual doc when uploaded
        orderDate: parsed.orderDate ? new Date(parsed.orderDate) : null,
        judgeName: parsed.judgeName || null,
        courtCaseNumber: parsed.courtCaseNumber || null,
        county: parsed.county || "Cook County",
        testsOrdered: parsed.testOrders || [],
        testingDuration: parsed.testingDuration || null,
        frequency: parsed.frequency || null,
        whoPays: parsed.whoPays || null,
        resultDistribution: (parsed.contacts || []).filter((c: { receivesResults?: boolean }) => c.receivesResults),
        specialInstructions: parsed.specialInstructions || null,
        complianceStatus: "pending",
        parsedByAi: true,
        reviewStatus: "pending_review",
      },
    });

    // Log creation
    await prisma.statusLog.create({
      data: {
        caseId: newCase.id,
        oldStatus: "none",
        newStatus: "active",
        changedBy: "admin",
        note: "Case auto-created from court order upload",
      },
    });

    return NextResponse.json({
      caseId: newCase.id,
      caseNumber: newCase.caseNumber,
      donorsCreated: donorIds.length,
      contactsCreated: (parsed.contacts || []).length,
      testOrdersCreated: (parsed.testOrders || []).length,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating case from court order:", error);
    return NextResponse.json({ error: "Failed to create case from court order" }, { status: 500 });
  }
}
