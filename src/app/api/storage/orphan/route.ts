import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/storage/orphan?caseId=X&storagePath=Y
 *
 * Removes a file from Supabase Storage that was uploaded but never attached
 * to a Document row — typically because the CoC specimen-ID mismatch modal
 * was cancelled. Auth-scoped to the caseId so one case can't nuke another
 * case's files: the storagePath must live under `${caseId}/`.
 *
 * Idempotent. Safe to call multiple times with the same path.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get("caseId");
  const storagePath = searchParams.get("storagePath");

  if (!caseId || !storagePath) {
    return NextResponse.json(
      { error: "caseId and storagePath required" },
      { status: 400 }
    );
  }

  // Scope guard: storagePath must be under this caseId's folder.
  if (!storagePath.startsWith(`${caseId}/`)) {
    return NextResponse.json(
      { error: "storagePath does not match caseId scope" },
      { status: 403 }
    );
  }

  // Case must exist — refuses requests for deleted/unknown cases.
  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true },
  });
  if (!caseRecord) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Refuse to delete a file that's attached to a real Document row — that
  // would turn a cleanup request into a silent delete of committed data.
  const attached = await prisma.document.findFirst({
    where: { filePath: storagePath },
    select: { id: true },
  });
  if (attached) {
    return NextResponse.json(
      { error: "File is attached to a Document record — not an orphan" },
      { status: 409 }
    );
  }

  try {
    await deleteFile(storagePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[orphan delete] failed:", error);
    return NextResponse.json(
      { error: "Failed to delete orphan file" },
      { status: 500 }
    );
  }
}
