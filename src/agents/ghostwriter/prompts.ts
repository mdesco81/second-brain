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
        "FORMATO: Post LinkedIn — formato otimizado para alcance (1300 a 1900 caracteres)",
        "- Produza EXATAMENTE UM post. NAO gere multiplas opcoes ou variantes.",
        "- Gancho forte na primeira linha (frase curta, provocativa, que faz parar o scroll)",
        "- Quebra de linha a cada 1-2 frases. Linha vazia entre paragrafos para criar ritmo visual",
        "- Paragrafos curtos: maximo 2-3 linhas cada. Nunca blocos densos de texto",
        "- Foque em UMA ideia central com 1-2 dados ou exemplos concretos",
        "- NAO inclua links externos no corpo do post (reduz alcance no algoritmo do LinkedIn)",
        "- NAO use engagement bait generico ('Concorda?', 'Curta se...', 'Comenta ai')",
        "- Fechamento com CTA genuino: convite a reflexao, pergunta provocativa real, ou acao concreta",
        "- NAO inclua hashtags no texto — elas serao geradas separadamente",
        "- IMPORTANTE: o texto DEVE ter entre 1300 e 1900 caracteres (incluindo espacos e quebras de linha). Este e o range ideal para maximizar o Depth Score do LinkedIn."
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

export function buildHashtagPrompt(params: {
  topic: string;
  contentType: "post" | "article";
  researchContext: string;
  draft: string;
}): { system: string; user: string } {
  const system = [
    "Voce e um especialista em LinkedIn SEO e hashtags.",
    "Gere hashtags otimizadas para maximizar alcance no LinkedIn.",
    "",
    "## Regras",
    "- Gere exatamente 5-6 hashtags",
    "- Mix obrigatorio: 2 amplas (ex: #Lideranca, #Inovacao, #Gestao) + 2-3 de nicho (ex: #IAGenerativa, #B2BSaaS, #FintechBrasil) + 1 trending/momento",
    "- Use CamelCase em portugues (ex: #InteligenciaArtificial, nao #inteligenciaartificial)",
    "- Sem espacos, sem acentos nas hashtags",
    "- Retorne APENAS um JSON array de strings. Exemplo: [\"#Lideranca\", \"#IAGenerativa\"]",
    "- Nao inclua nenhum texto adicional, explicacao ou formatacao markdown"
  ].join("\n");

  const user = [
    `Gere hashtags para um ${params.contentType === "article" ? "artigo" : "post"} LinkedIn sobre: ${params.topic}`,
    "",
    "## Trecho do conteudo",
    params.draft.slice(0, 800),
    "",
    params.researchContext ? `## Contexto da pesquisa\n${params.researchContext.slice(0, 500)}` : ""
  ].join("\n");

  return { system, user };
}

export function buildHooksPrompt(params: {
  topic: string;
  contentType: "post" | "article";
  researchContext: string;
  learnedStyle: string;
}): { system: string; user: string } {
  const system = [
    "Voce e um copywriter especialista em ganchos (hooks) para LinkedIn.",
    "Gere 5 hooks distintos, um de cada tipo abaixo:",
    "",
    "1. ESTATISTICA — Comece com um dado/numero impactante real (da pesquisa fornecida)",
    "2. CONTRARIO — Desafie uma crenca comum do setor. Comece com 'A maioria acredita...' ou similar",
    "3. HISTORIA — Mini-narrativa pessoal/profissional em 1-2 frases que conecta emocionalmente",
    "4. DOR — Descreva uma frustracao real que o leitor sente no dia-a-dia profissional",
    "5. PERGUNTA — Pergunta provocativa que faz o leitor parar e refletir",
    "",
    "## Regras",
    "- Cada hook deve ter no maximo 2 frases (max 200 caracteres)",
    "- Hooks devem ser em portugues brasileiro, tom profissional mas humano",
    "- Retorne APENAS um JSON array de objetos: [{\"type\": \"ESTATISTICA\", \"text\": \"...\"}]",
    "- Nao inclua nenhum texto adicional, explicacao ou formatacao markdown",
    params.learnedStyle ? `\n## Estilo do autor (para referencia de tom)\n${params.learnedStyle.slice(0, 400)}` : ""
  ].join("\n");

  const user = [
    `Gere 5 hooks para um ${params.contentType === "article" ? "artigo" : "post"} LinkedIn sobre: ${params.topic}`,
    "",
    params.researchContext ? `## Contexto da pesquisa\n${params.researchContext.slice(0, 800)}` : ""
  ].join("\n");

  return { system, user };
}
