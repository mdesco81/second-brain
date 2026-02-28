import cron from "node-cron";
import { env } from "../config/env.js";
import {
  CalendarEvent,
  decayUnusedMemories,
  escalateOverdueItems,
  expireStaleConversations,
  getDueReminders,
  getRecentlyEndedEvents,
  getTodayEvents,
  getUpcomingEvents,
  insertProactiveRun,
  listArchiveSuggestions,
  computeRelationshipHealth,
  listCommitmentsForMeeting,
  listDecisionsByPerson,
  listDecisionsForReview,
  listItemsByPerson,
  listOpenActionItems,
  listOverdueCommitments,
  listOverdueItems,
  listPendingDrafts,
  listPeople,
  listProactiveChats,
  listStaleItems,
  loadDoneToday,
  loadLast24hSnapshot,
  loadMemoriesForPerson,
  loadWeeklySummary,
  markPostPromptSent,
  markPreBriefSent,
  markReminderSent,
  Person,
  scheduleNextRecurrence
} from "../db/schema.js";
import { syncCalendarEvents, isCalendarEnabled } from "./calendar.js";
import {
  buildAfternoonMessage,
  buildDailyMessage,
  buildEveningMessage,
  buildMartaCrossTeamInsight,
  buildMartaPreOneOnOneAlert,
  buildPostMeetingPrompt,
  buildPreMeetingBrief,
  buildWeeklyMessage,
  TeamStat
} from "./reports.js";
import { sendText, sendTextWithButtons } from "./telegram.js";
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
      // Load core data + enriched data in parallel
      const calendarEnabled = isCalendarEnabled();
      const [focusItems, overdueItems, staleItems, calendarEvents, people, pendingDrafts, overdueCommits] = await Promise.all([
        listOpenActionItems(chatId, 8),
        listOverdueItems(chatId, 5),
        listStaleItems(chatId, 3, 5),
        calendarEnabled ? getTodayEvents(chatId) : Promise.resolve([] as CalendarEvent[]),
        listPeople(true),
        listPendingDrafts(chatId),
        listOverdueCommitments(chatId)
      ]);

      // Build team stats for direct reports
      const teamStats = await buildTeamStats(people, chatId, calendarEvents);

      const message = buildDailyMessage(
        snapshot,
        focusItems,
        overdueItems,
        staleItems,
        calendarEvents.length > 0 ? calendarEvents : undefined,
        teamStats.length > 0 ? teamStats : undefined,
        pendingDrafts.length > 0 ? pendingDrafts : undefined,
        overdueCommits.length > 0 ? overdueCommits : undefined
      );
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "daily");
    } catch (error) {
      log.error("Daily delivery failed for chat", { chatId, error });
    }
  }
  log.info("Daily proactive run delivered", { recipients: chatIds.length, snapshot });
}

