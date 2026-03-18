import { registerAgent } from "../registry.js";
import { AgentRequest, AgentResult } from "../types.js";
import { callClaude } from "../../services/openai.js";
import { sendText, sendTextWithButtons, sendTypingIndicator } from "../../services/telegram.js";
import { log } from "../../utils/logger.js";
import {
  appendConversationMessage,
  completeCosConversation,
  CosConversation,
  createCosConversation,
  findTodayEventByPerson,
  getActiveCosConversation,
  getLatestCosOutput,
  insertCosOutput,
  insertDecision,
  insertInboxItem,
  insertReminder,
  listCategories,
  listDecisionsByPerson,
  listItemsByPerson,
  listOpenActionItems,
  listOverdueItems,
  listPeople,
  listPeopleWithItems,
  listStaleItems,
  loadAllRelevantMemories,
  loadMemoriesByType,
  loadMemoriesForPerson,
  loadWeeklySummary,
  computeRelationshipHealth,
  insertCommitment,
  listCommitmentsForMeeting,
  logCosEvent,
  markMemoryUsed,
  markNotesCaptured,
  Person,
  touchCosConversation,
  updateCosConversation,
  updateLastContact,
  updateLastOneOnOne,
  upsertCosMemory,
  upsertPerson,
  saveChatMessage
} from "../../db/schema.js";
import { env } from "../../config/env.js";
import { classifyMartaIntent, MartaIntent, resolvePersonFuzzy } from "./intents.js";
import {
  buildBriefingPrompt,
  buildConversationalPrompt,
  buildEmailDraftPrompt,
  buildEventParsingPrompt,
  buildHelpMessage,
  buildNotesProcessingPrompt,
  buildReflectionPrompt,
  buildReminderParsingPrompt,
  buildStatusPrompt
} from "./prompts.js";
import { createCalendarEvent, isCalendarEnabled } from "../../services/calendar.js";

// ── Safe JSON extraction utility ─────────────────────────────────────

/**
 * Safely extract and parse the outermost JSON object from a string.
 * Uses bracket-counting instead of greedy regex to handle cases where
 * the LLM response contains text, code blocks, or nested braces around the JSON.
 * Returns the fallback value if parsing fails.
 */
