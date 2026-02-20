import path from "node:path";
import pdfParse from "pdf-parse";
import { classifyContent } from "./classifier.js";
import { describeImage, transcribeAudio } from "./openai.js";
import { getFileBuffer, sendText } from "./telegram.js";
import { TelegramMessage } from "../types/telegram.js";
import {
  ensureProject,
  insertProactiveRun,
  insertInboxItem,
  listOpenActionItems,
  loadWeeklySummary,
  updateInboxItemStatus,
  updateInboxItemStoragePath,
  upsertCategory,
  upsertChatSubscription
} from "../db/schema.js";
import { buildOpenActionsMessage, buildWeeklyMessage } from "./reports.js";
import { appendProjectStatus, storeIncomingMedia, writeActionBoard, writeKnowledgeNote } from "./storage.js";
import { InputType, ProcessingStage } from "../types/domain.js";
import { log } from "../utils/logger.js";

interface ExtractedContent {
  inputType: InputType;
  rawText: string;
  normalizedText: string;
  mediaPath?: string;
  metadata: Record<string, unknown>;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".aac", ".flac", ".webm"]);

function inferInputType(message: TelegramMessage): InputType {
  if (message.voice || message.audio) {
    return "audio";
  }
  if (message.document?.mime_type?.startsWith("audio/")) {
    return "audio";
  }
  if (message.document?.file_name) {
    const ext = path.extname(message.document.file_name).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      return "audio";
    }
  }
  if (message.photo?.length) {
    return "image";
  }
  if (message.document?.mime_type === "application/pdf" || message.document?.file_name?.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  if (message.document?.mime_type?.startsWith("image/")) {
    return "image";
  }
  if (message.document) {
    return "file";
  }
  return "text";
}

async function extractFromMessage(message: TelegramMessage): Promise<ExtractedContent> {
  const inputType = inferInputType(message);
  const rawText = (message.text || message.caption || "").trim();

  if (inputType === "text") {
    return {
      inputType,
      rawText,
      normalizedText: rawText,
      metadata: {}
    };
  }

  if (inputType === "audio") {
    const fileId = message.voice?.file_id || message.audio?.file_id || message.document?.file_id;
    if (!fileId) {
      return { inputType, rawText, normalizedText: rawText, metadata: { error: "missing_audio_id" } };
    }

    const { buffer, filePath } = await getFileBuffer(fileId);
    const ext = path.extname(filePath) || ".ogg";
    const fileName = message.audio?.file_name || message.document?.file_name || `audio${ext}`;
    const mimeType = message.voice?.mime_type || message.audio?.mime_type || message.document?.mime_type || "audio/ogg";
    const mediaPath = await storeIncomingMedia(fileName, buffer);
    const transcription = await transcribeAudio({
      buffer,
      fileName,
      mimeType
    });
    if (!transcription) {
      log.warn("Audio received without transcription", {
        fileName,
        filePath,
        mimeType,
        hasCaption: Boolean(rawText)
      });
    }
    const normalizedText =
      [rawText, transcription].filter(Boolean).join("\n").trim() || "Audio recebido sem transcricao automatica.";

    return {
      inputType,
      rawText,
      normalizedText,
      mediaPath,
      metadata: {
        telegramFilePath: filePath,
        mimeType,
        transcriptionAvailable: Boolean(transcription)
      }
    };
  }

  if (inputType === "pdf" || inputType === "file") {
    const fileId = message.document?.file_id;
    if (!fileId) {
      return { inputType, rawText, normalizedText: rawText, metadata: { error: "missing_document_id" } };
    }

    const { buffer, filePath } = await getFileBuffer(fileId);
    const originalName = message.document?.file_name || path.basename(filePath);
    const mediaPath = await storeIncomingMedia(originalName, buffer);

    let extractedText = "";
    if (inputType === "pdf") {
      try {
        const parsed = await pdfParse(buffer);
        extractedText = parsed.text?.trim() ?? "";
      } catch (error) {
        log.warn("Failed to parse PDF", { error, filePath });
      }
    }

    return {
      inputType,
      rawText,
      normalizedText: [rawText, extractedText].filter(Boolean).join("\n").trim(),
      mediaPath,
      metadata: {
        telegramFilePath: filePath,
        fileName: originalName,
        mimeType: message.document?.mime_type,
        extractedTextLength: extractedText.length
      }
    };
  }

  if (inputType === "image") {
    const photoCandidate = message.photo
      ? [...message.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]
      : undefined;
    const fileId = photoCandidate?.file_id || message.document?.file_id;

    if (!fileId) {
      return { inputType, rawText, normalizedText: rawText, metadata: { error: "missing_image_id" } };
    }

    const { buffer, filePath } = await getFileBuffer(fileId);
    const ext = path.extname(filePath) || ".jpg";
    const mediaPath = await storeIncomingMedia(`image${ext}`, buffer);
    const dataUrl = `data:image/${ext.replace(".", "")};base64,${buffer.toString("base64")}`;
    const description = await describeImage(dataUrl);

    return {
      inputType,
      rawText,
      normalizedText: [rawText, description].filter(Boolean).join("\n").trim(),
      mediaPath,
      metadata: {
        telegramFilePath: filePath,
        descriptionAvailable: Boolean(description)
      }
    };
  }

  return {
    inputType,
    rawText,
    normalizedText: rawText,
    metadata: {}
  };
}

