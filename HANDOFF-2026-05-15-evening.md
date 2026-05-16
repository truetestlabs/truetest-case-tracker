# HANDOFF — 2026-05-15 evening

## What shipped today

PR #61 — `fix: Denver-TZ regression in EditTestOrderModal patch + collectionDate inputs`. Merged. Consolidated 4 date inputs onto `parseIsoDateUtcNoon` (12:00Z convention), lifted the helper from `documents/route.ts` to `src/lib/dateChicago.ts`, added TZ-independent unit test. Closes part of B3 scope.

## What we walked away from

PR #64 (minimal backfill, replacement for PR #59) is ready to run on prod but didn't execute — session ended at the credentials-setup step. Pick this up next session.

## PRs in flight (your move)

| PR  | Branch                                       | Status                                      | Hands-on needed                                                                 |
|-----|----------------------------------------------|---------------------------------------------|---------------------------------------------------------------------------------|
| #64 | `chore/backfill-orphan-patchdetails-minimal` | Open, dev-verified (script byte-identical to old #59) | Set prod creds, run 4-step runbook in PR body, post-run SQL check, merge |
| #60 | (specimen-id persist)                        | Open, dev tests green                       | BLOCKED on Issue #63 (parser bug). Don't merge until parser confirmed correct.   |
| #54 | (cancel-patch-date-fix)                      | Open, claimed shipped                       | UNKNOWN actual contents. Memory was wrong about #54 once. Verify diff before walking. |

## Issues filed today

- **#62** — appointmentDate hour-preservation in EditTestOrderModal (deferred from PR #61; ~4 line fix to preserve existing instant's H/M)
- **#63** — CoC parser extracts wrong field (account number stored as specimenId). Labeled `blocks-pr-60`.
- Badge-inconsistency bug filed in this session-end batch (see issue created alongside this handoff).

## PR #59 was closed — major architectural trap caught

Original PR #59 advertised "one-off backfill script" but the diff had 5 files. Four of them (`patchDateInput.ts`, schema doc comments, cancel-patch route wiring, test file) implemented a competing 17/18Z convention that directly contradicted PR #61's 12Z consolidation. Merging it would have re-introduced the bug PR #61 fixed. Closed. The backfill script was extracted into PR #64. If the cancel-patch validation idea is revisited, it should route through `parseIsoDateUtcNoon`, not introduce a competing helper.

## What was learned

### Codebase
- **`parsePatchDateInput` never existed in main.** It lived only on the unmerged PR #59 branch. The original handoff and memory claiming it as canonical were wrong from the start (or aspirational about #59 merging). Memory and auto-memory now corrected.
- **Date convention is settled at 12:00Z**, written via `parseIsoDateUtcNoon` exported from `src/lib/dateChicago.ts`. Only outstanding buggy site: `EditTestOrderModal.tsx:128` (appointmentDate, intentional, tracked in #62).
- **`replacementPatchDate` pipeline is clean.** Verified: `CancelPatchModal.tsx:141` → `cancel-patch/route.ts:128` → `patchStatus.ts:199` uses correct `T12:00:00Z` literal throughout. The "cancel-patch/route.ts:128 latent bug" claim in the original handoff was wrong.
- **PatchDetails date columns use Postgres `timestamp without time zone`.** UTC interpretation is an unwritten codebase convention enforced only by Prisma. Anything reading these columns outside Prisma must know this contract. Noted on #58 audit.
- **56 orphan CoC documents on prod** (CoC uploaded, specimenId null). Distribution: 27 urine, 12 hair, 7 blood, 10 sweat patch. Backfill plan deferred until Issue #63 (parser bug) is resolved — otherwise backfill would systematically write account numbers as specimen IDs.

### Methodological
- **`gh pr view <n> --json files` is the source of truth, not the PR body.** Three handoff/memory/PR-body claims turned out to be wrong on closer inspection today (PR scope, helper name, cancel-patch bug). Verify diff scope before reading description.
- **Pre-merge sparring caught real bugs twice.** PR #61's "no behavior change in Chicago" claim was wrong by 5 hours. PR #59's scope creep + architectural conflict was caught by reading the diff after sparring on idempotency/rollback.
- **Auto-memory drifts too.** Claude Code's session memory (`memory/truetest_date_conventions.md`, `memory/MEMORY.md`) had the same staleness as repo handoffs. The "always verify against current main" rule applies to all persistent context.

## Things to NOT trust in this handoff

- The Issue #63 parser-bug diagnosis is based on one user-uploaded CoC where the system renamed it to "758200003 steven novit.pdf" (account number, not specimen ID). The file was originally named correctly, so the system did the renaming. But: parser code path not actually read yet. Verify before deciding scope of #60 fix.
- PR #54's actual contents are unknown — memory was wrong about it once.

## Memory entries updated this session

- **#22** — Date convention corrected to 12:00Z via `parseIsoDateUtcNoon` in `src/lib/dateChicago.ts`. Removed wrong `cancel-patch/route.ts:128` claim. Noted appointmentDate as remaining buggy site (intentional, tracked in #62).
- **#23** (new) — PR #64 pending prod execution, resume-from-credentials-setup state captured.
- **Auto-memory** (in Claude Code session, not repo): `truetest_date_conventions.md` rewritten to reflect post-PR #61 state. `MEMORY.md` line 13 fixed (canonical/legacy assignment was reversed). Added "this writer does not exist" callout to prevent re-propagation of phantom helper.

## Next session priorities (in order)

1. **PR #64 prod execution.** Resume at credentials setup: open Vercel → reveal prod `DATABASE_URL` and `DIRECT_URL` → fresh terminal → set env vars → sanity-check the project ref → run 4-step runbook (dry-run, live with `tee`, idempotency, SQL verification). Expected numbers: 10 / 10 / 0 / 0. Then merge #64.
2. **Investigate Issue #63 — CoC parser.** Find where it reads `specimenId` from. Likely PDF text extraction in `documents/route.ts` or `src/lib/coc/`. Determine if reading the wrong region of the form. Decide: fix parser before #60 merges, or rescope #60.
3. **Walk PR #60.** After #63 is understood. May need scope adjustment.
4. **Verify PR #54's actual scope.** Run `gh pr view 54 --json files` before assuming.
5. **Walk PR #54.** Address contents based on what's actually there.
6. **Draft PR-B3 spec.** Open questions to resolve in the spec drafting itself:
   - Which `documentType` values write to `workingCopyDocumentId` vs `executedDocumentId`?
   - Does the removal CoC have its own working-copy → executed flow, or is it single-step?
   - Consequence for B3 design (add columns / change semantics / wire to existing schema as-is).

## Tech debt acknowledged

- `EditTestOrderModal.tsx:128` — appointmentDate clobbers H/M on date-only edits. Tracked in #62. Customer-facing (confirmation emails).
- `cocLifecycleStage` on Document is null on all 56 audited rows. Either live bug (intended to be written, isn't) or dead schema. Same family as Issue #58.
- Storage.ts privilege escalation (memory #19) still deferred. Acceptable for trusted-staff-only access today.
- Vercel Preview deployments connect to PROD Supabase (memory #17). Never use preview URLs for data-touching tests until explicitly overridden.
- PRs #60 and #54 are unrebased against main post-PR #61. Likely conflicts when next walked. Resolve during walkthrough, not preemptively.
