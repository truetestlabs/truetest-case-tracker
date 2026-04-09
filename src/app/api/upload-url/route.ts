import { NextRequest, NextResponse } from "next/server";
import { getDirectUploadInfo } from "@/lib/storage";

/**
 * POST /api/upload-url
 *
 * Returns a pre-authorized Supabase Storage URL for direct browser upload.
 * The browser PUTs the file directly to Supabase — bypasses Vercel's 4.5MB limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { caseId, fileName, contentType, documentType } = await request.json();

    if (!caseId || !fileName) {
      return NextResponse.json({ error: "caseId and fileName are required" }, { status: 400 });
    }

    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${caseId}/${documentType || "document"}_${timestamp}_${safeName}`;

    const info = getDirectUploadInfo(storagePath, contentType || "application/octet-stream");

    return NextResponse.json({
      uploadUrl: info.uploadUrl,
      storagePath: info.storagePath,
      headers: info.headers,
    });
  } catch (error) {
    console.error("Upload URL generation error:", error);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
