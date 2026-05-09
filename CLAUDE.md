# CLAUDE.md — TrueTest Labs Case Tracker

## Project status (as of 2026-04-16)

- **Case tracker:** Next.js 15 + Supabase (project `ydziufgdiqmikkmdxafx`) + Prisma 6 ORM. Deployed on Vercel (truetestlabs-projects). Active development.
- **Live website:** WordPress on GoDaddy at truetestlabs.com. Email: mgammel@truetestlabs.com.
- **New website:** Static HTML in `~/playground/truetest-site` (Cloudflare Pages). Not yet live.

## Build

- `npm run build` runs `prisma generate && next build`
- TypeScript/ESLint checks are **skipped in Vercel build** (`ignoreBuildErrors: true` in `next.config.ts`) to avoid OOM on Vercel workers. Run `npx tsc --noEmit` locally before pushing.
- After pulling schema changes, run `npx prisma generate` locally to refresh the client. TS errors referencing fields the schema clearly has are almost always stale-client issues — the Vercel build runs `prisma generate` automatically, so this only bites locally.
- If Vercel build fails in under 2 minutes, suspect an env var issue (not OOM). Check `npx vercel env ls`.

## Stack & key files

- **Auth:** Supabase SSR auth. Sidebar + pages require login.
- **Layout:** `ConditionalLayout.tsx` — sidebar hidden on mobile, hamburger drawer on small screens. Standalone routes (login, /intake, /kiosk, /checkin, /reports) skip sidebar.
- **Email:** Resend via `src/lib/email.ts`. `sendDraftEmail()` attaches PDFs from Supabase Storage.
- **SMS:** Twilio via `src/lib/sms.ts`. Local number `(231) 880-3966`. A2P 10DLC not yet registered — some carriers may filter messages.
- **Storage:** Supabase Storage via `src/lib/storage.ts`. `downloadFile()` returns `{ buffer }`.
- **AI:** Anthropic SDK via `src/lib/claude.ts` (claude-opus-4-5). `generateResultSummary()` and `generateMroSummary()` in `src/lib/resultSummary.ts`.
- **Test catalog:** Seeded via `prisma/seed.ts`. Seed does full `deleteMany()` then re-inserts. If FK constraints block the seed (e.g., MonitoringSchedule references), use SQL directly via Supabase MCP.
- **Email drafts:** Stored in `EmailDraft` table with `draftType`: `results`, `results_mro`, `results_mro_complete`. Draft body/subject editable and regenerable from the reminder bell modal.

## Key workflows

- **Phone Intake** (`/dashboard/phone-intake`): Staff booking flow. Sends SMS + email confirmation on book. Optimized for mobile — add to home screen for app-like use. Quick Intake (`/intake`) removed from sidebar.
- **Results email flow:** `POST /api/cases/[id]/compose-results` creates an `EmailDraft`. Staff reviews/edits in the reminder bell, then approves to send. MRO-complete drafts parse the MRO PDF with Claude on demand and cache the summary in `document.extractedData`.
- **MRO flow:** Upload correspondence doc → "Release MRO Report" button → creates draft with AI summary → attach MRO PDF + lab result PDF on send. Regenerate button in draft modal re-parses without resetting test status.
- **Document upload:** Two-step — client gets presigned URL from `/api/upload-url`, uploads directly to Supabase, then POSTs metadata to `/api/cases/[id]/documents` for parsing/AI summary/status advancement.

## Document types

`result_report`, `chain_of_custody`, `correspondence` (MRO reports), `other`, `court_order`, `invoice`, `agreement`

## Test order statuses (in order)

`order_created` → `awaiting_payment` → `payment_received` → `specimen_collected` → `sent_to_lab` → `results_received` / `results_held` → `results_released` → `at_mro` → `mro_released` → `closed`

## External services

- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (+12318803966)
- **Resend:** `RESEND_API_KEY`, `FROM_EMAIL`, `REPLY_TO_EMAIL`
- **Google Calendar:** `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`
- **Anthropic:** `ANTHROPIC_API_KEY`
- **Supabase:** `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Donor portal push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (server); `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (browser). Generate with `npx web-push generate-vapid-keys`.
- **Donor portal session:** `PORTAL_SESSION_SECRET` — HMAC key for the signed `ttl_portal_session` cookie. Generate with `openssl rand -hex 48`. Rotating this invalidates every existing donor session (safe fallback is to re-issue).
- **Vercel Cron:** `CRON_SECRET` — set matching secret on Vercel; cron routes 401 unless `Authorization: Bearer $CRON_SECRET` matches. Donor notification crons: `/api/cron/seed-notifications` (daily 11 UTC), `/api/cron/run-notifications` (every 5 min, 12–19 UTC).
- **App URL:** `NEXT_PUBLIC_APP_URL` — used in SMS/email bodies so donors can click through to `/portal`.

## Supabase Architecture

- **Browser bundle:** uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (new-system publishable key, format `sb_publishable_*`). Safe to ship to browsers because RLS is on for all public tables. Used only for Supabase Auth (login/logout/session) — never for direct table queries.
- **Server (Prisma):** all data reads/writes against `public.*` tables go through `DATABASE_URL` using the `postgres` role, which has BYPASSRLS. RLS does NOT apply to Prisma traffic.
- **Server (Storage):** `src/lib/storage.ts` uses `SUPABASE_SERVICE_ROLE_KEY` (new-system secret key, format `sb_secret_*`) for `/storage/v1/*` calls.
- **RLS posture:** all 26 public tables have RLS enabled with default-deny (no policies). PostgREST clients (anyone with the publishable key) cannot read or write public tables. Any future feature that wants browser-side direct queries against a public table requires writing a targeted RLS policy for that table.
- **Legacy API keys (HS256 anon JWT, HS256 service_role) are DISABLED** as of 2026-05-09. Do not re-enable them. The leaked `SUPABASE_ANON_JWT` value from commit `30d2842` is permanently invalid.

_Last reviewed: 2026-05-09_

## Domain & DNS

- truetestlabs.com is on GoDaddy (no Cloudflare). Edge redirects not possible until Pages cutover.
- After Pages cutover, `_redirects` in `truetest-site` is the canonical place for path redirects.

## Lab result PDFs — hard requirement

For **every** lab integration (USDTL and any future lab), we must retrieve and store the **unaltered, lab-produced final PDF** of the result report. That original PDF is what gets attached to client results emails, the MRO referral email, and stored in Supabase Storage as a `result_report` document. Never regenerate, re-render, or modify it. AI summaries live in the email body or a separate doc — the lab PDF passes through byte-for-byte. Note: lab reports are **not** signed — MRO signatures are a separate DOT-regulated step that happens downstream. If a lab can't provide the final PDF (only structured data), they aren't a viable partner.

## Donor portal auth (Phase A, 2026-04-19)

- **Flow:** PIN → (if new device) SMS 6-digit OTP to donor phone → HMAC-signed `ttl_portal_session` cookie (30d, HttpOnly/Secure/SameSite=Strict) + `ttl_portal_device` companion cookie (~13mo, holds the `TrustedDevice.deviceId`). On next visit, `/api/portal/session` auto-loads the session from the cookie — no PIN prompt.
- **Idle timeout:** server-side 4h window measured against `TrustedDevice.lastSeenAt`. If the donor's last portal request was >4h ago, the cookie is rejected and the PIN screen shows again. The TrustedDevice row stays put so OTP is still skipped on re-auth from the same browser. Tune via `SESSION_IDLE_TTL_SEC` in `src/lib/portalSession.ts`.
- **Lockout:** 5 cumulative OTP failures on a schedule → `MonitoringSchedule.pinLockedUntil = now+1h`, return 423. Cleared on next successful OTP.
- **Tarpit:** failed PIN/OTP attempts sleep progressively (500ms → 1s → 2.5s).
- **SMS OTP rate:** 3 code requests per phone per hour (Twilio bill shield).
- **Revoke device:** "Not my device" button on `/portal` calls `/api/portal/logout { revokeDevice: true }` → sets `TrustedDevice.revokedAt`; same browser will be forced through OTP next time. Staff can revoke a device via direct SQL today (UI follow-up).
- **Audit:** every login/otp/acknowledge event writes to `PortalLoginAttempt` (donor visitors aren't Users, so AuditLog doesn't fit). Indexed on `(scheduleId, createdAt)`, `(ipAddress, createdAt)`, `(createdAt)` for anomaly queries.
- **Headers:** HSTS, X-Frame-Options:DENY, CSP, Referrer-Policy, Permissions-Policy set for all routes via `next.config.ts`.
- **Middleware:** `/portal` and `/api/portal/*` are now in the public-paths list so Supabase staff auth doesn't intercept donor traffic.

