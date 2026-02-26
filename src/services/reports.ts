import { OpenActionItem, Person } from "../db/schema.js";

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

function isFollowUp(item: OpenActionItem): boolean {
  return item.action === "FOLLOW_UP";
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
    "Bom dia! Seu Second Brain organizou o dia:"
  ];

  if (snapshot.items > 0) {
    lines.push(`(${snapshot.items} novos itens capturados ontem)`);
  }

  // --- URGENTE & IMPORTANTE: overdue + high priority due today ---
  const urgentImportant = [
    ...(overdueItems || []),
    ...focusItems.filter((i) => i.priority === "ALTA" && !overdueItems?.find((o) => o.id === i.id))
  ];

  if (urgentImportant.length > 0) {
    lines.push("");
    lines.push("URGENTE & IMPORTANTE:");
    for (const item of urgentImportant.slice(0, 5)) {
      const overdueDays = item.dueAt ? daysAgo(item.dueAt) : 0;
      const overdueTag = overdueDays > 0 ? ` (${overdueDays}d atrasado!)` : "";
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr}${overdueTag}`);
      if (item.nextStep) {
        lines.push(`  -> ${item.nextStep}`);
      }
    }
  }

  // --- IMPORTANTE (nao urgente): medium/high priority, not overdue ---
  const overdueIds = new Set((overdueItems || []).map((i) => i.id));
  const urgentIds = new Set(urgentImportant.map((i) => i.id));
  const important = focusItems.filter(
    (i) => !urgentIds.has(i.id) && !overdueIds.has(i.id) && (i.priority === "MEDIA" || i.priority === "ALTA")
  );

  if (important.length > 0) {
    lines.push("");
    lines.push("IMPORTANTE (pra essa semana):");
    for (const item of important.slice(0, 4)) {
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr}`);
      if (item.nextStep) {
        lines.push(`  -> ${item.nextStep}`);
      }
    }
  }

  // --- AGUARDANDO RESPOSTA: follow-up items ---
  const waiting = focusItems.filter((i) => isFollowUp(i) && !urgentIds.has(i.id));
  if (waiting.length > 0) {
    lines.push("");
    lines.push("AGUARDANDO RESPOSTA:");
    for (const item of waiting.slice(0, 3)) {
      const who = item.followUpWith || "pendente";
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (cobrar: ${who})`);
    }
  }

  // --- PARADOS: stale items ---
  if (staleItems && staleItems.length > 0) {
    lines.push("");
    lines.push("PARADOS (preciso de um update seu):");
    for (const item of staleItems.slice(0, 3)) {
      const days = daysAgo(item.createdAt);
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (${days}d parado)`);
      lines.push(`  Ja resolveu? /done ${item.id}`);
    }
  }

  // Footer
  if (urgentImportant.length === 0 && important.length === 0 && (!staleItems || staleItems.length === 0)) {
    lines.push("");
    lines.push("Tudo em dia! Nenhuma pendencia critica.");
  } else {
    lines.push("");
    lines.push("Me mande um audio com o status do que andou.");
  }

  return lines.join("\n");
}

export function buildAfternoonMessage(overdueItems: OpenActionItem[], staleItems: OpenActionItem[]): string {
  const lines: string[] = ["Boa tarde! Cobranca rapida:"];

  if (overdueItems.length > 0) {
    lines.push("");
    for (const item of overdueItems.slice(0, 3)) {
      const days = item.dueAt ? daysAgo(item.dueAt) : 0;
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (${days}d atrasado)`);
      lines.push(`  Ja resolveu? /done ${item.id}`);
    }
  }

  if (staleItems.length > 0 && overdueItems.length < 3) {
    lines.push("");
    lines.push("Tambem quero saber sobre:");
    for (const item of staleItems.slice(0, 2)) {
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr}`);
      lines.push(`  Alguma novidade? Me conta ou /done ${item.id}`);
    }
  }

  lines.push("");
  lines.push("Se algo esta travado, me fala o que esta impedindo.");

  return lines.join("\n");
}

export function buildEveningMessage(
  doneToday: number,
  openHighPriority: OpenActionItem[]
): string {
  const lines: string[] = ["Boa noite! Fechamento do dia:"];

  if (doneToday > 0) {
    lines.push(`Voce resolveu ${doneToday} ${doneToday === 1 ? "item" : "itens"} hoje.`);
  } else {
    lines.push("Nenhum item foi fechado hoje.");
  }

  if (openHighPriority.length > 0) {
    lines.push("");
    lines.push("Para amanha, priorize:");
    for (const item of openHighPriority.slice(0, 3)) {
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr}`);
    }
  }

  lines.push("");
  lines.push("Tem algo que ficou na cabeca e nao registrou? Me manda agora.");

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
  const ratio = summary.items > 0
    ? Math.round((summary.doneActions / Math.max(summary.items, 1)) * 100)
    : 0;

  const topCategories =
    summary.topCategories.length > 0
      ? summary.topCategories.map((item) => `${item.name} (${item.total})`).join(", ")
      : "Sem destaque";

  const lines: string[] = [
    "Resumo semanal do Second Brain:",
    "",
    `Capturados: ${summary.items} | Concluidos: ${summary.doneActions} | Abertos: ${summary.openActions}`,
    `Taxa de resolucao: ${ratio}%`,
    `Categorias ativas: ${topCategories}`
  ];

  if (summary.nextWeekPriorities.length > 0) {
    lines.push("");
    lines.push("Prioridades da proxima semana:");
    for (const item of summary.nextWeekPriorities) {
      lines.push(`- ${actionLabel(item)}`);
    }
  }

  if (summary.openActions > 10) {
    lines.push("");
    lines.push(`Atencao: ${summary.openActions} itens abertos. Considere eliminar o que nao faz mais sentido.`);
  }

  lines.push("");
  lines.push("Use /prioridades para ver a fila completa.");

  return lines.join("\n");
}

// ── Marta (Chief of Staff) proactive messages ─────────────────────────

export function buildMartaPreOneOnOneAlert(
  people: Array<Person & { pendingCount: number }>
): string | null {
  if (people.length === 0) return null;

  const lines: string[] = ["Marta aqui. Lembrete de 1:1s pendentes:"];
  lines.push("");

  for (const person of people) {
    const pendingNote = person.pendingCount > 0
      ? ` (${person.pendingCount} item${person.pendingCount > 1 ? "s" : ""} pendente${person.pendingCount > 1 ? "s" : ""})`
      : "";
    lines.push(`- ${person.name}${person.role ? ` (${person.role})` : ""}${pendingNote}`);
  }

  lines.push("");
  lines.push("Quer que eu prepare um briefing? Diga: \"Marta briefing [nome]\"");

  return lines.join("\n");
}

export function buildMartaCrossTeamInsight(
  insights: Array<{ type: string; message: string }>
): string | null {
  if (insights.length === 0) return null;

  const lines: string[] = ["Marta aqui — insights da semana:"];
  lines.push("");

  for (const insight of insights) {
    lines.push(`- ${insight.message}`);
  }

  lines.push("");
  lines.push("Quer um panorama completo? Diga: \"Marta como ta a equipe?\"");

  return lines.join("\n");
}

export function buildMartaStrategicNudge(nudge: string): string {
  return `Marta aqui — reflexao quinzenal:\n\n${nudge}\n\nPara uma analise mais profunda: "Marta reflexao"`;
}
