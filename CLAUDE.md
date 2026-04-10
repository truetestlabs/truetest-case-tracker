# CLAUDE.md — TrueTest Labs Case Tracker

## External Integrations

When integrating with external services (EmailJS, Blotato, social media APIs, GoDaddy), always check authentication, permissions, and rate limits BEFORE writing integration code. List known limitations upfront.

Before writing any code for a new service integration, research the API first and list: 1) authentication requirements, 2) rate limits, 3) known limitations (e.g., file size limits, required scopes), 4) test endpoint availability. Then propose an implementation plan.

## UI & Frontend

This is primarily an HTML/TypeScript web project. When editing UI components, test mobile responsiveness and check for CSS side effects (e.g., text leaking outside nav containers). Limit UI iterations by asking clarifying questions about desired look before implementing.

Before editing any files, describe exactly what the UI will look like: layout, colors, spacing, mobile behavior, and button states. Get approval before implementing.

## MCP & Tooling

When MCP CLI commands fail (e.g., `claude mcp add`), fall back to directly editing the config file (~/.claude.json or .claude/settings.json) instead of retrying the CLI.
