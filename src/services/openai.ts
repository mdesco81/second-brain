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

const maybeClient = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY
    })
  : null;

export function hasAI(): boolean {
  return Boolean(maybeClient);
}

export function embeddingModel(): string {
  return env.OPENAI_EMBED_MODEL;
}

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
}): Promise<string | null> {
  if (!maybeClient) {
    return null;
  }

  const fallbackModels = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"];
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

          const transcription = await maybeClient.audio.transcriptions.create({
            file,
            model,
            language: "pt"
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

export async function describeImage(base64DataUrl: string): Promise<string | null> {
  if (!maybeClient) {
    return null;
  }

  try {
    const response = await maybeClient.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract the most relevant text and meaning from this image. Return in plain text in Portuguese (Brazil)."
            },
            {
              type: "input_image",
              image_url: base64DataUrl,
              detail: "auto"
            }
          ]
        }
      ]
    });

    return response.output_text?.trim() || null;
  } catch (error) {
    log.error("Image description failed", { error });
    return null;
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  if (!maybeClient) {
    return null;
  }
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  try {
    const response = await maybeClient.embeddings.create({
      model: env.OPENAI_EMBED_MODEL,
      input: normalized
    });
    const vector = response.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : null;
  } catch (error) {
    log.warn("Embedding generation failed", { error });
    return null;
  }
}

