/**
 * Supabase Storage helper for document uploads/downloads.
 * Uses the Supabase REST API directly (works on Vercel serverless).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BUCKET = "documents";

function storageUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
}

function headers(contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

/**
 * Upload a file to Supabase Storage.
 * @param storagePath - e.g., "caseId/result_report_123456_filename.pdf"
 * @param buffer - file contents
 * @param contentType - MIME type (e.g., "application/pdf")
 * @returns the storage path on success
 */
export async function uploadFile(
  storagePath: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const res = await fetch(storageUrl(storagePath), {
    method: "POST",
    headers: {
      ...headers(contentType),
      "x-upsert": "true",
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[Storage] Upload failed:", res.status, err);
    throw new Error(`Storage upload failed: ${res.status}`);
  }

  return storagePath;
}

/**
 * Download a file from Supabase Storage.
 * @returns { buffer, contentType }
 */
export async function downloadFile(
  storagePath: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(storageUrl(storagePath), {
    method: "GET",
    headers: headers(),
  });

  if (!res.ok) {
    throw new Error(`Storage download failed: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}
