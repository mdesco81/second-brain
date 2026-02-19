import path from "node:path";
import pdfParse from "pdf-parse";
import { classifyContent } from "./classifier.js";
import { describeImage, transcribeAudio } from "./openai.js";
import { getFileBuffer, sendText } from "./telegram.js";
import { TelegramMessage } from "../types/telegram.js";
import {
  ensureProject,
  insertInboxItem,
  updateInboxItemStoragePath,
  upsertCategory,
  upsertChatSubscription
} from "../db/schema.js";
import { appendProjectStatus, storeIncomingMedia, writeKnowledgeNote } from "./storage.js";
import { InputType } from "../types/domain.js";
import { log } from "../utils/logger.js";

interface ExtractedContent {
  inputType: InputType;
  rawText: string;
  normalizedText: string;
  mediaPath?: string;
  metadata: Record<string, unknown>;
}

function inferInputType(message: TelegramMessage): InputType {
  if (message.voice || message.audio) {
    return "audio";
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
    const fileId = message.voice?.file_id || message.audio?.file_id;
    if (!fileId) {
      return { inputType, rawText, normalizedText: rawText, metadata: { error: "missing_audio_id" } };
    }

    const { buffer, filePath } = await getFileBuffer(fileId);
    const ext = path.extname(filePath) || ".ogg";
    const mediaPath = await storeIncomingMedia(`audio${ext}`, buffer);
    const transcription = await transcribeAudio(mediaPath);

    return {
      inputType,
      rawText,
      normalizedText: [rawText, transcription].filter(Boolean).join("\n").trim(),
      mediaPath,
      metadata: {
        telegramFilePath: filePath,
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
  question?: string;
}): string {
  const lines = [
    "Registro feito no Second Brain.",
    `Categoria: ${params.category}`,
    `Acao: ${params.action}`,
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

export async function processTelegramMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const messageId = message.message_id;

  await upsertChatSubscription(chatId);

  if (message.text?.trim() === "/start") {
    await sendText(
      chatId,
      "Second Brain ativo. Pode enviar texto, audio, imagem ou PDF. Vou organizar, classificar e sugerir proximas acoes."
    );
    return;
  }

  const extracted = await extractFromMessage(message);
  if (!extracted.normalizedText) {
    await sendText(chatId, "Recebi o arquivo, mas nao consegui extrair conteudo. Pode enviar um resumo em texto?");
    return;
  }

  const classification = await classifyContent(extracted.normalizedText);
  const categoryId = await upsertCategory(
    classification.categoryName,
    classification.categoryDescription,
    classification.shouldCreateCategory ? "agent" : "reuse"
  );

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
    actionTitle: classification.actionTitle,
    actionDetails: classification.actionDetails,
    confidence: classification.confidence,
    storagePath: extracted.mediaPath,
    metadata: extracted.metadata
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
      question: classification.followUpQuestionPtBr
    })
  );
}
