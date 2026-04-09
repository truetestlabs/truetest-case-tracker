import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TestStatus } from "@prisma/client";
import { claude } from "@/lib/claude";
import { generateResultSummary } from "@/lib/resultSummary";
import { uploadFile } from "@/lib/storage";

// Allow longer execution for AI summary generation on upload
export const maxDuration = 60;

/** Extract specimen ID and collection date from a USDTL chain of custody PDF.
 *  First tries text extraction (works for typed PDFs).
 *  Falls back to Claude Vision for scanned images. */
async function parseCocPdf(buffer: Buffer): Promise<{ controlNumber?: string; collectionDate?: string }> {
  // Try text extraction first (fast, free)
  try {
    // Lazy import to avoid crashing on Vercel if pdf-parse has issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const PDFParseClass = pdfParse.PDFParse || pdfParse.default || pdfParse;
    const uint8 = new Uint8Array(buffer);
    const parser = typeof PDFParseClass === "function" && PDFParseClass.prototype
      ? new PDFParseClass(uint8)
      : null;
    if (!parser) {
      console.warn("[PDF] pdf-parse not available, skipping text extraction");
      throw new Error("pdf-parse not available");
    }
    await parser.load();
    const result = await parser.getText();
    const text: string = result.text || "";

    if (text.trim().length > 50) {
      // Extract control number (specimen ID) — reliably printed, not handwritten
      const controlMatch = text.match(/CONTROL\s*#\s*\n?\s*(\d{5,})/i);
      const controlNumber = controlMatch?.[1];

      // Extract collection date near "Date (Mo./Day/Y"
      const dateMatch = text.match(/Date\s*\(Mo\.?\/?Day\.?\/?Y.*?\)\s*\n?\s*([\d]{1,2}[\/\|][\d]{1,2}[\/\|]?[\d]{2,4})/i);
      let collectionDate: string | undefined;
      if (dateMatch) {
        const raw = dateMatch[1].replace(/\|/g, "/");
        const parts = raw.split("/");
        if (parts.length >= 2) {
          const mo = parts[0];
          const day = parts[1];
          const yr = parts[2] || new Date().getFullYear().toString().slice(-2);
          collectionDate = `${mo}.${day}.${yr}`;
        }
      }

      if (controlNumber || collectionDate) {
        return { controlNumber, collectionDate };
      }
    }
  } catch (e) {
    console.error("COC text parse error:", e);
  }

  // Fallback: Claude Vision for scanned PDFs
  if (!process.env.ANTHROPIC_API_KEY) return {};

  try {
    const base64 = buffer.toString("base64");
    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text: `This is a USDTL drug test chain of custody form. Extract the following printed (not handwritten) fields:
1. Control/Specimen ID number (near "CONTROL #" or "SPECIMEN ID")
2. Collection date (near "Date" in Step 4 or Step 5, formatted as M/D/YY or MM/DD/YYYY)

Reply in this exact format (use "unknown" if not found):
CONTROL: <number>
DATE: <M.D.YY>`,
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "";
    const controlMatch = text.match(/CONTROL:\s*(\d{5,})/i);
    const dateMatch = text.match(/DATE:\s*([\d]{1,2}\.[\d]{1,2}\.[\d]{2,4})/i);

    return {
      controlNumber: controlMatch?.[1],
      collectionDate: dateMatch?.[1],
    };
  } catch (e) {
    console.error("Claude Vision COC parse error:", e);
    return {};
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    // Detect mode: JSON (direct upload already in Supabase) vs FormData (legacy)
    const isJson = request.headers.get("content-type")?.includes("application/json");

    let documentType: string;
    let manualSpecimenId: string | null;
    let testOrderId: string | null;
    let originalFileName: string;
    let buffer: Buffer;
    let storagePath: string;
    let ext: string;

    if (isJson) {
      // NEW MODE: File already uploaded directly to Supabase Storage
      const body = await request.json();
      documentType = body.documentType;
      manualSpecimenId = body.specimenId || null;
      testOrderId = body.testOrderId || null;
      originalFileName = body.fileName;
      storagePath = body.storagePath;
      ext = originalFileName.includes(".") ? "." + originalFileName.split(".").pop() : ".pdf";

      // Download from Supabase to get buffer for parsing/AI summary
      const { downloadFile } = await import("@/lib/storage");
      const downloaded = await downloadFile(storagePath);
      buffer = downloaded.buffer;
    } else {
      // LEGACY MODE: File sent via FormData through Vercel
      const formData = await request.formData();
      const file = formData.get("file") as File;
      documentType = formData.get("documentType") as string;
      manualSpecimenId = formData.get("specimenId") as string | null;
      testOrderId = formData.get("testOrderId") as string | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      originalFileName = file.name;
      ext = file.name.includes(".") ? "." + file.name.split(".").pop() : ".pdf";

      const bytes = await file.arrayBuffer();
      buffer = Buffer.from(bytes);

      // Upload to Supabase Storage (legacy path — file goes through Vercel)
      const timestamp = Date.now();
      storagePath = `${caseId}/${documentType}_${timestamp}_${originalFileName}`;
      const contentType = file.type || "application/octet-stream";
      await uploadFile(storagePath, buffer, contentType);
    }

    // === From here, both modes converge — buffer and storagePath are set ===

    // Fetch case with donor and latest test order for smart file naming
    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        donor: { select: { firstName: true, lastName: true } },
        testOrders: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { labAccessionNumber: true, collectionDate: true },
        },
      },
    });

    const donor = caseData?.donor;
    const latestOrder = caseData?.testOrders[0];
    const collectionDate = latestOrder?.collectionDate
      ? new Date(latestOrder.collectionDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).replace(/\//g, ".")
      : new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).replace(/\//g, ".");

    // Build smart file name based on document type
    let displayName = originalFileName;
    if (documentType === "result_report" && donor) {
      displayName = `${donor.firstName} ${donor.lastName} Results ${collectionDate}${ext}`;
    } else if (documentType === "chain_of_custody") {
      const parsed = ext.toLowerCase() === ".pdf" ? await parseCocPdf(buffer) : {};
      const specimenId = manualSpecimenId || parsed.controlNumber || latestOrder?.labAccessionNumber || "";
      const donorFirst = donor?.firstName || "Unknown";
      const donorLast = donor?.lastName || "Donor";
      const cocDate = parsed.collectionDate || collectionDate;
      displayName = specimenId
        ? `${specimenId} ${donorFirst} ${donorLast} ${cocDate}${ext}`
        : `${donorFirst} ${donorLast} COC ${cocDate}${ext}`;
    }

    // For result reports: generate AI summary from PDF (async, best-effort)
    let extractedData: { summary: string } | null = null;
    if (documentType === "result_report" && ext.toLowerCase() === ".pdf") {
      const summary = await generateResultSummary(buffer);
      if (summary) extractedData = { summary };
    }

    // Create document record
    const document = await prisma.document.create({
      data: {
        caseId,
        testOrderId: testOrderId || null,
        documentType: documentType as "court_order" | "chain_of_custody" | "result_report" | "invoice" | "agreement" | "correspondence" | "other",
        fileName: displayName,
        filePath: storagePath,
        uploadedBy: "admin",
        notes: null,
        ...(extractedData ? { extractedData } : {}),
      },
    });

    // Log it
    await prisma.statusLog.create({
      data: {
        caseId,
        oldStatus: "—",
        newStatus: "document_uploaded",
        changedBy: "admin",
        note: `Uploaded ${documentType.replace("_", " ")}: ${originalFileName}`,
      },
    });

    // Auto-advance test orders when chain of custody is uploaded → specimen_collected
    if (documentType === "chain_of_custody") {
      const preCollectionStatuses = ["order_created", "awaiting_payment", "payment_received"] as TestStatus[];
      const testOrders = await prisma.testOrder.findMany({
        where: {
          caseId,
          testStatus: { in: preCollectionStatuses },
          ...(testOrderId ? { id: testOrderId } : {}), // scope to specific test order if provided
        },
      });

      for (const order of testOrders) {
        await prisma.testOrder.update({
          where: { id: order.id },
          data: {
            testStatus: "specimen_collected",
            collectionDate: new Date(),
            ...(manualSpecimenId && !order.specimenId ? { specimenId: manualSpecimenId } : {}),
          },
        });
        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId: order.id,
            oldStatus: order.testStatus,
            newStatus: "specimen_collected",
            changedBy: "admin",
            note: "Auto-advanced: chain of custody uploaded",
          },
        });
      }

    }

    // Auto-advance test orders when lab results are uploaded
    if (documentType === "result_report") {
      const caseInfo = await prisma.case.findUnique({
        where: { id: caseId },
        select: { isMonitored: true },
      });
      const isMonitored = caseInfo?.isMonitored ?? false;

      const preResultStatuses = ["specimen_collected", "sent_to_lab"] as TestStatus[];
      const testOrders = await prisma.testOrder.findMany({
        where: {
          caseId,
          testStatus: { in: preResultStatuses },
          ...(testOrderId ? { id: testOrderId } : {}),
        },
      });

      for (const order of testOrders) {
        // Auto-route based on payment: paid → results_received, unpaid → results_held
        const isPaid = !!order.paymentMethod && order.paymentMethod !== "invoiced";
        const newStatus = isPaid ? "results_received" : "results_held";
        await prisma.testOrder.update({
          where: { id: order.id },
          data: {
            testStatus: newStatus as TestStatus,
            resultsReceivedDate: new Date(),
          },
        });
        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId: order.id,
            oldStatus: order.testStatus,
            newStatus: newStatus,
            changedBy: "admin",
            note: isPaid
              ? "Auto-advanced: lab results uploaded (paid)"
              : "Auto-held: lab results uploaded but payment outstanding",
          },
        });
      }

      // Reopen case if it was closed (results need review before re-closing)
      if (testOrders.length > 0) {
        const currentCase = await prisma.case.findUnique({ where: { id: caseId }, select: { caseStatus: true } });
        if (currentCase?.caseStatus === "closed") {
          await prisma.case.update({ where: { id: caseId }, data: { caseStatus: "active" } });
          await prisma.statusLog.create({
            data: {
              caseId,
              oldStatus: "closed",
              newStatus: "active",
              changedBy: "admin",
              note: "Auto-reopened: new lab results uploaded on closed case",
            },
          });
        }
      }
    }

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error("Error uploading document:", error);
    const msg = error instanceof Error ? error.message : "Failed to upload document";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get("documentId");

  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  try {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.caseId !== caseId) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await prisma.document.delete({ where: { id: documentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}
