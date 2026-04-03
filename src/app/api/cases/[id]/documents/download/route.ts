import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFile, stat } from "fs/promises";
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

  try {
    // Single document download
    if (documentId) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc || doc.caseId !== caseId) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      // Check file exists
      try {
        await stat(doc.filePath);
      } catch {
        return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
      }

      const fileBuffer = await readFile(doc.filePath);
      const fileName = doc.fileName;
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const contentType =
        ext === "pdf" ? "application/pdf"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : ext === "doc" ? "application/msword"
        : ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";

      return new NextResponse(fileBuffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": fileBuffer.length.toString(),
        },
      });
    }

    // Download all documents as zip
    if (downloadAll) {
      const documents = await prisma.document.findMany({
        where: { caseId },
        orderBy: { uploadedAt: "asc" },
      });

      if (documents.length === 0) {
        return NextResponse.json({ error: "No documents to download" }, { status: 404 });
      }

      // Get case number for zip filename
      const caseData = await prisma.case.findUnique({
        where: { id: caseId },
        select: { caseNumber: true },
      });

      const archive = archiver("zip", { zlib: { level: 5 } });
      const passThrough = new PassThrough();
      archive.pipe(passThrough);

      for (const doc of documents) {
        try {
          await stat(doc.filePath);
          archive.file(doc.filePath, { name: doc.fileName });
        } catch {
          // Skip files that don't exist on disk
          console.warn(`Skipping missing file: ${doc.filePath}`);
        }
      }

      archive.finalize();

      // Collect stream into buffer
      const chunks: Buffer[] = [];
      for await (const chunk of passThrough) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const zipBuffer = Buffer.concat(chunks);
      const zipName = `${caseData?.caseNumber || "case"}-documents.zip`;

      return new NextResponse(zipBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}"`,
          "Content-Length": zipBuffer.length.toString(),
        },
      });
    }

    return NextResponse.json({ error: "Provide documentId or all=true" }, { status: 400 });
  } catch (error) {
    console.error("Error downloading document:", error);
    return NextResponse.json({ error: "Failed to download" }, { status: 500 });
  }
}
