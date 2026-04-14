import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TestStatus, LabResultStatus } from "@prisma/client";
import { claude } from "@/lib/claude";
import { generateResultSummary } from "@/lib/resultSummary";
import { extractLabResultStructured, LAB_RESULT_PARSER_VERSION } from "@/lib/resultExtract";
import type { ExtractedLabResult } from "@/lib/resultExtract";
import { runLabResultCrosschecks } from "@/lib/labResultCrosscheck";
import { uploadFile } from "@/lib/storage";

// Allow longer execution for AI summary generation on upload
export const maxDuration = 60;

/**
 * Parse a "M.D.YY" / "MM.DD.YYYY" / "M/D/YY" string (as returned by
 * parseCocPdf) into a JavaScript Date. Returns null on bad input, impossible
 * dates, or wildly out-of-range values (>30 days future or >2 years old —
 * those are almost certainly OCR errors, not real collection dates).
 *
 * Uses noon-local time to dodge timezone edge cases around midnight.
 */
function parseCocDateString(s: string | undefined | null): Date | null {
  if (!s) return null;
  const match = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;
  const [, mStr, dStr, yStr] = match;
  let year = parseInt(yStr, 10);
  if (year < 100) year = 2000 + year; // "26" → 2026. Good enough until 2100.
  const month = parseInt(mStr, 10) - 1; // JS months are 0-indexed
  const day = parseInt(dStr, 10);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(year, month, day, 12, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  // Sanity bounds: if the parser reads a garbage date, fall back to upload
  // time rather than writing a ridiculous value to the DB.
  const now = Date.now();
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000;
  const thirtyDaysAhead = now + 30 * 24 * 60 * 60 * 1000;
  if (date.getTime() < twoYearsAgo || date.getTime() > thirtyDaysAhead) return null;
  return date;
}

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

    // Parse the COC PDF ONCE, up front. Both the filename builder below AND
    // the test-order auto-advance block further down need the extracted
    // collection date + control number, and parsing is expensive (text
    // extraction + possible Claude Vision fallback).
    const parsedCoc =
      documentType === "chain_of_custody" && ext.toLowerCase() === ".pdf"
        ? await parseCocPdf(buffer)
        : {};
    const parsedCocDate = parseCocDateString(parsedCoc.collectionDate);

    // Build smart file name based on document type
    let displayName = originalFileName;
    if (documentType === "result_report" && donor) {
      displayName = `${donor.firstName} ${donor.lastName} Results ${collectionDate}${ext}`;
    } else if (documentType === "chain_of_custody") {
      const specimenId = manualSpecimenId || parsedCoc.controlNumber || latestOrder?.labAccessionNumber || "";
      const donorFirst = donor?.firstName || "Unknown";
      const donorLast = donor?.lastName || "Donor";
      const cocDate = parsedCoc.collectionDate || collectionDate;
      displayName = specimenId
        ? `${specimenId} ${donorFirst} ${donorLast} ${cocDate}${ext}`
        : `${donorFirst} ${donorLast} COC ${cocDate}${ext}`;
    }

    // For result reports: run BOTH the existing narrative summary AND the
    // new structured extractor in parallel. The summary is the human-readable
    // email-ready paragraph; the structured data feeds the LabResult row,
    // the date cross-checks, and eventually the UI result cards.
    let extractedData: { summary: string } | null = null;
    let structuredResult: ExtractedLabResult | null = null;
    if (documentType === "result_report" && ext.toLowerCase() === ".pdf") {
      const [summary, structured] = await Promise.all([
        generateResultSummary(buffer),
        extractLabResultStructured(buffer),
      ]);
      if (summary) extractedData = { summary };
      structuredResult = structured;
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

      // Prefer the date printed on the COC; fall back to upload time only if
      // parsing failed or the parsed value was outside the sanity bounds.
      const effectiveCollectionDate = parsedCocDate ?? new Date();
      const usedParsedDate = parsedCocDate !== null;

      for (const order of testOrders) {
        await prisma.testOrder.update({
          where: { id: order.id },
          data: {
            testStatus: "specimen_collected",
            collectionDate: effectiveCollectionDate,
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
            note: usedParsedDate
              ? `Auto-advanced: chain of custody uploaded. Collection date ${effectiveCollectionDate.toLocaleDateString("en-US")} extracted from COC.`
              : "Auto-advanced: chain of custody uploaded. Collection date set to upload time (could not parse date from PDF).",
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

        // ── Create the LabResult row ─────────────────────────────────────
        // We write a row whether or not the structured extractor succeeded:
        // a pending row with no analytes still gives us somewhere to attach
        // the source Document and receivedByUs timestamp, and the UI can
        // show "parser couldn't read this — please review manually".
        const findings = structuredResult
          ? runLabResultCrosschecks(structuredResult, {
              collectionDate: order.collectionDate,
              specimenId: order.specimenId,
              labAccessionNumber: order.labAccessionNumber,
            })
          : [];

        const parseIsoDate = (s: string | null | undefined): Date | null => {
          if (!s) return null;
          const match = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!match) return null;
          const [, y, m, d] = match;
          const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12, 0, 0);
          return Number.isNaN(date.getTime()) ? null : date;
        };

        await prisma.labResult.create({
          data: {
            testOrderId: order.id,
            documentId: document.id,
            source: "pdf_upload",
            parserVersion: LAB_RESULT_PARSER_VERSION,
            overallStatus: (structuredResult?.overallStatus ?? "unknown") as LabResultStatus,
            reportedCollectionDate: parseIsoDate(structuredResult?.reportedCollectionDate),
            receivedAtLab: parseIsoDate(structuredResult?.receivedAtLab),
            reportDate: parseIsoDate(structuredResult?.reportDate),
            mroVerificationDate: parseIsoDate(structuredResult?.mroVerificationDate),
            labReportNumber: structuredResult?.labReportNumber ?? null,
            labSpecimenId: structuredResult?.labSpecimenId ?? null,
            labName: structuredResult?.labName ?? null,
            analytes: structuredResult?.analytes ?? [],
            specimenValidity: structuredResult?.specimenValidity ?? undefined,
            mismatches: findings,
            rawSummary: extractedData?.summary ?? null,
          },
        });

        if (findings.length > 0) {
          await prisma.statusLog.create({
            data: {
              caseId,
              testOrderId: order.id,
              oldStatus: newStatus,
              newStatus: "needs_review",
              changedBy: "admin",
              note:
                `Lab result cross-check flagged ${findings.length} mismatch${findings.length === 1 ? "" : "es"}: ` +
                findings.map((f) => `${f.severity.toUpperCase()} ${f.type} — ${f.message}`).join(" | "),
            },
          });
        }
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
