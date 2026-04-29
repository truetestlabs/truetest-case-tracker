"use client";

import { useState, useRef } from "react";
import { apiError } from "@/lib/clientErrors";
import { CocConfirmModal } from "./CocConfirmModal";
import { ResultConfirmModal } from "./ResultConfirmModal";
import type { MismatchFinding } from "@/lib/labResultCrosscheck";

type Doc = {
  id: string;
  documentType: string;
  fileName: string;
  uploadedAt: string;
};

type Props = {
  caseId: string;
  testOrderId: string;
  documents: Doc[];
  onUpdated: () => void;
};

const DOC_SLOTS = [
  { type: "chain_of_custody", label: "COC", icon: "🔗" },
  { type: "result_report", label: "Results", icon: "🧪" },
  { type: "correspondence", label: "MRO", icon: "👨‍⚕️" },
];

type ProcessPayload = {
  storagePath: string;
  fileName: string;
  documentType: string;
  testOrderId: string;
  specimenId?: string;
  confirmCocUpload?: boolean;
  confirmedCollectionDate?: string;
  confirmResultUpload?: boolean;
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

type ResultConfirmState = {
  storagePath: string;
  fileName: string;
  extracted: { specimenId: string | null; collectionDate: string | null };
  order: { specimenId: string | null; collectionDate: string | null };
  findings: MismatchFinding[];
  hasCriticalMismatch: boolean;
  payload: ProcessPayload;
};

export function TestOrderDocuments({ caseId, testOrderId, documents, onUpdated }: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [cocConfirm, setCocConfirm] = useState<CocConfirmState | null>(null);
  const [resultConfirm, setResultConfirm] = useState<ResultConfirmState | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // POST step only — used both for the initial upload and for the
  // re-POST after the user confirms via the CoC or Result modal.
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

      if (
        body?.error === "result_needs_confirmation" ||
        body?.error === "result_critical_mismatch"
      ) {
        setResultConfirm({
          storagePath: body.storagePath,
          fileName: payload.fileName,
          extracted: body.extracted,
          order: body.order,
          findings: body.findings ?? [],
          hasCriticalMismatch: body.error === "result_critical_mismatch",
          payload,
        });
        return false;
      }

      if (body?.error === "coc_required") {
        // Hard block — tell the user, then clean up the orphaned upload.
        alert(body.message || "Upload chain of custody first.");
        if (body.storagePath) await orphanCleanup(body.storagePath);
        return false;
      }
    }

    if (!processRes.ok) {
      const err = await processRes.json().catch(() => null);
      alert(err?.error || `Processing failed (${processRes.status})`);
      return false;
    }

    // Surface the COC-misclassification warning if the server set one.
    try {
      const body = await processRes.json();
      if (body?.warning) {
        alert(`⚠ Upload saved with a warning:\n\n${body.warning}`);
      }
    } catch { /* not JSON — skip */ }
    onUpdated();
    return true;
  }

  async function orphanCleanup(storagePath: string) {
    try {
      await fetch(
        `/api/storage/orphan?caseId=${encodeURIComponent(caseId)}&storagePath=${encodeURIComponent(storagePath)}`,
        { method: "DELETE" }
      );
    } catch (e) {
      console.warn("[TestOrderDocuments] orphan cleanup failed:", e);
    }
  }

  async function uploadFile(file: File, docType: string) {
    setUploading(docType);

    try {
      // Step 1: Get a pre-authorized Supabase upload URL
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          documentType: docType,
        }),
      });
      if (!urlRes.ok) throw await apiError(urlRes, "Failed to get upload URL");
      const { uploadUrl, storagePath, headers } = await urlRes.json();

      // Step 2: Upload file directly to Supabase Storage (bypasses Vercel size limit)
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
            throw new Error(`Storage upload failed: ${uploadRes.status} — ${err.slice(0, 200)}`);
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
        throw new Error(`Storage upload failed after 3 attempts — ${lastError}. Please try again.`);
      }

      // Step 3: Tell the API to process the uploaded file. The server will
      // return a 409 for CoC (always — confirmation modal) and for results
      // with mismatches; clean-match results auto-save here.
      const payload: ProcessPayload = {
        storagePath,
        fileName: file.name,
        documentType: docType,
        testOrderId,
      };
      await postProcess(payload);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
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
    setUploading(payload.documentType);
    try {
      await postProcess(payload);
    } finally {
      setUploading(null);
    }
  }

  async function handleCocCancel() {
    if (!cocConfirm) return;
    const { storagePath } = cocConfirm;
    setCocConfirm(null);
    await orphanCleanup(storagePath);
  }

  async function handleResultConfirm() {
    if (!resultConfirm) return;
    if (resultConfirm.hasCriticalMismatch) return; // server blocks; no-op
    const payload: ProcessPayload = {
      ...resultConfirm.payload,
      confirmResultUpload: true,
    };
    setResultConfirm(null);
    setUploading(payload.documentType);
    try {
      await postProcess(payload);
    } finally {
      setUploading(null);
    }
  }

  async function handleResultCancel() {
    if (!resultConfirm) return;
    const { storagePath } = resultConfirm;
    setResultConfirm(null);
    await orphanCleanup(storagePath);
  }

  function handleDownload(docId: string) {
    window.open(`/api/cases/${caseId}/documents/download?documentId=${docId}`, "_blank");
  }

  async function handleDelete(docId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/cases/${caseId}/documents?documentId=${docId}`, { method: "DELETE" });
      if (res.ok) onUpdated();
      else alert("Failed to delete");
    } catch { alert("Failed to delete"); }
  }

  return (
    <div className="mt-2 space-y-1">
      {DOC_SLOTS.map((slot) => {
        const doc = documents.find((d) => d.documentType === slot.type);
        const isUploading = uploading === slot.type;

        return (
          <div key={slot.type} className={`flex items-center gap-2 text-xs rounded-md px-1.5 py-1 ${doc ? "bg-green-50" : ""}`}>
            <span className="w-5 text-center">{doc ? "✅" : slot.icon}</span>
            <span className={`w-14 flex-shrink-0 font-medium ${doc ? "text-green-700" : "text-gray-500"}`}>{slot.label}:</span>

            {doc ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <span className="text-green-800 font-medium truncate flex-1">{doc.fileName}</span>
                <button
                  onClick={() => handleDownload(doc.id)}
                  className="text-blue-500 hover:text-blue-700 flex-shrink-0 px-1"
                  title="Download"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button
                  onClick={() => handleDelete(doc.id, doc.fileName)}
                  className="text-red-400 hover:text-red-600 flex-shrink-0 px-1"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-1">
                <span className="text-gray-400 italic">none</span>
                <label className="cursor-pointer text-blue-500 hover:text-blue-700 font-medium flex-shrink-0">
                  + Upload
                  <input
                    ref={(el) => { fileRefs.current[slot.type] = el; }}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(f, slot.type);
                      e.target.value = "";
                    }}
                  />
                </label>
                {isUploading && <span className="text-gray-400">uploading...</span>}
              </div>
            )}
          </div>
        );
      })}

      {cocConfirm && (
        <CocConfirmModal
          fileName={cocConfirm.fileName}
          pdfId={cocConfirm.parsedSpecimenId}
          recordId={cocConfirm.recordSpecimenId}
          specimenIdMismatch={cocConfirm.specimenIdMismatch}
          extractedDate={cocConfirm.extractedCollectionDate}
          dateSource={cocConfirm.dateSource}
          onConfirm={handleCocConfirm}
          onCancel={handleCocCancel}
        />
      )}

      {resultConfirm && (
        <ResultConfirmModal
          fileName={resultConfirm.fileName}
          extracted={resultConfirm.extracted}
          order={resultConfirm.order}
          findings={resultConfirm.findings}
          hasCriticalMismatch={resultConfirm.hasCriticalMismatch}
          onConfirm={handleResultConfirm}
          onCancel={handleResultCancel}
        />
      )}
    </div>
  );
}
