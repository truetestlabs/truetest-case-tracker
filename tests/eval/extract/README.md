# resultExtract eval harness

Manual-run baseline harness for `src/lib/resultExtract.ts`. Loads PDF lab
reports, calls `extractLabResultStructured` directly, compares against
hand-labeled JSON ground truth, and emits a pass/fail report.

This is **not** a unit test and is **not** wired into CI. Run it before
and after model/prompt changes (e.g. `LAB_RESULT_PARSER_VERSION` bumps)
to compare baselines.

## Layout

```
tests/eval/extract/
├── fixtures/   PDFs to evaluate against. Local-only — gitignored.
│               Never commit fixture PDFs; they contain donor PII.
├── truth/      One JSON per fixture, basename matches PDF basename
│               (<basename>.pdf → <basename>.json). Local-only —
│               gitignored. Truth JSON contains the same PII as
│               the source PDFs.
├── results/    Timestamped run artifacts. Local-only — gitignored.
│               Run output embeds extracted PDF fields and is
│               therefore PII-bearing. Each engineer keeps their
│               own local regression history.
├── types.ts    TypeScript types for the truth-file schema and
│               comparison output
├── compare.ts  Field-by-field comparator (see "Comparison rules")
├── runner.ts   Entry point — loads fixtures, calls extractor, runs
│               compare, prints table, writes results artifact
└── README.md   This file
```

## Running

```bash
npx tsx tests/eval/extract/runner.ts
```

That's it — no flags, no env exports needed.

The runner loads the Anthropic key from a project-root file called
`.env.eval` (gitignored). Format is the standard `KEY=value`, one per
line. Comments start with `#`. Currently only `ANTHROPIC_API_KEY` is
required.

### Why `.env.eval` instead of `.env`

Two reasons:

1. **The project's main `.env`** has a multiline
   `GOOGLE_SERVICE_ACCOUNT_KEY='{...JSON...}'` value that breaks Node's
   built-in env-file parser silently — it succeeds but populates
   nothing. The eval-only file holds just `ANTHROPIC_API_KEY` and parses
   cleanly.
2. **Claude Code's parent process** exports `ANTHROPIC_API_KEY=""`
   (empty) into the subshell environment for its own internal use. Node
   22's `process.loadEnvFile()` refuses to overwrite an env var that's
   already set, even when it's empty — so it would silently no-op the
   one variable we need. The harness therefore uses a manual loader
   (see `runner.ts`) that overrides unconditionally. This only matters
   when running inside Claude Code; outside, `loadEnvFile()` would have
   worked too. The override path is harmless either way.

### Setting up `.env.eval`

```bash
cd /path/to/truetest-case-tracker
echo 'ANTHROPIC_API_KEY=sk-ant-api03-...' > .env.eval
```

Or copy the value out of the project's main `.env`. The file is
`.gitignored`.

The runner prints a per-fixture summary, then a totals line, then writes
the full diff to `results/YYYY-MM-DD-baseline.json` (or
`-baseline-2.json`, `-3.json`, ... if you run multiple times in one
day). Every fixture's full set of field-level comparisons goes into that
JSON — terminal output only shows mismatches.

## Adding a fixture

1. Drop the PDF into `fixtures/` with a descriptive basename. Avoid
   spaces. The `fixtures/` directory is gitignored — store fixtures
   locally only.
2. Hand-label a `truth/<basename>.json` (see schema below). The
   `truth/` directory is gitignored too.
3. Re-run the harness. The new fixture appears in the output.

The runner ignores any PDF without a matching truth file (reports it as
ERROR with `truth file missing`).

## Truth-file schema

Mirrors `ExtractedLabResult` from `src/lib/resultExtract.ts`. All fields
optional except the `_meta` provenance block; omit fields the report
doesn't show rather than leaving them blank. `null` is allowed but means
"the report explicitly does not have this," which is treated identically
to the field being absent during comparison.

```json
{
  "_meta": {
    "source": "manual_label",
    "labeledBy": "<initials>",
    "labeledOn": "2026-04-25",
    "notes": "Optional free text"
  },
  "overallStatus": "negative",
  "reportedCollectionDate": "2026-01-10",
  "receivedAtLab": "2026-01-11",
  "reportDate": "2026-01-12",
  "labReportNumber": "<lab-report-number>",
  "labSpecimenId": "<lab-specimen-id>",
  "labName": "usdtl",
  "analytes": [
    {
      "name": "Phosphatidyl Ethanol (LCMSMS)",
      "result": "negative",
      "cutoff": "20 ng/mL",
      "value": null,
      "notes": null
    }
  ],
  "specimenValidity": null
}
```

