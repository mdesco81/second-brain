import { OpenActionItem } from "../db/schema.js";

function actionLabel(item: OpenActionItem): string {
  const title = item.actionTitle || item.summaryPtBr;
  const due = item.dueAt ? ` | prazo ${item.dueAt}` : "";
  const followUp = item.followUpWith ? ` | cobrar ${item.followUpWith}` : "";
  return `#${item.id} [${item.priority}] ${title}${due}${followUp}`;
}

function daysAgo(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
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
  focusItems: OpenActionItem[],
  overdueItems?: OpenActionItem[],
  staleItems?: OpenActionItem[]
): string {
  const lines: string[] = [
    "Bom dia! Check-in do Second Brain:"
  ];

  if (snapshot.items > 0) {
    lines.push(`Ultimas 24h: ${snapshot.items} novos itens capturados.`);
  }

  // Overdue items - most urgent
  if (overdueItems && overdueItems.length > 0) {
    lines.push("");
    lines.push(`ATRASADOS (${overdueItems.length}):`);
    for (const item of overdueItems.slice(0, 5)) {
      const days = item.dueAt ? daysAgo(item.dueAt) : 0;
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (${days}d atrasado)`);
      if (item.nextStep) {
        lines.push(`  Proximo passo: ${item.nextStep}`);
      }
    }
  }

  // Today's focus
  if (focusItems.length > 0) {
    lines.push("");
    lines.push("FOCO DE HOJE:");
    for (const item of focusItems) {
      lines.push(`- #${item.id} [${item.priority}] ${item.actionTitle || item.summaryPtBr}`);
      if (item.nextStep) {
        lines.push(`  Proximo passo: ${item.nextStep}`);
      }
    }
  }

  // Stale items - need attention
  if (staleItems && staleItems.length > 0) {
    lines.push("");
    lines.push("PARADOS HA DIAS (preciso de update):");
    for (const item of staleItems.slice(0, 3)) {
      const days = daysAgo(item.createdAt);
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (${days}d sem update)`);
      lines.push(`  Ja resolveu? Responda /done ${item.id} ou me atualize.`);
    }
  }

  if (focusItems.length === 0 && (!overdueItems || overdueItems.length === 0)) {
    lines.push("");
    lines.push("Tudo em dia! Sem pendencias criticas.");
  } else {
    lines.push("");
    lines.push("Me atualize: mande um audio ou texto com o status.");
  }

  return lines.join("\n");
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
