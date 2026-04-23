import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock every heavy import that email.ts reaches for. We never want the real
// Prisma client, Resend SDK, Supabase storage, or PDF generator to run during
// unit tests — all four either hit the network, require env, or do expensive
// work. vi.mock is hoisted above imports, so mock state must come from
// vi.hoisted to be initialized in time.
const { prismaMock, resendSendMock } = vi.hoisted(() => ({
  prismaMock: {
    emailDraft: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
    statusLog: {
      create: vi.fn(),
    },
  },
  resendSendMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({
  downloadFile: vi.fn(async () => ({ buffer: Buffer.from("") })),
}));
vi.mock("@/lib/compliance", () => ({ buildComplianceReport: vi.fn() }));
vi.mock("@/lib/pdf/compliance-report", () => ({
  generateComplianceReportPDF: vi.fn(),
}));
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: resendSendMock },
  })),
}));

import { sendDraftEmail } from "./email";

const ORIGINAL_ENV = { ...process.env };

function setEmailEnv(overrides: Partial<Record<string, string | undefined>> = {}) {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.FROM_EMAIL = "TrueTest Labs <noreply@truetestlabs.com>";
  process.env.REPLY_TO_EMAIL = "support@truetestlabs.com";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setEmailEnv();
  resendSendMock.mockResolvedValue({ data: { id: "re_msg_1" }, error: null });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sendDraftEmail — not_configured", () => {
  it("returns not_configured when RESEND_API_KEY is unset", async () => {
    setEmailEnv({ RESEND_API_KEY: undefined });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(prismaMock.emailDraft.findUnique).not.toHaveBeenCalled();
  });

  it("returns not_configured when FROM_EMAIL is unset", async () => {
    setEmailEnv({ FROM_EMAIL: undefined });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(prismaMock.emailDraft.findUnique).not.toHaveBeenCalled();
  });

  it("returns not_configured when FROM_EMAIL is whitespace only", async () => {
    setEmailEnv({ FROM_EMAIL: "   " });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("returns not_configured when REPLY_TO_EMAIL is unset", async () => {
    setEmailEnv({ REPLY_TO_EMAIL: undefined });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("sendDraftEmail — not_found", () => {
  it("returns not_found when prisma returns null", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce(null);
    const result = await sendDraftEmail("missing-draft");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("sendDraftEmail — already_sent", () => {
  it("returns already_sent when the draft's status is 'sent'", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      id: "draft-1",
      status: "sent",
      draftType: "results",
      body: "hi",
      subject: "subject",
      recipients: ["a@b.com"],
      caseId: "case-1",
      testOrderId: null,
      case: { caseNumber: "C1", donor: null },
      testOrder: null,
    });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "already_sent" });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("sendDraftEmail — no_recipients", () => {
  const baseDraft = {
    id: "draft-1",
    status: "pending",
    draftType: "results",
    body: "hi",
    subject: "subject",
    caseId: "case-1",
    testOrderId: null,
    case: { caseNumber: "C1", donor: null },
    testOrder: null,
  };

  it("returns no_recipients when recipients is an empty array", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      ...baseDraft,
      recipients: [],
    });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "no_recipients" });
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("returns no_recipients when recipients is null", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      ...baseDraft,
      recipients: null,
    });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("returns no_recipients when recipients is not an array (malformed json)", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      ...baseDraft,
      recipients: { email: "a@b.com" },
    });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("returns no_recipients when array contains only non-string entries", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      ...baseDraft,
      recipients: [123, null, { email: "x" }],
    });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("returns no_recipients when array contains only empty strings", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      ...baseDraft,
      recipients: ["", ""],
    });
    const result = await sendDraftEmail("draft-1");
    expect(result).toEqual({ ok: false, reason: "no_recipients" });
  });
});

describe("sendDraftEmail — happy path", () => {
  it("sends via Resend, marks the draft sent, writes a status log, and returns ok", async () => {
    const draft = {
      id: "draft-1",
      status: "pending",
      draftType: "results",
      body: "Your results are ready.",
      subject: "Results — Jane Doe (C-1234)",
      caseId: "case-1",
      testOrderId: "to-1",
      recipients: ["jane@example.com", "lawyer@example.com"],
      case: {
        caseNumber: "C-1234",
        donor: { firstName: "Jane", lastName: "Doe" },
      },
      testOrder: { testDescription: "10-panel urine" },
    };
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce(draft);
    prismaMock.document.findMany.mockResolvedValueOnce([]);
    prismaMock.emailDraft.update.mockResolvedValueOnce({});
    prismaMock.statusLog.create.mockResolvedValueOnce({});

    const result = await sendDraftEmail("draft-1");

    expect(result).toEqual({
      ok: true,
      sentTo: ["jane@example.com", "lawyer@example.com"],
    });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const call = resendSendMock.mock.calls[0][0];
    expect(call.to).toEqual(["jane@example.com", "lawyer@example.com"]);
    expect(call.from).toBe("TrueTest Labs <noreply@truetestlabs.com>");
    expect(call.replyTo).toBe("support@truetestlabs.com");
    expect(call.subject).toBe("Results — Jane Doe (C-1234)");
    expect(prismaMock.emailDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: expect.objectContaining({ status: "sent" }),
    });
    expect(prismaMock.statusLog.create).toHaveBeenCalledTimes(1);
  });

  it("filters empty-string entries out of a mixed recipients array", async () => {
    prismaMock.emailDraft.findUnique.mockResolvedValueOnce({
      id: "draft-1",
      status: "pending",
      draftType: "results",
      body: "hi",
      subject: "s",
      caseId: "case-1",
      testOrderId: null,
      recipients: ["", "a@b.com", "", "c@d.com"],
      case: { caseNumber: "C1", donor: null },
      testOrder: null,
    });
    prismaMock.document.findMany.mockResolvedValueOnce([]);
    prismaMock.emailDraft.update.mockResolvedValueOnce({});
    prismaMock.statusLog.create.mockResolvedValueOnce({});

    const result = await sendDraftEmail("draft-1");

    expect(result).toEqual({ ok: true, sentTo: ["a@b.com", "c@d.com"] });
    expect(resendSendMock.mock.calls[0][0].to).toEqual([
      "a@b.com",
      "c@d.com",
    ]);
  });
});
