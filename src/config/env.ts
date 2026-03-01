import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_BASE_URL: z.preprocess((v) => v === "" ? undefined : v, z.string().url().optional()),
  POSTGRES_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_MODE: z.enum(["webhook", "polling"]).default("webhook"),
  ANTHROPIC_API_KEY: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  OPENAI_API_KEY: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_EMBED_MODEL: z.string().default("text-embedding-3-small"),
  PERPLEXITY_API_KEY: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  TIMEZONE: z.string().default("America/Sao_Paulo").refine((val) => {
    try { Intl.DateTimeFormat("en-US", { timeZone: val }); return true; } catch { return false; }
  }, "Invalid IANA timezone (e.g. America/Sao_Paulo)"),
  PROACTIVE_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  PROACTIVE_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  WEEKLY_REPORT_DAY: z.coerce.number().int().min(0).max(6).default(1),
  WEEKLY_REPORT_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  WEEKLY_REPORT_MINUTE: z.coerce.number().int().min(0).max(59).default(30),
  STORAGE_ROOT: z.string().default("./storage/SecondBrain"),

  // Google Calendar integration (empty string → undefined so calendar is simply disabled)
  GOOGLE_CLIENT_ID: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  GOOGLE_REFRESH_TOKEN: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  CALENDAR_SYNC_INTERVAL_MIN: z.coerce.number().int().min(1).max(60).default(5),
  PRE_MEETING_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  POST_MEETING_MINUTES: z.coerce.number().int().min(5).max(30).default(10),

  // SMTP email sending (all optional — email disabled when not configured)
  SMTP_HOST: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.preprocess((v) => v === "true" || v === "1", z.boolean().default(false)),
  SMTP_USER: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  SMTP_PASS: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional()),
  SMTP_FROM: z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional())
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = {
  ...parsed.data,
  STORAGE_ROOT: path.resolve(parsed.data.STORAGE_ROOT)
};
