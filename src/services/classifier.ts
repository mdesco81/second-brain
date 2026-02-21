import { ActionPriority, ClassificationResult } from "../types/domain.js";
import { listCategories } from "../db/schema.js";
import { classifyWithAI } from "./openai.js";

const KEYWORD_RULES: Array<{
  keywords: string[];
  categoryName: string;
  description: string;
  bucket: ClassificationResult["bucket"];
  action: ClassificationResult["action"];
}> = [
  {
    keywords: ["cliente", "venda", "faturamento", "pipeline", "negocio"],
    categoryName: "Negocios",
    description: "Clientes, vendas, operacoes e estrategia",
    bucket: "PROJECTS",
    action: "CREATE_TASK"
  },
  {
    keywords: ["treino", "consulta", "exame", "saude", "medico"],
    categoryName: "Saude",
    description: "Consultas, exames, rotina fisica e bem-estar",
    bucket: "AREAS",
    action: "CREATE_TASK"
  },
  {
    keywords: ["curso", "aula", "livro", "estudo", "aprendi"],
    categoryName: "Estudos",
    description: "Aprendizado, cursos, leitura e pesquisa",
    bucket: "RESOURCES",
    action: "STORE_REFERENCE"
  },
  {
    keywords: ["imposto", "nota fiscal", "investimento", "financeiro", "orcamento"],
    categoryName: "Financeiro",
    description: "Fluxo de caixa, impostos, investimentos e custos",
    bucket: "AREAS",
    action: "CREATE_TASK"
  }
];

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function cleanSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  const cleaned = cleanSpaces(value);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizeActionTitle(value: string | undefined, action: ClassificationResult["action"], fallbackText: string): string {
  if (value && cleanSpaces(value)) {
    return truncateText(value, 90);
  }
  if (action === "CREATE_PROJECT") {
    return "Definir escopo e proximo marco do projeto";
  }
  if (action === "CREATE_TASK") {
    return "Executar tarefa prioritaria";
  }
  if (action === "FOLLOW_UP") {
    return "Fazer follow-up para destravar";
  }
  if (action === "STORE_REFERENCE") {
    return "Registrar referencia util";
  }
  return truncateText(fallbackText, 90);
}

function normalizePriority(priority?: string): ActionPriority {
  if (priority === "ALTA" || priority === "MEDIA" || priority === "BAIXA") {
    return priority;
  }
  return "MEDIA";
}

function normalizeDueDate(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const asDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime())) {
    return undefined;
  }
  return value;
}

function inferDueDateFromText(text: string): string | undefined {
  const normalized = text.toLowerCase();
  const now = new Date();

  if (/\b(hoje)\b/.test(normalized)) {
    return now.toISOString().slice(0, 10);
  }
  if (/\b(amanha)\b/.test(normalized)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }
  if (/\b(esta semana|essa semana|ate sexta)\b/.test(normalized)) {
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 5);
    return weekEnd.toISOString().slice(0, 10);
  }

  return undefined;
}

function inferDueDateFromPriority(priority: ActionPriority): string {
  const now = new Date();
  const due = new Date(now);
  if (priority === "ALTA") {
    due.setDate(now.getDate() + 1);
  } else if (priority === "MEDIA") {
    due.setDate(now.getDate() + 3);
  } else {
    due.setDate(now.getDate() + 7);
  }
  return due.toISOString().slice(0, 10);
}

function inferFallbackPriority(text: string): ActionPriority {
  const normalized = text.toLowerCase();
  if (/\b(urgente|hoje|agora|prazo|deadline|ate amanha)\b/.test(normalized)) {
    return "ALTA";
  }
  if (/\b(semana|planejar|quando der|depois)\b/.test(normalized)) {
    return "BAIXA";
  }
  return "MEDIA";
}

function inferFollowUpWith(text: string): string | undefined {
  const patterns = [
    /@([a-zA-Z0-9_]{2,32})/,
    /\b(?:cobrar|falar com|alinhar com|aguardando|pendente com|depende de|validar com)\s+([a-zA-ZÀ-ÿ0-9 _-]{2,60})/i,
    /\b(?:cliente|fornecedor|time|squad)\s+([a-zA-ZÀ-ÿ0-9 _-]{2,60})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return truncateText(match[1], 60);
    }
  }

  return undefined;
}

function normalizeFollowUpWith(value: string | undefined, action: ClassificationResult["action"], rawText: string): string | undefined {
  const inferred = value && cleanSpaces(value) ? value : inferFollowUpWith(rawText);
  if (inferred) {
    return truncateText(inferred, 60);
  }
  if (action === "NONE") {
    return undefined;
  }
  return "Definir responsavel e cobrar atualizacao";
}

function defaultNextStepByAction(action: ClassificationResult["action"]): string | undefined {
  if (action === "CREATE_PROJECT") {
    return "Definir escopo, responsavel e primeiro marco com prazo.";
  }
  if (action === "CREATE_TASK") {
    return "Executar o primeiro passo concreto e atualizar status no board.";
  }
  if (action === "FOLLOW_UP") {
    return "Enviar cobranca objetiva com prazo e confirmar proximo checkpoint.";
  }
  if (action === "STORE_REFERENCE") {
    return "Registrar insight util e vincular ao contexto/projeto correto.";
  }
  return undefined;
}

