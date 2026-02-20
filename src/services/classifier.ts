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
  return "Responsavel interno";
}

function fallbackClassification(text: string): ClassificationResult {
  const normalized = text.toLowerCase();
  const matched = KEYWORD_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  const priority = inferFallbackPriority(text);

  if (matched) {
    return {
      summaryPtBr: text.slice(0, 240),
      categoryName: matched.categoryName,
      categoryDescription: matched.description,
      bucket: matched.bucket,
      action: matched.action,
      actionTitle: matched.action === "CREATE_TASK" ? "Executar proxima etapa do tema" : "Registrar referencia relevante",
      actionDetails: text,
      nextStepPtBr: matched.action === "CREATE_TASK" ? "Definir responsavel e primeiro passo objetivo." : undefined,
      followUpWithPtBr: normalizeFollowUpWith(undefined, matched.action, text),
      dueDateISO: inferDueDateFromText(text),
      priority,
      confidence: 0.62,
      shouldCreateCategory: false
    };
  }

  return {
    summaryPtBr: text.slice(0, 240),
    categoryName: "Inbox Geral",
    categoryDescription: "Itens ainda sem classificacao especifica",
    bucket: "RESEARCH",
    action: "FOLLOW_UP",
    actionTitle: "Solicitar contexto",
    actionDetails: "Item precisa de mais contexto para acao concreta.",
    nextStepPtBr: "Responder com contexto adicional: objetivo, prazo e resultado esperado.",
    followUpWithPtBr: normalizeFollowUpWith(undefined, "FOLLOW_UP", text),
    dueDateISO: inferDueDateFromText(text),
    priority,
    confidence: 0.45,
    shouldCreateCategory: true,
    followUpQuestionPtBr: "Pode me dar mais contexto para eu organizar isso melhor?"
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
  const summaryPtBr = truncateText(aiResult.summaryPtBr || rawText, 220);
  const nextStepPtBr = aiResult.nextStepPtBr ? truncateText(aiResult.nextStepPtBr, 160) : undefined;
  const dueDateISO = normalizeDueDate(aiResult.dueDateISO) || inferDueDateFromText(rawText);
  const priority = normalizePriority(aiResult.priority);
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
