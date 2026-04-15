/**
 * One-off backfill for the 3 Documents whose filePath points to local disk
 * rather than Supabase Storage (legacy pre-migration uploads). The admin
 * endpoint can't reach these because Vercel has no filesystem access to
 * your Mac, so we run it locally with only the Anthropic key in .env —
 * Supabase Storage is not touched.
 *
 * Reads each PDF from disk → runs extractLabResultStructured → cross-checks
 * against the existing TestOrder → creates a LabResult row.
 *
 * Side effect: Document.filePath stays broken (still points to the local
 * path). The Lab Results card will render correctly and the analytes will
 * be visible, but clicking the source PDF link on the card won't download
 * through the tracker until those 3 Documents get re-uploaded via the
 * normal upload flow.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "@/lib/prisma";
import {
  extractLabResultStructured,
  LAB_RESULT_PARSER_VERSION,
} from "@/lib/resultExtract";
import { runLabResultCrosschecks } from "@/lib/labResultCrosscheck";
import type { LabResultStatus } from "@prisma/client";

const PROJECT_ROOT = "/Users/michaelgammel/playground/truetest-case-tracker";

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const ids = [
    "cmngj0plf00157v98ffkltib2",
    "cmnivv8ox0016nu8jyezsnkvs",
    "cmnkg15990001nuhevr6sspzy",
  ];

  const candidates = await prisma.document.findMany({
    where: { id: { in: ids }, labResults: { none: {} } },
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

  console.log(`Processing ${candidates.length} local-disk PDFs...\n`);
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const prefix = `[${i + 1}/${candidates.length}]`;
    console.log(`${prefix} ${doc.fileName}`);

    try {
      // Resolve the file on local disk. The stored filePath is absolute.
      // Fall back to PROJECT_ROOT-relative if the absolute path is missing.
      let absolutePath = doc.filePath;
      if (!absolutePath.startsWith("/")) {
        absolutePath = resolve(PROJECT_ROOT, doc.filePath);
      }
      const buffer = readFileSync(absolutePath);
      console.log(`${prefix}   read ${buffer.length} bytes from disk`);

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
          failed++;
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
        failed++;
        continue;
      }

      const structured = await extractLabResultStructured(buffer);
      const findings = structured
        ? runLabResultCrosschecks(structured, {
            collectionDate: order.collectionDate,
            specimenId: order.specimenId,
            labAccessionNumber: order.labAccessionNumber,
          })
        : [];

      const existingSummary = (doc.extractedData as { summary?: string } | null)?.summary ?? null;

      await prisma.labResult.create({
        data: {
          testOrderId: order.id,
          documentId: doc.id,
          source: "pdf_upload",
          parserVersion: `${LAB_RESULT_PARSER_VERSION} (disk-backfill)`,
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
          receivedByUs: doc.uploadedAt,
        },
      });

      console.log(
        `${prefix}   OK — verdict=${structured?.overallStatus ?? "unknown"} analytes=${structured?.analytes?.length ?? 0} mismatches=${findings.length}`
      );
      ok++;
    } catch (e) {
      console.error(`${prefix}   FAIL —`, e);
      failed++;
    }
  }

  console.log(`\nDone. ok=${ok} failed=${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
