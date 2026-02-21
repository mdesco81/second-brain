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

async function configureWebhookWithRetry(): Promise<NodeJS.Timeout> {
  const attempt = async () => {
    try {
      await setWebhook();
      log.info("Telegram webhook configured", { baseUrl: env.APP_BASE_URL });
    } catch (error) {
      log.warn("Webhook configuration failed; will retry", { error });
    }
  };

  await attempt();
  return setInterval(() => void attempt(), 60_000);
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
