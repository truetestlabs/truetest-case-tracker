/**
 * /api/accounts/[id]
 *
 * GET    — account detail with linked cases and contacts
 * PATCH  — update fields (zod-validated partial)
 * DELETE — soft delete (active=false). Blocks hard delete if any Cases
 *          or Contacts still reference the account; returns 409.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { updateAccountSchema, formatZodError } from "@/lib/validation/schemas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const { id } = await params;

  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      primaryContact: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      contacts: {
        orderBy: { lastName: "asc" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          contactType: true,
        },
      },
      cases: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          caseNumber: true,
          caseType: true,
          caseStatus: true,
          isMonitored: true,
          updatedAt: true,
          donor: { select: { firstName: true, lastName: true } },
          _count: { select: { testOrders: true } },
        },
      },
      _count: { select: { cases: true, contacts: true } },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json(account);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error), { status: 400 });
  }
  const body = parsed.data;

  const existing = await prisma.account.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  try {
    // Build the update payload explicitly — only the fields actually present
    // in the parsed body. Prisma distinguishes "undefined" (no change) from
    // "null" (set to null), so we need to map carefully.
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.shortCode !== undefined) data.shortCode = body.shortCode ?? null;
    if (body.type !== undefined) data.type = body.type;
    if (body.primaryContactId !== undefined)
      data.primaryContactId = body.primaryContactId ?? null;
    if (body.address !== undefined) data.address = body.address ?? null;
    if (body.phone !== undefined) data.phone = body.phone ?? null;
    if (body.email !== undefined) data.email = body.email ?? null;
    if (body.website !== undefined) data.website = body.website ?? null;
    if (body.notes !== undefined) data.notes = body.notes ?? null;
    if (body.invoiceGrouping !== undefined) data.invoiceGrouping = body.invoiceGrouping;
    if (body.active !== undefined) data.active = body.active;

    const updated = await prisma.account.update({ where: { id }, data });

    logAudit({
      userId: user.id,
      action: "account.update",
      resource: "account",
      resourceId: id,
      metadata: { name: existing.name, changedFields: Object.keys(data) },
    }).catch((e) => console.error("[accounts/id] audit failed:", e));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating account:", error);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;
  const { id } = await params;

  // Default behavior: soft-delete (active=false). Hard delete only if the
  // caller passes ?hard=true AND there are no references — protects against
  // accidental loss of historical links.
  const { searchParams } = new URL(request.url);
  const hard = searchParams.get("hard") === "true";

  const existing = await prisma.account.findUnique({
    where: { id },
    include: { _count: { select: { cases: true, contacts: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  try {
    if (hard) {
      if (existing._count.cases > 0 || existing._count.contacts > 0) {
        return NextResponse.json(
          {
            error: "Account has references; cannot hard-delete",
            cases: existing._count.cases,
            contacts: existing._count.contacts,
          },
          { status: 409 }
        );
      }
      await prisma.account.delete({ where: { id } });
      logAudit({
        userId: user.id,
        action: "account.delete",
        resource: "account",
        resourceId: id,
        metadata: { name: existing.name, mode: "hard" },
      }).catch((e) => console.error("[accounts/id] audit failed:", e));
      return NextResponse.json({ success: true, deleted: "hard" });
    }

    // Soft delete
    await prisma.account.update({ where: { id }, data: { active: false } });
    logAudit({
      userId: user.id,
      action: "account.deactivate",
      resource: "account",
      resourceId: id,
      metadata: { name: existing.name, mode: "soft" },
    }).catch((e) => console.error("[accounts/id] audit failed:", e));
    return NextResponse.json({ success: true, deleted: "soft" });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
