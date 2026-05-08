# CLAUDE.md — TrueTest Labs Case Tracker

*as of 2026-05-08*

## Session behavior

Claude works as a sparring partner with autonomy on most tasks. Propose, then act. Don't ask permission for things Claude is confident about — file edits, new code, read-only terminal commands (`tsc`, `cat`, `grep`, `ls`, `git status`, `git log`, `git diff`), package installs (state the package name then proceed).

**Always confirm before:**

- Any database migration (`prisma migrate dev` or `deploy`)
- Any direct write to the production database (via Supabase MCP, SQL console, or otherwise)
- Any change to Vercel project settings or environment variables (Production, Preview, or Development scopes)
- Any `git push`, PR creation, or branch merge
- Modifying local `.env` or any environment variable
- Deleting any file or directory
- Bumping the Anthropic model version in any file
- Touching `resultExtract.ts` or `resultSummary.ts` — these produce forensic output for attorneys; describe the change plan first
- Any change to `middleware.ts` (auth/routing impact is high)

For UI work specifically: describe the intended layout, colors, spacing, mobile behavior, and button states in plain English before writing code. Wait for explicit approval.

## Handoff convention

Sessions producing commits, filed tickets, or significant decisions end with a handoff file at `~/.claude/handoffs/YYYY-MM-DD-<short-tag>.md`. Read the most recent handoff at session start to recover context.

**Format — brief first, log second.** The structure has six sections in this order:

1. `# EOD handoff — YYYY-MM-DD` (h1) followed by a one-line summary of the session.
2. `## Tomorrow, do this` — the decision or action waiting for tomorrow-you, with enough context to act on it without re-deriving.
3. `## Why <one-line title>` — the plot twist, reframing, or key insight from the session that tomorrow-you needs to remember.
4. `## What got shipped today` — commits, tickets filed, PR descriptions changed, real artifacts produced.
5. `## Open tickets state` — one-line per open ticket relevant to the active work.
6. `## Carried forward (not blocking, not urgent)` — deferred items so they don't get lost.

The "Tomorrow, do this" section sits at the top so tomorrow-you sees the answer before any context. Don't bury the lead.

## Project status

- **Case tracker:** Next.js 15 + Supabase (project `ydziufgdiqmikkmdxafx`) + Prisma 6 ORM. Deployed on Vercel (truetestlabs-projects).
- **Live website:** WordPress on GoDaddy at truetestlabs.com. Email: mgammel@truetestlabs.com.
- **New website:** Static HTML in `~/playground/truetest-site` (Cloudflare Pages). Not yet live.
- **Parallel system:** TestVault runs alongside the case tracker for at least one year. It handles parts the tracker doesn't (notably billing). No cutover planned in the near term.

## Build

- `npm run build` runs `prisma generate && next build`.
- TypeScript/ESLint checks are **skipped in Vercel build** (`ignoreBuildErrors: true` in `next.config.ts`) to avoid OOM on Vercel workers. Run `npx tsc --noEmit` locally before pushing.
- After pulling schema changes, run `npx prisma generate` locally to refresh the client. TS errors referencing fields the schema clearly has are almost always stale-client issues.
- If Vercel build fails in under 2 minutes, suspect an env var issue (not OOM). Check `npx vercel env ls`.
- **Schema sync on prod deploys:** `scripts/vercel-build.sh` runs `npx prisma db push --skip-generate` only when `VERCEL_ENV=production`. **Do not add `--accept-data-loss`** — destructive drift must fail the build, not silently rewrite prod. Phase 2 of the Prisma methodology (move to `prisma migrate deploy` for an audit trail) is owed.
- **Vercel Pro plan required** — `vercel.json` declares cron schedules that exceed Hobby's daily-only limit. Downgrade silently drops cron pushes.

## Stack & key files

