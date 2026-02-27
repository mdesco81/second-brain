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
          await handleCallbackQuery(update.callback_query);
        } else if (update.message) {
          await processTelegramMessage(update.message);
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
