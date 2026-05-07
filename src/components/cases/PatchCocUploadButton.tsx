"use client";

import { useRef, useState } from "react";
import { apiError } from "@/lib/clientErrors";
import { CocConfirmModal } from "./CocConfirmModal";

// NOTE: This component intentionally duplicates the upload pipeline from
// TestOrderDocuments.tsx (file pick → /api/upload-url → Supabase signed
// URL POST → /api/cases/[id]/documents → 409 handling). The duplication
// is paid for now to keep the patch upload path isolated from the
// non-patch flow. Any behavior change to one upload path (retry logic,
// MIME validation, progress UI, error handling) MUST be mirrored to the
// other until the two are reconciled in a follow-up dedupe ticket.

type Props = {
  caseId: string;
  testOrderId: string;
  uploadType: "working_copy" | "executed";
  onUploadComplete: () => void;
};

type ProcessPayload = {
  storagePath: string;
  fileName: string;
  documentType: string;
  testOrderId: string;
  cocLifecycleStage: "working_copy" | "executed";
  confirmCocUpload?: boolean;
  confirmedCollectionDate?: string;
};

type CocConfirmState = {
  storagePath: string;
  fileName: string;
  parsedSpecimenId: string | null;
  recordSpecimenId: string | null;
  specimenIdMismatch: boolean;
  extractedCollectionDate: string | null;
  dateSource: "text" | "vision" | null;
  payload: ProcessPayload;
};

export function PatchCocUploadButton({
  caseId,
  testOrderId,
  uploadType,
  onUploadComplete,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [cocConfirm, setCocConfirm] = useState<CocConfirmState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const buttonLabel =
    uploadType === "executed" ? "Upload executed CoC" : "Upload working-copy CoC";
  const modalDateLabel =
    uploadType === "executed" ? "Removal date" : "Application date";
  const modalTitle =
    uploadType === "executed" ? "Confirm Removal" : "Confirm Application";

  async function postProcess(payload: ProcessPayload): Promise<boolean> {
    const processRes = await fetch(`/api/cases/${caseId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (processRes.status === 409) {
      const body = await processRes.json().catch(() => null);

      if (body?.error === "coc_needs_confirmation") {
        setCocConfirm({
          storagePath: body.storagePath,
          fileName: payload.fileName,
          parsedSpecimenId: body.parsedSpecimenId ?? null,
          recordSpecimenId: body.recordSpecimenId ?? null,
          specimenIdMismatch: !!body.specimenIdMismatch,
          extractedCollectionDate: body.extractedCollectionDate ?? null,
          dateSource: body.dateSource ?? null,
          payload,
        });
        return false;
      }

      if (body?.error === "patch_coc_invalid_state") {
        alert(body.message || "This patch cannot accept a CoC upload right now.");
        if (body.storagePath) await orphanCleanup(body.storagePath);
        return false;
      }
    }

    if (!processRes.ok) {
      const err = await processRes.json().catch(() => null);
      alert(err?.error || `Processing failed (${processRes.status})`);
      return false;
    }

    onUploadComplete();
    return true;
  }

  async function orphanCleanup(storagePath: string) {
    try {
      await fetch(
        `/api/storage/orphan?caseId=${encodeURIComponent(caseId)}&storagePath=${encodeURIComponent(storagePath)}`,
        { method: "DELETE" },
      );
    } catch (e) {
      console.warn("[PatchCocUploadButton] orphan cleanup failed:", e);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);

    try {
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          documentType: "chain_of_custody",
        }),
      });
      if (!urlRes.ok) throw await apiError(urlRes, "Failed to get upload URL");
      const { uploadUrl, storagePath, headers } = await urlRes.json();

      let uploadRes: Response | null = null;
      let lastError = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: { ...headers, "x-upsert": "true" },
            body: file,
          });
          if (uploadRes.ok) break;
          if (uploadRes.status < 500) {
            const err = await uploadRes.text();
            throw new Error(
              `Storage upload failed: ${uploadRes.status} — ${err.slice(0, 200)}`,
            );
          }
          lastError = `${uploadRes.status} (attempt ${attempt}/3)`;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
        } catch (e) {
          if (attempt === 3) throw e;
          lastError = e instanceof Error ? e.message : String(e);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (!uploadRes?.ok) {
        throw new Error(
          `Storage upload failed after 3 attempts — ${lastError}. Please try again.`,
        );
      }

      const payload: ProcessPayload = {
        storagePath,
        fileName: file.name,
        documentType: "chain_of_custody",
        testOrderId,
        cocLifecycleStage: uploadType === "executed" ? "executed" : "working_copy",
      };
      await postProcess(payload);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleCocConfirm(collectionDate: string) {
    if (!cocConfirm) return;
    const payload: ProcessPayload = {
      ...cocConfirm.payload,
      confirmCocUpload: true,
      confirmedCollectionDate: collectionDate,
    };
    setCocConfirm(null);
    setUploading(true);
    try {
      await postProcess(payload);
    } finally {
      setUploading(false);
    }
  }

  async function handleCocCancel() {
    if (!cocConfirm) return;
    const { storagePath } = cocConfirm;
    setCocConfirm(null);
    await orphanCleanup(storagePath);
  }

  return (
    <>
      <label className="cursor-pointer text-xs px-2.5 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 font-medium inline-flex items-center gap-1">
        {uploading ? "Uploading…" : buttonLabel}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
      </label>
      {cocConfirm && (
        <CocConfirmModal
          fileName={cocConfirm.fileName}
          pdfId={cocConfirm.parsedSpecimenId}
          recordId={cocConfirm.recordSpecimenId}
          specimenIdMismatch={cocConfirm.specimenIdMismatch}
          extractedDate={cocConfirm.extractedCollectionDate}
          dateSource={cocConfirm.dateSource}
          dateLabel={modalDateLabel}
          title={modalTitle}
          onConfirm={handleCocConfirm}
          onCancel={handleCocCancel}
        />
      )}
    </>
  );
}