async function buildTeamStats(
  people: Person[],
  _chatId: number,
  todayEvents: CalendarEvent[]
): Promise<TeamStat[]> {
  const directReports = people.filter((p) => p.relationship === "direct_report");
  if (directReports.length === 0) return [];

  // Set of person IDs that have a 1:1 today
  const oneOnOneTodayPersonIds = new Set(
    todayEvents
      .filter((e) => e.isOneOnOne && e.personId)
      .map((e) => e.personId!)
  );

  const stats = await Promise.all(
    directReports.map(async (person) => {
      const openItems = await listItemsByPerson(person.name, ["open"]);
      const overdueCount = openItems.filter(
        (it) => it.dueAt && new Date(it.dueAt) < new Date()
      ).length;

      const daysSince = person.lastOneOnOne
        ? Math.floor((Date.now() - new Date(person.lastOneOnOne).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        person,
        openCount: openItems.length,
        overdueCount,
        daysSinceOneOnOne: daysSince,
        hasOneOnOneToday: oneOnOneTodayPersonIds.has(person.id)
      };
    })
  );

  return stats;
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

  // ── Marta (Chief of Staff) proactive alerts ──────────────────────────

  // Pre-1:1 alert: Mon/Wed/Fri 30min before morning report
  let preOneOnOneHour = env.PROACTIVE_HOUR;
  let preOneOnOneMinute = env.PROACTIVE_MINUTE - 30;
  if (preOneOnOneMinute < 0) {
    preOneOnOneMinute += 60;
    preOneOnOneHour = Math.max(preOneOnOneHour - 1, 0);
  }
  const preOneOnOneExpression = `${preOneOnOneMinute} ${preOneOnOneHour} * * 1,3,5`;
  cron.schedule(
    preOneOnOneExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) return;
        await deliverMartaPreOneOnOne(chatIds);
      } catch (error) {
        log.error("Marta pre-1:1 alert failed", { error });
      }
    },
    { timezone: env.TIMEZONE }
  );

  // Cross-team insights: weekly, same day as weekly report, 1h after
  const insightHour = Math.min(env.WEEKLY_REPORT_HOUR + 1, 21);
  const insightExpression = `0 ${insightHour} * * ${env.WEEKLY_REPORT_DAY}`;
  cron.schedule(
    insightExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) return;
        await deliverMartaCrossTeamInsight(chatIds);
      } catch (error) {
        log.error("Marta cross-team insight failed", { error });
      }
    },
    { timezone: env.TIMEZONE }
  );

  // Relationship health alerts: weekly, same day as weekly report, 2h after
  const healthAlertHour = Math.min(env.WEEKLY_REPORT_HOUR + 2, 21);
  const healthAlertExpression = `0 ${healthAlertHour} * * ${env.WEEKLY_REPORT_DAY}`;
  cron.schedule(
    healthAlertExpression,
    async () => {
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) return;
        await deliverRelationshipHealthAlerts(chatIds);
      } catch (error) {
        log.error("Relationship health alert failed", { error });
      }
    },
    { timezone: env.TIMEZONE }
  );

  // Housekeeping: expire stale conversations and decay unused memories (daily at 3am)
  cron.schedule(
    "0 3 * * *",
    async () => {
      try {
        const expired = await expireStaleConversations();
        const decayed = await decayUnusedMemories();
        if (expired > 0 || decayed > 0) {
          log.info("Marta housekeeping completed", { expiredConversations: expired, decayedMemories: decayed });
        }
      } catch (error) {
        log.error("Marta housekeeping failed", { error });
      }
    },
    { timezone: env.TIMEZONE }
  );

  // ── Calendar sync + pre/post meeting + reminders ────────────────────
  // Runs every N minutes (configurable via CALENDAR_SYNC_INTERVAL_MIN, default: 5)
  let _calendarCycleRunning = false;
  const calendarInterval = env.CALENDAR_SYNC_INTERVAL_MIN;
  cron.schedule(
    `*/${calendarInterval} * * * *`,
    async () => {
      // Prevent overlapping cycles
      if (_calendarCycleRunning) {
        log.warn("calendar:cycle_skipped_overlap", { reason: "previous cycle still running" });
        return;
      }
      _calendarCycleRunning = true;
      try {
        const chatIds = await listProactiveChats();
        if (chatIds.length === 0) return;

        // Calendar sync + pre/post meeting briefs
        if (isCalendarEnabled()) {
          for (const chatId of chatIds) {
            try {
              await syncCalendarEvents(chatId);
              await deliverPreMeetingBriefs(chatId);
              await deliverPostMeetingPrompts(chatId);
            } catch (error) {
              log.error("Calendar cycle failed for chat", { chatId, error });
            }
          }
        }

        // Reminder delivery
        await deliverScheduledReminders();

        // Decision review alerts (check once per cycle)
        for (const chatId of chatIds) {
          await deliverDecisionReviewAlerts(chatId).catch((error) => {
            log.error("Decision review alert failed", { chatId, error });
          });
        }
      } catch (error) {
        log.error("Calendar/reminder cycle failed", { error });
      } finally {
        _calendarCycleRunning = false;
      }
    },
    { timezone: env.TIMEZONE }
  );

  log.info("Proactive scheduler started", {
    timezone: env.TIMEZONE,
    morning: { hour: env.PROACTIVE_HOUR, minute: env.PROACTIVE_MINUTE },
    afternoon: { hour: afternoonHour, minute: 0 },
    evening: { hour: eveningHour, minute: 0 },
    weekly: { day: env.WEEKLY_REPORT_DAY, hour: env.WEEKLY_REPORT_HOUR, minute: env.WEEKLY_REPORT_MINUTE },
    martaPreOneOnOne: { days: "Mon/Wed/Fri", hour: preOneOnOneHour, minute: preOneOnOneMinute },
    martaInsights: { day: env.WEEKLY_REPORT_DAY, hour: insightHour },
    calendarSync: { intervalMinutes: calendarInterval, enabled: isCalendarEnabled() }
  });
}

// ── Marta proactive delivery functions ────────────────────────────────

function cadenceDays(cadence: string): number {
  switch (cadence) {
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    default: return 7;
  }
}

