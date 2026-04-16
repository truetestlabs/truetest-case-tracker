/**
 * Centralized environment variable validation.
 *
 * Import this module early (e.g., middleware or root layout) so the app
 * fails fast at boot if a required var is missing — instead of crashing
 * on the first request that happens to touch the missing var.
 *
 * Optional vars (ANTHROPIC_API_KEY, Twilio, Google, etc.) are typed but
 * not required: features that use them check at call-time and degrade
 * gracefully (e.g., no AI parse, no SMS).
 */
import { z } from "zod";

const envSchema = z.object({
  // ── Supabase (required) ──
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // ── Resend email (required — transactional email is core workflow) ──
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  FROM_EMAIL: z.string().optional(),
  REPLY_TO_EMAIL: z.string().optional(),

  // ── Claude AI (optional — features degrade) ──
  ANTHROPIC_API_KEY: z.string().optional(),

  // ── Twilio SMS (optional) ──
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ── Google Calendar (optional) ──
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),

  // ── Public order endpoint (optional — only needed when marketing site POSTs) ──
  PUBLIC_ORDER_ALLOWED_ORIGINS: z.string().optional(),
  PUBLIC_ORDER_HMAC_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`
    );
    console.error(
      `\n❌ Environment validation failed:\n${missing.join("\n")}\n\n` +
        "Check your .env.local file against .env.example.\n"
    );
    throw new Error(`Missing or invalid environment variables:\n${missing.join("\n")}`);
  }
  return result.data;
}

/** Validated environment — import and use `env.DATABASE_URL` etc. */
export const env = validateEnv();