Field reference (cribbed from the `ExtractedLabResult` type in
`src/lib/resultExtract.ts`):

| Field | Type | Notes |
|---|---|---|
| `overallStatus` | enum | `negative | positive | dilute | adulterated | invalid | mixed | mro_pending | mro_verified_negative | unknown` |
| `reportedCollectionDate` | YYYY-MM-DD | What the lab printed; not necessarily what we recorded. |
| `receivedAtLab` | YYYY-MM-DD | Lab accession date. |
| `reportDate` | YYYY-MM-DD | Date the lab finalized + released. |
| `mroVerificationDate` | YYYY-MM-DD | Only set when an MRO signed off. |
| `labReportNumber` | string | Lab-side accession / report number. Distinct from `labSpecimenId`. |
| `labSpecimenId` | string | The lab's specimen ID — sometimes "Specimen ID," "Control Number," or COC #. CRL prefixes with "X" — comparator strips that. |
| `labName` | enum | `usdtl | quest | crl | labcorp | nms | medipro | truetest_inhouse` |
| `analytes` | array | Every analyte the lab reported (positives AND negatives). Match by `name`. |
| `analytes[].name` | string | Human-readable substance name. Casefold-compared. |
| `analytes[].result` | enum | `negative | positive | inconclusive` |
| `analytes[].cutoff` | string | Cutoff with units, e.g. `"500 ng/mL"`. Optional. |
| `analytes[].value` | string | Quantitation with units, or `null` when below cutoff. |
| `analytes[].notes` | string | Free text. Optional. |
| `specimenValidity` | object \| null | Urine-only. Pass `null` for hair, blood, sweat patch. |
| `specimenValidity.creatinine` | string | e.g. `"31.6 mg/dL"`. |
| `specimenValidity.ph` | string | e.g. `"7.0"`. |
| `specimenValidity.status` | enum | `valid | dilute | adulterated | invalid` |

## Comparison rules

Locked, see `compare.ts`. Summary:

- **Dates**: parsed with `date-fns` (`parseISO` + `parse(MM/dd/yyyy)`).
  Day-only compare unless **both** sides include time-of-day, in which
  case full-timestamp compare. CRL date-only ↔ USDTL date-only matches
  even if the formats differ (`04/15/2026` ↔ `2026-04-15`). Genuinely
  wrong dates still mismatch.
- **Specimen IDs**: `specimenIdsMatch` from
  `src/lib/patchValidation.ts`. Strips leading non-digits before
  compare so CRL's `X12345` matches our `12345` (and vice versa).
- **Strings / enums**: trim → casefold → collapse internal whitespace,
  then strict equality. `"NEGATIVE"` matches `"negative "`.
- **Numbers**: when both sides parse as a finite number, strict `===`.
  `334` matches `334.0`. No tolerance.
- **Optional fields**: `null` / `undefined` / missing all collapse to
  the same "absent" state. `null` does **not** match `""`.
- **Analytes**: matched by normalized `name`. Per-analyte fields
  compared individually. Missing analytes → `parser_missed_field`,
  extras → `parser_added_field`, per-field disagreements → individual
  `mismatch` entries.

## Output shape

Per fixture:

```ts
{
  fixture: string,
  status: "pass" | "fail" | "error",
  fieldResults: Array<{
    field: string,                             // dotted path; analytes use bracket-name keys
    truth: unknown,
    actual: unknown,
    status: "match" | "mismatch" | "parser_missed_field" | "parser_added_field",
    reason?: string                            // e.g. "unparseable date"
  }>,
  errorMessage?: string                        // populated only on status: "error"
}
```

The full run artifact (`results/<date>-baseline.json`) wraps the per-fixture
results with the `parserVersion` at run time and a top-level `runAt` ISO
timestamp. That gives us a permanent record of "this is what
`resultExtract/v2-2026-04-14` produced on this fixture set on this day"
to diff against future versions.

## What this harness deliberately does not do

- **Doesn't bump `LAB_RESULT_PARSER_VERSION`** or modify
  `resultExtract.ts`. It exercises the current code only.
- **Doesn't query the database** for historical extracted output.
  Mike and the eval-design conversation rejected that path because
  silent extractor failures + LLM nondeterminism + missing CRL patch
  coverage made historical rows an unreliable baseline.
- **Doesn't run in CI**. Manual invocation only — running costs an
  Anthropic API call per fixture, and the results are interpreted by a
  human, not a test runner.