async function deliverMartaPreOneOnOne(chatIds: number[]): Promise<void> {
  const people = await listPeople(true);
  if (people.length === 0) return;

  const now = Date.now();
  const directReports = people.filter((p) => p.relationship === "direct_report");

  // Calculate who needs a 1:1 and fetch items in parallel
  const dueCandidates = directReports.filter((person) => {
    const daysSince = person.lastOneOnOne
      ? Math.floor((now - new Date(person.lastOneOnOne).getTime()) / (1000 * 60 * 60 * 24))
      : 999;
    return daysSince >= cadenceDays(person.oneOnOneCadence) - 2;
  });

  if (dueCandidates.length === 0) return;

  const itemCounts = await Promise.all(
    dueCandidates.map((p) => listItemsByPerson(p.name, ["open"]).then((items) => items.length))
  );

  const dueForOneOnOne = dueCandidates.map((p, i) => ({ ...p, pendingCount: itemCounts[i] }));

  if (dueForOneOnOne.length === 0) return;

  const message = buildMartaPreOneOnOneAlert(dueForOneOnOne);
  if (!message) return;

  for (const chatId of chatIds) {
    try {
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "daily");
    } catch (error) {
      log.error("Marta pre-1:1 delivery failed", { chatId, error });
    }
  }
  log.info("Marta pre-1:1 alert delivered", { recipients: chatIds.length, peopleAlerted: dueForOneOnOne.length });
}

