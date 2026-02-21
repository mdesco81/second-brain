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
            "YOUR PRIMARY ROLE: Interpret, synthesize and organize — NEVER just echo or transcribe what was said.",
            "",
            "INTERPRETATION RULES (CRITICAL):",
            "- summaryPtBr: Write a CLEAR, INTERPRETED summary in 1-2 sentences. This is what the user will see for tracking. Never copy the raw text. Transform messy voice transcriptions into clean, professional notes.",
            "- actionTitle: Short imperative sentence describing what must be done (max 10 words). Example: 'Agendar reuniao com fornecedor de TI'",
            "- nextStepPtBr: The CONCRETE first step to advance this item. Must be specific enough to execute without thinking.",
            "- actionDetails: Structured breakdown of the key information extracted, not a copy of the input.",
            "",
            "MERGE/NEW/SPLIT DECISION (CRITICAL — prefer merge when in doubt):",
            "- MERGE: If the new message is about the SAME TOPIC, SAME PERSON, SAME PROJECT, or SAME CONTEXT as any open candidate, choose merge. Be aggressive about merging — users send multiple messages about the same thing across hours/days. Even if wording is different, if the underlying subject is the same, MERGE. Set targetItemId to the best matching candidate.",
            "- NEW: Only if the message is clearly about a DIFFERENT subject with no overlap to any open candidate.",
            "- SPLIT: Only if the message contains 2+ clearly INDEPENDENT actionable topics in a single message.",
            "",
            "CONFIDENCE GUIDANCE:",
            "- If you see ANY open candidate that could relate to the new message (same category, same person mentioned, same project), set confidence >= 0.75 and choose merge.",
            "- Only set confidence < 0.72 if you genuinely cannot determine if this relates to existing items.",
            "",
            "LANGUAGE: Think in English for accuracy, but ALL output text fields must be in Brazilian Portuguese.",
            "OWNER: If owner is unknown, write exactly 'PENDENTE_DONO'. Never use generic placeholders.",
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
            "CRITICAL: You are an INTERPRETER, not a transcriber. The user sends quick voice notes, messy texts, and informal messages. Your job is to extract the MEANING and produce clean, professional records.",
            "",
            "OUTPUT RULES:",
            "- summaryPtBr: Write a CLEAN, INTERPRETED summary (1-2 sentences). Never copy raw input. Transform informal speech into a clear note that makes sense when read days later.",
            "- actionTitle: Short imperative sentence (max 10 words). Example: 'Revisar contrato do fornecedor ABC'",
            "- nextStepPtBr: The specific, executable first step. Not generic advice — a concrete action.",
            "- actionDetails: Key facts extracted and organized, not a copy of the input.",
            "- followUpWithPtBr: Name the specific person, team, or stakeholder. Never use 'responsavel interno'.",
            "",
            "Think in English for accuracy, but ALL output text must be in Brazilian Portuguese.",
            "Reuse existing categories whenever possible. Create new only when strictly necessary.",
            "Priority must be practical (ALTA, MEDIA, BAIXA).",
            "If action is not NONE, always fill actionTitle, nextStepPtBr and followUpWithPtBr.",
            "Only set dueDateISO when the text implies a concrete date or deadline."
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
