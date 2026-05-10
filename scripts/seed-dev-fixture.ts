/**
 * Seed the dev-branch Supabase database with the minimum fixture needed
 * to walk through the patch CoC upload flow (PR #34's DoD) and future
 * patch-related PRs in the UI.
 *
 * ──────────────────────────────────────────────────────────────────────
 * What it creates
 * ──────────────────────────────────────────────────────────────────────
 *
 * Two end-to-end patch fixtures:
 *
 *   ALPHA — "working-copy CoC entry point"
 *     Contact "Test Donor Alpha" → Case TTL-DEV-SEED-0001 → sweat-patch
 *     TestOrder (lab=crl, panel WA07) → PatchDetails with NO
 *     applicationDate and NO workingCopyDocumentId. Lands the patch in
 *     the state where the next valid action is uploading a working-copy
 *     CoC.
 *
 *   BETA — "executed-copy CoC entry point"
 *     Contact "Test Donor Beta" → Case TTL-DEV-SEED-0002 → sweat-patch
 *     TestOrder (lab=crl, panel WA07) → PatchDetails with applicationDate
 *     set 7 days ago and workingCopyDocumentId pointing at a placeholder
 *     Document row. Lands the patch in the state where the next valid
 *     action is uploading an executed-copy CoC.
 *
 * One User row keyed off the Supabase auth UUID supplied via env vars,
 * so the route's requireAuth() finds a matching public.User after login.
 *
 * The placeholder Document for BETA points at a storage path that does
 * NOT exist in Supabase Storage. Verified safe for the executed-copy
 * upload flow: executePatchCoc (src/lib/patchStatus.ts:46-76) only
 * mutates rows, and the route handler (documents/route.ts:474-477) only
 * flips the working-copy Document's cocLifecycleStage to "archived" —
 * neither path fetches the working-copy file's bytes from Storage. The
 * route writes a NEW Document on upload using the freshly-uploaded
 * file. Only direct download links for the placeholder row will 404 if
 * exercised in the UI.
 *
 * ──────────────────────────────────────────────────────────────────────
 * How to run
 * ──────────────────────────────────────────────────────────────────────
 *
 *   SEED_USER_EMAIL=mgammel@truetestlabs.com \
 *   SEED_USER_AUTH_ID=<supabase-auth-uuid-for-dev-project> \
 *   npx tsx scripts/seed-dev-fixture.ts
 *
 * Re-running is safe — every write is an upsert keyed on a deterministic
 * `seed_dev_*` ID, so duplicate runs print "already present" and exit
 * cleanly without creating second copies.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Required env vars
 * ──────────────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL          — must point at the dev branch project. The
 *                           prod-guard below refuses to run otherwise.
 *   SEED_USER_EMAIL       — email for the public.User row.
 *   SEED_USER_AUTH_ID     — Supabase Auth UUID. The user must already
 *                           have signed in to the DEV branch's Supabase
 *                           Auth at least once so that auth.users has a
 *                           matching row; this script only writes
 *                           public.User, not auth.users. Before any
 *                           writes, the script SELECTs from auth.users
 *                           and aborts if no row matches the supplied
 *                           UUID.
 *
 * Optional:
 *   SEED_ALLOW_NON_DEV_REF=true
 *                         — bypass the "must be the known dev ref"
 *                           secondary check (e.g. if the dev branch is
 *                           ever migrated to a new project ref). Does
 *                           NOT bypass the prod-ref refusal.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Prod-guard behavior
 * ──────────────────────────────────────────────────────────────────────
 *
 * Before any DB activity, the script parses the project ref out of
 * DATABASE_URL and:
 *
 *   - HARD ABORTS if the ref matches the prod project
 *     (ydziufgdiqmikkmdxafx). No flag overrides this.
 *   - WARNS + ABORTS if the ref is anything other than the known dev
 *     branch (dbgiinfiddvnbpwcagml). Pass SEED_ALLOW_NON_DEV_REF=true
 *     to proceed against an unknown ref.
 *   - Proceeds silently if the ref matches the known dev branch.
 *
 * The ref is read from the URL's username segment
 * (postgres.<ref>@... for the pooler URL) or the host
 * (db.<ref>.supabase.co for the direct URL).
 */
import { prisma } from "@/lib/prisma";
import { guardProd } from "./_fixtureGuard";

