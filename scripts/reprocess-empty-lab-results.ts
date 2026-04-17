/**
 * Reprocess empty LabResult rows (overallStatus=unknown) using the v2
 * text-based extractor. Uses only the stored narrative summary from
 * Document.extractedData — no Supabase download required — so this runs
 * locally against the ANTHROPIC_API_KEY in .env without needing
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * Rows whose Document has NO stored summary are skipped (those are the
 * local-disk edge cases we agreed to ignore).
 *
 * Flow per row:
 *   1. Delete the stale empty LabResult.
 *   2. Run extractLabResultFromText on the stored summary.
 *   3. Run cross-checks against the TestOrder.
 *   4. Create a fresh LabResult.
 */
import { prisma } from "@/lib/prisma";
import {
  extractLabResultFromText,
  LAB_RESULT_PARSER_VERSION,
} from "@/lib/resultExtract";
import { runLabResultCrosschecks } from "@/lib/labResultCrosscheck";
import type { LabResultStatus } from "@prisma/client";

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
    12,
    0,
    0
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  // Candidates: Documents that either have no LabResult at all OR have one
  // with overallStatus=unknown. Same filter the admin endpoint uses.
  const candidates = await prisma.document.findMany({
    where: {
      documentType: "result_report",
      fileName: { endsWith: ".pdf" },
      OR: [
        { labResults: { none: {} } },
        { labResults: { some: { overallStatus: "unknown" } } },
      ],
    },
    select: {
      id: true,
      caseId: true,
      testOrderId: true,
      fileName: true,
      uploadedAt: true,
      extractedData: true,
      labResults: {
        where: { overallStatus: "unknown" },
        select: { id: true },
      },
    },
  });

  console.log(`${candidates.length} candidates.\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const prefix = `[${i + 1}/${candidates.length}]`;
    console.log(`${prefix} ${doc.fileName}`);

    const summary =
      (doc.extractedData as { summary?: string } | null)?.summary ?? null;

    if (!summary) {
      console.log(`${prefix}   SKIP — no stored summary (local-disk edge case)`);
      skipped++;
      continue;
    }

    try {
      // Resolve target test order.
      let testOrderId = doc.testOrderId;
      if (!testOrderId) {
        const fb = await prisma.testOrder.findFirst({
          where: { caseId: doc.caseId },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
        if (!fb) {
          console.log(`${prefix}   SKIP — no test order on case`);
          skipped++;
          continue;
        }
        testOrderId = fb.id;
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
        console.log(`${prefix}   SKIP — testOrder not found`);
        skipped++;
        continue;
      }

      // Delete the stale empty LabResult(s) for this Document.
      if (doc.labResults.length > 0) {
        await prisma.labResult.deleteMany({
          where: { id: { in: doc.labResults.map((l) => l.id) } },
        });
        console.log(`${prefix}   deleted ${doc.labResults.length} stale row(s)`);
      }

      // Run the new text-based extractor.
      const structured = await extractLabResultFromText(summary);
      if (!structured || (structured.analytes?.length ?? 0) === 0) {
        console.log(`${prefix}   FAIL — extractor returned empty analytes on clean summary`);
        failed++;
        continue;
      }

      const findings = runLabResultCrosschecks(structured, {
        collectionDate: order.collectionDate,
        specimenId: order.specimenId,
        labAccessionNumber: order.labAccessionNumber,
      });

      await prisma.labResult.create({
        data: {
          testOrderId: order.id,
          documentId: doc.id,
          source: "pdf_upload",
          parserVersion: `${LAB_RESULT_PARSER_VERSION} (reprocess)`,
          overallStatus: (structured.overallStatus ?? "unknown") as LabResultStatus,
          reportedCollectionDate: parseIsoDate(structured.reportedCollectionDate),
          receivedAtLab: parseIsoDate(structured.receivedAtLab),
          reportDate: parseIsoDate(structured.reportDate),
          mroVerificationDate: parseIsoDate(structured.mroVerificationDate),
          labReportNumber: structured.labReportNumber ?? null,
          labSpecimenId: structured.labSpecimenId ?? null,
          labName: structured.labName ?? null,
          analytes: structured.analytes ?? [],
          specimenValidity: structured.specimenValidity ?? undefined,
          mismatches: findings,
          rawSummary: summary,
          receivedByUs: doc.uploadedAt,
        },
      });

      console.log(
        `${prefix}   OK — verdict=${structured.overallStatus} analytes=${structured.analytes.length} mismatches=${findings.length}`
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
