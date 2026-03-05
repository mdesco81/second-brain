import path from "node:path";
import { callClaude, describeImage } from "../services/openai.js";
import { getFileBuffer, sendText, sendTypingIndicator } from "../services/telegram.js";
import { log } from "../utils/logger.js";
import { getAgent, listAgents } from "./registry.js";
import { AgentIntent, AgentRequest } from "./types.js";
import { TelegramMessage } from "../types/telegram.js";
import {
  appendConversationMessage,
  completeCosConversation,
  createCosConversation,
  getActiveCosConversation,
  listPeople,
  updateCosConversation
} from "../db/schema.js";
import { handleFollowUp } from "./chiefofstaff/index.js";
import { classifyMartaIntent } from "./chiefofstaff/intents.js";
import { buildHelpMessage } from "./chiefofstaff/prompts.js";
import pdfParse from "pdf-parse";

const JARBAS_PATTERN = /\bjarbas\b/i;
const MARTA_PATTERN = /\bmarta\b/i;

// Research keyword patterns — detected BEFORE smart routing for instant activation.
// Matches: "pesquise", "pesquisar", "investigue", "busque sobre", etc.
// "busca" alone is too generic (noun: "a busca por talentos"), so we require it in
// imperative/verb context: "busca sobre", "busca pra mim", "busca informacoes".
const RESEARCH_PATTERN = /\b(?:pesquis[ae]r?|investig[ae]r?|busque|buscar)\b/i;
const RESEARCH_BUSCA_PATTERN = /\bbusca\s+(?:sobre|pra\s+mim|para\s+mim|informac[oõ]es|dados|detalhes)\b/i;

// Patterns where the keyword is used as a person name reference, NOT as a command invocation.
// e.g. "briefing da Marta", "email pro Jarbas", "1:1 com Marta", "notas com o Jarbas"
// In these cases the word is referencing a team member, not invoking the assistant.
const PERSON_REF_PATTERNS_MARTA = /\b(?:da|do|com|pro|pra|com a|com o|sobre a|sobre o|para a|para o)\s+marta\b/i;
const PERSON_REF_PATTERNS_JARBAS = /\b(?:da|do|com|pro|pra|com a|com o|sobre a|sobre o|para a|para o)\s+jarbas\b/i;

export function containsJarbasKeyword(text: string): boolean {
  if (!JARBAS_PATTERN.test(text)) return false;
  // If the only occurrence of "jarbas" is as a person reference (e.g. "email pro Jarbas"), skip
  const stripped = text.replace(PERSON_REF_PATTERNS_JARBAS, "___");
  return JARBAS_PATTERN.test(stripped);
}

export function stripJarbasKeyword(text: string): string {
  return text.replace(JARBAS_PATTERN, "").replace(/[,\s]+/g, " ").trim();
}

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
      const jsonMatch = response.match(/\{[\s\S]*\}/);
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

