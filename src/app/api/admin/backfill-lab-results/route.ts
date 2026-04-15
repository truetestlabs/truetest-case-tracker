/**
 * POST /api/admin/backfill-lab-results
 *
 * One-shot admin endpoint: runs the structured-extraction backfill on every
 * historical Document where documentType is result_report and no LabResult
 * row exists yet. Processes all candidates in parallel (Promise.allSettled)
 * so the request finishes within Vercel's maxDuration budget even for
 * 10–20 PDFs.
 *
 * Idempotent — the filter skips Documents that already have a LabResult,
 * so calling this twice is safe.
 *
 * Remove this file once the backfill is complete and you're comfortable
 * that only new uploads need extraction. Or keep it around for the next
 * time the parser version bumps and you want to re-extract.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";
import {
  extractLabResult,
  extractLabResultFromText,
  LAB_RESULT_PARSER_VERSION,
} from "@/lib/resultExtract";
import { generateResultSummary } from "@/lib/resultSummary";
import { runLabResultCrosschecks } from "@/lib/labResultCrosscheck";
import type { LabResultStatus } from "@prisma/client";

export const maxDuration = 300;

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

type BackfillOutcome = {
  documentId: string;
  fileName: string;
  status: "ok" | "skipped" | "failed";
  reason?: string;
  verdict?: string;
  analyteCount?: number;
  mismatchCount?: number;
};

async function backfillOne(doc: {
  id: string;
  caseId: string;
  testOrderId: string | null;
  fileName: string;
  filePath: string;
  uploadedAt: Date;
  extractedData: unknown;
}): Promise<BackfillOutcome> {
  try {
    // Resolve target test order.
    let testOrderId = doc.testOrderId;
    if (!testOrderId) {
      const fallback = await prisma.testOrder.findFirst({
        where: { caseId: doc.caseId },
        orderBy: [{ updatedAt: "desc" }],
        select: { id: true },
      });
      if (!fallback) {
        return {
          documentId: doc.id,
          fileName: doc.fileName,
          status: "skipped",
          reason: "no test order on case",
        };
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
      return {
        documentId: doc.id,
        fileName: doc.fileName,
        status: "skipped",
        reason: `testOrder ${testOrderId} not found`,
      };
    }

    // Prefer the stored narrative summary if we already have one — parsing
    // structured data out of clean prose is dramatically more reliable than
    // parsing it out of a raw PDF. Only fall through to downloading the
    // PDF if we need to generate a summary OR run the PDF-direct fallback.
    let summary = (doc.extractedData as { summary?: string } | null)?.summary ?? null;
    let structured = null;

    if (summary) {
      structured = await extractLabResultFromText(summary);
    }

    // If we have no summary or the text-based extractor returned nothing
    // useful, download the PDF and run the full orchestrator (which will
    // re-try text-based after generating a fresh summary, then fall back
    // to PDF-direct).
    if (!structured || (structured.analytes?.length ?? 0) === 0) {
      const downloaded = await downloadFile(doc.filePath);
      if (!summary) {
        summary = await generateResultSummary(downloaded.buffer);
      }
      structured = await extractLabResult({
        pdfBuffer: downloaded.buffer,
        summaryText: summary,
      });
    }

    const findings = structured
      ? runLabResultCrosschecks(structured, {
          collectionDate: order.collectionDate,
          specimenId: order.specimenId,
          labAccessionNumber: order.labAccessionNumber,
        })
      : [];

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
        rawSummary: summary,
        receivedByUs: doc.uploadedAt,
      },
    });

    return {
      documentId: doc.id,
      fileName: doc.fileName,
      status: "ok",
      verdict: structured?.overallStatus ?? "unknown",
      analyteCount: structured?.analytes?.length ?? 0,
      mismatchCount: findings.length,
    };
  } catch (e) {
    return {
      documentId: doc.id,
      fileName: doc.fileName,
      status: "failed",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  // Only admins can run this — and really, only you. If the role system
  // ever gets stricter, tighten this gate.
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // By default: process Documents that have no LabResult yet.
  // With ?reprocessEmpty=true: ALSO process Documents whose existing
  // LabResult is empty (overallStatus=unknown or zero analytes) — useful
  // after parser version bumps or bug fixes. We delete the old row first
  // so we don't end up with duplicates.
  const url = new URL(request.url);
  const reprocessEmpty = url.searchParams.get("reprocessEmpty") === "true";

  const candidates = await prisma.document.findMany({
    where: {
      documentType: "result_report",
      fileName: { endsWith: ".pdf" },
      ...(reprocessEmpty
        ? {
            OR: [
              { labResults: { none: {} } },
              { labResults: { some: { overallStatus: "unknown" } } },
            ],
          }
        : { labResults: { none: {} } }),
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

  // If reprocessing, nuke the stale empty LabResults for this batch first so
  // backfillOne() can create fresh ones without duplicate constraints.
  if (reprocessEmpty && candidates.length > 0) {
    await prisma.labResult.deleteMany({
      where: {
        documentId: { in: candidates.map((c) => c.id) },
        overallStatus: "unknown",
      },
    });
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      message: "Nothing to backfill. Every result PDF already has a LabResult row.",
      processed: 0,
      results: [],
    });
  }

  // Fire all extractions in parallel. Claude rate limits will happily take
  // 16–20 concurrent requests on any tier we're on; total wall clock is
  // one Claude call, not N of them.
  const settled = await Promise.allSettled(candidates.map(backfillOne));
  const results: BackfillOutcome[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          documentId: candidates[i].id,
          fileName: candidates[i].fileName,
          status: "failed",
          reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        }
  );

  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    message: `Backfill complete. ok=${ok} skipped=${skipped} failed=${failed}`,
    processed: candidates.length,
    summary: { ok, skipped, failed },
    results,
  });
}