export async function planIntakeWithContext(input: {
  text: string;
  knownCategories: Array<{ name: string; description: string }>;
  openContext: PlannerContextCandidate[];
}): Promise<AIIntakePlannerOutput | null> {
  if (!maybeClient) {
    return null;
  }

  try {
    const response = await maybeClient.responses.create({
      model: env.OPENAI_MODEL,
      text: {
        format: {
          type: "json_schema",
          name: "second_brain_intake_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["decision", "cards"],
            properties: {
              decision: {
                type: "object",
                additionalProperties: false,
                required: ["mode", "confidence", "reasonPtBr"],
                properties: {
                  mode: {
                    type: "string",
                    enum: ["merge", "new", "split"]
                  },
                  confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  targetItemId: {
                    type: "integer"
                  },
                  reasonPtBr: {
                    type: "string"
                  }
                }
              },
              cards: {
                type: "array",
                minItems: 1,
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "summaryPtBr",
                    "categoryName",
                    "categoryDescription",
                    "bucket",
                    "action",
                    "priority",
                    "confidence",
                    "shouldCreateCategory"
                  ],
                  properties: {
                    summaryPtBr: { type: "string" },
                    categoryName: { type: "string" },
                    categoryDescription: { type: "string" },
                    bucket: {
                      type: "string",
                      enum: ["PROJECTS", "AREAS", "RESOURCES", "RESEARCH", "ARCHIVE"]
                    },
                    action: {
                      type: "string",
                      enum: ["CREATE_PROJECT", "CREATE_TASK", "STORE_REFERENCE", "FOLLOW_UP", "NONE"]
                    },
                    actionTitle: { type: "string" },
                    actionDetails: { type: "string" },
                    nextStepPtBr: { type: "string" },
                    followUpWithPtBr: { type: "string" },
                    dueDateISO: {
                      anyOf: [
                        {
                          type: "string",
                          pattern: "^\\d{4}-\\d{2}-\\d{2}$"
                        },
                        { type: "null" }
                      ]
                    },
                    priority: {
                      type: "string",
                      enum: ["ALTA", "MEDIA", "BAIXA"]
                    },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    shouldCreateCategory: { type: "boolean" },
                    followUpQuestionPtBr: { type: "string" }
                  }
                }
              }
            }
          }
        }
      },
      input: [
        {
          role: "system",
          content: [
            "You are the orchestration planner of a personal Second Brain for a busy professional who sends quick voice notes and texts throughout the day.",
            "",
            "YOUR PRIMARY ROLE: You are an EXECUTIVE ASSISTANT who interprets, synthesizes and organizes — NEVER just echo or transcribe what was said.",
            "The user sends raw, messy, informal messages. Your job is to extract the MEANING, identify ACTIONS, and produce clean professional records.",
            "",
            "CRITICAL ANTI-ECHO RULE:",
            "- NEVER copy or paraphrase the raw input. ALWAYS transform it into structured, professional notes.",
            "- If the input says 'preciso falar com joao sobre o projeto do site', your summaryPtBr should NOT be 'Precisa falar com Joao sobre o projeto do site'.",
            "- Instead: 'Alinhamento pendente com Joao sobre andamento do projeto do site — definir escopo e cronograma'.",
            "- The difference: you ADD INTERPRETATION, CONTEXT, and ACTIONABILITY.",
            "",
            "OUTPUT FIELD RULES:",
            "- actionTitle (MOST IMPORTANT — this is the card headline): Short imperative verb phrase (5-10 words). Must start with a verb. Examples: 'Agendar reuniao com fornecedor de TI', 'Revisar proposta comercial da empresa X', 'Cobrar retorno do Joao sobre orcamento'. NEVER just describe the topic — describe WHAT TO DO.",
            "- summaryPtBr: PROFESSIONAL INTERPRETATION in 1-2 sentences. Explain the CONTEXT and WHY this matters. Think: 'If I read this in 2 weeks, will I instantly understand the context and importance?'",
            "- nextStepPtBr: The SINGLE, CONCRETE first step. Must be executable without thinking. Bad: 'Dar andamento'. Good: 'Enviar email para Joao pedindo reuniao quarta as 14h'.",
            "- actionDetails: Extract and organize ALL key facts: names, dates, amounts, decisions, dependencies. This is the structured record.",
            "- followUpWithPtBr: Name the specific person or team mentioned. ALWAYS capture names.",
            "",
            "VOICE NOTE / AUDIO INTERPRETATION:",
            "- Voice transcriptions are messy — filler words, repetitions, incomplete thoughts.",
            "- You MUST heavily interpret: extract core message, identify action, name people, clarify intent.",
            "",
            "LINKS AND ARTICLES:",
            "- When the input contains URLs/links, set action=STORE_REFERENCE, bucket=RESOURCES (unless tied to active project).",
            "- summaryPtBr should describe WHY relevant. Keep URL in actionDetails.",
            "",
            "MERGE/NEW/SPLIT DECISION (prefer merge when in doubt):",
            "- MERGE: Same TOPIC, PERSON, PROJECT, or CONTEXT as any open candidate. Be aggressive about merging. Set targetItemId.",
            "- NEW: Only if clearly DIFFERENT subject with no overlap.",
            "- SPLIT: Only if message contains 2+ clearly INDEPENDENT actionable topics.",
            "",
            "CONFIDENCE: If ANY open candidate could relate (same category, person, project), set confidence >= 0.75 and merge.",
            "Only set confidence < 0.72 if genuinely uncertain.",
            "",
            "LANGUAGE: Think in English for accuracy, ALL output in Brazilian Portuguese.",
            "OWNER: If unknown, write exactly 'PENDENTE_DONO'.",
            "CONSTRAINT: Do not invent targetItemId outside provided candidates."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Known categories:\n${JSON.stringify(input.knownCategories, null, 2)}\n\nOpen context candidates:\n${JSON.stringify(
                input.openContext,
                null,
                2
              )}\n\nIncoming content:\n${input.text}`
            }
          ]
        }
      ]
    });

    const raw = response.output_text;
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AIIntakePlannerOutput;
  } catch (error) {
    log.error("AI intake planning failed", { error });
    return null;
  }
}

export async function classifyWithAI(input: AIClassificationInput): Promise<AIClassificationOutput | null> {
  if (!maybeClient) {
    return null;
  }

  try {
    const response = await maybeClient.responses.create({
      model: env.OPENAI_MODEL,
      text: {
        format: {
          type: "json_schema",
          name: "second_brain_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "summaryPtBr",
              "categoryName",
              "categoryDescription",
              "bucket",
              "action",
              "priority",
              "confidence",
              "shouldCreateCategory"
            ],
            properties: {
              summaryPtBr: { type: "string" },
              categoryName: { type: "string" },
              categoryDescription: { type: "string" },
              bucket: {
                type: "string",
                enum: ["PROJECTS", "AREAS", "RESOURCES", "RESEARCH", "ARCHIVE"]
              },
              action: {
                type: "string",
                enum: ["CREATE_PROJECT", "CREATE_TASK", "STORE_REFERENCE", "FOLLOW_UP", "NONE"]
              },
              actionTitle: { type: "string" },
              actionDetails: { type: "string" },
              nextStepPtBr: { type: "string" },
              followUpWithPtBr: { type: "string" },
              dueDateISO: {
                anyOf: [
                  {
                    type: "string",
                    pattern: "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  { type: "null" }
                ]
              },
              priority: {
                type: "string",
                enum: ["ALTA", "MEDIA", "BAIXA"]
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              shouldCreateCategory: { type: "boolean" },
              followUpQuestionPtBr: { type: "string" }
            }
          }
        }
      },
      input: [
        {
          role: "system",
          content: [
            "You classify personal knowledge inputs for a Second Brain system used by a busy professional.",
            "",
            "CRITICAL: You are an EXECUTIVE ASSISTANT and INTERPRETER, not a transcriber.",
            "The user sends quick voice notes, messy texts, and informal messages.",
            "Your job is to extract the MEANING and produce clean, professional, actionable records.",
            "",
            "ANTI-ECHO RULE (MANDATORY):",
            "- NEVER copy, paraphrase, or lightly rephrase the raw input.",
            "- ALWAYS add interpretation, context, and structure that wasn't in the original.",
            "- Bad summaryPtBr: 'Usuario precisa falar com Joao sobre projeto' (this is just echoing!).",
            "- Good summaryPtBr: 'Alinhamento de escopo pendente com Joao para o projeto do site — risco de atraso se nao resolvido esta semana'.",
            "",
            "OUTPUT RULES:",
            "- actionTitle (CARD HEADLINE): Imperative verb phrase, 5-10 words. Must start with verb. Examples: 'Revisar contrato do fornecedor ABC', 'Cobrar aprovacao do orcamento com diretoria'.",
            "- summaryPtBr: PROFESSIONAL interpretation (1-2 sentences). Explain context and importance. Think: 'In 2 weeks, will I understand why this matters?'",
            "- nextStepPtBr: ONE concrete, executable step. Bad: 'Dar andamento'. Good: 'Ligar para Joao (11-9999-0000) e agendar reuniao para esta semana'.",
            "- actionDetails: ALL key facts organized: names, dates, amounts, decisions, dependencies.",
            "- followUpWithPtBr: The SPECIFIC person or team. Never 'responsavel interno'.",
            "",
            "VOICE NOTES: Transcriptions are messy. You MUST heavily interpret — extract core message, identify action, name people.",
            "",
            "LINKS/URLs: Set action=STORE_REFERENCE, bucket=RESOURCES. Explain WHY relevant. Keep URL in actionDetails.",
            "",
            "ALL output in Brazilian Portuguese. Reuse categories. Fill actionTitle, nextStepPtBr, followUpWithPtBr for any action != NONE.",
            "Only set dueDateISO for concrete dates/deadlines mentioned."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Known categories:\n${JSON.stringify(input.knownCategories, null, 2)}\n\nInput content:\n${input.text}`
            }
          ]
        }
      ]
    });

    const raw = response.output_text;
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as AIClassificationOutput;
  } catch (error) {
    log.error("AI classification failed", { error });
    return null;
  }
}
