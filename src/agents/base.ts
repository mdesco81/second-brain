import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_PATHS, slugify } from "../utils/paths.js";
import { insertInboxItem, insertItemAttachment, upsertCategory } from "../db/schema.js";
import { log } from "../utils/logger.js";

export async function saveAgentOutput(params: {
  agentId: string;
  contentType: string;
  topic: string;
  content: string;
  timestamp: Date;
}): Promise<string> {
  const dateStr = [
    params.timestamp.getFullYear(),
    String(params.timestamp.getMonth() + 1).padStart(2, "0"),
    String(params.timestamp.getDate()).padStart(2, "0")
  ].join(" ");

  const subFolderMap: Record<string, string> = {
    article: "Artigos",
    research: "Pesquisas",
  };
  const subFolder = subFolderMap[params.contentType] || "Posts";
  const outputDir = path.join(KNOWLEDGE_PATHS.agentOutputs, subFolder);
  await fs.mkdir(outputDir, { recursive: true });

  const typeLabelMap: Record<string, string> = {
    article: "Artigo Linkedin",
    research: "Pesquisa",
  };
  const typeLabel = typeLabelMap[params.contentType] || "Post Linkedin";
  const topicSlug = slugify(params.topic).slice(0, 60);
  const fileName = `${dateStr} - ${typeLabel} - ${topicSlug}.md`;
  const fullPath = path.join(outputDir, fileName);

  await fs.writeFile(fullPath, params.content, "utf8");
  log.info("agent:output_saved", { path: fullPath, agent: params.agentId });

  return fullPath;
}

export async function saveResearchContext(params: {
  contentType: string;
  topic: string;
  searchQuery: string;
  searchMode: string;
  researchText: string;
  citations: string[];
  perplexityModel: string;
  timestamp: Date;
}): Promise<string> {
  const dateStr = [
    params.timestamp.getFullYear(),
    String(params.timestamp.getMonth() + 1).padStart(2, "0"),
    String(params.timestamp.getDate()).padStart(2, "0")
  ].join(" ");

  const researchDir = path.join(KNOWLEDGE_PATHS.agentOutputs, "_pesquisas");
  await fs.mkdir(researchDir, { recursive: true });

  const topicSlug = slugify(params.topic).slice(0, 60);
  const fileName = `${dateStr} - Pesquisa - ${topicSlug}.md`;
  const fullPath = path.join(researchDir, fileName);

  const lines: string[] = [
    `# Pesquisa: ${params.topic}`,
    "",
    `**Data:** ${dateStr}`,
    `**Tipo de conteudo:** ${params.contentType === "article" ? "Artigo" : "Post"}`,
    `**Modelo Perplexity:** ${params.perplexityModel}`,
    `**Modo de busca:** ${params.searchMode}`,
    "",
    "## Query de pesquisa",
    "",
    params.searchQuery,
    "",
    "## Resultado da pesquisa",
    "",
    params.researchText,
    ""
  ];

  if (params.citations.length > 0) {
    lines.push("## Fontes consultadas", "");
    for (let i = 0; i < params.citations.length; i++) {
      lines.push(`${i + 1}. ${params.citations[i]}`);
    }
    lines.push("");
  }

  await fs.writeFile(fullPath, lines.join("\n"), "utf8");
  log.info("agent:research_saved", { path: fullPath, citations: params.citations.length });

  return fullPath;
}

export async function trackAgentOutput(params: {
  chatId: number;
  messageId: number;
  agentId: string;
  topic: string;
  contentType: string;
  outputPath: string;
  summary: string;
}): Promise<number> {
  const isResearch = params.contentType === "research";
  const categoryId = await upsertCategory(
    isResearch ? "Pesquisas" : "Conteudo LinkedIn",
    isResearch ? "Pesquisas realizadas via agente" : "Artigos e posts gerados pelo agente ghostwriter",
    "agent"
  );

  const actionTitleMap: Record<string, string> = {
    article: `Revisar artigo: ${params.topic}`,
    research: `Pesquisa: ${params.topic}`,
  };

  const itemId = await insertInboxItem({
    chatId: params.chatId,
    messageId: params.messageId,
    inputType: "text",
    rawText: isResearch ? `[Pesquisa] ${params.topic}` : `[Jarbas Ghostwriter] ${params.topic}`,
    normalizedText: params.summary,
    summaryPtBr: params.summary,
    categoryId,
    bucket: "PROJECTS",
    action: "STORE_REFERENCE",
    priority: "MEDIA",
    actionTitle: actionTitleMap[params.contentType] || `Revisar post: ${params.topic}`,
    actionDetails: isResearch ? `Pesquisa realizada via Perplexity.` : `Gerado pelo agente ghostwriter.`,
    processingStage: "planejado",
    confidence: 0.99,
    storagePath: params.outputPath,
    metadata: {
      agentId: params.agentId,
      agentContentType: params.contentType,
      agentTopic: params.topic,
      isAgentOutput: true,
      draftPath: params.outputPath
    }
  });

  await insertItemAttachment({
    itemId,
    storagePath: params.outputPath,
    fileName: path.basename(params.outputPath),
    inputType: "text"
  });

  log.info("agent:output_tracked", { itemId, agent: params.agentId });
  return itemId;
}
