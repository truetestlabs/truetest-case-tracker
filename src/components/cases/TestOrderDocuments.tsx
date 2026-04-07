"use client";

import { useState, useRef } from "react";

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
    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentType", docType);
    formData.append("testOrderId", testOrderId);
    if (extraSpecimenId) formData.append("specimenId", extraSpecimenId);

    try {
      const res = await fetch(`/api/cases/${caseId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error || `Upload failed (${res.status})`);
      } else {
        onUpdated();
      }
    } catch {
      alert("Upload failed");
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

  return (
    <div className="mt-2 space-y-1">
      {DOC_SLOTS.map((slot) => {
        const doc = documents.find((d) => d.documentType === slot.type);
        const isUploading = uploading === slot.type;

        return (
          <div key={slot.type} className="flex items-center gap-2 text-xs">
            <span className="w-5 text-center">{slot.icon}</span>
            <span className="text-gray-500 w-14 flex-shrink-0">{slot.label}:</span>

            {doc ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-gray-700 truncate">{doc.fileName}</span>
                <button
                  onClick={() => handleDownload(doc.id)}
                  className="text-blue-500 hover:text-blue-700 flex-shrink-0"
                  title="Download"
                >
                  ⬇
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
