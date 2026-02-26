import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { fileTypeFromBuffer } from "file-type";
import { env } from "../config/env.js";
import { ActionPriority } from "../types/domain.js";
import { log } from "../utils/logger.js";

export interface AIClassificationInput {
  text: string;
  knownCategories: Array<{ name: string; description: string }>;
}

export interface AIClassificationOutput {
  summaryPtBr: string;
  categoryName: string;
  categoryDescription: string;
  bucket: "PROJECTS" | "AREAS" | "RESOURCES" | "RESEARCH" | "ARCHIVE";
  action: "CREATE_PROJECT" | "CREATE_TASK" | "STORE_REFERENCE" | "FOLLOW_UP" | "NONE";
  actionTitle?: string;
  actionDetails?: string;
  nextStepPtBr?: string;
  followUpWithPtBr?: string;
  dueDateISO?: string | null;
  priority: ActionPriority;
  confidence: number;
  shouldCreateCategory: boolean;
  followUpQuestionPtBr?: string;
}

export interface PlannerContextCandidate {
  id: number;
  categoryName: string;
  summaryPtBr: string;
  actionTitle?: string;
  actionDetails?: string;
  action: string;
  priority: ActionPriority;
  nextStep?: string;
  followUpWith?: string;
  dueAt?: string;
  similarityScore?: number;
}

export interface AIIntakePlannerOutput {
  decision: {
    mode: "merge" | "new" | "split";
    confidence: number;
    targetItemId?: number;
    reasonPtBr: string;
  };
  cards: AIClassificationOutput[];
}

// ── Clients ──────────────────────────────────────────────────────────
// Claude handles text generation (classification, planning, vision).
// OpenAI is still used for audio transcription and embeddings.

const anthropicClient = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const openaiClient = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

if (!anthropicClient) {
  log.warn("ANTHROPIC_API_KEY not set — Claude AI is DISABLED. All classification will use keyword fallback only.");
}
if (!openaiClient) {
  log.warn("OPENAI_API_KEY not set — audio transcription and embeddings are DISABLED.");
}

export function hasAI(): boolean {
  return Boolean(anthropicClient);
}

export function embeddingModel(): string {
  return env.OPENAI_EMBED_MODEL;
}

// ── Audio helpers (OpenAI) ───────────────────────────────────────────

const SUPPORTED_AUDIO_EXTENSIONS = new Set([".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".ogg", ".flac"]);
const EXT_TO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".m4a": "audio/x-m4a",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac"
};

function normalizeUploadFileName(fileName: string, mimeType?: string): string {
  const fallbackBase = "audio";
  const trimmed = fileName?.trim() || fallbackBase;
  const lastDot = trimmed.lastIndexOf(".");
  const baseName = (lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed) || fallbackBase;
  const ext = lastDot > 0 ? trimmed.slice(lastDot).toLowerCase() : "";

  if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
    return trimmed;
  }

  if (mimeType === "audio/webm") {
    return `${baseName}.webm`;
  }
  if (mimeType === "audio/flac") {
    return `${baseName}.flac`;
  }
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return `${baseName}.wav`;
  }
  if (mimeType === "audio/mpeg" || mimeType === "audio/mp3") {
    return `${baseName}.mp3`;
  }
  if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a") {
    return `${baseName}.m4a`;
  }

  // Telegram commonly uses .oga for voice notes; OpenAI accepts .ogg.
  return `${baseName}.ogg`;
}

function mimeFromFileName(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) {
    return undefined;
  }
  const ext = fileName.slice(dot).toLowerCase();
  return EXT_TO_MIME[ext];
}

