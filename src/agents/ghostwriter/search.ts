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

export async function searchWithPerplexity(
  query: string,
  mode: SearchMode
): Promise<PerplexityResult | null> {
  if (!env.PERPLEXITY_API_KEY) {
    log.warn("searchWithPerplexity skipped — PERPLEXITY_API_KEY not set");
    return null;
  }

  const model = mode === "deep" ? "sonar-deep-research" : "sonar";

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
          {
            role: "system",
            content: [
              "Voce e um pesquisador especializado em conteudo profissional para LinkedIn.",
              "Foque em dados concretos, tendencias recentes, estatisticas e exemplos praticos.",
              "Priorize fontes confiaveis: artigos de especialistas, relatorios de mercado, pesquisas academicas.",
              "Responda em portugues brasileiro."
            ].join(" ")
          },
          {
            role: "user",
            content: query
          }
        ],
        search_domain_filter: BLOCKED_DOMAINS,
        return_citations: true,
        search_recency_filter: "month"
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      log.error("Perplexity API error", {
        status: response.status,
        body: errorBody,
        model
      });
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: string[];
      model?: string;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      log.warn("Perplexity returned empty response", { model });
      return null;
    }

    return {
      text,
      citations: data.citations ?? [],
      model: data.model ?? model
    };
  } catch (error) {
    log.error("Perplexity search failed", { error, model, query });
    return null;
  }
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
