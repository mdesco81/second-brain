import { registerAgent } from "../registry.js";
import { AgentRequest, AgentResult } from "../types.js";
import { callClaude } from "../../services/openai.js";
import { sendText } from "../../services/telegram.js";
import { log } from "../../utils/logger.js";
import {
  appendConversationMessage,
  completeCosConversation,
  CosConversation,
  createCosConversation,
  getActiveCosConversation,
  getLatestCosOutput,
  insertCosOutput,
  insertInboxItem,
  listCategories,
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
  logCosEvent,
  markMemoryUsed,
  Person,
  updateCosConversation,
  updateLastOneOnOne,
  upsertCosMemory,
  upsertPerson
} from "../../db/schema.js";
import { classifyMartaIntent, MartaIntent, resolvePersonFuzzy } from "./intents.js";
import {
  buildBriefingPrompt,
  buildConversationalPrompt,
  buildEmailDraftPrompt,
  buildHelpMessage,
  buildNotesProcessingPrompt,
  buildReflectionPrompt,
  buildStatusPrompt
} from "./prompts.js";

// Request-scoped cache for people list (avoids redundant DB calls within a single request)
let cachedPeople: Person[] | null = null;

async function getPeopleList(): Promise<Person[]> {
  if (cachedPeople) return cachedPeople;
  cachedPeople = await listPeople(true);
  return cachedPeople;
}

// ── Main Handler ──────────────────────────────────────────────────────