function safeParseJson<T>(text: string, fallback: T): T {
  // Strategy 1: Try parsing the whole text as JSON (best case: clean response)
  try {
    const trimmed = text.trim()
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?\s*```$/i, "")
      .trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as T;
    }
  } catch { /* fall through */ }

  // Strategy 2: Bracket-counting to find the outermost balanced JSON object
  try {
    const startIdx = text.indexOf("{");
    if (startIdx === -1) return fallback;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }

      if (ch === '"' && !escape) { inString = !inString; continue; }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(startIdx, i + 1);
          return JSON.parse(candidate) as T;
        }
      }
    }
  } catch { /* fall through */ }

  // Strategy 3: Greedy regex as last resort
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
  } catch { /* fall through */ }

  return fallback;
}

// ── Format notes for human-readable display ──────────────────────────

/**
 * Build a clean, human-readable text from parsed notes data.
 * Used to store in cos_outputs.content so the dashboard shows a
 * readable summary instead of raw JSON.
 */
function formatNotesContent(parsed: {
  summary?: string;
  executive_bullets?: string[];
  action_items?: Array<{ title: string; owner?: string; due?: string | null; priority?: string }>;
  decisions?: Array<{ summary: string }>;
  commitments?: Array<{ summary: string; direction?: string; deadline?: string | null }>;
  team_mood?: string;
  risks?: Array<{ description: string; severity?: string }>;
  telegram_message?: string;
}, stats: { items: number; decisions: number; commitments: number }): string {
  const lines: string[] = [];

  // Summary / executive overview
  if (parsed.summary) {
    lines.push(parsed.summary);
    lines.push("");
  }

  // Executive bullets
  if (parsed.executive_bullets?.length) {
    lines.push("📌 Pontos-chave:");
    for (const b of parsed.executive_bullets) {
      lines.push(`  • ${b}`);
    }
    lines.push("");
  }

  // Action items
  if (parsed.action_items?.length) {
    lines.push(`✅ Action items (${parsed.action_items.length}):`);
    for (const item of parsed.action_items) {
      const owner = item.owner ? ` [${item.owner}]` : "";
      const due = item.due ? ` — prazo: ${item.due}` : "";
      const prio = item.priority ? ` (${item.priority})` : "";
      lines.push(`  • ${item.title}${owner}${prio}${due}`);
    }
    lines.push("");
  }

  // Decisions
  if (parsed.decisions?.length) {
    lines.push(`📋 Decisões (${parsed.decisions.length}):`);
    for (const d of parsed.decisions) {
      lines.push(`  • ${d.summary}`);
    }
    lines.push("");
  }

  // Commitments
  if (parsed.commitments?.length) {
    lines.push(`🤝 Compromissos (${parsed.commitments.length}):`);
    for (const c of parsed.commitments) {
      const dir = c.direction === "theirs" ? "[deles]" : "[meu]";
      const dl = c.deadline ? ` — prazo: ${c.deadline}` : "";
      lines.push(`  • ${dir} ${c.summary}${dl}`);
    }
    lines.push("");
  }

  // Risks
  if (parsed.risks?.length) {
    lines.push("⚠️ Riscos:");
    for (const r of parsed.risks) {
      const sev = r.severity ? `[${r.severity}] ` : "";
      lines.push(`  • ${sev}${r.description}`);
    }
    lines.push("");
  }

  // Team mood
  if (parsed.team_mood) {
    lines.push(`🧠 Clima: ${parsed.team_mood}`);
    lines.push("");
  }

  // Stats footer
  const statParts: string[] = [];
  if (stats.items > 0) statParts.push(`${stats.items} action item${stats.items > 1 ? "s" : ""}`);
  if (stats.decisions > 0) statParts.push(`${stats.decisions} decisão${stats.decisions > 1 ? "ões" : ""}`);
  if (stats.commitments > 0) statParts.push(`${stats.commitments} compromisso${stats.commitments > 1 ? "s" : ""}`);
  if (statParts.length > 0) {
    lines.push(`— Registrado: ${statParts.join(", ")}`);
  }

  return lines.join("\n").trim() || parsed.telegram_message || parsed.summary || "Notas processadas.";
}

// ── Multi-instruction detection ──────────────────────────────────────

const SPLIT_SYSTEM_PROMPT = `Voce analisa mensagens de um lider para sua Chief of Staff virtual.
Determine se a mensagem contem MULTIPLAS instrucoes DISTINTAS que devem ser executadas separadamente.

REGRAS:
- Instrucoes DISTINTAS sao acoes diferentes com objetivos diferentes (ex: "adiciona o Carlos" + "prepara o briefing do Joao")
- NAO divida se e uma unica instrucao com detalhes (ex: "adiciona o Carlos ele e tech lead" = UMA instrucao)
- NAO divida se os detalhes complementam a instrucao principal (ex: "prepara o briefing do Pedro focando em performance" = UMA instrucao)
- Divida SOMENTE quando ha conectores como "e tambem", "alem disso", "e depois", "e prepara", "e manda", ", e " seguidos de OUTRO verbo de acao
- Minimo 2, maximo 5 instrucoes

Se ha MULTIPLAS instrucoes, retorne JSON:
{"multiple": true, "instructions": ["instrucao 1 completa", "instrucao 2 completa", ...]}

Se ha UMA UNICA instrucao, retorne:
{"multiple": false}

Responda APENAS com JSON valido.`;

async function splitMultipleInstructions(text: string): Promise<string[]> {
  // Quick heuristic: skip short messages or messages without conjunction patterns
  if (text.length < 30 || !/\b(e\s+(tambem|depois|prepara|manda|registra|adiciona|anota|faz)|alem\s+disso|,\s+e\s+)/i.test(text)) {
    return [text];
  }

  try {
    const response = await callClaude({
      system: SPLIT_SYSTEM_PROMPT,
      userMessage: text,
      model: "fast",
      maxTokens: 512
    });

    if (!response) return [text];

    const parsed = safeParseJson<{ multiple?: boolean; instructions?: string[] }>(
      response, { multiple: false }
    );

    if (parsed.multiple && Array.isArray(parsed.instructions) && parsed.instructions.length >= 2) {
      log.info("marta:multi_instruction_detected", {
        original: text,
        count: parsed.instructions.length,
        instructions: parsed.instructions
      });
      return parsed.instructions;
    }

    return [text];
  } catch (error) {
    log.warn("marta:split_instructions_failed", { error });
    return [text];
  }
}

// Request-scoped cache for people list, keyed by chatId to avoid cross-request contamination.
// Entries auto-expire after 60 seconds to prevent stale data if clearPeopleCache is not called
// (e.g. handler crashes before finally block).
const peopleCacheByChat = new Map<number, { people: Person[]; ts: number }>();
const PEOPLE_CACHE_TTL_MS = 60_000; // 60 seconds

function clearPeopleCache(chatId: number): void {
  peopleCacheByChat.delete(chatId);
}

async function getPeopleList(chatId: number): Promise<Person[]> {
  const cached = peopleCacheByChat.get(chatId);
  if (cached && Date.now() - cached.ts < PEOPLE_CACHE_TTL_MS) return cached.people;
  const people = await listPeople(true);
  peopleCacheByChat.set(chatId, { people, ts: Date.now() });
  return people;
}

// ── Main Handler ──────────────────────────────────────────────────────

async function handleChiefOfStaff(request: AgentRequest): Promise<AgentResult> {
  const { chatId, messageId, rawRequest, mediaContent } = request;
  const orchestratorIntentHint = request.intent.metadata?.intentHint as string | undefined;

  try {
    // Check for active conversation (follow-up flow)
    const activeConv = await getActiveCosConversation(chatId);
    if (activeConv) {
      return await handleFollowUp(chatId, messageId, rawRequest, activeConv, mediaContent);
    }

    // ── Multi-instruction detection ──────────────────────────────────
    const instructions = await splitMultipleInstructions(rawRequest);
    if (instructions.length > 1) {
      await sendText(chatId, `Entendi ${instructions.length} pedidos. Vou processar cada um...`);
      const results: AgentResult[] = [];
      for (let i = 0; i < instructions.length; i++) {
        const mc = i === 0 ? mediaContent : undefined;
        const result = await processSingleInstruction(chatId, messageId, instructions[i], mc, orchestratorIntentHint);
        results.push(result);

        // If this instruction created a clarification conversation, stop processing
        // further instructions — createCosConversation expires previous conversations,
        // so continuing would silently drop the clarification flow.
        if (result.summary === "Aguardando esclarecimento." || result.summary === "Aguardando nome da pessoa." || result.summary === "Aguardando notas." || result.summary === "Aguardando destinatario." || result.summary === "Aguardando tema do email." || result.summary === "Aguardando nome.") {
          if (i < instructions.length - 1) {
            log.info("marta:multi_instruction_paused", {
              processed: i + 1,
              remaining: instructions.length - i - 1,
              reason: "clarification_needed"
            });
            await sendText(chatId, `Processei ${i + 1} de ${instructions.length} pedidos. Vou continuar com os outros depois que voce responder.`);
          }
          break;
        }
      }
      const allSuccess = results.every((r) => r.success);
      const summaries = results.map((r) => r.summary).join(" | ");
      return { success: allSuccess, agentId: "chiefofstaff", summary: summaries };
    }

    // Single instruction — process normally
    return await processSingleInstruction(chatId, messageId, rawRequest, mediaContent, orchestratorIntentHint);
  } catch (error) {
    log.error("marta:handler_error", { chatId, error });
    await sendText(chatId, "Desculpa, tive um problema ao processar seu pedido. Pode tentar de novo?");
    return { success: false, agentId: "chiefofstaff", summary: "Handler error", error: String(error) };
  } finally {
    clearPeopleCache(chatId); // Clear request-scoped cache
  }
}

/**
 * Process a single instruction through the intent classification → execution pipeline.
 * Extracted from handleChiefOfStaff to allow multi-instruction processing.
 */
async function processSingleInstruction(
  chatId: number,
  messageId: number,
  rawRequest: string,
  mediaContent: string | undefined,
  orchestratorIntentHint?: string
): Promise<AgentResult> {
  // Quick brief shortcut — bypasses intent classification for speed
  const quickBriefMatch = rawRequest.match(
    /(?:vou entrar|entrando|indo pr[ao] (?:1[:\-]1|one.on.one|call|reuniao)|call agora|reuniao agora)\s+(?:com\s+(?:o\s+|a\s+)?)?(.+)/i
  );
  if (quickBriefMatch) {
    const personName = quickBriefMatch[1].trim().replace(/[.,!?]+$/, "");
    return await handleQuickBrief(chatId, messageId, personName);
  }

  // For intent classification, include a hint about attached media so the NLU
  // can better classify (e.g. PDF with notes → intent "notas")
  // Also include orchestrator's intentHint to guide classification and reduce errors
  let classificationText = mediaContent
    ? `${rawRequest}\n\n[Conteudo extraido de arquivo anexo — ${mediaContent.length} caracteres]`
    : rawRequest;

  if (orchestratorIntentHint) {
    classificationText = `[DICA DO ORQUESTRADOR: o intent provavel eh "${orchestratorIntentHint}"]\n\n${classificationText}`;
  }

  // Classify intent (cache people list for reuse in handlers)
  const people = await getPeopleList(chatId);
  const intent = await classifyMartaIntent(classificationText, people);

  log.info("marta:intent_classified", {
    intent: intent.intent,
    person: intent.person,
    personId: intent.personId,
    needsClarification: intent.needsClarification,
    hasMediaContent: Boolean(mediaContent)
  });

  // If needs clarification, start a conversation
  if (intent.needsClarification && intent.clarificationQuestion) {
    const convId = await createCosConversation({
      chatId,
      intent: intent.intent,
      personId: intent.personId ?? undefined,
      context: { originalRequest: rawRequest, intent }
    });
    await appendConversationMessage(convId, "user", rawRequest);
    await appendConversationMessage(convId, "assistant", intent.clarificationQuestion);
    await updateCosConversation(convId, { state: "clarifying" });

    await logCosEvent({ chatId, eventType: "follow_up_asked", conversationId: convId, details: { intent: intent.intent } });
    await sendText(chatId, intent.clarificationQuestion);

    // Save clarification question to chat_context so the orchestrator sees it in history
    await saveChatMessage(chatId, "assistant", intent.clarificationQuestion, "marta", {
      type: "clarification",
      intent: intent.intent,
      originalRequest: rawRequest
    });

    return { success: true, agentId: "chiefofstaff", summary: "Aguardando esclarecimento." };
  }

  // Execute intent directly
  return await executeIntent(chatId, messageId, rawRequest, intent, mediaContent);
}

// ── Follow-up Handler ─────────────────────────────────────────────────

export async function handleFollowUp(
  chatId: number,
  messageId: number,
  text: string,
  conv: CosConversation,
  mediaContent?: string
): Promise<AgentResult> {
  // Enforce max turns — proceed with best-effort using original context
  if (conv.turns >= conv.maxTurns) {
    await completeCosConversation(conv.id);
    log.info("marta:max_turns_reached", { convId: conv.id, turns: conv.turns });

    // Preserve original intent and person from conversation context instead of
    // reclassifying (which loses the already-gathered context like person, topic).
    const context = conv.context as { intent?: MartaIntent; originalRequest?: string };
    if (context.intent) {
      const preservedIntent: MartaIntent = {
        ...context.intent,
        needsClarification: false,
        clarificationQuestion: null,
        detalhesExtras: [context.intent.detalhesExtras, text].filter(Boolean).join(". ")
      };
      // If person was still missing, try to resolve from the new text
      if (!preservedIntent.personId && !preservedIntent.person) {
        const resolved = await resolvePersonFuzzy(text);
        if (resolved) {
          preservedIntent.person = resolved.name;
          preservedIntent.personId = resolved.id;
        }
      }
      const combinedRequest = context.originalRequest
        ? `${context.originalRequest}\n\n[Esclarecimento]: ${text}`
        : text;
      return await executeIntent(chatId, messageId, combinedRequest, preservedIntent, mediaContent);
    }

    // Fallback: no stored intent — reclassify (shouldn't happen normally)
    clearPeopleCache(chatId);
    const people = await getPeopleList(chatId);
    const intent = await classifyMartaIntent(text, people);
    return await executeIntent(chatId, messageId, text, intent, mediaContent);
  }

  const userMessageForLog = mediaContent
    ? `${text}\n\n[Conteudo de arquivo anexo: ${mediaContent.length} caracteres]`
    : text;
  await appendConversationMessage(conv.id, "user", userMessageForLog);
  await logCosEvent({ chatId, eventType: "follow_up_answered", conversationId: conv.id });

  // Rebuild intent with the new context
  const context = conv.context as { intent?: MartaIntent; originalRequest?: string };
  const originalIntent = context.intent ?? { intent: conv.intent as MartaIntent["intent"], person: null, personId: conv.personId, tema: null, detalhesExtras: null, needsClarification: false, clarificationQuestion: null };

  // Enrich the intent with the follow-up answer
  // Append to existing detalhesExtras instead of replacing (preserves original instructions)
  const enrichedIntent: MartaIntent = {
    ...originalIntent,
    needsClarification: false,
    clarificationQuestion: null,
    detalhesExtras: [originalIntent.detalhesExtras, text].filter(Boolean).join(". ")
  };

  // If the original intent was missing a person and the answer might contain one
  if (!enrichedIntent.personId && enrichedIntent.person === null) {
    const resolved = await resolvePersonFuzzy(text);
    if (resolved) {
      enrichedIntent.person = resolved.name;
      enrichedIntent.personId = resolved.id;
    }
  }

  // If was asking for tema and got it (but not for "notas" — there the answer IS the notes content)
  if (!enrichedIntent.tema && enrichedIntent.intent !== "notas") {
    enrichedIntent.tema = text;
  }

  const combinedRequest = context.originalRequest
    ? `${context.originalRequest}\n\n[Esclarecimento]: ${text}`
    : text;

  try {
    // Touch conversation timestamp before long AI calls to prevent 30-min auto-expiry
    await touchCosConversation(conv.id);
    const result = await executeIntent(chatId, messageId, combinedRequest, enrichedIntent, mediaContent);

    if (result.success) {
      await completeCosConversation(conv.id, result.itemId ?? undefined);
    }

    return result;
  } catch (error) {
    // Prevent orphaned conversations: if executeIntent throws, complete the
    // conversation so the user doesn't get stuck in a broken follow-up loop.
    log.error("marta:follow_up_execute_error", { convId: conv.id, error });
    await completeCosConversation(conv.id).catch(() => {});
    throw error; // Re-throw so the outer handler can send error message
  }
}

// ── Intent Router ─────────────────────────────────────────────────────

async function executeIntent(
  chatId: number,
  messageId: number,
  rawRequest: string,
  intent: MartaIntent,
  mediaContent?: string
): Promise<AgentResult> {
  switch (intent.intent) {
    case "briefing":
      return await handleBriefing(chatId, messageId, rawRequest, intent);
    case "notas":
      return await handleNotas(chatId, messageId, rawRequest, intent, mediaContent);
    case "status":
      return await handleStatus(chatId, messageId, rawRequest);
    case "email":
      return await handleEmail(chatId, messageId, rawRequest, intent);
    case "equipe":
      return await handleEquipe(chatId, messageId, rawRequest, intent);
    case "reflexao":
      return await handleReflexao(chatId, messageId, rawRequest);
    case "reminder":
      return await handleReminder(chatId, messageId, rawRequest, intent);
    case "agendar":
      return await handleAgendar(chatId, messageId, rawRequest, intent);
    case "ajuda":
      await sendText(chatId, buildHelpMessage());
      return { success: true, agentId: "chiefofstaff", summary: "Ajuda enviada." };
    case "conversa_geral":
    default:
      return await handleConversaGeral(chatId, messageId, mediaContent ? `${rawRequest}\n\n[Conteudo do arquivo]:\n${mediaContent}` : rawRequest);
  }
}

// ── Quick Brief (template-based, no AI call) ─────────────────────────

async function handleQuickBrief(
  chatId: number,
  _messageId: number,
  personName: string
): Promise<AgentResult> {
  await sendTypingIndicator(chatId);

  const resolved = await resolvePersonFuzzy(personName);
  if (!resolved) {
    await sendText(chatId, `Nao encontrei "${personName}" na equipe. Verifique o nome.`);
    return { success: false, agentId: "chiefofstaff", summary: "Quick brief: person not found", error: "person_not_found" };
  }

  // Parallel data fetch for speed
  const [openItems, memories, commitments] = await Promise.all([
    listItemsByPerson(resolved.name, ["open"]),
    loadMemoriesForPerson(resolved.id, 5),
    listCommitmentsForMeeting([resolved.id])
  ]);

  const overdueItems = openItems.filter(i => i.dueAt && new Date(i.dueAt) < new Date());
  const topItems = openItems.slice(0, 7);

  // Build template
  let msg = `⚡ *Quick Brief — ${resolved.name}*`;
  if (resolved.role) msg += ` (${resolved.role})`;
  msg += "\n\n";

  if (topItems.length > 0) {
    msg += `📌 *Pendencias* (${openItems.length} aberto${openItems.length !== 1 ? "s" : ""})\n`;
    for (const item of topItems) {
      const isOverdue = item.dueAt && new Date(item.dueAt) < new Date();
      const flag = isOverdue ? "🔴 " : "• ";
      const title = item.actionTitle || item.summaryPtBr || "Sem titulo";
      const truncated = title.length > 50 ? title.slice(0, 50) + "..." : title;
      msg += `${flag}#${item.id} ${truncated}\n`;
    }
    if (openItems.length > 7) {
      msg += `  _... e mais ${openItems.length - 7}_\n`;
    }
    msg += "\n";
  } else {
    msg += "✅ Nenhuma pendencia aberta com esta pessoa.\n\n";
  }

  if (overdueItems.length > 0) {
    msg += `⚠️ ${overdueItems.length} item${overdueItems.length > 1 ? "s" : ""} atrasado${overdueItems.length > 1 ? "s" : ""}!\n\n`;
  }

  // Show open commitments
  if (commitments.length > 0) {
    const mine = commitments.filter(c => c.direction === "mine");
    const theirs = commitments.filter(c => c.direction === "theirs");
    msg += "🤝 *Compromissos Abertos*\n";
    if (mine.length > 0) {
      msg += "_Meus:_\n";
      for (const c of mine.slice(0, 3)) {
        const dl = c.deadline ? ` (ate ${c.deadline})` : "";
        msg += `• ${c.summary}${dl}\n`;
      }
    }
    if (theirs.length > 0) {
      msg += `_De ${resolved.name}:_\n`;
      for (const c of theirs.slice(0, 3)) {
        const dl = c.deadline ? ` (ate ${c.deadline})` : "";
        msg += `• ${c.summary}${dl}\n`;
      }
    }
    msg += "\n";
  }

  if (memories.length > 0) {
    msg += "💡 *Lembrar*\n";
    for (const m of memories) {
      const content = m.content.length > 80 ? m.content.slice(0, 80) + "..." : m.content;
      msg += `• ${content}\n`;
    }
    msg += "\n";
  }

  msg += "_Boa reuniao! Depois me manda as notas._ 📝";

  await sendText(chatId, msg);

  await logCosEvent({
    chatId,
    eventType: "quick_brief",
    personId: resolved.id,
    details: { personName: resolved.name, openItems: openItems.length, overdueItems: overdueItems.length }
  });

  return { success: true, agentId: "chiefofstaff", summary: `Quick brief: ${resolved.name} (${openItems.length} items, ${overdueItems.length} overdue)` };
}

