import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";
import archiver from "archiver";
import { PassThrough } from "stream";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId");
  const downloadAll = searchParams.get("all") === "true";
  const typeFilter = searchParams.get("type");

  try {
    // Single document download
    if (documentId) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc || doc.caseId !== caseId) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      const { buffer: fileBuffer, contentType } = await downloadFile(doc.filePath);

      return new NextResponse(new Uint8Array(fileBuffer), {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${doc.fileName}"`,
          "Content-Length": fileBuffer.length.toString(),
        },
      });
    }

    // Download all (optionally filtered by type) as zip
    if (downloadAll || typeFilter) {
      const documents = await prisma.document.findMany({
        where: {
          caseId,
          ...(typeFilter ? { documentType: typeFilter as "court_order" | "chain_of_custody" | "result_report" | "invoice" | "agreement" | "correspondence" | "other" } : {}),
        },
        orderBy: { uploadedAt: "asc" },
      });

      if (documents.length === 0) {
        return NextResponse.json({ error: "No documents to download" }, { status: 404 });
      }

      const caseData = await prisma.case.findUnique({
        where: { id: caseId },
        select: { caseNumber: true },
      });

      const archive = archiver("zip", { zlib: { level: 5 } });
      const passThrough = new PassThrough();
      archive.pipe(passThrough);

      for (const doc of documents) {
        try {
          const { buffer } = await downloadFile(doc.filePath);
          archive.append(buffer, { name: doc.fileName });
        } catch {
          console.warn(`Skipping missing file: ${doc.filePath}`);
        }
      }

      archive.finalize();

      const chunks: Buffer[] = [];
      for await (const chunk of passThrough) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const zipBuffer = Buffer.concat(chunks);
      const zipName = typeFilter
        ? `${caseData?.caseNumber || "case"}-${typeFilter.replace("_", "-")}.zip`
        : `${caseData?.caseNumber || "case"}-documents.zip`;

      return new NextResponse(zipBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}"`,
          "Content-Length": zipBuffer.length.toString(),
        },
      });
    }

    return NextResponse.json({ error: "Provide documentId, all=true, or type=..." }, { status: 400 });
  } catch (error) {
    console.error("Error downloading document:", error);
    return NextResponse.json({ error: "Failed to download" }, { status: 500 });
  }
}
