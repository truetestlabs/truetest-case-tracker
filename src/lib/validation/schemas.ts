/**
 * Zod request-body schemas for mutation routes.
 *
 * Every POST/PATCH handler that accepts user input should `safeParse` against
 * one of these and return a 400 with the flattened errors on failure. This
 * gives us a single, auditable place where input shape rules live, instead of
 * scattering ad-hoc string checks through every handler.
 */
import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────

const trimmedString = (max: number) =>
  z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const cuid = z.string().min(20).max(40);
const email = z.string().email().max(254);
const phone = z.string().min(7).max(32);

// ── /api/upload-url ───────────────────────────────────────────────────────

export const uploadUrlSchema = z.object({
  caseId: cuid,
  fileName: trimmedString(255),
  contentType: z
    .enum([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/heic",
      "image/heif",
      "image/webp",
    ])
    .default("application/pdf"),
  documentType: optionalTrimmed(64),
});

// ── /api/cases (POST) ─────────────────────────────────────────────────────

export const createCaseSchema = z.object({
  caseType: z.enum(["court_ordered", "voluntary", "by_agreement"]).optional(),
  caseStatus: z.enum(["intake", "order_received", "active", "on_hold", "closed"]).optional(),
  donorId: cuid.optional(),
  donor: z
    .object({
      firstName: trimmedString(80),
      lastName: trimmedString(80),
      email: email.optional(),
      phone: phone.optional(),
      dob: optionalTrimmed(32),
    })
    .optional(),
  hasCourtOrder: z.boolean().optional(),
  isMonitored: z.boolean().optional(),
  notes: z.string().max(10_000).optional(),
  contacts: z.array(z.any()).optional(),
  testOrders: z.array(z.any()).optional(),
});

// ── /api/cases/[id] (PATCH) ───────────────────────────────────────────────

export const updateCaseSchema = z.object({
  caseType: z.enum(["court_ordered", "voluntary", "by_agreement"]).optional(),
  caseStatus: z.enum(["intake", "order_received", "active", "on_hold", "closed"]).optional(),
  hasCourtOrder: z.boolean().optional(),
  isMonitored: z.boolean().optional(),
  notes: z.string().max(10_000).optional(),
  closedAt: z.string().datetime().nullable().optional(),
  closeReason: z.string().max(2000).optional().nullable(),
}).strict().partial();

// ── /api/contacts (POST) ──────────────────────────────────────────────────

export const createContactSchema = z.object({
  contactType: z.enum([
    "donor",
    "attorney",
    "gal",
    "judge",
    "court_clerk",
    "mro",
    "staff",
    "evaluator",
    "other",
  ]),
  firstName: trimmedString(80),
  lastName: trimmedString(80),
  email: email.optional().nullable(),
  phone: phone.optional().nullable(),
  preferredContact: z.enum(["email", "phone", "text"]).optional(),
  represents: z
    .enum(["petitioner", "respondent", "child", "neutral", "na"])
    .optional(),
  organization: optionalTrimmed(160),
  notes: z.string().max(5000).optional().nullable(),
});

// ── /api/email-drafts (POST) ──────────────────────────────────────────────

export const createEmailDraftSchema = z.object({
  caseId: cuid,
  subject: trimmedString(255),
  body: z.string().min(1).max(50_000),
  to: z.array(email).min(1).max(50),
  cc: z.array(email).max(50).optional(),
  bcc: z.array(email).max(50).optional(),
  attachmentDocumentIds: z.array(cuid).max(20).optional(),
});

// ── /api/cases/[id]/test-orders (POST) ────────────────────────────────────

// Enum values must match the Prisma Lab enum in prisma/schema.prisma exactly.
// When a new lab is added there, also add it here or requests with that lab
// value will be rejected with a 400.
const labEnum = z.enum([
  "usdtl",
  "crl_quest",
  "quest",
  "expertox",
  "nms",
  "medipro",
  "truetest_inhouse",
]);

export const createTestOrderSchema = z.object({
  testCatalogId: cuid.optional().nullable(),
  testDescription: trimmedString(255),
  specimenType: z.enum([
    "urine",
    "hair",
    "nail",
    "blood",
    "breath",
    "sweat_patch",
    "oral_fluid",
    "unknown_substance",
    "semen",
  ]),
  lab: labEnum.optional(),
  collectionType: z.enum(["observed", "unobserved"]).optional(),
  // TestOrder.schedulingType in Prisma — check schema.prisma if you add more
  schedulingType: z.string().max(32).optional(),
  labAccessionNumber: optionalTrimmed(64),
  notes: z.string().max(5000).optional(),
});

// ── /api/public/order (POST) ──────────────────────────────────────────────

export const publicOrderSchema = z.object({
  donorFirst: trimmedString(80),
  donorLast: trimmedString(80),
  donorEmail: optionalTrimmed(254),
  donorPhone: optionalTrimmed(32),
  dob: optionalTrimmed(32),
  reason: optionalTrimmed(64),
  zipLoc: optionalTrimmed(16),
  stateId: optionalTrimmed(80),
  observed: optionalTrimmed(8),
  tests: z.array(z.string().max(255)).max(50).optional(),
  addOns: z.array(z.string().max(255)).max(50).optional(),
  customTest: optionalTrimmed(500),
  specialInstructions: optionalTrimmed(2000),
  otherText: optionalTrimmed(2000),
  attorneyEmail: optionalTrimmed(254),
  firstName: optionalTrimmed(80),
  lastName: optionalTrimmed(80),
});

// ── Helper: format zod errors for API responses ───────────────────────────

import type { ZodError } from "zod";
export function formatZodError(err: ZodError) {
  return {
    error: "Invalid request body",
    details: err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
