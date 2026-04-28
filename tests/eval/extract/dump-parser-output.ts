/**
 * Dump raw parser output for every fixture to a single JSON file.
 *
 * Usage:
 *   npx tsx tests/eval/extract/dump-parser-output.ts
 *
 * Produces tests/eval/extract/parser-dump.json with shape:
 *   { [fixtureBaseName]: ExtractedLabResult | null }
 *
 * Used during Phase 5 of truth-file authoring so we can see what the
 * parser actually produces for each fixture without going through the
 * comparator. NOT part of the standard harness flow; one-off helper.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Same env loader as runner.ts. See runner.ts for why we don't use
// process.loadEnvFile() directly.
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
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.join(here, "fixtures");
  const outPath = path.join(here, "parser-dump.json");

  const { extractLabResultStructured } = await import(
    "@/lib/resultExtract"
  );

  const fixtures = (await readdir(fixturesDir))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  const dump: Record<string, unknown> = {};
  for (const filename of fixtures) {
    const baseName = filename.replace(/\.pdf$/i, "");
    process.stdout.write(`  ${baseName} ... `);
    const buffer = await readFile(path.join(fixturesDir, filename));
    const result = await extractLabResultStructured(buffer);
    dump[baseName] = result;
    console.log(result ? "ok" : "null");
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(dump, null, 2));
  console.log(`\nDump written to ${path.relative(process.cwd(), outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
