import path from "node:path";
import pdfParse from "pdf-parse";
import { classifyContent } from "./classifier.js";
import {
  AIClassificationOutput,
  AIIntakePlannerOutput,
  PlannerContextCandidate,
  cleanTranscription,
  describeImage,
  embedText,
  embeddingModel,
  planIntakeWithContext,
  transcribeAudio,
  callClaude
} from "./openai.js";
import { addDaysLocal } from "../utils/dates.js";
import { getFileBuffer, sendText, sendTextWithButtons, sendTypingIndicator } from "./telegram.js";
import { TelegramMessage } from "../types/telegram.js";
import {
  ContinuationContextItem,
  createPendingDecision,
  ensureProject,
  getPendingDecision,
  insertProactiveRun,
  insertInboxItem,
  isDuplicateMessage,
  listCategories,
  listOpenContextCandidates,
  listOpenActionItems,
  loadVocabularyTerms,
  mergeIntoInboxItem,
  loadWeeklySummary,
  resolvePendingDecision,
  snoozeInboxItem,
  textSearchItemsForChat,
  updateInboxItemFields,
  updateInboxItemOwnerById,
  updateInboxItemStatus,
  updateInboxItemStoragePath,
  upsertItemEmbedding,
  upsertCategory,
  upsertChatSubscription,
  insertItemAttachment,
  getActiveCosConversation,
  completeCosConversation
} from "../db/schema.js";
import { buildOpenActionsMessage, buildWeeklyMessage } from "./reports.js";
import { appendProjectStatus, storeIncomingMedia, writeActionBoard, writeKnowledgeNote } from "./storage.js";
import { InputType, ProcessingStage } from "../types/domain.js";
import { log } from "../utils/logger.js";
import { containsJarbasKeyword, stripJarbasKeyword, routeToAgent, containsMartaKeyword, stripMartaKeyword, routeToMarta, handleMartaFollowUpFromIntake, smartRouteMessage } from "../agents/router.js";
import { cosineSimilarity } from "../utils/math.js";

interface ExtractedContent {
  inputType: InputType;
  rawText: string;
  normalizedText: string;
  /** Raw audio transcription before cleanup — used for keyword detection (cleanTranscription may strip vocatives). */
  rawTranscription?: string;
  /** Full text extracted from PDF – used only for AI classification, not persisted as content. */
  pdfExtractedText?: string;
  mediaPath?: string;
  metadata: Record<string, unknown>;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".aac", ".flac", ".webm"]);

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

// ── In-memory dedup cache ─────────────────────────────────────────────
// Covers ALL routes (Marta, Jarbas, Second Brain) — unlike the DB-based
// isDuplicateMessage which only checks inbox_items.
// Key: "chatId:messageId", auto-expires after 10 minutes.
const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function markMessageProcessed(chatId: number, messageId: number): void {
  if (messageId <= 0) return;
  const key = `${chatId}:${messageId}`;
  processedMessages.set(key, Date.now());
  // Lazy cleanup: prune expired entries when cache grows large
  if (processedMessages.size > 500) {
    const now = Date.now();
    for (const [k, ts] of processedMessages) {
      if (now - ts > DEDUP_TTL_MS) processedMessages.delete(k);
    }
  }
}

function isMessageAlreadyProcessed(chatId: number, messageId: number): boolean {
  if (messageId <= 0) return false;
  const key = `${chatId}:${messageId}`;
  const ts = processedMessages.get(key);
  if (ts === undefined) return false;
  if (Date.now() - ts > DEDUP_TTL_MS) {
    processedMessages.delete(key);
    return false;
  }
  return true;
}

function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) || [];
}

async function fetchUrlMetadata(url: string): Promise<{ title?: string; description?: string; url: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SecondBrain/1.0)",
        "Accept": "text/html"
      },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { url };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return { url };
    }

    // Read only first 32KB to avoid downloading huge pages
    const reader = response.body?.getReader();
    if (!reader) {
      return { url };
    }
    let html = "";
    const decoder = new TextDecoder();
    let bytesRead = 0;
    const maxBytes = 32768;

    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.length;
    }
    reader.cancel().catch(() => {});

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim()?.replace(/\s+/g, " ");

    const descMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const ogDescMatch =
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);

    return {
      title: title || undefined,
      description: (descMatch?.[1] || ogDescMatch?.[1])?.trim() || undefined,
      url
    };
  } catch {
    return { url };
  }
}

async function enrichTextWithUrls(text: string): Promise<{ enrichedText: string; urls: Array<{ title?: string; description?: string; url: string }> }> {
  const urls = extractUrls(text);
  if (urls.length === 0) {
    return { enrichedText: text, urls: [] };
  }

  const metadataResults = await Promise.all(
    urls.slice(0, 3).map((u) => fetchUrlMetadata(u))
  );
  const validMetadata = metadataResults.filter((m): m is NonNullable<typeof m> => m !== null);

  if (validMetadata.length === 0) {
    return { enrichedText: text, urls: [] };
  }

  const enrichmentLines = validMetadata.map((m) => {
    const parts = [`Link: ${m.url}`];
    if (m.title) parts.push(`Titulo: ${m.title}`);
    if (m.description) parts.push(`Descricao: ${m.description}`);
    return parts.join("\n");
  });

  return {
    enrichedText: `${text}\n\n---\n${enrichmentLines.join("\n\n")}`,
    urls: validMetadata
  };
}

