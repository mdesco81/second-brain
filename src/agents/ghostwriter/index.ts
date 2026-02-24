import { registerAgent } from "../registry.js";
import { AgentRequest, AgentResult } from "../types.js";
import { saveAgentOutput, trackAgentOutput } from "../base.js";
import { sendText } from "../../services/telegram.js";
import { callClaude } from "../../services/openai.js";
import { log } from "../../utils/logger.js";
import {
  loadStyleGuide,
  loadBestPractices,
  loadLearnedStyle,
  loadReferenceContent
} from "./knowledge.js";
import {
  searchWithPerplexity,
  formatResearchContext,
  SearchMode
} from "./search.js";
import { buildGhostwriterPrompt } from "./prompts.js";

async function handleGhostwriter(
  request: AgentRequest
): Promise<AgentResult> {
  const { chatId, messageId, rawRequest, intent } = request;
  const metadata = intent.metadata as {
    contentType?: string;
    topic?: string;
    additionalInstructions?: string;
  };

  const contentType =
    metadata.contentType === "article" ? "article" : "post";
  const topic = metadata.topic || rawRequest;
  const additionalInstructions = metadata.additionalInstructions as
    | string
    | undefined;

  log.info("ghostwriter:start", { contentType, topic, chatId });

  // 1. Load knowledge base in parallel
  const [styleGuide, bestPractices, learnedStyle, referenceSamples] =
    await Promise.all([
      loadStyleGuide(),
      loadBestPractices(),
      loadLearnedStyle(),
      loadReferenceContent()
    ]);

  // 2. Research phase
  await sendText(
    chatId,
    `Pesquisando sobre "${topic}"...`
  );

  const searchMode: SearchMode =
    contentType === "article" ? "deep" : "simple";

  const searchQuery = buildSearchQuery(topic, contentType);
  const research = await searchWithPerplexity(searchQuery, searchMode);
  const researchContext = research
    ? formatResearchContext(research)
    : "";

  if (!research) {
    log.warn("ghostwriter: no research results, proceeding without", {
      topic
    });
  }

  // 3. Writing phase
  await sendText(
    chatId,
    `Escrevendo ${contentType === "article" ? "artigo" : "post"}...`
  );

  const prompt = buildGhostwriterPrompt({
    contentType,
    topic,
    styleGuide,
    bestPractices,
    learnedStyle,
    referenceSamples,
    researchContext,
    additionalInstructions: additionalInstructions ?? undefined
  });

  const maxTokens = contentType === "article" ? 8192 : 4096;

  const draft = await callClaude({
    system: prompt.system,
    userMessage: prompt.user,
    model: "default",
    maxTokens
  });

  if (!draft) {
    log.error("ghostwriter: Claude returned null draft", { topic });
    return {
      success: false,
      agentId: "ghostwriter",
      summary: "Falha ao gerar o rascunho.",
      error: "Claude returned null"
    };
  }

  // 4. Save output
  const outputPath = await saveAgentOutput({
    agentId: "ghostwriter",
    contentType,
    topic,
    content: draft,
    timestamp: request.timestamp
  });

  // 5. Track in dashboard
  const typeLabel =
    contentType === "article" ? "Artigo" : "Post";

  const itemId = await trackAgentOutput({
    chatId,
    messageId,
    agentId: "ghostwriter",
    topic,
    contentType,
    outputPath,
    summary: `${typeLabel} sobre "${topic}" gerado e salvo.`
  });

  log.info("ghostwriter:complete", { topic, outputPath, itemId });

  const sourcesNote = research?.citations?.length
    ? `\n\nFontes consultadas: ${research.citations.length}`
    : "";

  return {
    success: true,
    agentId: "ghostwriter",
    outputPath,
    itemId,
    summary: [
      `${typeLabel} sobre "${topic}" pronto!`,
      `Salvo no dashboard para revisao.`,
      `Voce pode baixar o arquivo, editar e subir a versao final para que eu aprenda seu estilo.${sourcesNote}`
    ].join("\n")
  };
}

function buildSearchQuery(
  topic: string,
  contentType: string
): string {
  const depth =
    contentType === "article"
      ? "Faca uma pesquisa aprofundada sobre"
      : "Pesquise tendencias e dados recentes sobre";

  return `${depth} "${topic}" no contexto profissional e de negocios. Inclua estatisticas, dados de mercado, exemplos de empresas e insights de especialistas. Foque em informacoes dos ultimos 12 meses.`;
}

export function registerGhostwriter(): void {
  registerAgent("ghostwriter", handleGhostwriter);
  log.info("Agent registered: ghostwriter");
}
