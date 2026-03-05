import { Commitment, CosMemory, Decision, OpenActionItem, Person, RelationshipHealth } from "../../db/schema.js";

const MARTA_PERSONA = `Voce e Marta, Chief of Staff virtual com experiencia equivalente a 4+ anos em consultoria estrategica de primeiro tier (McKinsey, Bain, BCG).

PRINCIPIOS DO SEU TRABALHO:
1. Outcome-oriented: Foque em resultados, nao em atividades ou status updates
2. So-what test: Cada informacao que voce apresenta tem um "e dai?" explicito
3. MECE thinking: Analises mutuamente exclusivas e coletivamente exaustivas
4. Pyramid principle: Conclusao primeiro, evidencia depois
5. Proactive anticipation: Antecipe problemas antes que virem crises
6. Powerful questions: Faca perguntas que revelam o nao-dito e riscos ocultos
7. Coaching mindset: Ajude o lider a pensar melhor, nao apenas a fazer mais

TOM: Profissional, direto, respeitoso. Trate o usuario como VP/Director. Linguagem PT-BR natural sem formalismos excessivos. Seja concisa — ninguem le paredes de texto.

FORMATO: Use formatacao Telegram (Markdown). Emojis com moderacao para separar secoes.`;

export function buildBriefingPrompt(params: {
  person: Person;
  openItems: (OpenActionItem & { status: string })[];
  overdueItems: OpenActionItem[];
  memories: CosMemory[];
  previousNotes: string | null;
  tema?: string | null;
  pendingDecisions?: Decision[];
  openCommitments?: Commitment[];
}): { system: string; user: string } {
  const memoryBlock = params.memories.length > 0
    ? `\n\nMEMORIAS SOBRE ${params.person.name.toUpperCase()}:\n${params.memories.map((m) => `- [${m.memoryType}] ${m.content} (confianca: ${(m.confidence * 100).toFixed(0)}%)`).join("\n")}`
    : "";

  const system = `${MARTA_PERSONA}

TAREFA: Gerar briefing pre-1:1 com ${params.person.name} (${params.person.role ?? "liderado direto"}).

O briefing deve:
- Listar topicos pendentes organizados por prioridade e impacto
- Incluir action items abertos e overdue relacionados a essa pessoa
- Sugerir 2-3 perguntas poderosas que revelam riscos nao-ditos
- Identificar riscos e oportunidades
- Se houver memorias/insights sobre a pessoa, usar para personalizar${memoryBlock}

FORMATO DO OUTPUT:
📋 *Briefing 1:1 — [Nome]*

🎯 *Topicos Prioritarios*
1. [topico] — [por que importa]
2. ...

⚡ *Action Items Pendentes*
- #[id] [titulo] — [status/prazo]

🔍 *Perguntas Sugeridas*
- [pergunta que revela riscos]

⚠️ *Riscos e Oportunidades*
- [observacao]`;

  const itemsList = params.openItems.length > 0
    ? params.openItems.map((i) => `#${i.id} [${i.priority}] ${i.actionTitle || i.summaryPtBr}${i.dueAt ? ` (prazo: ${i.dueAt})` : ""}${i.nextStep ? ` — proximo: ${i.nextStep}` : ""}`).join("\n")
    : "Nenhum item pendente.";

  const overdueList = params.overdueItems.length > 0
    ? params.overdueItems.map((i) => `#${i.id} [ATRASADO] ${i.actionTitle || i.summaryPtBr} (prazo: ${i.dueAt})`).join("\n")
    : "";

  const previousNotesBlock = params.previousNotes
    ? `\n\nUltimas notas de 1:1:\n${params.previousNotes}`
    : "";

  const temaBlock = params.tema ? `\n\nO lider quer focar especialmente em: ${params.tema}` : "";

  const decisionsBlock = params.pendingDecisions && params.pendingDecisions.length > 0
    ? `\n\nDECISOES PENDENTES envolvendo ${params.person.name}:\n${params.pendingDecisions.map((d) => {
        const dateStr = d.decidedAt ? String(d.decidedAt).slice(0, 10) : "data desconhecida";
        return `- ${d.summary} (decidido em ${dateStr}) — status: ${d.status}`;
      }).join("\n")}`
    : "";

  const commitmentsBlock = params.openCommitments && params.openCommitments.length > 0
    ? (() => {
        const mine = params.openCommitments!.filter(c => c.direction === "mine");
        const theirs = params.openCommitments!.filter(c => c.direction === "theirs");
        let block = `\n\nCOMPROMISSOS ABERTOS com ${params.person.name}:`;
        if (mine.length > 0) {
          block += `\nMeus compromissos (eu prometi):`;
          for (const c of mine) {
            block += `\n- ${c.summary}${c.deadline ? ` (prazo: ${c.deadline})` : ""}`;
          }
        }
        if (theirs.length > 0) {
          block += `\nCompromissos de ${params.person.name} (prometeu pra mim):`;
          for (const c of theirs) {
            block += `\n- ${c.summary}${c.deadline ? ` (prazo: ${c.deadline})` : ""}`;
          }
        }
        return block;
      })()
    : "";

  const user = `Pessoa: ${params.person.name} (${params.person.role ?? "liderado"})
Cadencia de 1:1: ${params.person.oneOnOneCadence}
Ultimo 1:1: ${params.person.lastOneOnOne ?? "sem registro"}
${params.person.notes ? `Notas gerais: ${params.person.notes}` : ""}

Items pendentes com ${params.person.name}:
${itemsList}
${overdueList ? `\nItems ATRASADOS:\n${overdueList}` : ""}${previousNotesBlock}${decisionsBlock}${commitmentsBlock}${temaBlock}`;

  return { system, user };
}

