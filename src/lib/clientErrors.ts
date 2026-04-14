/**
 * Client-side helper: turn a failed fetch Response into a useful Error
 * message. Reads the JSON body if present and appends zod validation details
 * (field path + message) so the user sees WHICH field was wrong instead of a
 * generic "Failed to X". Falls back to a status-only message for non-JSON
 * responses (HTML error pages, 502s from Vercel, etc.).
 *
 * Usage:
 *   const res = await fetch(...);
 *   if (!res.ok) throw await apiError(res, "Failed to update case");
 */
export async function apiError(res: Response, fallback: string): Promise<Error> {
  let message = `${fallback} (HTTP ${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.error === "string" && body.error.length > 0) {
      message = body.error;
    }
    if (Array.isArray(body?.details) && body.details.length > 0) {
      const detail = body.details
        .map((d: { path?: string; message?: string }) =>
          d.path ? `${d.path} ${d.message ?? ""}`.trim() : d.message ?? ""
        )
        .filter(Boolean)
        .join("; ");
      if (detail) message += ": " + detail;
    }
  } catch {
    // non-JSON response — leave the fallback + status as the message
  }
  return new Error(message);
}
