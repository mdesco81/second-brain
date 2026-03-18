import { registerAgent } from "../registry.js";
import { AgentRequest, AgentResult } from "../types.js";
import { saveAgentOutput, saveResearchContext, trackAgentOutput } from "../base.js";
import { sendText, sendTextWithButtons, sendTypingIndicator } from "../../services/telegram.js";
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
import { buildGhostwriterPrompt, buildHashtagPrompt, buildHooksPrompt } from "./prompts.js";
import { updateInboxItemMetadata, saveChatMessage } from "../../db/schema.js";

// ── Research handler ──────────────────────────────────────────────────

const RESEARCH_BULLETS_PROMPT = `Voce e um assistente de pesquisa. Resuma o resultado em EXATAMENTE 5 bullet points em portugues brasileiro.

FORMATO OBRIGATORIO — responda SOMENTE com os 5 bullets, sem introducao, sem conclusao, sem texto adicional:
• [bullet 1]
• [bullet 2]
• [bullet 3]
• [bullet 4]
• [bullet 5]

Regras para cada bullet:
- Maximo 2 linhas por bullet
- Linguagem clara e direta, sem jargao desnecessario
- Priorize dados concretos, numeros, porcentagens e fatos verificaveis
- Cada bullet deve ser auto-contido (compreensivel sem os outros)
- NAO inclua links, URLs ou referencias numericas como [1] [2]
- NAO use emojis
- Comece cada bullet com "•"
- Foque nos insights mais relevantes e acionaveis para um profissional`;

async function handleResearch(
  request: AgentRequest
): Promise<AgentResult> {
  const { chatId, messageId, rawRequest, intent } = request;
  const metadata = intent.metadata as {
    topic?: string;
    searchDepth?: string;
  };

  const topic = metadata.topic || rawRequest;
  const searchDepth = metadata.searchDepth === "deep" ? "deep" : "quick";
  const searchMode: SearchMode = searchDepth === "deep" ? "deep" : "simple";

  log.info("research:start", { topic, searchDepth, chatId });

  // 1. Search with Perplexity
  await sendTypingIndicator(chatId);
  const depthLabel = searchDepth === "deep" ? "profunda" : "rapida";
  await sendText(chatId, `Pesquisando (${depthLabel}) sobre "${topic}"...`);

  const searchQuery = `Pesquise sobre "${topic}". Inclua dados concretos, tendencias recentes, estatisticas e exemplos praticos. Foque em informacoes dos ultimos 12 meses.`;
  const research = await searchWithPerplexity(searchQuery, searchMode);

  if (!research) {
    log.warn("research: no results from Perplexity", { topic });
    await sendText(chatId, `Nao encontrei resultados para "${topic}". Tente reformular sua pesquisa.`);
    return {
      success: false,
      agentId: "research",
      summary: "Pesquisa sem resultados",
      error: "No Perplexity results"
    };
  }

  // 2. Claude formats into 5 bullets
  await sendTypingIndicator(chatId);

  const bullets = await callClaude({
    system: RESEARCH_BULLETS_PROMPT,
    userMessage: `Tema: ${topic}\n\nResultado da pesquisa:\n${research.text}`,
    model: "fast",
    maxTokens: 1024
  });

  const bulletsText = bullets || research.text.slice(0, 3000);
  if (!bullets) {
    log.warn("research: Claude formatting failed, using raw text fallback", { topic });
  }

  // 3. Send clean bullets to Telegram (no links)
  const researchMsg = `Pesquisa sobre "${topic}":\n\n${bulletsText}`;
  await sendText(chatId, researchMsg);
  await saveChatMessage(chatId, "assistant", researchMsg.slice(0, 500), "pesquisa", { type: "research", topic }).catch(() => {});

  // 4. Save full research with sources to dashboard
  const fullContent = [
    `# Pesquisa: ${topic}`,
    "",
    `**Profundidade:** ${depthLabel}`,
    `**Modelo:** ${research.model}`,
    "",
    "## Resumo",
    "",
    bulletsText,
    "",
    "## Pesquisa completa",
    "",
    research.text,
    ""
  ].join("\n");

  let fullContentWithSources = fullContent;
  if (research.citations.length > 0) {
    const sourcesSection = [
      "",
      "---",
      "",
      "## Fontes consultadas",
      "",
      ...research.citations.map((url, i) => `${i + 1}. ${url}`),
      ""
    ].join("\n");
    fullContentWithSources = fullContent + sourcesSection;
  }

  const outputPath = await saveAgentOutput({
    agentId: "ghostwriter",
    contentType: "research",
    topic,
    content: fullContentWithSources,
    timestamp: request.timestamp
  });

  // Save research context separately
  await saveResearchContext({
    contentType: "research",
    topic,
    searchQuery,
    searchMode: searchMode,
    researchText: research.text,
    citations: research.citations,
    perplexityModel: research.model,
    timestamp: request.timestamp
  }).catch((err) => {
    log.warn("research: failed to save research context", { err });
  });

  // Track in dashboard
  const itemId = await trackAgentOutput({
    chatId,
    messageId,
    agentId: "ghostwriter",
    topic,
    contentType: "research",
    outputPath,
    summary: `Pesquisa sobre "${topic}" concluida.`
  });

  log.info("research:complete", { topic, outputPath, itemId, citations: research.citations.length });

  return {
    success: true,
    agentId: "research",
    outputPath,
    itemId,
    summary: `Pesquisa sobre "${topic}" concluida com ${research.citations.length} fontes.`
  };
}

