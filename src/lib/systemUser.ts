import { prisma } from "@/lib/prisma";

/**
 * Sentinel User row used as the actor for server-initiated actions (cron
 * jobs, background workers) that need to write AuditLog entries. AuditLog
 * has a hard FK to User, so we can't pass a "null/system" actor — we have
 * to point at a real row.
 *
 * The id is a deterministic, non-v4 UUID so it's recognizable in query
 * results and can't collide with a Supabase-issued auth UUID (which is
 * v4). The email uses `.internal` so it never routes to a real mailbox.
 *
 * `ensureSystemUser()` is a cheap upsert — safe to call on every cron
 * invocation. After the first call, subsequent calls are a SELECT.
 */
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const SYSTEM_USER_EMAIL = "system@truetestlabs.internal";

export async function ensureSystemUser(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {},
    create: {
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      name: "System (automated)",
      role: "system",
    },
  });
  return user.id;
}
