import path from "node:path";
import { callClaude, describeImage } from "../services/openai.js";
import { getFileBuffer, sendText, sendTypingIndicator } from "../services/telegram.js";
import { log } from "../utils/logger.js";
import { getAgent, listAgents } from "./registry.js";
import { AgentIntent, AgentRequest, OrchestratorAction, OrchestratorResult, DispatchResult } from "./types.js";
import { TelegramMessage } from "../types/telegram.js";
import {
  appendConversationMessage,
  completeCosConversation,
  createCosConversation,
  getActiveCosConversation,
  getOrchestratorMemories,
  getRecentChatContext,
  listPeople,
  saveChatMessage,
  updateCosConversation
} from "../db/schema.js";
import { handleFollowUp } from "./chiefofstaff/index.js";
import { classifyMartaIntent } from "./chiefofstaff/intents.js";
import { buildHelpMessage } from "./chiefofstaff/prompts.js";
import pdfParse from "pdf-parse";

// Research keyword patterns — detected BEFORE orchestrator for instant activation.
const RESEARCH_PATTERN = /\b(?:pesquis[ae]r?|investig[ae]r?|busque|buscar)\b/i;
const RESEARCH_BUSCA_PATTERN = /\bbusca\s+(?:sobre|pra\s+mim|para\s+mim|informac[oõ]es|dados|detalhes)\b/i;

// ── Jarbas intent classification (used internally by routeToAgent) ──

// ── Research keyword detection ───────────────────────────────────────

export function containsResearchKeyword(text: string): boolean {
  return RESEARCH_PATTERN.test(text) || RESEARCH_BUSCA_PATTERN.test(text);
}

/** Strip the research verb + adjacent filler words, returning the research topic. */
export function stripResearchKeyword(text: string): string {
  return text
    // Strip research verb + optional filler words that follow it (sobre, pra mim, etc.)
    .replace(/\b(?:pesquis[ae]r?|investig[ae]r?|busca|busque|buscar)\s*(?:(?:sobre|pra\s+mim|para\s+mim|informac[oõ]es|dados|detalhes)\s*)*(?:sobre\s*)?/gi, "")
    // Clean residual hyphen suffixes from reflexive verbs (e.g. "busca-se" → "-se")
    .replace(/^-\w+\s*/, "")
    .replace(/[,\s]+/g, " ")
    .trim();
}

/** Detect whether the user wants deep research based on explicit keywords. */
export function detectSearchDepth(text: string): "quick" | "deep" {
  const deepPattern = /\b(?:profund[ao]|detalhad[ao]|aprofundad[ao]|deep)\b/i;
  return deepPattern.test(text) ? "deep" : "quick";
}

const INTENT_SYSTEM_PROMPT = `Voce e um roteador de intencoes. Recebe um pedido do usuario e determina qual agente deve atende-lo.

Agentes disponiveis:
- ghostwriter: Produz posts e artigos para LinkedIn. Detecte pedidos como "escrever post", "criar artigo", "texto para LinkedIn", "publicacao sobre", "conteudo sobre", "redacao sobre", "fazer um artigo", "fazer um post", "faz um post", "faz um artigo", "quero um artigo", "quero um post", "prepara um artigo", "prepara um post", "me escreve um artigo", "me escreve um post", "monta um post", "monta um artigo", "elabora um post", "produz um artigo" etc.
- research: Pesquisa sobre um tema e retorna um resumo com bullets. Detecte pedidos como "pesquise sobre", "busca informacoes sobre", "pesquisa pra mim sobre", "busque sobre", "quero saber sobre", "me fala sobre", "levanta dados sobre", "investiga sobre".
- unknown: Quando nenhum agente se encaixa.

Responda APENAS com JSON valido:
{
  "agentId": "ghostwriter" | "research" | "unknown",
  "confidence": 0.0 a 1.0,
  "metadata": {
    "contentType": "post" | "article" | "research",
    "topic": "topico extraido do pedido",
    "additionalInstructions": "instrucoes extras mencionadas pelo usuario ou null",
    "searchDepth": "quick" | "deep"
  }
}

Regras para contentType — PRESTE MUITA ATENCAO:
- "research": quando o usuario pede pesquisa, busca de informacoes, investigacao. Se o pedido e para PESQUISAR/BUSCAR (nao para escrever conteudo), contentType DEVE ser "research". searchDepth deve ser "deep" se o usuario menciona "profunda", "detalhada", "aprofundada"; senao "quick".
- "article": quando o usuario menciona "artigo", "fazer um artigo", "faz um artigo", "quero um artigo", "escreve um artigo", "texto longo", "artigo completo", "deep dive", "analise profunda". Se a palavra "artigo" aparece no pedido, contentType DEVE ser "article".
- "post": quando menciona "post", "publicacao", "publicacao curta", ou quando NAO especifica o formato (default).
- Na duvida entre post e article: se o usuario mencionou a palavra "artigo" em qualquer forma, use "article".`;

