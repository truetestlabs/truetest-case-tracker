import { NextRequest, NextResponse } from "next/server";
import { sendDraftEmail } from "@/lib/email";

const REASON_COPY = {
  not_configured: { status: 500, message: "Email service not configured (RESEND_API_KEY missing)" },
  not_found: { status: 404, message: "Draft not found" },
  already_sent: { status: 409, message: "Draft already sent" },
  no_recipients: { status: 400, message: "Draft has no recipients" },
} as const;

/** POST /api/email-drafts/[id]/send — approve and send the draft via Resend */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await sendDraftEmail(id);

    if (!result.ok) {
      const { status, message } = REASON_COPY[result.reason];
      return NextResponse.json({ error: message, reason: result.reason }, { status });
    }

    return NextResponse.json({ sentTo: result.sentTo });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send";
    console.error("Send draft email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
