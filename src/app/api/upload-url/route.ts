import { NextRequest, NextResponse } from "next/server";
import { getDirectUploadInfo } from "@/lib/storage";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { uploadUrlSchema, formatZodError } from "@/lib/validation/schemas";

/**
 * POST /api/upload-url
 *
 * Returns a pre-authorized Supabase Storage URL for direct browser upload.
 * The browser PUTs the file directly to Supabase — bypasses Vercel's 4.5MB limit.
 *
 * Defense-in-depth: middleware already enforces auth on protected routes, but
 * this handler also checks the session, validates the requested caseId, and
 * limits content types. Anyone who finds the URL still can't:
 *   - call it without a session (401)
 *   - request an upload for a non-existent or deleted case (404)
 *   - smuggle in arbitrary content types (400 from zod enum)
 */
export async function POST(request: NextRequest) {
  // 1. Auth — defense-in-depth over middleware
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  // 2. Parse + validate body
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = uploadUrlSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error), { status: 400 });
  }
  const { caseId, fileName, contentType, documentType } = parsed.data;

  try {
    // 3. Case must exist (we don't have soft-delete yet — when it lands, gate
    // on caseRecord.deletedAt here too).
    const caseRecord = await prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, caseStatus: true },
    });
    if (!caseRecord) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (caseRecord.caseStatus === "closed") {
      // Closed cases shouldn't be receiving new uploads — flag and reject.
      return NextResponse.json(
        { error: "Cannot upload to a closed case" },
        { status: 403 }
      );
    }

    // 4. Build a safe storage path (still strip nasty chars from caller-supplied name)
    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${caseId}/${documentType || "document"}_${timestamp}_${safeName}`;

    const info = getDirectUploadInfo(storagePath, contentType);

    // 5. Audit (non-blocking) — fire-and-forget so we don't slow down the upload
    logAudit({
      userId: user.id,
      action: "upload_url.issue",
      resource: "case",
      resourceId: caseId,
      metadata: { documentType, contentType, fileName: safeName },
    }).catch((e) => console.error("[upload-url] audit failed:", e));

    return NextResponse.json({
      uploadUrl: info.uploadUrl,
      storagePath: info.storagePath,
      headers: info.headers,
    });
  } catch (error) {
    console.error("[upload-url] generation error:", error);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