// ── Ghostwriter handler ──────────────────────────────────────────────

async function handleGhostwriter(
  request: AgentRequest
): Promise<AgentResult> {
  // Dispatch research requests to dedicated handler
  const reqMetadata = request.intent.metadata as { contentType?: string };
  if (request.agentId === "research" || reqMetadata.contentType === "research") {
    return handleResearch(request);
  }

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
  await sendTypingIndicator(chatId);
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

  // 2.5. Generate hooks
  let hooks: Array<{ type: string; text: string; selected: boolean }> = [];
  try {
    const hooksPrompt = buildHooksPrompt({
      topic,
      contentType,
      researchContext,
      learnedStyle
    });

    const hooksRaw = await callClaude({
      system: hooksPrompt.system,
      userMessage: hooksPrompt.user,
      model: "fast",
      maxTokens: 1024
    });

    if (hooksRaw) {
      const cleaned = hooksRaw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned) as Array<{ type: string; text: string }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        hooks = parsed.map((h, i) => ({ type: h.type, text: h.text, selected: i === 0 }));
        log.info("ghostwriter:hooks-generated", { count: hooks.length });

        // Send hooks to user via Telegram
        const hooksMessage = [
          `Ganchos gerados para "${topic}":`,
          "",
          ...hooks.map((h, i) => `${i + 1}. [${h.type}] ${h.text}${i === 0 ? " ← selecionado" : ""}`)
        ].join("\n");
        await sendText(chatId, hooksMessage);
      }
    }
  } catch (hookError) {
    log.warn("ghostwriter: hook generation failed, proceeding without", {
      error: hookError instanceof Error ? hookError.message : String(hookError)
    });
  }

  // Build additional instructions with selected hook
  const selectedHook = hooks.find((h) => h.selected);
  const hookInstruction = selectedHook
    ? `GANCHO OBRIGATORIO: Comece o texto com este gancho (adapte se necessario): "${selectedHook.text}"`
    : undefined;

  const finalAdditionalInstructions = [additionalInstructions, hookInstruction]
    .filter(Boolean)
    .join("\n\n") || undefined;

  // 3. Writing phase
  await sendTypingIndicator(chatId);
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
    additionalInstructions: finalAdditionalInstructions
  });

  const maxTokens = contentType === "article" ? 8192 : 4096;

  let draft: string | null;
  try {
    draft = await callClaude({
      system: prompt.system,
      userMessage: prompt.user,
      model: "premium",
      maxTokens
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("ghostwriter: Claude API error", { topic, error: errorMsg });
    return {
      success: false,
      agentId: "ghostwriter",
      summary: `Falha ao gerar rascunho.`,
      error: `Claude API error: ${errorMsg}`
    };
  }

  if (!draft) {
    log.error("ghostwriter: Claude returned empty draft", { topic });
    return {
      success: false,
      agentId: "ghostwriter",
      summary: "Falha ao gerar o rascunho.",
      error: "Claude returned empty response"
    };
  }

  // Post format validation + retry
  if (contentType === "post") {
    const validation = validateLinkedInFormat(draft);
    log.info("ghostwriter:post-validation", {
      charCount: validation.charCount,
      hasShortParagraphs: validation.hasShortParagraphs,
      hasLineBreaks: validation.hasLineBreaks,
      hasExternalLinks: validation.hasExternalLinks
    });

    if (validation.charCount < 1000 || validation.charCount > 2200) {
      log.info("ghostwriter:post-retry", {
        reason: validation.charCount < 1000 ? "too_short" : "too_long",
        charCount: validation.charCount
      });

      const adjustInstruction = validation.charCount < 1000
        ? `O post gerado tem apenas ${validation.charCount} caracteres. Preciso que tenha entre 1300 e 1900 caracteres. Expanda com mais detalhes, exemplos e argumentacao, mantendo o mesmo tom e estrutura.`
        : `O post gerado tem ${validation.charCount} caracteres. Preciso que tenha entre 1300 e 1900 caracteres. Condense mantendo os pontos principais, sem perder o gancho e o CTA.`;

      try {
        const retryDraft = await callClaude({
          system: prompt.system,
          userMessage: `${prompt.user}\n\n## AJUSTE OBRIGATORIO\n${adjustInstruction}`,
          model: "premium",
          maxTokens
        });

        if (retryDraft) {
          const retryValidation = validateLinkedInFormat(retryDraft);
          log.info("ghostwriter:post-retry-result", {
            charCount: retryValidation.charCount
          });
          draft = retryDraft;
        }
      } catch (retryError) {
        log.warn("ghostwriter: retry failed, using original draft", {
          error: retryError instanceof Error ? retryError.message : String(retryError)
        });
      }
    }
  }

  // 3.5. Generate hashtags
  let hashtags: string[] = [];
  try {
    const hashtagPrompt = buildHashtagPrompt({
      topic,
      contentType,
      researchContext,
      draft
    });

    const hashtagRaw = await callClaude({
      system: hashtagPrompt.system,
      userMessage: hashtagPrompt.user,
      model: "fast",
      maxTokens: 256
    });

    if (hashtagRaw) {
      const cleaned = hashtagRaw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Extract any inline hashtags from draft
        const inlineHashtags = (draft.match(/#[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9]+/g) || []).map((h) => h.toLowerCase());

        // Deduplicate: merge AI hashtags + inline, removing duplicates
        const seen = new Set<string>();
        for (const tag of [...parsed, ...inlineHashtags]) {
          const normalized = tag.startsWith("#") ? tag : `#${tag}`;
          if (!seen.has(normalized.toLowerCase())) {
            seen.add(normalized.toLowerCase());
            hashtags.push(normalized);
          }
        }

        // Remove inline hashtags from draft to avoid duplication
        if (inlineHashtags.length > 0) {
          draft = draft.replace(/\n*(?:#[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9]+\s*)+$/m, "").trimEnd();
        }

        log.info("ghostwriter:hashtags-generated", { count: hashtags.length, hashtags });
      }
    }
  } catch (hashtagError) {
    log.warn("ghostwriter: hashtag generation failed, proceeding without", {
      error: hashtagError instanceof Error ? hashtagError.message : String(hashtagError)
    });
  }

  // Append hashtags to draft
  if (hashtags.length > 0) {
    draft = draft.trimEnd() + "\n\n" + hashtags.join(" ");
  }

  // 4. Append sources to draft if available
  let draftWithSources = draft;
  if (research?.citations?.length) {
    const sourcesSection = [
      "",
      "",
      "---",
      "",
      "## Fontes consultadas",
      "",
      ...research.citations.map((url, i) => `${i + 1}. ${url}`),
      ""
    ].join("\n");
    draftWithSources = draft + sourcesSection;
  }

  // 5. Save output (draft + sources)
  const outputPath = await saveAgentOutput({
    agentId: "ghostwriter",
    contentType,
    topic,
    content: draftWithSources,
    timestamp: request.timestamp
  });

  // 6. Save research context separately for future reference
  if (research) {
    await saveResearchContext({
      contentType,
      topic,
      searchQuery,
      searchMode,
      researchText: research.text,
      citations: research.citations,
      perplexityModel: research.model,
      timestamp: request.timestamp
    }).catch((err) => {
      log.warn("ghostwriter: failed to save research context", { err });
    });
  }

  // 7. Track in dashboard
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

  // 7.5. Save hooks and hashtags in metadata
  if (itemId && (hooks.length > 0 || hashtags.length > 0)) {
    const extraMetadata: Record<string, unknown> = {};
    if (hooks.length > 0) extraMetadata.hooks = hooks;
    if (hashtags.length > 0) extraMetadata.hashtags = hashtags;

    await updateInboxItemMetadata(itemId, extraMetadata).catch((err) => {
      log.warn("ghostwriter: failed to save hooks/hashtags metadata", { err });
    });
  }

  log.info("ghostwriter:complete", { topic, outputPath, itemId });

  const sourcesNote = research?.citations?.length
    ? `\n\nFontes consultadas: ${research.citations.length}`
    : "";

  // 8. Send draft + feedback buttons to user
  const summaryMsg = [
    `${typeLabel} sobre "${topic}" pronto!`,
    `Salvo no dashboard para revisao.${sourcesNote}`
  ].join("\n");

  if (itemId) {
    await sendTextWithButtons(chatId, summaryMsg, [
      [
        { text: "✅ Aprovar", callback_data: `jarbas_approve:${itemId}` },
        { text: "✏️ Editar", callback_data: `jarbas_edit:${itemId}` },
        { text: "❌ Rejeitar", callback_data: `jarbas_reject:${itemId}` }
      ]
    ]);
  } else {
    await sendText(chatId, summaryMsg);
  }

  // Save to chat_context so the orchestrator sees it in history
  await saveChatMessage(chatId, "assistant", `[Jarbas] ${typeLabel} sobre "${topic}" gerado e salvo no dashboard.`, "jarbas", {
    type: contentType,
    topic,
    itemId
  }).catch(() => {});

  return {
    success: true,
    agentId: "ghostwriter",
    outputPath,
    itemId,
    summary: summaryMsg
  };
}

interface LinkedInValidation {
  charCount: number;
  hasShortParagraphs: boolean;
  hasLineBreaks: boolean;
  hasExternalLinks: boolean;
}

function validateLinkedInFormat(text: string): LinkedInValidation {
  const charCount = text.length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const hasShortParagraphs = paragraphs.every((p) => p.trim().split("\n").length <= 4);
  const hasLineBreaks = text.includes("\n\n");
  const hasExternalLinks = /https?:\/\/[^\s)]+/i.test(text);

  return { charCount, hasShortParagraphs, hasLineBreaks, hasExternalLinks };
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
