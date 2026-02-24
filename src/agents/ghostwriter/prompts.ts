export function buildGhostwriterPrompt(params: {
  contentType: "post" | "article";
  topic: string;
  styleGuide: string;
  bestPractices: string;
  learnedStyle: string;
  referenceSamples: string[];
  researchContext: string;
  additionalInstructions?: string;
}): { system: string; user: string } {
  const isArticle = params.contentType === "article";

  const formatGuidelines = isArticle
    ? [
        "FORMATO: Artigo LinkedIn — formato longo (900 a 1500 palavras)",
        "- Produza EXATAMENTE UM artigo completo. NAO gere multiplas opcoes ou variantes.",
        "- Titulo forte e especifico (nao generico)",
        "- Subtitulos claros (H2/H3) para estruturar o texto a cada 200-400 palavras",
        "- Paragrafos curtos (3-4 linhas max)",
        "- Analise aprofundada: explore causas, consequencias, exemplos reais e dados da pesquisa",
        "- Inclua pelo menos 3-5 dados, estatisticas ou exemplos concretos da pesquisa",
        "- Fechamento com reflexao e call-to-action",
        "- 3-5 hashtags relevantes ao final (linha separada)",
        "- IMPORTANTE: o texto deve ter entre 900 e 1500 palavras. Menos que isso esta incompleto."
      ]
    : [
        "FORMATO: Post LinkedIn — formato curto e de alto impacto (150 a 300 palavras)",
        "- Produza EXATAMENTE UM post. NAO gere multiplas opcoes ou variantes.",
        "- Gancho forte na primeira linha (frase curta, provocativa, que faz parar o scroll)",
        "- Espacamento generoso: 1-3 linhas por paragrafo, nunca blocos densos de texto",
        "- Use quebras de linha para criar ritmo e impacto visual",
        "- Foque em UMA ideia central com 1-2 dados ou exemplos concretos",
        "- Fechamento com pergunta aberta ou call-to-action para engajamento",
        "- 3-5 hashtags relevantes no final (linha separada)",
        "- IMPORTANTE: o texto deve ter entre 150 e 300 palavras. Post LinkedIn ideal e conciso."
      ];

  const systemParts: string[] = [
    "Voce e um ghostwriter profissional especializado em conteudo para LinkedIn.",
    "Escreva em portugues brasileiro, de forma natural e autoral.",
    "",
    "## Diretrizes de formato",
    ...formatGuidelines,
    ""
  ];

  // Layer 1: Base style guide
  if (params.styleGuide) {
    systemParts.push(
      "## Guia de estilo base",
      params.styleGuide,
      ""
    );
  }

  // Layer 2: Learned style (takes priority over base)
  if (params.learnedStyle) {
    systemParts.push(
      "## Padroes aprendidos (PRIORIDADE sobre o guia base)",
      "Os padroes abaixo foram extraidos de edicoes reais do autor.",
      "Quando houver conflito com o guia de estilo base, PRIORIZE estes padroes.",
      "",
      params.learnedStyle,
      ""
    );
  }

  // Layer 3: Reference samples
  if (params.referenceSamples.length > 0) {
    systemParts.push(
      "## Exemplos de referencia (versoes finais do autor)",
      "Estude o tom, vocabulario e estrutura destes exemplos reais:",
      ""
    );
    for (let i = 0; i < params.referenceSamples.length; i++) {
      systemParts.push(
        `### Exemplo ${i + 1}`,
        params.referenceSamples[i],
        ""
      );
    }
  }

  // LinkedIn best practices
  if (params.bestPractices) {
    systemParts.push(
      "## Boas praticas LinkedIn",
      params.bestPractices,
      ""
    );
  }

  systemParts.push(
    "## Instrucoes finais",
    "- Produza EXATAMENTE UM conteudo completo em Markdown. NUNCA gere variantes, opcoes, ou multiplas versoes.",
    "- Nao inclua meta-comentarios, explicacoes sobre o texto, ou frases como 'aqui esta o artigo'",
    "- O output deve ser APENAS o conteudo pronto para publicacao, nada mais",
    "- Seja original: nao copie trechos da pesquisa, use os dados como base para argumentar",
    "- Comece diretamente pelo titulo (# Titulo) sem preambulos"
  );

  const userParts: string[] = [
    `Escreva um ${isArticle ? "artigo" : "post"} para LinkedIn sobre: ${params.topic}`
  ];

  if (params.researchContext) {
    userParts.push("", "## Contexto da pesquisa", params.researchContext);
  }

  if (params.additionalInstructions) {
    userParts.push(
      "",
      "## Instrucoes adicionais do autor",
      params.additionalInstructions
    );
  }

  return {
    system: systemParts.join("\n"),
    user: userParts.join("\n")
  };
}
