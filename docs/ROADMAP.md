# Second Brain — Product Roadmap
## De ferramenta de captura a Chief of Staff pessoal de alto impacto

> Visao: Um assistente pessoal que funciona como um **force multiplier** — nao apenas reagindo a comandos, mas antecipando necessidades, conectando informacoes e transformando inputs brutos em acoes estrategicas.

---

## Estado Atual — Auditoria do Sistema

### O que existe e funciona bem

| Agente | Capacidades | Maturidade |
|--------|-------------|------------|
| **Second Brain** | Captura multimidia (texto, audio, PDF, imagem), classificacao AI em PARC buckets, embeddings semanticos, dedup, URL enrichment, continuations | ★★★★☆ |
| **Marta (Chief of Staff)** | 8 intents (briefing, notas, status, email, equipe, reflexao, ajuda, conversa_geral), fuzzy matching de pessoas, conversas multi-turn, multi-instrucao | ★★★☆☆ |
| **Jarbas (Ghostwriter)** | Posts e artigos LinkedIn, research via Perplexity, 5 tipos de hook, validacao de tamanho, style guide multi-camada | ★★★☆☆ |
| **Proactive Engine** | Briefing matinal, afternoon follow-up, evening wrap-up, weekly report, pre-1:1 alerts | ★★★☆☆ |
| **Dashboard Web** | Kanban board, filtros, busca, CRUD de cards, viewer de outputs | ★★☆☆☆ |

### Gaps criticos identificados

1. **Marta nao tem acesso a calendario** — briefings sao reativos, nao proativos por agenda
2. **Jarbas nao publica** — gera drafts mas exige acao manual no LinkedIn
3. **Nao ha email real** — Marta drafta mas nao envia
4. **Zero integracao com ferramentas de trabalho** — sem Slack, Calendar, Jira
5. **Dashboard estatico** — sem real-time, sem mobile-first
6. **Sem mecanismo de feedback** — o sistema nao aprende com aprovacoes/rejeicoes
7. **Sem recurring tasks** — nao suporta tarefas que se repetem
8. **Sem reminders customizados** — apenas schedules fixos (9h, 15h, 21h)
9. **Sem decision journal** — decisoes nao sao rastreadas formalmente
10. **Sem content calendar** — posts nao tem programacao ou cadencia

---

## Principios do Roadmap

Baseado em pesquisa sobre Chief of Staff (McKinsey, Harvard Business Review), Building a Second Brain (Tiago Forte), e tendencias de AI assistants (Basil AI, Granola, Ambient):

### 1. Proativo > Reativo
> "A shift from 'ask me anything' to 'I noticed X, here is what you should do' is the defining trend of 2026." — GeekWire

O sistema deve antecipar, nao esperar. Cada feature deve se perguntar: **"isso pode ser acionado antes do usuario pedir?"**

### 2. Contexto e Inteligencia Composta
> O Chief of Staff e descrito como "information funnel, filter, and facilitator" — Tability

Cada interacao deve agregar contexto. O briefing de amanha deve ser melhor que o de hoje porque o sistema aprendeu com o que foi util.

### 3. Friccao Zero na Captura
> "Se leva mais de 10 segundos para salvar algo, nao sera usado consistentemente." — Basil AI Research

Voice-first. Forward-to-save. Captura deve ser tao natural quanto mandar um audio pro WhatsApp.

### 4. Outputs Acionaveis
> O metodo CODE (Capture, Organize, Distill, Express) culmina em EXPRESS — o proposito e produzir, nao acumular.

Toda informacao capturada deve fluir naturalmente para: acoes, conteudo, decisoes ou aprendizado.

### 5. Single-player, High-craft
> "Specialized agents over general assistants" — tendencia dominante em 2025-26

Ferramenta pessoal feita sob medida. Sem compromissos de multi-tenant. Cada feature otimizada para um unico usuario power-user.

---

## Roadmap por Fases

### FASE 1 — "Ritmo Diario" (2-3 semanas)
**Objetivo**: Tornar o sistema indispensavel no dia-a-dia

#### 1.1 Calendar Sync (Google Calendar)
**Impacto**: ★★★★★ | **Esforco**: Medio

O gap mais critico. Sem calendario, Marta e uma CoS cega.

- **Sync bidirecional** com Google Calendar via API
- **Pre-meeting briefs automaticos** 15min antes de cada reuniao:
  - Quem participa → puxar contexto de `people` + ultimo 1:1 + items abertos
  - Pauta sugerida baseada em items abertos com a pessoa
  - Historico de decisoes recentes envolvendo os participantes
- **Post-meeting prompt**: "Acabou a reuniao com [pessoa]. Quer me passar as notas?"
- **1:1 cadence tracking**: Marta sabe quando o proximo 1:1 deveria ser e alerta se atrasar
- **Tabela nova**: `calendar_events` (id, chat_id, external_id, title, start_at, end_at, attendees JSONB, notes_captured BOOL)

