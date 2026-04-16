import { NextRequest, NextResponse } from "next/server";
import { sendDraftEmail } from "@/lib/email";
import { requireAuth } from "@/lib/auth";

/** POST /api/email-drafts/[id]/send — approve and send the draft via Resend */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(_request);
  if (auth.response) return auth.response;

  const { id } = await params;

  try {
    const sentTo = await sendDraftEmail(id);

    if (sentTo.length === 0) {
      return NextResponse.json({ error: "No recipients or draft already sent" }, { status: 400 });
    }

    return NextResponse.json({ sentTo });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send";
    console.error("Send draft email error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
