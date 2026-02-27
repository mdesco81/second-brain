import { Router } from "express";
import { env } from "../config/env.js";
import { processTelegramMessage } from "../services/intake.js";
import { handleCallbackQuery } from "../services/callbacks.js";
import { TelegramUpdate } from "../types/telegram.js";
import { log } from "../utils/logger.js";

export const telegramRouter = Router();

telegramRouter.post("/webhook", (req, res) => {
  const secret = req.header("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_MODE === "webhook" && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).json({ ok: false });
    return;
  }

  const update = req.body as TelegramUpdate;

  // Respond immediately so Telegram doesn't retry while we process
  res.status(200).json({ ok: true });

  // Handle inline keyboard button presses
  if (update.callback_query) {
    handleCallbackQuery(update.callback_query).catch((error) => {
      log.error("Failed to process callback query", { error, updateId: update.update_id });
    });
    return;
  }

  if (!update.message) {
    return;
  }

  processTelegramMessage(update.message).catch((error) => {
    log.error("Failed to process Telegram update", { error, updateId: update.update_id });
  });
});
