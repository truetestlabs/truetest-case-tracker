/**
 * One-off backfill: insert PatchDetails rows for legacy sweat_patch
 * TestOrders that don't have one.
 *
 * Background:
 *   The `createTestOrderWithPatchDetails` helper (src/lib/createTestOrder.ts)
 *   creates PatchDetails transactionally with TestOrder for sweat_patch
 *   orders. Orders created before that helper landed have no PatchDetails
 *   row at all. Audit (2026-05-13) found 10/10 pre-helper sweat_patch
 *   orders missing PatchDetails on prod, all in status closed/cancelled.
 *
 *   The fix going forward is the helper itself — every new sweat_patch
 *   TestOrder gets a PatchDetails row. This script is a one-time
 *   recovery pass for the legacy orphans.
 *
 * What it does:
 *   For each sweat_patch TestOrder with no PatchDetails row, insert a
 *   PatchDetails with `panel: 'WA07'` (the default per the helper —
 *   ~95% of orders are WA07). applicationDate, removalDate, and the
 *   other lifecycle fields are left null; all candidates are
 *   closed/cancelled so no live-state field needs reconstruction.
 *
 * Idempotent:
 *   The candidate query LEFT JOIN-filters on missing PatchDetails. A
 *   second run finds zero candidates and inserts nothing.
 *
 * Flags:
 *   --dry-run    List candidates without inserting.
 *
 * Run with:
 *   set -a && source .env && set +a && npx tsx scripts/backfill-orphan-patch-details.ts [--dry-run]
 *
 * Closes #56.
 */
import { prisma } from "@/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");
const DEFAULT_PANEL = "WA07" as const;

async function main() {
  console.log("=== Backfill: orphan PatchDetails rows ===");
  console.log(DRY_RUN ? "Mode: DRY RUN (no writes)\n" : "Mode: LIVE\n");

  // Candidate query: sweat_patch TestOrders that have no PatchDetails
  // row via the unique testOrderId FK. The relation is 1:1 (PatchDetails
  // has `@unique` on testOrderId), so `patchDetails: null` is the
  // exhaustive missing-row predicate.
  const candidates = await prisma.testOrder.findMany({
    where: {
      specimenType: "sweat_patch",
      patchDetails: null,
    },
    select: {
      id: true,
      caseId: true,
      testStatus: true,
      specimenId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${candidates.length} candidate(s):`);
  for (const c of candidates) {
    console.log(
      `  ${c.id}  status=${c.testStatus}  specimenId=${c.specimenId ?? "(null)"}  created=${c.createdAt.toISOString()}`,
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log("Dry run complete. No writes performed.");
    await prisma.$disconnect();
    return;
  }

  if (candidates.length === 0) {
    console.log("Nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const c of candidates) {
    const inserted = await prisma.patchDetails.create({
      data: {
        testOrderId: c.id,
        panel: DEFAULT_PANEL,
      },
      select: { id: true, testOrderId: true, panel: true },
    });
    console.log(
      `  + PatchDetails ${inserted.id} → TestOrder ${inserted.testOrderId} (panel=${inserted.panel})`,
    );
    created++;
  }

  console.log("\n=== Summary ===");
  console.log(`PatchDetails inserted: ${created}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