- **Auth:** Supabase SSR auth. Sidebar + pages require login.
- **Layout:** `ConditionalLayout.tsx` — sidebar hidden on mobile, hamburger drawer on small screens. Standalone routes (login, /intake, /kiosk, /checkin, /reports) skip sidebar.
- **Email:** Resend via `src/lib/email.ts`. `sendDraftEmail()` attaches PDFs from Supabase Storage.
- **SMS:** Twilio via `src/lib/sms.ts`. Local number `(231) 880-3966`. A2P 10DLC not yet registered. **Bulk donor notification SMS is intentionally disabled** pending TCPA opt-in workflow — don't re-enable without confirming the opt-in design. Transactional SMS (phone-intake confirmations) is unaffected.
- **Storage:** Supabase Storage via `src/lib/storage.ts`. `downloadFile()` returns `{ buffer }`.
- **AI:** Anthropic SDK via `src/lib/claude.ts`. Models are pinned per call site, not centrally. To audit current models, run `grep -rn 'claude-' src/lib/`. When upgrading, update each call site explicitly. `generateResultSummary()` and `generateMroSummary()` live in `src/lib/resultSummary.ts`.
- **Test catalog:** `prisma/seed.ts` is a development seed only — **never run it against prod**. Prod has drifted ~20+ rows beyond seed.ts (catalog adds happen via direct SQL inserts, not seed updates). Tracked in issue #37. For prod catalog changes, write a one-off SQL migration via Supabase MCP. Seed still does `deleteMany()` then re-inserts, which is exactly why running it on prod would be catastrophic.
- **Email drafts:** Stored in `EmailDraft` table with `draftType`: `results`, `results_mro`, `results_mro_complete`. Body/subject editable and regenerable from the reminder bell modal.

## Eval harness

- Located at `tests/eval/extract/`.
- Batch-runs real lab result inputs through the extractor and verifies outputs against expected results.
- **Run before any change to `resultExtract.ts`, and before any Anthropic model version bump.** If the harness isn't passing cleanly, do not proceed.

## Known bugs

When a known bug requires Claude to know about it across sessions, document it here. Otherwise, file as a GitHub Issue. **None currently load-bearing for fresh sessions.**

## Key workflows

- **Phone Intake** (`/dashboard/phone-intake`): Staff booking flow. Sends SMS + email confirmation on book. Optimized for mobile — add to home screen for app-like use.
- **Results email flow:** `POST /api/cases/[id]/compose-results` creates an `EmailDraft`. Staff reviews/edits in the reminder bell, then approves to send. MRO-complete drafts parse the MRO PDF with Claude on demand and cache the summary in `document.extractedData`.
- **MRO flow:** Upload correspondence doc → "Release MRO Report" button → creates draft with AI summary → attach MRO PDF + lab result PDF on send. Regenerate button in draft modal re-parses without resetting test status.
- **Document upload:** Two-step — client gets presigned URL from `/api/upload-url`, uploads directly to Supabase, then POSTs metadata to `/api/cases/[id]/documents` for parsing/AI summary/status advancement.
- **Upload confirmation gates:** Chain-of-custody and result-report uploads run AI extraction first, then present an inline modal that requires the staff member to confirm extracted values (collection date, specimen ID) before the file is committed. Don't bypass — these are the human-in-the-loop checkpoint for AI extraction errors.
- **PEth >500 ng/mL handling:** When USDTL reports PEth as ">500 ng/mL" (upper-quantitation-limit hit), `resultSummary.ts` produces a standard summary plus a verbatim "Instrumental Value" addendum with a `[VALUE]` placeholder for the lab-reported text. Don't paraphrase the lab value — keep it byte-for-byte.

## Document types

`court_order`, `chain_of_custody`, `result_report`, `invoice`, `agreement`, `correspondence` (MRO reports), `monitoring_order`, `cancellation_notice`, `other`.

`chain_of_custody` documents additionally carry a `cocLifecycleStage` (`working_copy` / `executed` / `archived`) for sweat-patch flows; null for all other docs. See "Sweat patches" below.

## Test order statuses

Source of truth is the `TestStatus` enum in `prisma/schema.prisma`. Run `grep -A30 'enum TestStatus' prisma/schema.prisma` to see current values.

Typical urine drug test happy path:

`order_created` → `awaiting_payment` → `payment_received` → `order_released` → `awaiting_collection` → `specimen_collected` → `sent_to_lab` → `results_received` (or `results_held` if pay-on-release) → optionally `at_mro` → `mro_released` → `awaiting_payment_for_release` (only if `results_held`) → `results_released` → `closed`.

`cancelled` and `no_show` can terminate the flow at any point.

**Sweat patches do NOT follow this lifecycle** — see "Sweat patches" below.

## Sweat patches

Sweat patches are a separate test modality with their own lifecycle, lab, document flow, and data model.