// ── Intent: Briefing Pre-1:1 ──────────────────────────────────────────

async function handleBriefing(
  chatId: number,
  _messageId: number,
  rawRequest: string,
  intent: MartaIntent
): Promise<AgentResult> {
  if (!intent.personId || !intent.person) {
    // Try to resolve person one more time
    if (intent.person) {
      const resolved = await resolvePersonFuzzy(intent.person);
      if (resolved) {
        intent.personId = resolved.id;
        intent.person = resolved.name;
      }
    }

    if (!intent.personId) {
      // Ask via conversation
      const convId = await createCosConversation({
        chatId,
        intent: "briefing",
        context: { originalRequest: rawRequest, intent }
      });
      await appendConversationMessage(convId, "user", rawRequest);
      const question = "Com quem e o 1:1? Me diz o nome que eu preparo o briefing.";
      await appendConversationMessage(convId, "assistant", question);
      await updateCosConversation(convId, { state: "clarifying" });
      await sendText(chatId, question);
      await saveChatMessage(chatId, "assistant", question, "marta", { type: "clarification", intent: "briefing" });
      return { success: true, agentId: "chiefofstaff", summary: "Aguardando nome da pessoa." };
    }
  }

  await sendTypingIndicator(chatId);
  await sendText(chatId, `Preparando briefing do 1:1 com ${intent.person}...`);

  const people = await getPeopleList(chatId);
  const person = people.find((p) => p.id === intent.personId);
  if (!person) {
    await sendText(chatId, `Nao encontrei ${intent.person} na equipe. Diga \"adiciona [nome]\" para registrar.`);
    return { success: false, agentId: "chiefofstaff", summary: "Pessoa nao encontrada.", error: "person_not_found" };
  }

  const [openItems, overdueItems, memories, latestNotes, pendingDecisions, openCommitments] = await Promise.all([
    listItemsByPerson(person.name, ["open"]),
    listOverdueItems(chatId, 10),
    loadMemoriesForPerson(person.id),
    getLatestCosOutput(person.id, "one_on_one_notes"),
    listDecisionsByPerson([person.id]),
    listCommitmentsForMeeting([person.id])
  ]);

  // Mark memories as used (concurrent)
  await Promise.all(memories.map((mem) => markMemoryUsed(mem.id)));

  const personOverdue = overdueItems.filter(
    (i) => i.followUpWith?.toLowerCase().includes(person.name.toLowerCase())
  );

  const { system, user } = buildBriefingPrompt({
    person,
    openItems,
    overdueItems: personOverdue,
    memories,
    previousNotes: latestNotes?.content ?? null,
    tema: intent.tema,
    pendingDecisions,
    openCommitments
  });

  const response = await callClaude({ system, userMessage: user, maxTokens: 2048 });
  if (!response) {
    await sendText(chatId, "Nao consegui gerar o briefing. Tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  const outputId = await insertCosOutput({
    chatId,
    outputType: "briefing",
    personId: person.id,
    title: `Briefing 1:1 ${person.name}`,
    content: response
  });

  await logCosEvent({ chatId, eventType: "briefing_generated", personId: person.id, outputId });
  await sendText(chatId, response);
  await saveChatMessage(chatId, "assistant", response.slice(0, 500), "marta", { type: "briefing", personId: person.id });

  return { success: true, agentId: "chiefofstaff", summary: `Briefing gerado para ${person.name}.` };
}