export async function routeToAgent(
  chatId: number,
  messageId: number,
  strippedText: string,
  _originalMessage: TelegramMessage
): Promise<void> {
  // Handle empty text (user sent just "Jarbas" with nothing else)
  if (!strippedText.trim()) {
    await sendText(chatId, `O que voce precisa? Tente algo como "Jarbas escreve um post sobre X" ou "Jarbas faz um artigo sobre Y".`);
    return;
  }

  await sendTypingIndicator(chatId);
  await sendText(chatId, "Entendido! Analisando seu pedido...");

  const intent = await classifyAgentIntent(strippedText);
  log.info("agent:intent_classified", {
    agentId: intent.agentId,
    confidence: intent.confidence,
    topic: intent.metadata.topic
  });

  // "research" intent is handled by the ghostwriter agent
  const handlerId = intent.agentId === "research" ? "ghostwriter" : intent.agentId;
  const handler = getAgent(handlerId);
  if (!handler) {
    // Save a conversation so the user can follow up without repeating the keyword.
    // This prevents the follow-up from being captured by Second Brain.
    // Track retryCount to prevent infinite clarification loops.
    const activeConv = await getActiveCosConversation(chatId);
    const prevRetryCount = activeConv?.intent === "jarbas_clarification"
      ? ((activeConv.context as { retryCount?: number }).retryCount ?? 0)
      : 0;

    const helpMsg = `Nao entendi o que voce precisa. Tente algo como "Jarbas escreve um post sobre X", ou me diga mais detalhes sobre o que voce quer.`;
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

export function containsMartaKeyword(text: string): boolean {
  if (!MARTA_PATTERN.test(text)) return false;
  // If the only occurrence of "marta" is as a person reference (e.g. "briefing da Marta"), skip
  const stripped = text.replace(PERSON_REF_PATTERNS_MARTA, "___");
  return MARTA_PATTERN.test(stripped);
}

export function stripMartaKeyword(text: string): string {
  return text.replace(MARTA_PATTERN, "").replace(/[,\s]+/g, " ").trim();
}

/**
 * Extract content from PDF or image attachments in a Telegram message.
 * Returns the extracted text (PDF text or image description), or null if no media.
 */
export async function extractMediaContent(message: TelegramMessage): Promise<string | null> {
  // Detect PDF
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

  // Detect image (photo array or document with image/* mime type)
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

  // Handle empty text (user sent just "Marta" with nothing else)
  if (!strippedText.trim()) {
    await sendText(chatId, buildHelpMessage());
    return;
  }

  // When user explicitly invokes "Marta" keyword, check if the new request matches
  // the active conversation's intent. If same intent → treat as follow-up (don't close).
  // If different intent → close the old conversation and process fresh.
  const activeConv = await getActiveCosConversation(chatId);
  if (activeConv) {
    const newIntent = await classifyMartaIntent(strippedText);
    if (newIntent.intent === activeConv.intent) {
      // Same intent — let the normal Marta processing detect the active conversation
      // and treat this as a follow-up instead of starting a new conversation.
      log.info("marta:explicit_keyword_same_intent_follow_up", {
        chatId, convId: activeConv.id, intent: activeConv.intent
      });
    } else {
      await completeCosConversation(activeConv.id);
      log.info("marta:explicit_keyword_closed_conversation", {
        chatId, convId: activeConv.id, prevIntent: activeConv.intent, newIntent: newIntent.intent
      });
    }
  }

  // Extract content from PDF/image attachments
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
    // Note: Marta sends her own messages via sendText internally.
    // The result.summary is for logging, not for sending to user.
  } catch (error) {
    log.error("Marta execution error", { chatId, error });
    await sendText(chatId, "Ocorreu um erro ao processar seu pedido. Tente novamente.");
  }
}

// ── Smart Conversational Routing (no keyword required) ──────────────

export interface SmartRouteResult {
  agent: "marta" | "jarbas" | "intake";
  confidence: number;
  reasoning: string;
}

const SMART_ROUTING_PROMPT = `Voce e um meta-roteador de mensagens. Classifique se a mensagem do usuario deve ser processada por um assistente virtual ou capturada como informacao.

AGENTES DISPONIVEIS:

1. "marta" — Chief of Staff virtual. Responsavel por:
   - Briefings e preparacao para reunioes/1:1s ("prepara o briefing", "me ajuda com o 1:1", "o que pegar com")
   - Processar notas de reuniao ("anota aqui", "notas do 1:1", "acabei de sair da reuniao", "segue o transcript")
   - Status da equipe ("como ta a galera", "panorama", "status")
   - Draft de emails ("escreve um email", "manda mensagem pro", "email de cobranca")
   - Registrar pessoa na equipe ("adiciona o fulano", "novo liderado", "registra")
   - Lembretes ("me lembra", "nao esquece de", "lembrete")
   - Agendar eventos ("agendar reuniao", "marca um 1:1", "coloca na agenda")
   - Reflexao estrategica ("o que tenho negligenciado", "reflexao", "analise estrategica")
   - Conversa sobre gestao de equipe, lideranca, follow-ups, compromissos

2. "jarbas" — Ghostwriter de conteudo e pesquisador. Responsavel por:
   - Escrever posts para LinkedIn
   - Criar artigos longos
   - Gerar conteudo sobre um tema
   - Qualquer pedido de criacao de texto/conteudo para publicacao
   - Pesquisas e buscas de informacao ("pesquise sobre", "busca informacoes sobre", "quero saber sobre", "me fala sobre", "levanta dados sobre")

3. "intake" — Captura de informacao/conhecimento. Para:
   - Links, artigos, referencias para ler depois
   - Notas pessoais, ideias soltas, pensamentos
   - Informacoes para guardar (financeiro, saude, estudos)
   - Qualquer coisa que NAO e um pedido de acao para Marta ou Jarbas
   - Mensagens ambiguas ou muito curtas para classificar com confianca

REGRAS CRITICAS:
- Se menciona pessoas da equipe + acao (briefing, notas, email, status) → "marta" com confianca alta
- Se menciona criar/escrever conteudo/post/artigo → "jarbas" com confianca alta
- Se pede pesquisa, busca de informacoes, "quero saber sobre", "me fala sobre" → "jarbas" com confianca alta
- Se e uma informacao solta, link, nota pessoal → "intake"
- Se for ambiguo, prefira "intake" com confianca baixa (< 0.5)
- Confianca deve refletir o quao certo voce esta: 0.9+ = obvio, 0.7-0.9 = provavel, < 0.7 = incerto

Responda APENAS com JSON valido:
{"agent": "marta" | "jarbas" | "intake", "confidence": 0.0-1.0, "reasoning": "explicacao curta"}`;

export async function smartRouteMessage(
  text: string,
  chatId: number
): Promise<SmartRouteResult> {
  const fallback: SmartRouteResult = { agent: "intake", confidence: 0.5, reasoning: "fallback" };

  // Skip very short messages — not enough context to classify
  if (text.length < 5) return fallback;

  try {
    // Load registered people names for context
    const people = await listPeople(true);
    const peopleContext = people.length > 0
      ? `\nPessoas registradas na equipe: ${people.map((p) => p.name).join(", ")}`
      : "";

    const response = await callClaude({
      system: SMART_ROUTING_PROMPT + peopleContext,
      userMessage: text,
      model: "fast",
      maxTokens: 128
    });

    if (!response) return fallback;

    let parsed: { agent?: string; confidence?: number; reasoning?: string };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback;
    }

    const validAgents = ["marta", "jarbas", "intake"];
    const agent = validAgents.includes(parsed.agent ?? "")
      ? (parsed.agent as SmartRouteResult["agent"])
      : "intake";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

    log.info("smart_route:classified", {
      agent,
      confidence,
      reasoning: parsed.reasoning,
      textPreview: text.slice(0, 80)
    });

    return { agent, confidence, reasoning: parsed.reasoning ?? "" };
  } catch (error) {
    log.warn("smart_route:classification_failed", { error });
    return fallback;
  }
}

