/**
 * One-off backfill: for every historical Document where documentType is
 * result_report and NO LabResult row exists yet, download the PDF, run the
 * structured extractor, and create a LabResult row with cross-checks.
 *
 * Idempotent — re-running skips Documents that already have a LabResult.
 * Serial on purpose (one Claude call at a time) to keep the rate-limit
 * footprint predictable.
 *
 * Run with: npx tsx scripts/backfill-lab-results.ts
 */
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";
import {
  extractLabResultStructured,
  LAB_RESULT_PARSER_VERSION,
} from "@/lib/resultExtract";
import { runLabResultCrosschecks } from "@/lib/labResultCrosscheck";
import type { LabResultStatus } from "@prisma/client";

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const match = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(
    parseInt(y, 10),
    parseInt(m, 10) - 1,
    parseInt(d, 10),
    12,
    0,
    0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

async function main() {
  // Pull all candidate documents at once — shouldn't be many.
  const candidates = await prisma.document.findMany({
    where: {
      documentType: "result_report",
      fileName: { endsWith: ".pdf" },
      labResults: { none: {} }, // skip anything already processed
    },
    orderBy: { uploadedAt: "asc" },
    select: {
      id: true,
      caseId: true,
      testOrderId: true,
      fileName: true,
      filePath: true,
      uploadedAt: true,
      extractedData: true,
    },
  });

  console.log(`Found ${candidates.length} result_report PDFs to backfill.\n`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const prefix = `[${i + 1}/${candidates.length}]`;
    console.log(`${prefix} ${doc.fileName}`);

    try {
      // Resolve the target test order. Use the explicit link if the upload
      // set one; otherwise pick the most recent test order on the case that
      // could plausibly be the one this result belongs to (results_received,
      // results_held, sent_to_lab, specimen_collected, or results_released).
      let testOrderId = doc.testOrderId;
      if (!testOrderId) {
        const fallback = await prisma.testOrder.findFirst({
          where: { caseId: doc.caseId },
          orderBy: [{ updatedAt: "desc" }],
          select: { id: true },
        });
        if (!fallback) {
          console.log(`${prefix}   SKIP — no test order on case ${doc.caseId}`);
          skipped++;
          continue;
        }
        testOrderId = fallback.id;
      }

      const order = await prisma.testOrder.findUnique({
        where: { id: testOrderId },
        select: {
          id: true,
          collectionDate: true,
          specimenId: true,
          labAccessionNumber: true,
        },
      });
      if (!order) {
        console.log(`${prefix}   SKIP — testOrder ${testOrderId} not found`);
        skipped++;
        continue;
      }

      // Download the PDF from Supabase Storage.
      const downloaded = await downloadFile(doc.filePath);
      console.log(`${prefix}   downloaded ${downloaded.buffer.length} bytes`);

      // Run the structured extractor.
      const structured = await extractLabResultStructured(downloaded.buffer);
      if (!structured) {
        console.log(`${prefix}   extractor returned null; writing pending row`);
      }

      // Cross-checks against the resolved test order.
      const findings = structured
        ? runLabResultCrosschecks(structured, {
            collectionDate: order.collectionDate,
            specimenId: order.specimenId,
            labAccessionNumber: order.labAccessionNumber,
          })
        : [];

      // Reuse any narrative summary that's already on the Document.
      const existingSummary =
        (doc.extractedData as { summary?: string } | null)?.summary ?? null;

      await prisma.labResult.create({
        data: {
          testOrderId: order.id,
          documentId: doc.id,
          source: "pdf_upload",
          parserVersion: `${LAB_RESULT_PARSER_VERSION} (backfill)`,
          overallStatus: (structured?.overallStatus ?? "unknown") as LabResultStatus,
          reportedCollectionDate: parseIsoDate(structured?.reportedCollectionDate),
          receivedAtLab: parseIsoDate(structured?.receivedAtLab),
          reportDate: parseIsoDate(structured?.reportDate),
          mroVerificationDate: parseIsoDate(structured?.mroVerificationDate),
          labReportNumber: structured?.labReportNumber ?? null,
          labSpecimenId: structured?.labSpecimenId ?? null,
          labName: structured?.labName ?? null,
          analytes: structured?.analytes ?? [],
          specimenValidity: structured?.specimenValidity ?? undefined,
          mismatches: findings,
          rawSummary: existingSummary,
          // Pin receivedByUs to the ORIGINAL upload time so the timeline on
          // the card shows the real date, not right now.
          receivedByUs: doc.uploadedAt,
        },
      });

      console.log(
        `${prefix}   OK — verdict=${structured?.overallStatus ?? "unknown"} · analytes=${structured?.analytes?.length ?? 0} · mismatches=${findings.length}`
      );
      ok++;
    } catch (e) {
      console.error(`${prefix}   FAIL —`, e);
      failed++;
    }
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