// ── Intent: Processar Notas de 1:1 ───────────────────────────────────

async function handleNotas(
  chatId: number,
  _messageId: number,
  rawRequest: string,
  intent: MartaIntent,
  mediaContent?: string
): Promise<AgentResult> {
  if (!intent.personId || !intent.person) {
    if (intent.person) {
      const resolved = await resolvePersonFuzzy(intent.person);
      if (resolved) {
        intent.personId = resolved.id;
        intent.person = resolved.name;
      }
    }

    if (!intent.personId) {
      const convId = await createCosConversation({
        chatId,
        intent: "notas",
        context: { originalRequest: rawRequest, intent }
      });
      await appendConversationMessage(convId, "user", rawRequest);
      const question = "Com quem foi a reuniao? Me diz o nome.";
      await appendConversationMessage(convId, "assistant", question);
      await updateCosConversation(convId, { state: "clarifying" });
      await sendText(chatId, question);
      await saveChatMessage(chatId, "assistant", question, "marta", { type: "clarification", intent: "notas" });
      return { success: true, agentId: "chiefofstaff", summary: "Aguardando nome da pessoa." };
    }
  }

  // Check if the message is too short (just announcing, no actual notes)
  // Skip check entirely if we have media content (PDF/image already extracted)
  if (!mediaContent) {
    const contentPart = rawRequest.replace(/[^a-zA-Zà-ú\s]/g, "").trim();
    const wordCount = contentPart.split(/\s+/).length;
    const hasNoteSignals = /(?:decidimos|combinou|ficou de|precisa|prazo|entrega|alinhamos|alinhar|action|vai fazer|pendente|bloqueio|bloqueado)/i.test(rawRequest);
    if (wordCount < 10 && !hasNoteSignals) {
      const convId = await createCosConversation({
        chatId,
        intent: "notas",
        personId: intent.personId ?? undefined,
        context: { originalRequest: rawRequest, intent }
      });
      await appendConversationMessage(convId, "user", rawRequest);
      const question = `Entendido, reuniao com ${intent.person}. Pode me mandar as notas ou transcript (texto, audio, PDF ou foto) que eu processo e extraio os action items.`;
      await appendConversationMessage(convId, "assistant", question);
      await updateCosConversation(convId, { state: "clarifying" });
      await sendText(chatId, question);
      await saveChatMessage(chatId, "assistant", question, "marta", { type: "clarification", intent: "notas" });
      return { success: true, agentId: "chiefofstaff", summary: "Aguardando notas." };
    }
  }

  await sendTypingIndicator(chatId);
  await sendText(chatId, `Processando notas do 1:1 com ${intent.person}...`);

  const people = await getPeopleList(chatId);
  const person = people.find((p) => p.id === intent.personId);
  if (!person) {
    await sendText(chatId, `Nao encontrei ${intent.person} na equipe. Diga \"adiciona [nome]\" para registrar.`);
    return { success: false, agentId: "chiefofstaff", summary: "Pessoa nao encontrada.", error: "person_not_found" };
  }
  const memories = await loadMemoriesForPerson(person.id);

  // Use media content (PDF text / image description) as the primary notes content
  // when available, combined with caption text for context
  let notesText = mediaContent
    ? [rawRequest, mediaContent].filter(Boolean).join("\n\n")
    : rawRequest;

  // Truncate very long notes to avoid token overflow
  const MAX_NOTES_LENGTH = 12_000;
  if (notesText.length > MAX_NOTES_LENGTH) {
    log.warn("marta:notes_truncated", { personId: person.id, originalLength: notesText.length });
    notesText = notesText.slice(0, MAX_NOTES_LENGTH) + "\n\n[... texto truncado por limite de tamanho ...]";
  }

  const teamList = people.map((p) => `- ${p.name} (${p.role ?? "liderado"})`).join("\n");

  const { system, user } = buildNotesProcessingPrompt({
    person,
    notesText,
    memories,
    currentDate: new Date().toISOString().slice(0, 10),
    teamMembers: teamList
  });

  // Use 16000 tokens — complex meetings with 30+ action items easily exceed 4096
  const response = await callClaude({ system, userMessage: user, maxTokens: 16_000 });
  if (!response) {
    await sendText(chatId, "Nao consegui processar as notas. Tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  type NotesPayload = {
    summary?: string;
    executive_bullets?: string[];
    action_items?: Array<{ title: string; owner: string; due: string | null; priority: string }>;
    decisions?: Array<{ summary: string; rationale?: string; participants?: string[]; review_date?: string }>;
    commitments?: Array<{ summary: string; direction: "mine" | "theirs"; deadline: string | null }>;
    person_insights?: string[];
    team_mood?: string;
    risks?: Array<{ description: string; severity: string }>;
    telegram_message?: string;
  };

  const parsed = safeParseJson<NotesPayload>(response, { summary: response, telegram_message: response });

  // Detect if parsing failed (Claude response likely truncated or malformed)
  if (!parsed.action_items && !parsed.decisions && parsed.summary === response) {
    log.warn("marta:notes_parse_failed", {
      personId: person.id,
      responseLength: response.length,
      responseEnd: response.slice(-200),
      hint: "JSON parse failed — response may have been truncated by max_tokens limit"
    });
  }

  // Create action items from notes — resolve owners to person entities
  const categories = await listCategories();
  const defaultCategory = categories[0]?.id ?? 1;
  let createdItems = 0;

  if (parsed.action_items && Array.isArray(parsed.action_items)) {
    for (const item of parsed.action_items) {
      try {
        const ownerName = item.owner || person.name;
        const resolvedOwner = await resolvePersonFuzzy(ownerName, people);
        const resolvedPersonId = resolvedOwner?.id ?? person.id;

        await insertInboxItem({
          chatId,
          messageId: 0,
          inputType: "text",
          rawText: `[1:1 ${person.name}] ${item.title}`,
          normalizedText: item.title,
          summaryPtBr: item.title,
          categoryId: defaultCategory,
          bucket: "AREAS",
          action: "CREATE_TASK",
          priority: (item.priority as "ALTA" | "MEDIA" | "BAIXA") || "MEDIA",
          actionTitle: item.title,
          dueAt: item.due || undefined,
          followUpWith: resolvedOwner?.name ?? ownerName,
          processingStage: "planejado",
          confidence: 0.9,
          metadata: {
            source: "marta_1on1",
            personId: resolvedPersonId,
            meetingWith: person.name,
            meetingPersonId: person.id
          }
        });
        createdItems++;
      } catch (error) {
        log.warn("marta:action_item_creation_failed", { item, error });
      }
    }
  }

  // Save person insights as memories (use content hash for dedup/confirmation)
  if (parsed.person_insights && Array.isArray(parsed.person_insights)) {
    for (const insight of parsed.person_insights) {
      // Key based on first 40 chars of insight for natural dedup
      const slug = insight.toLowerCase().replace(/[^a-z0-9à-ú]+/g, "_").slice(0, 40);
      const key = `${person.name.toLowerCase().replace(/\s+/g, "_")}_${slug}`;
      await upsertCosMemory({
        memoryType: "person_insight",
        personId: person.id,
        key,
        content: insight,
        source: `1:1 notes ${new Date().toISOString().slice(0, 10)}`
      });
    }
  }

  // Save decisions to decision journal
  let createdDecisions = 0;
  if (parsed.decisions && Array.isArray(parsed.decisions)) {
    for (const decision of parsed.decisions) {
      if (!decision.summary) continue;
      try {
        // Resolve participant names to person IDs
        const personIds = [person.id]; // Always include the main person
        if (decision.participants && Array.isArray(decision.participants)) {
          const people = await getPeopleList(chatId);
          for (const name of decision.participants) {
            const resolved = await resolvePersonFuzzy(name, people);
            if (resolved && !personIds.includes(resolved.id)) {
              personIds.push(resolved.id);
            } else if (!resolved) {
              log.info("marta:decision_participant_not_found", { name, decisionSummary: decision.summary });
            }
          }
        }

        const reviewDate = decision.review_date
          ? new Date(decision.review_date)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default

        await insertDecision({
          chatId,
          personIds,
          summary: decision.summary,
          rationale: decision.rationale ?? undefined,
          context: `1:1 com ${person.name}`,
          decidedAt: new Date(),
          reviewAt: reviewDate
        });
        createdDecisions++;
      } catch (error) {
        log.warn("marta:decision_creation_failed", { decision, error });
      }
    }
  }

  // Save commitments
  let createdCommitments = 0;
  if (parsed.commitments && Array.isArray(parsed.commitments)) {
    for (const commitment of parsed.commitments) {
      if (!commitment.summary) continue;
      try {
        await insertCommitment({
          chatId,
          personId: person.id,
          direction: commitment.direction === "theirs" ? "theirs" : "mine",
          summary: commitment.summary,
          deadline: commitment.deadline || undefined
        });
        createdCommitments++;
      } catch (error) {
        log.warn("marta:commitment_creation_failed", { commitment, error });
      }
    }
  }

  // Save risks as memories
  if (parsed.risks && Array.isArray(parsed.risks)) {
    for (const risk of parsed.risks) {
      if (!risk.description) continue;
      const slug = risk.description.toLowerCase().replace(/[^a-z0-9à-ú]+/g, "_").slice(0, 40);
      const key = `risk_${person.name.toLowerCase().replace(/\s+/g, "_")}_${slug}`;
      await upsertCosMemory({
        memoryType: "meeting_risk",
        personId: person.id,
        key,
        content: `[${risk.severity ?? "medium"}] ${risk.description}`,
        source: `1:1 notes ${new Date().toISOString().slice(0, 10)}`
      });
    }
  }

  // Save team mood as memory
  if (parsed.team_mood) {
    await upsertCosMemory({
      memoryType: "person_mood",
      personId: person.id,
      key: `mood_${person.name.toLowerCase().replace(/\s+/g, "_")}`,
      content: `${person.name} parecia ${parsed.team_mood} no 1:1 de ${new Date().toISOString().slice(0, 10)}`,
      source: `1:1 notes ${new Date().toISOString().slice(0, 10)}`
    });
  }

  // Update last 1:1 timestamp and last contact
  await updateLastOneOnOne(person.id);
  await updateLastContact(person.id);

  // Auto-link notes with calendar event (if there's a meeting today with this person)
  try {
    const calEvent = await findTodayEventByPerson(person.id, chatId, env.TIMEZONE);
    if (calEvent) {
      await markNotesCaptured(calEvent.id);
      log.info("marta:notes_linked_to_calendar", { eventId: calEvent.id, personId: person.id });
    }
  } catch (error) {
    log.warn("marta:calendar_link_failed", { error });
  }

  // Save output — format as human-readable text instead of raw JSON
  const displayContent = formatNotesContent(parsed, {
    items: createdItems,
    decisions: createdDecisions,
    commitments: createdCommitments
  });
  const outputId = await insertCosOutput({
    chatId,
    outputType: "one_on_one_notes",
    personId: person.id,
    title: `Notas 1:1 ${person.name} — ${new Date().toISOString().slice(0, 10)}`,
    content: displayContent,
    metadata: {
      actionItemsCreated: createdItems,
      decisionsCreated: createdDecisions,
      commitmentsCreated: createdCommitments,
      executiveBullets: parsed.executive_bullets ?? [],
      teamMood: parsed.team_mood ?? null
    }
  });

  await logCosEvent({
    chatId,
    eventType: "notes_processed",
    personId: person.id,
    outputId,
    details: { actionItemsCreated: createdItems, decisionsCreated: createdDecisions, commitmentsCreated: createdCommitments }
  });

  // Send Telegram message — build from parsed data (telegram_message removed from prompt to save tokens)
  const telegramMsg = parsed.telegram_message ?? parsed.summary ?? "Notas processadas.";
  const tgParts: string[] = [`📝 1:1 com ${person.name}\n\n${telegramMsg}`];

  if (parsed.executive_bullets?.length) {
    tgParts.push("\n\n📌 Pontos-chave:");
    for (const b of parsed.executive_bullets) {
      tgParts.push(`  • ${b}`);
    }
  }

  const statParts: string[] = [];
  if (createdItems > 0) {
    statParts.push(`✅ ${createdItems} action item${createdItems > 1 ? "s" : ""} criado${createdItems > 1 ? "s" : ""}`);
  }
  if (createdDecisions > 0) {
    statParts.push(`📋 ${createdDecisions} ${createdDecisions > 1 ? "decisoes registradas" : "decisao registrada"} no journal`);
  }
  if (createdCommitments > 0) {
    statParts.push(`🤝 ${createdCommitments} compromisso${createdCommitments > 1 ? "s registrados" : " registrado"}`);
  }
  const footer = statParts.length > 0
    ? `\n\n${statParts.join("\n")}\n\nAlgum ajuste ou algo que eu perdi?`
    : "\n\nNenhum action item, decisao ou compromisso identificados. Quer que eu revise algo?";
  tgParts.push(footer);

  const tgMessage = tgParts.join("\n");
  await sendText(chatId, tgMessage);
  await saveChatMessage(chatId, "assistant", tgMessage.slice(0, 500), "marta", { type: "notas", personId: person.id });

  return { success: true, agentId: "chiefofstaff", summary: `Notas processadas: ${createdItems} items, ${createdDecisions} decisoes, ${createdCommitments} compromissos.` };
}

// ── Intent: Status Cross-Team ─────────────────────────────────────────

async function handleStatus(
  chatId: number,
  _messageId: number,
  _rawRequest: string
): Promise<AgentResult> {
  await sendTypingIndicator(chatId);
  await sendText(chatId, "Levantando o panorama da equipe...");

  const peopleWithItems = await listPeopleWithItems();
  if (peopleWithItems.length === 0) {
    await sendText(chatId, "Ainda nao tenho ninguem da equipe registrado. Diga \"adiciona o [nome], [papel]\" para registrar.");
    return { success: true, agentId: "chiefofstaff", summary: "Nenhuma pessoa registrada." };
  }

  const [overdueItems, staleItems, memories, healthScores] = await Promise.all([
    listOverdueItems(undefined, 50),
    listStaleItems(undefined, 3, 50),
    loadMemoriesByType("pattern", 10),
    computeRelationshipHealth(chatId)
  ]);

  const { system, user } = buildStatusPrompt({
    people: peopleWithItems,
    globalMetrics: {
      totalOverdue: overdueItems.length,
      totalStale: staleItems.length,
      totalOpen: peopleWithItems.reduce((acc, p) => acc + p.stats.totalOpen, 0)
    },
    memories,
    healthScores
  });

  const response = await callClaude({ system, userMessage: user, model: "fast", maxTokens: 2048 });
  if (!response) {
    await sendText(chatId, "Nao consegui gerar o panorama. Tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  const outputId = await insertCosOutput({
    chatId,
    outputType: "status_report",
    title: `Status equipe — ${new Date().toISOString().slice(0, 10)}`,
    content: response
  });

  await logCosEvent({ chatId, eventType: "status_generated", outputId, details: { peopleCount: peopleWithItems.length } });
  await sendText(chatId, response);
  await saveChatMessage(chatId, "assistant", response.slice(0, 500), "marta", { type: "status" });

  return { success: true, agentId: "chiefofstaff", summary: "Panorama cross-team gerado." };
}

// ── Intent: Draft Email ───────────────────────────────────────────────

async function handleEmail(
  chatId: number,
  _messageId: number,
  rawRequest: string,
  intent: MartaIntent
): Promise<AgentResult> {
  if (!intent.personId || !intent.person) {
    if (intent.person) {
      const resolved = await resolvePersonFuzzy(intent.person);
      if (resolved) {
        intent.personId = resolved.id;
        intent.person = resolved.name;
      }
    }

    if (!intent.personId) {
      const convId = await createCosConversation({
        chatId,
        intent: "email",
        context: { originalRequest: rawRequest, intent }
      });
      await appendConversationMessage(convId, "user", rawRequest);
      const question = "Pra quem e o email?";
      await appendConversationMessage(convId, "assistant", question);
      await updateCosConversation(convId, { state: "clarifying" });
      await sendText(chatId, question);
      await saveChatMessage(chatId, "assistant", question, "marta", { type: "clarification", intent: "email" });
      return { success: true, agentId: "chiefofstaff", summary: "Aguardando destinatario." };
    }
  }

  if (!intent.tema) {
    // List pending items with this person to suggest topics
    const items = await listItemsByPerson(intent.person!, ["open"]);
    const suggestions = items.slice(0, 3).map((i) => `• ${i.actionTitle || i.summaryPtBr}`).join("\n");

    const convId = await createCosConversation({
      chatId,
      intent: "email",
      personId: intent.personId ?? undefined,
      context: { originalRequest: rawRequest, intent }
    });
    await appendConversationMessage(convId, "user", rawRequest);
    const question = suggestions
      ? `Sobre qual assunto? Temas pendentes com ${intent.person}:\n${suggestions}`
      : `Sobre qual assunto voce quer o email pro ${intent.person}?`;
    await appendConversationMessage(convId, "assistant", question);
    await updateCosConversation(convId, { state: "clarifying" });
    await sendText(chatId, question);
    await saveChatMessage(chatId, "assistant", question, "marta", { type: "clarification", intent: "email" });
    return { success: true, agentId: "chiefofstaff", summary: "Aguardando tema do email." };
  }

  await sendTypingIndicator(chatId);
  await sendText(chatId, `Preparando draft de email para ${intent.person}...`);

  const people = await getPeopleList(chatId);
  const person = people.find((p) => p.id === intent.personId);
  if (!person) {
    await sendText(chatId, `Nao encontrei ${intent.person} na equipe. Diga \"adiciona [nome]\" para registrar.`);
    return { success: false, agentId: "chiefofstaff", summary: "Pessoa nao encontrada.", error: "person_not_found" };
  }

  const [memories, items] = await Promise.all([
    loadAllRelevantMemories({ personId: person.id, types: ["leader_preference", "communication_style"] }),
    listItemsByPerson(person.name, ["open"])
  ]);

  const contextItems = items.slice(0, 5)
    .map((i) => `- ${i.actionTitle || i.summaryPtBr}`)
    .join("\n");

  const { system, user } = buildEmailDraftPrompt({
    person,
    tema: intent.tema,
    context: `${intent.detalhesExtras ?? rawRequest}\n\nItems pendentes:\n${contextItems}`,
    memories
  });

  const response = await callClaude({ system, userMessage: user, model: "fast", maxTokens: 1024 });
  if (!response) {
    await sendText(chatId, "Nao consegui gerar o draft. Tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  const outputId = await insertCosOutput({
    chatId,
    outputType: "email_draft",
    personId: person.id,
    title: `Email → ${person.name}: ${intent.tema}`,
    content: response
  });

  await logCosEvent({ chatId, eventType: "email_drafted", personId: person.id, outputId });

  // Start a follow-up conversation for adjustments
  const convId = await createCosConversation({
    chatId,
    intent: "email",
    personId: person.id,
    context: { originalRequest: rawRequest, intent, outputId }
  });
  await appendConversationMessage(convId, "user", rawRequest);

  // If SMTP is enabled and person has email, offer send button
  const emailEnabled = (await import("../../services/email.js")).isEmailEnabled();
  if (emailEnabled && person.email) {
    const footer = `\n\nDestinatario: ${person.email}`;
    await appendConversationMessage(convId, "assistant", response + footer);
    await updateCosConversation(convId, { state: "clarifying" });
    await sendTextWithButtons(chatId, response + footer, [
      [
        { text: "📧 Enviar", callback_data: `email_send:${outputId}` },
        { text: "✏️ Ajustar", callback_data: `email_adjust:${outputId}` }
      ]
    ]);
  } else {
    await appendConversationMessage(convId, "assistant", response + "\n\nQuer ajustar o tom ou algum ponto?");
    await updateCosConversation(convId, { state: "clarifying" });
    await sendText(chatId, response + "\n\nQuer ajustar o tom ou algum ponto?");
  }

  await saveChatMessage(chatId, "assistant", response.slice(0, 500), "marta", { type: "email_draft", personId: person.id });

  return { success: true, agentId: "chiefofstaff", summary: `Draft de email gerado para ${person.name}.` };
}

// ── Intent: Registrar Pessoa ──────────────────────────────────────────

async function handleEquipe(
  chatId: number,
  _messageId: number,
  rawRequest: string,
  intent: MartaIntent
): Promise<AgentResult> {
  if (!intent.person) {
    const convId = await createCosConversation({
      chatId,
      intent: "equipe",
      context: { originalRequest: rawRequest, intent }
    });
    await appendConversationMessage(convId, "user", rawRequest);
    const question = "Qual o nome da pessoa que voce quer adicionar?";
    await appendConversationMessage(convId, "assistant", question);
    await updateCosConversation(convId, { state: "clarifying" });
    await sendText(chatId, question);
    return { success: true, agentId: "chiefofstaff", summary: "Aguardando nome." };
  }

  const role = intent.detalhesExtras ?? intent.tema ?? undefined;

  const personId = await upsertPerson({
    name: intent.person,
    role: role ?? undefined,
    relationship: "direct_report"
  });

  await logCosEvent({
    chatId,
    eventType: "person_registered",
    personId,
    details: { name: intent.person, role }
  });

  // Invalidate cache since we just added a person
  clearPeopleCache(chatId);

  const msg = `Registrado: *${intent.person}*${role ? ` — ${role}` : ""}.\nCadencia de 1:1 semanal (me avise se for diferente).\n\n💡 Proximos passos:\n• \"Marta briefing ${intent.person}\" — preparar pro 1:1\n• \"Marta anota [notas]\" — processar notas de reuniao`;
  await sendText(chatId, msg);

  return { success: true, agentId: "chiefofstaff", summary: `Pessoa registrada: ${intent.person}` };
}

// ── Intent: Reminder ─────────────────────────────────────────────────

async function handleReminder(
  chatId: number,
  _messageId: number,
  rawRequest: string,
  intent: MartaIntent
): Promise<AgentResult> {
  await sendTypingIndicator(chatId);

  // Use Claude to parse natural language date/time
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);

  const { system, user } = buildReminderParsingPrompt({
    text: rawRequest,
    currentDate,
    timezone: env.TIMEZONE
  });

  const response = await callClaude({ system, userMessage: user, model: "fast", maxTokens: 256 });
  if (!response) {
    await sendText(chatId, "Nao consegui entender o lembrete. Pode reformular? Ex: \"me lembra de X amanha as 10h\"");
    return { success: false, agentId: "chiefofstaff", summary: "Reminder parse failed", error: "null response" };
  }

  let parsed: { text?: string; date?: string; time?: string; recurrence?: string | null; confidence?: number };
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = {};
  }

  if (!parsed.text || !parsed.date || !parsed.time) {
    // Ask for clarification
    const convId = await createCosConversation({
      chatId,
      intent: "reminder",
      context: { originalRequest: rawRequest, intent }
    });
    await appendConversationMessage(convId, "user", rawRequest);
    const question = "Entendi que voce quer um lembrete, mas nao consegui extrair quando. Pode me dizer a data e hora? Ex: \"amanha as 10h\"";
    await appendConversationMessage(convId, "assistant", question);
    await updateCosConversation(convId, { state: "clarifying" });
    await sendText(chatId, question);
    return { success: true, agentId: "chiefofstaff", summary: "Aguardando data do lembrete." };
  }

  // Build trigger datetime
  const triggerAt = new Date(`${parsed.date}T${parsed.time}:00`);
  if (isNaN(triggerAt.getTime())) {
    await sendText(chatId, "Nao consegui interpretar a data/hora. Pode tentar de novo?");
    return { success: false, agentId: "chiefofstaff", summary: "Invalid date", error: "invalid_date" };
  }

  // Resolve person if mentioned
  let personId: number | undefined;
  if (intent.personId) {
    personId = intent.personId;
  }

  const reminderId = await insertReminder({
    chatId,
    text: parsed.text,
    triggerAt: triggerAt.toISOString(),
    recurrence: parsed.recurrence ?? undefined,
    personId
  });

  await logCosEvent({ chatId, eventType: "reminder_created", details: { reminderId, text: parsed.text, triggerAt: triggerAt.toISOString(), recurrence: parsed.recurrence } });

  // Format confirmation
  const dateStr = triggerAt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: env.TIMEZONE });
  const timeStr = triggerAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: env.TIMEZONE });
  const recurrenceLabel = parsed.recurrence ? ` (recorrente: ${parsed.recurrence})` : "";

  await sendText(chatId, `🔔 Lembrete agendado!\n\n📝 ${parsed.text}\n📅 ${dateStr} às ${timeStr}${recurrenceLabel}\n\nVou te avisar na hora.`);

  if (parsed.recurrence) {
    await sendTextWithButtons(chatId, `Recorrencia: ${parsed.recurrence}`, [
      [{ text: "Cancelar recorrencia", callback_data: `reminder_cancel:${reminderId}` }]
    ]);
  }

  return { success: true, agentId: "chiefofstaff", summary: `Lembrete criado: ${parsed.text}` };
}

