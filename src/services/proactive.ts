import cron from "node-cron";
import { env } from "../config/env.js";
import {
  insertProactiveRun,
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
  const snapshot = await loadLast24hSnapshot();
  for (const chatId of chatIds) {
    const [focusItems, overdueItems, staleItems] = await Promise.all([
      listOpenActionItems(chatId, 8),
      listOverdueItems(chatId, 5),
      listStaleItems(chatId, 3, 5)
    ]);
    const message = buildDailyMessage(snapshot, focusItems, overdueItems, staleItems);
    await sendText(chatId, message);
    await insertProactiveRun(chatId, message, "daily");
  }
  log.info("Daily proactive run delivered", { recipients: chatIds.length, snapshot });
}

async function deliverAfternoonRun(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    const [overdueItems, staleItems] = await Promise.all([
      listOverdueItems(chatId, 3),
      listStaleItems(chatId, 2, 3)
    ]);

    if (overdueItems.length === 0 && staleItems.length === 0) {
      continue;
    }

    const message = buildAfternoonMessage(overdueItems, staleItems);
    await sendText(chatId, message);
    await insertProactiveRun(chatId, message, "daily");
  }
  log.info("Afternoon follow-up delivered", { recipients: chatIds.length });
}

async function deliverEveningRun(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    const [doneToday, highPriority] = await Promise.all([
      loadDoneToday(chatId),
      listOpenActionItems(chatId, 3)
    ]);

    const message = buildEveningMessage(doneToday, highPriority);
    await sendText(chatId, message);
    await insertProactiveRun(chatId, message, "daily");
  }
  log.info("Evening wrap-up delivered", { recipients: chatIds.length });
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