export async function transcribeAudio(params: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
  whisperPrompt?: string;
}): Promise<string | null> {
  if (!openaiClient) {
    return null;
  }

  const fallbackModels = ["gpt-4o-mini-transcribe", "whisper-1"];
  const models = [env.OPENAI_TRANSCRIBE_MODEL, ...fallbackModels].filter(
    (model, index, items) => Boolean(model) && items.indexOf(model) === index
  );
  const detected = await fileTypeFromBuffer(params.buffer).catch(() => undefined);
  const detectedMime = detected?.mime?.startsWith("audio/") ? detected.mime : undefined;
  const detectedExt = detected?.ext ? `.${detected.ext.toLowerCase()}` : undefined;

  const uploadCandidates: Array<{ fileName: string; mimeType: string }> = [];
  const addCandidate = (fileName: string, mimeType?: string) => {
    const normalizedName = normalizeUploadFileName(fileName, mimeType);
    const normalizedMime = mimeType || mimeFromFileName(normalizedName) || "audio/ogg";
    if (!uploadCandidates.find((item) => item.fileName === normalizedName && item.mimeType === normalizedMime)) {
      uploadCandidates.push({ fileName: normalizedName, mimeType: normalizedMime });
    }
  };

  if (detectedExt || detectedMime) {
    addCandidate(`audio${detectedExt || ".ogg"}`, detectedMime);
  }
  addCandidate(params.fileName, params.mimeType);
  addCandidate(normalizeUploadFileName(params.fileName, params.mimeType), params.mimeType || detectedMime);

  try {
    for (const model of models) {
      for (const candidate of uploadCandidates) {
        try {
          const file = await toFile(params.buffer, candidate.fileName, {
            type: candidate.mimeType
          });

          const transcription = await openaiClient.audio.transcriptions.create({
            file,
            model,
            language: "pt",
            ...(params.whisperPrompt ? { prompt: params.whisperPrompt } : {})
          });

          const text = transcription.text?.trim();
          if (text) {
            return text;
          }
        } catch (error) {
          log.warn("Audio transcription attempt failed", {
            model,
            fileName: params.fileName,
            uploadFileName: candidate.fileName,
            uploadMimeType: candidate.mimeType,
            detectedMime,
            detectedExt,
            error
          });
        }
      }
    }
  } catch (error) {
    log.error("Unexpected audio transcription error", { error });
    return null;
  }

  return null;
}

// ── Transcription cleanup (Claude Haiku) ─────────────────────────────

const CLEANUP_MIN_LENGTH = 100;

export async function cleanTranscription(rawTranscription: string): Promise<string> {
  if (!anthropicClient || rawTranscription.length < CLEANUP_MIN_LENGTH) {
    return rawTranscription;
  }

  try {
    const response = await anthropicClient.messages.create({
      model: env.ANTHROPIC_FAST_MODEL,
      max_tokens: 2048,
      system: [
        "Voce recebe a transcricao bruta de um audio de voz em portugues brasileiro.",
        "Sua tarefa e LIMPAR e ESTRUTURAR o texto, sem alterar o significado.",
        "",
        "REGRAS DE LIMPEZA:",
        "- Remova palavras de preenchimento: 'eh', 'tipo', 'tipo assim', 'ne', 'entao', 'assim', 'la', 'sei la', 'sabe', 'ahn', 'hmm', 'bom'.",
        "- Remova repeticoes (quando a pessoa fala a mesma coisa duas vezes seguidas).",
        "- Corrija pontuacao e capitalize inicio de frase.",
        "- Mantenha TODOS os nomes proprios, numeros, datas, valores e informacoes factuais intactos.",
        "- A palavra 'Jarbas' e um comando especial do sistema. NUNCA remova 'Jarbas', mesmo como vocativo (ex: 'Jarbas, faz um artigo'). Mantenha intacta.",
        "- NAO resuma, NAO interprete, NAO adicione informacao. Apenas limpe.",
        "",
        "SEGMENTACAO POR TOPICO (CRITICO):",
        "- Quando detectar mudanca de assunto, pessoa, ou projeto, insira a marcacao exata: ---",
        "- Coloque --- em uma linha separada entre os dois topicos.",
        "- Sinais de mudanca: 'outra coisa', 'alem disso', 'ah e tambem', 'mudando de assunto', ou simplesmente o foco muda para outro tema/pessoa/tarefa.",
        "- Mesmo sem marcador explicito na fala, se o assunto muda, insira ---.",
        "- Se o audio tem apenas UM topico, NAO insira ---.",
        "",
        "EXEMPLO:",
        "Input: 'eh tipo preciso ligar pro Joao ne sobre aquele site sabe e tambem eh outra coisa tenho que revisar o contrato do do fornecedor aquele la o ABC'",
        "Output: 'Preciso ligar pro Joao sobre aquele site.\\n---\\nTenho que revisar o contrato do fornecedor ABC.'",
        "",
        "Retorne APENAS o texto limpo, sem explicacoes."
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: rawTranscription
        }
      ]
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const cleaned = textBlock?.text?.trim();
    if (!cleaned || cleaned.length < rawTranscription.length * 0.3) {
      // Safety: if cleanup removed too much (>70%), keep original
      log.warn("Transcription cleanup removed too much content, keeping original", {
        originalLength: rawTranscription.length,
        cleanedLength: cleaned?.length ?? 0
      });
      return rawTranscription;
    }
    return cleaned;
  } catch (error) {
    log.warn("Transcription cleanup failed, keeping original", { error });
    return rawTranscription;
  }
}

// ── Image description (Claude) ───────────────────────────────────────

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function parseDataUrl(dataUrl: string): { mediaType: ImageMediaType; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mediaType: match[1] as ImageMediaType,
    data: match[2]
  };
}

