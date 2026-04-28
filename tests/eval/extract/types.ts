/**
 * Shared types for the resultExtract.ts eval harness.
 *
 * Truth files are JSON, one per fixture, named to match the PDF
 * basename (e.g. `<basename>.pdf` ↔ `<basename>.json`).
 * Their schema mirrors `ExtractedLabResult` from src/lib/resultExtract.ts,
 * with one extra top-level `_meta` field for provenance. Optional
 * fields can be omitted; null/undefined/missing are treated as
 * equivalent during comparison.
 */
import type { ExtractedLabResult } from "@/lib/resultExtract";

export type TruthMeta = {
  source: "manual_label";
  labeledBy: string;
  labeledOn: string; // ISO 8601 date — YYYY-MM-DD
  notes?: string; // optional free-text — e.g. ambiguous fields the labeler chose to skip
};

// All ExtractedLabResult fields are required-or-optional per the source
// schema. We loosen `analytes` from required to optional here so labelers
// can omit it on weird reports — the runner treats missing as "no
// analytes labeled," and a parser that produces analytes would surface
// them as parser_added_field.
export type TruthFile = Partial<Omit<ExtractedLabResult, "analytes">> & {
  analytes?: ExtractedLabResult["analytes"];
  _meta: TruthMeta;
};

export type FieldStatus =
  | "match"
  | "mismatch"
  | "parser_missed_field"
  | "parser_added_field";

export type FieldResult = {
  field: string; // dotted path; analytes use bracket-name keys e.g. analytes[Cocaine].result
  truth: unknown;
  actual: unknown;
  status: FieldStatus;
  reason?: string; // optional — e.g. "unparseable date", "extractor returned null"
};

export type FixtureResult = {
  fixture: string;
  status: "pass" | "fail" | "error";
  fieldResults: FieldResult[];
  errorMessage?: string; // populated only when status === "error"
};

export type RunArtifact = {
  runAt: string; // ISO 8601 timestamp of the run
  parserVersion: string; // copied from LAB_RESULT_PARSER_VERSION at run time
  fixtures: FixtureResult[];
};
