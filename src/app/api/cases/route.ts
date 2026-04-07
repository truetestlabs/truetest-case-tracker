import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCaseNumber } from "@/lib/case-utils";
import { SpecimenType, Lab } from "@prisma/client";
import type { TestStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const q = searchParams.get("q");
  const monitored = searchParams.get("monitored");

  const where: Record<string, unknown> = {};
  if (status === "active") {
    where.caseStatus = { not: "closed" };
  } else if (status) {
    where.caseStatus = status;
  }
  if (type) where.caseType = type;
  if (monitored === "true") where.isMonitored = true;
  if (q) {
    where.OR = [
      { caseNumber: { contains: q, mode: "insensitive" } },
      { courtCaseNumber: { contains: q, mode: "insensitive" } },
      { donor: { firstName: { contains: q, mode: "insensitive" } } },
      { donor: { lastName: { contains: q, mode: "insensitive" } } },
      { testOrders: { some: { specimenId: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const cases = await prisma.case.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      donor: true,
      caseContacts: { include: { contact: true } },
      testOrders: { take: 1, orderBy: { updatedAt: "desc" }, select: { testStatus: true, appointmentDate: true, schedulingType: true, testDescription: true, collectionSite: true, collectionSiteType: true, collectionType: true, paymentMethod: true } },
      _count: { select: { testOrders: true, documents: true } },
    },
  });

  return NextResponse.json(cases);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Server-side duplicate protection: block if donor already has an active case
    // unless caller explicitly confirms (confirmDuplicate: true)
    if (body.donor?.firstName && body.donor?.lastName && !body.confirmDuplicate) {
      const existing = await prisma.case.findMany({
        where: {
          caseStatus: { not: "closed" },
          donor: {
            firstName: { equals: body.donor.firstName.trim(), mode: "insensitive" },
            lastName: { equals: body.donor.lastName.trim(), mode: "insensitive" },
          },
        },
        select: { id: true, caseNumber: true, caseStatus: true, caseType: true },
      });
      if (existing.length > 0) {
        return NextResponse.json(
          {
            error: "DUPLICATE",
            message: `${body.donor.firstName} ${body.donor.lastName} already has an active case.`,
            duplicates: existing,
          },
          { status: 409 }
        );
      }
    }

    // Generate next case number
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

    // Create or find donor contact
    let donorId: string | null = null;
    if (body.donor?.firstName && body.donor?.lastName) {
      const donor = await prisma.contact.create({
        data: {
          contactType: "donor",
          firstName: body.donor.firstName,
          lastName: body.donor.lastName,
          email: body.donor.email || null,
          phone: body.donor.phone || null,
          preferredContact: body.donor.phone ? "text" : "email",
          represents: "na",
        },
      });
      donorId = donor.id;
    }

    // Create the case
    const newCase = await prisma.case.create({
      data: {
        caseNumber,
        caseType: body.caseType,
        caseStatus: "active",
        courtCaseNumber: body.courtCaseNumber || null,
        county: body.county || null,
        judgeName: body.judgeName || null,
        hasCourtOrder: body.hasCourtOrder || false,
        isMonitored: body.isMonitored || false,
        notes: body.notes || null,
        donorId,
        createdBy: "admin", // TODO: replace with actual user
      },
      include: { donor: true },
    });

    // Add donor as a case contact
    if (donorId) {
      await prisma.caseContact.create({
        data: {
          caseId: newCase.id,
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

    // If appointment date/time provided, create a scheduled test order
    if (body.apptDate && body.apptTime) {
      try {
        const [y, mo, d] = body.apptDate.split("-").map(Number);
        const [h, min] = body.apptTime.split(":").map(Number);
        const appointmentDate = new Date(y, mo - 1, d, h, min, 0);

        // Look up test catalog item if provided
        let catalogItem = null;
        if (body.testCatalogId) {
          catalogItem = await prisma.testCatalog.findUnique({
            where: { id: body.testCatalogId },
          });
        }

        await prisma.testOrder.create({
          data: {
            caseId: newCase.id,
            testStatus: "scheduled" as TestStatus,
            appointmentDate,
            testDescription: catalogItem?.testName ?? "Pending — added at intake",
            specimenType: catalogItem?.specimenType ?? SpecimenType.urine,
            lab: catalogItem?.lab ?? Lab.usdtl,
            ...(catalogItem ? { testCatalogId: catalogItem.id } : {}),
          },
        });
      } catch (testOrderError) {
        // Log but don't fail — case was already created successfully
        console.error("Failed to create test order during intake:", testOrderError);
      }
    }

    // Log the creation
    await prisma.statusLog.create({
      data: {
        caseId: newCase.id,
        oldStatus: "none",
        newStatus: newCase.caseStatus,
        changedBy: "admin",
        note: "Case created via intake form",
      },
    });

    return NextResponse.json(newCase, { status: 201 });
  } catch (error) {
    console.error("Error creating case:", error);
    return NextResponse.json(
      { error: "Failed to create case" },
      { status: 500 }
    );
  }
}
