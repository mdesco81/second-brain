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
        "FORMATO: Artigo LinkedIn (2000-4000 palavras)",
        "- Titulo forte e especifico (nao generico)",
        "- Subtitulos claros a cada 300-500 palavras",
        "- Paragrafos curtos (3-4 linhas max)",
        "- Inclua dados, estatisticas e exemplos concretos da pesquisa",
        "- Fechamento com reflexao e call-to-action",
        "- Sem hashtags no corpo do artigo"
      ]
    : [
        "FORMATO: Post LinkedIn (800-1500 palavras)",
        "- Gancho forte na primeira linha (frase curta, provocativa, que faz parar o scroll)",
        "- Espacamento generoso entre paragrafos (1-3 linhas por paragrafo)",
        "- Use quebras de linha para ritmo e impacto",
        "- Inclua 1-2 dados ou exemplos concretos da pesquisa",
        "- Fechamento com pergunta ou call-to-action para engajamento",
        "- 3-5 hashtags relevantes no final (linha separada)"
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
    "- Escreva o conteudo completo em Markdown",
    "- Nao inclua meta-comentarios ou explicacoes sobre o texto",
    "- O output deve ser o conteudo pronto para publicacao",
    "- Seja original: nao copie trechos da pesquisa, use os dados como base"
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
