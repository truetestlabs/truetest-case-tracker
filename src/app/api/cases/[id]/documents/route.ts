import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TestStatus } from "@prisma/client";
import { claude } from "@/lib/claude";
import { generateResultSummary } from "@/lib/resultSummary";
import { uploadFile } from "@/lib/storage";

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
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const documentType = formData.get("documentType") as string;
    const manualSpecimenId = formData.get("specimenId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

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
    const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : ".pdf";

    // Read file bytes early — needed for both PDF parsing and saving
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Build smart file name based on document type
    let displayName = file.name;
    if (documentType === "result_report" && donor) {
      displayName = `${donor.firstName} ${donor.lastName} Results ${collectionDate}${ext}`;
    } else if (documentType === "chain_of_custody") {
      // Parse the COC PDF to extract specimen ID and collection date (works for typed PDFs, not scanned)
      const parsed = ext.toLowerCase() === ".pdf" ? await parseCocPdf(buffer) : {};
      // Priority: manual input > PDF parsed > DB accession number
      const specimenId = manualSpecimenId || parsed.controlNumber || latestOrder?.labAccessionNumber || "";
      const donorFirst = donor?.firstName || "Unknown";
      const donorLast = donor?.lastName || "Donor";
      const cocDate = parsed.collectionDate || collectionDate;
      displayName = specimenId
        ? `${specimenId} ${donorFirst} ${donorLast} ${cocDate}${ext}`
        : `${donorFirst} ${donorLast} COC ${cocDate}${ext}`;
    }

    // Upload to Supabase Storage
    const fileName = `${documentType}_${Date.now()}_${displayName}`;
    const storagePath = `${caseId}/${fileName}`;
    const contentType = file.type || "application/octet-stream";
    await uploadFile(storagePath, buffer, contentType);

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
        note: `Uploaded ${documentType.replace("_", " ")}: ${file.name}`,
      },
    });

    // Auto-advance test orders when chain of custody is uploaded → specimen_collected
    if (documentType === "chain_of_custody") {
      const preCollectionStatuses = ["order_created", "awaiting_payment", "payment_received"] as TestStatus[];
      const testOrders = await prisma.testOrder.findMany({
        where: { caseId, testStatus: { in: preCollectionStatuses } },
      });

      for (const order of testOrders) {
        await prisma.testOrder.update({
          where: { id: order.id },
          data: {
            testStatus: "specimen_collected",
            collectionDate: new Date(),
            // Note: paymentReceived is NOT set here — payment is tracked separately
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
        where: { caseId, testStatus: { in: preResultStatuses } },
      });

      for (const order of testOrders) {
        // Always advance to results_received — staff reviews, sends email, then closes
        await prisma.testOrder.update({
          where: { id: order.id },
          data: {
            testStatus: "results_received" as TestStatus,
            resultsReceivedDate: new Date(),
          },
        });
        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId: order.id,
            oldStatus: order.testStatus,
            newStatus: "results_received",
            changedBy: "admin",
            note: "Auto-advanced: lab results uploaded",
          },
        });
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
