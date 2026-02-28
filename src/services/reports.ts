import { CalendarEvent, Commitment, CosMemory, Decision, OpenActionItem, PendingDraft, Person } from "../db/schema.js";

function actionLabel(item: OpenActionItem): string {
  const title = item.actionTitle || item.summaryPtBr;
  const due = item.dueAt ? ` | prazo ${item.dueAt}` : "";
  const followUp = item.followUpWith ? ` | cobrar ${item.followUpWith}` : "";
  return `#${item.id} [${item.priority}] ${title}${due}${followUp}`;
}

function daysAgo(dateStr: string): number {
  const time = new Date(dateStr).getTime();
  if (isNaN(time)) return 0;
  const diff = Date.now() - time;
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

export interface TeamStat {
  person: Person;
  openCount: number;
  overdueCount: number;
  daysSinceOneOnOne: number | null;
  hasOneOnOneToday: boolean;
}

export function buildDailyMessage(
  snapshot: { items: number; projects: number; categoriesUsed: number },
  focusItems: OpenActionItem[],
  overdueItems?: OpenActionItem[],
  staleItems?: OpenActionItem[],
  calendarEvents?: CalendarEvent[],
  teamStats?: TeamStat[],
  pendingDrafts?: PendingDraft[],
  overdueCommitments?: Commitment[]
): string {
  // Header with day of week
  const dayNames = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const now = new Date();
  const dayName = dayNames[now.getDay()];
  const dateStr = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}`;

  const lines: string[] = [
    `Bom dia! Aqui seu briefing de hoje (${dayName}, ${dateStr}):`
  ];

  if (snapshot.items > 0) {
    lines.push(`(${snapshot.items} novos itens capturados ontem)`);
  }

  // --- AGENDA (calendar events) ---
  if (calendarEvents && calendarEvents.length > 0) {
    lines.push("");
    lines.push("📅 AGENDA");
    for (const event of calendarEvents) {
      const startTime = new Date(event.startAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const attendeeCount = event.attendees.length;
      let eventLine = `${startTime} — ${event.title}`;

      if (event.isOneOnOne && event.personId) {
        // Will show person name in the event title if available
        const briefTag = event.preBriefSent ? " [Brief preparado ✓]" : "";
        eventLine += briefTag;
      } else if (attendeeCount > 0) {
        eventLine += ` [${attendeeCount} participante${attendeeCount > 1 ? "s" : ""}]`;
      }
      lines.push(`- ${eventLine}`);
    }
  }

  // --- URGENTE & IMPORTANTE: overdue + high priority due today ---
  const urgentImportant = [
    ...(overdueItems || []),
    ...focusItems.filter((i) => i.priority === "ALTA" && !overdueItems?.find((o) => o.id === i.id))
  ];

  if (urgentImportant.length > 0) {
    lines.push("");
    lines.push("⚡ URGENTE & IMPORTANTE:");
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
    lines.push("📋 IMPORTANTE (pra essa semana):");
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
    lines.push("⏳ AGUARDANDO RESPOSTA:");
    for (const item of waiting.slice(0, 3)) {
      const who = item.followUpWith || "pendente";
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (cobrar: ${who})`);
    }
  }

  // --- EQUIPE (team stats) ---
  if (teamStats && teamStats.length > 0) {
    lines.push("");
    lines.push("👥 EQUIPE");
    for (const stat of teamStats) {
      const parts: string[] = [];
      parts.push(`${stat.openCount} aberto${stat.openCount !== 1 ? "s" : ""}`);
      if (stat.overdueCount > 0) {
        parts.push(`${stat.overdueCount} atrasado${stat.overdueCount !== 1 ? "s" : ""}`);
      } else {
        parts.push("0 atrasados");
      }

      let oneOnOneInfo: string;
      if (stat.hasOneOnOneToday) {
        oneOnOneInfo = "1:1 hoje";
      } else if (stat.daysSinceOneOnOne === null) {
        oneOnOneInfo = "sem 1:1 registrado";
      } else if (stat.daysSinceOneOnOne > 14) {
        oneOnOneInfo = `ultimo 1:1: ${stat.daysSinceOneOnOne}d ⚠️`;
      } else {
        oneOnOneInfo = `ultimo 1:1: ${stat.daysSinceOneOnOne}d`;
      }

      const roleSuffix = stat.person.role ? ` (${stat.person.role})` : "";
      lines.push(`- ${stat.person.name}${roleSuffix}: ${parts.join(", ")} | ${oneOnOneInfo}`);
    }
  }

  // --- COMPROMISSOS VENCIDOS ---
  if (overdueCommitments && overdueCommitments.length > 0) {
    lines.push("");
    lines.push("🤝 COMPROMISSOS VENCIDOS:");
    for (const c of overdueCommitments.slice(0, 5)) {
      const label = c.direction === "mine" ? "Meu" : "De terceiro";
      const days = c.deadline ? daysAgo(c.deadline) : 0;
      lines.push(`- [${label}] ${c.summary} (${days}d atrasado)`);
    }
  }

  // --- PARADOS: stale items ---
  if (staleItems && staleItems.length > 0) {
    lines.push("");
    lines.push("🔴 PARADOS (preciso de um update seu):");
    for (const item of staleItems.slice(0, 3)) {
      const days = daysAgo(item.createdAt);
      lines.push(`- #${item.id} ${item.actionTitle || item.summaryPtBr} (${days}d parado)`);
      lines.push(`  Ja resolveu? /done ${item.id}`);
    }
  }

  // --- CONTENT (pending drafts from Ghostwriter) ---
  if (pendingDrafts && pendingDrafts.length > 0) {
    lines.push("");
    lines.push("📝 CONTENT (Jarbas)");
    for (const draft of pendingDrafts) {
      const typeLabel = draft.contentType === "article" ? "Artigo" : "Post";
      lines.push(`- ${typeLabel} pronto: "${draft.topic}" — revisar?`);
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

// ── Calendar-driven proactive messages ───────────────────────────────

export function buildPreMeetingBrief(params: {
  event: CalendarEvent;
  person?: Person;
  openItems: OpenActionItem[];
  memories: CosMemory[];
  pendingDecisions: Decision[];
  commitments?: Commitment[];
  lastNotes?: string | null;
  minutesUntil: number;
}): string {
  const lines: string[] = [];
  const timeLabel = params.minutesUntil <= 5 ? "Em poucos minutos" : `Em ~${params.minutesUntil}min`;

  if (params.person) {
    lines.push(`📅 ${timeLabel}: 1:1 com ${params.person.name}${params.person.role ? ` (${params.person.role})` : ""}`);
  } else {
    const attendeeNames = params.event.attendees.map((a) => a.name || a.email).join(", ");
    lines.push(`📅 ${timeLabel}: ${params.event.title}${attendeeNames ? ` [${attendeeNames}]` : ""}`);
  }

  // Suggested agenda from open items
  if (params.openItems.length > 0) {
    lines.push("");
    lines.push("📋 Pauta sugerida:");
    for (const item of params.openItems.slice(0, 5)) {
      const overdueTag = item.dueAt && new Date(item.dueAt) < new Date()
        ? ` — ${daysAgo(item.dueAt)}d atrasado`
        : item.dueAt ? ` — prazo: ${item.dueAt}` : "";
      lines.push(`• #${item.id} ${item.actionTitle || item.summaryPtBr}${overdueTag}`);
    }
  }

  // Open commitments
  if (params.commitments && params.commitments.length > 0) {
    const mine = params.commitments.filter(c => c.direction === "mine");
    const theirs = params.commitments.filter(c => c.direction === "theirs");
    lines.push("");
    lines.push("🤝 Compromissos abertos:");
    if (mine.length > 0) {
      for (const c of mine.slice(0, 3)) {
        const dl = c.deadline ? ` (ate ${c.deadline})` : "";
        lines.push(`• Eu: ${c.summary}${dl}`);
      }
    }
    if (theirs.length > 0) {
      for (const c of theirs.slice(0, 3)) {
        const dl = c.deadline ? ` (ate ${c.deadline})` : "";
        lines.push(`• ${params.person?.name ?? "Outro"}: ${c.summary}${dl}`);
      }
    }
  }

  // Pending decisions
  if (params.pendingDecisions.length > 0) {
    lines.push("");
    lines.push("📋 Decisoes pendentes:");
    for (const d of params.pendingDecisions.slice(0, 3)) {
      const age = daysAgo(d.decidedAt);
      lines.push(`• ${d.summary} (ha ${age} dias)`);
    }
  }

  // Person context from memories
  if (params.memories.length > 0 && params.person) {
    lines.push("");
    lines.push("💡 Contexto:");
    for (const mem of params.memories.slice(0, 3)) {
      lines.push(`• ${mem.content}`);
    }
  }

  // Last 1:1 info
  if (params.person?.lastOneOnOne) {
    const days = daysAgo(params.person.lastOneOnOne);
    lines.push(`\nUltimo 1:1: ${days} dia${days !== 1 ? "s" : ""} atras`);
  }

  lines.push("");
  if (params.person) {
    lines.push(`Briefing completo? \"Marta briefing ${params.person.name}\"`);
  }

  return lines.join("\n");
}

export function buildPostMeetingPrompt(params: {
  event: CalendarEvent;
  person?: Person;
}): string {
  if (params.person) {
    return `Acabou a reuniao com ${params.person.name}${params.person.role ? ` (${params.person.role})` : ""}. Quer me passar as notas?\n\nPode mandar texto, audio ou PDF que eu processo e extraio os action items.`;
  }
  return `Acabou: ${params.event.title}. Alguma nota ou decisao para registrar?\n\nPode mandar texto, audio ou PDF.`;
}
