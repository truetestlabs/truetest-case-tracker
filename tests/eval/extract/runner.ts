/**
 * Eval harness for src/lib/resultExtract.ts — baseline runner.
 *
 * Loads each PDF in fixtures/, calls `extractLabResultStructured`
 * directly (no orchestrator, no DB), compares the result against the
 * matching truth/<basename>.json file, prints a terminal summary, and
 * writes a timestamped JSON artifact to results/.
 *
 * Usage:
 *   npx tsx tests/eval/extract/runner.ts
 *
 * This file does NOT modify resultExtract.ts. The model swap and
 * parser-version bump are item #5 of the sweat-patch rollout and
 * happen in a separate change. The eval harness exists to baseline
 * current behavior so we can measure the regression cost of the swap.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Eval-time env loader ─────────────────────────────────────────────
//
// Three things to know:
//
//   1. We use `.env.eval`, not `.env`. The project's `.env` contains a
//      multiline `GOOGLE_SERVICE_ACCOUNT_KEY='{...JSON...}'` value that
//      breaks naive env-file parsers. The eval-only file holds just
//      `ANTHROPIC_API_KEY` and stays simple.
//
//   2. The path is resolved relative to THIS file (3 dirs up:
//      tests/eval/extract/ → project root) so `npx tsx
//      tests/eval/extract/runner.ts` works from any cwd.
//
//   3. We CANNOT use Node's built-in `process.loadEnvFile()`. By
//      contract it refuses to overwrite an env var that's already
//      set, even when the existing value is empty. Claude Code's
//      parent process exports `ANTHROPIC_API_KEY=""` for its own
//      use, so loadEnvFile silently no-ops the very variable we
//      need. The loader below sets unconditionally — eval-time
//      override is the whole point of this file existing.
//
// Critically, this runs at module-top-level BEFORE the dynamic
// imports of `@/lib/resultExtract` and `./compare` below. Those are
// `await import()` calls inside `main()` so they happen after env
// is populated; if they were static imports they'd be hoisted and
// the Anthropic SDK would be constructed with the parent shell's
// empty key.
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", "..", "..", ".env.eval");
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Override unconditionally — see note (3) above.
      process.env[key] = value;
    }
  }
}

// Pure-data import is fine static. Code that touches process.env
// (resultExtract → claude.ts) is loaded dynamically inside main().
import type { FixtureResult, RunArtifact, TruthFile } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "fixtures");
const TRUTH_DIR = path.join(HERE, "truth");
const RESULTS_DIR = path.join(HERE, "results");

async function main() {
  // Dynamic imports — pulled here so the env loader above has already
  // populated process.env before claude.ts constructs the Anthropic
  // client. Static imports would hoist past the loader.
  const { extractLabResultStructured, LAB_RESULT_PARSER_VERSION } =
    await import("@/lib/resultExtract");
  const { compareExtractedLabResult } = await import("./compare");
  type ExtractedLabResult = Awaited<
    ReturnType<typeof extractLabResultStructured>
  >;

  if (!existsSync(FIXTURES_DIR)) {
    console.error(`No fixtures directory: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  await mkdir(RESULTS_DIR, { recursive: true });

  const fixtures = (await readdir(FIXTURES_DIR))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (fixtures.length === 0) {
    console.log(
      "No fixtures found in fixtures/. Place PDFs there and rerun.",
    );
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "[warn] ANTHROPIC_API_KEY is not set. Every fixture will fail because the extractor short-circuits to null.\n" +
        "       Add it to `.env.eval` in the project root, or export it in your shell.\n",
    );
  }

  console.log(
    `Running ${fixtures.length} fixture(s) against ${LAB_RESULT_PARSER_VERSION}\n`,
  );

  const results: FixtureResult[] = [];
  for (const filename of fixtures) {
    const baseName = filename.replace(/\.pdf$/i, "");
    process.stdout.write(`  ${baseName} ... `);

    const truthPath = path.join(TRUTH_DIR, baseName + ".json");
    if (!existsSync(truthPath)) {
      console.log("ERROR (no truth file)");
      results.push({
        fixture: baseName,
        status: "error",
        fieldResults: [],
        errorMessage: `truth file missing: truth/${baseName}.json`,
      });
      continue;
    }

    let truth: TruthFile;
    try {
      truth = JSON.parse(await readFile(truthPath, "utf8")) as TruthFile;
    } catch (e) {
      console.log("ERROR (truth parse failed)");
      results.push({
        fixture: baseName,
        status: "error",
        fieldResults: [],
        errorMessage: `truth file unreadable: ${(e as Error).message}`,
      });
      continue;
    }

    const pdfBuffer = await readFile(path.join(FIXTURES_DIR, filename));

    let actual: ExtractedLabResult;
    try {
      actual = await extractLabResultStructured(pdfBuffer);
    } catch (e) {
      console.log("ERROR (extractor threw)");
      results.push({
        fixture: baseName,
        status: "error",
        fieldResults: [],
        errorMessage: `extractor threw: ${(e as Error).message}`,
      });
      continue;
    }

    const fieldResults = compareExtractedLabResult(truth, actual);
    const anyMismatch = fieldResults.some((f) => f.status !== "match");
    const status = anyMismatch ? "fail" : "pass";
    results.push({ fixture: baseName, status, fieldResults });
    console.log(status.toUpperCase());
  }

  console.log();
  printTable(results);

  // Avoid clobbering: append -2, -3, ... if today's file already exists.
  const today = new Date().toISOString().slice(0, 10);
  let outName = `${today}-baseline.json`;
  let counter = 2;
  while (existsSync(path.join(RESULTS_DIR, outName))) {
    outName = `${today}-baseline-${counter}.json`;
    counter += 1;
  }
  const outPath = path.join(RESULTS_DIR, outName);

  const artifact: RunArtifact = {
    runAt: new Date().toISOString(),
    parserVersion: LAB_RESULT_PARSER_VERSION,
    fixtures: results,
  };
  await writeFile(outPath, JSON.stringify(artifact, null, 2));
  console.log(
    `Full diff written to ${path.relative(process.cwd(), outPath)}\n`,
  );
}

function printTable(results: FixtureResult[]) {
  const nameWidth = Math.max(
    "Fixture".length,
    ...results.map((r) => r.fixture.length),
  );
  const sep = "─".repeat(nameWidth + 30);
  console.log(sep);
  console.log(
    pad("Fixture", nameWidth) + "  " + pad("Status", 6) + "  Detail",
  );
  console.log(sep);

  for (const r of results) {
    if (r.status === "error") {
      console.log(
        pad(r.fixture, nameWidth) +
          "  " +
          pad("ERROR", 6) +
          "  " +
          (r.errorMessage ?? "<no message>"),
      );
      continue;
    }
    const total = r.fieldResults.length;
    const off = r.fieldResults.filter((f) => f.status !== "match").length;
    const detail =
      r.status === "pass"
        ? `${total} fields matched`
        : `${off} of ${total} fields off`;
    console.log(
      pad(r.fixture, nameWidth) +
        "  " +
        pad(r.status.toUpperCase(), 6) +
        "  " +
        detail,
    );
    if (r.status === "fail") {
      for (const f of r.fieldResults.filter((f) => f.status !== "match")) {
        console.log(
          "    " +
            f.status.padEnd(20) +
            f.field +
            "  truth=" +
            JSON.stringify(f.truth) +
            "  actual=" +
            JSON.stringify(f.actual) +
            (f.reason ? `  (${f.reason})` : ""),
        );
      }
    }
  }
  console.log(sep);

  const passCount = results.filter((r) => r.status === "pass").length;
  const failCount = results.filter((r) => r.status === "fail").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  console.log(
    `pass: ${passCount}  fail: ${failCount}  error: ${errorCount}`,
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
