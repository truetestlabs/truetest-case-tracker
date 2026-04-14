# CLAUDE.md — TrueTest Labs Project Context

## Project status (as of 2026-04-11)

- **Live website:** WordPress on GoDaddy hosting at truetestlabs.com. DNS managed by GoDaddy (no Cloudflare proxy in front). Email: mgammel@truetestlabs.com.
- **New website:** Static HTML site for Cloudflare Pages in `~/playground/truetest-site` (GitHub: truetestlabs/truetest-site). NOT YET LIVE — cutover from WordPress is pending. The `_redirects` file at the repo root handles legacy WordPress URL forwards and is the right place to add path-based redirects (e.g., `/book` → Square) on cutover day.
- **Case tracker:** Next.js 15 + Supabase app in `~/playground/truetest-case-tracker` (this repo). Active development.
- **LinkedIn:** Personal profile at `linkedin.com/in/michael-gammel-truetest`. Company page at `linkedin.com/company/truetestlabs/` (claimed and maintained — the older auto-generated stub at `/company/truetest-labs/` is a dead duplicate that LinkedIn support has been asked to remove).

## Domain & DNS constraints

- **truetestlabs.com is on GoDaddy, not Cloudflare.** Edge-level redirects (Cloudflare Workers, Page Rules, Bulk Redirects) are NOT possible on the live domain right now. URL forwarding on the live site must be done in WordPress or via GoDaddy's subdomain forwarding.
- **GoDaddy free subdomain forwarding is HTTP-only** — no SSL is issued for the forwarded subdomain. Modern browsers attempt HTTPS first and fail, so this is not a viable path for links shared on platforms that auto-upgrade to HTTPS (LinkedIn, email clients).
- **After Pages cutover** the `_redirects` file in `truetest-site` becomes the canonical place for path redirects with full HTTPS.

## External Integrations

When integrating with external services (EmailJS, Blotato, social media APIs, GoDaddy, Square, HubSpot), always check authentication, permissions, and rate limits BEFORE writing integration code. List known limitations upfront.

Before writing any code for a new service integration, research the API first and list: 1) authentication requirements, 2) rate limits, 3) known limitations (e.g., file size limits, required scopes), 4) test endpoint availability. Then propose an implementation plan.

**Known integration quirks:**
- **LinkedIn About auto-linker** rejects URL shorteners (bit.ly, tinyurl) — they render as plain text, not clickable links. Domain-only URLs (e.g., `truetestlabs.com`) and email addresses do auto-link. Use the LinkedIn Featured section for clickable CTAs to long URLs (Square booking, etc.) — Featured renders as a real button card and accepts any URL.
- **Square booking URLs** are long and contain random tokens. They cannot be auto-linkified in LinkedIn About. Either embed via Featured, or wait for Pages cutover and use `truetestlabs.com/book` via `_redirects`.

## UI & Frontend

This is primarily an HTML/TypeScript web project. When editing UI components, test mobile responsiveness and check for CSS side effects (e.g., text leaking outside nav containers). Limit UI iterations by asking clarifying questions about desired look before implementing.

Before editing any files, describe exactly what the UI will look like: layout, colors, spacing, mobile behavior, and button states. Get approval before implementing.

## MCP & Tooling

When MCP CLI commands fail (e.g., `claude mcp add`), fall back to directly editing the config file (`~/.claude.json` or `.claude/settings.json`) instead of retrying the CLI.