```
Fluxo: Google Calendar → webhook/polling → calendar_events table
       → proactive.ts checa proximas 24h a cada 30min
       → envia pre-brief via Telegram 15min antes
       → pos-reuniao pergunta se quer registrar notas
```

#### 1.2 Reminders Customizados
**Impacto**: ★★★★☆ | **Esforco**: Baixo

- Comando natural: "me lembra de cobrar o Pedro amanha as 10h"
- Marta detecta intent "reminder" e agenda via `node-cron` ou tabela `scheduled_messages`
- Suporte a recorrencia simples: "toda segunda me lembra de X"
- **Tabela nova**: `reminders` (id, chat_id, text, trigger_at, recurrence, status)

#### 1.3 Morning Brief Enriquecido
**Impacto**: ★★★★☆ | **Esforco**: Baixo

Integrar com calendar sync para transformar o briefing diario:

```
Bom dia! Aqui seu briefing de hoje (quinta, 27/02):

📅 AGENDA
09:00 — 1:1 com Pedro (Tech Lead) [Brief preparado ✓]
11:00 — Sprint Review [3 items abertos do time]
14:00 — Reuniao com cliente X

⚡ PRIORIDADES
• [#42] Definir budget Q2 — vence HOJE
• [#38] Review da proposta — 2 dias atrasado

👥 EQUIPE
• Ana: 3 items abertos, 1 atrasado
• Carlos: nenhum item pendente ✓
• Pedro: 1:1 hoje — ultima vez foi ha 12 dias

📝 CONTENT
• Draft pronto: "Post sobre lideranca remota" — revisar?
```

#### 1.4 Decision Journal
**Impacto**: ★★★★☆ | **Esforco**: Baixo

Best practice de CoS: rastrear decisoes para accountability e aprendizado.

- Marta detecta decisoes em notas de reuniao ("decidimos que...", "ficou definido...")
- Registra: decisao, contexto, participantes, data, rationale
- Nas proximas reunioes com os mesmos participantes, lembra das decisoes pendentes
- **Tabela nova**: `decisions` (id, chat_id, person_ids[], summary, rationale, decided_at, status, review_at)

---

### FASE 2 — "Stakeholder Intelligence" (3-4 semanas)
**Objetivo**: Marta se torna expert em relacoes e follow-ups

#### 2.1 Commitment Tracker
**Impacto**: ★★★★★ | **Esforco**: Medio

> "Maintain a running commitments log showing what was promised to whom" — McKinsey CoS Framework

- Extracao automatica de compromissos de notas de reuniao:
  - "Pedro vai entregar ate sexta" → compromisso de Pedro, deadline sexta
  - "Eu prometi mandar o deck" → compromisso proprio, sem deadline (Marta pergunta)
- Tracking bidirecional: o que EU prometi vs. o que OUTROS prometeram a mim
- Follow-up automatico quando deadline passa
- Pre-meeting: lista compromissos abertos com os participantes
- **Tabela nova**: `commitments` (id, chat_id, person_id, direction ENUM(mine/theirs), summary, deadline, status, source_item_id, created_at)

#### 2.2 Relationship Health Score
**Impacto**: ★★★★☆ | **Esforco**: Medio

- Score composto por: frequencia de 1:1, items abertos/atrasados, compromissos cumpridos, tempo desde ultimo contato
- Alertas proativos: "Voce nao fala com a Maria ha 3 semanas. Quer agendar um 1:1?"
- Dashboard: heatmap de relacionamentos (quente/morno/frio)
- Integra com calendar: detecta quando 1:1 foi feito sem precisar input manual

#### 2.3 Email Send (SMTP)
**Impacto**: ★★★☆☆ | **Esforco**: Medio

- Integrar nodemailer com SMTP pessoal (Gmail app password ou similar)
- Fluxo: "Marta manda email pro Pedro sobre o deadline" → draft → preview → confirma → envia
- Templates: follow-up, cobranca, agradecimento, update
- Historico de emails enviados por pessoa

#### 2.4 Notas de Reuniao Inteligentes
**Impacto**: ★★★★☆ | **Esforco**: Medio

Upgrade do intent "notas" atual:

- Extrai automaticamente: **action items**, **decisoes**, **riscos**, **humor do time**
- Gera resumo estruturado em 3 camadas (progressive summarization):
  - Layer 1: Transcricao/notas brutas
  - Layer 2: Resumo executivo (5-7 bullet points)
  - Layer 3: Acoes extraidas com owners e deadlines
- Conecta action items ao commitment tracker
- Salva no contexto da pessoa para futuros briefings

---

### FASE 3 — "Content Engine" (3-4 semanas)
**Objetivo**: Jarbas se torna um pipeline de thought leadership

