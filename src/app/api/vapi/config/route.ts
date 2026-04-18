import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildVapiAssistantConfig } from "@/lib/vapiAgent";

/**
 * GET /api/vapi/config
 *
 * Returns the full Vapi assistant JSON. Two ways to use it:
 *   1. Browse to this URL while logged in, copy the JSON, paste it
 *      into the Vapi dashboard (Assistants → Create → JSON).
 *   2. Script it: `curl -H "Authorization: Bearer $VAPI_KEY" -X POST
 *      https://api.vapi.ai/assistant -d @-` piping this endpoint's
 *      output.
 *
 * Auth-required so we don't leak the system prompt or the configured
 * webhook secret to anyone who hits the URL.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  const origin = new URL(request.url).origin;
  // Prefer an explicit production URL if set, so dev browsing from a
  // localhost tab still produces a config that Vapi can actually
  // reach.
  const appBaseUrl = process.env.PUBLIC_APP_URL?.trim() || origin;
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET || undefined;

  const config = buildVapiAssistantConfig({ appBaseUrl, webhookSecret });
  return NextResponse.json(config, {
    headers: { "Cache-Control": "no-store" },
  });
}
