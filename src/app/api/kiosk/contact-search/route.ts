import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/kiosk/contact-search?type=attorney|gal|evaluator|attorney,gal&q=...
 *
 * PUBLIC endpoint used by the iPad kiosk's AttorneySearch component.
 *
 * Security guarantees enforced server-side — these CANNOT be bypassed by
 * a malicious client:
 *
 *  1. NEVER returns donor or contactType="other" records under any circumstances
 *     (hardcoded allowlist of types below — client-supplied types are filtered
 *     against this list before being used in the query)
 *  2. Returns only fields needed for display — no notes, no case data, no
 *     internal IDs beyond the contact's own UUID
 *  3. Requires a search query of at least 2 characters (no "return everything")
 *
 * Why a separate endpoint? /api/contacts is a staff endpoint that CAN return
 * donor records (needed for staff workflows). The kiosk is public and must
 * NEVER expose client PII to other clients — especially where orders of
 * protection exist between parties. Belt and suspenders.
 */

const ALLOWED_TYPES = new Set(["attorney", "gal", "evaluator"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type") || "";
  const q = (searchParams.get("q") || "").trim();

  // Require a non-trivial search query
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  // Parse requested types, then INTERSECT with the allowlist.
  // If client passes "donor" or "other" or anything not in the allowlist,
  // those are silently dropped.
  const requested = typeParam.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const allowed = requested.filter((t) => ALLOWED_TYPES.has(t));

  // If none of the requested types are allowed, or the client omitted type,
  // default to all legal-contact types (but NEVER donor/other).
  const typesToQuery = allowed.length > 0 ? allowed : Array.from(ALLOWED_TYPES);

  try {
    const contacts = await prisma.contact.findMany({
      where: {
        // Hard server-side filter: only the allowlisted contact types
        contactType: { in: typesToQuery as ("attorney" | "gal" | "evaluator")[] },
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { firmName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      // Only the fields needed to render the dropdown and populate the form.
      // No notes, no barNumber, no metadata.
      select: {
        id: true,
        firstName: true,
        lastName: true,
        firmName: true,
        email: true,
        phone: true,
        contactType: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 10,
    });

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("[kiosk/contact-search] error:", error);
    return NextResponse.json([]);
  }
}