#### 3.1 Voice Profile Learning
**Impacto**: ★★★★★ | **Esforco**: Medio

> "Build a voice profile document from 20-30 examples annotated with what makes each piece distinctly theirs."

- Analisar todos os outputs aprovados vs. rejeitados/editados pelo usuario
- Extrair: vocabulario preferido, estrutura de frases, tom, devices retoricos
- Gerar `voice_profile.md` automatizado e atualizado continuamente
- Feedback loop: quando usuario edita um draft, comparar diff e aprender
- **Tabela nova**: `content_feedback` (id, output_id, action ENUM(approved/edited/rejected), edited_content, diff_summary, created_at)

#### 3.2 Content Calendar
**Impacto**: ★★★★☆ | **Esforco**: Baixo

- Cadencia configuravel: "publico segundas e quintas"
- Pipeline visual: Idea → Draft → Review → Scheduled → Published
- Proactive: "Voce nao publicou nada essa semana. Tenho 3 drafts prontos — quer revisar?"
- Sugestao de topicos baseada em: notas de reuniao, trends, insights capturados
- **Tabela nova**: `content_calendar` (id, chat_id, output_id, scheduled_for, status, published_url)

#### 3.3 Meeting-to-Content Pipeline
**Impacto**: ★★★★★ | **Esforco**: Medio

> "One core insight becomes 5+ pieces through reframing for different angles."

O workflow mais poderoso do ghostwriter:

1. Usuario envia notas de reuniao para Marta
2. Marta processa normalmente (action items, decisoes, etc.)
3. Em paralelo, Jarbas analisa as notas e extrai 2-3 insights publicaveis
4. Apresenta sugestoes: "Encontrei 2 insights nas suas notas que dariam bons posts:"
   - "Insight sobre lideranca remota → post tipo 'contrarian take'"
   - "Framework de priorização que voce mencionou → post tipo 'how-to'"
5. Usuario escolhe qual desenvolver
6. Jarbas gera draft completo com contexto real da reuniao

#### 3.4 LinkedIn Publishing
**Impacto**: ★★★☆☆ | **Esforco**: Alto

- OAuth2 com LinkedIn API
- Preview renderizado antes de publicar
- Scheduling: "publica quinta as 8h"
- Metricas basicas (likes, comments, shares) puxadas via API
- **Tabela nova**: `linkedin_posts` (id, output_id, linkedin_post_id, published_at, likes, comments, shares, last_sync)

---

### FASE 4 — "Strategic Operating System" (4-6 semanas)
**Objetivo**: Sistema completo de gestao pessoal e estrategica

#### 4.1 OKR/Goals Tracking
**Impacto**: ★★★★★ | **Esforco**: Medio

> "Connect day-to-day activities back to quarterly/annual goals; flag when meetings or tasks drift from stated priorities." — McKinsey

- Definir objetivos trimestrais e KRs
- Marta conecta items/tarefas a goals automaticamente
- Weekly review: progresso nos OKRs, o que ficou desalinhado
- Alertas: "70% do seu tempo essa semana foi em tarefas nao conectadas a nenhum OKR"
- **Tabelas novas**: `goals` (id, chat_id, title, description, period, target_value, current_value, status), `goal_links` (goal_id, item_id)

#### 4.2 Weekly Review Guiado
**Impacto**: ★★★★☆ | **Esforco**: Baixo

> Ritual central do Building a Second Brain — processar inbox, revisar projetos, planejar proxima semana.

Fluxo interativo via Telegram (conversa guiada):

1. "Vamos revisar a semana? Comecando pelo inbox..."
   - X items capturados, Y processados, Z pendentes
   - "Quer arquivar esses 3 items antigos?" [Sim/Nao]
2. "Seus projetos ativos..."
   - Status de cada projeto, items abertos
   - "Algum projeto pra pausar ou fechar?"
3. "Compromissos..."
   - O que foi cumprido, o que ficou pendente
   - "Quer reagendar esses 2 compromissos?"
4. "Planejamento da proxima semana..."
   - Agenda (calendar sync), prioridades sugeridas
   - "Suas top 3 prioridades pra semana que vem?"
5. Gera resumo do review e salva como nota

#### 4.3 Reflexao Estrategica Profunda
**Impacto**: ★★★★☆ | **Esforco**: Medio

Upgrade do intent "reflexao":

- Marta analisa TODOS os dados dos ultimos 30/60/90 dias:
  - Distribuicao de tempo por area/projeto
  - Patterns de compromissos nao cumpridos
  - Pessoas negligenciadas
  - Topicos recorrentes nas notas
  - Decisoes e seus outcomes
- Gera relatorio de "Strategic Health Check":
  - O que esta funcionando vs. o que nao
  - Blind spots identificados
  - Sugestoes acionaveis

