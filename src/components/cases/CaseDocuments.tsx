"use client";

import { useState, useRef } from "react";

type Document = {
  id: string;
  documentType: string;
  fileName: string;
  uploadedAt: string;
};

type Props = {
  caseId: string;
  documents: Document[];
  onUpdated: () => void;
};

const DOC_SECTIONS = [
  { type: "court_order", label: "Court Order", icon: "📋" },
  { type: "chain_of_custody", label: "Chain of Custody", icon: "🔗" },
  { type: "result_report", label: "Lab Results", icon: "🧪" },
  { type: "other", label: "MRO Report", icon: "👨‍⚕️", matchType: "other" },
] as const;

function DocumentUploadSlot({
  caseId,
  docType,
  label,
  icon,
  existingDocs,
  onUpdated,
}: {
  caseId: string;
  docType: string;
  label: string;
  icon: string;
  existingDocs: Document[];
  onUpdated: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [specimenId, setSpecimenId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // For COC uploads, prompt for specimen ID before uploading
    if (docType === "chain_of_custody") {
      setPendingFile(file);
      return;
    }

    uploadFile(file);
  }

  async function uploadFile(file: File, extraFields?: Record<string, string>) {
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentType", docType === "other" ? "other" : docType);
    if (extraFields) {
      Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
    }

    try {
      const res = await fetch(`/api/cases/${caseId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      onUpdated();
    } catch {
      alert("Failed to upload file");
    } finally {
      setUploading(false);
      setPendingFile(null);
      setSpecimenId("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(docId: string, fileName: string) {
    if (!confirm(`Delete ${fileName}?`)) return;
    await fetch(`/api/cases/${caseId}/documents?documentId=${docId}`, { method: "DELETE" });
    onUpdated();
  }

  // For MRO reports, filter by "other" type and filename containing "mro"
  // For other types, match exactly
  const docs = docType === "other"
    ? existingDocs.filter((d) => d.documentType === "other")
    : existingDocs.filter((d) => d.documentType === docType);

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900">
          {icon} {label}
        </h4>
        <div className="flex items-center gap-2">
          {docs.length > 0 && (
            <a
              href={`/api/cases/${caseId}/documents/download?type=${docType}`}
              className="text-xs px-2.5 py-1 bg-[#1e3a5f] text-white rounded hover:bg-[#2a5490] font-medium flex items-center gap-1"
              download
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download All
            </a>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "+ Upload"}
          </button>
        </div>
      </div>

      {/* Specimen ID prompt for COC uploads */}
      {pendingFile && docType === "chain_of_custody" && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs font-medium text-gray-700 mb-2">
            Specimen ID for <span className="text-gray-900">{pendingFile.name}</span>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={specimenId}
              onChange={(e) => setSpecimenId(e.target.value)}
              placeholder="e.g. 8079207"
              className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  uploadFile(pendingFile, { specimenId: specimenId.trim() });
                }
              }}
            />
            <button
              onClick={() => uploadFile(pendingFile, { specimenId: specimenId.trim() })}
              disabled={uploading}
              className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded text-xs font-medium hover:bg-[#2a5490] disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <button
              onClick={() => { setPendingFile(null); setSpecimenId(""); if (fileRef.current) fileRef.current.value = ""; }}
              className="px-2 py-1.5 text-gray-500 hover:text-gray-700 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No files uploaded</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
              <div>
                <p className="font-medium text-gray-800 text-xs">{doc.fileName}</p>
                <p className="text-xs text-gray-400">{new Date(doc.uploadedAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/cases/${caseId}/documents/download?documentId=${doc.id}`}
                  className="text-xs text-blue-500 hover:text-blue-700"
                  title="Download"
                  download
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </a>
                <button
                  onClick={() => handleDelete(doc.id, doc.fileName)}
                  className="text-xs text-red-400 hover:text-red-600"
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CaseDocuments({ caseId, documents, onUpdated }: Props) {
  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Documents ({documents.length})
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DOC_SECTIONS.map((section) => (
          <DocumentUploadSlot
            key={section.type}
            caseId={caseId}
            docType={section.type}
            label={section.label}
            icon={section.icon}
            existingDocs={documents}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </section>
  );
}
