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
    allowed_updates: ["message"]
  });
}