async function handleChiefOfStaff(request: AgentRequest): Promise<AgentResult> {
  const { chatId, messageId, rawRequest } = request;

  try {
    // Check for active conversation (follow-up flow)
    const activeConv = await getActiveCosConversation(chatId);
    if (activeConv) {
      return await handleFollowUp(chatId, messageId, rawRequest, activeConv);
    }

    // New conversation — classify intent (cache people list for reuse in handlers)
    cachedPeople = await listPeople(true);
    const intent = await classifyMartaIntent(rawRequest, cachedPeople);

    log.info("marta:intent_classified", {
      intent: intent.intent,
      person: intent.person,
      personId: intent.personId,
      needsClarification: intent.needsClarification
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

      return { success: true, agentId: "chiefofstaff", summary: "Aguardando esclarecimento." };
    }

    // Execute intent directly
    return await executeIntent(chatId, messageId, rawRequest, intent);
  } catch (error) {
    log.error("marta:handler_error", { chatId, error });
    await sendText(chatId, "Desculpa, tive um problema ao processar seu pedido. Pode tentar de novo?");
    return { success: false, agentId: "chiefofstaff", summary: "Handler error", error: String(error) };
  } finally {
    cachedPeople = null; // Clear request-scoped cache
  }
}

// ── Follow-up Handler ─────────────────────────────────────────────────

export async function handleFollowUp(
  chatId: number,
  messageId: number,
  text: string,
  conv: CosConversation
): Promise<AgentResult> {
  // Enforce max turns — proceed with assumptions after limit
  if (conv.turns >= conv.maxTurns) {
    await completeCosConversation(conv.id);
    log.info("marta:max_turns_reached", { convId: conv.id, turns: conv.turns });
    // Treat this as a new message routed to Marta
    cachedPeople = null;
    const people = await listPeople(true);
    cachedPeople = people;
    const intent = await classifyMartaIntent(text, people);
    return await executeIntent(chatId, messageId, text, intent);
  }

  await appendConversationMessage(conv.id, "user", text);
  await logCosEvent({ chatId, eventType: "follow_up_answered", conversationId: conv.id });

  // Rebuild intent with the new context
  const context = conv.context as { intent?: MartaIntent; originalRequest?: string };
  const originalIntent = context.intent ?? { intent: conv.intent as MartaIntent["intent"], person: null, personId: conv.personId, tema: null, detalhesExtras: null, needsClarification: false, clarificationQuestion: null };

  // Enrich the intent with the follow-up answer
  const enrichedIntent: MartaIntent = {
    ...originalIntent,
    needsClarification: false,
    clarificationQuestion: null,
    detalhesExtras: text
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

  const result = await executeIntent(chatId, messageId, combinedRequest, enrichedIntent);

  if (result.success) {
    await completeCosConversation(conv.id, result.itemId ?? undefined);
  }

  return result;
}

// ── Intent Router ─────────────────────────────────────────────────────

async function executeIntent(
  chatId: number,
  messageId: number,
  rawRequest: string,
  intent: MartaIntent
): Promise<AgentResult> {
  switch (intent.intent) {
    case "briefing":
      return await handleBriefing(chatId, messageId, rawRequest, intent);
    case "notas":
      return await handleNotas(chatId, messageId, rawRequest, intent);
    case "status":
      return await handleStatus(chatId, messageId, rawRequest);
    case "email":
      return await handleEmail(chatId, messageId, rawRequest, intent);
    case "equipe":
      return await handleEquipe(chatId, messageId, rawRequest, intent);
    case "reflexao":
      return await handleReflexao(chatId, messageId, rawRequest);
    case "ajuda":
      await sendText(chatId, buildHelpMessage());
      return { success: true, agentId: "chiefofstaff", summary: "Ajuda enviada." };
    case "conversa_geral":
    default:
      return await handleConversaGeral(chatId, messageId, rawRequest);
  }
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
      return { success: true, agentId: "chiefofstaff", summary: "Aguardando nome da pessoa." };
    }
  }

  await sendText(chatId, `Preparando briefing do 1:1 com ${intent.person}...`);

  const people = await getPeopleList();
  const person = people.find((p) => p.id === intent.personId);
  if (!person) {
    await sendText(chatId, `Nao encontrei ${intent.person} na equipe. Use \"Marta, adiciona [nome]\" para registrar.`);
    return { success: false, agentId: "chiefofstaff", summary: "Pessoa nao encontrada.", error: "person_not_found" };
  }

  const [openItems, overdueItems, memories, latestNotes] = await Promise.all([
    listItemsByPerson(person.name, ["open"]),
    listOverdueItems(chatId, 10),
    loadMemoriesForPerson(person.id),
    getLatestCosOutput(person.id, "one_on_one_notes")
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
    tema: intent.tema
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

  return { success: true, agentId: "chiefofstaff", summary: `Briefing gerado para ${person.name}.` };
}

// ── Intent: Processar Notas de 1:1 ───────────────────────────────────

async function handleNotas(
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
        intent: "notas",
        context: { originalRequest: rawRequest, intent }
      });
      await appendConversationMessage(convId, "user", rawRequest);
      const question = "Com quem foi a reuniao? Me diz o nome.";
      await appendConversationMessage(convId, "assistant", question);
      await updateCosConversation(convId, { state: "clarifying" });
      await sendText(chatId, question);
      return { success: true, agentId: "chiefofstaff", summary: "Aguardando nome da pessoa." };
    }
  }

  // Check if the message is too short (just announcing, no actual notes)
  // Skip check if text has action-verb signals typical of actual notes
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
    const question = `Entendido, reuniao com ${intent.person}. Pode me mandar as notas ou transcript que eu processo e extraio os action items.`;
    await appendConversationMessage(convId, "assistant", question);
    await updateCosConversation(convId, { state: "clarifying" });
    await sendText(chatId, question);
    return { success: true, agentId: "chiefofstaff", summary: "Aguardando notas." };
  }

  await sendText(chatId, `Processando notas do 1:1 com ${intent.person}...`);

  const people = await getPeopleList();
  const person = people.find((p) => p.id === intent.personId);
  if (!person) {
    await sendText(chatId, `Nao encontrei ${intent.person} na equipe. Use \"Marta, adiciona [nome]\" para registrar.`);
    return { success: false, agentId: "chiefofstaff", summary: "Pessoa nao encontrada.", error: "person_not_found" };
  }
  const memories = await loadMemoriesForPerson(person.id);

  const { system, user } = buildNotesProcessingPrompt({
    person,
    notesText: rawRequest,
    memories
  });

  const response = await callClaude({ system, userMessage: user, maxTokens: 4096 });
  if (!response) {
    await sendText(chatId, "Nao consegui processar as notas. Tente novamente.");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  let parsed: {
    summary?: string;
    action_items?: Array<{ title: string; owner: string; due: string | null; priority: string }>;
    person_insights?: string[];
    telegram_message?: string;
  };

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: response, telegram_message: response };
  } catch {
    parsed = { summary: response, telegram_message: response };
  }

  // Create action items from notes
  const categories = await listCategories();
  const defaultCategory = categories[0]?.id ?? 1;
  let createdItems = 0;

  if (parsed.action_items && Array.isArray(parsed.action_items)) {
    for (const item of parsed.action_items) {
      try {
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
          followUpWith: item.owner || person.name,
          processingStage: "planejado",
          confidence: 0.9,
          metadata: { source: "marta_1on1", personId: person.id }
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

  // Update last 1:1 timestamp
  await updateLastOneOnOne(person.id);

  // Save output
  const outputId = await insertCosOutput({
    chatId,
    outputType: "one_on_one_notes",
    personId: person.id,
    title: `Notas 1:1 ${person.name} — ${new Date().toISOString().slice(0, 10)}`,
    content: response,
    metadata: { actionItemsCreated: createdItems }
  });

  await logCosEvent({
    chatId,
    eventType: "notes_processed",
    personId: person.id,
    outputId,
    details: { actionItemsCreated: createdItems }
  });

  // Send Telegram message
  const telegramMsg = parsed.telegram_message ?? parsed.summary ?? "Notas processadas.";
  const footer = createdItems > 0
    ? `\n\n✅ ${createdItems} action item${createdItems > 1 ? "s" : ""} criado${createdItems > 1 ? "s" : ""}. Algum ajuste ou algo que eu perdi?`
    : "\n\nNenhum action item identificado. Quer que eu revise algo?";

  await sendText(chatId, telegramMsg + footer);

  return { success: true, agentId: "chiefofstaff", summary: `Notas processadas: ${createdItems} action items criados.` };
}

// ── Intent: Status Cross-Team ─────────────────────────────────────────

async function handleStatus(
  chatId: number,
  _messageId: number,
  _rawRequest: string
): Promise<AgentResult> {
  await sendText(chatId, "Levantando o panorama da equipe...");

  const peopleWithItems = await listPeopleWithItems();
  if (peopleWithItems.length === 0) {
    await sendText(chatId, "Ainda nao tenho ninguem da equipe registrado. Use: \"Marta, adiciona o [nome], [papel]\" para registrar.");
    return { success: true, agentId: "chiefofstaff", summary: "Nenhuma pessoa registrada." };
  }

  const [overdueItems, staleItems, memories] = await Promise.all([
    listOverdueItems(undefined, 50),
    listStaleItems(undefined, 3, 50),
    loadMemoriesByType("pattern", 10)
  ]);

  const { system, user } = buildStatusPrompt({
    people: peopleWithItems,
    globalMetrics: {
      totalOverdue: overdueItems.length,
      totalStale: staleItems.length,
      totalOpen: peopleWithItems.reduce((acc, p) => acc + p.stats.totalOpen, 0)
    },
    memories
  });

  const response = await callClaude({ system, userMessage: user, maxTokens: 2048 });
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
    return { success: true, agentId: "chiefofstaff", summary: "Aguardando tema do email." };
  }

  await sendText(chatId, `Preparando draft de email para ${intent.person}...`);

  const people = await getPeopleList();
  const person = people.find((p) => p.id === intent.personId);
  if (!person) {
    await sendText(chatId, `Nao encontrei ${intent.person} na equipe. Use \"Marta, adiciona [nome]\" para registrar.`);
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

  const response = await callClaude({ system, userMessage: user, maxTokens: 1024 });
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
  await appendConversationMessage(convId, "assistant", response + "\n\nQuer ajustar o tom ou algum ponto?");

  await sendText(chatId, response + "\n\nQuer ajustar o tom ou algum ponto?");

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
  cachedPeople = null;

  const msg = `Registrado: *${intent.person}*${role ? ` — ${role}` : ""}.\nCadencia de 1:1 semanal (me avise se for diferente).\n\n💡 Proximos passos:\n• \"Marta briefing ${intent.person}\" — preparar pro 1:1\n• \"Marta anota [notas]\" — processar notas de reuniao`;
  await sendText(chatId, msg);

  return { success: true, agentId: "chiefofstaff", summary: `Pessoa registrada: ${intent.person}` };
}

// ── Intent: Reflexao Estrategica ──────────────────────────────────────

async function handleReflexao(
  chatId: number,
  _messageId: number,
  _rawRequest: string
): Promise<AgentResult> {
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
  const memories = await loadAllRelevantMemories({ limit: 10 });

  const { system, user } = buildConversationalPrompt({
    text: rawRequest,
    memories
  });

  const response = await callClaude({ system, userMessage: user, maxTokens: 1024 });
  if (!response) {
    await sendText(chatId, "Desculpa, nao consegui processar. Pode reformular?");
    return { success: false, agentId: "chiefofstaff", summary: "Claude call failed", error: "null response" };
  }

  await sendText(chatId, response);
  return { success: true, agentId: "chiefofstaff", summary: "Resposta conversacional enviada." };
}

// ── Registration ──────────────────────────────────────────────────────

export function registerChiefOfStaff(): void {
  registerAgent("chiefofstaff", handleChiefOfStaff);
  log.info("Agent registered: chiefofstaff (Marta)");
}
