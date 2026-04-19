import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * POST /api/portal/push-subscriptions  (PUBLIC — PIN-gated)
 *
 * Donor's browser calls this after the first successful /portal login
 * to register its Web Push endpoint. Auth is PIN-based: we only store
 * the subscription if the caller's PIN matches an active schedule.
 *
 * Body: { pin: string, subscription: PushSubscriptionJSON, userAgent?: string }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const gate = rateLimit(`portal-push:${ip}`, 20, 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let body: {
    pin?: string;
    subscription?: {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    userAgent?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = String(body.pin || "").trim();
  const sub = body.subscription;
  if (!pin || !sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { checkInPin: pin },
    select: { id: true, active: true },
  });
  if (!schedule || !schedule.active) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 404 });
  }

  // Upsert on endpoint — same device re-registering should be idempotent.
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      scheduleId: schedule.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: body.userAgent || request.headers.get("user-agent") || null,
    },
    update: {
      scheduleId: schedule.id,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
  });

  return NextResponse.json({ ok: true });
}
