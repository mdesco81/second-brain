import { callClaude } from "../../services/openai.js";
import { findPersonByName, listPeople, Person } from "../../db/schema.js";
import { log } from "../../utils/logger.js";

export interface MartaIntent {
  intent: "briefing" | "notas" | "status" | "email" | "equipe" | "reflexao" | "ajuda" | "conversa_geral";
  person: string | null;
  personId: number | null;
  tema: string | null;
  detalhesExtras: string | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
}

const INTENT_SYSTEM_PROMPT = `Voce e o classificador de intencoes da Marta, Chief of Staff virtual.
Recebe uma mensagem em linguagem natural (ja sem a keyword "marta") e extrai:

1. intent: briefing | notas | status | email | equipe | reflexao | ajuda | conversa_geral
2. pessoa: nome da pessoa mencionada (ou null)
3. tema: topico/assunto mencionado (ou null)
4. detalhes_extras: instrucoes adicionais
5. needs_clarification: true/false — se falta info critica para executar
6. clarification_question: pergunta a fazer ao usuario (se needs_clarification=true)

Regras de classificacao:
- "briefing": pedidos de briefing pre-1:1, preparar reuniao, "me ajuda com o 1:1", "prepara", "o que pegar com"
- "notas": processar notas/transcript de reuniao, "anota", "vou te passar as notas", "acabei de sair da reuniao"
- "status": panorama da equipe, "como ta a galera", "status", "panorama", "como estao as coisas"
- "email": draft de email, "manda email", "escreve email", "draft", "cobranca", "mensagem pro"
- "equipe": registrar pessoa, "adiciona", "novo liderado", "e tech lead", "registra"
- "reflexao": analise estrategica, "o que tenho negligenciado", "reflexao", "analise", "como posso melhorar"
- "ajuda": "o que voce faz", "como funciona", "help", "ajuda"
- "conversa_geral": qualquer outra coisa que nao se encaixe acima

Para needs_clarification:
- Se o intent e "briefing" e nao tem pessoa → needs_clarification=true, perguntar "Com quem e o 1:1?"
- Se o intent e "email" e nao tem tema → needs_clarification=true, perguntar "Sobre qual assunto?"
- Se o intent e "notas" e a mensagem e curta (parece so aviso, sem conteudo) → needs_clarification=true, perguntar "Pode me mandar as notas/transcript?"
- Se tem pessoa mas e ambiguo → needs_clarification=true com as opcoes

Responda APENAS com JSON valido:
{
  "intent": "briefing" | "notas" | "status" | "email" | "equipe" | "reflexao" | "ajuda" | "conversa_geral",
  "pessoa": "nome" | null,
  "tema": "topico" | null,
  "detalhes_extras": "instrucoes" | null,
  "needs_clarification": true | false,
  "clarification_question": "pergunta" | null
}`;

export async function classifyMartaIntent(
  text: string,
  peopleList?: Person[]
): Promise<MartaIntent> {
  const fallback: MartaIntent = {
    intent: "conversa_geral",
    person: null,
    personId: null,
    tema: null,
    detalhesExtras: null,
    needsClarification: false,
    clarificationQuestion: null
  };

  try {
    const people = peopleList ?? await listPeople(true);
    const peopleContext = people.length > 0
      ? `\nPessoas registradas: ${people.map((p) => `${p.name}${p.nameVariants.length > 0 ? ` (${p.nameVariants.join(", ")})` : ""}${p.role ? ` — ${p.role}` : ""}`).join("; ")}`
      : "";

    const response = await callClaude({
      system: INTENT_SYSTEM_PROMPT + peopleContext,
      userMessage: text,
      model: "fast",
      maxTokens: 512
    });

    if (!response) return fallback;

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      pessoa?: string | null;
      tema?: string | null;
      detalhes_extras?: string | null;
      needs_clarification?: boolean;
      clarification_question?: string | null;
    };

    const validIntents = ["briefing", "notas", "status", "email", "equipe", "reflexao", "ajuda", "conversa_geral"];
    const intent = validIntents.includes(parsed.intent ?? "")
      ? (parsed.intent as MartaIntent["intent"])
      : "conversa_geral";

    // Resolve person fuzzy match
    let personId: number | null = null;
    let personName = parsed.pessoa ?? null;

    if (personName) {
      const resolved = await resolvePersonFuzzy(personName, people);
      if (resolved) {
        personId = resolved.id;
        personName = resolved.name;
      }
    }

    return {
      intent,
      person: personName,
      personId,
      tema: parsed.tema ?? null,
      detalhesExtras: parsed.detalhes_extras ?? null,
      needsClarification: parsed.needs_clarification ?? false,
      clarificationQuestion: parsed.clarification_question ?? null
    };
  } catch (error) {
    log.warn("Marta intent classification failed", { error });
    return fallback;
  }
}

export async function resolvePersonFuzzy(
  nameInput: string,
  knownPeople?: Person[]
): Promise<Person | null> {
  const people = knownPeople ?? await listPeople(true);
  const lower = nameInput.toLowerCase().trim();

  // Exact match (case-insensitive)
  const exact = people.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;

  // Match on name variants
  const variantMatch = people.find((p) =>
    p.nameVariants.some((v) => v.toLowerCase() === lower)
  );
  if (variantMatch) return variantMatch;

  // Partial match (starts with or contains)
  const partialMatches = people.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      lower.includes(p.name.toLowerCase().split(" ")[0]) ||
      p.nameVariants.some((v) => v.toLowerCase().includes(lower))
  );

  if (partialMatches.length === 1) return partialMatches[0];

  // Fall back to DB fuzzy search
  if (partialMatches.length === 0) {
    const dbResults = await findPersonByName(nameInput);
    if (dbResults.length === 1) return dbResults[0];
  }

  // Ambiguous or not found
  return null;
}
