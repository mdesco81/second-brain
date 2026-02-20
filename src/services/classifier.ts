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
      actionTitle: matched.action === "CREATE_TASK" ? "Nova acao sugerida" : "Referencia registrada",
      actionDetails: text,
      nextStepPtBr: matched.action === "CREATE_TASK" ? "Definir responsavel e primeiro passo objetivo." : undefined,
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

  return {
    summaryPtBr: aiResult.summaryPtBr,
    categoryName: aiResult.categoryName,
    categoryDescription: aiResult.categoryDescription,
    bucket: aiResult.bucket,
    action: aiResult.action,
    actionTitle: aiResult.actionTitle,
    actionDetails: aiResult.actionDetails,
    nextStepPtBr: aiResult.nextStepPtBr,
    dueDateISO: normalizeDueDate(aiResult.dueDateISO),
    priority: normalizePriority(aiResult.priority),
    confidence: clampConfidence(aiResult.confidence),
    shouldCreateCategory: aiResult.shouldCreateCategory,
    followUpQuestionPtBr: aiResult.followUpQuestionPtBr
  };
}