export async function classifyAgentIntent(text: string): Promise<AgentIntent> {
  const fallback: AgentIntent = {
    agentId: "unknown",
    confidence: 0,
    rawRequest: text,
    metadata: {}
  };

  try {
    const response = await callClaude({
      system: INTENT_SYSTEM_PROMPT,
      userMessage: text,
      model: "fast",
      maxTokens: 256
    });

    if (!response) {
      return fallback;
    }

    let parsed: { agentId?: string; confidence?: number; metadata?: Record<string, unknown> };
    try {
      const jsonStart = response.indexOf("{");
      const jsonEnd = response.lastIndexOf("}");
      const jsonMatch = jsonStart >= 0 && jsonEnd > jsonStart ? [response.slice(jsonStart, jsonEnd + 1)] : null;
      if (!jsonMatch) return fallback;
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback;
    }

    return {
      agentId: parsed.agentId || "unknown",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      rawRequest: text,
      metadata: parsed.metadata || {}
    };
  } catch (error) {
    log.warn("Intent classification failed", { error });
    return fallback;
  }
}

// ── Jarbas routing (internal dispatch) ──────────────────────────────

export async function routeToAgent(
  chatId: number,
  messageId: number,
  strippedText: string,
  _originalMessage: TelegramMessage,
  preClassifiedIntent?: AgentIntent
): Promise<void> {
  if (!strippedText.trim()) {
    await sendText(chatId, `O que voce precisa? Tente algo como "escreve um post sobre X" ou "faz um artigo sobre Y".`);
    return;
  }

  await sendTypingIndicator(chatId);

  // Skip "Analisando..." and reclassification when the orchestrator already classified
  const intent = preClassifiedIntent ?? await (async () => {
    await sendText(chatId, "Entendido! Analisando seu pedido...");
    return classifyAgentIntent(strippedText);
  })();
  log.info("agent:intent_classified", {
    agentId: intent.agentId,
    confidence: intent.confidence,
    topic: intent.metadata.topic
  });

  // "research" intent is handled by the ghostwriter agent
  const handlerId = intent.agentId === "research" ? "ghostwriter" : intent.agentId;
  const handler = getAgent(handlerId);
  if (!handler) {
    const activeConv = await getActiveCosConversation(chatId);
    const prevRetryCount = activeConv?.intent === "jarbas_clarification"
      ? ((activeConv.context as { retryCount?: number }).retryCount ?? 0)
      : 0;

    const helpMsg = `Nao entendi o que voce precisa. Me diga mais detalhes sobre o conteudo que quer criar.`;
    const convId = await createCosConversation({
      chatId,
      intent: "jarbas_clarification",
      context: { originalRequest: strippedText, agentId: "jarbas", retryCount: prevRetryCount + 1 }
    });
    await appendConversationMessage(convId, "user", strippedText);
    await appendConversationMessage(convId, "assistant", helpMsg);
    await updateCosConversation(convId, { state: "clarifying" });

    await sendText(chatId, helpMsg);
    return;
  }

  const request: AgentRequest = {
    chatId,
    messageId,
    agentId: intent.agentId,
    rawRequest: strippedText,
    intent,
    timestamp: new Date()
  };

  try {
    const result = await handler(request);
    if (!result.success) {
      await sendText(chatId, `Erro no agente ${intent.agentId}: ${result.error || "erro desconhecido"}`);
    }
    // Note: agents send their own messages internally (Telegram text, buttons, etc).
    // The result.summary is for logging/tracking, not for re-sending to user.
  } catch (error) {
    log.error("Agent execution failed", { agentId: intent.agentId, chatId, error });
    await sendText(chatId, "Ocorreu um erro ao processar seu pedido. Tente novamente.");
  }
}

