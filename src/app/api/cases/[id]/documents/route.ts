import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TestStatus, LabResultStatus } from "@prisma/client";
import { generateResultSummary } from "@/lib/resultSummary";
import { extractLabResult, LAB_RESULT_PARSER_VERSION } from "@/lib/resultExtract";
import type { ExtractedLabResult } from "@/lib/resultExtract";
import { runLabResultCrosschecks } from "@/lib/labResultCrosscheck";
import { detectCocMisclassification } from "@/lib/detectCocMisclassification";
import { uploadFile } from "@/lib/storage";
import { buildCcfFilename } from "@/lib/filename";
import { extractCocSpecimenId } from "@/lib/extractCocSpecimenId";

// Allow longer execution for AI summary generation on upload
export const maxDuration = 60;

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
    // When the client re-submits after acknowledging a specimen-ID mismatch
    // modal, it sets this flag. Server skips the mismatch check for this
    // upload and records the ack in the StatusLog.
    let confirmSpecimenMismatch = false;

    if (isJson) {
      // NEW MODE: File already uploaded directly to Supabase Storage
      const body = await request.json();
      documentType = body.documentType;
      manualSpecimenId = body.specimenId || null;
      testOrderId = body.testOrderId || null;
      originalFileName = body.fileName;
      storagePath = body.storagePath;
      confirmSpecimenMismatch = body.confirmSpecimenMismatch === true;
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
      confirmSpecimenMismatch = formData.get("confirmSpecimenMismatch") === "true";

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

    // Fetch case with donor and latest test order for smart file naming.
    // CCF filenames don't embed a date anymore (see buildCcfFilename); we
    // still need `collectionDate` for the legacy result_report filename
    // format below, so we pull it on the latest order.
    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        donor: { select: { firstName: true, lastName: true } },
        testOrders: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            labAccessionNumber: true,
            collectionDate: true,
            specimenId: true,
          },
        },
      },
    });

    const donor = caseData?.donor;
    const latestOrder = caseData?.testOrders[0];
    const collectionDate = latestOrder?.collectionDate
      ? new Date(latestOrder.collectionDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit", timeZone: "America/Chicago" }).replace(/\//g, ".")
      : new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit", timeZone: "America/Chicago" }).replace(/\//g, ".");

    // --- CoC specimen ID validation ---------------------------------------
    // For CCF PDFs: read the printed specimen ID from the "CONTROL #" box and
    // compare to the reference ID (the one the user typed in this upload
    // flow, or the one already on the targeted test order). If they differ
    // and the user has not acknowledged the mismatch, return 409 so the
    // client can show a confirmation modal. The file stays in storage; the
    // client will either re-POST with confirmSpecimenMismatch=true or fire
    // an orphan-cleanup DELETE on cancel.
    //
    // Vision failures (null extraction) → skip validation silently and
    // proceed with the upload; we never block the user on OCR failures.
    let parsedCocSpecimenId: string | null = null;
    let referenceSpecimenId: string | null = null;
    if (documentType === "chain_of_custody" && ext.toLowerCase() === ".pdf") {
      // If the upload targets a specific test order, its specimenId wins
      // over latestOrder.specimenId as the reference. Only query if
      // testOrderId differs from the latest order we already loaded.
      let targetOrderSpecimenId: string | null = latestOrder?.specimenId ?? null;
      if (testOrderId) {
        const target = await prisma.testOrder.findUnique({
          where: { id: testOrderId },
          select: { specimenId: true },
        });
        targetOrderSpecimenId = target?.specimenId ?? null;
      }
      referenceSpecimenId = (manualSpecimenId?.trim() || targetOrderSpecimenId) ?? null;

      const extraction = await extractCocSpecimenId(buffer);
      parsedCocSpecimenId = extraction.specimenId;

      if (
        parsedCocSpecimenId &&
        referenceSpecimenId &&
        parsedCocSpecimenId !== referenceSpecimenId &&
        !confirmSpecimenMismatch
      ) {
        return NextResponse.json(
          {
            error: "specimen_id_mismatch",
            parsedSpecimenId: parsedCocSpecimenId,
            recordSpecimenId: referenceSpecimenId,
            storagePath,
          },
          { status: 409 }
        );
      }
    }

    // Build smart file name based on document type
    let displayName = originalFileName;
    if (documentType === "result_report" && donor) {
      displayName = `${donor.firstName} ${donor.lastName} Results ${collectionDate}${ext}`;
    } else if (documentType === "chain_of_custody") {
      const specimenId =
        manualSpecimenId?.trim() ||
        parsedCocSpecimenId ||
        latestOrder?.specimenId ||
        latestOrder?.labAccessionNumber ||
        "";
      const donorFirst = donor?.firstName || "Unknown";
      const donorLast = donor?.lastName || "Donor";
      displayName = buildCcfFilename(specimenId, donorFirst, donorLast, ext);
    }

    // For result reports: generate the narrative summary first (the human-
    // readable paragraph that feeds the compose-results email), THEN parse
    // structured data out of that summary. Sequential because the structured
    // extractor is dramatically more reliable when fed clean prose than when
    // asked to read the PDF directly — the "read PDF + structure output"
    // combined task empirically fails on ~40% of real lab PDFs.
    let extractedData: { summary: string } | null = null;
    let structuredResult: ExtractedLabResult | null = null;
    let cocMisclassificationWarning: string | null = null;
    if (documentType === "result_report" && ext.toLowerCase() === ".pdf") {
      const summary = await generateResultSummary(buffer);
      if (summary) extractedData = { summary };
      structuredResult = await extractLabResult({
        pdfBuffer: buffer,
        summaryText: summary,
      });
      // Catch COC forms misfiled as result reports before we write a bogus
      // LabResult row + incorrectly advance the test order status. If this
      // fires, we still save the Document (so the user has a record of
      // what they uploaded) but downstream side effects are skipped and
      // the response includes a warning for the client to surface.
      cocMisclassificationWarning = detectCocMisclassification(
        summary,
        structuredResult
      );
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

    // Auto-advance test orders when chain of custody is uploaded → specimen_collected.
    //
    // We deliberately do NOT write `collectionDate` here anymore. The prior
    // Vision-based date extraction misread handwritten dates too often, and
    // the upload-day fallback silently substituted a wrong value when the
    // extraction failed. collectionDate is now populated only by explicit
    // staff entry (EditTestOrderModal) or other authoritative paths.
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
            note: "Auto-advanced: chain of custody uploaded.",
          },
        });
      }

      // If the upload proceeded despite a detected specimen-ID mismatch
      // (user acknowledged via the confirmation modal), record the ack so
      // the provenance is queryable later.
      if (
        confirmSpecimenMismatch &&
        parsedCocSpecimenId &&
        referenceSpecimenId &&
        parsedCocSpecimenId !== referenceSpecimenId
      ) {
        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId: testOrderId || null,
            oldStatus: "—",
            newStatus: "specimen_id_mismatch_ack",
            changedBy: "admin",
            note: `CoC uploaded with acknowledged specimen ID mismatch (PDF: ${parsedCocSpecimenId}, record: ${referenceSpecimenId}).`,
          },
        });
      }
    }

    // Auto-advance test orders when lab results are uploaded.
    // Skip the whole block if the COC-misclassification detector fired —
    // we saved the file, but we don't want to advance status or write a
    // LabResult based on a document that isn't actually a results report.
    if (documentType === "result_report" && !cocMisclassificationWarning) {
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

    // If the COC-misclassification detector fired on a result_report upload,
    // log a StatusLog entry and pass the warning back to the client so the
    // upload UI can surface it as a toast/banner.
    if (cocMisclassificationWarning) {
      await prisma.statusLog.create({
        data: {
          caseId,
          testOrderId: testOrderId || null,
          oldStatus: "—",
          newStatus: "coc_misclassified",
          changedBy: "admin",
          note: `COC misclassified upload flagged: "${document.fileName}". ${cocMisclassificationWarning}`,
        },
      });
    }

    return NextResponse.json(
      cocMisclassificationWarning
        ? { ...document, warning: cocMisclassificationWarning }
        : document,
      { status: 201 }
    );
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
