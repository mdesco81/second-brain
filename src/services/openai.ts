import fs from "node:fs/promises";
import OpenAI from "openai";
import { env } from "../config/env.js";
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

export async function transcribeAudio(filePath: string): Promise<string | null> {
  if (!maybeClient) {
    return null;
  }

  try {
    const stream = await fs.open(filePath, "r");
    const transcription = await maybeClient.audio.transcriptions.create({
      file: stream.createReadStream(),
      model: env.OPENAI_TRANSCRIBE_MODEL,
      language: "pt"
    });
    await stream.close();
    return transcription.text;
  } catch (error) {
    log.error("Audio transcription failed", { error });
    return null;
  }
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
            "You classify personal knowledge inputs for a Second Brain system. Think in English for accuracy, but every textual output must be in Brazilian Portuguese. Reuse an existing category if possible. Create a new category only when no existing category can capture intent." 
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
