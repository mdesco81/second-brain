import { env } from "../../config/env.js";
import { log } from "../../utils/logger.js";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

const BLOCKED_DOMAINS = [
  "-wikipedia.org",
  "-en.wikipedia.org",
  "-pt.wikipedia.org",
  "-prnewswire.com",
  "-businesswire.com",
  "-globenewswire.com",
  "-prweb.com",
  "-newswire.com"
];

export interface PerplexityResult {
  text: string;
  citations: string[];
  model: string;
}

export type SearchMode = "simple" | "deep";

/** Returns MM/DD/YYYY date string for N months ago */
function dateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** Extract citations from a Perplexity API response */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCitations(data: Record<string, any>, text: string): string[] {
  let citations: string[] = [];

  // Location 1: top-level citations array (sonar)
  if (Array.isArray(data.citations) && data.citations.length > 0) {
    citations = data.citations.filter((c: unknown) => typeof c === "string");
  }

  // Location 2: message-level citations (some sonar models)
  if (citations.length === 0) {
    const msgCitations = data.choices?.[0]?.message?.citations;
    if (Array.isArray(msgCitations) && msgCitations.length > 0) {
      citations = msgCitations.filter((c: unknown) => typeof c === "string");
    }
  }

  // Location 3: search_results field (sonar-deep-research)
  if (citations.length === 0 && Array.isArray(data.search_results)) {
    citations = data.search_results
      .map((r: { url?: string }) => r.url)
      .filter((url: unknown): url is string => typeof url === "string");
  }

  // Fallback: extract URLs from the response text itself
  if (citations.length === 0) {
    const urlPattern = /https?:\/\/[^\s)\]>"']+/g;
    const foundUrls = text.match(urlPattern) || [];
    citations = [...new Set(foundUrls)];
    if (citations.length > 0) {
      log.info("perplexity:citations_extracted_from_text", { count: citations.length });
    }
  }

  return citations;
}

/** Single Perplexity API call */
async function callPerplexity(
  query: string,
  model: string,
  systemPrompt: string
): Promise<PerplexityResult | null> {
  try {
    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        search_domain_filter: BLOCKED_DOMAINS,
        return_citations: true,
        search_after_date_filter: dateMonthsAgo(6)
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      log.error("Perplexity API error", { status: response.status, body: errorBody, model });
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as Record<string, any>;

    log.info("perplexity:response_shape", {
      model,
      topLevelKeys: Object.keys(data),
      hasCitations: Boolean(data.citations),
      citationsCount: Array.isArray(data.citations) ? data.citations.length : 0,
      hasChoices: Boolean(data.choices?.length),
      messageKeys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [],
      messageCitationsCount: Array.isArray(data.choices?.[0]?.message?.citations)
        ? data.choices[0].message.citations.length
        : 0
    });

    const text = data.choices?.[0]?.message?.content?.trim() as string | undefined;
    if (!text) {
      log.warn("Perplexity returned empty response", { model });
      return null;
    }

    const citations = extractCitations(data, text);

    log.info("perplexity:final_citations", {
      model,
      citationsCount: citations.length,
      firstCitation: citations[0] || "none"
    });

    return { text, citations, model: (data.model as string) ?? model };
  } catch (error) {
    log.error("Perplexity search failed", { error, model, query });
    return null;
  }
}

const SYSTEM_PROMPT_BASE = [
  "Voce e um pesquisador especializado em conteudo profissional para LinkedIn.",
  "Foque em dados concretos, tendencias recentes, estatisticas e exemplos praticos.",
  "Priorize fontes confiaveis: artigos de especialistas, relatorios de mercado, pesquisas academicas.",
  "Responda em portugues brasileiro."
].join(" ");

const SYSTEM_PROMPT_CASES = [
  "Voce e um pesquisador especializado em casos reais e exemplos praticos.",
  "Busque estudos de caso de empresas, experiencias de profissionais, resultados concretos e licoes aprendidas.",
  "Priorize fontes primarias: relatos de practitioners, entrevistas, case studies publicados.",
  "Responda em portugues brasileiro."
].join(" ");

export async function searchWithPerplexity(
  query: string,
  mode: SearchMode
): Promise<PerplexityResult | null> {
  if (!env.PERPLEXITY_API_KEY) {
    log.warn("searchWithPerplexity skipped — PERPLEXITY_API_KEY not set");
    return null;
  }

  const model = mode === "deep" ? "sonar-deep-research" : "sonar";

  if (mode === "simple") {
    // Posts: single query
    return callPerplexity(query, model, SYSTEM_PROMPT_BASE);
  }

  // Articles: multi-query — two parallel searches with different angles
  const casesQuery = query.replace(
    /pesquisa aprofundada sobre/i,
    "casos reais, exemplos praticos e experiencias de empresas sobre"
  );

  const [mainResult, casesResult] = await Promise.all([
    callPerplexity(query, model, SYSTEM_PROMPT_BASE),
    callPerplexity(casesQuery, "sonar", SYSTEM_PROMPT_CASES)
  ]);

  if (!mainResult && !casesResult) return null;

  // Merge results
  const textParts: string[] = [];
  const allCitations: string[] = [];

  if (mainResult) {
    textParts.push("## Dados e tendencias", "", mainResult.text);
    allCitations.push(...mainResult.citations);
  }

  if (casesResult) {
    textParts.push("", "## Casos e exemplos praticos", "", casesResult.text);
    for (const url of casesResult.citations) {
      if (!allCitations.includes(url)) {
        allCitations.push(url);
      }
    }
  }

  log.info("perplexity:multi_query_merged", {
    mainCitations: mainResult?.citations.length ?? 0,
    casesCitations: casesResult?.citations.length ?? 0,
    totalCitations: allCitations.length
  });

  return {
    text: textParts.join("\n"),
    citations: allCitations,
    model: mainResult?.model ?? casesResult?.model ?? model
  };
}

export function formatResearchContext(result: PerplexityResult): string {
  const lines: string[] = [
    "## Pesquisa realizada",
    "",
    result.text
  ];

  if (result.citations.length > 0) {
    lines.push("", "## Fontes");
    for (const url of result.citations) {
      lines.push(`- ${url}`);
    }
  }

  return lines.join("\n");
}