// ── Intent: Agendar (Calendar Event) ──────────────────────────────────

async function handleAgendar(
  chatId: number,
  _messageId: number,
  rawRequest: string,
  intent: MartaIntent
): Promise<AgentResult> {
  if (!isCalendarEnabled()) {
    await sendText(chatId, "O Google Calendar nao esta configurado. Configure as credenciais (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) no .env para usar essa funcionalidade.");
    return { success: false, agentId: "chiefofstaff", summary: "Calendar not configured", error: "calendar_not_enabled" };
  }

  await sendTypingIndicator(chatId);

  // Use Claude to parse natural language event details
  const { system, user } = buildEventParsingPrompt(rawRequest, env.TIMEZONE);

  const response = await callClaude({ system, userMessage: user, model: "fast", maxTokens: 256 });
  if (!response) {
    await sendText(chatId, "Nao consegui entender os detalhes do evento. Pode reformular? Ex: \"agendar reuniao com Pedro amanha as 14h\"");
    return { success: false, agentId: "chiefofstaff", summary: "Event parse failed", error: "null response" };
  }

  let parsed: {
    title?: string;
    date?: string;
    startTime?: string;
    duration?: number;
    attendees?: string[];
    location?: string | null;
    description?: string | null;
  };

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = {};
  }

  if (!parsed.title || !parsed.date || !parsed.startTime) {
    // Ask for clarification
    const convId = await createCosConversation({
      chatId,
      intent: "agendar",
      context: { originalRequest: rawRequest, intent }
    });
    await appendConversationMessage(convId, "user", rawRequest);
    const question = "Entendi que voce quer agendar algo, mas nao consegui extrair todos os detalhes. Pode me dizer o titulo, data e hora? Ex: \"reuniao com Pedro amanha as 14h\"";
    await appendConversationMessage(convId, "assistant", question);
    await updateCosConversation(convId, { state: "clarifying" });
    await sendText(chatId, question);
    return { success: true, agentId: "chiefofstaff", summary: "Aguardando detalhes do evento." };
  }

  const duration = parsed.duration ?? 30;
  const attendees = parsed.attendees ?? [];
  const location = parsed.location ?? undefined;
  const description = parsed.description ?? rawRequest;

  // Build ISO datetime strings using timezone
  const startDate = new Date(`${parsed.date}T${parsed.startTime}:00`);
  if (isNaN(startDate.getTime())) {
    await sendText(chatId, "Nao consegui interpretar a data/hora. Pode tentar de novo?");
    return { success: false, agentId: "chiefofstaff", summary: "Invalid date", error: "invalid_date" };
  }

  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
  const startAt = startDate.toISOString();
  const endAt = endDate.toISOString();

  try {
    const eventId = await createCalendarEvent({
      chatId,
      title: parsed.title,
      startAt,
      endAt,
      description,
      attendees,
      location,
      reminderMinutes: 720, // 12 hours before
    });

    await logCosEvent({
      chatId,
      eventType: "calendar_event_created",
      details: { eventId, title: parsed.title, startAt, endAt, duration, attendees, location }
    });

    // Format confirmation
    const dateStr = startDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: env.TIMEZONE });
    const timeStr = startDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: env.TIMEZONE });
    const attendeesInfo = attendees.length > 0 ? `\n👥 Participantes: ${attendees.join(", ")}` : "";
    const locationInfo = location ? `\n📍 Local: ${location}` : "";

    await sendText(chatId, `📅 Evento criado!\n\n📝 ${parsed.title}\n🗓 ${dateStr} as ${timeStr} (${duration}min)${attendeesInfo}${locationInfo}`);

    return { success: true, agentId: "chiefofstaff", summary: `Evento criado: ${parsed.title}` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("marta:calendar_event_creation_failed", { chatId, error: errorMsg });
    await sendText(chatId, "Nao consegui criar o evento no Google Calendar. Verifique se as credenciais estao corretas e tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Calendar event creation failed", error: errorMsg };
  }
}

