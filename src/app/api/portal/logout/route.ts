import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearPortalSession, getPortalSession } from "@/lib/portalSession";
import { getClientIp } from "@/lib/rateLimit";
import { logPortalEvent } from "@/lib/portalAudit";

/**
 * POST /api/portal/logout
 *
 * Clears the session cookie. If `revokeDevice=true`, also sets `revokedAt`
 * on the TrustedDevice row so the same browser cannot skip OTP next time —
 * used for "Not my device" / "I want to forget this device" flows.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;
  const sess = await getPortalSession(request);

  let revokeDevice = false;
  try {
    const body = await request.json();
    revokeDevice = !!body?.revokeDevice;
  } catch {
    // No body is fine.
  }

  if (sess && revokeDevice) {
    await prisma.trustedDevice.update({
      where: { id: sess.deviceRowId },
      data: { revokedAt: new Date() },
    });
  }

  const res = NextResponse.json({ ok: true });
  clearPortalSession(res);
  logPortalEvent({
    scheduleId: sess?.scheduleId ?? null,
    action: "logout",
    success: true,
    reason: revokeDevice ? "revoke_device" : "session_only",
    ipAddress: ip,
    userAgent,
  });
  return res;
}