export async function handleMartaFollowUpFromIntake(
  chatId: number,
  messageId: number,
  text: string,
  message: TelegramMessage
): Promise<boolean> {
  const activeConv = await getActiveCosConversation(chatId);
  if (!activeConv) return false;

  // ── Jarbas follow-up ──────────────────────────────────────────────
  // If the active conversation belongs to Jarbas (clarification), route the
  // follow-up back through routeToAgent with the enriched context.
  // Guard against infinite loops: if we've already retried, stop and let it
  // fall through to Second Brain instead of creating another clarification.
  if (activeConv.intent === "jarbas_clarification") {
    const context = activeConv.context as { originalRequest?: string; retryCount?: number };
    const retryCount = context.retryCount ?? 0;

    if (retryCount >= 3) {
      // Already retried 3 times — stop the loop, complete conversation, save to inbox
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
    // Extract content from PDF/image attachments in follow-up messages
    const mediaContent = await extractMediaContent(message);
    await handleFollowUp(chatId, messageId, text, activeConv, mediaContent ?? undefined);
    return true;
  } catch (error) {
    log.error("Marta follow-up error", { chatId, error });
    // Still return true — the message was intended for Marta (conversation was active).
    // Returning false would let it fall through to Second Brain pipeline, creating confusion.
    await sendText(chatId, "Desculpa, tive um problema ao processar. Pode tentar de novo?");
    return true;
  }
}
