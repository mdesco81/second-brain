import { ClassificationResult } from "../types/domain.js";
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

function fallbackClassification(text: string): ClassificationResult {
  const normalized = text.toLowerCase();
  const matched = KEYWORD_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));

  if (matched) {
    return {
      summaryPtBr: text.slice(0, 240),
      categoryName: matched.categoryName,
      categoryDescription: matched.description,
      bucket: matched.bucket,
      action: matched.action,
      actionTitle: matched.action === "CREATE_TASK" ? "Nova acao sugerida" : "Referencia registrada",
      actionDetails: text,
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
    confidence: clampConfidence(aiResult.confidence),
    shouldCreateCategory: aiResult.shouldCreateCategory,
    followUpQuestionPtBr: aiResult.followUpQuestionPtBr
  };
}