- **Spec:** `docs/patch-workflow.md`. ADR: `docs/adr/0001-patch-data-model.md`.
- **Lab:** CRL (`Lab.crl`). Patches are `SpecimenType.sweat_patch`.
- **Data model:** `PatchDetails` (1:1 with `TestOrder`). Enums: `PatchPanel` (WA07 / WC82 are CRL panel codes), `PatchCancellationKind` (lab_cancelled, donor_removed, etc.), `CocLifecycleStage` (`working_copy` / `executed` / `archived`).
- **Lifecycle stages:** PENDING → WORN → AT_LAB → COMPLETE / CANCELLED. These are *derived* from `PatchDetails` fields (applicationDate, removalDate, executedDocumentId), not stored as a `testStatus`. **Patch test orders keep `testStatus = "order_created"` throughout** — the patch on the donor is not a "collected specimen." Lifecycle is computed in `src/lib/patchStatus.ts`.
- **CoC flow:** Two CoCs per patch — a **working copy** captured at application, then an **executed copy** captured at removal. The executed CoC mirrors `removalDate` to `TestOrder.collectionDate` (canonical schema bridge per `PatchDetails` model comment).
- **Cancellations:** Patches can be cancelled before lab analysis with a generated cancellation notice doc (`DocumentType.cancellation_notice`).
- **Legacy data:** ~10 pre-feature sweat patch TestOrders need `PatchDetails` backfill (issue #33).

## External services

- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (+12318803966).
- **Resend:** `RESEND_API_KEY`, `FROM_EMAIL`, `REPLY_TO_EMAIL`.
- **Google Calendar:** `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`.
- **Anthropic:** `ANTHROPIC_API_KEY`.
- **Supabase:** `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Donor portal push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (server); `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (browser). Generate with `npx web-push generate-vapid-keys`.
- **Donor portal session:** `PORTAL_SESSION_SECRET` — HMAC key for the signed `ttl_portal_session` cookie. Generate with `openssl rand -hex 48`. Rotating invalidates every existing donor session.
- **Vercel Cron:** `CRON_SECRET` — set matching secret on Vercel; cron routes 401 unless `Authorization: Bearer $CRON_SECRET` matches.
- **App URL:** `NEXT_PUBLIC_APP_URL` — used in SMS/email bodies so donors can click through to `/portal`.

Note: env vars are not uniformly configured across all Vercel environments. Local `.env`, Vercel Production, and Vercel Preview each have different gaps. See issue #35 (local `.env`) and #41 (Vercel Preview) for current state.

## Crons

Configured in `vercel.json`. Times are UTC (Vercel doesn't support per-cron timezone).

- `/api/cron/seed-notifications` — daily at 10 UTC (≈5a CT in DST / 4a CT in winter).
- `/api/cron/run-notifications` — every 5 minutes, 11–18 UTC. Firing window is 6:00 AM – 1:55 PM CT in DST and 5:00 AM – 12:55 PM CT in winter — covers all four 6a/8a/10a/12p CT escalation slots year-round.
- `/api/cron/create-test-orders` — daily at 9 and 10 UTC. DST-doubled so one firing lands at 4 AM CT year-round (the other runs an hour off — 5 AM CT in DST, 3 AM CT in winter). The endpoint must be idempotent. Disable with `CRON_CREATE_ORDERS_DISABLED=1`.

## Domain & DNS

- truetestlabs.com is on GoDaddy (no Cloudflare). Edge redirects not possible until Pages cutover.
- After Pages cutover, `_redirects` in `truetest-site` is the canonical place for path redirects.

## Lab result PDFs — hard requirement

For **every** lab integration, retrieve and store the **unaltered, lab-produced final PDF** of the result report. That original PDF is what gets attached to client results emails, the MRO referral email, and stored in Supabase Storage as a `result_report` document. Never regenerate, re-render, or modify it. AI summaries live in the email body or a separate doc — the lab PDF passes through byte-for-byte.

Labs currently in the `Lab` enum: `usdtl`, `crl`, `crl_quest`, `quest`, `expertox`, `nms`, `medipro`, `truetest_inhouse`. Active integrations today: USDTL (urine drug screen, digital text), CRL (sweat patch). Quest sometimes appears as the collection site for USDTL specimens.

Note: lab reports are not signed — MRO signatures are a separate DOT-regulated step that happens downstream. If a lab can't provide the final PDF (only structured data), they aren't a viable partner.

## Donor portal

**Native apps paused** — Capacitor iOS/Android wrap is dormant indefinitely. `PortalNativePushToken` model dropped. Don't reintroduce native scaffolding without an explicit go.

### Donor portal auth (Phase A, 2026-04-19)

- **Flow:** PIN → (if new device) SMS 6-digit OTP to donor phone → HMAC-signed `ttl_portal_session` cookie (30d, HttpOnly/Secure/SameSite=Strict) + `ttl_portal_device` companion cookie (~13mo, holds the `TrustedDevice.deviceId`). On next visit, `/api/portal/session` auto-loads the session from the cookie — no PIN prompt.
- **Idle timeout:** server-side 4h window measured against `TrustedDevice.lastSeenAt`. Tune via `SESSION_IDLE_TTL_SEC` in `src/lib/portalSession.ts`.
- **Lockout:** 5 cumulative OTP failures on a schedule → `MonitoringSchedule.pinLockedUntil = now+1h`, return 423. Cleared on next successful OTP.
- **Tarpit:** failed PIN/OTP attempts sleep progressively (500ms → 1s → 2.5s).
- **SMS OTP rate:** 3 code requests per phone per hour (Twilio bill shield).
- **Revoke device:** "Not my device" button on `/portal` calls `/api/portal/logout { revokeDevice: true }` → sets `TrustedDevice.revokedAt`. Staff can revoke a device via direct SQL today (UI follow-up).
- **Audit:** every login/otp/acknowledge event writes to `PortalLoginAttempt`. Indexed on `(scheduleId, createdAt)`, `(ipAddress, createdAt)`, `(createdAt)` for anomaly queries.
- **Headers:** HSTS, X-Frame-Options:DENY, CSP, Referrer-Policy, Permissions-Policy set for all routes via `next.config.ts`.
- **Middleware:** `/portal` and `/api/portal/*` are in the public-paths list so Supabase staff auth doesn't intercept donor traffic.

## Date and time formatting

All Vercel/Node servers run UTC; every donor/client/staff-facing surface should render in America/Chicago. **Always go through the helpers in `src/lib/dateChicago.ts`.** Never call `.toLocaleDateString()`, `.toLocaleTimeString()`, `.toLocaleString()`, or `Intl.DateTimeFormat` directly without an explicit `timeZone` parameter — a formatter with no `timeZone` uses the process TZ, which is UTC on Vercel and shifts every stored instant 5-6h earlier on render.

Two categories of fields, two categories of helpers. They are **not** interchangeable — mixing them up will cause dates to display off by one day.

**Real instants** (stored as UTC timestamps of a real moment in time — `createdAt`, `updatedAt`, `appointmentDate`, `collectionDate`, `changedAt`, `uploadedAt`, `notifiedAt`, etc.). Use helpers that apply `timeZone: "America/Chicago"`:

- `formatChicagoLongDate(d)` → `"Tuesday, April 21, 2026"`
- `formatChicagoMediumDate(d)` → `"April 21, 2026"` (attorney/court PDFs)
- `formatChicagoShortDate(d)` → `"Apr 21, 2026"`
- `formatChicagoShortDateNoYear(d)` → `"Apr 21"` (tight table columns)
- `formatChicagoTime(d)` → `"3:30 PM CT"`

**Date-keys** (stored as UTC midnight representing a Chicago calendar day — `RandomSelection.selectedDate`, `MonitoringSchedule.startDate` / `endDate`, anything written from an `<input type="date">` form value). The stored UTC Y/M/D *is* the intended Chicago day, so these helpers use `timeZone: "UTC"` to read the date as-is. Passing a date-key through an instant formatter (or the reverse) shifts the output by a day. Use:

- `formatChicagoLongDateKey(d)` → `"Tuesday, May 20, 2026"`
- `formatChicagoShortDateKey(d)` → `"May 20, 2026"`
- `formatChicagoCompactDateKey(d)` → `"Mon, May 20"` (row labels)
- `chicagoDateKey(d)` → `"YYYY-MM-DD"` string

**No local time math on date fields.** Do NOT write `new Date(y, m, d, h, min)` in client components — the constructor reads the host's local timezone, which makes the value hydration-unstable (UTC during SSR on Vercel, donor's browser tz on hydration). Either echo the donor's typed strings back directly, or use `new Date(Date.UTC(...))` with explicit intent.

## Testing

This repo has no automated test suite for the app itself (the eval harness covers extraction only). Every PR must include a manual verification checklist with itemized steps — specific enough that Colleen can follow them without interpretation. Don't write generic checklists ("verify the changed surfaces") — write the exact steps, expected outcomes, and any edge cases to check.

Date/time-sensitive changes must be verified at multiple times of day to catch tz-edge bugs (specifically, evening CT hours when local and UTC dates diverge).
