/**
 * Companion to seed-dev-fixture.ts. Deletes all seed_dev_* records in
 * FK-safe order so the dev-branch fixture can be cleanly re-seeded when
 * fixture definitions change.
 *
 * ──────────────────────────────────────────────────────────────────────
 * What it deletes
 * ──────────────────────────────────────────────────────────────────────
 *
 * Every row whose `id` starts with `seed_dev_` across:
 *   PatchDetails  (ALPHA + BETA)
 *   Document      (BETA working-copy placeholder)
 *   TestOrder     (ALPHA + BETA)
 *   Case          (ALPHA + BETA)
 *   Contact       (ALPHA + BETA)
 *
 * The User row created by the seed is intentionally NOT deleted. See
 * "User-not-deleted" note below.
 *
 * ──────────────────────────────────────────────────────────────────────
 * How to run
 * ──────────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/teardown-dev-fixture.ts
 *
 * No env vars beyond DATABASE_URL are required. Idempotent — running on
 * a clean dev branch deletes nothing and exits cleanly.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Required env vars
 * ──────────────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL          — must point at the dev branch project. The
 *                           prod-guard below refuses to run otherwise.
 *
 * Optional:
 *   SEED_ALLOW_NON_DEV_REF=true
 *                         — bypass the "must be the known dev ref"
 *                           secondary check. Does NOT bypass the
 *                           prod-ref refusal.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why no SEED_USER_AUTH_ID / SEED_USER_EMAIL
 * ──────────────────────────────────────────────────────────────────────
 *
 * Teardown does not need a user identity. The prod guard alone is
 * sufficient protection: every deleteMany filters on `id` starting with
 * `seed_dev_`, a literal prefix the seed assigns and that no real
 * row uses. Requiring auth env vars would add friction without adding
 * safety — even with the wrong UUID, the prefix filter still scopes the
 * deletes to seed rows only.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Prod-guard behavior
 * ──────────────────────────────────────────────────────────────────────
 *
 * Identical to seed-dev-fixture.ts. Before any DB activity, the script
 * parses the project ref out of DATABASE_URL and:
 *
 *   - HARD ABORTS if the ref matches the prod project
 *     (ydziufgdiqmikkmdxafx). No flag overrides this.
 *   - WARNS + ABORTS if the ref is anything other than the known dev
 *     branch (dbgiinfiddvnbpwcagml). Pass SEED_ALLOW_NON_DEV_REF=true
 *     to proceed against an unknown ref.
 *   - Proceeds silently if the ref matches the known dev branch.
 *
 * ──────────────────────────────────────────────────────────────────────
 * User-not-deleted
 * ──────────────────────────────────────────────────────────────────────
 *
 * The seed upserts a public.User row keyed off SEED_USER_AUTH_ID — the
 * operator's Supabase Auth UUID — so the app's requireAuth() finds a
 * matching row after login. Teardown leaves this row alone:
 *
 *   1. Without env vars we have no clean way to identify the right row
 *      by ID. Matching by `name === "Seed Dev User"` (the literal the
 *      seed sets) would work but couples teardown to a string the seed
 *      controls, and silently breaks if the operator edits the row.
 *   2. Deleting public.User without also deleting auth.users (which
 *      this script intentionally does not touch) leaves the operator
 *      logged-in-but-broken — auth.users still authenticates them, but
 *      requireAuth() gets a null public.User and the app errors.
 *   3. Nothing in the seed graph FKs to User. The User row is harmless
 *      to leave; re-running the seed simply re-upserts it.
 *
 * If a future workflow needs a true clean wipe, add a second script
 * that takes SEED_USER_AUTH_ID explicitly.
 *
 * ──────────────────────────────────────────────────────────────────────
 * FK-safe deletion order
 * ──────────────────────────────────────────────────────────────────────
 *
 * Verified against prisma/schema.prisma. In the seed graph:
 *
 *   PatchDetails    → testOrderId (Cascade), workingCopyDocumentId (SetNull)
 *   Document        → caseId (Cascade), testOrderId (default SetNull)
 *   TestOrder       → caseId (Cascade)
 *   Case            → donorId → Contact (no cascade — RESTRICT)
 *   Contact         → no incoming FKs from seed rows
 *
 * Order chosen so each delete sees no live referrers:
 *   1. PatchDetails — leaf in the seed graph
 *   2. Document     — once PatchDetails is gone, no SetNull churn
 *   3. TestOrder    — PatchDetails (Cascade) and Document already gone
 *   4. Case         — TestOrder (Cascade) and Document already gone
 *   5. Contact      — Case.donorId (RESTRICT) already gone
 *
 * Cascading from Case alone would also work (TestOrder, Document,
 * PatchDetails all Cascade-fall), but explicit per-model deletes give
 * us per-model row counts, which is the clearer signal for verifying
 * that teardown matched what we expected.
 */
import { prisma } from "@/lib/prisma";
import { guardProd } from "./_fixtureGuard";

const SEED_PREFIX = "seed_dev_";

const where = { id: { startsWith: SEED_PREFIX } };

async function main(): Promise<void> {
  guardProd({
    scriptName: "teardown-dev-fixture",
    prodRefuseVerb: "tear down prod",
    unknownRefVerb: "tearing down on",
  });

  console.log("[teardown-dev-fixture] Deleting fixture rows in FK-safe order…");

  const pd = await prisma.patchDetails.deleteMany({ where });
  console.log(`  [deleted ${pd.count}] PatchDetails`);

  const doc = await prisma.document.deleteMany({ where });
  console.log(`  [deleted ${doc.count}] Document`);

  const to = await prisma.testOrder.deleteMany({ where });
  console.log(`  [deleted ${to.count}] TestOrder`);

  const cs = await prisma.case.deleteMany({ where });
  console.log(`  [deleted ${cs.count}] Case`);

  const ct = await prisma.contact.deleteMany({ where });
  console.log(`  [deleted ${ct.count}] Contact`);

  // User intentionally NOT deleted — see header "User-not-deleted" note.

  const total = pd.count + doc.count + to.count + cs.count + ct.count;
  console.log(`\n[teardown-dev-fixture] Done. ${total} row(s) deleted.`);
}

main()
  .catch((err) => {
    console.error("[teardown-dev-fixture] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
