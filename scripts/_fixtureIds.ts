/**
 * Shared deterministic IDs for the dev-branch fixture scripts
 * (seed-dev-fixture.ts, teardown-dev-fixture.ts). Single source of truth
 * for the ALPHA/BETA fixture row identities so the seed inserts and the
 * teardown deletes never drift out of sync.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why hashed slugs instead of raw slugs as PKs
 * ──────────────────────────────────────────────────────────────────────
 *
 * Earlier fixture rows used the slugs themselves as primary keys
 * (e.g. `id: "seed_dev_case_beta"`). That broke the upload flow:
 * src/lib/validation/schemas.ts enforces `caseId.length >= 20` on the
 * /api/upload-url request body, and the short slugs (18-19 chars) failed
 * the gate. Every CoC upload attempt against a seeded case 400'd before
 * the file ever left the browser.
 *
 * The fix here keeps idempotency (the seed re-runs against the same IDs)
 * while satisfying the validator: hash the slug to a 25-char CUID-shaped
 * string. Same slug always produces the same ID, so re-running the seed
 * upserts in place, and the teardown can rediscover the rows by hashing
 * the same slugs.
 *
 * Contacts retain raw-slug PKs because Contact IDs never flow through
 * the >=20-char gate (they're internal to the Case graph). Cases,
 * TestOrders, PatchDetails, and Documents all migrate to hashed IDs.
 */
import { createHash } from "crypto";

/**
 * Deterministic CUID-shaped ID for dev fixture rows. Produces a 25-char
 * string starting with 'c' (matching CUID's first-letter convention),
 * suitable for any Prisma model whose `id` column uses @default(cuid()).
 * Pure: same `slug` always returns the same ID.
 */
export function fixtureId(slug: string): string {
  return "c" + createHash("sha256").update(slug).digest("hex").slice(0, 24);
}

// Specimen IDs use a 9-digit numeric format mirroring real CRL sweat-patch
// accession numbers (e.g. "762296171"). The 999-prefix range is clearly
// synthetic — no real CRL specimen would start with 999 — while still
// passing through specimenIdsMatch (src/lib/patchValidation.ts:262-287),
// which strips leading non-digits and compares as strings. A non-numeric
// fixture specimenId would silently fail every PDF specimen-ID compare.
export const ALPHA = {
  // Contact PK stays as the raw slug — Contact IDs don't flow through
  // the upload-url validator.
  contactId: "seed_dev_contact_alpha",
  caseId: fixtureId("seed_dev_case_alpha"),
  caseNumber: "TTL-DEV-SEED-0001",
  testOrderId: fixtureId("seed_dev_to_alpha"),
  patchDetailsId: fixtureId("seed_dev_pd_alpha"),
  donorFirst: "Test Donor",
  donorLast: "Alpha",
  specimenId: "999000001",
} as const;

export const BETA = {
  contactId: "seed_dev_contact_beta",
  caseId: fixtureId("seed_dev_case_beta"),
  caseNumber: "TTL-DEV-SEED-0002",
  testOrderId: fixtureId("seed_dev_to_beta"),
  patchDetailsId: fixtureId("seed_dev_pd_beta"),
  workingCopyDocId: fixtureId("seed_dev_doc_beta_working_copy"),
  donorFirst: "Test Donor",
  donorLast: "Beta",
  specimenId: "999000002",
} as const;

/**
 * Shared TestCatalog row for the CRL sweat-patch panel both fixtures use.
 * Required because TestOrder.testCatalogId being null triggers the
 * "Action required — test selection incomplete" banner via
 * needsStaffSelection() (src/lib/case-utils.ts:90). The dev branch's
 * TestCatalog table doesn't ship with a CRL sweat_patch row by default
 * (prisma/seed.ts:121 declares one, but dev was seeded before that
 * entry was added and never re-seeded), so the fixture owns its own
 * row to stay runnable on a fresh dev branch.
 *
 * The testName carries "(CRL — dev fixture)" so it's visually
 * distinguishable from any real CRL sweat_patch row added later.
 */
export const CATALOG_CRL_SWEAT_PATCH_ID = fixtureId(
  "seed_dev_catalog_crl_sweat_patch",
);

/**
 * All fixture row IDs grouped by model, for teardown's per-model
 * `deleteMany({ where: { id: { in: [...] } } })` calls. Listing them
 * explicitly is more precise than a prefix-startsWith filter and removes
 * the brittle assumption that every fixture PK shares a literal prefix.
 */
export const FIXTURE_IDS = {
  contact: [ALPHA.contactId, BETA.contactId],
  case: [ALPHA.caseId, BETA.caseId],
  testOrder: [ALPHA.testOrderId, BETA.testOrderId],
  patchDetails: [ALPHA.patchDetailsId, BETA.patchDetailsId],
  document: [BETA.workingCopyDocId],
  testCatalog: [CATALOG_CRL_SWEAT_PATCH_ID],
} as const;
