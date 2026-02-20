import cron from "node-cron";
import { env } from "../config/env.js";
import {
  insertProactiveRun,
  listOpenActionItems,
  listProactiveChats,
  loadLast24hSnapshot,
  loadWeeklySummary
} from "../db/schema.js";
import { buildDailyMessage, buildWeeklyMessage } from "./reports.js";
import { sendText } from "./telegram.js";
import { log } from "../utils/logger.js";

async function deliverDailyRun(chatIds: number[]): Promise<void> {
  const snapshot = await loadLast24hSnapshot();
  for (const chatId of chatIds) {
    const focusItems = await listOpenActionItems(chatId, 3);
    const message = buildDailyMessage(snapshot, focusItems);
    await sendText(chatId, message);
    await insertProactiveRun(chatId, message, "daily");
  }
  log.info("Daily proactive run delivered", { recipients: chatIds.length, snapshot });
}

async function deliverWeeklyRun(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    const summary = await loadWeeklySummary(chatId);
    const message = buildWeeklyMessage(summary);
    await sendText(chatId, message);
    await insertProactiveRun(chatId, message, "weekly");
  }
  log.info("Weekly proactive run delivered", { recipients: chatIds.length });
}

export function startProactiveScheduler(): void {
  const dailyExpression = `${env.PROACTIVE_MINUTE} ${env.PROACTIVE_HOUR} * * *`;
  const weeklyExpression = `${env.WEEKLY_REPORT_MINUTE} ${env.WEEKLY_REPORT_HOUR} * * ${env.WEEKLY_REPORT_DAY}`;

  cron.schedule(
    dailyExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();

        if (chatIds.length === 0) {
          log.info("Daily proactive run skipped: no chat subscriptions");
          return;
        }

        await deliverDailyRun(chatIds);
      } catch (error) {
        log.error("Daily proactive run failed", { error });
      }
    },
    {
      timezone: env.TIMEZONE
    }
  );

  cron.schedule(
    weeklyExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) {
          log.info("Weekly proactive run skipped: no chat subscriptions");
          return;
        }
        await deliverWeeklyRun(chatIds);
      } catch (error) {
        log.error("Weekly proactive run failed", { error });
      }
    },
    {
      timezone: env.TIMEZONE
    }
  );

  log.info("Proactive scheduler started", {
    timezone: env.TIMEZONE,
    daily: {
      hour: env.PROACTIVE_HOUR,
      minute: env.PROACTIVE_MINUTE
    },
    weekly: {
      day: env.WEEKLY_REPORT_DAY,
      hour: env.WEEKLY_REPORT_HOUR,
      minute: env.WEEKLY_REPORT_MINUTE
    }
  });
}