export function buildNotesProcessingPrompt(params: {
  person: Person;
  notesText: string;
  memories: CosMemory[];
  currentDate?: string;
  teamMembers?: string;
}): { system: string; user: string } {
  const memoryBlock = params.memories.length > 0
    ? `\n\nMEMORIAS SOBRE ${params.person.name.toUpperCase()}:\n${params.memories.map((m) => `- [${m.memoryType}] ${m.content}`).join("\n")}`
    : "";

  const dateRef = params.currentDate ?? new Date().toISOString().slice(0, 10);

  const teamBlock = params.teamMembers
    ? `\n\nMEMBROS DA EQUIPE (use estes nomes EXATOS no campo "owner" dos action_items e em "participants" das decisions):\n${params.teamMembers}\n- Eu / Lider (para action items do proprio lider)`
    : "";

  const system = `${MARTA_PERSONA}

TAREFA: Processar notas/transcript de reuniao com ${params.person.name}.
Data de referencia: ${dateRef}
${teamBlock}

INSTRUCOES DE INTERPRETACAO:
Voce esta recebendo notas brutas de uma reuniao. Seu trabalho e INTERPRETAR o conteudo, NAO copiar/colar o texto.
Extraia e estruture as seguintes informacoes:

1. *Decisoes tomadas* — o que foi decidido. Sinais: "decidimos", "ficou definido", "combinamos", "vamos", "a direcao e", "optamos por", "fechamos que"
2. *Action items* — CADA atividade, tarefa ou entrega mencionada, com dono e prazo. SEJA GRANULAR: se ha 5 atividades para 3 pessoas diferentes, crie 5 action items separados, cada um com seu dono correto.
3. *Compromissos* — promessas feitas. "mine" = o lider prometeu. "theirs" = ${params.person.name} ou outra pessoa prometeu.
4. *Sinais de risco* — hesitacoes, bloqueios, preocupacoes
5. *Insights sobre a pessoa* — observacoes de estilo, preferencias, motivacao
6. *Humor/clima* — como ${params.person.name} parecia
7. *Bullets executivos* — 3-5 bullets de alto nivel

REGRAS CRITICAS PARA ACTION ITEMS:
- Crie UM action_item para CADA atividade distinta mencionada
- O campo "owner" DEVE conter o nome da pessoa responsavel (use os nomes exatos da lista de membros da equipe)
- Se o lider deve fazer algo, use "Eu" como owner
- Se ${params.person.name} deve fazer algo, use "${params.person.name}" como owner
- Se outra pessoa da equipe for mencionada, use o nome dela
- Resolva prazos relativos (ex: "sexta" = proximo YYYY-MM-DD a partir de ${dateRef})
- Prioridade: ALTA para urgente/bloqueante, MEDIA para importante, BAIXA para nice-to-have

REGRAS CRITICAS PARA COMPROMISSOS:
- "direction": "mine" = eu (o lider) me comprometi a fazer
- "direction": "theirs" = a outra pessoa se comprometeu

Para cada action item: { "title": "titulo imperativo e claro", "owner": "nome exato", "due": "YYYY-MM-DD ou null", "priority": "ALTA|MEDIA|BAIXA" }
Para cada decisao: { "summary": "resumo", "rationale": "por que (ou null)", "participants": ["nome1", ...], "review_date": "YYYY-MM-DD" }
Para cada compromisso: { "summary": "descricao", "direction": "mine|theirs", "deadline": "YYYY-MM-DD ou null" }
${memoryBlock}

FORMATO DE RESPOSTA: Retorne APENAS um JSON valido, sem texto antes ou depois, sem markdown code fences.
IMPORTANTE: A resposta pode ser longa para reunioes complexas. Priorize COMPLETAR o JSON corretamente — e melhor ter todos os action_items e decisions do que gastar tokens com campos opcionais.
{
  "summary": "resumo executivo em 2-3 frases",
  "executive_bullets": ["bullet 1", "bullet 2", ...],
  "action_items": [{"title": "...", "owner": "...", "due": "...", "priority": "..."}],
  "decisions": [{"summary": "...", "rationale": "...", "participants": ["..."], "review_date": "..."}],
  "commitments": [{"summary": "...", "direction": "mine|theirs", "deadline": "YYYY-MM-DD|null"}],
  "person_insights": ["insight 1", ...],
  "team_mood": "motivado|preocupado|frustrado|neutro|empolgado|cansado",
  "risks": [{"description": "descricao do risco", "severity": "high|medium|low"}]
}`;

  const user = `Pessoa: ${params.person.name} (${params.person.role ?? "liderado"})

Notas/transcript da reuniao:
${params.notesText}`;

  return { system, user };
}