## Date and time formatting

All Vercel/Node servers run UTC; every donor/client/staff-facing surface
should render in America/Chicago. **Always go through the helpers in
`src/lib/dateChicago.ts`.** Never call `.toLocaleDateString()`,
`.toLocaleTimeString()`, `.toLocaleString()`, or `Intl.DateTimeFormat`
directly without an explicit `timeZone` parameter — a formatter with no
`timeZone` uses the process TZ, which is UTC on Vercel and shifts every
stored instant 5-6h earlier on render.

Two categories of fields, two categories of helpers. They are **not**
interchangeable — mixing them up will cause dates to display off by one
day.

**Real instants** (stored as UTC timestamps of a real moment in time —
`createdAt`, `updatedAt`, `appointmentDate`, `collectionDate`,
`changedAt`, `uploadedAt`, `notifiedAt`, etc.). Use helpers that apply
`timeZone: "America/Chicago"`:

- `formatChicagoLongDate(d)` → `"Tuesday, April 21, 2026"`
- `formatChicagoMediumDate(d)` → `"April 21, 2026"` (attorney/court PDFs)
- `formatChicagoShortDate(d)` → `"Apr 21, 2026"`
- `formatChicagoShortDateNoYear(d)` → `"Apr 21"` (tight table columns)
- `formatChicagoTime(d)` → `"3:30 PM CT"`

**Date-keys** (stored as UTC midnight representing a Chicago calendar
day — `RandomSelection.selectedDate`, `MonitoringSchedule.startDate` /
`endDate`, anything written from an `<input type="date">` form value).
The stored UTC Y/M/D *is* the intended Chicago day, so these helpers
use `timeZone: "UTC"` to read the date as-is. Passing a date-key
through an instant formatter (or the reverse) shifts the output by a
day. Use:

- `formatChicagoLongDateKey(d)` → `"Tuesday, May 20, 2026"`
- `formatChicagoShortDateKey(d)` → `"May 20, 2026"` (no weekday, full month)
- `formatChicagoCompactDateKey(d)` → `"Mon, May 20"` (row labels)
- `chicagoDateKey(d)` → `"YYYY-MM-DD"` string

**No local time math on date fields.** In particular, do NOT write
`new Date(y, m, d, h, min)` in client components — the constructor
reads the host's local timezone, which makes the value
hydration-unstable (UTC during SSR on Vercel, donor's browser tz on
hydration). Either echo the donor's typed strings back directly, or
use `new Date(Date.UTC(...))` with an explicit intent.

## Schema migration checklist

When adding a new table via Prisma:
- [ ] After running the Prisma migration, also run `ALTER TABLE public."NewTableName" ENABLE ROW LEVEL SECURITY;` against the database. Prisma creates tables with RLS disabled by default; the project convention is RLS-on-by-default. Either include the ALTER in the same migration SQL or as an immediate follow-up via Supabase MCP.
- [ ] If the table needs to be readable/writable from the browser (rare — most paths go through Prisma server-side), write explicit RLS policies before deploying.

## Testing

This repo has no automated test suite. Every PR must include a manual
verification checklist covering the specific surfaces changed.
Date/time-sensitive changes should be verified at multiple times of day
to catch tz-edge bugs (specifically, evening CT hours when local and
UTC dates diverge).

## UI rules

Before editing any UI component: describe layout, colors, spacing, mobile behavior, and button states. Get approval before implementing.
