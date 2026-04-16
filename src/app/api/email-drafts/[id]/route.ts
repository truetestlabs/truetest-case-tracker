import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/** PATCH /api/email-drafts/[id] — edit draft before sending */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { id } = await params;

  try {
    const body = await request.json();
    const draft = await prisma.emailDraft.update({
      where: { id },
      data: {
        ...(body.subject !== undefined && { subject: body.subject }),
        ...(body.body !== undefined && { body: body.body }),
        ...(body.recipients !== undefined && { recipients: body.recipients }),
      },
    });

    return NextResponse.json({ draft });
  } catch (error) {
    console.error("Update email draft error:", error);
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
}

/** DELETE /api/email-drafts/[id] — discard draft without sending */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(_request);
  if (auth.response) return auth.response;

  const { id } = await params;

  try {
    await prisma.emailDraft.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete email draft error:", error);
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  }
}
