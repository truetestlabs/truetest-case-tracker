"use client";

import { useState, useRef } from "react";

type Props = {
  onUploaded: (storagePath: string) => void;
  uploadedPath: string | null;
};

export function CourtOrderUpload({ onUploaded, uploadedPath }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    try {
      // Step 1: Get upload URL
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "intake-temp",
          fileName: file.name,
          contentType: file.type || "application/pdf",
          documentType: "court_order",
        }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl, storagePath, headers } = await urlRes.json();

      // Step 2: Upload directly to Supabase
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { ...headers, "x-upsert": "true" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      onUploaded(storagePath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
    setUploading(false);
  }

  if (uploadedPath) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20,6 9,17 4,12" /></svg>
          <p className="text-green-800 font-medium">Court order uploaded</p>
        </div>
        <button
          onClick={() => onUploaded("")}
          className="text-sm text-gray-500 hover:text-red-600"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-600 mb-2">Do you have a copy of the court order?</p>
      <div className="flex gap-3">
        {/* Camera capture */}
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
          className="flex-1 py-4 px-4 rounded-xl border-2 border-gray-200 bg-white hover:border-[#7AB928] transition-all flex flex-col items-center gap-2 disabled:opacity-50"
        >
          <svg className="w-8 h-8 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span className="text-sm font-medium text-gray-700">Take Photo</span>
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />

        {/* File upload */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex-1 py-4 px-4 rounded-xl border-2 border-gray-200 bg-white hover:border-[#7AB928] transition-all flex flex-col items-center gap-2 disabled:opacity-50"
        >
          <svg className="w-8 h-8 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
          <span className="text-sm font-medium text-gray-700">Upload PDF</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      {uploading && <p className="text-sm text-gray-500 mt-2">Uploading...</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
