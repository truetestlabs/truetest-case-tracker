/**
 * Shared prod-guard for the dev-branch fixture scripts
 * (seed-dev-fixture.ts, teardown-dev-fixture.ts). Canonical home of the
 * Supabase-project-ref parsing and refusal logic — both scripts import
 * from here rather than duplicating definitions.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Prod-guard behavior
 * ──────────────────────────────────────────────────────────────────────
 *
 * Before any DB activity, the caller invokes guardProd(). The guard
 * parses the project ref out of DATABASE_URL and:
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

export const PROD_PROJECT_REF = "ydziufgdiqmikkmdxafx";
const KNOWN_DEV_PROJECT_REF = "dbgiinfiddvnbpwcagml";

export function extractProjectRef(databaseUrl: string): string | null {
  // Pooler URL: postgresql://postgres.<ref>:<pwd>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
  const poolerMatch = databaseUrl.match(/postgres\.([a-z0-9]{20})/i);
  if (poolerMatch) return poolerMatch[1].toLowerCase();
  // Direct URL: postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres
  const directMatch = databaseUrl.match(/db\.([a-z0-9]{20})\.supabase\.co/i);
  if (directMatch) return directMatch[1].toLowerCase();
  return null;
}

export interface GuardProdOptions {
  /** Used as the bracketed log prefix, e.g. "seed-dev-fixture". */
  scriptName: string;
  /** Verb phrase in the prod-refusal message: "seed prod" / "tear down prod". */
  prodRefuseVerb: string;
  /** Verb phrase in the unknown-ref warning: "seeding into" / "tearing down on". */
  unknownRefVerb: string;
}

export function guardProd(opts: GuardProdOptions): void {
  const { scriptName, prodRefuseVerb, unknownRefVerb } = opts;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`[${scriptName}] DATABASE_URL is unset. Aborting.`);
    process.exit(1);
  }
  const ref = extractProjectRef(url);
  if (!ref) {
    console.error(
      `[${scriptName}] Could not parse a Supabase project ref from DATABASE_URL. Aborting.`,
    );
    process.exit(1);
  }
  if (ref === PROD_PROJECT_REF) {
    console.error(
      `[${scriptName}] DATABASE_URL points at PROD (${ref}). Refusing to ${prodRefuseVerb}. Aborting.`,
    );
    process.exit(1);
  }
  if (ref !== KNOWN_DEV_PROJECT_REF) {
    if (process.env.SEED_ALLOW_NON_DEV_REF !== "true") {
      console.error(
        `[${scriptName}] DATABASE_URL points at ref "${ref}", which is neither prod (${PROD_PROJECT_REF}) nor the known dev branch (${KNOWN_DEV_PROJECT_REF}). Set SEED_ALLOW_NON_DEV_REF=true to override. Aborting.`,
      );
      process.exit(1);
    }
    console.warn(
      `[${scriptName}] WARNING: ${unknownRefVerb} unknown ref "${ref}" because SEED_ALLOW_NON_DEV_REF=true.`,
    );
  } else {
    console.log(`[${scriptName}] Target ref ${ref} (known dev branch). Proceeding.`);
  }
}
