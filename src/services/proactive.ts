import cron from "node-cron";
import { env } from "../config/env.js";
import {
  insertProactiveRun,
  listOpenActionItems,
  listOverdueItems,
  listProactiveChats,
  listStaleItems,
  loadLast24hSnapshot,
  loadWeeklySummary
} from "../db/schema.js";
import { buildDailyMessage, buildWeeklyMessage } from "./reports.js";
import { sendText } from "./telegram.js";
import { log } from "../utils/logger.js";

async function deliverDailyRun(chatIds: number[]): Promise<void> {
  const snapshot = await loadLast24hSnapshot();
  for (const chatId of chatIds) {
    const [focusItems, overdueItems, staleItems] = await Promise.all([
      listOpenActionItems(chatId, 3),
      listOverdueItems(chatId, 5),
      listStaleItems(chatId, 3, 5)
    ]);
    const message = buildDailyMessage(snapshot, focusItems, overdueItems, staleItems);
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

  // Afternoon follow-up: check overdue items at 15:00
  const afternoonHour = Math.min(env.PROACTIVE_HOUR + 6, 17);
  const afternoonExpression = `0 ${afternoonHour} * * *`;

  cron.schedule(
    afternoonExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) {
          return;
        }

        for (const chatId of chatIds) {
          const overdueItems = await listOverdueItems(chatId, 3);
          if (overdueItems.length === 0) {
            continue;
          }

          const lines = [
            "Lembrete da tarde:",
            ""
          ];
          for (const item of overdueItems) {
            lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr}`);
            lines.push(`  Ja resolveu isso? /done ${item.id}`);
          }
          lines.push("", "Se nao conseguiu, me conta o que esta travando.");

          const message = lines.join("\n");
          await sendText(chatId, message);
          await insertProactiveRun(chatId, message, "daily");
        }

        log.info("Afternoon follow-up delivered", { recipients: chatIds.length });
      } catch (error) {
        log.error("Afternoon follow-up failed", { error });
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
    afternoon: {
      hour: afternoonHour,
      minute: 0
    },
    weekly: {
      day: env.WEEKLY_REPORT_DAY,
      hour: env.WEEKLY_REPORT_HOUR,
      minute: env.WEEKLY_REPORT_MINUTE
    }
  });
}
