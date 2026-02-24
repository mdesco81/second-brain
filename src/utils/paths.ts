import path from "node:path";
import { env } from "../config/env.js";

export const KNOWLEDGE_PATHS = {
  inbox: path.join(env.STORAGE_ROOT, "00_INBOX"),
  projects: path.join(env.STORAGE_ROOT, "10_PROJECTS"),
  areas: path.join(env.STORAGE_ROOT, "20_AREAS"),
  resources: path.join(env.STORAGE_ROOT, "30_RESOURCES"),
  research: path.join(env.STORAGE_ROOT, "31_RESEARCH"),
  archive: path.join(env.STORAGE_ROOT, "40_ARCHIVE"),
  agentOutputs: path.join(env.STORAGE_ROOT, "50_AGENT_OUTPUTS"),
  status: path.join(env.STORAGE_ROOT, "80_STATUS"),
  system: path.join(env.STORAGE_ROOT, "90_SYSTEM")
} as const;

export function toDailyFolder(basePath: string, date = new Date()): string {
  const year = `${date.getFullYear()}`;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return path.join(basePath, year, month, day);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}
