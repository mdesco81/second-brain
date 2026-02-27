import { env } from "../config/env.js";
import { TelegramUpdate } from "../types/telegram.js";

const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
const fileBase = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}`;

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

async function telegramRequest<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${base}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const data = (await response.json()) as TelegramResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram API error on ${method}: ${data.description ?? "unknown"}`);
  }

  return data.result;
}

export async function setWebhook(): Promise<void> {
  if (!env.APP_BASE_URL) {
    throw new Error("APP_BASE_URL is required for webhook mode");
  }

  await telegramRequest<boolean>("setWebhook", {
    url: `${env.APP_BASE_URL}/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    drop_pending_updates: false
  });
}

export async function deleteWebhook(): Promise<void> {
  await telegramRequest<boolean>("deleteWebhook", {
    drop_pending_updates: false
  });
}

const TELEGRAM_MAX_LENGTH = 4096;

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline within limit
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    if (splitAt <= 0) {
      // Fallback: split at last space
      splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt <= 0) {
      // Hard split
      splitAt = TELEGRAM_MAX_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

export async function sendText(chatId: number, text: string): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: chunk
    });
  }
}

/**
 * Send a typing indicator ("typing..." appears in the chat).
 * Call this before long-running operations (AI calls, research, etc.)
 * to signal that the bot is working. Automatically expires after ~5s.
 */
export async function sendTypingIndicator(chatId: number): Promise<void> {
  try {
    await telegramRequest("sendChatAction", {
      chat_id: chatId,
      action: "typing"
    });
  } catch {
    // Non-critical — don't let a typing indicator failure break the flow
  }
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

/**
 * Send a text message with inline keyboard buttons.
 * Returns the sent message_id (useful for editing later).
 */
export async function sendTextWithButtons(
  chatId: number,
  text: string,
  buttons: InlineButton[][],
): Promise<number> {
  const result = await telegramRequest<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: buttons
    }
  });
  return result.message_id;
}

/**
 * Answer a callback query (acknowledges the button press to remove the loading spinner).
 * Optionally shows a toast notification.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

/**
 * Edit the reply markup (buttons) on an existing message.
 * Used to update/remove buttons after user clicks one.
 */
export async function editMessageButtons(
  chatId: number,
  messageId: number,
  buttons: InlineButton[][] | null
): Promise<void> {
  try {
    await telegramRequest("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: buttons ? { inline_keyboard: buttons } : { inline_keyboard: [] }
    });
  } catch {
    // Message may have been deleted or too old to edit — non-critical
  }
}

export async function getFileBuffer(fileId: string): Promise<{ buffer: Buffer; filePath: string }> {
  const fileMeta = await telegramRequest<{ file_path: string }>("getFile", {
    file_id: fileId
  });

  const response = await fetch(`${fileBase}/${fileMeta.file_path}`);
  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filePath: fileMeta.file_path
  };
}

export async function getUpdates(offset?: number): Promise<TelegramUpdate[]> {
  return telegramRequest<TelegramUpdate[]>("getUpdates", {
    timeout: 25,
    offset,
    allowed_updates: ["message", "callback_query"]
  });
}