#### 4.4 Telegram Mini App (Dashboard Mobile)
**Impacto**: ★★★☆☆ | **Esforco**: Alto

> Telegram Web Apps permitem interfaces ricas dentro do proprio Telegram, sem app separado.

- Kanban board interativo com drag-and-drop
- Content calendar visual
- People/relationship dashboard
- Goal tracker com progress bars
- Tudo dentro do Telegram — sem trocar de app

---

### FASE 5 — "Ecosystem" (ongoing)
**Objetivo**: Conectar com o mundo externo

#### 5.1 Slack Integration
- Forwarding de mensagens importantes do Slack → Second Brain
- Comando `/secondbrain` no Slack para captura rapida
- Alertas de Marta podem ir pro Slack em vez de (ou alem de) Telegram

#### 5.2 Notion/Obsidian Sync
- Exportar knowledge base para Notion ou Obsidian
- Sync bidirecional de notas

#### 5.3 GitHub Integration
- Issues mencionadas em reunioes viram tasks trackeadas
- PR reviews como input para briefings

#### 5.4 Whisper Local (Privacy)
- Rodar Whisper localmente em vez de enviar audio para OpenAI
- Opcao para self-hosted LLM (Ollama) como fallback

---

## Priorizacao — Impact vs. Effort Matrix

```
                    ALTO IMPACTO
                        │
    Calendar Sync ★     │  ★ Commitment Tracker
    Morning Brief ★     │  ★ Meeting→Content Pipeline
    Decision Journal ★  │  ★ Voice Profile Learning
    Reminders ★         │  ★ OKR Tracking
    Content Calendar ★  │  ★ Reflexao Profunda
                        │
 BAIXO ─────────────────┼───────────────────── ALTO
 ESFORCO                │                    ESFORCO
                        │
    Weekly Review ★     │  ★ LinkedIn Publishing
                        │  ★ Email SMTP
                        │  ★ Telegram Mini App
                        │  ★ Slack Integration
                        │
                    BAIXO IMPACTO
```

---

## Quick Wins (podem ser feitos em 1-2 dias cada)

| # | Feature | Descricao | Impacto |
|---|---------|-----------|---------|
| 1 | **Typing indicator** | `sendChatAction("typing")` antes de chamadas AI longas | UX |
| 2 | **Inline keyboards** | Botoes de acao nas mensagens (Done/Snooze/Edit) em vez de comandos texto | UX |
| 3 | **Silent notifications** | Mensagens de baixa prioridade enviadas silenciosamente | UX |
| 4 | **Recurring tasks** | "toda segunda faz X" → cron + template | Feature |
| 5 | **Content suggestions from notes** | Apos processar notas, sugerir 1-2 topicos para Jarbas | Feature |
| 6 | **Feedback buttons no Jarbas** | Apos draft: [Aprovar ✓] [Editar ✏️] [Rejeitar ✗] → alimenta learning | Feature |
| 7 | **Forward-to-save** | Qualquer mensagem encaminhada pro bot vira card automaticamente | UX |
| 8 | **Status de processamento** | "Transcrevendo audio..." → "Classificando..." → "Pronto!" | UX |
| 9 | **Atalho pre-meeting** | "Marta, vou entrar com [pessoa]" → brief express em 1 msg | Feature |
| 10 | **Export semanal** | Gerar PDF/markdown do weekly review para arquivo pessoal | Feature |

---

## Metricas de Sucesso

### Engagement
- **DAU/MAU ratio** > 0.8 (uso diario consistente)
- **Mensagens por dia** > 10 (captura ativa)
- **Tempo de resposta a proactive messages** < 5 min (relevancia)

### Produtividade
- **Items processados/semana** crescendo ou estavel
- **Compromissos cumpridos** > 80%
- **Tempo medio item aberto** < 7 dias

### Conteudo
- **Posts publicados/semana** >= 2
- **Taxa de aprovacao de drafts** > 60% (voice matching)
- **Tempo entre insight e publicacao** < 48h

### Qualidade do Sistema
- **Classificacao correta** > 90%
- **Intents identificados corretamente** > 95%
- **Erros nao-tratados/semana** < 2

---

## Principios de Implementacao

1. **Ship incrementalmente** — cada feature deve funcionar standalone, sem depender de features futuras
2. **Telegram-first** — toda interacao primaria acontece no Telegram; dashboard e complemento
3. **Graceful degradation** — se Calendar API cai, Marta continua funcionando com dados locais
4. **Audit trail** — toda acao do sistema deve ser rastreavel (tabela `cos_events`)
5. **Voice-first** — todo novo intent deve funcionar por audio, nao apenas texto
6. **Learn from usage** — todo output rejeitado/editado e uma oportunidade de aprendizado
7. **No breaking changes** — manter compatibilidade com mensagens e workflows existentes