// Specimen IDs use a 9-digit numeric format mirroring real CRL sweat-patch
// accession numbers (e.g. "762296171"). The 999-prefix range is clearly
// synthetic — no real CRL specimen would start with 999 — while still
// passing through specimenIdsMatch (src/lib/patchValidation.ts:262-287),
// which strips leading non-digits and compares as strings. A non-numeric
// fixture ID would silently fail every PDF specimen-ID compare.
const ALPHA = {
  contactId: "seed_dev_contact_alpha",
  caseId: "seed_dev_case_alpha",
  caseNumber: "TTL-DEV-SEED-0001",
  testOrderId: "seed_dev_to_alpha",
  patchDetailsId: "seed_dev_pd_alpha",
  donorFirst: "Test Donor",
  donorLast: "Alpha",
  specimenId: "999000001",
};

const BETA = {
  contactId: "seed_dev_contact_beta",
  caseId: "seed_dev_case_beta",
  caseNumber: "TTL-DEV-SEED-0002",
  testOrderId: "seed_dev_to_beta",
  patchDetailsId: "seed_dev_pd_beta",
  workingCopyDocId: "seed_dev_doc_beta_working_copy",
  donorFirst: "Test Donor",
  donorLast: "Beta",
  specimenId: "999000002",
};

type Action = "created" | "updated" | "unchanged";
const log: { what: string; action: Action }[] = [];
function record(what: string, action: Action): void {
  log.push({ what, action });
  console.log(`  [${action}] ${what}`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[seed-dev-fixture] ${name} is required but unset. Aborting.`);
    process.exit(1);
  }
  return v;
}

function utcNoon(daysAgo: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysAgo,
      12,
      0,
      0,
    ),
  );
}

async function assertAuthUserExists(authId: string): Promise<void> {
  // Cast to ::uuid so the comparison is type-correct against auth.users.id
  // (Postgres uuid column). An invalid-format SEED_USER_AUTH_ID will throw
  // a 22P02 here — that's a louder, better failure than silent text
  // comparison.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM auth.users WHERE id = ${authId}::uuid LIMIT 1
  `;
  if (rows.length === 0) {
    console.error(
      `[seed-dev-fixture] No matching auth.users row found for SEED_USER_AUTH_ID=${authId}.\n` +
        `Sign in to the dev project's Supabase Auth at least once before re-running this script.`,
    );
    process.exit(1);
  }
}

async function upsertUser(authId: string, email: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id: authId } });
  await prisma.user.upsert({
    where: { id: authId },
    update: { email, name: "Seed Dev User" },
    create: {
      id: authId,
      email,
      name: "Seed Dev User",
      role: "admin",
    },
  });
  record(`User ${email} (${authId})`, existing ? "unchanged" : "created");
}

async function upsertContact(
  id: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  const existing = await prisma.contact.findUnique({ where: { id } });
  await prisma.contact.upsert({
    where: { id },
    update: {},
    create: {
      id,
      contactType: "donor",
      firstName,
      lastName,
      email: `${id}@dev.invalid`,
    },
  });
  record(`Contact ${firstName} ${lastName} (${id})`, existing ? "unchanged" : "created");
}

// No CaseContact rows are seeded. The case detail page resolves the donor
// via Case.donorId directly (src/app/cases/[id]/page.tsx:371-395), and
// non-donor CaseContact filters (attorneys, GALs, result recipients) all
// have graceful empty-state handling. Adding a donor-role CaseContact
// would be redundant with the Case.donorId edge.
async function upsertCase(
  id: string,
  caseNumber: string,
  donorId: string,
): Promise<void> {
  const existing = await prisma.case.findUnique({ where: { id } });
  await prisma.case.upsert({
    where: { id },
    update: {},
    create: {
      id,
      caseNumber,
      caseType: "voluntary",
      caseStatus: "active",
      donorId,
      notes: "Seed fixture for dev branch — safe to delete.",
    },
  });
  record(`Case ${caseNumber} (${id})`, existing ? "unchanged" : "created");
}

// testStatus is cosmetic for the patch CoC upload flow — the route
// dispatches on PatchDetails state (applicationDate / workingCopyDocumentId
// / executedDocumentId), and the upload buttons in the UI gate on the
// derived `lifecycle` value (PatchSection.tsx:320-335), not testStatus.
// Values chosen here are realistic for the lifecycle stage so the row
// looks coherent in lists and badges:
//   ALPHA → 'order_released'      (pre-application; patch ordered, not on donor)
//   BETA  → 'specimen_collected'  (patch is on donor, awaiting executed CoC)
async function upsertTestOrder(
  id: string,
  caseId: string,
  specimenId: string,
  testStatus: "order_released" | "specimen_collected",
): Promise<void> {
  const existing = await prisma.testOrder.findUnique({ where: { id } });
  await prisma.testOrder.upsert({
    where: { id },
    update: {},
    create: {
      id,
      caseId,
      testDescription: "Sweat Patch — WA07 (CRL) — dev fixture",
      specimenType: "sweat_patch",
      lab: "crl",
      testStatus,
      collectionType: "observed",
      schedulingType: "scheduled",
      specimenId,
    },
  });
  record(`TestOrder ${id}`, existing ? "unchanged" : "created");
}