// ── Research routing (keyword-based, no "Jarbas" needed) ─────────────

export async function routeToResearch(
  chatId: number,
  messageId: number,
  text: string,
  _originalMessage: TelegramMessage
): Promise<void> {
  const topic = stripResearchKeyword(text);
  // Reject empty or punctuation-only topics (no letters = nothing useful to search)
  if (!topic || !/[a-záéíóúãõâêôçà]/i.test(topic)) {
    await sendText(chatId, `Sobre o que voce quer pesquisar? Ex: "pesquise sobre IA generativa"`);
    return;
  }

  const searchDepth = detectSearchDepth(text);
  const handler = getAgent("ghostwriter");
  if (!handler) {
    await sendText(chatId, "Agente de pesquisa nao esta disponivel no momento.");
    return;
  }

  const request: AgentRequest = {
    chatId,
    messageId,
    agentId: "research",
    rawRequest: topic,
    intent: {
      agentId: "research",
      confidence: 1.0,
      rawRequest: text,
      metadata: {
        contentType: "research",
        topic,
        searchDepth
      }
    },
    timestamp: new Date()
  };

  try {
    const result = await handler(request);
    // Note: handleResearch sends its own messages (results and errors) to the user.
    // The result is for logging/tracking only.
    if (!result.success) {
      log.warn("research:failed", { chatId, error: result.error });
    }
  } catch (error) {
    log.error("Research execution failed", { chatId, error });
    await sendText(chatId, "Ocorreu um erro ao pesquisar. Tente novamente.");
  }
}

// ── Marta (Chief of Staff) routing ────────────────────────────────────

/**
 * Extract content from PDF or image attachments in a Telegram message.
 * Returns the extracted text (PDF text or image description), or null if no media.
 */
export async function extractMediaContent(message: TelegramMessage): Promise<string | null> {
  const isPdf = message.document?.mime_type === "application/pdf"
    || message.document?.file_name?.toLowerCase().endsWith(".pdf");

  if (isPdf && message.document?.file_id) {
    try {
      const { buffer } = await getFileBuffer(message.document.file_id);
      const parsed = await pdfParse(buffer);
      const text = parsed.text?.trim();
      if (text) {
        log.info("marta:media_extracted", { type: "pdf", length: text.length });
        return text;
      }
    } catch (error) {
      log.warn("marta:pdf_extraction_failed", { error });
    }
    return null;
  }

  const isImage = (message.photo && message.photo.length > 0)
    || message.document?.mime_type?.startsWith("image/");

  if (isImage) {
    const photoCandidate = message.photo
      ? [...message.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]
      : undefined;
    const fileId = photoCandidate?.file_id || message.document?.file_id;

    if (fileId) {
      try {
        const { buffer, filePath } = await getFileBuffer(fileId);
        const ext = path.extname(filePath) || ".jpg";
        const mediaType = ext.replace(".", "") === "png" ? "image/png" : "image/jpeg";
        const dataUrl = `data:${mediaType};base64,${buffer.toString("base64")}`;
        const description = await describeImage(dataUrl);
        if (description) {
          log.info("marta:media_extracted", { type: "image", length: description.length });
          return description;
        }
      } catch (error) {
        log.warn("marta:image_extraction_failed", { error });
      }
    }
    return null;
  }

  return null;
}

