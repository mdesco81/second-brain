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
  snoozeDecisionReview,
  getActiveCosConversationById,
  cancelReminder,
  fulfillCommitment,
  updateCommitmentStatus,
  getCosOutput,
  insertSentEmail,
  updateLastContact,
  type CosConversation
} from "../db/schema.js";
import { sendEmail, isEmailEnabled } from "./email.js";
import { log } from "../utils/logger.js";

// Track in-flight email sends to prevent double-send on rapid clicks
const emailSendsInFlight = new Set<number>();

/**
 * Compute a date string N days from now (YYYY-MM-DD).
 */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Parse callback data string into structured parts.
 * Format: "action:itemId" or "action:itemId:convId"
 * The convId is optional — when present, it links the callback to a conversation.
 */
function parseCallbackData(data: string): { action: string; itemId: number; convId?: number } {
  const parts = data.split(":");
  return {
    action: parts[0],
    itemId: parseInt(parts[1], 10),
    convId: parts[2] ? parseInt(parts[2], 10) : undefined
  };
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

  const { action, itemId, convId } = parseCallbackData(data);

  // Load conversation context if convId was included in the callback payload
  const conv: CosConversation | null = convId ? await getActiveCosConversationById(convId) : null;
  if (convId) {
    log.info("callback:conv_context", { action, itemId, convId, convFound: !!conv });
  }

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

      case "reminder_cancel": {
        if (isNaN(itemId)) break;
        await cancelReminder(itemId);
        await answerCallbackQuery(query.id, "Recorrencia cancelada!");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "Recorrencia cancelada", callback_data: "noop:0" }]
          ]);
        }
        await sendText(chatId, "Lembrete recorrente cancelado.");
        log.info("callback:reminder_cancel", { chatId, reminderId: itemId });
        break;
      }

      case "email_send": {
        if (isNaN(itemId)) break;
        if (!isEmailEnabled()) {
          await answerCallbackQuery(query.id, "Email nao configurado (SMTP).");
          break;
        }
        const output = await getCosOutput(itemId);
        if (!output) {
          await answerCallbackQuery(query.id, "Draft nao encontrado.");
          break;
        }
        // Idempotency: prevent double-send on rapid clicks
        if (emailSendsInFlight.has(itemId)) {
          await answerCallbackQuery(query.id, "Email sendo enviado...");
          break;
        }
        emailSendsInFlight.add(itemId);
        // Parse subject and body from draft format: **Assunto:** X\n\n body
        const subjectMatch = output.content.match(/\*\*Assunto:\*\*\s*(.+)/);
        const subject = subjectMatch ? subjectMatch[1].trim() : `Email para ${output.title}`;
        // Body is everything after the subject line (skip the "**Assunto:**" line)
        const bodyLines = output.content.split("\n");
        const subjectLineIdx = bodyLines.findIndex(l => l.includes("**Assunto:**"));
        const body = subjectLineIdx >= 0
          ? bodyLines.slice(subjectLineIdx + 1).join("\n").replace(/^\s*\n/, "").trim()
          : output.content;

        // Find person email from the output metadata or cos_outputs
        const personId = output.personId;
        let recipientEmail: string | null = null;
        if (personId) {
          const { findPersonByName, listPeople } = await import("../db/schema.js");
          const people = await listPeople(true);
          const person = people.find(p => p.id === personId);
          recipientEmail = person?.email ?? null;
        }

        if (!recipientEmail) {
          await answerCallbackQuery(query.id, "Pessoa nao tem email cadastrado.");
          break;
        }

        try {
          await sendTypingIndicator(chatId);
          const messageIdHeader = await sendEmail({ to: recipientEmail, subject, body });
          await insertSentEmail({
            chatId,
            personId: personId ?? undefined,
            outputId: itemId,
            recipientEmail,
            subject,
            body,
            messageIdHeader: messageIdHeader ?? undefined
          });
          if (personId) await updateLastContact(personId);
          await answerCallbackQuery(query.id, "Email enviado!");
          if (messageId) {
            await editMessageButtons(chatId, messageId, [
              [{ text: "📧 Enviado ✓", callback_data: "noop:0" }]
            ]);
          }
          await sendText(chatId, `Email enviado para ${recipientEmail}!`);
          log.info("callback:email_sent", { chatId, outputId: itemId, to: recipientEmail });
        } catch (error) {
          log.error("callback:email_send_failed", { chatId, outputId: itemId, error });
          emailSendsInFlight.delete(itemId);
          await answerCallbackQuery(query.id, "Erro ao enviar email.");
          await sendText(chatId, "Nao consegui enviar o email. Verifique as configuracoes SMTP.");
        }
        break;
      }

      case "email_adjust": {
        if (isNaN(itemId)) break;
        await answerCallbackQuery(query.id, "Pode mandar o ajuste.");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "✏️ Ajustando...", callback_data: "noop:0" }]
          ]);
        }
        await sendText(chatId, "Me diz o que quer ajustar no email (tom, adicionar info, etc.).");
        log.info("callback:email_adjust", { chatId, outputId: itemId });
        break;
      }

      case "commitment_done": {
        if (isNaN(itemId)) break;
        await fulfillCommitment(itemId);
        await answerCallbackQuery(query.id, "Compromisso cumprido!");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "✅ Cumprido", callback_data: "noop:0" }]
          ]);
        }
        log.info("callback:commitment_done", { chatId, commitmentId: itemId });
        break;
      }

      case "commitment_cancel": {
        if (isNaN(itemId)) break;
        await updateCommitmentStatus(itemId, "cancelled");
        await answerCallbackQuery(query.id, "Compromisso cancelado.");
        if (messageId) {
          await editMessageButtons(chatId, messageId, [
            [{ text: "❌ Cancelado", callback_data: "noop:0" }]
          ]);
        }
        log.info("callback:commitment_cancel", { chatId, commitmentId: itemId });
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
