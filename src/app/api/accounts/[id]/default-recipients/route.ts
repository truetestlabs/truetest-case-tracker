import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounts/[id]/default-recipients
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const recipients = await prisma.accountDefaultRecipient.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(recipients);
  } catch (err) {
    console.error("[default-recipients GET]", err);
    return NextResponse.json({ error: "Failed to load recipients" }, { status: 500 });
  }
}

// POST /api/accounts/[id]/default-recipients
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    const body = await req.json();
    const recipient = await prisma.accountDefaultRecipient.create({
      data: {
        accountId: id,
        firstName: body.firstName?.trim() || "",
        lastName: body.lastName?.trim() || "",
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        role: body.role || "evaluator",
        receivesResults: body.receivesResults ?? true,
        receivesStatus: body.receivesStatus ?? false,
        receivesInvoices: body.receivesInvoices ?? false,
        canOrderTests: body.canOrderTests ?? false,
      },
    });
    return NextResponse.json(recipient, { status: 201 });
  } catch (err) {
    console.error("[default-recipients POST]", err);
    return NextResponse.json({ error: "Failed to create recipient" }, { status: 500 });
  }
}

// DELETE /api/accounts/[id]/default-recipients?recipientId=xxx
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response;

  const { id } = await params;
  const recipientId = new URL(req.url).searchParams.get("recipientId");
  if (!recipientId) {
    return NextResponse.json({ error: "recipientId required" }, { status: 400 });
  }
  try {
    await prisma.accountDefaultRecipient.deleteMany({
      where: { id: recipientId, accountId: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[default-recipients DELETE]", err);
    return NextResponse.json({ error: "Failed to delete recipient" }, { status: 500 });
  }
}
