import { TelegramCallbackQuery } from "../types/telegram.js";
import {
  answerCallbackQuery,
  editMessageButtons,
  sendText,
  sendTypingIndicator
} from "./telegram.js";
import {
  updateInboxItemStatusById,
  snoozeInboxItem,
  updateInboxItemMetadata,
  updateDecisionStatus,
  snoozeDecisionReview
} from "../db/schema.js";
import { log } from "../utils/logger.js";

/**
 * Compute a date string N days from now (YYYY-MM-DD).
 */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Handle Telegram callback queries (inline keyboard button presses).
 *
 * Data format: "action:payload"
 * Actions:
 *   - done:<itemId>                    → Mark item as done
 *   - snooze:<itemId>                  → Snooze item by 3 days
 *   - jarbas_approve:<itemId>          → Approve Jarbas draft
 *   - jarbas_reject:<itemId>           → Reject Jarbas draft
 *   - jarbas_edit:<itemId>             → Mark draft for editing
 *   - decision_implemented:<decisionId> → Mark decision as implemented
 *   - decision_snooze:<decisionId>      → Snooze decision review by 30 days
 *   - decision_superseded:<decisionId>  → Mark decision as superseded
 */
export async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const data = query.data;

  if (!chatId || !data) {
    await answerCallbackQuery(query.id, "Erro: dados incompletos.");
    return;
  }

  const [action, payload] = data.split(":");
  const itemId = payload ? parseInt(payload, 10) : NaN;

  try {
    switch (action) {
      case "done": {
        if (isNaN(itemId)) break;
        await updateInboxItemStatusById(itemId, "done");
        await answerCallbackQuery(query.id, "Marcado como concluido!");
        if (messageId) await editMessageButtons(chatId, messageId, null);
        log.info("callback:done", { chatId, itemId });
        break;
      }

      case "snooze": {
        if (isNaN(itemId)) break;
        const untilDate = daysFromNow(3);
        await snoozeInboxItem(chatId, itemId, untilDate);
        await answerCallbackQuery(query.id, "Adiado por 3 dias!");
        if (messageId) await editMessageButtons(chatId, messageId, null);
        log.info("callback:snooze", { chatId, itemId, untilDate });
        break;
      }

      case "jarbas_approve": {
        if (isNaN(itemId)) break;
        await sendTypingIndicator(chatId);
        await updateInboxItemMetadata(itemId, {
          contentFeedback: "approved",
          feedbackAt: new Date().toISOString()
        });
        await answerCallbackQuery(query.id, "Draft aprovado!");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "✅ Aprovado", callback_data: "noop:0" }]
          ]);
        }
        await sendText(chatId, "Draft aprovado! Quando quiser, pode copiar o texto acima e publicar no LinkedIn.");
        log.info("callback:jarbas_approve", { chatId, itemId });
        break;
      }

      case "jarbas_reject": {
        if (isNaN(itemId)) break;
        await updateInboxItemMetadata(itemId, {
          contentFeedback: "rejected",
          feedbackAt: new Date().toISOString()
        });
        await answerCallbackQuery(query.id, "Rejeitado. Feedback registrado.");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "❌ Rejeitado", callback_data: "noop:0" }]
          ]);
        }
        await sendText(chatId, "Entendido, draft rejeitado. Esse feedback vai me ajudar a melhorar nos proximos. Quer tentar de novo com instrucoes diferentes?");
        log.info("callback:jarbas_reject", { chatId, itemId });
        break;
      }

      case "jarbas_edit": {
        if (isNaN(itemId)) break;
        await updateInboxItemMetadata(itemId, {
          contentFeedback: "needs_edit",
          feedbackAt: new Date().toISOString()
        });
        await answerCallbackQuery(query.id, "Aguardando edicao.");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "✏️ Aguardando edicao", callback_data: "noop:0" }]
          ]);
        }
        await sendText(chatId, "Pode editar no dashboard e subir a versao final. Vou comparar com o original para aprender seu estilo.");
        log.info("callback:jarbas_edit", { chatId, itemId });
        break;
      }

      case "decision_implemented": {
        if (isNaN(itemId)) break;
        await updateDecisionStatus(itemId, "implemented");
        await answerCallbackQuery(query.id, "Decisao marcada como implementada!");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "✅ Implementada", callback_data: "noop:0" }]
          ]);
        }
        log.info("callback:decision_implemented", { chatId, decisionId: itemId });
        break;
      }

      case "decision_snooze": {
        if (isNaN(itemId)) break;
        await snoozeDecisionReview(itemId, 30);
        await answerCallbackQuery(query.id, "Revisao adiada por 30 dias.");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "⏰ Adiada 30d", callback_data: "noop:0" }]
          ]);
        }
        log.info("callback:decision_snooze", { chatId, decisionId: itemId });
        break;
      }

      case "decision_superseded": {
        if (isNaN(itemId)) break;
        await updateDecisionStatus(itemId, "superseded");
        await answerCallbackQuery(query.id, "Decisao marcada como supersedida.");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "❌ Supersedida", callback_data: "noop:0" }]
          ]);
        }
        log.info("callback:decision_superseded", { chatId, decisionId: itemId });
        break;
      }

      case "noop": {
        await answerCallbackQuery(query.id);
        break;
      }

      default: {
        await answerCallbackQuery(query.id, "Acao nao reconhecida.");
        log.warn("callback:unknown_action", { action, data });
      }
    }
  } catch (error) {
    log.error("callback:error", { action, itemId, error });
    await answerCallbackQuery(query.id, "Erro ao processar. Tente novamente.").catch(() => {});
  }
}
