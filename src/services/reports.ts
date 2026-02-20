import { OpenActionItem } from "../db/schema.js";

function actionLabel(item: OpenActionItem): string {
  const title = item.actionTitle || item.summaryPtBr;
  const due = item.dueAt ? ` | prazo ${item.dueAt}` : "";
  return `#${item.id} [${item.priority}] ${title}${due}`;
}

export function buildOpenActionsMessage(items: OpenActionItem[]): string {
  if (items.length === 0) {
    return "Nao ha acoes abertas no momento.";
  }

  return [
    "Prioridades abertas:",
    ...items.map((item) => `- ${actionLabel(item)}`),
    "",
    "Para concluir uma acao: /done <id>"
  ].join("\n");
}

export function buildDailyMessage(
  snapshot: { items: number; projects: number; categoriesUsed: number },
  focusItems: OpenActionItem[]
): string {
  const header = [
    "Check-in diario do Second Brain:",
    `Ultimas 24h: ${snapshot.items} itens, ${snapshot.projects} projetos tocados, ${snapshot.categoriesUsed} categorias usadas.`
  ];

  if (focusItems.length === 0) {
    return [...header, "", "Sem pendencias criticas hoje."].join("\n");
  }

  return [
    ...header,
    "",
    "Foco recomendado de hoje:",
    ...focusItems.map((item) => `- ${actionLabel(item)}`),
    "",
    "Me atualize com status para eu ajustar prioridades."
  ].join("\n");
}

export function buildWeeklyMessage(summary: {
  items: number;
  projectsTouched: number;
  categoriesUsed: number;
  doneActions: number;
  openActions: number;
  topCategories: Array<{ name: string; total: number }>;
  nextWeekPriorities: OpenActionItem[];
}): string {
  const topCategories =
    summary.topCategories.length > 0
      ? summary.topCategories.map((item) => `${item.name} (${item.total})`).join(", ")
      : "Sem destaque";

  const nextPriorities =
    summary.nextWeekPriorities.length > 0
      ? summary.nextWeekPriorities.map((item) => `- ${actionLabel(item)}`).join("\n")
      : "- Nenhuma prioridade aberta";

  return [
    "Resumo semanal do Second Brain:",
    `- Itens capturados: ${summary.items}`,
    `- Projetos tocados: ${summary.projectsTouched}`,
    `- Categorias ativas: ${summary.categoriesUsed}`,
    `- Acoes concluidas: ${summary.doneActions}`,
    `- Acoes abertas: ${summary.openActions}`,
    `- Categorias de destaque: ${topCategories}`,
    "",
    "Prioridades para a proxima semana:",
    nextPriorities,
    "",
    "Use /prioridades para ver a fila completa."
  ].join("\n");
}