// ── Intent: Reflexao Estrategica ──────────────────────────────────────

async function handleReflexao(
  chatId: number,
  _messageId: number,
  _rawRequest: string
): Promise<AgentResult> {
  await sendTypingIndicator(chatId);
  await sendText(chatId, "Fazendo uma analise estrategica das ultimas semanas...");

  const [people, allItems, memories, summary] = await Promise.all([
    listPeopleWithItems(),
    listOpenActionItems(undefined, 100),
    loadAllRelevantMemories({ types: ["pattern", "leader_preference", "person_insight"] }),
    loadWeeklySummary(chatId)
  ]);

  // Calculate metrics
  const alta = allItems.filter((i) => i.priority === "ALTA").length;
  const media = allItems.filter((i) => i.priority === "MEDIA").length;
  const baixa = allItems.filter((i) => i.priority === "BAIXA").length;

  // Category breakdown from items
  const catMap = new Map<string, number>();
  for (const item of allItems) {
    catMap.set(item.categoryName, (catMap.get(item.categoryName) ?? 0) + 1);
  }
  const categoriesBreakdown = Array.from(catMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  const { system, user } = buildReflectionPrompt({
    metrics: {
      totalItems30d: allItems.length + summary.doneActions,
      doneItems30d: summary.doneActions,
      eliminatedItems30d: summary.items - summary.doneActions - summary.openActions,
      categoriesBreakdown,
      priorityBreakdown: { alta, media, baixa }
    },
    people: people.map((p) => ({
      name: p.name,
      openCount: p.stats.totalOpen,
      doneCount: p.stats.totalDone,
      role: p.role
    })),
    memories
  });

  const response = await callClaude({ system, userMessage: user, maxTokens: 2048 });
  if (!response) {
    await sendText(chatId, "Nao consegui gerar a reflexao. Tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  const outputId = await insertCosOutput({
    chatId,
    outputType: "reflection",
    title: `Reflexao estrategica — ${new Date().toISOString().slice(0, 10)}`,
    content: response
  });

  await logCosEvent({ chatId, eventType: "reflection_generated", outputId });
  await sendText(chatId, response);

  // Save high-level patterns as memories
  await upsertCosMemory({
    memoryType: "pattern",
    key: `reflection_${new Date().toISOString().slice(0, 10)}`,
    content: `Reflexao: ${response.slice(0, 200)}...`,
    source: "reflexao automatica",
    sourceOutputId: outputId
  });

  return { success: true, agentId: "chiefofstaff", summary: "Reflexao estrategica gerada." };
}

// ── Intent: Conversa Geral ────────────────────────────────────────────

async function handleConversaGeral(
  chatId: number,
  _messageId: number,
  rawRequest: string
): Promise<AgentResult> {
  await sendTypingIndicator(chatId);
  const memories = await loadAllRelevantMemories({ limit: 10 });

  const { system, user } = buildConversationalPrompt({
    text: rawRequest,
    memories
  });

  const response = await callClaude({ system, userMessage: user, model: "fast", maxTokens: 1024 });
  if (!response) {
    await sendText(chatId, "Desculpa, nao consegui processar. Pode reformular?");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  await sendText(chatId, response);
  return { success: true, agentId: "chiefofstaff", summary: "Resposta conversacional enviada." };
}

// ── Dashboard Notes Processing (shared core logic) ──────────────────

export interface DashboardNotesResult {
  summary: string;
  executiveBullets: string[];
  actionItems: number;
  decisions: number;
  commitments: number;
  teamMood: string | null;
}

export async function processNotesFromDashboard(params: {
  chatId: number;
  personId: number;
  notesText: string;
}): Promise<DashboardNotesResult> {
  const people = await getPeopleList(params.chatId);
  const person = people.find((p) => p.id === params.personId);
  if (!person) {
    throw new Error(`Person not found: ${params.personId}`);
  }

  const memories = await loadMemoriesForPerson(person.id);

  // Truncate very long notes to avoid token overflow (keep ~12k chars ≈ ~3k tokens)
  const MAX_NOTES_LENGTH = 12_000;
  let notesText = params.notesText;
  if (notesText.length > MAX_NOTES_LENGTH) {
    log.warn("dashboard_notes:truncated", {
      personId: person.id,
      originalLength: notesText.length,
      truncatedTo: MAX_NOTES_LENGTH
    });
    notesText = notesText.slice(0, MAX_NOTES_LENGTH) + "\n\n[... texto truncado por limite de tamanho ...]";
  }

  // Build list of team members for the prompt so Claude can assign owners correctly
  const teamList = people.map((p) => `- ${p.name} (${p.role ?? "liderado"})`).join("\n");

  const { system, user } = buildNotesProcessingPrompt({
    person,
    notesText,
    memories,
    currentDate: new Date().toISOString().slice(0, 10),
    teamMembers: teamList
  });

  // Use 16000 tokens — complex meetings with 30+ action items easily exceed 4096
  const response = await callClaude({ system, userMessage: user, maxTokens: 16_000 });
  if (!response) {
    throw new Error("Claude call returned null");
  }

  type NotesPayload = {
    summary?: string;
    executive_bullets?: string[];
    action_items?: Array<{ title: string; owner: string; due: string | null; priority: string }>;
    decisions?: Array<{ summary: string; rationale?: string; participants?: string[]; review_date?: string }>;
    commitments?: Array<{ summary: string; direction: "mine" | "theirs"; deadline: string | null }>;
    person_insights?: string[];
    team_mood?: string;
    risks?: Array<{ description: string; severity: string }>;
    telegram_message?: string;
  };

  const parsed = safeParseJson<NotesPayload>(response, { summary: response });

  // Detect if parsing failed (Claude response likely truncated or malformed)
  if (!parsed.action_items && !parsed.decisions && !parsed.commitments && parsed.summary === response) {
    log.warn("dashboard_notes:json_parse_failed", {
      personId: person.id,
      responseLength: response.length,
      responseEnd: response.slice(-200),
      hint: "JSON parse failed — response may have been truncated by max_tokens limit"
    });
  }

  const categories = await listCategories();
  const defaultCategory = categories[0]?.id ?? 1;
  let createdItems = 0;

  // Create action items — resolve each owner to a person entity
  if (parsed.action_items && Array.isArray(parsed.action_items)) {
    for (const item of parsed.action_items) {
      try {
        // Resolve the owner name to a person entity
        const ownerName = item.owner || person.name;
        const resolvedOwner = await resolvePersonFuzzy(ownerName, people);
        const resolvedPersonId = resolvedOwner?.id ?? person.id;

        await insertInboxItem({
          chatId: params.chatId,
          messageId: 0,
          inputType: "text",
          rawText: `[1:1 ${person.name}] ${item.title}`,
          normalizedText: item.title,
          summaryPtBr: item.title,
          categoryId: defaultCategory,
          bucket: "AREAS",
          action: "CREATE_TASK",
          priority: (item.priority as "ALTA" | "MEDIA" | "BAIXA") || "MEDIA",
          actionTitle: item.title,
          dueAt: item.due || undefined,
          followUpWith: resolvedOwner?.name ?? ownerName,
          processingStage: "planejado",
          confidence: 0.9,
          metadata: {
            source: "marta_dashboard_upload",
            personId: resolvedPersonId,
            meetingWith: person.name,
            meetingPersonId: person.id
          }
        });
        createdItems++;
        log.info("dashboard_notes:action_item_created", {
          title: item.title,
          owner: ownerName,
          resolvedOwner: resolvedOwner?.name ?? null,
          resolvedPersonId,
          priority: item.priority
        });
      } catch (error) {
        log.warn("dashboard_notes:action_item_failed", { item, error });
      }
    }
  }

  // Save person insights
  if (parsed.person_insights && Array.isArray(parsed.person_insights)) {
    for (const insight of parsed.person_insights) {
      const slug = insight.toLowerCase().replace(/[^a-z0-9à-ú]+/g, "_").slice(0, 40);
      const key = `${person.name.toLowerCase().replace(/\s+/g, "_")}_${slug}`;
      await upsertCosMemory({
        memoryType: "person_insight",
        personId: person.id,
        key,
        content: insight,
        source: `dashboard upload ${new Date().toISOString().slice(0, 10)}`
      });
    }
  }

  // Save decisions
  let createdDecisions = 0;
  if (parsed.decisions && Array.isArray(parsed.decisions)) {
    for (const decision of parsed.decisions) {
      if (!decision.summary) continue;
      try {
        const personIds = [person.id];
        if (decision.participants && Array.isArray(decision.participants)) {
          for (const name of decision.participants) {
            const resolved = await resolvePersonFuzzy(name, people);
            if (resolved && !personIds.includes(resolved.id)) {
              personIds.push(resolved.id);
            }
          }
        }
        const reviewDate = decision.review_date
          ? new Date(decision.review_date)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await insertDecision({
          chatId: params.chatId,
          personIds,
          summary: decision.summary,
          rationale: decision.rationale ?? undefined,
          context: `1:1 com ${person.name} (dashboard upload)`,
          decidedAt: new Date(),
          reviewAt: reviewDate
        });
        createdDecisions++;
      } catch (error) {
        log.warn("dashboard_notes:decision_failed", { decision, error });
      }
    }
  }

  // Save commitments
  let createdCommitments = 0;
  if (parsed.commitments && Array.isArray(parsed.commitments)) {
    for (const commitment of parsed.commitments) {
      if (!commitment.summary) continue;
      try {
        await insertCommitment({
          chatId: params.chatId,
          personId: person.id,
          direction: commitment.direction === "theirs" ? "theirs" : "mine",
          summary: commitment.summary,
          deadline: commitment.deadline || undefined
        });
        createdCommitments++;
      } catch (error) {
        log.warn("dashboard_notes:commitment_failed", { commitment, error });
      }
    }
  }

  // Save risks and mood
  if (parsed.risks && Array.isArray(parsed.risks)) {
    for (const risk of parsed.risks) {
      if (!risk.description) continue;
      const slug = risk.description.toLowerCase().replace(/[^a-z0-9à-ú]+/g, "_").slice(0, 40);
      await upsertCosMemory({
        memoryType: "meeting_risk",
        personId: person.id,
        key: `risk_${person.name.toLowerCase().replace(/\s+/g, "_")}_${slug}`,
        content: `[${risk.severity ?? "medium"}] ${risk.description}`,
        source: `dashboard upload ${new Date().toISOString().slice(0, 10)}`
      });
    }
  }

  if (parsed.team_mood) {
    await upsertCosMemory({
      memoryType: "person_mood",
      personId: person.id,
      key: `mood_${person.name.toLowerCase().replace(/\s+/g, "_")}`,
      content: `${person.name} parecia ${parsed.team_mood} no 1:1 de ${new Date().toISOString().slice(0, 10)}`,
      source: `dashboard upload ${new Date().toISOString().slice(0, 10)}`
    });
  }

  await updateLastOneOnOne(person.id);
  await updateLastContact(person.id);

  // Save output record — format as human-readable text instead of raw JSON
  const displayContent = formatNotesContent(parsed, {
    items: createdItems,
    decisions: createdDecisions,
    commitments: createdCommitments
  });
  await insertCosOutput({
    chatId: params.chatId,
    outputType: "one_on_one_notes",
    personId: person.id,
    title: `Notas 1:1 ${person.name} — ${new Date().toISOString().slice(0, 10)} (dashboard)`,
    content: displayContent,
    metadata: {
      actionItemsCreated: createdItems,
      decisionsCreated: createdDecisions,
      commitmentsCreated: createdCommitments,
      executiveBullets: parsed.executive_bullets ?? [],
      teamMood: parsed.team_mood ?? null,
      source: "dashboard_upload"
    }
  });

  return {
    summary: parsed.summary ?? "Notas processadas.",
    executiveBullets: parsed.executive_bullets ?? [],
    actionItems: createdItems,
    decisions: createdDecisions,
    commitments: createdCommitments,
    teamMood: parsed.team_mood ?? null
  };
}

// ── Registration ──────────────────────────────────────────────────────

export function registerChiefOfStaff(): void {
  registerAgent("chiefofstaff", handleChiefOfStaff);
  log.info("Agent registered: chiefofstaff (Marta)");
}
