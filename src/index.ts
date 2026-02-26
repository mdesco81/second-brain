import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closePool, ensureSchema } from "./db/schema.js";
import { startPollingLoop, stopPollingLoop } from "./services/polling.js";
import { startProactiveScheduler } from "./services/proactive.js";
import { ensureKnowledgeTree } from "./services/storage.js";
import { deleteWebhook, setWebhook } from "./services/telegram.js";
import { hasAI } from "./services/openai.js";
import { log } from "./utils/logger.js";
import { registerGhostwriter } from "./agents/ghostwriter/index.js";
import { registerChiefOfStaff } from "./agents/chiefofstaff/index.js";
import { getInflightCount, waitForInflight } from "./services/intake.js";

async function configureWebhookWithRetry(): Promise<NodeJS.Timeout | null> {
  let retryCount = 0;
  const MAX_RETRIES = 10;
  let timerId: NodeJS.Timeout | null = null;

  const attempt = async (): Promise<boolean> => {
    try {
      await setWebhook();
      log.info("Telegram webhook configured", { baseUrl: env.APP_BASE_URL });
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      return true;
    } catch (error) {
      retryCount += 1;
      const backoffSec = Math.min(60 * Math.pow(2, retryCount - 1), 15 * 60);
      log.warn("Webhook configuration failed; will retry", {
        error,
        retryCount,
        maxRetries: MAX_RETRIES,
        nextRetrySec: backoffSec
      });
      if (retryCount >= MAX_RETRIES) {
        log.error("Webhook configuration abandoned after max retries", { retryCount });
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      }
      return false;
    }
  };

  const success = await attempt();
  if (success) {
    return null;
  }

  timerId = setInterval(() => void attempt(), 60_000);
  return timerId;
}

async function bootstrap(): Promise<void> {
  await ensureKnowledgeTree();
  await ensureSchema();
  let webhookRetryTimer: NodeJS.Timeout | null = null;

  if (env.TELEGRAM_MODE === "webhook") {
    webhookRetryTimer = await configureWebhookWithRetry();
  } else {
    await deleteWebhook();
    void startPollingLoop();
  }

  startProactiveScheduler();
  registerGhostwriter();
  registerChiefOfStaff();

  if (!hasAI()) {
    log.warn("⚠ Claude AI is NOT available — check ANTHROPIC_API_KEY. Cards will use keyword-only fallback.");
  } else {
    log.info("Claude AI is active and ready for classification.");
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    log.info("Second Brain server running", {
      port: env.PORT,
      mode: env.TELEGRAM_MODE,
      storageRoot: env.STORAGE_ROOT,
      aiEnabled: hasAI()
    });
  });

  const shutdown = async (signal: string) => {
    log.info("Shutting down", { signal });
    if (webhookRetryTimer) {
      clearInterval(webhookRetryTimer);
    }
    stopPollingLoop();

    // Wait for in-flight message processing to finish (max 30s)
    const inflight = getInflightCount();
    if (inflight > 0) {
      log.info("Waiting for in-flight messages to finish", { inflight });
      await waitForInflight(30_000);
    }

    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  log.error("Bootstrap failed", { error });
  process.exit(1);
});