function buildReply(params: {
  summary: string;
  category: string;
  action: string;
  priority: string;
  nextStep?: string;
  followUpWith?: string;
  dueDateISO?: string;
  question?: string;
}): string {
  const lines = [
    "Registro feito no Second Brain.",
    `Categoria: ${params.category}`,
    `Acao: ${params.action}`,
    `Prioridade: ${params.priority}`,
    `Proximo passo: ${params.nextStep || "Nao definido"}`,
    `Quem cobrar/procurar: ${params.followUpWith || "Nao definido"}`,
    `Prazo: ${params.dueDateISO || "Nao definido"}`,
    `Resumo: ${params.summary}`
  ];

  if (params.question) {
    lines.push(`Pergunta: ${params.question}`);
  }

  return lines.join("\n");
}

function actionTitleFallback(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(" ")
    .slice(0, 80);
}

function stageFromClassification(action: string): ProcessingStage {
  if (action === "NONE") {
    return "interpretado";
  }
  return "planejado";
}

function parseDoneCommand(text: string): number | null {
  const match = text.trim().match(/^\/done\s+(\d+)$/i);
  if (!match) {
    return null;
  }
  const id = Number(match[1]);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

async function handleTextCommand(chatId: number, text: string): Promise<boolean> {
  const normalized = text.trim();

  if (normalized === "/start" || normalized === "/help") {
    await sendText(
      chatId,
      [
        "Second Brain ativo.",
        "Envie texto, audio, imagem ou PDF para registrar.",
        "",
        "Comandos:",
        "- /prioridades -> lista acoes abertas",
        "- /done <id> -> marca acao como concluida",
        "- /weekly -> gera resumo semanal agora"
      ].join("\n")
    );
    return true;
  }

  if (normalized === "/prioridades") {
    const items = await listOpenActionItems(chatId, 12);
    await sendText(chatId, buildOpenActionsMessage(items));
    return true;
  }

  const doneId = parseDoneCommand(normalized);
  if (doneId !== null) {
    const updated = await updateInboxItemStatus(chatId, doneId, "done");
    if (updated) {
      await writeActionBoard(await listOpenActionItems(undefined, 40));
      await sendText(chatId, `Item #${doneId} marcado como concluido.`);
    } else {
      await sendText(chatId, `Nao encontrei item aberto com id #${doneId} neste chat.`);
    }
    return true;
  }

  if (normalized === "/weekly") {
    const summary = await loadWeeklySummary(chatId);
    const message = buildWeeklyMessage(summary);
    await sendText(chatId, message);
    await insertProactiveRun(chatId, message, "manual");
    return true;
  }

  return false;
}

export async function processTelegramMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const messageId = message.message_id;

  await upsertChatSubscription(chatId);

  if (message.text && (await handleTextCommand(chatId, message.text))) {
    return;
  }

  const extracted = await extractFromMessage(message);
  if (!extracted.normalizedText) {
    const categoryId = await upsertCategory("Inbox Geral", "Itens sem extração automatica completa", "agent");
    const fallbackSummary = "Arquivo recebido, mas nao foi possivel extrair conteudo automaticamente.";
    await insertInboxItem({
      chatId,
      messageId,
      inputType: extracted.inputType,
      rawText: extracted.rawText,
      normalizedText: "Falha de extracao automatica.",
      summaryPtBr: fallbackSummary,
      categoryId,
      bucket: "RESEARCH",
      action: "FOLLOW_UP",
      priority: "ALTA",
      actionTitle: "Enviar resumo em texto para classificar",
      actionDetails: "Nao foi possivel extrair conteudo do anexo. Solicitar resumo em texto.",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      nextStep: "Pedir ao usuario um resumo em texto com objetivo, responsavel e prazo.",
      followUpWith: "Usuario",
      processingStage: "falha",
      processingError: "Nao foi possivel extrair conteudo do anexo.",
      confidence: 0.4,
      metadata: {
        ...extracted.metadata,
        extractionFailure: true
      }
    });
    await writeActionBoard(await listOpenActionItems(undefined, 40));
    await sendText(chatId, "Recebi o arquivo, mas nao consegui extrair conteudo. Pode enviar um resumo em texto?");
    return;
  }

  const classification = await classifyContent(extracted.normalizedText);
  const categoryId = await upsertCategory(
    classification.categoryName,
    classification.categoryDescription,
    classification.shouldCreateCategory ? "agent" : "reuse"
  );

  const audioWithoutTranscription =
    extracted.inputType === "audio" && extracted.metadata.transcriptionAvailable === false && !extracted.rawText;
  const processingError = audioWithoutTranscription
    ? "Transcricao indisponivel. Classificacao feita com conteudo parcial."
    : undefined;
  const processingStage = stageFromClassification(classification.action);

  const itemId = await insertInboxItem({
    chatId,
    messageId,
    inputType: extracted.inputType,
    rawText: extracted.rawText,
    normalizedText: extracted.normalizedText,
    summaryPtBr: classification.summaryPtBr,
    categoryId,
    bucket: classification.bucket,
    action: classification.action,
    priority: classification.priority,
    actionTitle: classification.actionTitle,
    actionDetails: classification.actionDetails,
    dueAt: classification.dueDateISO,
    nextStep: classification.nextStepPtBr,
    followUpWith: classification.followUpWithPtBr,
    processingStage,
    processingError,
    confidence: classification.confidence,
    storagePath: extracted.mediaPath,
    metadata: {
      ...extracted.metadata,
      priority: classification.priority,
      dueDateISO: classification.dueDateISO,
      nextStepPtBr: classification.nextStepPtBr,
      followUpWithPtBr: classification.followUpWithPtBr
    }
  });

  const sourceLabel = `telegram:${chatId}#${messageId}`;
  const notePath = await writeKnowledgeNote({
    classification,
    rawText: extracted.rawText,
    normalizedText: extracted.normalizedText,
    createdAt: new Date(),
    sourceLabel,
    itemId
  });

  await updateInboxItemStoragePath(itemId, notePath);
  await writeActionBoard(await listOpenActionItems(undefined, 40));

  if (classification.action === "CREATE_PROJECT") {
    const projectTitle = classification.actionTitle || actionTitleFallback(classification.summaryPtBr);
    await ensureProject({
      title: projectTitle,
      categoryId,
      sourceItemId: itemId,
      notes: classification.actionDetails
    });
    await appendProjectStatus(projectTitle, "active", sourceLabel);
  }

  await sendText(
    chatId,
    buildReply({
      summary: classification.summaryPtBr,
      category: classification.categoryName,
      action: classification.action,
      priority: classification.priority,
      nextStep: classification.nextStepPtBr,
      followUpWith: classification.followUpWithPtBr,
      dueDateISO: classification.dueDateISO,
      question: classification.followUpQuestionPtBr
    })
  );
}