export async function routeToMarta(
  chatId: number,
  messageId: number,
  strippedText: string,
  originalMessage: TelegramMessage
): Promise<void> {
  const handler = getAgent("chiefofstaff");
  if (!handler) {
    await sendText(chatId, "Agente Marta nao esta disponivel no momento.");
    return;
  }

  if (!strippedText.trim()) {
    await sendText(chatId, buildHelpMessage());
    return;
  }

  const activeConv = await getActiveCosConversation(chatId);
  if (activeConv) {
    const newIntent = await classifyMartaIntent(strippedText);
    if (newIntent.intent === activeConv.intent) {
      log.info("marta:same_intent_follow_up", {
        chatId, convId: activeConv.id, intent: activeConv.intent
      });
    } else {
      await completeCosConversation(activeConv.id);
      log.info("marta:closed_conversation", {
        chatId, convId: activeConv.id, prevIntent: activeConv.intent, newIntent: newIntent.intent
      });
    }
  }

  const mediaContent = await extractMediaContent(originalMessage);

  const request: AgentRequest = {
    chatId,
    messageId,
    agentId: "chiefofstaff",
    rawRequest: strippedText,
    intent: {
      agentId: "chiefofstaff",
      confidence: 1.0,
      rawRequest: strippedText,
      metadata: {}
    },
    timestamp: new Date(),
    mediaContent: mediaContent ?? undefined
  };

  try {
    const result = await handler(request);
    if (!result.success) {
      log.error("Marta execution failed", { chatId, error: result.error });
    }
  } catch (error) {
    log.error("Marta execution error", { chatId, error });
    await sendText(chatId, "Ocorreu um erro ao processar seu pedido. Tente novamente.");
  }
}

// ── Active conversation follow-up handler ────────────────────────────

export async function handleMartaFollowUpFromIntake(
  chatId: number,
  messageId: number,
  text: string,
  message: TelegramMessage
): Promise<boolean> {
  const activeConv = await getActiveCosConversation(chatId);
  if (!activeConv) return false;

  // ── Jarbas follow-up ──────────────────────────────────────────────
  if (activeConv.intent === "jarbas_clarification") {
    const context = activeConv.context as { originalRequest?: string; retryCount?: number };
    const retryCount = context.retryCount ?? 0;

    if (retryCount >= 3) {
      await completeCosConversation(activeConv.id);
      log.info("jarbas:follow_up_max_retries", { chatId, retryCount });
      await sendText(chatId, "Nao consegui processar para Jarbas. Guardei como item no seu inbox.");
      return true;
    }

    try {
      const enrichedRequest = context.originalRequest
        ? `${context.originalRequest}. ${text}`
        : text;
      await completeCosConversation(activeConv.id);
      log.info("jarbas:follow_up_routed", { chatId, enrichedRequest, retryCount });
      await routeToAgent(chatId, messageId, enrichedRequest, message);
      return true;
    } catch (error) {
      log.error("Jarbas follow-up error", { chatId, error });
      await completeCosConversation(activeConv.id);
      await sendText(chatId, "Desculpa, tive um problema ao processar. Pode tentar de novo?");
      return true;
    }
  }

  // ── Marta follow-up ──────────────────────────────────────────────
  try {
    const mediaContent = await extractMediaContent(message);
    await handleFollowUp(chatId, messageId, text, activeConv, mediaContent ?? undefined);
    return true;
  } catch (error) {
    log.error("Marta follow-up error", { chatId, error });
    await sendText(chatId, "Desculpa, tive um problema ao processar. Pode tentar de novo?");
    return true;
  }
}

// ── Intelligent Orchestrator ─────────────────────────────────────────