function extractKeyFacts(text: string): { people: string[]; actionVerbs: string[]; shortSummary: string } {
  const people: string[] = [];
  // Capture capitalized names (2+ letters) that appear after common preposition patterns or standalone
  const namePatterns = [
    /\b(?:com|para|do|da|de|ao|pela|pelo)\s+([A-ZÀ-Ÿ][a-zà-ÿ]{1,20}(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]{1,20})?)/g,
    /\b([A-ZÀ-Ÿ][a-zà-ÿ]{2,20})\b/g
  ];
  const stopWords = new Set(["audio", "que", "como", "para", "sobre", "isso", "aqui", "esse", "essa", "ainda", "muito", "mais", "uma", "voce", "precisamos", "preciso", "precisa"]);
  for (const pattern of namePatterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (name && name.length > 1 && !stopWords.has(name.toLowerCase()) && !people.includes(name)) {
        people.push(name);
      }
    }
  }

  const verbPatterns = /\b(agendar|marcar|ligar|enviar|cobrar|revisar|levar|buscar|pagar|comprar|resolver|fazer|falar|confirmar|cancelar|verificar|organizar|preparar|entregar|atualizar)\b/gi;
  const actionVerbs: string[] = [];
  for (const match of text.matchAll(verbPatterns)) {
    const verb = match[1].toLowerCase();
    if (!actionVerbs.includes(verb)) {
      actionVerbs.push(verb);
    }
  }

  // Build a cleaner summary: first sentence or up to 120 chars, cleaned up
  const sentences = text.replace(/\s+/g, " ").trim().split(/[.!?]+/).filter(Boolean);
  const shortSummary = truncateText(sentences[0] || text, 120);

  return { people, actionVerbs, shortSummary };
}

function buildFallbackActionTitle(facts: { actionVerbs: string[]; people: string[]; shortSummary: string }): string {
  const verb = facts.actionVerbs[0];
  const person = facts.people[0];
  if (verb && person) {
    return `${verb.charAt(0).toUpperCase() + verb.slice(1)} — ${person}`;
  }
  if (verb) {
    return `${verb.charAt(0).toUpperCase() + verb.slice(1)} — definir detalhes`;
  }
  return truncateText(facts.shortSummary, 60);
}

function fallbackClassification(text: string): ClassificationResult {
  const normalized = text.toLowerCase();
  const matched = KEYWORD_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  const priority = inferFallbackPriority(text);
  const facts = extractKeyFacts(text);

  if (matched) {
    const dueDateISO = inferDueDateFromText(text) || inferDueDateFromPriority(priority);
    const actionTitle = buildFallbackActionTitle(facts);
    return {
      summaryPtBr: facts.shortSummary,
      categoryName: matched.categoryName,
      categoryDescription: matched.description,
      bucket: matched.bucket,
      action: matched.action,
      actionTitle,
      actionDetails: text,
      nextStepPtBr: defaultNextStepByAction(matched.action),
      followUpWithPtBr: facts.people[0] || normalizeFollowUpWith(undefined, matched.action, text),
      dueDateISO,
      priority,
      confidence: 0.62,
      shouldCreateCategory: false
    };
  }

  const hasAction = facts.actionVerbs.length > 0;
  const action = hasAction ? "CREATE_TASK" as const : "FOLLOW_UP" as const;
  const bucket = hasAction ? "AREAS" as const : "RESEARCH" as const;
  const actionTitle = buildFallbackActionTitle(facts);

  return {
    summaryPtBr: facts.shortSummary,
    categoryName: "Inbox Geral",
    categoryDescription: "Itens ainda sem classificacao especifica",
    bucket,
    action,
    actionTitle,
    actionDetails: text,
    nextStepPtBr: defaultNextStepByAction(action),
    followUpWithPtBr: facts.people[0] || normalizeFollowUpWith(undefined, action, text),
    dueDateISO: inferDueDateFromText(text) || inferDueDateFromPriority(priority),
    priority,
    confidence: 0.5,
    shouldCreateCategory: true
  };
}

export async function classifyContent(rawText: string): Promise<ClassificationResult> {
  const categories = await listCategories();

  const aiResult = await classifyWithAI({
    text: rawText,
    knownCategories: categories.map((category) => ({
      name: category.name,
      description: category.description
    }))
  });

  if (!aiResult) {
    return fallbackClassification(rawText);
  }

  const action = aiResult.action;
  const summaryPtBr = truncateText(aiResult.summaryPtBr || rawText, 400);
  const priority = normalizePriority(aiResult.priority);
  const nextStepPtBrRaw = aiResult.nextStepPtBr ? truncateText(aiResult.nextStepPtBr, 160) : undefined;
  const nextStepPtBr = nextStepPtBrRaw || (action === "NONE" ? undefined : defaultNextStepByAction(action));
  const dueDateISO =
    normalizeDueDate(aiResult.dueDateISO) ||
    inferDueDateFromText(rawText) ||
    (action === "NONE" ? undefined : inferDueDateFromPriority(priority));
  const actionTitle = normalizeActionTitle(aiResult.actionTitle, action, summaryPtBr);
  const followUpWithPtBr = normalizeFollowUpWith(aiResult.followUpWithPtBr, action, rawText);

  return {
    summaryPtBr,
    categoryName: aiResult.categoryName,
    categoryDescription: aiResult.categoryDescription,
    bucket: aiResult.bucket,
    action,
    actionTitle,
    actionDetails: aiResult.actionDetails,
    nextStepPtBr,
    followUpWithPtBr,
    dueDateISO,
    priority,
    confidence: clampConfidence(aiResult.confidence),
    shouldCreateCategory: aiResult.shouldCreateCategory,
    followUpQuestionPtBr: aiResult.followUpQuestionPtBr
  };
}