export async function describeImage(base64DataUrl: string): Promise<string | null> {
  if (!anthropicClient) {
    return null;
  }

  const parsed = parseDataUrl(base64DataUrl);
  if (!parsed) {
    log.error("Image description failed: invalid data URL format");
    return null;
  }

  try {
    const response = await anthropicClient.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extraia o texto e o significado mais relevante desta imagem. Se houver texto em ingles, traduza para portugues. Retorne em texto corrido em Portugues do Brasil."
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: parsed.mediaType,
                data: parsed.data
              }
            }
          ]
        }
      ]
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock?.text?.trim() || null;
  } catch (error) {
    log.error("Image description failed", { error });
    return null;
  }
}

// ── Embeddings (OpenAI) ──────────────────────────────────────────────

// text-embedding-3-small has an 8191 token limit.
// Rough heuristic: 1 token ≈ 4 chars for Portuguese text.
const EMBED_MAX_CHARS = 28_000;

export async function embedText(text: string): Promise<number[] | null> {
  if (!openaiClient) {
    return null;
  }
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const truncated = normalized.length > EMBED_MAX_CHARS
    ? normalized.slice(0, EMBED_MAX_CHARS)
    : normalized;

  try {
    const response = await openaiClient.embeddings.create({
      model: env.OPENAI_EMBED_MODEL,
      input: truncated
    });
    const vector = response.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : null;
  } catch (error) {
    log.warn("Embedding generation failed", { error });
    return null;
  }
}

// ── Progressive Summarization (distillation) ────────────────────────

