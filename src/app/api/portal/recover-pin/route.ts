import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { logPortalEvent, tarpit } from "@/lib/portalAudit";

/**
 * POST /api/portal/recover-pin   (PUBLIC — no session)
 *
 * Donor self-serve: "I forgot my PIN." Body is `{ phone }`. If the phone
 * matches a donor on an active monitoring schedule, we SMS that schedule's
 * PIN + portal link to the phone on file. Always returns 202 so the
 * response cannot be used to enumerate which phone numbers are registered.
 *
 * Rate limits:
 *   - 3 requests / 30 min / IP     (stops drive-by abuse)
 *   - 1 request / 30 min / phone   (stops Twilio-bill runup if a PIN is
 *                                   stolen and an attacker tries to lock
 *                                   the donor out by spamming them)
 *
 * Deliberately does NOT send via email — email is not a trusted channel
 * for a password-equivalent reset here, and the donor in question by
 * definition may have deleted the instructions email already. Staff has
 * the explicit "email it" path via /api/monitoring-schedules/[id]/resend-pin.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;

  // IP gate — don't let one client sweep the phone space.
  const ipGate = rateLimit(`portal-recover:${ip}`, 3, 30 * 60_000);
  if (!ipGate.ok) {
    await tarpit(3);
    logPortalEvent({ action: "otp_request", success: false, reason: "recover_ip_rl", ipAddress: ip, userAgent });
    return NextResponse.json(
      { error: "Too many requests. Wait 30 minutes and try again." },
      { status: 429 }
    );
  }

  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = String(body.phone || "").trim();
  if (!raw) return NextResponse.json({ error: "Phone required" }, { status: 400 });

  // Normalize to last-10-digits for matching. Contacts are stored in
  // varied formats ("(231) 880-3966", "2318803966", "+12318803966") so we
  // compare on the trailing 10 digits.
  const digits = raw.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length !== 10) {
    return NextResponse.json({ error: "Phone must have at least 10 digits" }, { status: 400 });
  }

  // Per-phone gate.
  const phoneGate = rateLimit(`portal-recover-phone:${last10}`, 1, 30 * 60_000);

  // Always return 202 — never reveal whether this phone matched anything.
  // Do the lookup and send in the background-equivalent (awaited here, but
  // the response shape is identical success or fail).
  const respond = () =>
    NextResponse.json(
      { ok: true, message: "If this phone matches an active schedule, you'll get a text shortly." },
      { status: 202 }
    );

  if (!phoneGate.ok) {
    logPortalEvent({ action: "otp_request", success: false, reason: "recover_phone_rl", ipAddress: ip, userAgent });
    return respond();
  }

  // Find any active schedule whose donor has this phone. A single donor
  // may have multiple active schedules — that's rare, but we send a PIN
  // for each to avoid silently hiding one.
  const schedules = await prisma.monitoringSchedule.findMany({
    where: {
      active: true,
      case: {
        donor: {
          phone: { endsWith: last10 },
        },
      },
    },
    select: {
      id: true,
      checkInPin: true,
      case: {
        select: {
          caseNumber: true,
          donor: { select: { firstName: true, phone: true } },
        },
      },
    },
  });

  if (schedules.length === 0) {
    // Tarpit so timing doesn't leak "phone exists vs. not."
    await tarpit(1);
    logPortalEvent({ action: "otp_request", success: false, reason: "recover_no_match", ipAddress: ip, userAgent });
    return respond();
  }

  const portalUrl =
    (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://truetest-case-tracker.vercel.app").replace(/\/$/, "") +
    "/portal";

  for (const s of schedules) {
    const phoneOnFile = s.case.donor?.phone;
    if (!phoneOnFile) continue;
    const firstName = s.case.donor?.firstName || "there";
    const body =
      `TrueTest Labs: Hi ${firstName}, your PIN is ${s.checkInPin}. ` +
      `Sign in at ${portalUrl}. Keep this PIN private — don't share it.`;
    await sendSms(phoneOnFile, body);
    logPortalEvent({
      scheduleId: s.id,
      action: "otp_request",
      success: true,
      reason: "recover_pin",
      ipAddress: ip,
      userAgent,
    });
  }

  return respond();
}