const ORCHESTRATOR_PROMPT = `Voce e o cerebro de roteamento de um assistente executivo. Sua unica tarefa: ler a mensagem do usuario e decidir QUAL agente (ou agentes) deve atender, com alta precisao.

AGENTES:

"marta" — Chief of Staff virtual. Cuida de PESSOAS e GESTAO:
  briefing, preparacao de 1:1, notas de reuniao, status da equipe, draft de email,
  registrar pessoa, lembretes, agendar eventos, reflexao estrategica, cobranças,
  follow-ups com liderados, feedback, PDI

"jarbas" — Ghostwriter. Cuida de CONTEUDO para publicacao:
  escrever post LinkedIn, criar artigo, produzir conteudo sobre um tema

"pesquisa" — Pesquisador. Cuida de BUSCAR INFORMACAO externa:
  pesquisar sobre um tema, buscar dados, investigar assunto

"intake" — Captura de conhecimento. Cuida de GUARDAR informacao:
  links, notas pessoais, ideias, informacoes para arquivo, relatos, decisoes,
  qualquer coisa que NAO e pedido de acao

EXEMPLOS (aprenda o padrao):

"faz um post sobre lideranca e prepara o briefing do Joao" →
  actions: [{agent:"jarbas", confidence:0.95, extracted_request:"faz um post sobre lideranca", content_type_hint:"post"},
            {agent:"marta", confidence:0.95, extracted_request:"prepara o briefing do Joao", intent_hint:"briefing"}]

"me lembra de cobrar o Pedro amanha e pesquisa sobre OKRs" →
  actions: [{agent:"marta", confidence:0.95, extracted_request:"me lembra de cobrar o Pedro amanha", intent_hint:"reminder"},
            {agent:"pesquisa", confidence:0.90, extracted_request:"pesquisa sobre OKRs"}]

"como ta a galera?" →
  actions: [{agent:"marta", confidence:0.95, extracted_request:"como ta a galera?", intent_hint:"status"}]

"vi um artigo bom sobre IA generativa, salva ai" →
  actions: [{agent:"intake", confidence:0.90, extracted_request:"vi um artigo bom sobre IA generativa, salva ai"}]

"escreve um artigo sobre transformacao digital" →
  actions: [{agent:"jarbas", confidence:0.95, extracted_request:"escreve um artigo sobre transformacao digital", content_type_hint:"article"}]

"sim" / "pode ser" / "manda" / "isso" →
  is_follow_up: true, follow_up_context: "usuario confirmando acao anterior"

"tive uma reuniao com a Ana e o principal ponto foi alinhar prioridades do Q2" →
  actions: [{agent:"marta", confidence:0.90, extracted_request:"tive uma reuniao com a Ana e o principal ponto foi alinhar prioridades do Q2", intent_hint:"notas"}]

"pesquisa sobre tendencias de IA no marketing 2025" →
  actions: [{agent:"pesquisa", confidence:0.95, extracted_request:"pesquisa sobre tendencias de IA no marketing 2025"}]

REGRAS:
1. Uma mensagem pode ter MULTIPLAS acoes. Separe cada uma.
2. "extracted_request" = trecho da mensagem original relevante para aquele agente.
3. Confianca: 0.95 = obvio, 0.80 = provavel, 0.60 = incerto, < 0.50 = nao sei.
4. Se a mensagem e AMBIGUA ou voce nao tem certeza do que o usuario quer, use needs_clarification=true e escreva a pergunta em clarification_question. NAO invente uma acao — pergunte.
5. is_follow_up=true SOMENTE quando a mensagem e claramente uma resposta/continuacao (ex: "sim", "pode fazer", "muda pra alta", "nao, quero X"). Use o HISTORICO para decidir.
6. Para jarbas: content_type_hint = "post" (default) ou "article" (quando menciona artigo/texto longo).
7. Para marta: intent_hint = briefing|notas|status|email|equipe|reflexao|reminder|agendar|conversa_geral
8. Para pesquisa: nenhum hint necessario.
9. NUNCA classifique como intake algo que e claramente um PEDIDO de acao. Intake e para INFORMACAO passiva.
10. Se a mensagem menciona uma PESSOA + um VERBO de acao (cobrar, falar, alinhar, preparar, agendar, lembrar) → provavelmente "marta".

Responda SOMENTE com JSON valido:
{
  "actions": [
    {
      "agent": "marta" | "jarbas" | "pesquisa" | "intake",
      "confidence": 0.0-1.0,
      "reasoning": "explicacao curta",
      "extracted_request": "trecho relevante",
      "intent_hint": "string ou null",
      "content_type_hint": "post" | "article" | null
    }
  ],
  "is_follow_up": false,
  "follow_up_context": null,
  "needs_clarification": false,
  "clarification_question": null,
  "reasoning": "visao geral"
}`;