export async function generateDistillation(params: {
  normalizedText: string;
  rawText: string | null;
  summaryPtBr: string;
  layer: 2 | 3;
}): Promise<string[] | string | null> {
  const content = [
    params.normalizedText,
    params.rawText ? `\n\nTexto original: ${params.rawText}` : "",
    `\n\nResumo: ${params.summaryPtBr}`
  ].join("");

  if (params.layer === 2) {
    const result = await callClaude({
      system: [
        "Voce e um especialista em destilacao progressiva de conhecimento (metodo BASB de Tiago Forte).",
        "Extraia as 3 a 5 frases-chave mais importantes do texto abaixo.",
        "Cada frase deve capturar uma ideia central, insight acionavel, ou dado relevante.",
        "Maximo 20 palavras por frase.",
        "Retorne APENAS um JSON array de strings. Sem explicacoes.",
        "Exemplo: [\"IA generativa reduz custos em 40%\", \"Empresas early-adopters crescem 3x mais rapido\"]"
      ].join("\n"),
      userMessage: content.slice(0, 4000),
      model: "fast",
      maxTokens: 512
    });

    if (!result) return null;
    try {
      const cleaned = result.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned) as string[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // Layer 3: executive summary
  const result = await callClaude({
    system: [
      "Gere UMA unica frase executiva que resume a essencia deste conteudo.",
      "A frase deve ser acionavel e direta, maximo 30 palavras.",
      "Retorne APENAS a frase, sem aspas, sem explicacoes, sem JSON."
    ].join("\n"),
    userMessage: content.slice(0, 4000),
    model: "fast",
    maxTokens: 128
  });

  return result?.trim() || null;
}

// ── JSON schema description (shared by planner & classifier) ─────────

const CLASSIFICATION_SCHEMA_DESCRIPTION = `You MUST respond with ONLY a valid JSON object (no markdown, no backticks, no explanation).

JSON schema for each card object:
{
  "summaryPtBr": string (required),
  "categoryName": string (required),
  "categoryDescription": string (required),
  "bucket": "PROJECTS" | "AREAS" | "RESOURCES" | "RESEARCH" | "ARCHIVE" (required),
  "action": "CREATE_PROJECT" | "CREATE_TASK" | "STORE_REFERENCE" | "FOLLOW_UP" | "NONE" (required),
  "actionTitle": string (optional),
  "actionDetails": string (optional),
  "nextStepPtBr": string (optional),
  "followUpWithPtBr": string (optional),
  "dueDateISO": string "YYYY-MM-DD" or null (optional),
  "priority": "ALTA" | "MEDIA" | "BAIXA" (required),
  "confidence": number 0-1 (required),
  "shouldCreateCategory": boolean (required),
  "followUpQuestionPtBr": string (optional)
}`;

// ── Intake planner (Claude) ──────────────────────────────────────────

export async function planIntakeWithContext(input: {
  text: string;
  inputType?: string;
  audioDurationSeconds?: number;
  knownCategories: Array<{ name: string; description: string }>;
  openContext: PlannerContextCandidate[];
}): Promise<AIIntakePlannerOutput | null> {
  if (!anthropicClient) {
    log.warn("planIntakeWithContext skipped — anthropicClient is null (ANTHROPIC_API_KEY missing)");
    return null;
  }

  const systemPrompt = [
    "You are the orchestration planner of a personal Second Brain for a busy professional who sends quick voice notes and texts throughout the day.",
    "",
    "YOUR PRIMARY ROLE: You are an EXECUTIVE ASSISTANT who interprets, synthesizes and organizes — NEVER just echo or transcribe what was said.",
    "The user sends raw, messy, informal messages. Your job is to extract the MEANING, identify ACTIONS, and produce clean professional records.",
    "",
    "CRITICAL ANTI-ECHO RULE:",
    "- NEVER copy, paraphrase, or lightly rephrase the raw input.",
    "- NEVER start the summary with the same words as the input.",
    "- ALWAYS transform into structured, professional, CONCISE notes.",
    "",
    "SUMMARY QUALITY RULES (summaryPtBr):",
    "- MAX 1-2 short sentences. Be TELEGRAPHIC — every word must earn its place.",
    "- Focus on the CORE INSIGHT: What is the situation? Why does it matter? What's at risk?",
    "- BAD (echo): 'Precisa falar com Joao sobre o projeto do site' (just repeats input).",
    "- BAD (verbose): 'O usuario mencionou que precisa ter uma conversa com o Joao para discutir questoes relacionadas ao andamento do projeto do site incluindo escopo e cronograma'.",
    "- GOOD (concise + interpretive): 'Alinhamento pendente com Joao sobre projeto do site — risco de atraso sem definicao de escopo'.",
    "- GOOD: 'Fornecedor ABC sem retorno ha 3 dias — escalar cobranca antes do deadline de sexta'.",
    "- Test: if your summary reads like a slightly reworded version of the input, REWRITE IT with added context and interpretation.",
    "",
    "actionTitle QUALITY:",
    "- Must be an IMPERATIVE ACTION (verb first), 5-10 words MAX.",
    "- BAD: 'Questao sobre o projeto do site com Joao'. GOOD: 'Cobrar Joao sobre escopo do site'.",
    "- BAD: 'Assunto relacionado ao fornecedor'. GOOD: 'Escalar cobranca ao fornecedor ABC'.",
    "",
    "OUTPUT FIELD RULES:",
    "- actionTitle (MOST IMPORTANT — this is the card headline): Short imperative verb phrase, MAXIMUM 140 CHARACTERS (like a tweet). Must start with a verb. Examples: 'Agendar reuniao com fornecedor de TI', 'Revisar proposta comercial da empresa X', 'Cobrar retorno do Joao sobre orcamento'. NEVER just describe the topic — describe WHAT TO DO. If the title exceeds 140 chars, shorten it aggressively.",
    "- summaryPtBr: PROFESSIONAL INTERPRETATION in 1-2 sentences. Explain the CONTEXT and WHY this matters. Think: 'If I read this in 2 weeks, will I instantly understand the context and importance?'",
    "- nextStepPtBr: The SINGLE, CONCRETE first step. Must be executable without thinking. Bad: 'Dar andamento'. Good: 'Enviar email para Joao pedindo reuniao quarta as 14h'.",
    "- actionDetails: Extract and organize ALL key facts: names, dates, amounts, decisions, dependencies. This is the structured record.",
    "- followUpWithPtBr: The person RESPONSIBLE for executing or unblocking this action. ALWAYS capture names.",
    "",
    "PERSON ROLE DETECTION (CRITICAL — distinguish WHO does WHAT):",
    "- RESPONSIBLE (followUpWithPtBr): The person who must ACT — execute, deliver, approve, or unblock. Ask: 'Who do I need to chase?'",
    "- MENTIONED (actionDetails): People referenced for context but who are NOT the action owner. Include them in actionDetails as context.",
    "- Examples:",
    "  Input: 'O Marcos me falou que o Joao vai atrasar a entrega do relatorio' -> followUpWith='Joao' (he must deliver), actionDetails mentions Marcos as source.",
    "  Input: 'Preciso pedir pro RH o historico da Maria' -> followUpWith='RH' (they must provide), actionDetails mentions Maria as subject.",
    "  Input: 'Ligar pro Joao pra agendar' -> followUpWith='Joao' (direct contact).",
    "  Input: 'A Fernanda comentou que o cliente quer desconto' -> followUpWith='Fernanda' (she has the context to follow up).",
    "- If a name is mentioned but you cannot determine their role, put them in actionDetails and set followUpWith to the person who should ACT.",
    "- NEVER set followUpWith to a generic term like 'responsavel interno' or 'definir responsavel'. Use the actual name or 'PENDENTE_DONO' if truly unknown.",
    "",
    "VOICE NOTE / AUDIO INTERPRETATION:",
    "- Voice transcriptions are messy — filler words, repetitions, incomplete thoughts.",
    "- You MUST heavily interpret: extract core message, identify action, name people, clarify intent.",
    "",
    "LINKS AND ARTICLES:",
    "- When the input contains URLs/links, set action=STORE_REFERENCE, bucket=RESOURCES (unless tied to active project).",
    "- summaryPtBr should describe WHY relevant. Keep URL in actionDetails.",
    "",
    "MERGE/NEW/SPLIT DECISION:",
    "- MERGE: Same TOPIC, PERSON, PROJECT, or CONTEXT as any open candidate. Be aggressive about merging. Set targetItemId.",
    "- NEW: Only if clearly DIFFERENT subject with no overlap AND the message has only ONE topic/action.",
    "- SPLIT: When the message contains 2+ DISTINCT topics, actions, or requests — even if they share some context. THIS IS THE MOST COMMON MODE FOR VOICE NOTES.",
    "",
    "MERGE MODE — CONTENT SYNTHESIS (CRITICAL, NON-NEGOTIABLE):",
    "When you choose mode='merge', your card output REPLACES the existing card's fields. You MUST synthesize ALL information.",
    "- READ THE TARGET CARD CAREFULLY: Look at the candidate's summaryPtBr, actionTitle, actionDetails, nextStep, followUpWith in the openContext list.",
    "- summaryPtBr: Write a COMPLETE standalone summary that captures ALL information from the EXISTING card AND the new message.",
    "  NEVER write vague phrases like 'complemento da mensagem anterior', 'atualizacao sobre o tema', 'informacao adicional'.",
    "  A reader who sees ONLY your summary must understand the FULL picture — both the original context AND the new update.",
    "  BAD: 'Complemento sobre a reuniao com Joao' (loses the original card's context).",
    "  GOOD: 'Reuniao com Joao sobre redesign do site confirmada para quarta 14h — ele vai trazer proposta de cronograma. Risco: se escopo nao fechar ate sexta, atraso de 2 semanas'.",
    "- actionTitle: KEEP the existing card's actionTitle if it's good and specific. Only change it if the new information significantly changes WHAT needs to be done.",
    "  If the existing title is 'Cobrar Joao sobre escopo do site', and the new message adds scheduling info, KEEP the same title — don't replace with something vague.",
    "- actionDetails: MERGE all facts from both sources — the existing card's details AND the new message's facts. Names, dates, amounts, decisions.",
    "- priority/nextStep/followUpWith: Only update if the new message provides CLEARER or MORE URGENT information.",
    "- Test: If your merge card would make the existing card WORSE or LESS INFORMATIVE, you are doing it wrong. Rewrite.",
    "",
    "SPLIT DETECTION (HIGHEST PRIORITY — THIS IS A CRITICAL SYSTEM FEATURE):",
    "Before doing ANYTHING else, read the entire input and COUNT how many distinct action items, requests, or topics exist.",
    "If you find 2 or more, you MUST use mode='split' and return one card per topic. This is NON-NEGOTIABLE.",
    "",
    "TOPIC BOUNDARY MARKERS (strongest signal):",
    "- Audio transcriptions are pre-processed. Topic boundaries are marked with '---' on a separate line.",
    "- If the input contains '---' separators, each section between separators is ALMOST CERTAINLY a distinct topic.",
    "- Count the sections: N sections = N cards minimum. This is the most reliable split signal.",
    "- Even if '---' is absent, still check for the other signals below.",
    "",
    "HOW TO DETECT MULTIPLE TOPICS:",
    "1. DIFFERENT PEOPLE: 'cobrar Joao' + 'falar com Maria' = 2 cards, even if same project.",
    "2. DIFFERENT ACTIONS: 'revisar contrato' + 'agendar reuniao' = 2 cards, even if same person.",
    "3. DIFFERENT SUBJECTS/PROJECTS: 'site do cliente' + 'contratacao do estagiario' = 2 cards.",
    "4. TOPIC TRANSITIONS — common in Portuguese voice notes:",
    "   'outra coisa', 'alem disso', 'ah e tambem', 'mudando de assunto', 'outro ponto',",
    "   'e tem mais', 'aproveitando', 'lembrando', 'ah esqueci', 'sobre outro assunto',",
    "   or simply a SHIFT in subject/person/project without any explicit marker.",
    "5. ENUMERATION: 'primeiro... segundo...', 'uma coisa... outra coisa...', numbered items.",
    "6. IMPLICIT BREAKS: Even without transition words, if the speaker jumps from topic A to topic B, split.",
    "",
    "SPLIT EXAMPLES (study these carefully):",
    "Input: 'Preciso ligar pro Joao sobre o site, e tambem tem que revisar aquele contrato do fornecedor, ah e agenda uma reuniao com a Maria pra semana que vem'",
    "-> mode='split', 3 cards: [Ligar pro Joao sobre site] [Revisar contrato do fornecedor] [Agendar reuniao com Maria]",
    "",
    "Input: 'O Marcos falou que vai atrasar a entrega, preciso cobrar ele, e outra coisa, tenho que pagar a fatura da AWS ate sexta'",
    "-> mode='split', 2 cards: [Cobrar Marcos sobre entrega] [Pagar fatura AWS]",
    "",
    "Input: 'Falar com time de vendas sobre a meta do mes'",
    "-> mode='new', 1 card (single topic, single action)",
    "",
    "SPLIT RULES:",
    "- When in doubt between NEW and SPLIT, ALWAYS prefer SPLIT. Over-splitting is better than under-splitting.",
    "- Each split card MUST be self-contained: its own actionTitle, summaryPtBr, nextStepPtBr, followUpWithPtBr, priority.",
    "- A split card should make perfect sense if read in isolation, without seeing the other cards.",
    "- mode='split' REQUIRES cards array to have 2+ items. NEVER return mode='split' with only 1 card.",
    "- For split mode, set confidence >= 0.85 (you are confident about the separation).",
    "",
    "CONFIDENCE RULES:",
    "- If the open candidates list is EMPTY (no cards exist), ALWAYS set mode='new' and confidence >= 0.90. There is nothing to merge with.",
    "- If open candidates exist but NONE relate to the incoming message, set mode='new' and confidence >= 0.85.",
    "- If ANY open candidate clearly relates (same topic, person, project), set confidence >= 0.75 and merge.",
    "- Only set confidence < 0.72 if there ARE plausible candidates and you are genuinely uncertain which one matches.",
    "",
    "LANGUAGE RULES (CRITICAL):",
    "- The user sends messages predominantly in PORTUGUESE (Brazilian). This is the primary input language.",
    "- Content in English will occasionally appear ONLY inside links, file attachments, or quoted technical terms — never treat English fragments as the user's own words.",
    "- You may reason internally in any language, but ALL output fields (summaryPtBr, actionTitle, nextStepPtBr, actionDetails, followUpWithPtBr, categoryName, categoryDescription, reasonPtBr) MUST be in Brazilian Portuguese.",
    "- Category names MUST be in Portuguese (e.g. 'Financeiro', 'Saude', 'Tecnologia' — never 'Finance', 'Health', 'Technology').",
    "- If the input contains English text (e.g. from a link or document), translate/adapt the key points to Portuguese in your output.",
    "- Person names stay as-is (do not translate names).",
    "",
    "OWNER: If unknown, write exactly 'PENDENTE_DONO'.",
    "CONSTRAINT: Do not invent targetItemId outside provided candidates.",
    "",
    CLASSIFICATION_SCHEMA_DESCRIPTION,
    "",
    `The top-level JSON must be:
{
  "decision": {
    "mode": "merge" | "new" | "split",
    "confidence": number 0-1,
    "targetItemId": integer (optional, required for merge),
    "reasonPtBr": string
  },
  "cards": [ ...card objects ]
}

CRITICAL CARD COUNT RULES:
- mode="new": cards array MUST have exactly 1 item.
- mode="merge": cards array MUST have exactly 1 item (the merged update).
- mode="split": cards array MUST have 2-6 items (one per distinct topic/action). If you wrote only 1 card, you MUST reconsider — is there really only one topic?`
  ].join("\n");

  let inputTypeLabel: string;
  if (input.inputType === "audio") {
    const dur = input.audioDurationSeconds ?? 0;
    const durLabel = dur > 0 ? `${dur}s duration` : "unknown duration";
    const splitHint = dur >= 45
      ? "LONG voice note — VERY HIGH probability of multiple topics. Split aggressively."
      : dur >= 20
        ? "Medium voice note — likely contains 2+ topics. Check carefully for splits."
        : "Short voice note — may be single topic, but still check for splits.";
    inputTypeLabel = `VOICE NOTE / AUDIO TRANSCRIPTION (${durLabel}). ${splitHint}`;
  } else if (input.inputType === "image") {
    inputTypeLabel = "IMAGE (with extracted description)";
  } else if (input.inputType === "pdf") {
    inputTypeLabel = "PDF DOCUMENT";
  } else {
    inputTypeLabel = "TEXT MESSAGE";
  }

  try {
    const response = await anthropicClient.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Known categories:\n${JSON.stringify(input.knownCategories, null, 2)}\n\nOpen context candidates:\n${JSON.stringify(
            input.openContext,
            null,
            2
          )}\n\nInput type: ${inputTypeLabel}\n\nIncoming content:\n${input.text}`
        }
      ]
    });

    const textBlock = response.content.find((block) => block.type === "text");
    let raw = textBlock?.text?.trim();
    if (!raw) {
      return null;
    }

    // Strip markdown code fences if present (models sometimes wrap JSON in ```json...```)
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/i, "").trim();

    const parsed = JSON.parse(raw) as AIIntakePlannerOutput;

    // Validate: if mode is "split" but only 1 card, fix to "new"
    if (parsed.decision.mode === "split" && parsed.cards.length < 2) {
      log.warn("Planner returned split with <2 cards, correcting to 'new'", { cardCount: parsed.cards.length });
      parsed.decision.mode = "new";
    }
    // Validate: if mode is "new"/"merge" but multiple cards, fix to "split"
    if ((parsed.decision.mode === "new" || parsed.decision.mode === "merge") && parsed.cards.length > 1) {
      log.warn("Planner returned new/merge with multiple cards, correcting to 'split'", {
        originalMode: parsed.decision.mode,
        cardCount: parsed.cards.length
      });
      parsed.decision.mode = "split";
    }

    return parsed;
  } catch (error) {
    log.error("AI intake planning failed", { error });
    return null;
  }
}

// ── Fallback classifier (Claude) ─────────────────────────────────────

export async function classifyWithAI(input: AIClassificationInput): Promise<AIClassificationOutput | null> {
  if (!anthropicClient) {
    log.warn("classifyWithAI skipped — anthropicClient is null (ANTHROPIC_API_KEY missing)");
    return null;
  }

  const systemPrompt = [
    "You classify personal knowledge inputs for a Second Brain system used by a busy professional.",
    "",
    "CRITICAL: You are an EXECUTIVE ASSISTANT and INTERPRETER, not a transcriber.",
    "The user sends quick voice notes, messy texts, and informal messages.",
    "Your job is to extract the MEANING and produce clean, professional, actionable records.",
    "",
    "ANTI-ECHO RULE (MANDATORY):",
    "- NEVER copy, paraphrase, or lightly rephrase the raw input.",
    "- NEVER start the summary with the same words as the input.",
    "- ALWAYS add interpretation, context, and structure that wasn't in the original.",
    "",
    "SUMMARY QUALITY (summaryPtBr):",
    "- MAX 1-2 SHORT sentences. Be TELEGRAPHIC — every word must earn its place.",
    "- Focus on CORE INSIGHT: situation + why it matters + what's at risk.",
    "- BAD (echo): 'Usuario precisa falar com Joao sobre projeto' (just repeating!).",
    "- BAD (verbose): 'O usuario mencionou que ha necessidade de conversar com o Joao para tratar de questoes do projeto'.",
    "- GOOD (concise): 'Alinhamento de escopo pendente com Joao — risco de atraso se nao resolvido esta semana'.",
    "- Test: if your summary sounds like the input reworded, REWRITE with added insight.",
    "",
    "OUTPUT RULES:",
    "- actionTitle (CARD HEADLINE): Imperative verb phrase, MAXIMUM 140 CHARACTERS. Must start with verb.",
    "  BAD: 'Questao sobre contrato'. GOOD: 'Revisar contrato do fornecedor ABC'. If title exceeds 140 chars, shorten aggressively.",
    "- nextStepPtBr: ONE concrete, executable step. BAD: 'Dar andamento'. GOOD: 'Ligar para Joao e agendar reuniao para esta semana'.",
    "- actionDetails: ALL key facts organized: names, dates, amounts, decisions, dependencies.",
    "- followUpWithPtBr: The person who must ACT (execute, deliver, approve). Use actual name. Never 'responsavel interno'.",
    "",
    "PERSON ROLES:",
    "- followUpWithPtBr = who must ACT on this. Ask: 'Who do I chase?'",
    "- actionDetails = mention other people referenced for context but not responsible for execution.",
    "- Example: 'Marcos disse que Joao vai atrasar' -> followUpWith='Joao', actionDetails mentions Marcos as source.",
    "",
    "VOICE NOTES: Transcriptions are messy. You MUST heavily interpret — extract core message, identify action, name people.",
    "",
    "LINKS/URLs: Set action=STORE_REFERENCE, bucket=RESOURCES. Explain WHY relevant. Keep URL in actionDetails.",
    "",
    "LANGUAGE RULES:",
    "- Input is predominantly in PORTUGUESE (Brazilian). English appears only in links, attachments, or technical terms.",
    "- ALL output fields MUST be in Brazilian Portuguese — including categoryName and categoryDescription.",
    "- If input contains English content (from a link or file), translate/adapt key points to Portuguese.",
    "- Person names stay as-is (do not translate names).",
    "",
    "Reuse existing categories when possible. Fill actionTitle, nextStepPtBr, followUpWithPtBr for any action != NONE.",
    "Only set dueDateISO for concrete dates/deadlines mentioned.",
    "",
    CLASSIFICATION_SCHEMA_DESCRIPTION,
    "",
    "Respond with a single JSON card object (not wrapped in an array)."
  ].join("\n");

  try {
    const response = await anthropicClient.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Known categories:\n${JSON.stringify(input.knownCategories, null, 2)}\n\nInput content:\n${input.text}`
        }
      ]
    });

    const textBlock = response.content.find((block) => block.type === "text");
    let raw = textBlock?.text?.trim();
    if (!raw) {
      return null;
    }

    // Strip markdown code fences if present (models sometimes wrap JSON in ```json...```)
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/i, "").trim();

    return JSON.parse(raw) as AIClassificationOutput;
  } catch (error) {
    log.error("AI classification failed", { error });
    return null;
  }
}

// ── Generic Claude helper for agents ─────────────────────────────────

export async function callClaude(params: {
  system: string;
  userMessage: string;
  model?: "default" | "fast";
  maxTokens?: number;
}): Promise<string | null> {
  if (!anthropicClient) {
    log.warn("callClaude skipped — anthropicClient is null");
    return null;
  }

  const model = params.model === "fast" ? env.ANTHROPIC_FAST_MODEL : env.ANTHROPIC_MODEL;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await anthropicClient.messages.create({
        model,
        max_tokens: params.maxTokens ?? 4096,
        system: params.system,
        messages: [{ role: "user", content: params.userMessage }]
      });

      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.text?.trim() ?? null;
    } catch (error) {
      if (attempt < maxAttempts) {
        log.warn("callClaude failed, retrying after backoff", { attempt, model, error });
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      } else {
        log.error("callClaude failed after retries", { attempts: maxAttempts, model, error });
        return null;
      }
    }
  }

  return null;
}
