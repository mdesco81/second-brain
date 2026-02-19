import { Router } from "express";
import { env } from "../config/env.js";
import { processTelegramMessage } from "../services/intake.js";
import { TelegramUpdate } from "../types/telegram.js";
import { log } from "../utils/logger.js";

export const telegramRouter = Router();

telegramRouter.post("/webhook", async (req, res) => {
  const secret = req.header("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_MODE === "webhook" && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).json({ ok: false });
    return;
  }

  const update = req.body as TelegramUpdate;
  if (!update.message) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  try {
    await processTelegramMessage(update.message);
    res.status(200).json({ ok: true });
  } catch (error) {
    log.error("Failed to process Telegram update", { error, updateId: update.update_id });
    res.status(200).json({ ok: true, failed: true });
  }
});