export async function orchestrateMessage(
  text: string,
  chatId: number
): Promise<OrchestratorResult> {
  const fallback: OrchestratorResult = {
    actions: [{ agent: "intake", confidence: 0.5, reasoning: "fallback", extractedRequest: text }],
    isFollowUp: false,
    needsClarification: false,
    rawReasoning: "fallback"
  };

  if (text.trim().length < 5) return fallback;

  try {
    // Load context for the prompt — individual failures degrade gracefully
    const [people, memories, chatHistory] = await Promise.all([
      listPeople(true).catch(() => [] as Awaited<ReturnType<typeof listPeople>>),
      getOrchestratorMemories(chatId).catch(() => [] as Awaited<ReturnType<typeof getOrchestratorMemories>>),
      getRecentChatContext(chatId, 10).catch(() => [] as Awaited<ReturnType<typeof getRecentChatContext>>)
    ]);

    // Build dynamic context sections
    let contextSections = "";

    if (people.length > 0) {
      contextSections += `\nPESSOAS DA EQUIPE: ${people.map((p) => p.name).join(", ")}`;
    }

    if (memories.length > 0) {
      const memoryLines = memories
        .filter(m => m.memoryType === "routing_preference" || m.memoryType === "correction")
        .slice(0, 10)
        .map(m => `- ${m.content} (confirmado ${m.timesConfirmed}x)`);
      if (memoryLines.length > 0) {
        contextSections += `\n\nPREFERENCIAS APRENDIDAS:\n${memoryLines.join("\n")}`;
      }
    }

    if (chatHistory.length > 0) {
      const historyLines = chatHistory
        .slice(-10)
        .map(h => {
          const agentTag = h.agent ? `/${h.agent}` : "";
          // Truncate long messages in history
          const content = h.content.length > 200 ? h.content.slice(0, 200) + "..." : h.content;
          return `[${h.role}${agentTag}] ${content}`;
        });
      contextSections += `\n\nHISTORICO RECENTE DO CHAT:\n${historyLines.join("\n")}`;
    }

    const response = await callClaude({
      system: ORCHESTRATOR_PROMPT + contextSections,
      userMessage: text,
      model: "default",
      maxTokens: 1024
    });

    if (!response) return fallback;

    let parsed: {
      actions?: Array<{
        agent?: string;
        confidence?: number;
        reasoning?: string;
        extracted_request?: string;
        intent_hint?: string;
        content_type_hint?: string;
      }>;
      is_follow_up?: boolean;
      follow_up_context?: string;
      needs_clarification?: boolean;
      clarification_question?: string;
      reasoning?: string;
    };

    try {
      const jsonStart = response.indexOf("{");
      const jsonEnd = response.lastIndexOf("}");
      const jsonMatch = jsonStart >= 0 && jsonEnd > jsonStart ? [response.slice(jsonStart, jsonEnd + 1)] : null;
      if (!jsonMatch) return fallback;
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      log.warn("orchestrator:json_parse_failed", { response: response.slice(0, 200) });
      return fallback;
    }

    // If orchestrator needs clarification, return early with the question
    if (parsed.needs_clarification && parsed.clarification_question) {
      return {
        actions: [],
        isFollowUp: false,
        needsClarification: true,
        clarificationQuestion: parsed.clarification_question,
        rawReasoning: parsed.reasoning ?? ""
      };
    }

    if (!parsed.actions || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
      return fallback;
    }

    const validAgents = new Set(["marta", "jarbas", "pesquisa", "intake"]);
    const actions: OrchestratorAction[] = parsed.actions
      .filter(a => a.agent && validAgents.has(a.agent))
      .map(a => ({
        agent: a.agent as OrchestratorAction["agent"],
        confidence: typeof a.confidence === "number" ? a.confidence : 0.5,
        reasoning: a.reasoning ?? "",
        extractedRequest: a.extracted_request || text,
        intentHint: a.intent_hint ?? undefined,
        contentTypeHint: (a.content_type_hint === "post" || a.content_type_hint === "article")
          ? a.content_type_hint
          : undefined
      }));

    if (actions.length === 0) return fallback;

    const result: OrchestratorResult = {
      actions,
      isFollowUp: parsed.is_follow_up === true,
      followUpContext: parsed.follow_up_context ?? undefined,
      needsClarification: false,
      rawReasoning: parsed.reasoning ?? ""
    };

    log.info("orchestrator:classified", {
      actionsCount: actions.length,
      agents: actions.map(a => `${a.agent}(${a.confidence.toFixed(2)})`).join(", "),
      isFollowUp: result.isFollowUp,
      textPreview: text.slice(0, 80)
    });

    return result;
  } catch (error) {
    log.warn("orchestrator:classification_failed", { error });
    return fallback;
  }
}

