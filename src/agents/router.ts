import { callClaude } from "../services/openai.js";
import { sendText } from "../services/telegram.js";
import { log } from "../utils/logger.js";
import { getAgent, listAgents } from "./registry.js";
import { AgentIntent, AgentRequest } from "./types.js";
import { TelegramMessage } from "../types/telegram.js";

const JARBAS_PATTERN = /\bjarbas\b/i;

export function containsJarbasKeyword(text: string): boolean {
  return JARBAS_PATTERN.test(text);
}

export function stripJarbasKeyword(text: string): string {
  return text.replace(JARBAS_PATTERN, "").replace(/[,\s]+/g, " ").trim();
}

const INTENT_SYSTEM_PROMPT = `Voce e um roteador de intencoes. Recebe um pedido do usuario e determina qual agente deve atende-lo.

Agentes disponiveis:
- ghostwriter: Produz posts e artigos para LinkedIn. Detecte pedidos como "escrever post", "criar artigo", "texto para LinkedIn", "publicacao sobre", "conteudo sobre", "redacao sobre", "fazer um artigo", "fazer um post", "faz um post", "faz um artigo", "quero um artigo", "quero um post", "prepara um artigo", "prepara um post", "me escreve um artigo", "me escreve um post", "monta um post", "monta um artigo", "elabora um post", "produz um artigo" etc.
- unknown: Quando nenhum agente se encaixa.

Responda APENAS com JSON valido:
{
  "agentId": "ghostwriter" | "unknown",
  "confidence": 0.0 a 1.0,
  "metadata": {
    "contentType": "post" | "article",
    "topic": "topico extraido do pedido",
    "additionalInstructions": "instrucoes extras mencionadas pelo usuario ou null"
  }
}

Regras para contentType — PRESTE MUITA ATENCAO:
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

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallback;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      agentId?: string;
      confidence?: number;
      metadata?: Record<string, unknown>;
    };

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
  await sendText(chatId, "Entendido! Analisando seu pedido...");

  const intent = await classifyAgentIntent(strippedText);
  log.info("agent:intent_classified", {
    agentId: intent.agentId,
    confidence: intent.confidence,
    topic: intent.metadata.topic
  });

  const handler = getAgent(intent.agentId);
  if (!handler) {
    const available = listAgents();
    const helpMsg = available.length > 0
      ? `Agentes disponiveis: ${available.join(", ")}. Tente algo como "Jarbas escreve um post sobre X".`
      : "Nenhum agente registrado no momento.";
    await sendText(chatId, `Nao entendi o que voce precisa. ${helpMsg}`);
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
    if (result.success) {
      await sendText(chatId, result.summary);
    } else {
      await sendText(chatId, `Erro no agente ${intent.agentId}: ${result.error || "erro desconhecido"}`);
    }
  } catch (error) {
    log.error("Agent execution failed", { agentId: intent.agentId, chatId, error });
    await sendText(chatId, "Ocorreu um erro ao processar seu pedido. Tente novamente.");
  }
}
