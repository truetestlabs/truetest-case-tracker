/**
 * Supabase Storage helper for document uploads/downloads.
 * Uses the Supabase REST API directly (works on Vercel serverless).
 */

// Required env vars — fail loudly the first time they're actually used.
// We deliberately do NOT fall back to the public anon JWT or hardcode a project URL:
// silent fallbacks let prod misconfiguration succeed in the wrong way (writes that
// land in an unexpected project, or fail RLS in a way nobody notices). Better to crash.
//
// We resolve these LAZILY (not at module load) so Next.js's "collect page data"
// build phase can import this module without env vars set. Production runtime
// still throws on the first request.
function requireEnv(name: string, hint?: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[storage] ${name} is not set. Configure it in .env.local (dev) or Vercel env vars (prod).${hint ? " " + hint : ""}`
    );
  }
  return v;
}

function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}
// Supabase Storage requires a JWT key (not the publishable key) with write permission
// to the documents bucket — the service role key is the right one in server-side code.
function getSupabaseKey(): string {
  return requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Do NOT fall back to the anon key — it cannot write to the documents bucket under RLS."
  );
}

const BUCKET = "documents";

function storageUrl(filePath: string): string {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${getSupabaseUrl()}/storage/v1/object/${BUCKET}/${encoded}`;
}

function headers(contentType?: string): Record<string, string> {
  const key = getSupabaseKey();
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    apikey: key,
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
    throw new Error(`Storage upload failed: ${res.status} — ${err}`);
  }

  return storagePath;
}

/**
 * Generate a pre-authorized upload URL for direct browser-to-Supabase upload.
 * The browser PUTs the file directly — bypasses Vercel's 4.5MB body limit.
 * @returns { uploadUrl, storagePath, headers } — everything the browser needs
 */
export function getDirectUploadInfo(
  storagePath: string,
  contentType: string
): { uploadUrl: string; storagePath: string; headers: Record<string, string> } {
  return {
    uploadUrl: storageUrl(storagePath),
    storagePath,
    headers: {
      ...headers(contentType),
      "x-upsert": "true",
    },
  };
}

/**
 * Create a short-lived signed URL for a private Supabase Storage object.
 * Used by the donor portal so the donor can view the attached order PDF
 * without exposing the bucket publicly.
 *
 * @param storagePath - path inside the documents bucket
 * @param expiresInSec - lifetime of the signed URL (default 600s / 10 min)
 * @returns a fully-qualified URL the browser can GET
 */
export async function createSignedUrl(
  storagePath: string,
  expiresInSec: number = 600
): Promise<string> {
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  const signUrl = `${getSupabaseUrl()}/storage/v1/object/sign/${BUCKET}/${encoded}`;
  const res = await fetch(signUrl, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSec }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage sign failed: ${res.status} — ${err}`);
  }
  const json = (await res.json()) as { signedURL?: string; signedUrl?: string };
  // Supabase returns a relative path in `signedURL` (older) or `signedUrl` (newer)
  const rel = json.signedURL || json.signedUrl;
  if (!rel) throw new Error("Storage sign returned no URL");
  return rel.startsWith("http") ? rel : `${getSupabaseUrl()}/storage/v1${rel}`;
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