async function deliverMartaCrossTeamInsight(chatIds: number[]): Promise<void> {
  const people = await listPeople(true);
  if (people.length === 0) return;

  const directReports = people.filter((p) => p.relationship === "direct_report");
  if (directReports.length === 0) return;

  // Fetch all items in parallel
  const allItems = await Promise.all(
    directReports.map((p) => listItemsByPerson(p.name, ["open"]))
  );

  const insights: Array<{ type: string; message: string }> = [];

  for (let i = 0; i < directReports.length; i++) {
    const person = directReports[i];
    const items = allItems[i];
    const overdueItems = items.filter((it) => it.dueAt && new Date(it.dueAt) < new Date());

    if (overdueItems.length >= 3) {
      insights.push({
        type: "overdue_cluster",
        message: `${person.name} tem ${overdueItems.length} items atrasados — considere abordar no proximo 1:1.`
      });
    }

    const daysSince = person.lastOneOnOne
      ? Math.floor((Date.now() - new Date(person.lastOneOnOne).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    if (daysSince !== null && daysSince > 14) {
      insights.push({
        type: "stale_1on1",
        message: `Sem 1:1 com ${person.name} ha ${daysSince} dias — pode estar acumulando blockers.`
      });
    }
  }

  if (insights.length === 0) return;

  const message = buildMartaCrossTeamInsight(insights);
  if (!message) return;

  for (const chatId of chatIds) {
    try {
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "weekly");
    } catch (error) {
      log.error("Marta cross-team insight delivery failed", { chatId, error });
    }
  }
  log.info("Marta cross-team insight delivered", { recipients: chatIds.length, insightsCount: insights.length });
}

async function deliverRelationshipHealthAlerts(chatIds: number[]): Promise<void> {
  for (const chatId of chatIds) {
    try {
      const healthScores = await computeRelationshipHealth(chatId);
      const coldRelationships = healthScores.filter((h) => h.level === "cold");

      if (coldRelationships.length === 0) continue;

      const lines: string[] = ["🌡️ *Alerta de Saude de Relacionamentos*", ""];
      for (const r of coldRelationships) {
        lines.push(`🔴 *${r.personName}* — score: ${r.score}/100`);
        for (const alert of r.alerts) {
          lines.push(`  • ${alert}`);
        }
        lines.push("");
      }
      lines.push("_Considere agendar um 1:1 ou mandar uma mensagem para reconectar._");

      const message = lines.join("\n");
      await sendText(chatId, message);
      await insertProactiveRun(chatId, message, "weekly");
      log.info("relationship_health:alert_sent", { chatId, coldCount: coldRelationships.length });
    } catch (error) {
      log.error("relationship_health:alert_failed", { chatId, error });
    }
  }
}

// ── Calendar-driven proactive delivery ───────────────────────────────

async function deliverPreMeetingBriefs(chatId: number): Promise<void> {
  const preMeetingMinutes = env.PRE_MEETING_MINUTES;
  const events = await getUpcomingEvents(chatId, preMeetingMinutes);
  const unsentEvents = events.filter((e) => !e.preBriefSent);

  if (unsentEvents.length === 0) return;

  const people = await listPeople(true);

  for (const event of unsentEvents) {
    try {
      const person = event.personId ? people.find((p) => p.id === event.personId) : undefined;
      const minutesUntil = Math.max(0, Math.round((new Date(event.startAt).getTime() - Date.now()) / 60000));

      // For 1:1s with known person, build a rich brief
      if (person) {
        const [openItems, memories, pendingDecisions, commitments] = await Promise.all([
          listItemsByPerson(person.name, ["open"]),
          loadMemoriesForPerson(person.id, 5),
          listDecisionsByPerson([person.id], 5),
          listCommitmentsForMeeting([person.id])
        ]);

        const message = buildPreMeetingBrief({
          event,
          person,
          openItems,
          memories,
          pendingDecisions,
          commitments,
          minutesUntil
        });
        await sendText(chatId, message);
      } else {
        // Generic meeting reminder
        const attendeeNames = event.attendees.map((a) => a.name || a.email).filter(Boolean).join(", ");
        const msg = `📅 Em ~${minutesUntil}min: ${event.title}${attendeeNames ? `\nParticipantes: ${attendeeNames}` : ""}`;
        await sendText(chatId, msg);
      }

      await markPreBriefSent(event.id);
      await insertProactiveRun(chatId, `pre-brief: ${event.title}`, "daily");
      log.info("calendar:pre_brief_sent", { chatId, eventId: event.id, title: event.title });
    } catch (error) {
      log.error("calendar:pre_brief_failed", { chatId, eventId: event.id, error });
    }
  }
}

async function deliverPostMeetingPrompts(chatId: number): Promise<void> {
  const postMeetingMinutes = env.POST_MEETING_MINUTES;
  const events = await getRecentlyEndedEvents(chatId, postMeetingMinutes);
  const unsentEvents = events.filter((e) => !e.postPromptSent && !e.notesCaptured);

  if (unsentEvents.length === 0) return;

  const people = await listPeople(true);

  for (const event of unsentEvents) {
    try {
      const person = event.personId ? people.find((p) => p.id === event.personId) : undefined;
      const message = buildPostMeetingPrompt({ event, person });
      await sendText(chatId, message);
      await markPostPromptSent(event.id);
      await insertProactiveRun(chatId, `post-meeting: ${event.title}`, "daily");
      log.info("calendar:post_prompt_sent", { chatId, eventId: event.id, title: event.title });
    } catch (error) {
      log.error("calendar:post_prompt_failed", { chatId, eventId: event.id, error });
    }
  }
}

// ── Reminder delivery ────────────────────────────────────────────────

async function deliverScheduledReminders(): Promise<void> {
  const dueReminders = await getDueReminders();
  if (dueReminders.length === 0) return;

  for (const reminder of dueReminders) {
    try {
      await sendText(reminder.chatId, `🔔 Lembrete: ${reminder.text}`);
      await markReminderSent(reminder.id);

      // Schedule next occurrence if recurring
      if (reminder.recurrence) {
        const nextId = await scheduleNextRecurrence(reminder.id);
        if (nextId) {
          log.info("reminder:next_scheduled", { currentId: reminder.id, nextId, recurrence: reminder.recurrence });
        }
      }

      log.info("reminder:delivered", { id: reminder.id, chatId: reminder.chatId, text: reminder.text });
    } catch (error) {
      log.error("reminder:delivery_failed", { id: reminder.id, error });
    }
  }
}

// ── Decision review alerts ───────────────────────────────────────────

async function deliverDecisionReviewAlerts(chatId: number): Promise<void> {
  const decisions = await listDecisionsForReview(chatId);
  if (decisions.length === 0) return;

  const people = await listPeople(true);

  for (const decision of decisions) {
    try {
      const personNames = decision.personIds
        .map((pid) => people.find((p) => p.id === pid)?.name)
        .filter(Boolean)
        .join(", ");

      const age = Math.floor((Date.now() - new Date(decision.decidedAt).getTime()) / (1000 * 60 * 60 * 24));
      const msg = `📋 Decisao para revisao:\n\n"${decision.summary}"\n\nTomada ha ${age} dias${personNames ? ` com ${personNames}` : ""}.\nJa foi implementada?`;

      await sendTextWithButtons(chatId, msg, [
        [
          { text: "✅ Implementada", callback_data: `decision_implemented:${decision.id}` },
          { text: "⏰ Adiar 30d", callback_data: `decision_snooze:${decision.id}` },
          { text: "❌ Supersedida", callback_data: `decision_superseded:${decision.id}` }
        ]
      ]);

      log.info("decision:review_alert_sent", { chatId, decisionId: decision.id });
    } catch (error) {
      log.error("decision:review_alert_failed", { chatId, decisionId: decision.id, error });
    }
  }
}
