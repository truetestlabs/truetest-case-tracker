import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";
import { extractOrderFields } from "@/lib/extractOrder";
import type { Prisma } from "@prisma/client";

// Claude PDF extraction runs inline (~3-5s for a one-page order form).
// Give the route headroom so a slow extraction doesn't time out.
export const maxDuration = 60;

/**
 * POST /api/monitoring/selections/[id]/documents
 *
 * Staff-only. Attaches an already-uploaded Supabase Storage object as a
 * `monitoring_order` document on a RandomSelection. The file itself is
 * uploaded directly by the browser via the presigned URL flow
 * (/api/upload-url); this endpoint records the metadata, the FK, and
 * runs Claude Vision to extract the order fields that the donor portal
 * surfaces at 4 AM CT on selection day.
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

  // Extract fields inline. extractOrderFields never throws — on failure it
  // returns all-null fields and we persist those so the donor can still
  // download the raw PDF at unlock time.
  let extractedData: Awaited<ReturnType<typeof extractOrderFields>> | null = null;
  try {
    const { buffer } = await downloadFile(storagePath);
    extractedData = await extractOrderFields(buffer);
    await prisma.document.update({
      where: { id: doc.id },
      data: { extractedData: extractedData as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error("[selections/documents] extraction persist failed:", err);
  }

  return NextResponse.json({
    ok: true,
    documentId: doc.id,
    extractedData,
  });
}
