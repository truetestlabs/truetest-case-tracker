"use client";

import { useState, useRef } from "react";
import { apiError } from "@/lib/clientErrors";

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

export function TestOrderDocuments({ caseId, testOrderId, documents, onUpdated }: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [specimenIdInput, setSpecimenIdInput] = useState("");
  const [pendingFile, setPendingFile] = useState<{ file: File; type: string } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function uploadFile(file: File, docType: string, extraSpecimenId?: string) {
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
      // Retry on transient 5xx errors (Supabase occasionally returns 502/503/504)
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
          // 5xx = retry; 4xx = don't retry (bad request)
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

      // Step 3: Tell the API to process the uploaded file (COC parsing, AI summary, DB record, auto-advance)
      const processRes = await fetch(`/api/cases/${caseId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          fileName: file.name,
          documentType: docType,
          testOrderId,
          ...(extraSpecimenId ? { specimenId: extraSpecimenId } : {}),
        }),
      });
      if (!processRes.ok) {
        const err = await processRes.json().catch(() => null);
        alert(err?.error || `Processing failed (${processRes.status})`);
      } else {
        onUpdated();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      setPendingFile(null);
      setSpecimenIdInput("");
    }
  }

  function handleFileSelect(file: File, docType: string) {
    if (docType === "chain_of_custody") {
      // COC needs specimen ID prompt
      setPendingFile({ file, type: docType });
    } else {
      uploadFile(file, docType);
    }
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
                      if (f) handleFileSelect(f, slot.type);
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

      {/* COC Specimen ID prompt */}
      {pendingFile && pendingFile.type === "chain_of_custody" && (
        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
          <p className="text-blue-800 font-medium mb-1">Specimen ID for {pendingFile.file.name}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={specimenIdInput}
              onChange={(e) => setSpecimenIdInput(e.target.value)}
              placeholder="e.g. 8079207"
              className="flex-1 px-2 py-1 border border-blue-300 rounded text-xs"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") uploadFile(pendingFile.file, "chain_of_custody", specimenIdInput); }}
            />
            <button
              onClick={() => uploadFile(pendingFile.file, "chain_of_custody", specimenIdInput)}
              className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium"
            >
              Upload
            </button>
            <button
              onClick={() => { setPendingFile(null); setSpecimenIdInput(""); }}
              className="text-gray-500 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
