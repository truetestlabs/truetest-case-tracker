import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portalSession";
import { buildSessionPayload } from "@/lib/portalPayload";

/**
 * GET /api/portal/session
 *
 * Called by /portal on mount. If the donor has a valid session cookie,
 * returns today's session payload (same shape as /api/portal/login) and
 * skips the PIN prompt. Otherwise returns 401 and the UI prompts for PIN.
 */
export async function GET(request: NextRequest) {
  const sess = await getPortalSession(request);
  if (!sess) return NextResponse.json({ error: "No session" }, { status: 401 });

  const payload = await buildSessionPayload(sess.scheduleId);
  if (!payload) return NextResponse.json({ error: "No schedule" }, { status: 404 });

  return NextResponse.json(payload);
}
