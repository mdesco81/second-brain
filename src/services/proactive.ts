import cron from "node-cron";
import { env } from "../config/env.js";
import { insertProactiveRun, listProactiveChats, loadLast24hSnapshot } from "../db/schema.js";
import { sendText } from "./telegram.js";
import { log } from "../utils/logger.js";

function buildDailyMessage(snapshot: { items: number; projects: number; categoriesUsed: number }): string {
  return [
    "Check-in diario do Second Brain:",
    `Ultimas 24h: ${snapshot.items} itens, ${snapshot.projects} projetos tocados, ${snapshot.categoriesUsed} categorias usadas.`,
    "Perguntas rapidas:",
    "1) Qual e a prioridade numero 1 de hoje?",
    "2) Existe algum bloqueio que devo registrar?",
    "3) Ha algo importante que voce nao me enviou ainda?"
  ].join("\n");
}

export function startProactiveScheduler(): void {
  const expression = `${env.PROACTIVE_MINUTE} ${env.PROACTIVE_HOUR} * * *`;

  cron.schedule(
    expression,
    async () => {
      try {
        const [chatIds, snapshot] = await Promise.all([listProactiveChats(), loadLast24hSnapshot()]);

        if (chatIds.length === 0) {
          log.info("Proactive run skipped: no chat subscriptions");
          return;
        }

        const message = buildDailyMessage(snapshot);

        for (const chatId of chatIds) {
          await sendText(chatId, message);
          await insertProactiveRun(chatId, message);
        }

        log.info("Proactive run delivered", { recipients: chatIds.length, snapshot });
      } catch (error) {
        log.error("Proactive run failed", { error });
      }
    },
    {
      timezone: env.TIMEZONE
    }
  );

  log.info("Proactive scheduler started", {
    timezone: env.TIMEZONE,
    hour: env.PROACTIVE_HOUR,
    minute: env.PROACTIVE_MINUTE
  });
}
