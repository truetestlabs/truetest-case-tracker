/**
 * /api/accounts — referring organizations (law firms, counseling
 * practices, evaluator offices, etc.). See Phase 3 Piece 1 for the model
 * and backfill script.
 *
 * GET  /api/accounts?q=...&active=true — list
 * POST /api/accounts                    — create
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createAccountSchema, formatZodError } from "@/lib/validation/schemas";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const activeParam = searchParams.get("active");

  const where: Record<string, unknown> = {};
  if (activeParam === "true") where.active = true;
  if (activeParam === "false") where.active = false;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { shortCode: { contains: q, mode: "insensitive" } },
    ];
  }

  const accounts = await prisma.account.findMany({
    where,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      primaryContact: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      _count: { select: { cases: true, contacts: true } },
    },
  });

  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error), { status: 400 });
  }
  const body = parsed.data;

  try {
    const account = await prisma.account.create({
      data: {
        name: body.name,
        shortCode: body.shortCode ?? null,
        type: body.type ?? "other",
        primaryContactId: body.primaryContactId ?? null,
        address: body.address ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        website: body.website ?? null,
        notes: body.notes ?? null,
        invoiceGrouping: body.invoiceGrouping ?? "per_case",
        active: body.active ?? true,
      },
    });

    logAudit({
      userId: user.id,
      action: "account.create",
      resource: "account",
      resourceId: account.id,
      metadata: { name: account.name, type: account.type },
    }).catch((e) => console.error("[accounts] audit failed:", e));

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    console.error("Error creating account:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
