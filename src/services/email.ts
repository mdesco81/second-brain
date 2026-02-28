import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { log } from "../utils/logger.js";

let transporter: Transporter | null = null;

export function isEmailEnabled(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export async function initEmailTransporter(): Promise<void> {
  if (!isEmailEnabled()) {
    log.info("email:disabled", { reason: "SMTP_HOST, SMTP_USER, or SMTP_PASS not configured" });
    return;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER!,
      pass: env.SMTP_PASS!
    }
  });

  try {
    await transporter.verify();
    log.info("email:transporter_ready", { host: env.SMTP_HOST, port: env.SMTP_PORT });
  } catch (error) {
    log.warn("email:transporter_verify_failed", { host: env.SMTP_HOST, error });
    // Don't null out — it may still work for sending
  }
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<string | null> {
  if (!transporter) {
    log.warn("email:send_failed", { reason: "transporter not initialized" });
    return null;
  }

  const from = env.SMTP_FROM || env.SMTP_USER!;

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body
    });

    log.info("email:sent", { to: params.to, subject: params.subject, messageId: info.messageId });
    return info.messageId ?? null;
  } catch (error) {
    log.error("email:send_error", { to: params.to, subject: params.subject, error });
    throw error;
  }
}
