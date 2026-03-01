import { getUpdates } from "./telegram.js";
import { processTelegramMessage } from "./intake.js";
import { handleCallbackQuery } from "./callbacks.js";
import { log } from "../utils/logger.js";

let running = false;
let offset: number | undefined;

export async function startPollingLoop(): Promise<void> {
  if (running) {
    return;
  }

  running = true;
  log.info("Telegram polling loop started");

  while (running) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.callback_query) {
          // Fire-and-forget: don't block the loop waiting for processing.
          // This matches webhook behavior where each request is independent.
          handleCallbackQuery(update.callback_query).catch((error) => {
            log.error("Polling: callback query processing failed", { error, updateId: update.update_id });
          });
        } else if (update.message) {
          // Fire-and-forget: if one message hangs or takes a long time,
          // the loop continues fetching and dispatching new updates.
          // Without this, a slow audio transcription or hung API call
          // would block ALL messages for ALL chats.
          processTelegramMessage(update.message).catch((error) => {
            log.error("Polling: message processing failed", { error, updateId: update.update_id });
          });
        }
      }
    } catch (error) {
      log.error("Telegram polling failed", { error });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

export function stopPollingLoop(): void {
  running = false;
}
