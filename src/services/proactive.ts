import cron from "node-cron";
import { env } from "../config/env.js";
import {
  escalateOverdueItems,
  insertProactiveRun,
  listArchiveSuggestions,
  listOpenActionItems,
  listOverdueItems,
  listProactiveChats,
  listStaleItems,
  loadDoneToday,
  loadLast24hSnapshot,
  loadWeeklySummary
} from "../db/schema.js";
import { buildAfternoonMessage, buildDailyMessage, buildEveningMessage, buildWeeklyMessage } from "./reports.js";
import { sendText } from "./telegram.js";
import { log } from "../utils/logger.js";

async function deliverDailyRun(chatIds: number[]): Promise<void> {
  // Auto-escalate items overdue by 3+ days before building the report
  try {
    const escalated = await escalateOverdueItems(3);
    if (escalated.length > 0) {
      log.info("Auto-escalated overdue items to ALTA", { ids: escalated });
    }
  } catch (error) {
    log.error("Auto-escalation failed", { error });
  }

  const snapshot = await loadLast24hSnapshot();
  for (const chatId of chatIds) {
    try {
      const [focusItems, overdueItems, staleItems] = await Promise.all([
        listOpenActionItems(chatId, 8),
        listOverdueItems(chatId, 5),
        listStaleItems(chatId, 3, 5)
      ]);
      const message = buildDailyMessage(snapshot, focusItems, overdueItems, staleItems);
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "daily");
    } catch (error) {
      log.error("Daily delivery failed for chat", { chatId, error });
    }
  }
  log.info("Daily proactive run delivered", { recipients: chatIds.length, snapshot });
}

async function deliverAfternoonRun(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    try {
      const [overdueItems, staleItems] = await Promise.all([
        listOverdueItems(chatId, 3),
        listStaleItems(chatId, 2, 3)
      ]);

      if (overdueItems.length === 0 && staleItems.length === 0) {
        continue;
      }

      const message = buildAfternoonMessage(overdueItems, staleItems);
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "afternoon");
    } catch (error) {
      log.error("Afternoon delivery failed for chat", { chatId, error });
    }
  }
  log.info("Afternoon follow-up delivered", { recipients: chatIds.length });
}

async function deliverEveningRun(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    try {
      const [doneToday, highPriority, archiveCandidates] = await Promise.all([
        loadDoneToday(chatId),
        listOpenActionItems(chatId, 3),
        listArchiveSuggestions(chatId, 30, 3)
      ]);

      let message = buildEveningMessage(doneToday, highPriority);

      // Append archive suggestions if any stale items found
      if (archiveCandidates.length > 0) {
        const archiveLines = archiveCandidates.map(
          (item) => `  #${item.id} — ${item.actionTitle || item.summaryPtBr.slice(0, 50)}`
        );
        message += `\n\n📦 Items parados 30+ dias (considere arquivar):\n${archiveLines.join("\n")}`;
      }

      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "evening");
    } catch (error) {
      log.error("Evening delivery failed for chat", { chatId, error });
    }
  }
  log.info("Evening wrap-up delivered", { recipients: chatIds.length });
}

async function deliverWeeklyRun(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    try {
      const summary = await loadWeeklySummary(chatId);
      const message = buildWeeklyMessage(summary);
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "weekly");
    } catch (error) {
      log.error("Weekly delivery failed for chat", { chatId, error });
    }
  }
  log.info("Weekly proactive run delivered", { recipients: chatIds.length });
}

export function startProactiveScheduler(): void {
  const dailyExpression = `${env.PROACTIVE_MINUTE} ${env.PROACTIVE_HOUR} * * *`;
  const weeklyExpression = `${env.WEEKLY_REPORT_MINUTE} ${env.WEEKLY_REPORT_HOUR} * * ${env.WEEKLY_REPORT_DAY}`;
  const afternoonHour = Math.min(env.PROACTIVE_HOUR + 6, 17);
  const afternoonExpression = `0 ${afternoonHour} * * *`;
  const eveningHour = Math.min(env.PROACTIVE_HOUR + 12, 21);
  const eveningExpression = `0 ${eveningHour} * * *`;

  // Morning: full daily briefing with Eisenhower categories
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
    { timezone: env.TIMEZONE }
  );

  // Afternoon: focused follow-up on overdue and stale items
  cron.schedule(
    afternoonExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) return;
        await deliverAfternoonRun(chatIds);
      } catch (error) {
        log.error("Afternoon follow-up failed", { error });
      }
    },
    { timezone: env.TIMEZONE }
  );

  // Evening: day wrap-up, what was done, what to prioritize tomorrow
  cron.schedule(
    eveningExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) return;
        await deliverEveningRun(chatIds);
      } catch (error) {
        log.error("Evening wrap-up failed", { error });
      }
    },
    { timezone: env.TIMEZONE }
  );

  // Weekly: full summary report
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
    { timezone: env.TIMEZONE }
  );

  log.info("Proactive scheduler started", {
    timezone: env.TIMEZONE,
    morning: { hour: env.PROACTIVE_HOUR, minute: env.PROACTIVE_MINUTE },
    afternoon: { hour: afternoonHour, minute: 0 },
    evening: { hour: eveningHour, minute: 0 },
    weekly: { day: env.WEEKLY_REPORT_DAY, hour: env.WEEKLY_REPORT_HOUR, minute: env.WEEKLY_REPORT_MINUTE }
  });
}
