import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_BASE_URL: z.string().url().optional(),
  POSTGRES_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_MODE: z.enum(["webhook", "polling"]).default("webhook"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  TIMEZONE: z.string().default("America/Sao_Paulo"),
  PROACTIVE_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  PROACTIVE_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  STORAGE_ROOT: z.string().default("./storage/SecondBrain")
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