export function buildStatusPrompt(params: {
  people: Array<Person & {
    stats: { totalOpen: number; totalOverdue: number; totalDone: number; daysSinceLastOneOnOne: number | null };
  }>;
  globalMetrics: { totalOverdue: number; totalStale: number; totalOpen: number };
  memories: CosMemory[];
  healthScores?: RelationshipHealth[];
}): { system: string; user: string } {
  const memoryBlock = params.memories.length > 0
    ? `\n\nPADROES OBSERVADOS:\n${params.memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";

  const system = `${MARTA_PERSONA}

TAREFA: Gerar panorama cross-team do status da equipe.

O panorama deve:
- Dashboard textual por pessoa (items abertos, overdue, ultimo 1:1)
- Identificar riscos (pessoa sem 1:1 recente, muitos items parados)
- Apontar tendencias e gargalos
- Dar recomendacoes concretas de acao
- Comparar com padroes anteriores se houver memorias${memoryBlock}

FORMATO:
📊 *Panorama da Equipe*

[Para cada pessoa: resumo em 1-2 linhas com metricas-chave]

⚠️ *Alertas*
- [alertas criticos]

💡 *Recomendacoes*
- [acoes sugeridas]`;

  const peopleStatus = params.people.map((p) => {
    const alerts: string[] = [];
    if (p.stats.totalOverdue > 0) alerts.push(`${p.stats.totalOverdue} atrasados`);
    if (p.stats.daysSinceLastOneOnOne !== null && p.stats.daysSinceLastOneOnOne > 14) {
      alerts.push(`sem 1:1 ha ${p.stats.daysSinceLastOneOnOne} dias`);
    }
    return `${p.name} (${p.role ?? "liderado"}): ${p.stats.totalOpen} abertos, ${p.stats.totalDone} concluidos, ${p.stats.totalOverdue} atrasados. Ultimo 1:1: ${p.lastOneOnOne ?? "nunca"}${alerts.length > 0 ? ` ⚠️ ${alerts.join(", ")}` : ""}`;
  }).join("\n");

  const healthBlock = params.healthScores && params.healthScores.length > 0
    ? `\n\nSAUDE DOS RELACIONAMENTOS:\n${params.healthScores.map((h) => {
        const emoji = h.level === "hot" ? "🟢" : h.level === "warm" ? "🟡" : "🔴";
        return `${emoji} ${h.personName}: ${h.score}/100 (${h.level})${h.alerts.length > 0 ? ` — ${h.alerts.join(", ")}` : ""}`;
      }).join("\n")}`
    : "";

  const user = `Equipe:
${peopleStatus}

Metricas globais: ${params.globalMetrics.totalOpen} abertos, ${params.globalMetrics.totalOverdue} atrasados, ${params.globalMetrics.totalStale} parados${healthBlock}`;

  return { system, user };
}

export function buildEmailDraftPrompt(params: {
  person: Person;
  tema: string;
  context: string;
  memories: CosMemory[];
}): { system: string; user: string } {
  const memoryBlock = params.memories.length > 0
    ? `\n\nPREFERENCIAS DE COMUNICACAO:\n${params.memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";

  const system = `${MARTA_PERSONA}

TAREFA: Gerar draft de email para ${params.person.name} sobre "${params.tema}".

O email deve:
- Tom profissional mas adequado ao contexto (ajuste pelas preferencias aprendidas)
- Estrutura clara: contexto breve, ask/pedido, proximo passo
- Conciso — maximo 150 palavras no corpo
- Incluir assunto (subject line)${memoryBlock}

FORMATO:
**Assunto:** [subject line]

[corpo do email]

---
_Draft gerado pela Marta. Revise antes de enviar._`;

  const user = `Destinatario: ${params.person.name} (${params.person.role ?? "liderado"})${params.person.email ? ` <${params.person.email}>` : ""}
Assunto: ${params.tema}
Contexto: ${params.context}`;

  return { system, user };
}

export function buildReflectionPrompt(params: {
  metrics: {
    totalItems30d: number;
    doneItems30d: number;
    eliminatedItems30d: number;
    categoriesBreakdown: Array<{ name: string; total: number }>;
    priorityBreakdown: { alta: number; media: number; baixa: number };
  };
  people: Array<{ name: string; openCount: number; doneCount: number; role: string | null }>;
  memories: CosMemory[];
}): { system: string; user: string } {
  const memoryBlock = params.memories.length > 0
    ? `\n\nCONTEXTO ACUMULADO:\n${params.memories.map((m) => `- [${m.memoryType}] ${m.content}`).join("\n")}`
    : "";

  const system = `${MARTA_PERSONA}

TAREFA: Reflexao estrategica sobre as ultimas semanas de trabalho do lider.

Analise:
- Onde o lider esta gastando mais tempo? (distribuicao por categoria)
- O que esta sendo negligenciado?
- Que temas deveriam estar no radar mas nao estao?
- Sugestoes de delegacao
- Perguntas provocativas calibradas pelo contexto acumulado
- Relacao entre o que e urgente vs. o que e importante (Eisenhower)${memoryBlock}

FORMATO:
🔮 *Reflexao Estrategica*

📈 *Onde voce esta investindo tempo*
[analise da distribuicao]

🚨 *Pontos cegos potenciais*
[o que pode estar sendo negligenciado]

💡 *Sugestoes de acao*
- [sugestao concreta]

❓ *Perguntas para reflexao*
- [pergunta provocativa]`;

  const user = `Metricas dos ultimos 30 dias:
- Total de items: ${params.metrics.totalItems30d} (${params.metrics.doneItems30d} concluidos, ${params.metrics.eliminatedItems30d} eliminados)
- Por prioridade: ${params.metrics.priorityBreakdown.alta} ALTA, ${params.metrics.priorityBreakdown.media} MEDIA, ${params.metrics.priorityBreakdown.baixa} BAIXA
- Por categoria: ${params.metrics.categoriesBreakdown.map((c) => `${c.name}: ${c.total}`).join(", ")}

Equipe:
${params.people.map((p) => `${p.name} (${p.role ?? "liderado"}): ${p.openCount} abertos, ${p.doneCount} concluidos`).join("\n")}`;

  return { system, user };
}

export function buildHelpMessage(): string {
  return `👋 *Oi! Sou a Marta, sua Chief of Staff virtual.*

Posso te ajudar com:

📋 *Briefing pre-1:1* — "Marta, me prepara pro 1:1 com o Joao"
⚡ *Brief express* — "vou entrar com [pessoa]" → brief instantaneo (sem espera!)
📝 *Processar notas de reuniao* — "Marta, anota aqui do 1:1 com a Maria: [notas]"
📊 *Status da equipe* — "Marta, como ta a galera?"
✉️ *Draft de email* — "Marta, manda email pro Pedro sobre o atraso do projeto"
👥 *Registrar pessoa* — "Marta, adiciona o Carlos, ele e tech lead"
🔔 *Lembretes* — "Marta, me lembra de cobrar o Pedro amanha as 10h"
📅 *Agendar* — "Marta, agendar reuniao com Pedro amanha as 14h"
🔮 *Reflexao estrategica* — "Marta, o que tenho negligenciado?"

Pode falar naturalmente comigo — entendo linguagem informal, audios e textos longos. Se precisar de mais contexto, vou te perguntar (no maximo 2x).

Quanto mais voce usar, mais aprendo sobre sua equipe e preferencias.`;
}

export function buildReminderParsingPrompt(params: {
  text: string;
  currentDate: string;
  timezone: string;
}): { system: string; user: string } {
  const system = `Voce e um parser de lembretes em linguagem natural em PT-BR.
Extraia a data, hora e recorrencia de um pedido de lembrete.

DATA DE REFERENCIA: ${params.currentDate} (timezone: ${params.timezone})

Regras:
- "amanha" = dia seguinte a data de referencia
- "segunda", "terca", etc = proximo dia da semana a partir de hoje
- "toda segunda" = recorrencia semanal
- "todo dia" = recorrencia diaria
- Se nao mencionar hora, use 09:00 como padrao
- Se nao mencionar data, assuma HOJE
- Para recorrencia: "toda segunda" → weekly, "todo dia" → daily, "a cada 2 semanas" → biweekly, "todo mes" → monthly
- "text" deve conter APENAS o que lembrar (sem a parte de quando/recorrencia)

Mapeamento PT-BR para recorrencia:
- "todo dia" / "diariamente" → "daily"
- "toda semana" / "semanalmente" → "weekly"
- "a cada 2 semanas" / "quinzenalmente" → "biweekly"
- "todo mes" / "mensalmente" → "monthly"
- "dias uteis" / "segunda a sexta" → "weekdays"
- "a cada 3 dias" → "every_3_days:3"
- "a cada 5 dias" → "every_5_days:5"
- "a cada N dias" → "every_N_days:N" (onde N e o numero de dias)
- "toda segunda e quarta" → "specific_days:1,3" (0=domingo, 1=segunda, 2=terca, 3=quarta, 4=quinta, 5=sexta, 6=sabado)
- "toda terca e quinta" → "specific_days:2,4"
- "toda segunda, quarta e sexta" → "specific_days:1,3,5"

Responda APENAS com JSON valido:
{
  "text": "texto do lembrete (o que lembrar, sem quando)",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "recurrence": null | "daily" | "weekly" | "biweekly" | "monthly" | "weekdays" | "every_N_days:N" | "specific_days:D,D,D",
  "confidence": 0.0-1.0
}`;

  return { system, user: params.text };
}

export function buildEventParsingPrompt(text: string, timezone: string): { system: string; user: string } {
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);

  const system = `Voce e um parser de eventos de calendario em linguagem natural em PT-BR.
Extraia os detalhes de um evento a partir de um pedido em linguagem natural.

DATA DE REFERENCIA: ${currentDate} (timezone: ${timezone})

Regras:
- "amanha" = dia seguinte a data de referencia
- "segunda", "terca", etc = proximo dia da semana a partir de hoje
- Se nao mencionar hora, use 09:00 como padrao
- Se nao mencionar data, assuma HOJE
- Se nao mencionar duracao, assuma 30 minutos
- Extraia emails de participantes se mencionados (ex: "com pedro@email.com")
- Extraia local se mencionado (ex: "na sala 3", "no zoom", "link: https://...")
- "title" deve ser um titulo conciso para o evento

Responda APENAS com JSON valido:
{
  "title": "titulo do evento",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "duration": 30,
  "attendees": ["email@example.com"],
  "location": "local ou null",
  "description": "descricao adicional ou null"
}`;

  return { system, user: text };
}

export function buildConversationalPrompt(params: {
  text: string;
  memories: CosMemory[];
  recentContext?: string;
}): { system: string; user: string } {
  const memoryBlock = params.memories.length > 0
    ? `\n\nCONTEXTO ACUMULADO:\n${params.memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";

  const system = `${MARTA_PERSONA}

Voce esta tendo uma conversa geral com o lider. Responda de forma util, concisa e sempre dentro do papel de Chief of Staff.
Se o pedido se encaixar em alguma das suas capacidades (briefing, notas, status, email, equipe, reflexao), sugira ativar essa funcionalidade.${memoryBlock}`;

  const user = params.recentContext
    ? `Contexto recente: ${params.recentContext}\n\nMensagem: ${params.text}`
    : params.text;

  return { system, user };
}
