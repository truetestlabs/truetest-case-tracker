/**
 * Determinism check — run the same fixture through the parser twice
 * in immediate succession and diff the two outputs.
 *
 * Usage:
 *   npx tsx tests/eval/extract/diff-twice.ts <FIXTURE_BASENAME> [<FIXTURE_BASENAME> ...]
 *
 * Example:
 *   npx tsx tests/eval/extract/diff-twice.ts FIXTURE_A FIXTURE_B
 *
 * Saves run-A and run-B JSON next to each other in /tmp and prints
 * a unified diff. Both calls go to the same identical Buffer; no
 * file I/O between them.
 *
 * One-off helper for confirming the nondeterminism finding from
 * Phase 6. Not part of the standard harness flow.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Same env loader as runner.ts.
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
      process.env[key] = value;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx diff-twice.ts <FIXTURE_BASENAME> [...]");
    process.exit(1);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.join(here, "fixtures");

  const { extractLabResultStructured } = await import("@/lib/resultExtract");

  for (const fixtureName of args) {
    const pdfPath = path.join(fixturesDir, fixtureName + ".pdf");
    if (!existsSync(pdfPath)) {
      console.error(`No fixture: ${pdfPath}`);
      continue;
    }
    const buffer = await readFile(pdfPath);
    console.log(`\n=== ${fixtureName} ===`);

    process.stdout.write("  call A ... ");
    const a = await extractLabResultStructured(buffer);
    console.log(a ? "ok" : "null");

    process.stdout.write("  call B ... ");
    const b = await extractLabResultStructured(buffer);
    console.log(b ? "ok" : "null");

    const aPath = `/tmp/${fixtureName}.run-A.json`;
    const bPath = `/tmp/${fixtureName}.run-B.json`;
    await writeFile(aPath, JSON.stringify(a, null, 2));
    await writeFile(bPath, JSON.stringify(b, null, 2));

    // Use system `diff -u` for readable output.
    const diff = spawnSync("diff", ["-u", aPath, bPath], { encoding: "utf8" });
    if (diff.status === 0) {
      console.log("  IDENTICAL — no drift on this run");
    } else {
      console.log("  DRIFT detected:");
      console.log(diff.stdout);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
