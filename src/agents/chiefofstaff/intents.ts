import { callClaude } from "../../services/openai.js";
import { findPersonByName, listPeople, Person } from "../../db/schema.js";
import { log } from "../../utils/logger.js";

export interface MartaIntent {
  intent: "briefing" | "notas" | "status" | "email" | "equipe" | "reflexao" | "ajuda" | "reminder" | "agendar" | "conversa_geral";
  person: string | null;
  personId: number | null;
  tema: string | null;
  detalhesExtras: string | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
}

const INTENT_SYSTEM_PROMPT = `Voce e o classificador de intencoes da Marta, Chief of Staff virtual.
Recebe uma mensagem em linguagem natural (ja sem a keyword "marta") e extrai:

1. intent: briefing | notas | status | email | equipe | reflexao | ajuda | reminder | agendar | conversa_geral
2. pessoa: nome PROPRIO da pessoa mencionada (ou null). Extraia APENAS o nome, sem papel/cargo.
3. tema: topico/assunto mencionado (ou null)
4. detalhes_extras: papel/cargo da pessoa OU instrucoes adicionais. Para intent "equipe", SEMPRE coloque o cargo/papel aqui.
5. needs_clarification: true/false — se falta info critica para executar
6. clarification_question: pergunta a fazer ao usuario (se needs_clarification=true)

Regras de classificacao:
- "briefing": pedidos de briefing pre-1:1, preparar reuniao, "me ajuda com o 1:1", "prepara", "o que pegar com"
- "notas": processar notas/transcript de reuniao, "anota", "vou te passar as notas", "acabei de sair da reuniao"
- "status": panorama da equipe, "como ta a galera", "status", "panorama", "como estao as coisas"
- "email": draft de email, "manda email", "escreve email", "draft", "cobranca", "mensagem pro"
- "equipe": registrar/adicionar pessoa na equipe. DETECTE qualquer variacao:
  "adiciona", "registra", "inclui", "novo liderado", "nova pessoa", "coloca na equipe",
  "bota na equipe", "cadastra", "eh tech lead", "e tech lead", "ele e", "ela e",
  "entrou no time", "comecou agora", "novo membro", "meu novo report".
  IMPORTANTE: Se menciona adicionar/registrar uma pessoa com cargo/papel, intent DEVE ser "equipe".
  Exemplos que DEVEM ser "equipe":
    - "adiciona o Carlos ele e tech lead" → intent=equipe, pessoa=Carlos, detalhes_extras=tech lead
    - "registra a Maria, product manager" → intent=equipe, pessoa=Maria, detalhes_extras=product manager
    - "inclui o Pedro como engenheiro senior" → intent=equipe, pessoa=Pedro, detalhes_extras=engenheiro senior
    - "o Joao entrou no time como data analyst" → intent=equipe, pessoa=Joao, detalhes_extras=data analyst
    - "coloca a Ana na equipe" → intent=equipe, pessoa=Ana, detalhes_extras=null
    - "novo liderado Lucas, ele e frontend" → intent=equipe, pessoa=Lucas, detalhes_extras=frontend
- "reflexao": analise estrategica, "o que tenho negligenciado", "reflexao", "analise", "como posso melhorar"
- "reminder": lembrete, alarme, "me lembra", "me avisa", "lembrete", "nao esquece de", "agenda pra mim", "me alerta".
  Extrair: pessoa (se mencionada), tema (o que lembrar — texto do lembrete), detalhes_extras (quando/recorrencia, ex: "amanha as 10h", "toda segunda").
  Exemplos:
    - "me lembra de cobrar o Pedro amanha as 10h" → reminder, pessoa=Pedro, tema="cobrar o Pedro", detalhes_extras="amanha as 10h"
    - "toda segunda me lembra de fazer weekly review" → reminder, tema="fazer weekly review", detalhes_extras="toda segunda"
    - "lembrete: ligar pro contador sexta" → reminder, tema="ligar pro contador", detalhes_extras="sexta"
    - "nao esquece de mandar o report ate as 17h" → reminder, tema="mandar o report", detalhes_extras="hoje as 17h"
- "agendar": criar evento no calendario, agendar reuniao, marcar compromisso. Palavras-chave: "agendar", "marcar", "marcar reuniao", "criar evento", "agenda pra mim", "bota na agenda", "coloca na agenda".
  Extrair: pessoa (se mencionada), tema (titulo do evento), detalhes_extras (data, hora, duracao, participantes, local).
  Exemplos:
    - "agendar reuniao com Pedro amanha as 14h" → agendar, pessoa=Pedro, tema="reuniao com Pedro", detalhes_extras="amanha as 14h"
    - "marca um 1:1 com a Ana sexta as 10h por 30 minutos" → agendar, pessoa=Ana, tema="1:1 com Ana", detalhes_extras="sexta as 10h por 30 minutos"
    - "coloca na agenda: planejamento trimestral quinta as 9h" → agendar, tema="planejamento trimestral", detalhes_extras="quinta as 9h"
    - "bota na agenda reuniao de equipe amanha as 15h na sala 3" → agendar, tema="reuniao de equipe", detalhes_extras="amanha as 15h na sala 3"
- "ajuda": "o que voce faz", "como funciona", "help", "ajuda"
- "conversa_geral": qualquer outra coisa que nao se encaixe acima

REGRAS CRITICAS de extracao para "equipe":
- "pessoa" deve conter SOMENTE o nome proprio (ex: "Carlos", "Maria Silva"), SEM o cargo
- "detalhes_extras" deve conter o cargo/papel mencionado (ex: "tech lead", "product manager", "engenheiro senior")
- Se a frase tem "ele e X" ou "ela e X" ou "como X" ou ", X", o X e o cargo → coloque em detalhes_extras
- Se nao menciona cargo, detalhes_extras = null
- needs_clarification = false se tem pelo menos o nome da pessoa
- needs_clarification = true SOMENTE se NAO tem nome nenhum (ex: "adiciona um novo liderado")

Para needs_clarification (outros intents):
- Se o intent e "briefing" e nao tem pessoa → needs_clarification=true, perguntar "Com quem e o 1:1?"
- Se o intent e "email" e nao tem tema → needs_clarification=true, perguntar "Sobre qual assunto?"
- Se o intent e "notas" e a mensagem e curta (parece so aviso, sem conteudo) → needs_clarification=true, perguntar "Pode me mandar as notas/transcript?"
- Se tem pessoa mas e ambiguo → needs_clarification=true com as opcoes

Responda APENAS com JSON valido:
{
  "intent": "briefing" | "notas" | "status" | "email" | "equipe" | "reflexao" | "ajuda" | "reminder" | "agendar" | "conversa_geral",
  "pessoa": "nome" | null,
  "tema": "topico" | null,
  "detalhes_extras": "instrucoes ou cargo/papel" | null,
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

    const validIntents = ["briefing", "notas", "status", "email", "equipe", "reflexao", "ajuda", "reminder", "agendar", "conversa_geral"];
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

  // Partial match — tighter constraints to avoid false positives:
  // - Require minimum 3 characters to prevent matching "Jo" → "Joao", "Jose", etc.
  // - Use first-name starts-with instead of broad substring contains
  if (lower.length >= 3) {
    const partialMatches = people.filter((p) => {
      const pLower = p.name.toLowerCase();
      const firstName = pLower.split(" ")[0];
      // Input starts with the person's first name, or first name starts with input
      return firstName.startsWith(lower) || lower.startsWith(firstName) ||
        p.nameVariants.some((v) => v.toLowerCase().startsWith(lower) || lower.startsWith(v.toLowerCase()));
    });

    if (partialMatches.length === 1) return partialMatches[0];

    // Fall back to DB fuzzy search only when no partial matches found
    if (partialMatches.length === 0) {
      const dbResults = await findPersonByName(nameInput);
      if (dbResults.length === 1) return dbResults[0];
    }
  }

  // Ambiguous or not found
  return null;
}
