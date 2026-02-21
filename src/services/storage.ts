import fs from "node:fs/promises";
import path from "node:path";
import { ClassificationResult } from "../types/domain.js";
import type { OpenActionItem } from "../db/schema.js";
import { KNOWLEDGE_PATHS, slugify, toDailyFolder } from "../utils/paths.js";

const TREE = Object.values(KNOWLEDGE_PATHS);

export async function ensureKnowledgeTree(): Promise<void> {
  for (const target of TREE) {
    await fs.mkdir(target, { recursive: true });
  }

  const projectStatusPath = path.join(KNOWLEDGE_PATHS.status, "project_status.md");
  await touchIfMissing(
    projectStatusPath,
    [
      "# Project Status",
      "",
      "| Updated At | Project | Status | Source |",
      "|---|---|---|---|"
    ].join("\n") + "\n"
  );

  const actionBoardPath = path.join(KNOWLEDGE_PATHS.status, "action_board.md");
  await touchIfMissing(
    actionBoardPath,
    [
      "# Action Board",
      "",
      "Acoes abertas ordenadas por prioridade e prazo.",
      ""
    ].join("\n")
  );

  const systemReadmePath = path.join(KNOWLEDGE_PATHS.system, "README.md");
  await touchIfMissing(
    systemReadmePath,
    [
      "# System",
      "",
      "This folder stores logs, automation traces and runtime system notes."
    ].join("\n") + "\n"
  );
}

async function touchIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, content, "utf8");
  }
}

export async function storeIncomingMedia(fileName: string, fileBuffer: Buffer): Promise<string> {
  const folder = toDailyFolder(KNOWLEDGE_PATHS.inbox);
  await fs.mkdir(folder, { recursive: true });
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const safeName = `${Date.now()}-${slugify(baseName) || "incoming"}${ext.toLowerCase()}`;
  const fullPath = path.join(folder, safeName);
  await fs.writeFile(fullPath, fileBuffer);
  return fullPath;
}

function bucketPath(bucket: ClassificationResult["bucket"]): string {
  switch (bucket) {
    case "PROJECTS":
      return KNOWLEDGE_PATHS.projects;
    case "AREAS":
      return KNOWLEDGE_PATHS.areas;
    case "RESOURCES":
      return KNOWLEDGE_PATHS.resources;
    case "RESEARCH":
      return KNOWLEDGE_PATHS.research;
    case "ARCHIVE":
      return KNOWLEDGE_PATHS.archive;
    default:
      return KNOWLEDGE_PATHS.inbox;
  }
}

export async function writeKnowledgeNote(params: {
  classification: ClassificationResult;
  rawText: string;
  normalizedText: string;
  createdAt: Date;
  sourceLabel: string;
  itemId: number;
  mediaPath?: string;
  inputType?: string;
}): Promise<string> {
  const base = bucketPath(params.classification.bucket);
  const folder = toDailyFolder(base, params.createdAt);
  await fs.mkdir(folder, { recursive: true });

  const fileName = `${params.createdAt.toISOString().replace(/[:.]/g, "-")}-${slugify(
    params.classification.actionTitle || params.classification.categoryName
  )}.md`;
  const target = path.join(folder, fileName);

  const isPdf = params.inputType === "pdf" && params.mediaPath;

  const contentSections = [
    `# ${params.classification.actionTitle || params.classification.summaryPtBr}`,
    "",
    `- Item ID: ${params.itemId}`,
    `- Categoria: ${params.classification.categoryName}`,
    `- Bucket: ${params.classification.bucket}`,
    `- Acao: ${params.classification.action}`,
    `- Prioridade: ${params.classification.priority}`,
    `- Proximo passo: ${params.classification.nextStepPtBr || "Nao definido"}`,
    `- Quem cobrar/procurar: ${params.classification.followUpWithPtBr || "Nao definido"}`,
    `- Prazo: ${params.classification.dueDateISO || "Nao definido"}`,
    `- Confianca: ${params.classification.confidence}`,
    `- Origem: ${params.sourceLabel}`,
    `- Criado em: ${params.createdAt.toISOString()}`,
    "",
    "## Resumo",
    params.classification.summaryPtBr
  ];

  if (isPdf) {
    contentSections.push(
      "",
      "## Documento PDF",
      `Arquivo armazenado em: ${params.mediaPath}`,
      "",
      "> Para consultar o conteudo completo, abra o arquivo PDF diretamente."
    );
    if (params.rawText) {
      contentSections.push("", "## Observacoes do usuario", params.rawText);
    }
  } else {
    contentSections.push(
      "",
      "## Conteudo Normalizado",
      params.normalizedText,
      "",
      "## Conteudo Bruto",
      params.rawText
    );
  }

  await fs.writeFile(target, contentSections.join("\n"), "utf8");
  return target;
}

export async function appendProjectStatus(projectName: string, status: string, source: string): Promise<void> {
  const target = path.join(KNOWLEDGE_PATHS.status, "project_status.md");
  const line = `| ${new Date().toISOString()} | ${projectName} | ${status} | ${source} |\n`;
  await fs.appendFile(target, line, "utf8");
}

export async function writeActionBoard(items: OpenActionItem[]): Promise<void> {
  const target = path.join(KNOWLEDGE_PATHS.status, "action_board.md");
  const lines = [
    "# Action Board",
    "",
    `Atualizado em: ${new Date().toISOString()}`,
    "",
    "| Item | Prioridade | Acao | Categoria | Quem cobrar/procurar | Prazo | Proximo passo |",
    "|---|---|---|---|---|---|---|"
  ];

  if (items.length === 0) {
    lines.push("| - | - | - | - | - | - | Nao ha acoes abertas |");
  } else {
    for (const item of items) {
      lines.push(
        `| #${item.id} | ${item.priority} | ${item.action} | ${item.categoryName} | ${item.followUpWith || "-"} | ${item.dueAt || "-"} | ${item.nextStep || item.actionTitle || item.summaryPtBr} |`
      );
    }
  }

  await fs.writeFile(target, `${lines.join("\n")}\n`, "utf8");
}
