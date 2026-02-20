import path from "node:path";
import pdfParse from "pdf-parse";
import { classifyContent } from "./classifier.js";
import {
  AIClassificationOutput,
  AIIntakePlannerOutput,
  PlannerContextCandidate,
  describeImage,
  embedText,
  embeddingModel,
  planIntakeWithContext,
  transcribeAudio
} from "./openai.js";
import { getFileBuffer, sendText } from "./telegram.js";
import { TelegramMessage } from "../types/telegram.js";
import {
  ContinuationContextItem,
  createPendingDecision,
  ensureProject,
  getPendingDecision,
  insertProactiveRun,
  insertInboxItem,
  listCategories,
  listOpenContextCandidates,
  listOpenActionItems,
  mergeIntoInboxItem,
  loadWeeklySummary,
  resolvePendingDecision,
  updateInboxItemOwnerById,
  updateInboxItemStatus,
  updateInboxItemStoragePath,
  upsertItemEmbedding,
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
  "esse assunto"
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

const AUTO_DECISION_THRESHOLD = 0.72;
const PENDING_OWNER_TOKEN = "PENDENTE_DONO";

interface PendingRelationPayload {
  sourceMessageId: number;
  extracted: ExtractedContent;
  plan: AIIntakePlannerOutput;
  contextCandidates: PlannerContextCandidate[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function lexicalOverlapScore(a: string, b: string): number {
  const ta = new Set(
    a
      .toLowerCase()
      .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
  const tb = new Set(
    b
      .toLowerCase()
      .replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
  if (!ta.size || !tb.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(ta.size, tb.size);
}

function buildCandidateSearchText(candidate: ContinuationContextItem): string {
  return [
    candidate.categoryName,
    candidate.summaryPtBr,
    candidate.normalizedText,
    candidate.nextStep || "",
    candidate.followUpWith || ""
  ]
    .join("\n")
    .trim();
}

function buildIncomingSearchText(extracted: ExtractedContent): string {
  return [extracted.rawText, extracted.normalizedText].filter(Boolean).join("\n").trim();
}

function isLikelyContinuationText(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return CONTINUATION_MARKERS.some((marker) => normalized.includes(marker));
}

function normalizePlannerCard(card: AIClassificationOutput): AIClassificationOutput {
  return {
    ...card,
    actionTitle: card.actionTitle?.trim() || "Definir acao objetiva",
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
      const continuationBoost = isLikelyContinuationText(incomingText) ? 0.08 : 0;
      const score = Math.max(lexical * 0.7, semantic) + continuationBoost;

      return {
        id: candidate.id,
        categoryName: candidate.categoryName,
        summaryPtBr: candidate.summaryPtBr,
        action: candidate.action,
        priority: candidate.priority,
        nextStep: candidate.nextStep,
        followUpWith: candidate.followUpWith,
        dueAt: candidate.dueAt,
        similarityScore: Number(score.toFixed(4))
      } satisfies PlannerContextCandidate;
    })
    .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0));

  return ranked.slice(0, 8);
}

async function persistCard(params: {
  chatId: number;
  messageId: number;
  extracted: ExtractedContent;
  card: AIClassificationOutput;
  metadata: Record<string, unknown>;
}): Promise<{ itemId: number; categoryName: string; summaryPtBr: string; followUpWith?: string }> {
  const card = normalizePlannerCard(params.card);
  const categoryId = await upsertCategory(card.categoryName, card.categoryDescription, card.shouldCreateCategory ? "agent" : "reuse");

  const processingStage = stageFromClassification(card.action);
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

  const sourceLabel = `telegram:${params.chatId}#${params.messageId}`;
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
    itemId
  });
  await updateInboxItemStoragePath(itemId, notePath);

  const embedding = await embedText(`${card.summaryPtBr}\n${params.extracted.normalizedText}`);
  if (embedding) {
    await upsertItemEmbedding({
      itemId,
      chatId: params.chatId,
      model: embeddingModel(),
      vector: embedding
    });
  }

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
      normalizedTextAppend: params.extracted.normalizedText
    });
    if (!merged) {
      throw new Error(`merge_target_not_found:${targetId}`);
    }

    const mergedEmbedding = await embedText(`${mergeCard.summaryPtBr}\n${params.extracted.normalizedText}`);
    if (mergedEmbedding) {
      await upsertItemEmbedding({
        itemId: targetId,
        chatId: params.chatId,
        model: embeddingModel(),
        vector: mergedEmbedding
      });
    }

    await sendText(
      params.chatId,
      `Atualização integrada automaticamente ao card #${targetId}.\nResumo atualizado: ${mergeCard.summaryPtBr}`
    );

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

    const createdSummaryLines = createdItems.map((item) => `- Card #${item.itemId} criado.`);
    const splitNotice =
      mode === "split" && cards.length > 1
        ? `Separei automaticamente em ${cards.length} cards para manter execucao clara.`
        : "Registro concluido.";
    await sendText(params.chatId, [splitNotice, ...createdSummaryLines].join("\n"));

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
        "- /owner <id> Nome -> define dono/responsavel do card",
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

async function tryResolvePendingRelation(chatId: number, message: TelegramMessage): Promise<boolean> {
  const text = message.text?.trim();
  if (!text) {
    return false;
  }

  const pending = await getPendingDecision(chatId, "relation");
  if (!pending) {
    return false;
  }

  const answer = parseRelationDecisionAnswer(text);
  if (!answer) {
    await sendText(
      chatId,
      "Ainda estou aguardando sua confirmacao de relacao.\nResponda: `complemento` (ou `complemento #id`) ou `novo`."
    );
    return true;
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

export async function processTelegramMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const messageId = message.message_id;

  await upsertChatSubscription(chatId);

  if (message.text && (await tryResolvePendingRelation(chatId, message))) {
    return;
  }

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

  const knownCategories = await listCategories();
  const contextCandidates = await rankContextCandidates(chatId, extracted);

  let plan: AIIntakePlannerOutput | null = await planIntakeWithContext({
    text: extracted.normalizedText,
    knownCategories: knownCategories.map((category) => ({
      name: category.name,
      description: category.description
    })),
    openContext: contextCandidates
  });

  if (!plan) {
    const fallback = await classifyContent(extracted.normalizedText);
    plan = {
      decision: {
        mode: "new",
        confidence: 0.55,
        reasonPtBr: "Fallback de planejamento por indisponibilidade do planner principal."
      },
      cards: [fallback as AIClassificationOutput]
    };
  }

  const decisionMode = normalizeDecisionMode(plan.decision.mode);
  const hasLowConfidence = decisionMode !== "split" && (plan.decision.confidence ?? 0) < AUTO_DECISION_THRESHOLD;

  if (hasLowConfidence) {
    await createPendingDecision({
      chatId,
      decisionType: "relation",
      payload: {
        sourceMessageId: messageId,
        extracted,
        plan,
        contextCandidates
      }
    });

    const suggestedTarget = plan.decision.targetItemId ? `#${plan.decision.targetItemId}` : "nenhum card especifico";
    await sendText(
      chatId,
      [
        "Estou com baixa confianca para decidir relacao com o historico aberto.",
        `Sugestao atual: ${decisionMode === "merge" ? `complementar ${suggestedTarget}` : "novo card"}.`,
        "Responda agora com:",
        "- `complemento` (ou `complemento #id`)",
        "- `novo`"
      ].join("\n")
    );
    return;
  }

  await executePlan({
    chatId,
    messageId,
    extracted,
    plan
  });
}
