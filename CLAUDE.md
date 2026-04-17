# CLAUDE.md — TrueTest Labs Case Tracker

## Project status (as of 2026-04-16)

- **Case tracker:** Next.js 15 + Supabase (project `ydziufgdiqmikkmdxafx`) + Prisma 6 ORM. Deployed on Vercel (truetestlabs-projects). Active development.
- **Live website:** WordPress on GoDaddy at truetestlabs.com. Email: mgammel@truetestlabs.com.
- **New website:** Static HTML in `~/playground/truetest-site` (Cloudflare Pages). Not yet live.

## Build

- `npm run build` runs `prisma generate && next build`
- TypeScript/ESLint checks are **skipped in Vercel build** (`ignoreBuildErrors: true` in `next.config.ts`) to avoid OOM on Vercel workers. Run `npx tsc --noEmit` locally before pushing.
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

## AI phone agent (Phase 1)

Inbound calls to Phone.com ring Matt + Colleen first; after no-answer they forward to a Twilio number wired to this app. The agent greets, takes a message, classifies intent/segment/urgency, texts the caller a confirmation, and logs everything to `CallLog`.

- **Routes:** `POST /api/voice/incoming` (TwiML entrypoint), `POST /api/voice/turn?callLogId=...` (per-utterance), `POST /api/voice/status` (completion callback). All three validate `X-Twilio-Signature`.
- **Agent lib:** `src/lib/voiceAgent.ts` — system prompt, tool definitions (`take_message`, `end_call`), per-turn Claude loop (Haiku 4.5) + post-call summary (Sonnet 4.6).
- **TTS:** Twilio `<Say voice="Polly.Joanna-Neural">`. Good enough for Phase 1; upgrade to ElevenLabs or OpenAI Realtime (Phase 2) when we want lower latency and more natural prosody — requires a companion WebSocket service since Vercel serverless can't hold persistent streams.
- **Dashboard:** `/dashboard/calls` — staff-visible transcript, summary, outcome, recap status.
- **Extra env:** `STAFF_NOTIFY_NUMBERS` (comma-separated E.164, optional — each gets an SMS summary after every completed call). Set `VOICE_SKIP_SIGNATURE=1` for local ngrok testing only.
- **Twilio setup:** on the inbound voice number, set Voice webhook → `https://<app>/api/voice/incoming` (POST), Status Callback → `https://<app>/api/voice/status` (POST, event `completed`).
- **DOT/HIPAA posture:** agent never reads results aloud and doesn't confirm whether a specific person is a client. It takes a message and routes to the MRO for any result discussion.

## Domain & DNS

- truetestlabs.com is on GoDaddy (no Cloudflare). Edge redirects not possible until Pages cutover.
- After Pages cutover, `_redirects` in `truetest-site` is the canonical place for path redirects.

## Lab result PDFs — hard requirement

For **every** lab integration (USDTL and any future lab), we must retrieve and store the **unaltered, lab-produced final PDF** of the result report. That original PDF is what gets attached to client results emails, the MRO referral email, and stored in Supabase Storage as a `result_report` document. Never regenerate, re-render, or modify it. AI summaries live in the email body or a separate doc — the lab PDF passes through byte-for-byte. Note: lab reports are **not** signed — MRO signatures are a separate DOT-regulated step that happens downstream. If a lab can't provide the final PDF (only structured data), they aren't a viable partner.

## UI rules

Before editing any UI component: describe layout, colors, spacing, mobile behavior, and button states. Get approval before implementing.
