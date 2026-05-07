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
import { extractCocCollectionDate } from "@/lib/extractCocCollectionDate";
import { formatChicagoMediumDate } from "@/lib/dateChicago";
import { requireAuth } from "@/lib/auth";
import { specimenIdsMatch } from "@/lib/patchValidation";
import { executePatchCoc } from "@/lib/patchStatus";

// Allow longer execution for AI summary generation on upload
export const maxDuration = 60;

/**
 * Parse a YYYY-MM-DD date-only string into a Date pinned to noon UTC.
 * Per CLAUDE.md: never use `new Date(s + "T12:00:00")` (inherits process TZ)
 * or `new Date(y, m, d)` (inherits process TZ). `Date.UTC` is the only safe
 * construction for a date-only value that should round-trip through
 * America/Chicago formatters.
 */
function parseIsoDateUtcNoon(s: string | null | undefined): Date | null {
  if (!s) return null;
  const match = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(
    Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12, 0, 0)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a Date as YYYY-MM-DD using its UTC components. Used for the
 * result-confirmation 409 envelope so the client renders the same string
 * that the AI extractor produced (no TZ shifts).
 */
function dateToUtcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;
  const actorLabel = user.email || user.name || "admin";

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
    let confirmCocUpload = false;
    let confirmedCollectionDate: string | null = null;
    let confirmResultUpload = false;
    // Informational only per Decision 7: client tells the route what it
    // thinks it's uploading; route validates against PatchDetails state
    // and rejects on mismatch. Only carried by the JSON body — the legacy
    // FormData path doesn't read it (patch flow is JSON-only).
    let clientCocLifecycleStage: string | null = null;

    if (isJson) {
      // NEW MODE: File already uploaded directly to Supabase Storage
      const body = await request.json();
      documentType = body.documentType;
      manualSpecimenId = body.specimenId || null;
      testOrderId = body.testOrderId || null;
      originalFileName = body.fileName;
      storagePath = body.storagePath;
      confirmCocUpload = body.confirmCocUpload === true;
      confirmedCollectionDate =
        typeof body.confirmedCollectionDate === "string"
          ? body.confirmedCollectionDate
          : null;
      confirmResultUpload = body.confirmResultUpload === true;
      clientCocLifecycleStage =
        typeof body.cocLifecycleStage === "string"
          ? body.cocLifecycleStage
          : null;
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
      confirmCocUpload = formData.get("confirmCocUpload") === "true";
      confirmedCollectionDate =
        (formData.get("confirmedCollectionDate") as string | null) || null;
      confirmResultUpload = formData.get("confirmResultUpload") === "true";

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

    // Fetch case + latest order (for filename construction). Note: per the
    // new "one CoC per test order" rule we no longer broadcast writes to
    // every pre-collection order on the case — writes are scoped to the
    // specific testOrderId in the payload.
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

    // ── Patch CoC — working-copy path (Cap 1) ─────────────────────────
    // Branches BEFORE the non-patch CoC logic. Sweat-patch CoCs follow a
    // different commit shape: the confirmed date is the patch's
    // applicationDate (not TestOrder.collectionDate), testStatus does NOT
    // advance (specimen is collected at removal, not application), and
    // the document is tagged via cocLifecycleStage. Returns early on
    // every patch path; non-patch CoCs fall through to the existing
    // logic below.
    if (
      documentType === "chain_of_custody" &&
      ext.toLowerCase() === ".pdf" &&
      testOrderId
    ) {
      const patchOrder = await prisma.testOrder.findUnique({
        where: { id: testOrderId },
        select: {
          id: true,
          specimenType: true,
          specimenId: true,
          testStatus: true,
          patchDetails: {
            select: {
              id: true,
              applicationDate: true,
              removalDate: true,
              workingCopyDocumentId: true,
              executedDocumentId: true,
              cancellationKind: true,
            },
          },
        },
      });

      if (patchOrder?.specimenType === "sweat_patch") {
        const pd = patchOrder.patchDetails;
        if (!pd) {
          return NextResponse.json(
            {
              error: "patch_coc_invalid_state",
              message:
                "This sweat-patch test order is missing setup data and can't accept a CoC upload. Contact the system administrator.",
            },
            { status: 409 },
          );
        }

        // Cancellation precedence — applies to all CoC-upload paths.
        if (pd.cancellationKind) {
          return NextResponse.json(
            {
              error: "patch_coc_invalid_state",
              message:
                "This patch has been cancelled and cannot accept further CoC uploads.",
            },
            { status: 409 },
          );
        }

        // State-inferred dispatch (Option α / Decision 7). Two valid
        // upload windows, plus a fallthrough for anything else.
        const isPendingWorkingCopy =
          pd.applicationDate === null && pd.workingCopyDocumentId === null;
        const isPendingExecuted =
          pd.applicationDate !== null &&
          pd.workingCopyDocumentId !== null &&
          pd.executedDocumentId === null;

        // Strict cocLifecycleStage validation (Decision 7). Client tells
        // the route what it thinks it's uploading; if that disagrees with
        // PatchDetails state, reject so the modal forces a refresh
        // rather than committing the wrong shape.
        if (clientCocLifecycleStage === "executed" && !isPendingExecuted) {
          return NextResponse.json(
            {
              error: "patch_coc_state_mismatch",
              message:
                "This patch is not ready for an executed CoC. Refresh the page and try again.",
            },
            { status: 409 },
          );
        }
        if (
          clientCocLifecycleStage === "working_copy" &&
          !isPendingWorkingCopy
        ) {
          return NextResponse.json(
            {
              error: "patch_coc_state_mismatch",
              message:
                "This patch is not awaiting a working-copy CoC. Refresh the page and try again.",
            },
            { status: 409 },
          );
        }

        if (isPendingWorkingCopy) {
          // ── 3b: Working-copy CoC upload ──────────────────────────
          const [specimenExtraction, dateExtraction] = await Promise.all([
            extractCocSpecimenId(buffer),
            extractCocCollectionDate(buffer),
          ]);
          const parsedSpecimenId = specimenExtraction.specimenId;
          const parsedApplicationDate = dateExtraction.collectionDate;
          const dateSource = dateExtraction.source;
          const referenceSpecimenIdPatch =
            (manualSpecimenId?.trim() || patchOrder.specimenId) ?? null;
          const patchSpecimenIdMismatch =
            !!parsedSpecimenId &&
            !!referenceSpecimenIdPatch &&
            !specimenIdsMatch(parsedSpecimenId, referenceSpecimenIdPatch);

          if (!confirmCocUpload) {
            return NextResponse.json(
              {
                error: "coc_needs_confirmation",
                storagePath,
                parsedSpecimenId,
                recordSpecimenId: referenceSpecimenIdPatch,
                specimenIdMismatch: patchSpecimenIdMismatch,
                extractedCollectionDate: parsedApplicationDate,
                dateSource,
              },
              { status: 409 },
            );
          }

          const confirmedDate = parseIsoDateUtcNoon(confirmedCollectionDate);
          if (!confirmedDate) {
            return NextResponse.json(
              { error: "confirmedCollectionDate is required for CoC uploads" },
              { status: 400 },
            );
          }

          const sourceLabel =
            dateSource === "text"
              ? "AI-extracted from text"
              : dateSource === "vision"
                ? "AI-extracted via Vision"
                : "manually entered";
          const dateLabel = formatChicagoMediumDate(confirmedDate);

          const filenameSpecimenId =
            manualSpecimenId?.trim() ||
            parsedSpecimenId ||
            patchOrder.specimenId ||
            "";
          const donorFirst = donor?.firstName || "Unknown";
          const donorLast = donor?.lastName || "Donor";
          const displayName = buildCcfFilename(
            filenameSpecimenId,
            donorFirst,
            donorLast,
            ext,
          );

          const document = await prisma.$transaction(async (tx) => {
            const doc = await tx.document.create({
              data: {
                caseId,
                testOrderId,
                documentType: "chain_of_custody",
                fileName: displayName,
                filePath: storagePath,
                uploadedBy: actorLabel,
                cocLifecycleStage: "working_copy",
              },
            });

            await tx.patchDetails.update({
              where: { testOrderId },
              data: {
                applicationDate: confirmedDate,
                workingCopyDocumentId: doc.id,
              },
            });

            // testStatus intentionally NOT advanced — patch is on the
            // donor; specimen collection happens at removal.
            await tx.statusLog.create({
              data: {
                caseId,
                testOrderId,
                oldStatus: patchOrder.testStatus,
                newStatus: patchOrder.testStatus,
                changedBy: actorLabel,
                note: `Working-copy CoC uploaded. Application date set to ${dateLabel} (${sourceLabel}, confirmed by ${actorLabel}). Patch is now WORN.`,
              },
            });

            if (patchSpecimenIdMismatch) {
              await tx.statusLog.create({
                data: {
                  caseId,
                  testOrderId,
                  oldStatus: "—",
                  newStatus: "specimen_id_mismatch_ack",
                  changedBy: actorLabel,
                  note: `Working-copy CoC uploaded with acknowledged specimen ID mismatch (PDF: ${parsedSpecimenId}, record: ${referenceSpecimenIdPatch}).`,
                },
              });
            }

            return doc;
          });

          return NextResponse.json(document, { status: 201 });
        } else if (isPendingExecuted) {
          // ── 3c: Executed-copy CoC upload ─────────────────────────
          // Defensive check on the isPendingExecuted invariant. Should
          // be unreachable in normal flow — guards against future
          // refactors of the dispatch booleans silently violating the
          // non-null assumption.
          if (!pd.applicationDate || !pd.workingCopyDocumentId) {
            throw new Error("isPendingExecuted invariant violated");
          }
          // Bind to a local — TypeScript narrows pd.workingCopyDocumentId
          // to non-null after the throw above, but loses that narrowing
          // inside the `prisma.$transaction(async (tx) => {...})` closure
          // below. Capture once here so the archival update doesn't need
          // a non-null assertion.
          const priorWorkingCopyDocumentId = pd.workingCopyDocumentId;
          // The extractor's `collectionDate` field name and the 409
          // envelope's `extractedCollectionDate` key are preserved
          // across both modes; for the executed path the value is
          // semantically a removal date.
          const [specimenExtraction, dateExtraction] = await Promise.all([
            extractCocSpecimenId(buffer),
            extractCocCollectionDate(buffer, "executed"),
          ]);
          const parsedSpecimenId = specimenExtraction.specimenId;
          const parsedRemovalDate = dateExtraction.collectionDate;
          const dateSource = dateExtraction.source;
          const referenceSpecimenIdPatch =
            (manualSpecimenId?.trim() || patchOrder.specimenId) ?? null;
          const patchSpecimenIdMismatch =
            !!parsedSpecimenId &&
            !!referenceSpecimenIdPatch &&
            !specimenIdsMatch(parsedSpecimenId, referenceSpecimenIdPatch);

          if (!confirmCocUpload) {
            return NextResponse.json(
              {
                error: "coc_needs_confirmation",
                storagePath,
                parsedSpecimenId,
                recordSpecimenId: referenceSpecimenIdPatch,
                specimenIdMismatch: patchSpecimenIdMismatch,
                extractedCollectionDate: parsedRemovalDate,
                dateSource,
              },
              { status: 409 },
            );
          }

          const confirmedDate = parseIsoDateUtcNoon(confirmedCollectionDate);
          if (!confirmedDate) {
            return NextResponse.json(
              { error: "confirmedCollectionDate is required for CoC uploads" },
              { status: 400 },
            );
          }

          // Hard reject: removal date cannot precede application date.
          // Same-day allowed. Inline check (Decision 4) — avoids pulling
          // in validatePatchDates' future-date rules; that's a separate
          // scope decision if/when needed.
          const storedApplicationDate = pd.applicationDate;
          if (confirmedDate.getTime() < storedApplicationDate.getTime()) {
            return NextResponse.json(
              {
                error: "removal_before_application",
                message: `Removal date (${formatChicagoMediumDate(confirmedDate)}) cannot be before application date (${formatChicagoMediumDate(storedApplicationDate)}).`,
              },
              { status: 409 },
            );
          }

          const sourceLabel =
            dateSource === "text"
              ? "AI-extracted from text"
              : dateSource === "vision"
                ? "AI-extracted via Vision"
                : "manually entered";
          const dateLabel = formatChicagoMediumDate(confirmedDate);

          const filenameSpecimenId =
            manualSpecimenId?.trim() ||
            parsedSpecimenId ||
            patchOrder.specimenId ||
            "";
          const donorFirst = donor?.firstName || "Unknown";
          const donorLast = donor?.lastName || "Donor";
          const displayName = buildCcfFilename(
            filenameSpecimenId,
            donorFirst,
            donorLast,
            ext,
          );

          const document = await prisma.$transaction(async (tx) => {
            const doc = await tx.document.create({
              data: {
                caseId,
                testOrderId,
                documentType: "chain_of_custody",
                fileName: displayName,
                filePath: storagePath,
                uploadedBy: actorLabel,
                cocLifecycleStage: "executed",
              },
            });

            // Archive the prior working copy (Decision 9). The
            // isPendingExecuted gate already validated that
            // workingCopyDocumentId is non-null.
            await tx.document.update({
              where: { id: priorWorkingCopyDocumentId },
              data: { cocLifecycleStage: "archived" },
            });

            // PatchDetails update + TestOrder.collectionDate mirror via
            // the executePatchCoc helper. Helper sets removalDate,
            // executedDocumentId, workingCopyDocumentId=null, AND
            // mirrors removalDate to TestOrder.collectionDate.
            await executePatchCoc(tx, {
              patchDetailsId: pd.id,
              executedDocumentId: doc.id,
              removalDate: confirmedDate,
            });

            // testStatus intentionally NOT advanced (Decision 1).
            // Lifecycle WORN → AT_LAB is derived by patchLifecycleStatus()
            // automatically from the new executedDocumentId.
            await tx.statusLog.create({
              data: {
                caseId,
                testOrderId,
                oldStatus: patchOrder.testStatus,
                newStatus: patchOrder.testStatus,
                changedBy: actorLabel,
                note: `Executed CoC uploaded. Removal date set to ${dateLabel} (${sourceLabel}, confirmed by ${actorLabel}). Patch is now AT_LAB.`,
              },
            });

            if (patchSpecimenIdMismatch) {
              await tx.statusLog.create({
                data: {
                  caseId,
                  testOrderId,
                  oldStatus: "—",
                  newStatus: "specimen_id_mismatch_ack",
                  changedBy: actorLabel,
                  note: `Executed CoC uploaded with acknowledged specimen ID mismatch (PDF: ${parsedSpecimenId}, record: ${referenceSpecimenIdPatch}).`,
                },
              });
            }

            return doc;
          });

          return NextResponse.json(document, { status: 201 });
        } else {
          // Fallthrough — patch is in a state that doesn't accept any
          // CoC upload right now. Compose a state-specific message.
          let stateMsg: string;
          if (pd.executedDocumentId) {
            stateMsg =
              "An executed chain of custody has already been uploaded for this patch.";
          } else if (pd.workingCopyDocumentId) {
            stateMsg =
              "A working-copy chain of custody has already been uploaded for this patch.";
          } else if (pd.applicationDate) {
            // Orphan state: applicationDate set, no working-copy and
            // no executed document — shouldn't happen in normal flow,
            // but kept for observability if data integrity drifts.
            stateMsg =
              "This patch has an application date but no working-copy CoC on file. Contact the system administrator.";
          } else {
            stateMsg =
              "This patch is not in a state that accepts a chain-of-custody upload.";
          }
          return NextResponse.json(
            { error: "patch_coc_invalid_state", message: stateMsg },
            { status: 409 },
          );
        }
      }
      // Not a sweat patch — fall through to non-patch CoC logic below.
    }

    // ── CoC PDF — confirmation gate ────────────────────────────────────
    // We always require an explicit confirmation before persisting a CoC,
    // because the confirmed collection date IS the source of truth for the
    // test order. Run both extractors in parallel to minimize wait time.
    let parsedCocSpecimenId: string | null = null;
    let parsedCocCollectionDate: string | null = null;
    let cocDateSource: "text" | "vision" | null = null;
    let referenceSpecimenId: string | null = null;
    let specimenIdMismatch = false;

    if (documentType === "chain_of_custody" && ext.toLowerCase() === ".pdf") {
      // Resolve the targeted test order's existing specimen ID for the
      // mismatch check.
      let targetOrderSpecimenId: string | null = latestOrder?.specimenId ?? null;
      if (testOrderId) {
        const target = await prisma.testOrder.findUnique({
          where: { id: testOrderId },
          select: { specimenId: true },
        });
        targetOrderSpecimenId = target?.specimenId ?? null;
      }
      referenceSpecimenId = (manualSpecimenId?.trim() || targetOrderSpecimenId) ?? null;

      const [specimenExtraction, dateExtraction] = await Promise.all([
        extractCocSpecimenId(buffer),
        extractCocCollectionDate(buffer),
      ]);
      parsedCocSpecimenId = specimenExtraction.specimenId;
      parsedCocCollectionDate = dateExtraction.collectionDate;
      cocDateSource = dateExtraction.source;

      specimenIdMismatch =
        !!parsedCocSpecimenId &&
        !!referenceSpecimenId &&
        !specimenIdsMatch(parsedCocSpecimenId, referenceSpecimenId);

      if (!confirmCocUpload) {
        return NextResponse.json(
          {
            error: "coc_needs_confirmation",
            storagePath,
            parsedSpecimenId: parsedCocSpecimenId,
            recordSpecimenId: referenceSpecimenId,
            specimenIdMismatch,
            extractedCollectionDate: parsedCocCollectionDate,
            dateSource: cocDateSource,
          },
          { status: 409 }
        );
      }

      if (!confirmedCollectionDate || !parseIsoDateUtcNoon(confirmedCollectionDate)) {
        return NextResponse.json(
          { error: "confirmedCollectionDate is required for CoC uploads" },
          { status: 400 }
        );
      }
    }

    // ── Result PDF — extract early so the gate has data to check ──────
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
      cocMisclassificationWarning = detectCocMisclassification(
        summary,
        structuredResult
      );
    }

    // ── Result PDF — confirmation gate ─────────────────────────────────
    // Hard requirements before any DB writes:
    //   1) The targeted test order must already have a chain-of-custody
    //      document. Results can only follow CoC. (Bypassable only by
    //      uploading the CoC first — there is no "upload anyway" override.)
    //   2) Critical mismatches (e.g., specimen ID doesn't match) HARD BLOCK.
    //      No override on the server, even if the client tries to set
    //      confirmResultUpload=true.
    //   3) Warning-only mismatches require an explicit confirmResultUpload.
    //   4) Clean match (no findings) — auto-save silently.
    let resultFindings: ReturnType<typeof runLabResultCrosschecks> = [];
    let resultTargetOrder: {
      id: string;
      collectionDate: Date | null;
      specimenId: string | null;
      labAccessionNumber: string | null;
      paymentMethod: string | null;
      testStatus: TestStatus;
    } | null = null;

    if (
      documentType === "result_report" &&
      ext.toLowerCase() === ".pdf" &&
      !cocMisclassificationWarning
    ) {
      // Resolve the target test order. Result uploads should always carry a
      // testOrderId (the upload UI only enables the slot per-order); fall
      // back to the most-recent pre-result order otherwise to preserve the
      // legacy POST surface.
      const candidateOrders = await prisma.testOrder.findMany({
        where: {
          caseId,
          ...(testOrderId
            ? { id: testOrderId }
            : { testStatus: { in: ["specimen_collected", "sent_to_lab"] as TestStatus[] } }),
        },
        orderBy: { updatedAt: "desc" },
        take: testOrderId ? 1 : 1,
        select: {
          id: true,
          collectionDate: true,
          specimenId: true,
          labAccessionNumber: true,
          paymentMethod: true,
          testStatus: true,
        },
      });
      resultTargetOrder = candidateOrders[0] ?? null;

      if (resultTargetOrder) {
        // Hard requirement: a chain-of-custody document must exist for this
        // test order before results can be uploaded.
        const existingCoc = await prisma.document.findFirst({
          where: {
            caseId,
            testOrderId: resultTargetOrder.id,
            documentType: "chain_of_custody",
          },
          select: { id: true },
        });

        if (!existingCoc) {
          return NextResponse.json(
            {
              error: "coc_required",
              storagePath,
              message:
                "Upload the chain of custody for this test order before uploading the lab result.",
            },
            { status: 409 }
          );
        }

        resultFindings = structuredResult
          ? runLabResultCrosschecks(structuredResult, {
              collectionDate: resultTargetOrder.collectionDate,
              specimenId: resultTargetOrder.specimenId,
              labAccessionNumber: resultTargetOrder.labAccessionNumber,
            })
          : [];

        const hasCriticalMismatch = resultFindings.some(
          (f) => f.severity === "critical"
        );

        // Critical mismatch — hard block, no override path on the server.
        if (hasCriticalMismatch) {
          return NextResponse.json(
            {
              error: "result_critical_mismatch",
              storagePath,
              extracted: {
                specimenId: structuredResult?.labSpecimenId ?? null,
                collectionDate: structuredResult?.reportedCollectionDate ?? null,
              },
              order: {
                specimenId: resultTargetOrder.specimenId,
                collectionDate: resultTargetOrder.collectionDate
                  ? dateToUtcDateKey(resultTargetOrder.collectionDate)
                  : null,
              },
              findings: resultFindings,
            },
            { status: 409 }
          );
        }

        // Warning-only mismatches — require explicit confirmation.
        if (resultFindings.length > 0 && !confirmResultUpload) {
          return NextResponse.json(
            {
              error: "result_needs_confirmation",
              storagePath,
              extracted: {
                specimenId: structuredResult?.labSpecimenId ?? null,
                collectionDate: structuredResult?.reportedCollectionDate ?? null,
              },
              order: {
                specimenId: resultTargetOrder.specimenId,
                collectionDate: resultTargetOrder.collectionDate
                  ? dateToUtcDateKey(resultTargetOrder.collectionDate)
                  : null,
              },
              findings: resultFindings,
            },
            { status: 409 }
          );
        }
        // Else: clean match (or warnings already confirmed) — fall through.
      }
    }

    // === All gates passed — commit DB writes from here on ==============

    // Build smart file name based on document type
    const collectionDateForName = parseIsoDateUtcNoon(confirmedCollectionDate)
      ?? latestOrder?.collectionDate
      ?? new Date();
    const collectionDateStr = collectionDateForName
      .toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "2-digit",
        timeZone: "America/Chicago",
      })
      .replace(/\//g, ".");

    let displayName = originalFileName;
    if (documentType === "result_report" && donor) {
      displayName = `${donor.firstName} ${donor.lastName} Results ${collectionDateStr}${ext}`;
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

    // Create document record
    const document = await prisma.document.create({
      data: {
        caseId,
        testOrderId: testOrderId || null,
        documentType: documentType as "court_order" | "chain_of_custody" | "result_report" | "invoice" | "agreement" | "correspondence" | "other",
        fileName: displayName,
        filePath: storagePath,
        uploadedBy: actorLabel,
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
        changedBy: actorLabel,
        note: `Uploaded ${documentType.replace("_", " ")}: ${originalFileName}`,
      },
    });

    // ── CoC commit: scope writes to the SINGLE targeted test order ────
    // Per the "one CoC per test order" rule we no longer loop over every
    // pre-collection order on the case. The collection date confirmed in
    // the modal is the source of truth and is written here; manual entry
    // in EditTestOrderModal remains as an emergency fallback.
    if (documentType === "chain_of_custody") {
      const confirmedDate = parseIsoDateUtcNoon(confirmedCollectionDate);

      const targetOrderId =
        testOrderId ??
        (await prisma.testOrder
          .findFirst({
            where: {
              caseId,
              testStatus: {
                in: ["order_created", "awaiting_payment", "payment_received"] as TestStatus[],
              },
            },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          })
          .then((o) => o?.id ?? null));

      if (targetOrderId && confirmedDate) {
        const order = await prisma.testOrder.findUnique({
          where: { id: targetOrderId },
          select: { id: true, testStatus: true, specimenId: true },
        });
        if (order) {
          const preCollection: TestStatus[] = [
            "order_created",
            "awaiting_payment",
            "payment_received",
          ];
          const advancing = preCollection.includes(order.testStatus);

          await prisma.testOrder.update({
            where: { id: order.id },
            data: {
              collectionDate: confirmedDate,
              ...(advancing ? { testStatus: "specimen_collected" } : {}),
              ...(manualSpecimenId && !order.specimenId
                ? { specimenId: manualSpecimenId }
                : {}),
            },
          });

          const sourceLabel =
            cocDateSource === "text"
              ? "AI-extracted from text"
              : cocDateSource === "vision"
                ? "AI-extracted via Vision"
                : "manually entered";
          const dateLabel = formatChicagoMediumDate(confirmedDate);

          if (advancing) {
            await prisma.statusLog.create({
              data: {
                caseId,
                testOrderId: order.id,
                oldStatus: order.testStatus,
                newStatus: "specimen_collected",
                changedBy: actorLabel,
                note: `Auto-advanced: chain of custody uploaded. Collection date set to ${dateLabel} (${sourceLabel}, confirmed by ${actorLabel}).`,
              },
            });
          } else {
            await prisma.statusLog.create({
              data: {
                caseId,
                testOrderId: order.id,
                oldStatus: order.testStatus,
                newStatus: order.testStatus,
                changedBy: actorLabel,
                note: `Chain of custody uploaded. Collection date set to ${dateLabel} (${sourceLabel}, confirmed by ${actorLabel}).`,
              },
            });
          }

          if (specimenIdMismatch) {
            await prisma.statusLog.create({
              data: {
                caseId,
                testOrderId: order.id,
                oldStatus: "—",
                newStatus: "specimen_id_mismatch_ack",
                changedBy: actorLabel,
                note: `CoC uploaded with acknowledged specimen ID mismatch (PDF: ${parsedCocSpecimenId}, record: ${referenceSpecimenId}).`,
              },
            });
          }
        }
      }
    }

    // ── Result commit: scope to the single targeted test order ────────
    if (
      documentType === "result_report" &&
      !cocMisclassificationWarning &&
      resultTargetOrder
    ) {
      const order = resultTargetOrder;
      const isPaid =
        !!order.paymentMethod && order.paymentMethod !== "invoiced";
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
          newStatus,
          changedBy: actorLabel,
          note: isPaid
            ? "Auto-advanced: lab results uploaded (paid)"
            : "Auto-held: lab results uploaded but payment outstanding",
        },
      });

      // LabResult row
      await prisma.labResult.create({
        data: {
          testOrderId: order.id,
          documentId: document.id,
          source: "pdf_upload",
          parserVersion: LAB_RESULT_PARSER_VERSION,
          overallStatus: (structuredResult?.overallStatus ?? "unknown") as LabResultStatus,
          reportedCollectionDate: parseIsoDateUtcNoon(structuredResult?.reportedCollectionDate),
          receivedAtLab: parseIsoDateUtcNoon(structuredResult?.receivedAtLab),
          reportDate: parseIsoDateUtcNoon(structuredResult?.reportDate),
          mroVerificationDate: parseIsoDateUtcNoon(structuredResult?.mroVerificationDate),
          labReportNumber: structuredResult?.labReportNumber ?? null,
          labSpecimenId: structuredResult?.labSpecimenId ?? null,
          labName: structuredResult?.labName ?? null,
          analytes: structuredResult?.analytes ?? [],
          specimenValidity: structuredResult?.specimenValidity ?? undefined,
          mismatches: resultFindings,
          rawSummary: extractedData?.summary ?? null,
        },
      });

      // Audit: explicit human acknowledgment when crosschecks raised
      // (warning-only) findings and staff confirmed via the modal.
      if (resultFindings.length > 0) {
        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId: order.id,
            oldStatus: newStatus,
            newStatus: "needs_review",
            changedBy: actorLabel,
            note:
              `Lab result cross-check flagged ${resultFindings.length} mismatch${resultFindings.length === 1 ? "" : "es"}: ` +
              resultFindings.map((f) => `${f.severity.toUpperCase()} ${f.type} — ${f.message}`).join(" | "),
          },
        });
        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId: order.id,
            oldStatus: "—",
            newStatus: "result_upload_confirmed",
            changedBy: actorLabel,
            note: `Lab result upload confirmed by ${actorLabel} despite warning-level mismatches.`,
          },
        });
      }

      // Reopen case if it was closed
      const currentCase = await prisma.case.findUnique({
        where: { id: caseId },
        select: { caseStatus: true },
      });
      if (currentCase?.caseStatus === "closed") {
        await prisma.case.update({
          where: { id: caseId },
          data: { caseStatus: "active" },
        });
        await prisma.statusLog.create({
          data: {
            caseId,
            oldStatus: "closed",
            newStatus: "active",
            changedBy: actorLabel,
            note: "Auto-reopened: new lab results uploaded on closed case",
          },
        });
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
          changedBy: actorLabel,
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
