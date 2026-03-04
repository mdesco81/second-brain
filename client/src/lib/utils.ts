import type { ActionPriority, SuggestedAction, InputType } from "@/types/api";

export function daysFromNow(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const diff =
    new Date(dateStr + "T00:00:00").getTime() -
    new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

export function priorityLabel(p: ActionPriority): string {
  if (p === "ALTA") return "Alta";
  if (p === "MEDIA") return "Média";
  return "Baixa";
}

export function priorityValue(p: ActionPriority): number {
  if (p === "ALTA") return 3;
  if (p === "MEDIA") return 2;
  return 1;
}

export function actionLabel(a: SuggestedAction): string {
  if (a === "CREATE_PROJECT") return "Projeto";
  if (a === "CREATE_TASK") return "Tarefa";
  if (a === "STORE_REFERENCE") return "Referência";
  if (a === "FOLLOW_UP") return "Follow-up";
  return "Registro";
}

export function inputTypeLabel(t: InputType): string {
  if (t === "audio") return "Áudio";
  if (t === "image") return "Imagem";
  if (t === "pdf") return "PDF";
  if (t === "file") return "Arquivo";
  return "Texto";
}

export function formatDateBR(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTimeBR(dateStr: string): string {
  return new Date(dateStr).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDateBR(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