const CONTINUATION_MARKERS = [
  "sobre o tema anterior",
  "sobre o assunto anterior",
  "complementando",
  "continuando",
  "como falei",
  "em complemento",
  "sobre isso",
  "sobre aquilo",
  "esse tema",
  "esse assunto",
  "voltando ao",
  "voltando no",
  "a respeito do",
  "a respeito da",
  "falando nisso",
  "ainda sobre",
  "mais sobre",
  "outra coisa sobre",
  "aproveitando",
  "lembrando que",
  "esqueci de falar",
  "esqueci de mencionar",
  "ah e tambem",
  "alias",
  "so pra complementar",
  "atualizando",
  "update sobre",
  "novidade sobre"
];

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
    const { enrichedText, urls } = await enrichTextWithUrls(rawText);
    return {
      inputType,
      rawText,
      normalizedText: enrichedText,
      metadata: urls.length > 0 ? { urls, hasLinks: true } : {}
    };
  }

  if (inputType === "audio") {
    const fileId = message.voice?.file_id || message.audio?.file_id || message.document?.file_id;
    if (!fileId) {
      return { inputType, rawText, normalizedText: rawText, metadata: { error: "missing_audio_id" } };
    }

    let buffer: Buffer;
    let filePath: string;
    try {
      const fileResult = await getFileBuffer(fileId);
      buffer = fileResult.buffer;
      filePath = fileResult.filePath;
    } catch (error) {
      log.error("Failed to download audio from Telegram", { fileId, error });
      return {
        inputType,
        rawText,
        normalizedText: rawText || "Audio recebido mas download do Telegram falhou.",
        metadata: { error: "telegram_download_failed", fileId }
      };
    }

    const ext = path.extname(filePath) || ".ogg";
    const fileName = message.audio?.file_name || message.document?.file_name || `audio${ext}`;
    const mimeType = message.voice?.mime_type || message.audio?.mime_type || message.document?.mime_type || "audio/ogg";

    let mediaPath: string | undefined;
    try {
      mediaPath = await storeIncomingMedia(fileName, buffer);
    } catch (error) {
      log.error("Failed to store audio file on disk", { fileName, error });
    }

    // Build dynamic vocabulary prompt for Whisper from existing cards
    const vocabularyTerms = await loadVocabularyTerms(80).catch(() => [] as string[]);
    const whisperPrompt = vocabularyTerms.length > 0
      ? vocabularyTerms.join(", ")
      : undefined;

    const audioDurationSeconds = message.voice?.duration || message.audio?.duration || 0;

    let rawTranscription: string | null = null;
    try {
      rawTranscription = await transcribeAudio({
        buffer,
        fileName,
        mimeType,
        whisperPrompt
      });
    } catch (error) {
      log.error("Unexpected transcribeAudio crash", { fileName, mimeType, error });
    }
    if (!rawTranscription) {
      log.warn("Audio received without transcription", {
        fileName,
        filePath,
        mimeType,
        hasCaption: Boolean(rawText)
      });
    }

    // Clean up messy transcription: remove filler words, fix punctuation,
    // and insert --- markers at topic transitions to help the planner split.
    const transcription = rawTranscription
      ? await cleanTranscription(rawTranscription)
      : null;

    const normalizedText =
      [rawText, transcription].filter(Boolean).join("\n").trim() || "Audio recebido sem transcricao automatica.";

    return {
      inputType,
      rawText,
      normalizedText,
      rawTranscription: rawTranscription || undefined,
      mediaPath,
      metadata: {
        telegramFilePath: filePath,
        mimeType,
        transcriptionAvailable: Boolean(transcription),
        audioDurationSeconds
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

    // For PDFs: keep normalizedText light (caption only + file reference).
    // The full extracted text goes to pdfExtractedText for AI classification.
    const pdfRef = inputType === "pdf" && mediaPath
      ? `[Documento PDF armazenado: ${originalName}]`
      : "";
    const normalizedText = inputType === "pdf"
      ? [rawText, pdfRef].filter(Boolean).join("\n").trim()
      : [rawText, extractedText].filter(Boolean).join("\n").trim();

    return {
      inputType,
      rawText,
      normalizedText,
      pdfExtractedText: inputType === "pdf" && extractedText ? extractedText : undefined,
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

function actionTitleFallback(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, 12)
    .join(" ")
    .slice(0, 140);
}

function stageFromClassification(action: string): ProcessingStage {
  if (action === "NONE") {
    return "interpretado";
  }
  return "planejado";
}

const AUTO_DECISION_THRESHOLD = 0.72;
const PENDING_OWNER_TOKEN = "PENDENTE_DONO";

interface PendingRelationPayload {
  sourceMessageId: number;
  extracted: ExtractedContent;
  plan: AIIntakePlannerOutput;
  contextCandidates: PlannerContextCandidate[];
}


function lexicalOverlapScore(a: string, b: string): number {
  // Accept tokens with 3+ chars to catch names (Joao, TI, ERP) and short keywords
  const tokenize = (text: string) => new Set(
    text
      .toLowerCase()
      .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) {
      overlap += 1;
    }
  }
  // Use min instead of max for a more generous overlap ratio
  return overlap / Math.min(ta.size, tb.size);
}

function buildCandidateSearchText(candidate: ContinuationContextItem): string {
  return [
    candidate.categoryName,
    candidate.actionTitle || "",
    candidate.summaryPtBr,
    candidate.actionDetails || "",
    candidate.normalizedText,
    candidate.nextStep || "",
    candidate.followUpWith || ""
  ]
    .join("\n")
    .trim();
}

function buildIncomingSearchText(extracted: ExtractedContent): string {
  // For PDFs, use the extracted text for similarity search (not the short reference in normalizedText)
  const textContent = extracted.pdfExtractedText || extracted.normalizedText;
  return [extracted.rawText, textContent].filter(Boolean).join("\n").trim();
}

function isLikelyContinuationText(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return CONTINUATION_MARKERS.some((marker) => normalized.includes(marker));
}

function normalizePlannerCard(card: AIClassificationOutput): AIClassificationOutput {
  return {
    ...card,
    actionTitle: (card.actionTitle?.trim() || "Definir acao objetiva").slice(0, 140),
    nextStepPtBr: card.nextStepPtBr?.trim() || "Executar o primeiro passo concreto e atualizar o status.",
    followUpWithPtBr: card.followUpWithPtBr?.trim() || PENDING_OWNER_TOKEN,
    actionDetails: card.actionDetails?.trim() || card.summaryPtBr
  };
}

function normalizeDecisionMode(mode: string | undefined): "merge" | "new" | "split" {
  if (mode === "merge" || mode === "new" || mode === "split") {
    return mode;
  }
  return "new";
}

function parseOwnerCommand(text: string): { itemId: number; owner: string } | null {
  const match = text.trim().match(/^\/owner\s+(\d+)\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const itemId = Number(match[1]);
  const owner = match[2].trim();
  if (!Number.isInteger(itemId) || itemId <= 0 || !owner) {
    return null;
  }
  return { itemId, owner };
}

function parseRelationDecisionAnswer(text: string): { mode: "merge" | "new"; targetItemId?: number } | null {
  const normalized = text.trim().toLowerCase();
  const mergeMatch = normalized.match(/^(1|complemento)(?:\s+#?(\d+))?$/i);
  if (mergeMatch) {
    const target = mergeMatch[2] ? Number(mergeMatch[2]) : undefined;
    return { mode: "merge", targetItemId: Number.isInteger(target) ? target : undefined };
  }
  if (/^(2|novo)$/.test(normalized)) {
    return { mode: "new" };
  }
  return null;
}

function isOwnerMissing(value?: string): boolean {
  if (!value) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "responsavel interno" || normalized === "definir responsavel e cobrar atualizacao" || normalized === PENDING_OWNER_TOKEN.toLowerCase();
}

async function rankContextCandidates(chatId: number, extracted: ExtractedContent): Promise<PlannerContextCandidate[]> {
  const candidates = await listOpenContextCandidates(chatId, 30);
  if (candidates.length === 0) {
    return [];
  }

  const incomingText = buildIncomingSearchText(extracted);
  const incomingEmbedding = await embedText(incomingText);

  if (incomingEmbedding) {
    const missingEmbeddings = candidates.filter((item) => !item.embedding).slice(0, 8);
    for (const candidate of missingEmbeddings) {
      const candidateEmbedding = await embedText(buildCandidateSearchText(candidate));
      if (candidateEmbedding) {
        candidate.embedding = candidateEmbedding;
        await upsertItemEmbedding({
          itemId: candidate.id,
          chatId: candidate.chatId,
          model: embeddingModel(),
          vector: candidateEmbedding
        });
      }
    }
  }

  const ranked = candidates
    .map((candidate) => {
      const lexical = lexicalOverlapScore(incomingText, buildCandidateSearchText(candidate));
      const semantic = incomingEmbedding && candidate.embedding ? cosineSimilarity(incomingEmbedding, candidate.embedding) : 0;
      const continuationBoost = isLikelyContinuationText(incomingText) ? 0.15 : 0;
      // Weighted combination instead of max — both signals matter
      const combinedScore = semantic > 0
        ? semantic * 0.6 + lexical * 0.4
        : lexical;
      // Recency boost: items from last 24h get a small boost (likely same conversation)
      const ageHours = (Date.now() - new Date(candidate.createdAt).getTime()) / (1000 * 60 * 60);
      const recencyBoost = ageHours < 24 ? 0.05 : ageHours < 72 ? 0.02 : 0;
      const score = combinedScore + continuationBoost + recencyBoost;

      return {
        id: candidate.id,
        categoryName: candidate.categoryName,
        summaryPtBr: candidate.summaryPtBr,
        actionTitle: candidate.actionTitle,
        actionDetails: candidate.actionDetails,
        action: candidate.action,
        priority: candidate.priority,
        nextStep: candidate.nextStep,
        followUpWith: candidate.followUpWith,
        dueAt: candidate.dueAt,
        similarityScore: Number(score.toFixed(4))
      } satisfies PlannerContextCandidate;
    })
    .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0));

  return ranked.slice(0, 10);
}

async function persistCard(params: {
  chatId: number;
  messageId: number;
  extracted: ExtractedContent;
  card: AIClassificationOutput;
  metadata: Record<string, unknown>;
}): Promise<{ itemId: number; categoryName: string; summaryPtBr: string; followUpWith?: string }> {
  const card = normalizePlannerCard(params.card);

  log.info("pipeline:persist_upsertCategory", { categoryName: card.categoryName });
  const categoryId = await upsertCategory(card.categoryName, card.categoryDescription, card.shouldCreateCategory ? "agent" : "reuse");
  log.info("pipeline:persist_upsertCategory_done", { categoryId });

  const processingStage = stageFromClassification(card.action);
  log.info("pipeline:persist_insertInboxItem", {
    action: card.action,
    priority: card.priority,
    bucket: card.bucket,
    hasDueAt: Boolean(card.dueDateISO),
    confidence: card.confidence
  });
  const itemId = await insertInboxItem({
    chatId: params.chatId,
    messageId: params.messageId,
    inputType: params.extracted.inputType,
    rawText: params.extracted.rawText,
    normalizedText: params.extracted.normalizedText,
    summaryPtBr: card.summaryPtBr,
    categoryId,
    bucket: card.bucket,
    action: card.action,
    priority: card.priority,
    actionTitle: card.actionTitle,
    actionDetails: card.actionDetails,
    dueAt: card.dueDateISO ?? undefined,
    nextStep: card.nextStepPtBr,
    followUpWith: card.followUpWithPtBr,
    processingStage,
    confidence: card.confidence,
    storagePath: params.extracted.mediaPath,
    metadata: params.metadata
  });
  log.info("pipeline:persist_insertInboxItem_done", { itemId });

  // Track attachment in dedicated table for multi-file support
  if (params.extracted.mediaPath) {
    log.info("pipeline:persist_insertAttachment", { itemId, mediaPath: params.extracted.mediaPath });
    await insertItemAttachment({
      itemId,
      storagePath: params.extracted.mediaPath,
      fileName: path.basename(params.extracted.mediaPath),
      inputType: params.extracted.inputType
    });
  }

  const sourceLabel = `telegram:${params.chatId}#${params.messageId}`;
  log.info("pipeline:persist_writeKnowledgeNote", { itemId });
  const notePath = await writeKnowledgeNote({
    classification: {
      summaryPtBr: card.summaryPtBr,
      categoryName: card.categoryName,
      categoryDescription: card.categoryDescription,
      bucket: card.bucket,
      action: card.action,
      actionTitle: card.actionTitle,
      actionDetails: card.actionDetails,
      nextStepPtBr: card.nextStepPtBr,
      followUpWithPtBr: card.followUpWithPtBr,
      dueDateISO: card.dueDateISO ?? undefined,
      priority: card.priority,
      confidence: card.confidence,
      shouldCreateCategory: card.shouldCreateCategory,
      followUpQuestionPtBr: card.followUpQuestionPtBr
    },
    rawText: params.extracted.rawText,
    normalizedText: params.extracted.normalizedText,
    createdAt: new Date(),
    sourceLabel,
    itemId,
    mediaPath: params.extracted.mediaPath,
    inputType: params.extracted.inputType
  });
  log.info("pipeline:persist_writeKnowledgeNote_done", { notePath });

  // When the item has an original media file (PDF, audio, image, etc.), keep
  // storage_path pointing to it so the dashboard can serve it.  Only overwrite
  // with the knowledge-note path for text-only items that have no media.
  if (!params.extracted.mediaPath) {
    await updateInboxItemStoragePath(itemId, notePath);
  }

  // For embeddings, use the full PDF text (when available) for better similarity matching
  log.info("pipeline:persist_embedText", { itemId });
  const textForEmbedding = params.extracted.pdfExtractedText || params.extracted.normalizedText;
  const embedding = await embedText(`${card.summaryPtBr}\n${textForEmbedding}`);
  if (embedding) {
    log.info("pipeline:persist_upsertEmbedding", { itemId, vectorLen: embedding.length });
    await upsertItemEmbedding({
      itemId,
      chatId: params.chatId,
      model: embeddingModel(),
      vector: embedding
    });
  }
  log.info("pipeline:persist_embedding_done", { itemId, hasEmbedding: Boolean(embedding) });

  if (card.action === "CREATE_PROJECT") {
    const projectTitle = card.actionTitle || actionTitleFallback(card.summaryPtBr);
    await ensureProject({
      title: projectTitle,
      categoryId,
      sourceItemId: itemId,
      notes: card.actionDetails
    });
    await appendProjectStatus(projectTitle, "active", sourceLabel);
  }

  return {
    itemId,
    categoryName: card.categoryName,
    summaryPtBr: card.summaryPtBr,
    followUpWith: card.followUpWithPtBr ?? undefined
  };
}

async function executePlan(params: {
  chatId: number;
  messageId: number;
  extracted: ExtractedContent;
  plan: AIIntakePlannerOutput;
  forcedMode?: "merge" | "new";
  forcedTargetItemId?: number;
}): Promise<void> {
  const mode = params.forcedMode || normalizeDecisionMode(params.plan.decision.mode);
  const cards = params.plan.cards.map(normalizePlannerCard);
  log.info("pipeline:executePlan_start", { mode, cardCount: cards.length });

  const audioWithoutTranscription =
    params.extracted.inputType === "audio" && params.extracted.metadata.transcriptionAvailable === false && !params.extracted.rawText;
  const baseMetadata = {
    ...params.extracted.metadata,
    plannerDecision: params.plan.decision,
    splitCount: cards.length
  };

  const createdItems: Array<{ itemId: number; followUpWith?: string }> = [];

  if (mode === "merge" && cards.length > 0) {
    const targetId = params.forcedTargetItemId || params.plan.decision.targetItemId;
    if (!targetId) {
      throw new Error("merge_target_missing");
    }
    const mergeCard = cards[0];

    // Validate: detect poor AI merge output and skip destructive fields
    const VAGUE_MERGE_PHRASES = [
      "complemento da mensagem",
      "complemento sobre",
      "atualizacao sobre o tema",
      "informacao adicional sobre",
      "continuacao da mensagem",
      "complementando mensagem",
      "update sobre",
      "sobre o assunto anterior"
    ];
    const summaryIsVague = VAGUE_MERGE_PHRASES.some(
      (phrase) => mergeCard.summaryPtBr.toLowerCase().includes(phrase)
    ) || mergeCard.summaryPtBr.length < 30;

    if (summaryIsVague) {
      log.warn("AI merge summary is vague or too short — appending incoming text instead of replacing", {
        targetId,
        aiSummary: mergeCard.summaryPtBr,
        incomingTextLength: params.extracted.normalizedText.length
      });
      // Fall back to appending a condensed version instead of replacing with vague text
      mergeCard.summaryPtBr = params.extracted.normalizedText.slice(0, 300);
    }

    const categoryId = await upsertCategory(
      mergeCard.categoryName,
      mergeCard.categoryDescription,
      mergeCard.shouldCreateCategory ? "agent" : "reuse"
    );
    const merged = await mergeIntoInboxItem({
      chatId: params.chatId,
      targetItemId: targetId,
      categoryId,
      bucket: mergeCard.bucket,
      action: mergeCard.action,
      summaryPtBr: mergeCard.summaryPtBr,
      actionTitle: mergeCard.actionTitle,
      actionDetails: mergeCard.actionDetails,
      priority: mergeCard.priority,
      dueAt: mergeCard.dueDateISO ?? undefined,
      nextStep: mergeCard.nextStepPtBr,
      followUpWith: mergeCard.followUpWithPtBr,
      normalizedTextAppend: params.extracted.normalizedText,
      rawTextAppend: params.extracted.rawText
    });
    if (!merged) {
      throw new Error(`merge_target_not_found:${targetId}`);
    }

    // Attach incoming file to the existing card
    if (params.extracted.mediaPath) {
      await insertItemAttachment({
        itemId: targetId,
        storagePath: params.extracted.mediaPath,
        fileName: path.basename(params.extracted.mediaPath),
        inputType: params.extracted.inputType
      });
    }

    const mergeTextForEmbedding = params.extracted.pdfExtractedText || params.extracted.normalizedText;
    const mergedEmbedding = await embedText(`${mergeCard.summaryPtBr}\n${mergeTextForEmbedding}`);
    if (mergedEmbedding) {
      await upsertItemEmbedding({
        itemId: targetId,
        chatId: params.chatId,
        model: embeddingModel(),
        vector: mergedEmbedding
      });
    }

    const mergeResponse = [
      `Integrado ao card #${targetId}:`,
      `${mergeCard.summaryPtBr}`,
      mergeCard.actionTitle ? `Acao: ${mergeCard.actionTitle}` : null,
      mergeCard.nextStepPtBr ? `Proximo passo: ${mergeCard.nextStepPtBr}` : null,
      `Prioridade: ${mergeCard.priority}`,
      mergeCard.dueDateISO ? `Prazo: ${mergeCard.dueDateISO}` : null,
      params.extracted.mediaPath ? `Arquivo anexado ao card.` : null
    ].filter(Boolean).join("\n");
    await sendText(params.chatId, mergeResponse);

    if (isOwnerMissing(mergeCard.followUpWithPtBr)) {
      await sendText(params.chatId, `Card #${targetId} sem dono claro. Responda: /owner ${targetId} NomeDoResponsavel`);
    }
  } else {
    for (const card of cards) {
      const created = await persistCard({
        chatId: params.chatId,
        messageId: params.messageId,
        extracted: params.extracted,
        card,
        metadata: {
          ...baseMetadata,
          audioWithoutTranscription,
          processingError: audioWithoutTranscription
            ? "Transcricao indisponivel. Classificacao feita com conteudo parcial."
            : undefined
        }
      });
      createdItems.push(created);
    }

    for (const [index, item] of createdItems.entries()) {
      const card = cards[index];
      const cardResponse = [
        `Card #${item.itemId} registrado:`,
        `${card.summaryPtBr}`,
        card.actionTitle ? `Acao: ${card.actionTitle}` : null,
        card.nextStepPtBr ? `Proximo passo: ${card.nextStepPtBr}` : null,
        `Prioridade: ${card.priority}`,
        card.dueDateISO ? `Prazo: ${card.dueDateISO}` : null,
        card.followUpWithPtBr && card.followUpWithPtBr !== PENDING_OWNER_TOKEN ? `Responsavel: ${card.followUpWithPtBr}` : null
      ].filter(Boolean).join("\n");
      await sendText(params.chatId, cardResponse);
    }
    if (mode === "split" && cards.length > 1) {
      await sendText(params.chatId, `Separei em ${cards.length} cards independentes para facilitar o acompanhamento.`);
    }

    for (const item of createdItems) {
      if (isOwnerMissing(item.followUpWith)) {
        await sendText(params.chatId, `Card #${item.itemId} sem dono claro. Responda: /owner ${item.itemId} NomeDoResponsavel`);
      }
    }
  }

  await writeActionBoard(await listOpenActionItems(undefined, 40));
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

function parseSnoozeCommand(text: string): { itemId: number; days: number } | null {
  const match = text.trim().match(/^\/snooze\s+(\d+)\s+(\d+)$/i);
  if (!match) {
    return null;
  }
  const itemId = Number(match[1]);
  const days = Number(match[2]);
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(days) || days <= 0 || days > 90) {
    return null;
  }
  return { itemId, days };
}

function parseEditCommand(text: string): { itemId: number; field: string; value: string } | null {
  const match = text.trim().match(/^\/edit\s+(\d+)\s+(\w+)\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const itemId = Number(match[1]);
  const field = match[2].toLowerCase();
  const value = match[3].trim();
  if (!Number.isInteger(itemId) || itemId <= 0 || !value) {
    return null;
  }
  const allowedFields = ["titulo", "prioridade", "prazo", "proximo", "responsavel"];
  if (!allowedFields.includes(field)) {
    return null;
  }
  return { itemId, field, value };
}

function parseBuscaCommand(text: string): string | null {
  const match = text.trim().match(/^\/busca\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const query = match[1].trim();
  return query.length >= 2 ? query : null;
}

async function handleTextCommand(chatId: number, text: string): Promise<boolean> {
  const normalized = text.trim();

  // Cancel active Marta conversation
  if (normalized === "/cancelar") {
    const activeConv = await getActiveCosConversation(chatId);
    const pendingDecision = await getPendingDecision(chatId, "relation");
    if (activeConv) {
      await completeCosConversation(activeConv.id);
    }
    if (pendingDecision) {
      await resolvePendingDecision(pendingDecision.id);
    }
    if (activeConv || pendingDecision) {
      const parts: string[] = [];
      if (activeConv) parts.push("conversa ativa");
      if (pendingDecision) parts.push("decisao pendente");
      await sendText(chatId, `Cancelado: ${parts.join(" e ")}. Pode enviar normalmente.`);
    } else {
      await sendText(chatId, "Nenhuma conversa ativa ou decisao pendente para cancelar.");
    }
    return true;
  }

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
        "- /snooze <id> <dias> -> adia item por N dias",
        "- /edit <id> <campo> <valor> -> edita campo do item",
        "  campos: titulo, prioridade, prazo, proximo, responsavel",
        "- /busca <termo> -> busca nos seus items",
        "- /owner <id> Nome -> define dono/responsavel do card",
        "- /weekly -> gera resumo semanal agora",
        "- /cancelar -> cancela conversa ativa com Marta"
      ].join("\n")
    );
    return true;
  }

  if (normalized === "/prioridades") {
    const items = await listOpenActionItems(chatId, 12);
    const msg = buildOpenActionsMessage(items);
    // Add quick-action buttons for top 3 items
    const topItems = items.filter((i) => i.action !== "NONE").slice(0, 3);
    if (topItems.length > 0) {
      const buttons = topItems.map((item) => [
        { text: `✅ #${item.id}`, callback_data: `done:${item.id}` },
        { text: `⏰ #${item.id}`, callback_data: `snooze:${item.id}` }
      ]);
      await sendTextWithButtons(chatId, msg, buttons);
    } else {
      await sendText(chatId, msg);
    }
    return true;
  }

  const ownerCommand = parseOwnerCommand(normalized);
  if (ownerCommand) {
    const updated = await updateInboxItemOwnerById(ownerCommand.itemId, ownerCommand.owner);
    if (updated) {
      await writeActionBoard(await listOpenActionItems(undefined, 40));
      await sendText(chatId, `Owner atualizado no card #${ownerCommand.itemId}: ${ownerCommand.owner}`);
    } else {
      await sendText(chatId, `Nao encontrei card #${ownerCommand.itemId} para atualizar owner.`);
    }
    return true;
  }

  const doneId = parseDoneCommand(normalized);
  if (doneId !== null) {
    const updated = await updateInboxItemStatus(chatId, doneId, "done");
    if (updated) {
      await writeActionBoard(await listOpenActionItems(undefined, 40));
      // Melhoria 9: Reflection on /done
      const reflection = await callClaude({
        system: "Voce e um assistente pessoal. O usuario acabou de concluir uma tarefa. Gere uma mensagem curta (2-3 frases) de parabens e, se possivel, sugira um proximo passo relacionado. Responda em portugues brasileiro.",
        userMessage: `Tarefa concluida: item #${doneId}`,
        model: "fast",
        maxTokens: 200
      });
      const msg = reflection
        ? `Item #${doneId} marcado como concluido.\n\n${reflection}`
        : `Item #${doneId} marcado como concluido.`;
      await sendText(chatId, msg);
    } else {
      await sendText(chatId, `Nao encontrei item aberto com id #${doneId} neste chat.`);
    }
    return true;
  }

  // /snooze <id> <dias>
  const snoozeCmd = parseSnoozeCommand(normalized);
  if (snoozeCmd) {
    const untilDate = addDaysLocal(snoozeCmd.days);
    const updated = await snoozeInboxItem(chatId, snoozeCmd.itemId, untilDate);
    if (updated) {
      await sendText(chatId, `Item #${snoozeCmd.itemId} adiado ate ${untilDate}.`);
    } else {
      await sendText(chatId, `Nao encontrei item aberto #${snoozeCmd.itemId} neste chat.`);
    }
    return true;
  }

  // /edit <id> <campo> <valor>
  const editCmd = parseEditCommand(normalized);
  if (editCmd) {
    const fieldMap: Record<string, string> = {
      titulo: "actionTitle",
      prioridade: "priority",
      prazo: "dueAt",
      proximo: "nextStep",
      responsavel: "followUpWith"
    };
    const dbField = fieldMap[editCmd.field];
    let value: string | null = editCmd.value;

    if (editCmd.field === "prioridade") {
      const upper = value.toUpperCase();
      if (!["ALTA", "MEDIA", "BAIXA"].includes(upper)) {
        await sendText(chatId, "Prioridade invalida. Use: ALTA, MEDIA ou BAIXA.");
        return true;
      }
      value = upper;
    }

    const fields: Record<string, unknown> = { [dbField]: value };
    const updated = await updateInboxItemFields(editCmd.itemId, fields);
    if (updated) {
      await writeActionBoard(await listOpenActionItems(undefined, 40));
      await sendText(chatId, `Item #${editCmd.itemId}: ${editCmd.field} atualizado para "${value}".`);
    } else {
      await sendText(chatId, `Nao encontrei item #${editCmd.itemId} para atualizar.`);
    }
    return true;
  }

  // /busca <termo>
  const buscaQuery = parseBuscaCommand(normalized);
  if (buscaQuery) {
    const results = await textSearchItemsForChat(chatId, buscaQuery, 8);
    if (results.length === 0) {
      await sendText(chatId, `Nenhum resultado para "${buscaQuery}".`);
    } else {
      const lines = results.map((item) => {
        const priority = item.priority === "ALTA" ? "🔴" : item.priority === "MEDIA" ? "🟡" : "🟢";
        const title = item.actionTitle || item.summaryPtBr.slice(0, 60);
        return `${priority} #${item.id} — ${title}`;
      });
      await sendText(chatId, `Resultados para "${buscaQuery}":\n\n${lines.join("\n")}`);
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

  // Natural language command parsing — detect implicit commands
  const nlCommand = parseNaturalLanguageCommand(normalized);
  if (nlCommand) {
    return handleTextCommand(chatId, nlCommand);
  }

  return false;
}

function parseNaturalLanguageCommand(text: string): string | null {
  const lower = text.toLowerCase().trim();

  // "concluir 123", "feito 123", "terminei 123"
  const doneMatch = lower.match(/^(?:concluir|feito|terminei|finalizar|completar)\s+#?(\d+)$/);
  if (doneMatch) {
    return `/done ${doneMatch[1]}`;
  }

  // "adiar 123 por 3 dias", "snooze 123 5"
  const snoozeMatch = lower.match(/^(?:adiar|postergar|snooze)\s+#?(\d+)\s+(?:por\s+)?(\d+)(?:\s+dias?)?$/);
  if (snoozeMatch) {
    return `/snooze ${snoozeMatch[1]} ${snoozeMatch[2]}`;
  }

  // "buscar X", "procurar X", "pesquisar X"
  const searchMatch = lower.match(/^(?:buscar|procurar|pesquisar|encontrar)\s+(.+)$/);
  if (searchMatch) {
    return `/busca ${searchMatch[1]}`;
  }

  // "minhas prioridades", "o que tenho pra fazer", "acoes abertas"
  if (/^(?:prioridades|minhas prioridades|o que tenho|acoes abertas|tarefas abertas|pendencias)$/.test(lower)) {
    return "/prioridades";
  }

  return null;
}

function isForwardedMessage(msg: TelegramMessage): boolean {
  return Boolean(msg.forward_from || msg.forward_from_chat || msg.forward_date || msg.forward_origin);
}

function getForwardSource(msg: TelegramMessage): string {
  if (msg.forward_origin?.sender_user) {
    const u = msg.forward_origin.sender_user;
    return u.username ? `@${u.username}` : `${u.first_name}${u.last_name ? ' ' + u.last_name : ''}`;
  }
  if (msg.forward_origin?.sender_chat) {
    return msg.forward_origin.sender_chat.title || msg.forward_origin.sender_chat.username || "canal";
  }
  if (msg.forward_from) {
    return msg.forward_from.username ? `@${msg.forward_from.username}` : `${msg.forward_from.first_name}${msg.forward_from.last_name ? ' ' + msg.forward_from.last_name : ''}`;
  }
  if (msg.forward_from_chat) {
    return msg.forward_from_chat.title || msg.forward_from_chat.username || "chat";
  }
  return "desconhecido";
}

async function tryResolvePendingRelation(chatId: number, message: TelegramMessage): Promise<boolean> {
  const text = message.text?.trim();
  if (!text) {
    return false;
  }

  const pending = await getPendingDecision(chatId, "relation");
  if (!pending) {
    return false;
  }

  // If there's an active agent conversation (Marta/Jarbas), ALWAYS yield to it.
  // The pending decision will still be there when the conversation finishes.
  // This prevents answers like "1" or "João" from being misinterpreted as
  // relation decision answers when they are intended for the active conversation.
  const activeConv = await getActiveCosConversation(chatId);
  if (activeConv) {
    log.info("pending_relation:yielding_to_active_conversation", { chatId, convId: activeConv.id, intent: activeConv.intent });
    return false;
  }

  const answer = parseRelationDecisionAnswer(text);
  if (!answer) {
    // If the message is short (likely meant for the pending decision), remind the user.
    // If it's a longer message (likely a new topic), let it fall through to normal processing.
    const wordCount = text.split(/\s+/).length;
    if (wordCount <= 5) {
      await sendText(
        chatId,
        "Ainda estou aguardando sua confirmacao de relacao.\nResponda: `complemento` (ou `complemento #id`) ou `novo`.\nOu use /cancelar para cancelar."
      );
      return true;
    }
    // Longer message — let it fall through to normal processing pipeline
    return false;
  }

  const payload = pending.payload as unknown as Partial<PendingRelationPayload>;
  if (!payload?.sourceMessageId || !payload?.extracted || !payload?.plan) {
    await resolvePendingDecision(pending.id);
    await sendText(chatId, "Nao consegui recuperar a decisao pendente anterior. Pode reenviar o contexto?");
    return true;
  }
  await executePlan({
    chatId,
    messageId: payload.sourceMessageId,
    extracted: payload.extracted,
    plan: payload.plan,
    forcedMode: answer.mode,
    forcedTargetItemId: answer.targetItemId
  });
  await resolvePendingDecision(pending.id);
  return true;
}

// ── Per-chat message serialization ───────────────────────────────────
// Ensures only one message is processed at a time per chat, preventing
// race conditions with conversation state (e.g. two messages both trying
// to handle a Marta follow-up simultaneously).
const chatLocks = new Map<number, Promise<void>>();

function withChatLock(chatId: number, fn: () => Promise<void>): Promise<void> {
  const previous = chatLocks.get(chatId) ?? Promise.resolve();
  const current = previous.then(fn, fn); // Run after previous completes (even on error)
  chatLocks.set(chatId, current);
  // Cleanup: remove the lock entry once done so the map doesn't grow unbounded
  current.finally(() => {
    if (chatLocks.get(chatId) === current) {
      chatLocks.delete(chatId);
    }
  });
  return current;
}

// ── In-flight tracking for graceful shutdown ─────────────────────────

let inflightCount = 0;
const inflightResolvers: Array<() => void> = [];

export function getInflightCount(): number {
  return inflightCount;
}

export function waitForInflight(timeoutMs = 30_000): Promise<void> {
  if (inflightCount <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    inflightResolvers.push(resolve);
    setTimeout(() => {
      const idx = inflightResolvers.indexOf(resolve);
      if (idx >= 0) inflightResolvers.splice(idx, 1);
      resolve();
    }, timeoutMs);
  });
}

function inflightDone(): void {
  inflightCount -= 1;
  if (inflightCount <= 0) {
    for (const resolve of inflightResolvers.splice(0)) {
      resolve();
    }
  }
}

export async function processTelegramMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const messageId = message.message_id;
  inflightCount += 1;

  await withChatLock(chatId, async () => {
    try {
      await processTelegramMessageInner(chatId, messageId, message);
    } catch (error) {
      log.error("processTelegramMessage crashed — notifying user", {
        chatId,
        messageId,
        inputType: inferInputType(message),
        error
      });
      try {
        await sendText(
          chatId,
          "Ocorreu um erro ao processar sua mensagem. Tente novamente ou envie em texto."
        );
      } catch (sendError) {
        log.error("Failed to send error notification to user", { chatId, sendError });
      }
    } finally {
      inflightDone();
    }
  });
}

async function processTelegramMessageInner(
  chatId: number,
  messageId: number,
  message: TelegramMessage
): Promise<void> {
  await upsertChatSubscription(chatId);

  // Dedup check — skip already-processed messages (e.g. webhook retry)
  // In-memory cache covers ALL routes (Marta, Jarbas, Second Brain).
  // DB check covers inbox_items that survived a process restart.
  if (messageId > 0) {
    if (isMessageAlreadyProcessed(chatId, messageId)) {
      log.info("Duplicate message skipped (memory)", { chatId, messageId });
      return;
    }
    if (await isDuplicateMessage(chatId, messageId)) {
      log.info("Duplicate message skipped (db)", { chatId, messageId });
      markMessageProcessed(chatId, messageId);
      return;
    }
    markMessageProcessed(chatId, messageId);
  }

  // ── Routing logic ────────────────────────────────────────────────────
  // Priority order:
  //   1. Pending intake decisions (merge/new) — exact-match responses
  //   2. Text commands (/done, /snooze, etc.)
  //   3. Forwarded messages → auto-save as card (skip agent routing)
  //   4. Explicit agent keywords (Jarbas, Marta) — ALWAYS override active conversations
  //   5. Active Marta conversation follow-up (no keyword needed)
  //   6. Media extraction → audio keyword check → AI classification pipeline

  const rawText = message.text || message.caption || "";

  // Step 1 — Pending relation decisions (exact responses like "complemento" / "novo")
  if (message.text && (await tryResolvePendingRelation(chatId, message))) {
    return;
  }

  // Step 2 — Text commands (/done, /snooze, /busca, etc.)
  if (message.text && (await handleTextCommand(chatId, message.text))) {
    return;
  }

  // Step 3 — Forwarded message → auto-save as card
  // Forwarded messages are captured directly — they should NOT be routed to agents
  // even if the forwarded text contains "Marta" or "Jarbas".
  if (isForwardedMessage(message)) {
    const source = getForwardSource(message);
    const forwardDate = message.forward_date
      ? new Date(message.forward_date * 1000).toISOString()
      : undefined;

    // Extract content through the standard pipeline (handles audio, images, PDFs, etc.)
    const extracted = await extractFromMessage(message);
    if (!extracted.normalizedText) {
      await sendText(chatId, `📩 Mensagem encaminhada de ${source} recebida, mas nao consegui extrair conteudo. Pode enviar um resumo em texto?`);
      return;
    }

    log.info("pipeline:forwarded_message", { chatId, messageId, source, inputType: extracted.inputType });

    await sendTypingIndicator(chatId);

    const knownCategories = await listCategories();
    const contextCandidates = await rankContextCandidates(chatId, extracted);

    const audioDuration = typeof extracted.metadata.audioDurationSeconds === "number"
      ? extracted.metadata.audioDurationSeconds
      : undefined;

    const textForAI = extracted.pdfExtractedText
      ? [extracted.rawText, extracted.pdfExtractedText].filter(Boolean).join("\n").trim()
      : extracted.normalizedText;

    let plan: AIIntakePlannerOutput | null = await planIntakeWithContext({
      text: textForAI,
      inputType: extracted.inputType,
      audioDurationSeconds: audioDuration,
      knownCategories: knownCategories.map((category) => ({
        name: category.name,
        description: category.description
      })),
      openContext: contextCandidates
    });

    if (!plan) {
      const fallback = await classifyContent(textForAI);
      plan = {
        decision: {
          mode: "new",
          confidence: 0.90,
          reasonPtBr: "Mensagem encaminhada — registro automatico."
        },
        cards: [fallback as AIClassificationOutput]
      };
    }

    // Force new card mode for forwarded messages (they are independent captures)
    plan.decision.mode = "new";
    plan.decision.confidence = Math.max(plan.decision.confidence ?? 0, 0.90);

    // Inject forwarded metadata into each card's metadata
    const forwardMetadata = {
      ...extracted.metadata,
      forwarded: true,
      forwardFrom: source,
      forwardDate
    };

    await executePlan({
      chatId,
      messageId,
      extracted: { ...extracted, metadata: forwardMetadata },
      plan
    });

    await sendText(chatId, `📩 Mensagem encaminhada de ${source} capturada!`);
    return;
  }

  // Step 4 — Explicit keyword routing (Jarbas/Marta in text/caption)
  // Keywords ALWAYS take priority over active conversations — lets users escape.
  const textContent = message.text || message.caption || "";
  if (containsJarbasKeyword(textContent)) {
    await routeToAgent(chatId, messageId, stripJarbasKeyword(textContent), message);
    return;
  }

  if (containsMartaKeyword(textContent)) {
    await routeToMarta(chatId, messageId, stripMartaKeyword(textContent), message);
    return;
  }

  // Step 5 — Active Marta/Jarbas conversation follow-up (no keyword required)
  // Handles text, PDFs, images as follow-up responses.
  // Audio is EXCLUDED here — it needs transcription first (handled in Step 6).
  // Audio sent as document (e.g. MP3 attachment) must also be treated as audio
  const isAudioDocument = Boolean(
    message.document?.mime_type?.startsWith("audio/") ||
    (message.document?.file_name && AUDIO_EXTENSIONS.has(path.extname(message.document.file_name).toLowerCase()))
  );
  const hasNonAudioAttachment = Boolean(
    (message.document && !isAudioDocument) || (message.photo && message.photo.length > 0)
  );
  const isAudioMessage = Boolean(message.voice || message.audio || isAudioDocument);
  if (!isAudioMessage && (rawText || hasNonAudioAttachment) && (await handleMartaFollowUpFromIntake(chatId, messageId, rawText, message))) {
    log.info("Marta follow-up handled", { chatId, messageId });
    return;
  }

  // Step 5b — Jarbas active conversation follow-up (no keyword needed)
  // Check if there's an active Jarbas conversation that this message might continue.
  // This covers cases where handleMartaFollowUpFromIntake didn't match (e.g. audio-only).
  if (!isAudioMessage && rawText) {
    const activeConv = await getActiveCosConversation(chatId);
    if (activeConv && activeConv.intent.includes("jarbas") && !containsMartaKeyword(textContent)) {
      const handled = await handleMartaFollowUpFromIntake(chatId, messageId, textContent, message);
      if (handled) {
        log.info("Jarbas follow-up handled", { chatId, messageId });
        return;
      }
    }
  }

  // Step 5c — Smart routing (no keyword, no active conversation)
  // AI classifier determines if message should go to an agent even without explicit keyword.
  // Only runs for text messages with enough content to classify.
  if (!isAudioMessage && rawText && rawText.length >= 5) {
    const routeResult = await smartRouteMessage(rawText, chatId);
    if (routeResult.agent === "marta" && routeResult.confidence >= 0.75) {
      log.info("smart_route:marta", { chatId, messageId, confidence: routeResult.confidence });
      await routeToMarta(chatId, messageId, rawText, message);
      return;
    }
    if (routeResult.agent === "jarbas" && routeResult.confidence >= 0.75) {
      log.info("smart_route:jarbas", { chatId, messageId, confidence: routeResult.confidence });
      await routeToAgent(chatId, messageId, rawText, message);
      return;
    }
  }

  // Step 6 — Content extraction (audio transcription, PDF text, image description)
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

  log.info("pipeline:extract_done", { inputType: extracted.inputType, textLen: extracted.normalizedText.length });

  // Step 7 — Audio transcription keyword check (Jarbas/Marta in spoken words)
  if (extracted.inputType === "audio") {
    const rawCheck = extracted.rawTranscription || "";
    const normCheck = extracted.normalizedText;
    if (containsJarbasKeyword(rawCheck) || containsJarbasKeyword(normCheck)) {
      const agentInput = containsJarbasKeyword(normCheck)
        ? stripJarbasKeyword(normCheck)
        : stripJarbasKeyword(rawCheck);
      await routeToAgent(chatId, messageId, agentInput, message);
      return;
    }

    if (containsMartaKeyword(rawCheck) || containsMartaKeyword(normCheck)) {
      const martaInput = containsMartaKeyword(normCheck)
        ? stripMartaKeyword(normCheck)
        : stripMartaKeyword(rawCheck);
      await routeToMarta(chatId, messageId, martaInput, message);
      return;
    }

    // Audio without keyword but active Marta conversation → treat as follow-up
    // (audio transcription was not available before step 5, so check again now)
    if (await handleMartaFollowUpFromIntake(chatId, messageId, normCheck, message)) {
      log.info("Marta follow-up handled (audio)", { chatId, messageId });
      return;
    }

    // Step 7b — Smart routing for audio (no keyword, no active conversation)
    if (normCheck.length >= 5) {
      const routeResult = await smartRouteMessage(normCheck, chatId);
      if (routeResult.agent === "marta" && routeResult.confidence >= 0.75) {
        log.info("smart_route:marta_audio", { chatId, messageId, confidence: routeResult.confidence });
        await routeToMarta(chatId, messageId, normCheck, message);
        return;
      }
      if (routeResult.agent === "jarbas" && routeResult.confidence >= 0.75) {
        log.info("smart_route:jarbas_audio", { chatId, messageId, confidence: routeResult.confidence });
        await routeToAgent(chatId, messageId, normCheck, message);
        return;
      }
    }
  }

  const knownCategories = await listCategories();
  log.info("pipeline:categories_done", { count: knownCategories.length });

  const contextCandidates = await rankContextCandidates(chatId, extracted);
  log.info("pipeline:candidates_done", { count: contextCandidates.length });

  const audioDuration = typeof extracted.metadata.audioDurationSeconds === "number"
    ? extracted.metadata.audioDurationSeconds
    : undefined;

  // Show typing indicator before the long AI classification call
  await sendTypingIndicator(chatId);

  // For PDFs, send the full extracted text to the AI for classification
  const textForAI = extracted.pdfExtractedText
    ? [extracted.rawText, extracted.pdfExtractedText].filter(Boolean).join("\n").trim()
    : extracted.normalizedText;

  let plan: AIIntakePlannerOutput | null = await planIntakeWithContext({
    text: textForAI,
    inputType: extracted.inputType,
    audioDurationSeconds: audioDuration,
    knownCategories: knownCategories.map((category) => ({
      name: category.name,
      description: category.description
    })),
    openContext: contextCandidates
  });

  if (!plan) {
    log.warn("AI planner returned null on first attempt — retrying once", {
      textLength: textForAI.length,
      inputType: extracted.inputType
    });
    plan = await planIntakeWithContext({
      text: textForAI,
      inputType: extracted.inputType,
      audioDurationSeconds: audioDuration,
      knownCategories: knownCategories.map((category) => ({
        name: category.name,
        description: category.description
      })),
      openContext: contextCandidates
    });
  }

  if (!plan) {
    log.warn("AI planner returned null on retry — falling back to classifyContent", {
      textLength: textForAI.length
    });
    const fallback = await classifyContent(textForAI);
    plan = {
      decision: {
        mode: "new",
        confidence: 0.55,
        reasonPtBr: "Fallback de planejamento por indisponibilidade do planner principal."
      },
      cards: [fallback as AIClassificationOutput]
    };
  }

  log.info("pipeline:plan_done", { mode: plan.decision.mode, confidence: plan.decision.confidence, cards: plan.cards.length });

  const decisionMode = normalizeDecisionMode(plan.decision.mode);

  // --- Smart confidence override ---
  // If there are NO open candidates, this is definitely a new card — skip asking the user.
  // If the AI says "new" and no candidates scored above a meaningful threshold, also auto-register.
  const SIMILAR_CANDIDATE_THRESHOLD = 0.25;
  const hasRelevantCandidates = contextCandidates.some((c) => (c.similarityScore ?? 0) >= SIMILAR_CANDIDATE_THRESHOLD);

  if (contextCandidates.length === 0 || (decisionMode === "new" && !hasRelevantCandidates)) {
    // Force new card — no ambiguity when nothing similar exists
    const originalConfidence = plan.decision.confidence ?? 0;
    plan.decision.mode = "new";
    plan.decision.confidence = Math.max(originalConfidence, 0.90);
    log.info("Auto-registering as new card (no relevant candidates found)", {
      candidateCount: contextCandidates.length,
      hasRelevantCandidates,
      originalConfidence
    });
  }

  const hasLowConfidence = decisionMode !== "split" && (plan.decision.confidence ?? 0) < AUTO_DECISION_THRESHOLD;

  if (hasLowConfidence && hasRelevantCandidates) {
    // Truncate large fields (e.g. pdfExtractedText) to prevent oversized JSONB payloads
    const truncatedExtracted = { ...extracted };
    if (truncatedExtracted.pdfExtractedText && truncatedExtracted.pdfExtractedText.length > 2000) {
      truncatedExtracted.pdfExtractedText = truncatedExtracted.pdfExtractedText.slice(0, 2000) + "...[truncado]";
    }

    await createPendingDecision({
      chatId,
      decisionType: "relation",
      payload: {
        sourceMessageId: messageId,
        extracted: truncatedExtracted,
        plan,
        contextCandidates
      }
    });

    // Build a helpful question showing WHY we think items are similar
    const topCandidatesForDisplay = contextCandidates
      .filter((c) => (c.similarityScore ?? 0) >= SIMILAR_CANDIDATE_THRESHOLD)
      .slice(0, 3);

    const candidateLines = topCandidatesForDisplay.map(
      (c) => {
        const pct = Math.round((c.similarityScore ?? 0) * 100);
        return `  #${c.id} [${c.priority}] ${c.summaryPtBr} (${pct}% similar)`;
      }
    );

    const questionLines = [
      "Encontrei cards parecidos com o que voce mandou:"
    ];

    questionLines.push(
      "",
      ...candidateLines,
      ""
    );
    if (plan.decision.targetItemId) {
      questionLines.push(`Meu palpite: complemento do #${plan.decision.targetItemId}`);
    }
    questionLines.push(
      "",
      `Motivo: ${plan.decision.reasonPtBr || "Topico ou contexto similar"}`,
      "",
      "Responda:",
      "- `complemento` ou `complemento #id` para integrar",
      "- `novo` para criar card separado"
    );

    await sendText(chatId, questionLines.join("\n"));
    return;
  }

  await executePlan({
    chatId,
    messageId,
    extracted,
    plan
  });
}
