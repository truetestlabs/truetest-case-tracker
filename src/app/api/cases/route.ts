import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCaseNumber } from "@/lib/case-utils";
import { SpecimenType, Lab } from "@prisma/client";
import type { TestStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createCaseSchema, formatZodError } from "@/lib/validation/schemas";

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
      testOrders: { orderBy: { updatedAt: "desc" }, select: { testStatus: true, appointmentDate: true, schedulingType: true, testDescription: true, collectionSite: true, collectionSiteType: true, collectionType: true, paymentMethod: true } },
      _count: { select: { testOrders: true, documents: true } },
    },
  });

  return NextResponse.json(cases);
}

export async function POST(request: NextRequest) {
  // Defense-in-depth auth (middleware already enforces this for protected routes)
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  // Validate body — keep loose (the legacy shape is wide) but at minimum
  // checks donor sub-object, types, and string lengths.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createCaseSchema.passthrough().safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error), { status: 400 });
  }
  const body = parsed.data as Record<string, any>;

  try {

    // One case per donor: check ALL cases (active and closed)
    if (body.donor?.firstName && body.donor?.lastName) {
      const existing = await prisma.case.findMany({
        where: {
          donor: {
            firstName: { equals: body.donor.firstName.trim(), mode: "insensitive" },
            lastName: { equals: body.donor.lastName.trim(), mode: "insensitive" },
          },
        },
        select: { id: true, caseNumber: true, caseStatus: true, caseType: true },
        orderBy: { updatedAt: "desc" },
      });

      if (existing.length > 0) {
        const activeCase = existing.find((c) => c.caseStatus !== "closed");
        const closedCase = existing.find((c) => c.caseStatus === "closed");

        if (activeCase) {
          // Active case exists — block creation, direct to existing case
          return NextResponse.json(
            {
              error: "DUPLICATE",
              message: `${body.donor.firstName} ${body.donor.lastName} already has an active case.`,
              existingCaseId: activeCase.id,
              existingCaseNumber: activeCase.caseNumber,
              duplicates: existing,
            },
            { status: 409 }
          );
        }

        if (closedCase) {
          // Closed case exists — reopen it instead of creating a new one
          await prisma.case.update({
            where: { id: closedCase.id },
            data: { caseStatus: "active" },
          });
          await prisma.statusLog.create({
            data: {
              caseId: closedCase.id,
              oldStatus: "closed",
              newStatus: "active",
              changedBy: "admin",
              note: "Case reopened — new test order needed for this donor",
            },
          });
          return NextResponse.json({
            reopened: true,
            caseId: closedCase.id,
            caseNumber: closedCase.caseNumber,
          });
        }
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

    // Find or create donor contact (avoid duplicates)
    let donorId: string | null = null;
    if (body.donor?.firstName && body.donor?.lastName) {
      let donor = await prisma.contact.findFirst({
        where: {
          firstName: { equals: body.donor.firstName.trim(), mode: "insensitive" },
          lastName: { equals: body.donor.lastName.trim(), mode: "insensitive" },
          contactType: "donor",
        },
      });
      if (donor) {
        // Update with latest info if provided
        const updates: Record<string, string | null> = {};
        if (body.donor.email && body.donor.email !== donor.email) updates.email = body.donor.email;
        if (body.donor.phone && body.donor.phone !== donor.phone) updates.phone = body.donor.phone;
        if (Object.keys(updates).length > 0) {
          donor = await prisma.contact.update({ where: { id: donor.id }, data: updates });
        }
      } else {
        donor = await prisma.contact.create({
          data: {
            contactType: "donor",
            firstName: body.donor.firstName.trim(),
            lastName: body.donor.lastName.trim(),
            email: body.donor.email || null,
            phone: body.donor.phone || null,
            preferredContact: body.donor.phone ? "text" : "email",
            represents: "na",
          },
        });
      }
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
        createdBy: user.email || user.name || "admin",
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

    logAudit({
      userId: user.id,
      action: "case.create",
      resource: "case",
      resourceId: newCase.id,
      metadata: { caseNumber: newCase.caseNumber, caseType: newCase.caseType },
    }).catch((e) => console.error("[cases] audit failed:", e));

    return NextResponse.json(newCase, { status: 201 });
  } catch (error) {
    console.error("Error creating case:", error);
    return NextResponse.json(
      { error: "Failed to create case" },
      { status: 500 }
    );
  }
}