// ── Parallel Dispatch ────────────────────────────────────────────────

export async function dispatchOrchestratorActions(
  chatId: number,
  messageId: number,
  text: string,
  message: TelegramMessage,
  actions: OrchestratorAction[]
): Promise<DispatchResult> {
  const agentActions = actions.filter(a => a.agent !== "intake" && a.agent !== "pesquisa");
  const pesquisaActions = actions.filter(a => a.agent === "pesquisa");
  const intakeActions = actions.filter(a => a.agent === "intake");

  const agentResults: DispatchResult["agentResults"] = [];

  // Combine agent + pesquisa actions for parallel dispatch
  const allDispatchable = [...agentActions, ...pesquisaActions];

  if (allDispatchable.length > 0) {
    const results = await Promise.allSettled(
      allDispatchable.map(async (action) => {
        if (action.agent === "marta") {
          log.info("orchestrator:dispatch_marta", {
            chatId, messageId,
            confidence: action.confidence,
            intentHint: action.intentHint
          });
          await routeToMarta(chatId, messageId, action.extractedRequest, message);
          await saveChatMessage(chatId, "system", `[Orquestrador despachou para Marta: ${action.extractedRequest.slice(0, 100)}]`, "orchestrator", {
            agent: "marta",
            confidence: action.confidence,
            intentHint: action.intentHint
          });
          return { agent: "marta", success: true };
        }
        if (action.agent === "jarbas") {
          log.info("orchestrator:dispatch_jarbas", {
            chatId, messageId,
            confidence: action.confidence,
            contentTypeHint: action.contentTypeHint
          });
          // Build pre-classified intent from orchestrator data to skip redundant reclassification
          const preIntent: AgentIntent = {
            agentId: action.contentTypeHint === "article" ? "ghostwriter" : "ghostwriter",
            confidence: action.confidence,
            rawRequest: action.extractedRequest,
            metadata: {
              contentType: action.contentTypeHint || "post",
              topic: action.extractedRequest
            }
          };
          await routeToAgent(chatId, messageId, action.extractedRequest, message, preIntent);
          await saveChatMessage(chatId, "system", `[Orquestrador despachou para Jarbas: ${action.extractedRequest.slice(0, 100)}]`, "orchestrator", {
            agent: "jarbas",
            confidence: action.confidence,
            contentTypeHint: action.contentTypeHint
          });
          return { agent: "jarbas", success: true };
        }
        if (action.agent === "pesquisa") {
          log.info("orchestrator:dispatch_pesquisa", {
            chatId, messageId,
            confidence: action.confidence
          });
          await routeToResearch(chatId, messageId, action.extractedRequest, message);
          await saveChatMessage(chatId, "system", `[Orquestrador despachou pesquisa: ${action.extractedRequest.slice(0, 100)}]`, "orchestrator", {
            agent: "pesquisa",
            confidence: action.confidence
          });
          return { agent: "pesquisa", success: true };
        }
        return { agent: action.agent, success: false, error: "unknown agent" };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        agentResults.push(result.value);
      } else {
        log.error("orchestrator:agent_dispatch_failed", {
          chatId, error: result.reason
        });
        agentResults.push({ agent: "unknown", success: false, error: String(result.reason) });
      }
    }
  }

  const intakeText = intakeActions.length > 0
    ? intakeActions.map(a => a.extractedRequest).join("\n\n")
    : null;

  return { intakeText, agentResults };
}
