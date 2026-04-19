import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardCron } from "@/lib/cronAuth";
import { sendPush, isDeadSubscriptionError } from "@/lib/push";
import { sendSms } from "@/lib/sms";
import { Resend } from "resend";

// Inline Resend for this cron so we don't bloat src/lib/email.ts with a
// generic sender that nothing else needs yet.
async function sendPlainEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.FROM_EMAIL || "TrueTest Labs <noreply@truetestlabs.com>",
    replyTo: process.env.REPLY_TO_EMAIL || "support@truetestlabs.com",
    to,
    subject,
    html,
  });
}

export const maxDuration = 60;

/**
 * GET /api/cron/run-notifications
 *
 * Runs frequently (every 5 min during the notification window). Dispatches
 * any NotificationJob whose sendAt <= now AND whose parent selection
 * hasn't been acknowledged. Updates each job's status to sent / skipped /
 * failed. Never blocks on one channel's failure — each job is independent.
 */
export async function GET(request: NextRequest) {
  const block = guardCron(request);
  if (block) return block;

  const now = new Date();

  const due = await prisma.notificationJob.findMany({
    where: {
      status: "pending",
      sendAt: { lte: now },
    },
    include: {
      selection: {
        include: {
          schedule: {
            include: {
              case: {
                include: {
                  donor: { select: { firstName: true, lastName: true, email: true, phone: true } },
                },
              },
              testCatalog: { select: { testName: true } },
              pushSubscriptions: true,
            },
          },
        },
      },
    },
    take: 100, // bound per-invocation work
  });

  const results = { sent: 0, skipped: 0, failed: 0 };

  for (const job of due) {
    // Short-circuit: donor already acknowledged — silence the rest.
    if (job.selection.acknowledgedAt) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "skipped", sentAt: new Date(), errorMessage: "acknowledged" },
      });
      results.skipped++;
      continue;
    }

    const donor = job.selection.schedule.case.donor;
    const testName = job.selection.schedule.testCatalog.testName;
    const donorName = donor ? `${donor.firstName} ${donor.lastName}` : "Donor";
    const title = "TrueTest Labs — Report today";
    const body = `${donorName}, you're selected for a ${testName} test today. Open the portal for your order.`;
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || ""}/portal`;

    try {
      if (job.channel === "push") {
        const subs = job.selection.schedule.pushSubscriptions;
        if (subs.length === 0) {
          await prisma.notificationJob.update({
            where: { id: job.id },
            data: { status: "skipped", sentAt: new Date(), errorMessage: "no subscriptions" },
          });
          results.skipped++;
          continue;
        }
        // Send to every subscription on this schedule; prune dead ones.
        for (const sub of subs) {
          try {
            await sendPush(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              { title, body, url: portalUrl || "/portal" }
            );
          } catch (err) {
            if (isDeadSubscriptionError(err)) {
              await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            } else {
              throw err;
            }
          }
        }
      } else if (job.channel === "sms") {
        if (!donor?.phone) {
          await prisma.notificationJob.update({
            where: { id: job.id },
            data: { status: "skipped", sentAt: new Date(), errorMessage: "no donor phone" },
          });
          results.skipped++;
          continue;
        }
        await sendSms(
          donor.phone,
          `TrueTest Labs: You're selected for a drug test today. Open ${portalUrl || "the donor portal"} to see your order. Reply STOP to opt out.`
        );
      } else if (job.channel === "email") {
        if (!donor?.email) {
          await prisma.notificationJob.update({
            where: { id: job.id },
            data: { status: "skipped", sentAt: new Date(), errorMessage: "no donor email" },
          });
          results.skipped++;
          continue;
        }
        await sendPlainEmail(
          donor.email,
          "TrueTest Labs — You're selected for testing today",
          `<p>Hi ${donorName},</p><p>You're selected for a <strong>${testName}</strong> test today. Please open your donor portal to view today's collection order and mark it acknowledged:</p><p><a href="${portalUrl || "/portal"}">${portalUrl || "Open portal"}</a></p><p>— TrueTest Labs</p>`
        );
      } else {
        // Unknown channel (e.g. voice) — mark skipped rather than failed so
        // it's visible in ops but doesn't burn retries.
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: "skipped", sentAt: new Date(), errorMessage: `channel '${job.channel}' not implemented` },
        });
        results.skipped++;
        continue;
      }

      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "sent", sentAt: new Date() },
      });
      results.sent++;
    } catch (err) {
      console.error("[cron/run-notifications] failed:", job.id, err);
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          sentAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      results.failed++;
    }
  }

  return NextResponse.json({ ok: true, considered: due.length, ...results });
}
