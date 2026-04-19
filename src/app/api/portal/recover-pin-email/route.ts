import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendDonorInstructionsEmail } from "@/lib/email";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { logPortalEvent, tarpit } from "@/lib/portalAudit";

/**
 * POST /api/portal/recover-pin-email   (PUBLIC — no session)
 *
 * Donor self-serve: "I forgot my PIN and I don't have the phone on
 * file anymore (or never got the SMS)." Body is `{ email }`. If the
 * email matches a donor on an active monitoring schedule, we re-send
 * the full instructions email (PIN + compliance details) to the
 * address on file. Always returns 202 so the response cannot be used
 * to enumerate which email addresses are registered.
 *
 * Rate limits:
 *   - 3 requests / 30 min / IP    (stops drive-by enumeration)
 *   - 1 request / 30 min / email  (caps Resend bill runup + avoids
 *                                  someone spamming a donor's inbox)
 *
 * Sends the FULL instructions (via sendDonorInstructionsEmail) rather
 * than the short PIN reminder — the donor has no instructions at all
 * if they got here, so ship them the complete doc.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;

  // IP gate — don't let one client sweep the email space.
  const ipGate = rateLimit(`portal-recover-email-ip:${ip}`, 3, 30 * 60_000);
  if (!ipGate.ok) {
    await tarpit(3);
    logPortalEvent({ action: "otp_request", success: false, reason: "recover_email_ip_rl", ipAddress: ip, userAgent });
    return NextResponse.json(
      { error: "Too many requests. Wait 30 minutes and try again." },
      { status: 429 }
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = String(body.email || "").trim();
  if (!raw) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // Very permissive shape check — real validation is "does it match
  // a contact?" which we can't reveal anyway.
  const normalized = raw.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  // Per-email gate.
  const emailGate = rateLimit(`portal-recover-email:${normalized}`, 1, 30 * 60_000);

  // Always return 202 — never reveal whether this email matched anything.
  const respond = () =>
    NextResponse.json(
      { ok: true, message: "If that email matches an active schedule, instructions have been sent." },
      { status: 202 }
    );

  if (!emailGate.ok) {
    logPortalEvent({ action: "otp_request", success: false, reason: "recover_email_rl", ipAddress: ip, userAgent });
    return respond();
  }

  // Find any active schedule whose donor has this email. Prisma's
  // case-insensitive match covers the "jane@x.com" vs "Jane@X.com"
  // typo case.
  const schedules = await prisma.monitoringSchedule.findMany({
    where: {
      active: true,
      case: {
        donor: {
          email: { equals: normalized, mode: "insensitive" },
        },
      },
    },
    select: { id: true },
  });

  if (schedules.length === 0) {
    // Tarpit so timing doesn't leak "email exists vs. not."
    await tarpit(1);
    logPortalEvent({ action: "otp_request", success: false, reason: "recover_email_no_match", ipAddress: ip, userAgent });
    return respond();
  }

  for (const s of schedules) {
    try {
      await sendDonorInstructionsEmail(s.id);
      logPortalEvent({
        scheduleId: s.id,
        action: "otp_request",
        success: true,
        reason: "recover_email",
        ipAddress: ip,
        userAgent,
      });
    } catch (e) {
      logPortalEvent({
        scheduleId: s.id,
        action: "otp_request",
        success: false,
        reason: "recover_email_send_failed",
        ipAddress: ip,
        userAgent,
        metadata: { error: e instanceof Error ? e.message : "send_failed" },
      });
    }
  }

  return respond();
}
