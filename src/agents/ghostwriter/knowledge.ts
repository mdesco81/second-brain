import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_PATHS } from "../../utils/paths.js";
import { callClaude } from "../../services/openai.js";
import { log } from "../../utils/logger.js";

const KNOWLEDGE_DIR = path.resolve(
  import.meta.dirname ?? path.join(process.cwd(), "src/agents/ghostwriter"),
  "knowledge"
);

const LEARNED_STYLE_PATH = path.join(
  KNOWLEDGE_PATHS.agentOutputs,
  "_learned_style.md"
);

const REFERENCE_SAMPLES_DIR = path.join(
  KNOWLEDGE_PATHS.agentOutputs,
  "_reference_samples"
);

const MAX_REFERENCE_SAMPLES = 5;

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function loadStyleGuide(): Promise<string> {
  const content = await readFileOrNull(
    path.join(KNOWLEDGE_DIR, "style-guide.md")
  );
  return content ?? "";
}

export async function loadBestPractices(): Promise<string> {
  const content = await readFileOrNull(
    path.join(KNOWLEDGE_DIR, "linkedin-best-practices.md")
  );
  return content ?? "";
}

export async function loadLearnedStyle(): Promise<string> {
  const content = await readFileOrNull(LEARNED_STYLE_PATH);
  return content ?? "";
}

export async function loadReferenceContent(): Promise<string[]> {
  const samples: Array<{ name: string; content: string; mtime: number }> = [];

  // Priority 1: user final versions in storage
  try {
    const files = await fs.readdir(REFERENCE_SAMPLES_DIR);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(REFERENCE_SAMPLES_DIR, file);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf8");
      if (content.trim()) {
        samples.push({ name: file, content, mtime: stat.mtimeMs });
      }
    }
  } catch {
    // directory may not exist yet
  }

  // Priority 2: bundled reference samples (fallback)
  if (samples.length === 0) {
    const bundledDir = path.join(KNOWLEDGE_DIR, "reference-samples");
    try {
      const files = await fs.readdir(bundledDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const filePath = path.join(bundledDir, file);
        const stat = await fs.stat(filePath);
        const content = await fs.readFile(filePath, "utf8");
        if (content.trim()) {
          samples.push({ name: file, content, mtime: stat.mtimeMs });
        }
      }
    } catch {
      // no bundled samples
    }
  }

  // Sort by most recent, limit
  samples.sort((a, b) => b.mtime - a.mtime);
  return samples.slice(0, MAX_REFERENCE_SAMPLES).map((s) => s.content);
}

// ── Automatic style learning ─────────────────────────────────────────

export interface StyleLearning {
  category: string;
  rule: string;
  before: string;
  after: string;
}

const ANALYSIS_SYSTEM_PROMPT = `Voce e um analista de estilo de escrita. Recebe duas versoes de um texto:
1. DRAFT: rascunho original gerado por IA
2. FINAL: versao final editada pelo autor humano

Sua tarefa e extrair PADROES CONCRETOS de mudanca que o autor aplicou.

Categorias de analise:
- ESTILO: comprimento de frases, uso de paragrafos, ritmo
- VOCABULARIO: palavras substituidas consistentemente, preferencias lexicais
- ESTRUTURA: secoes adicionadas/removidas, reorganizacao
- TOM: mais/menos formal, assertivo, condicional, direto
- FORMATO: uso de listas, subtitulos, hashtags, emojis, espacamento

Para cada padrao encontrado, retorne:
- category: uma das categorias acima
- rule: descricao clara e acionavel do padrao (ex: "Usar frases mais curtas nos paragrafos de abertura, maximo 15 palavras")
- before: exemplo do draft original
- after: exemplo da versao final

Retorne APENAS um JSON array com os padroes encontrados. Se nao houver diferencas significativas, retorne [].

Exemplo de retorno:
[
  {
    "category": "VOCABULARIO",
    "rule": "Substituir 'utilizar' por 'usar' consistentemente",
    "before": "Podemos utilizar essa ferramenta",
    "after": "Podemos usar essa ferramenta"
  }
]`;

export async function analyzeFinalVersion(
  draftPath: string,
  finalPath: string
): Promise<StyleLearning[]> {
  const draft = await readFileOrNull(draftPath);
  const final = await readFileOrNull(finalPath);

  if (!draft || !final) {
    log.warn("analyzeFinalVersion: missing draft or final", {
      draftPath,
      finalPath
    });
    return [];
  }

  const userMessage = `## DRAFT (rascunho original):\n\n${draft}\n\n---\n\n## FINAL (versao editada pelo autor):\n\n${final}`;

  const response = await callClaude({
    system: ANALYSIS_SYSTEM_PROMPT,
    userMessage,
    model: "fast",
    maxTokens: 4096
  });

  if (!response) {
    log.warn("analyzeFinalVersion: Claude returned null");
    return [];
  }

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const learnings = JSON.parse(jsonMatch[0]) as StyleLearning[];

    if (learnings.length > 0) {
      await appendLearnedStyle(learnings);
    }

    log.info("agent:style_learnings_extracted", {
      count: learnings.length,
      draftPath,
      finalPath
    });

    return learnings;
  } catch (error) {
    log.warn("analyzeFinalVersion: failed to parse learnings", { error });
    return [];
  }
}

async function appendLearnedStyle(
  learnings: StyleLearning[]
): Promise<void> {
  await fs.mkdir(path.dirname(LEARNED_STYLE_PATH), { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    "",
    `## Correcoes aprendidas em ${timestamp}`,
    ""
  ];

  for (const learning of learnings) {
    lines.push(`### [${learning.category}] ${learning.rule}`);
    lines.push(`- Antes: "${learning.before}"`);
    lines.push(`- Depois: "${learning.after}"`);
    lines.push("");
  }

  await fs.appendFile(LEARNED_STYLE_PATH, lines.join("\n"), "utf8");
}

export async function saveFinalVersion(
  topic: string,
  content: string
): Promise<string> {
  await fs.mkdir(REFERENCE_SAMPLES_DIR, { recursive: true });

  const date = new Date();
  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join(" ");

  const slug = topic
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);

  const fileName = `${dateStr} - final - ${slug}.md`;
  const fullPath = path.join(REFERENCE_SAMPLES_DIR, fileName);

  await fs.writeFile(fullPath, content, "utf8");
  log.info("agent:final_version_saved", { path: fullPath });

  return fullPath;
}
