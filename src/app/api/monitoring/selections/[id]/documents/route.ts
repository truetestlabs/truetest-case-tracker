import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

/**
 * POST /api/monitoring/selections/[id]/documents
 *
 * Staff-only. Attaches an already-uploaded Supabase Storage object as a
 * `monitoring_order` document on a RandomSelection. The file itself is
 * uploaded directly by the browser via the presigned URL flow
 * (/api/upload-url); this endpoint only records the metadata and the FK.
 *
 * Body: { storagePath, fileName, notes? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: selectionId } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storagePath?: string; fileName?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { storagePath, fileName, notes } = body;
  if (!storagePath || !fileName) {
    return NextResponse.json({ error: "storagePath and fileName are required" }, { status: 400 });
  }

  // Confirm the selection exists and resolve its case (Document.caseId is NOT NULL).
  const selection = await prisma.randomSelection.findUnique({
    where: { id: selectionId },
    include: { schedule: { select: { caseId: true } } },
  });
  if (!selection) {
    return NextResponse.json({ error: "Selection not found" }, { status: 404 });
  }

  const doc = await prisma.document.create({
    data: {
      caseId: selection.schedule.caseId,
      documentType: "monitoring_order",
      fileName,
      filePath: storagePath,
      uploadedBy: user.name || user.email,
      randomSelectionId: selectionId,
      notes: notes || null,
    },
  });

  return NextResponse.json({ ok: true, documentId: doc.id });
}