async function upsertPatchDetailsAlpha(): Promise<void> {
  const existing = await prisma.patchDetails.findUnique({
    where: { id: ALPHA.patchDetailsId },
  });
  await prisma.patchDetails.upsert({
    where: { id: ALPHA.patchDetailsId },
    update: {},
    create: {
      id: ALPHA.patchDetailsId,
      testOrderId: ALPHA.testOrderId,
      panel: "WA07",
      // applicationDate, workingCopyDocumentId, executedDocumentId all null
      // by omission — that's the working-copy entry point.
    },
  });
  record(
    `PatchDetails ALPHA (${ALPHA.patchDetailsId}) — pre-application`,
    existing ? "unchanged" : "created",
  );
}

async function upsertBetaWorkingCopyDoc(): Promise<void> {
  const existing = await prisma.document.findUnique({
    where: { id: BETA.workingCopyDocId },
  });
  await prisma.document.upsert({
    where: { id: BETA.workingCopyDocId },
    update: {},
    create: {
      id: BETA.workingCopyDocId,
      caseId: BETA.caseId,
      testOrderId: BETA.testOrderId,
      documentType: "chain_of_custody",
      cocLifecycleStage: "working_copy",
      fileName: "seed-dev-beta-working-copy-placeholder.pdf",
      filePath: `${BETA.caseId}/seed-dev-beta-working-copy-placeholder.pdf`,
      notes: "Placeholder — not present in Supabase Storage.",
    },
  });
  record(
    `Document BETA working-copy placeholder (${BETA.workingCopyDocId})`,
    existing ? "unchanged" : "created",
  );
}

async function upsertPatchDetailsBeta(): Promise<void> {
  const existing = await prisma.patchDetails.findUnique({
    where: { id: BETA.patchDetailsId },
  });
  await prisma.patchDetails.upsert({
    where: { id: BETA.patchDetailsId },
    update: {},
    create: {
      id: BETA.patchDetailsId,
      testOrderId: BETA.testOrderId,
      panel: "WA07",
      applicationDate: utcNoon(7),
      workingCopyDocumentId: BETA.workingCopyDocId,
      // executedDocumentId null by omission — that's the executed-copy entry point.
    },
  });
  record(
    `PatchDetails BETA (${BETA.patchDetailsId}) — worn, awaiting executed CoC`,
    existing ? "unchanged" : "created",
  );
}

async function main(): Promise<void> {
  guardProd({
    scriptName: "seed-dev-fixture",
    prodRefuseVerb: "seed prod",
    unknownRefVerb: "seeding into",
  });

  const authId = requireEnv("SEED_USER_AUTH_ID");
  const email = requireEnv("SEED_USER_EMAIL");

  console.log(
    `[seed-dev-fixture] Verifying auth.users row for ${authId}…`,
  );
  await assertAuthUserExists(authId);

  console.log("[seed-dev-fixture] Upserting fixture rows…");

  await upsertUser(authId, email);

  await upsertContact(ALPHA.contactId, ALPHA.donorFirst, ALPHA.donorLast);
  await upsertCase(ALPHA.caseId, ALPHA.caseNumber, ALPHA.contactId);
  await upsertTestOrder(
    ALPHA.testOrderId,
    ALPHA.caseId,
    ALPHA.specimenId,
    "order_released",
  );
  await upsertPatchDetailsAlpha();

  await upsertContact(BETA.contactId, BETA.donorFirst, BETA.donorLast);
  await upsertCase(BETA.caseId, BETA.caseNumber, BETA.contactId);
  await upsertTestOrder(
    BETA.testOrderId,
    BETA.caseId,
    BETA.specimenId,
    "specimen_collected",
  );
  await upsertBetaWorkingCopyDoc();
  await upsertPatchDetailsBeta();

  const created = log.filter((l) => l.action === "created").length;
  const unchanged = log.filter((l) => l.action === "unchanged").length;
  console.log(
    `\n[seed-dev-fixture] Done. ${created} created, ${unchanged} already present.`,
  );
  console.log("\nFixture summary:");
  console.log(
    `  ALPHA (working-copy entry):  case ${ALPHA.caseNumber} (${ALPHA.caseId}) — donor ${ALPHA.donorFirst} ${ALPHA.donorLast}`,
  );
  console.log(
    `  BETA  (executed-copy entry): case ${BETA.caseNumber} (${BETA.caseId}) — donor ${BETA.donorFirst} ${BETA.donorLast}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-dev-fixture] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
