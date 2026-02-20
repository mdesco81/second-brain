import OpenAI from "openai";
import { toFile } from "openai/uploads";
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

const maybeClient = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY
    })
  : null;

export function hasAI(): boolean {
  return Boolean(maybeClient);
}

const SUPPORTED_AUDIO_EXTENSIONS = new Set([".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".ogg", ".flac"]);

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
  const uploadFileName = normalizeUploadFileName(params.fileName, params.mimeType);

  try {
    for (const model of models) {
      try {
        const file = await toFile(params.buffer, uploadFileName, {
          type: params.mimeType || "audio/ogg"
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
        log.warn("Audio transcription attempt failed", { model, fileName: params.fileName, uploadFileName, error });
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
          content:
            "You classify personal knowledge inputs for a Second Brain system. Think in English for accuracy, but every textual output must be in Brazilian Portuguese. Reuse existing categories whenever possible. Create a new category only when strictly necessary. Return action-oriented outputs only: actionTitle must be a short imperative sentence, summaryPtBr must be concise and objective, nextStepPtBr must be executable, priority must be practical (ALTA, MEDIA, BAIXA), and followUpWithPtBr must name who should be contacted or charged (person, team, supplier or stakeholder) whenever action is not NONE. Only set dueDateISO when the text implies a concrete date or deadline." 
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
