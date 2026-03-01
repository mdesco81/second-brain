# Second Brain - Documentacao de Arquitetura

**Versao:** 0.1.0
**Ultima atualizacao:** 2026-02-28
**Stack principal:** Node.js 22 + TypeScript + Express + PostgreSQL + Claude/OpenAI

---

## Indice

1. [Visao Geral](#1-visao-geral)
2. [Stack Tecnologico](#2-stack-tecnologico)
3. [Estrutura de Pastas do Codigo](#3-estrutura-de-pastas-do-codigo)
4. [Fluxo Principal: Pipeline de Intake](#4-fluxo-principal-pipeline-de-intake)
5. [Banco de Dados (PostgreSQL)](#5-banco-de-dados-postgresql)
6. [Servicos (services/)](#6-servicos-services)
7. [Agentes de IA (agents/)](#7-agentes-de-ia-agents)
8. [Rotas e API REST (routes/)](#8-rotas-e-api-rest-routes)
9. [Frontend / Dashboard (public/)](#9-frontend--dashboard-public)
10. [Integracao com IA (LLMs)](#10-integracao-com-ia-llms)
11. [Sistema Proativo (Cron Jobs)](#11-sistema-proativo-cron-jobs)
12. [Integracoes Externas](#12-integracoes-externas)
13. [Knowledge Base (Filesystem PARA)](#13-knowledge-base-filesystem-para)
14. [Configuracao e Variaveis de Ambiente](#14-configuracao-e-variaveis-de-ambiente)
15. [Build, Docker e Deploy](#15-build-docker-e-deploy)
16. [Padroes e Convencoes do Codigo](#16-padroes-e-convencoes-do-codigo)
17. [Diagrama de Fluxo de Dados](#17-diagrama-de-fluxo-de-dados)
18. [Guia para Novos Desenvolvedores](#18-guia-para-novos-desenvolvedores)

---

## 1. Visao Geral

O **Second Brain** eh um sistema de gestao de conhecimento pessoal e automacao de tarefas alimentado por IA. O usuario interage **principalmente via Telegram**, enviando textos, audios, imagens, PDFs e arquivos. O sistema:

1. **Captura** o conteudo (transcreve audio, interpreta imagens, extrai texto de PDFs)
2. **Classifica** com IA (categoria, prioridade, acao sugerida, responsavel, prazo)
3. **Decide** se a mensagem complementa algo existente ou eh algo novo (merge/new/split)
4. **Persiste** em PostgreSQL + arquivos Markdown (knowledge base PARA)
5. **Responde** ao usuario com confirmacao e cobra informacoes faltantes
6. **Monitora proativamente** com check-ins diarios e relatorios semanais

Alem do pipeline principal, o sistema possui dois **agentes especializados**:
- **Jarbas (Ghostwriter)**: gera posts e artigos para LinkedIn
- **Marta (Chief of Staff)**: gerencia equipe, 1:1s, compromissos e emails

O **dashboard web** serve como painel de controle visual com Kanban, busca semantica e abas para cada agente.

---

## 2. Stack Tecnologico

### Backend
| Tecnologia | Versao | Uso |
|-----------|--------|-----|
| Node.js | 22 (Alpine) | Runtime |
| TypeScript | 5.9 | Linguagem |
| Express | 4.21 | HTTP server |
| PostgreSQL | 16 (Alpine) | Banco de dados |
| pg | 8.16 | Client SQL (queries raw) |
| Zod | 3.25 | Validacao de configuracao |

### IA / LLMs
| Tecnologia | Uso |
|-----------|-----|
| Anthropic Claude (`claude-sonnet-4-6`) | Classificacao, agentes, relatorios |
| Anthropic Claude (`claude-haiku-4-5`) | Tarefas rapidas (intents, parsing) |
| OpenAI (`gpt-4o-mini-transcribe`) | Transcricao de audio |
| OpenAI (`text-embedding-3-small`) | Embeddings para busca semantica |
| OpenAI (`gpt-4o-mini`) | Descricao de imagens (vision) |
| Perplexity API | Pesquisa web (Ghostwriter) |

### Integracoes Externas
| Servico | Uso |
|---------|-----|
| Telegram Bot API | Canal principal de interacao |
| Google Calendar API v3 | Sincronizacao de agenda |
| SMTP (Nodemailer) | Envio de emails |

### Frontend
| Tecnologia | Uso |
|-----------|-----|
| Vanilla JavaScript | SPA sem framework |
| HTML/CSS | Interface do dashboard |
| Fetch API | Comunicacao com backend |

### DevOps
| Tecnologia | Uso |
|-----------|-----|
| Docker + Docker Compose | Containerizacao |
| node-cron | Agendamento de tarefas |
| Caddy (opcional) | Reverse proxy com HTTPS |

---

## 3. Estrutura de Pastas do Codigo

```
second-brain/
├── src/                              # Codigo-fonte TypeScript
│   ├── index.ts                      # ENTRYPOINT - bootstrap do servidor
│   ├── app.ts                        # Configuracao Express (middlewares, static, rotas)
│   │
│   ├── config/
│   │   └── env.ts                    # Validacao de env vars com Zod
│   │
│   ├── db/
│   │   ├── pool.ts                   # Pool de conexao PostgreSQL
│   │   └── schema.ts                 # ARQUIVO CENTRAL: schema SQL + todas as queries
│   │
│   ├── routes/
│   │   ├── api.ts                    # Endpoints REST (/api/*)
│   │   └── telegram.ts              # Webhook Telegram (/telegram/webhook)
│   │
│   ├── agents/
│   │   ├── base.ts                   # Utilidades comuns (salvar outputs, tracking)
│   │   ├── types.ts                  # Interfaces AgentRequest, AgentResult
│   │   ├── registry.ts              # Registro e descoberta de agentes
│   │   ├── router.ts                # Roteamento de mensagens para agentes
│   │   │
│   │   ├── ghostwriter/             # AGENTE JARBAS
│   │   │   ├── index.ts             # Orquestracao do fluxo de escrita
│   │   │   ├── search.ts            # Integracao Perplexity (pesquisa web)
│   │   │   ├── knowledge.ts         # Carregamento da knowledge base
│   │   │   ├── prompts.ts           # Templates de prompts para LLM
│   │   │   └── knowledge/           # Arquivos de referencia bundled
│   │   │       ├── style-guide.md
│   │   │       ├── linkedin-best-practices.md
│   │   │       └── reference-samples/
│   │   │
│   │   └── chiefofstaff/            # AGENTE MARTA
│   │       ├── index.ts             # Orquestracao: briefings, notas, email, etc.
│   │       ├── intents.ts           # Classificacao de intencoes + fuzzy match
│   │       └── prompts.ts           # Templates de prompts para Marta
│   │
│   ├── services/
│   │   ├── intake.ts                # CORACAO DO SISTEMA: pipeline de ingestao
│   │   ├── classifier.ts            # Classificacao com IA + fallback heuristico
│   │   ├── openai.ts                # Wrappers para Claude, OpenAI, embeddings
│   │   ├── telegram.ts              # API Telegram (enviar mensagens, download)
│   │   ├── polling.ts               # Fallback: polling do Telegram
│   │   ├── calendar.ts              # Sincronizacao Google Calendar
│   │   ├── email.ts                 # Transporte SMTP
│   │   ├── proactive.ts             # Cron jobs: daily check-in, weekly report
│   │   ├── reports.ts               # Construcao de mensagens de relatorio
│   │   ├── storage.ts               # Escrita no filesystem (PARA folders)
│   │   └── callbacks.ts             # Handler de botoes inline do Telegram
│   │
│   ├── types/
│   │   ├── domain.ts                # Tipos core: InputType, KnowledgeBucket, etc.
│   │   └── telegram.ts              # Tipos da API Telegram
│   │
│   └── utils/
│       ├── logger.ts                # Log estruturado
│       ├── paths.ts                 # Caminhos da knowledge base
│       ├── dates.ts                 # Utilitarios de data com timezone
│       └── math.ts                  # Similaridade cosseno para embeddings
│
├── public/                           # Frontend (servido como static)
│   ├── index.html                    # Shell da SPA
│   ├── app.js                        # Logica client-side (Kanban, busca, abas)
│   └── styles.css                    # Estilos
│
├── deploy/
│   └── Caddyfile                     # Config do reverse proxy Caddy
│
├── scripts/
│   └── install_docker_ubuntu.sh      # Script de instalacao Docker
│
├── docker-compose.yml                # Compose para desenvolvimento
├── docker-compose.prod.yml           # Compose para producao (com Caddy)
├── Dockerfile                        # Build multi-stage
├── .env.example                      # Template de variaveis (dev)
├── .env.production.example           # Template de variaveis (prod)
├── tsconfig.json                     # Config TypeScript
├── package.json                      # Dependencias e scripts
├── README.md                         # Quick start
├── ANALISE_SISTEMA.md                # Analise detalhada do sistema
├── DEPLOY_EC2.md                     # Guia deploy AWS EC2
└── DEPLOY_LIGHTSAIL.md               # Guia deploy AWS Lightsail
```

### Arquivos-Chave para Entender o Sistema

Se voce esta comecando, leia nesta ordem:

1. **`src/config/env.ts`** - Entenda todas as configuracoes disponiveis
2. **`src/index.ts`** + **`src/app.ts`** - Como o servidor inicia
3. **`src/services/intake.ts`** - O coracao do sistema (pipeline de processamento)
4. **`src/db/schema.ts`** - Modelo de dados completo e queries
5. **`src/routes/api.ts`** - Todos os endpoints da API REST
6. **`src/routes/telegram.ts`** - Como mensagens do Telegram sao recebidas
7. **`src/agents/router.ts`** - Como mensagens sao roteadas para agentes

---

## 4. Fluxo Principal: Pipeline de Intake

O `src/services/intake.ts` eh o arquivo mais importante do sistema. Toda mensagem que chega pelo Telegram passa por este pipeline:

```
Mensagem Telegram
       |
       v
  [1] Deduplicacao
       |  - Cache em memoria (Map com TTL 10min)
       |  - Constraint UNIQUE no banco (chat_id + telegram_message_id)
       v
  [2] Decisao Pendente?
       |  - Verifica se o usuario esta respondendo a uma pergunta
       |  - Se sim: resolve a decisao (merge/novo)
       v
  [3] Comando Telegram?
       |  - /start, /help, /done, /owner, /weekly, /prioridades, /snooze
       |  - Se sim: executa o comando e retorna
       v
  [4] Roteamento de Agente
       |  - Contem "jarbas"? -> Ghostwriter
       |  - Contem "marta"?  -> Chief of Staff
       |  - Conversa ativa com Marta? -> Continua conversa
       |  - Nenhum match? -> Smart route ou pipeline normal
       v
  [5] Extracao de Conteudo
       |  - Texto: usado direto
       |  - Audio: download + transcricao (OpenAI Whisper)
       |  - Imagem: download + descricao (OpenAI Vision)
       |  - PDF: download + extracao (pdf-parse)
       |  - Arquivo: download + armazenamento
       v
  [6] Ranking de Contexto
       |  - Busca ate 30 itens abertos do mesmo chat
       |  - Calcula embedding do texto novo (OpenAI)
       |  - Score = lexical overlap * 0.7 + cosseno(embeddings) + boost
       |  - Retorna top 8 candidatos
       v
  [7] Planejamento com IA (Claude)
       |  - Envia: categorias + top 8 candidatos + texto novo
       |  - Recebe: decisao (merge/new/split) + cards classificados
       |  - Cada card: categoria, acao, prioridade, prazo, proximo passo
       v
  [8] Gate de Confianca
       |  - Confianca >= 0.72: executa automaticamente
       |  - Confianca < 0.72: cria pending_decision, pergunta ao usuario
       v
  [9] Execucao
       |  - Merge: atualiza card existente (append texto, update metadata)
       |  - New: cria novo card com classificacao completa
       |  - Split: cria multiplos cards independentes
       v
  [10] Pos-processamento
       - Gera embedding do card
       - Grava nota Markdown no filesystem
       - Atualiza action_board.md
       - Cobra owner se faltante
       - Envia confirmacao ao usuario
```

### Detalhes do Ranking de Contexto

O sistema usa uma abordagem hibrida para decidir se uma nova mensagem deve ser mesclada com um card existente:

```typescript
// Score final = max(lexical * 0.7, semantic) + continuation_boost
score = {
  lexical: tokenOverlap * 0.7,     // Palavras em comum (>= 4 chars)
  semantic: cosine(embedding_new, embedding_existing),
  boost: 0.08  // Se texto contem "sobre o tema anterior", "complementando", etc.
}
```

### Gate de Confianca

| Confianca | Comportamento |
|-----------|--------------|
| >= 0.72 | Executa automaticamente sem perguntar |
| < 0.72 | Cria `intake_pending_decision` e envia botoes ao usuario |

O usuario pode responder `complemento` (merge com card existente) ou `novo` (criar card separado).

---

## 5. Banco de Dados (PostgreSQL)

Todas as queries e definicoes de schema estao em **`src/db/schema.ts`**. O sistema usa **SQL raw** via biblioteca `pg` (sem ORM). O schema eh criado automaticamente no startup via `ensureSchema()`.

### Tabelas Principais

#### `inbox_items` - Tabela central de conteudo
```
id                  SERIAL PK
chat_id             BIGINT (identifica o chat Telegram)
telegram_message_id BIGINT UNIQUE
input_type          TEXT (text|audio|pdf|image|file)
raw_text            TEXT (conteudo original)
normalized_text     TEXT (texto limpo/processado)
summary_pt_br       TEXT (resumo em portugues)
category_id         FK -> categories
bucket              TEXT (PROJECTS|AREAS|RESOURCES|RESEARCH|ARCHIVE)
action              TEXT (CREATE_PROJECT|CREATE_TASK|STORE_REFERENCE|FOLLOW_UP|NONE)
action_title        TEXT
action_details      TEXT
priority            TEXT (ALTA|MEDIA|BAIXA)
status              TEXT (open|done|eliminated)
processing_stage    TEXT (capturado|interpretado|planejado|concluido|eliminado|falha)
confidence          NUMERIC(4,3) (0-1)
due_at              DATE
next_step           TEXT
follow_up_with      TEXT
snoozed_until       DATE
storage_path        TEXT
metadata            JSONB (dados extras flexiveis)
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

#### `categories` - Categorias de classificacao
```
id          SERIAL PK
name        TEXT UNIQUE
description TEXT
source      TEXT (seed|user|agent|dashboard)
```
Categorias padrao criadas no startup: Financeiro, Saude, Negocios, Estudos.

#### `projects` - Projetos formais
```
id              SERIAL PK
title           TEXT UNIQUE
status          TEXT
category_id     FK -> categories
source_item_id  FK -> inbox_items
notes           TEXT
```

#### `item_embeddings` - Cache de embeddings
```
item_id   INTEGER PK FK -> inbox_items
chat_id   BIGINT
model     TEXT (text-embedding-3-small)
vector    JSONB (array de floats, 1536 dimensoes)
```

#### `item_attachments` - Arquivos anexos
```
id            SERIAL PK
item_id       FK -> inbox_items
storage_path  TEXT
file_name     TEXT
input_type    TEXT
```

### Tabelas do Agente Marta (Chief of Staff)

#### `people` - Cadastro de pessoas da equipe
```
id                  SERIAL PK
name                TEXT
name_variants       TEXT[] (nomes alternativos p/ fuzzy match)
role                TEXT
relationship        TEXT (direct_report|peer|stakeholder)
email               TEXT
one_on_one_cadence  TEXT (weekly|biweekly|monthly)
last_one_on_one     TIMESTAMPTZ
last_contact_at     TIMESTAMPTZ
notes               TEXT
active              BOOLEAN
```

#### `cos_outputs` - Conteudo gerado pela Marta
```
id          SERIAL PK
chat_id     BIGINT
output_type TEXT (briefing|notes|status|email|reflection|...)
person_id   FK -> people
title       TEXT
content     TEXT
metadata    JSONB
status      TEXT (draft|sent|reviewed)
version     INTEGER
parent_id   FK -> cos_outputs (versionamento)
```

#### `cos_memory` - Memoria contextual da Marta
```
id               SERIAL PK
memory_type      TEXT (preference|role|decision|relationship|health)
person_id        FK -> people
key              TEXT
content          TEXT
confidence       REAL (0-1)
times_confirmed  INTEGER
times_used       INTEGER
active           BOOLEAN
```

#### `cos_conversations` - Conversas multi-turno
```
id         SERIAL PK
chat_id    BIGINT
intent     TEXT (briefing|notas|status|email|...)
person_id  INTEGER
state      TEXT (active|paused|completed)
context    JSONB
messages   JSONB (array de {role, content})
turns      INTEGER
max_turns  INTEGER
```

#### Outras tabelas
| Tabela | Proposito |
|--------|-----------|
| `calendar_events` | Eventos sincronizados do Google Calendar |
| `reminders` | Lembretes agendados com recorrencia |
| `decisions` | Decisoes registradas com racional |
| `commitments` | Compromissos (meus/deles) com prazo e status |
| `sent_emails` | Historico de emails enviados |
| `chat_subscriptions` | Chats inscritos para mensagens proativas |
| `proactive_runs` | Historico de check-ins e relatorios |
| `intake_pending_decisions` | Decisoes aguardando confirmacao do usuario |
| `cos_events` | Log de auditoria das acoes da Marta |

### Indices Importantes
```sql
UNIQUE (chat_id, telegram_message_id)  -- Deduplicacao de mensagens
idx_inbox_items_chat_message           -- Busca rapida por chat
idx_item_embeddings_item_id            -- Lookup de embeddings
idx_calendar_events_start              -- Busca de eventos por data
idx_cos_memory_unique_active           -- Memoria unica por tipo+pessoa+chave
idx_reminders_pending                  -- Lembretes a disparar
```

---

## 6. Servicos (services/)

### `intake.ts` - Pipeline de Ingestao
**O arquivo mais importante.** Orquestra todo o fluxo desde a chegada da mensagem ate a persistencia e resposta.

Funcoes principais:
- `handleIncomingMessage(msg)` - Ponto de entrada para toda mensagem Telegram
- `extractContent(msg)` - Extrai texto de qualquer tipo de midia
- `rankContextCandidates(text, chatId)` - Busca e rankeia cards similares
- `executePlan(plan, chatId, ...)` - Executa a decisao (merge/new/split)

### `openai.ts` - Wrappers de IA
Encapsula as chamadas para Claude e OpenAI:
- `callClaude(system, user, options)` - Chamada generica ao Claude
- `planIntakeWithContext(...)` - Prompt especializado para o planner
- `transcribeAudio(buffer)` - Transcricao via Whisper
- `describeImage(buffer)` - Descricao via Vision
- `embedText(text)` - Gerar embedding
- `cleanTranscription(text)` - Limpar transcricao

### `classifier.ts` - Classificacao
- `classifyWithAI(text, categories)` - Classificacao completa via IA
- `fallbackClassification(text)` - Regras por keyword quando IA indisponivel

### `telegram.ts` - API Telegram
- `sendText(chatId, text)` - Enviar mensagem
- `sendTextWithButtons(chatId, text, buttons)` - Enviar com botoes inline
- `sendTypingIndicator(chatId)` - Indicador de "digitando"
- `getFileBuffer(fileId)` - Download de arquivo do Telegram
- `splitLongMessage(text)` - Divide mensagens > 4096 chars

### `proactive.ts` - Automacao Agendada
- `initProactive()` - Configura cron jobs no startup
- `runDailyCheckIn(chatId)` - Check-in diario
- `runWeeklyReport(chatId)` - Relatorio semanal
- `checkReminders()` - Disparo de lembretes pendentes
- `syncCalendar(chatId)` - Sincroniza Google Calendar

### `reports.ts` - Construcao de Relatorios
- `buildDailyMessage(data)` - Monta mensagem do check-in
- `buildWeeklyMessage(data)` - Monta mensagem do relatorio semanal
- `buildOpenActionsMessage(items)` - Lista de acoes abertas

### `storage.ts` - Persistencia no Filesystem
- `writeKnowledgeNote(item)` - Grava nota Markdown na estrutura PARA
- `writeActionBoard(chatId)` - Atualiza action_board.md
- `storeIncomingMedia(buffer, filename)` - Salva arquivo de midia
- `appendProjectStatus(project)` - Atualiza status de projeto

### `calendar.ts` - Google Calendar
- `syncEvents(chatId)` - Busca eventos futuros
- `createCalendarEvent(chatId, event)` - Cria evento
- `isCalendarEnabled()` - Verifica se credenciais existem

### `email.ts` - SMTP
- `sendEmail(to, subject, body)` - Envia email
- `isEmailEnabled()` - Verifica se SMTP configurado

### `callbacks.ts` - Botoes Inline Telegram
Processa callbacks quando o usuario clica em botoes inline (confirmar classificacao, escolher opcao, etc.)

### `polling.ts` - Polling Telegram
Fallback para quando webhook nao esta disponivel. Usa `getUpdates` da API Telegram.

---

## 7. Agentes de IA (agents/)

### Arquitetura de Agentes

```
agents/
├── types.ts      - Interface AgentRequest + AgentResult
├── registry.ts   - Map<string, AgentHandler> (registro de agentes)
├── router.ts     - Logica de roteamento: keyword detection + smart route
├── base.ts       - Utilidades compartilhadas (salvar outputs, tracking)
├── ghostwriter/  - Agente Jarbas
└── chiefofstaff/ - Agente Marta
```

#### Interface de um Agente

```typescript
interface AgentRequest {
  chatId: number;
  messageId?: number;
  rawRequest: string;
  intent: {
    agentId: string;
    intent: string;
    metadata: Record<string, any>;
  };
}

interface AgentResult {
  success: boolean;
  message?: string;
  data?: any;
}
```

### Roteamento (`router.ts`)

A logica de deteccao funciona assim:

1. **Keyword "jarbas"** no texto (exceto frases como "da jarbas" que indicam referencia a pessoa) -> Ghostwriter
2. **Keyword "marta"** no texto (mesma logica de exclusao) -> Chief of Staff
3. **Conversa ativa** com Marta (multi-turno) -> Continua conversa
4. **Smart route** -> Se nenhum match, tenta Marta como rota conversacional

### Agente Jarbas (Ghostwriter)

**Proposito:** Gerar posts e artigos para LinkedIn com pesquisa e estilo personalizado.

**Fluxo completo:**
```
1. Usuario: "jarbas escreve um post sobre IA generativa"
2. Classificar intent (post vs article)
3. Carregar knowledge base em paralelo:
   - style-guide.md (guia de estilo)
   - linkedin-best-practices.md (melhores praticas)
   - Estilo aprendido (de versoes finais anteriores)
   - Amostras de referencia
4. Pesquisar via Perplexity (modo "simple" para post, "deep" para artigo)
5. Gerar 3-4 opcoes de hook (abertura) via Claude
6. Compor rascunho completo via Claude (usando pesquisa + estilo + hook)
7. Gerar hashtags relevantes
8. Salvar:
   - Arquivo no filesystem (50_AGENT_OUTPUTS/)
   - Registro no banco como inbox_item com metadata.isAgentOutput = true
9. Enviar ao usuario pelo Telegram com opcoes de edicao
```

**Aprendizado de estilo:** Quando o usuario finaliza uma versao (endpoint `/api/agent-outputs/:id/final`), o sistema compara o rascunho original com a versao final e extrai padroes de estilo para futuras geracoes.

### Agente Marta (Chief of Staff)

**Proposito:** Assistente de gestao de equipe com suporte a 1:1s, compromissos, decisoes e emails.

**Intents suportados:**
| Intent | Trigger | O que faz |
|--------|---------|-----------|
| `briefing` | "marta briefing do joao" | Gera brief pre-1:1 com contexto |
| `notas` | "marta notas da reuniao" | Processa transcript, extrai decisoes e compromissos |
| `status` | "marta status da equipe" | Panorama da equipe com saude de relacionamento |
| `email` | "marta escreve email pro joao" | Gera rascunho de email |
| `equipe` | "marta adiciona joao como dev" | Cadastra/atualiza pessoa |
| `reflexao` | "marta reflexao sobre lideranca" | Gera reflexao estrategica |
| `reminder` | "marta lembra de ligar pro joao amanha" | Agenda lembrete |
| `agendar` | "marta agenda 1:1 com joao" | Cria evento no Google Calendar |

**Recursos-chave:**
- **Fuzzy name matching**: Reconhece variacoes de nome ("Joao", "joaozinho", "JP")
- **Sistema de memoria**: Armazena preferencias, decisoes, padroes de cada pessoa
- **Conversas multi-turno**: Mantem contexto por ate N turnos
- **Saude de relacionamento**: Score baseado em frequencia de contato, 1:1s, compromissos
- **Extracao automatica**: De notas de reuniao, extrai decisoes e compromissos

---

## 8. Rotas e API REST (routes/)

### `routes/telegram.ts` - Webhook Telegram
```
POST /telegram/webhook
  - Header: X-Telegram-Bot-Api-Secret-Token (validado)
  - Body: Update do Telegram (message, callback_query, etc.)
  - Delega para handleIncomingMessage() ou handleCallbackQuery()
```

### `routes/api.ts` - API REST Completa

#### Saude e Dashboard
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/health` | Health check (`{ok: true, timestamp}`) |
| GET | `/api/dashboard` | Resumo completo: stats, foco, kanban, alertas |

#### Inbox e Acoes
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/actions` | Lista acoes abertas (limit: 30) |
| POST | `/api/actions` | Cria acao pelo dashboard |
| PATCH | `/api/actions/:id` | Edita campos (summary, priority, dueAt, etc.) |
| PATCH | `/api/actions/:id/status` | Muda status (open/done/eliminated) |
| DELETE | `/api/actions/:id` | Deleta permanentemente |
| GET | `/api/inbox-queue` | Itens aguardando classificacao |
| POST | `/api/inbox-queue/:id/process` | Classifica item (actionable/reference/trash) |

#### Busca
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/search?q=query` | Busca semantica (embeddings) + fallback texto |

#### Arquivos e Midias
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/items/:id/file` | Serve arquivo do item |
| GET | `/api/items/:id/files` | Lista anexos do item |
| GET | `/api/items/:id/files/:attachmentId` | Serve anexo especifico |

#### Sumarizacao Progressiva
| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/items/:id/expand` | Incrementa contagem, gera layers 2/3 |
| POST | `/api/items/:id/distill` | Forca geracao de todas as camadas |

#### Categorias
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/categories` | Lista todas as categorias |

#### Outputs de Agentes
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/agent-outputs` | Lista conteudo gerado pelo Jarbas |
| POST | `/api/agent-outputs/:id/final` | Salva versao final + analise de estilo |

#### Chief of Staff (Marta)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/cos` | Lista pessoas + outputs recentes |
| GET | `/api/cos/output/:id` | Detalhe de um output da Marta |
| PATCH | `/api/cos/output/:id/status` | Atualiza status do output |
| POST | `/api/cos/upload-notes` | Upload de notas/transcript |

#### Pessoas
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/people` | Lista pessoas ativas (all=true inclui inativas) |
| POST | `/api/people` | Cria/atualiza pessoa |
| PATCH | `/api/people/:id` | Edita pessoa |
| DELETE | `/api/people/:id` | Desativa pessoa |

#### Compromissos
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/commitments` | Lista compromissos abertos |
| GET | `/api/commitments/person/:id` | Compromissos por pessoa |
| PATCH | `/api/commitments/:id/status` | Atualiza status |

#### Lembretes
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/reminders` | Lista lembretes pendentes |
| POST | `/api/reminders/:id/cancel` | Cancela lembrete |

#### Saude de Relacionamento
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/relationship-health` | Scores de saude da equipe |

#### Emails Enviados
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/sent-emails/person/:id` | Historico de emails por pessoa |

---

## 9. Frontend / Dashboard (public/)

### Arquitetura
SPA (Single Page Application) em **vanilla JavaScript** sem framework. Tres arquivos:
- `index.html` - Estrutura HTML com modais e abas
- `app.js` - Toda a logica client-side (~1500+ linhas)
- `styles.css` - Estilos

### Abas Principais
1. **Second Brain** - Kanban principal com cards de acao
2. **Jarbas** - Outputs do Ghostwriter (posts/artigos)
3. **Marta** - Outputs do Chief of Staff (briefings, emails, etc.)

### Componentes do Second Brain
- **Barra de busca** com busca semantica
- **Filtros** por prioridade (ALTA/MEDIA/BAIXA) e categoria
- **Strip de stats** (total itens, projetos, categorias, alertas)
- **Kanban** com 4 colunas:
  - "A Processar" (itens capturados aguardando classificacao)
  - "Abertos" (acoes pendentes)
  - "Resolvidos" (concluidos)
  - "Eliminados" (descartados)
- **Modal de edicao** (click no card abre detalhes editaveis)
- **Toast notifications** para feedback
- **Dialog de confirmacao** estilizado

### Estado (state object em app.js)
```javascript
const state = {
  summary: null,         // Dados do /api/dashboard
  categories: [],        // Lista de categorias
  filterPriority: "all", // Filtro ativo
  filterCategory: "all",
  search: "",            // Termo de busca
  expandedId: null,      // Card expandido
  editingItem: null,     // Item sendo editado no modal
  loading: false,
  draggedId: null,       // Drag & drop
  activeTab: "brain",    // Aba ativa (brain|jarbas|marta)
  jarbasOutputs: null,   // Dados do Jarbas
  martaData: null,       // Dados da Marta
  remindersData: null    // Lembretes
};
```

### Interacao com API
O frontend usa `fetch()` para todas as chamadas:
- `loadDashboard()` -> GET /api/dashboard
- `loadCategories()` -> GET /api/categories
- `updateStatus(id, status)` -> PATCH /api/actions/:id/status
- `saveEdit(id, fields)` -> PATCH /api/actions/:id
- `searchItems(query)` -> GET /api/search?q=...
- `loadJarbasOutputs()` -> GET /api/agent-outputs
- `loadMartaData()` -> GET /api/cos

---

## 10. Integracao com IA (LLMs)

### Hierarquia de Modelos

```
Anthropic Claude (primario)
├── claude-sonnet-4-6 (default)     -> Classificacao, agentes, relatorios
└── claude-haiku-4-5 (fast)         -> Intent parsing, tarefas rapidas

OpenAI
├── gpt-4o-mini-transcribe          -> Transcricao de audio
├── text-embedding-3-small          -> Embeddings (1536 dim)
└── gpt-4o-mini                     -> Descricao de imagens (vision)

Perplexity API
└── Pesquisa web                    -> Research para Ghostwriter
```

### Funcao Central: `callClaude()`

Localizada em `src/services/openai.ts`, eh o wrapper principal para chamadas ao Claude:

```typescript
async function callClaude(
  systemPrompt: string,
  userMessage: string,
  options?: {
    model?: string;       // Default: ANTHROPIC_MODEL
    maxTokens?: number;   // Default: 2048
    temperature?: number; // Default: 0.3
  }
): Promise<string>
```

### Pipeline de Classificacao

```
                    ┌──────────────────┐
                    │ planIntakeContext │  (Claude com JSON Schema)
                    │   Confianca alta │
                    └────────┬─────────┘
                             │ falha?
                    ┌────────v─────────┐
                    │  classifyWithAI  │  (Claude simples)
                    └────────┬─────────┘
                             │ falha?
                    ┌────────v─────────┐
                    │ fallbackClassif. │  (Keywords hardcoded)
                    │ Confianca 0.45   │
                    └──────────────────┘
```

### Embeddings e Busca Semantica

- **Modelo**: `text-embedding-3-small` (OpenAI)
- **Dimensao**: 1536 floats
- **Armazenamento**: JSONB no PostgreSQL (tabela `item_embeddings`)
- **Busca**: Cosseno calculado na aplicacao (nao usa pgvector)
- **Threshold**: Score minimo 0.3 para incluir nos resultados

### Features Condicionais

O sistema **degrada gracefully** quando APIs nao estao configuradas:

| API Key | Quando ausente |
|---------|---------------|
| `ANTHROPIC_API_KEY` | Usa fallback heuristico (keywords) |
| `OPENAI_API_KEY` | Sem transcricao, sem embeddings, sem busca semantica |
| `PERPLEXITY_API_KEY` | Ghostwriter funciona sem pesquisa |
| Google credentials | Sem sincronizacao de calendario |
| SMTP credentials | Sem envio de email |

---

## 11. Sistema Proativo (Cron Jobs)

Configurado em `src/services/proactive.ts` usando `node-cron`.

### Check-in Diario
- **Horario**: `PROACTIVE_HOUR:PROACTIVE_MINUTE` (default: 9:00)
- **Timezone**: `TIMEZONE` (default: America/Sao_Paulo)
- **Conteudo**:
  - Fila de foco (top 8 itens abertos por prioridade)
  - Itens atrasados (> 3 dias apos due_at)
  - Itens estagnados (abertos > 5 dias sem atividade)
  - Eventos do dia (se Google Calendar habilitado)
  - Stats da equipe (para direct reports): contagem, atrasados, dias desde 1:1
  - Rascunhos pendentes (Ghostwriter)
  - Compromissos vencidos

### Relatorio Semanal
- **Dia**: `WEEKLY_REPORT_DAY` (default: 1 = segunda)
- **Horario**: `WEEKLY_REPORT_HOUR:WEEKLY_REPORT_MINUTE` (default: 8:30)
- **Conteudo**:
  - Itens capturados na semana
  - Projetos completados
  - Itens atrasados persistentes
  - Prioridades da proxima semana
  - Status de compromissos

### Lembretes
- Verificados a cada minuto via cron
- Suportam recorrencia (RRULE: FREQ=WEEKLY;BYDAY=MO)
- Ligados opcionalmente a uma pessoa

### Sincronizacao de Calendario
- **Intervalo**: `CALENDAR_SYNC_INTERVAL_MIN` (default: 5 min)
- Busca eventos futuros do Google Calendar
- Detecta reunioes 1:1
- Envia brief pre-reuniao (`PRE_MEETING_MINUTES` antes, default: 15 min)
- Solicita notas pos-reuniao (`POST_MEETING_MINUTES` depois, default: 10 min)

---

## 12. Integracoes Externas

### Telegram Bot API

**Modos de operacao:**
- **Webhook** (recomendado para producao): POST /telegram/webhook
- **Polling** (fallback para desenvolvimento): getUpdates loop

**Recursos usados:**
- Envio de mensagens (texto, com botoes inline)
- Download de arquivos (audio, imagem, PDF, documentos)
- Indicador de "digitando"
- Callback queries (botoes inline)
- Comandos (/, /start, /done, /owner, etc.)

**Comandos Telegram:**
| Comando | Descricao |
|---------|-----------|
| `/start` | Mensagem de boas-vindas |
| `/help` | Ajuda |
| `/done <id>` | Marca item como concluido |
| `/owner <id> Nome` | Define responsavel |
| `/weekly` | Gera relatorio semanal sob demanda |
| `/prioridades` | Lista itens abertos por prioridade |
| `/snooze <id> <dias>` | Adia item por N dias |

### Google Calendar
- **Autenticacao**: OAuth2 com refresh token
- **Operacoes**: listar eventos, criar eventos
- **Deteccao de 1:1**: Baseada em numero de participantes e pessoa cadastrada

### SMTP (Email)
- Via Nodemailer
- Suporta threading (Message-ID header)
- Registra historico em `sent_emails`

### Perplexity API
- Pesquisa web para o agente Ghostwriter
- Dois modos: `simple` (rapido) e `deep` (detalhado)

---

## 13. Knowledge Base (Filesystem PARA)

Raiz definida por `STORAGE_ROOT` (default: `./storage/SecondBrain`).

```
SecondBrain/
├── 00_INBOX/              # Capturas brutas, organizadas por data (YYYY/MM/DD/)
├── 10_PROJECTS/           # Notas de projetos (bucket=PROJECTS)
├── 20_AREAS/              # Responsabilidades continuas (bucket=AREAS)
├── 30_RESOURCES/          # Materiais de referencia (bucket=RESOURCES)
├── 31_RESEARCH/           # Pesquisas (bucket=RESEARCH)
├── 40_ARCHIVE/            # Itens finalizados/descartados (bucket=ARCHIVE)
├── 50_AGENT_OUTPUTS/      # Outputs dos agentes
│   ├── Artigos/           # Artigos do Ghostwriter
│   ├── Posts/             # Posts do Ghostwriter
│   └── _pesquisas/        # Contexto de pesquisa Perplexity
├── 80_STATUS/
│   ├── action_board.md    # Fila de acoes abertas (auto-atualizado)
│   └── project_status.md  # Status de projetos
└── 90_SYSTEM/
    └── README.md
```

### Formato das Notas Markdown

Cada item eh gravado como Markdown com frontmatter:

```markdown
---
category: Negocios
priority: ALTA
action: CREATE_TASK
due_at: 2026-03-15
next_step: Enviar proposta ao cliente
follow_up_with: Joao
---

# Titulo do Item

Conteudo normalizado aqui...

---
*Capturado em: 2026-02-28 14:30*
*Tipo: audio*
```

---

## 14. Configuracao e Variaveis de Ambiente

Todas as variaveis sao validadas no startup via Zod (`src/config/env.ts`).

### Obrigatorias
```env
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/second_brain
TELEGRAM_BOT_TOKEN=seu-token-do-botfather
TELEGRAM_WEBHOOK_SECRET=qualquer-string-aleatoria
```

### Recomendadas
```env
ANTHROPIC_API_KEY=sk-ant-...           # Habilita classificacao por IA
OPENAI_API_KEY=sk-...                  # Habilita transcricao + embeddings
APP_BASE_URL=https://seu-dominio.com   # Obrigatorio no modo webhook
```

### Opcionais - Pesquisa
```env
PERPLEXITY_API_KEY=pplx-...            # Pesquisa web para Ghostwriter
```

### Opcionais - Google Calendar
```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
CALENDAR_SYNC_INTERVAL_MIN=5
PRE_MEETING_MINUTES=15
POST_MEETING_MINUTES=10
```

### Opcionais - Email SMTP
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-app-password
SMTP_FROM=noreply@seu-dominio.com
```

### Configuracao de Agendamento
```env
TIMEZONE=America/Sao_Paulo
PROACTIVE_HOUR=9
PROACTIVE_MINUTE=0
WEEKLY_REPORT_DAY=1          # 0=domingo, 1=segunda, ..., 6=sabado
WEEKLY_REPORT_HOUR=8
WEEKLY_REPORT_MINUTE=30
```

### Modelos de IA
```env
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_FAST_MODEL=claude-haiku-4-5-20251001
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_EMBED_MODEL=text-embedding-3-small
```

### Storage
```env
STORAGE_ROOT=./storage/SecondBrain     # Resolvido para caminho absoluto
TELEGRAM_MODE=webhook                   # webhook | polling
```

---

## 15. Build, Docker e Deploy

### Scripts npm
```bash
npm run dev      # Desenvolvimento com hot reload (tsx watch)
npm run build    # Compila TypeScript -> dist/
npm run start    # Roda em producao (node dist/index.js)
npm run check    # Type check sem emitir (tsc --noEmit)
```

### Dockerfile (Multi-stage)
```
Estagio 1 (deps):    npm install
Estagio 2 (build):   tsc -p tsconfig.json
Estagio 3 (runtime): node dist/index.js
  - Copia node_modules, dist/, public/, knowledge/
  - Expoe porta 8080
```

### Docker Compose (Desenvolvimento)
```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck: pg_isready
    volumes: pg_data (persistente)

  app:
    build: .
    depends_on: postgres (healthy)
    ports: 8080:8080
    volumes: brain_storage
    restart: always
```

### Docker Compose Producao
Adiciona Caddy como reverse proxy com HTTPS automatico.

### Deploy
Guias detalhados disponíveis:
- `DEPLOY_LIGHTSAIL.md` - AWS Lightsail
- `DEPLOY_EC2.md` - AWS EC2

### Inicializacao do Banco
O schema eh criado automaticamente no primeiro startup via `ensureSchema()`. Nao requer migrations manuais.

---

## 16. Padroes e Convencoes do Codigo

### Deduplicacao
- **Cache em memoria**: `Map` com TTL de 10 minutos (previne reprocessamento)
- **Constraint no banco**: `UNIQUE(chat_id, telegram_message_id)`

### Soft Deletes
Nenhum item eh deletado fisicamente. Status possiveis: `open` -> `done` | `eliminated`. Items podem ser reabertos.

### Estagios de Processamento
```
capturado -> interpretado (sem acao necessaria)
          -> planejado (acao pendente)
          -> concluido (usuario marcou done)
          -> eliminado (usuario descartou)
          -> falha (erro de processamento)
```

### Fallback em Cascata
```
IA Completa (Planner) -> IA Simples (Classifier) -> Heuristico (Keywords)
```
O sistema NUNCA trava por falta de IA.

### Funcionalidades Condicionais
Cada integracao verifica se a API key existe antes de tentar usar. Se nao existe, o recurso eh silenciosamente desabilitado.

### Async Fire-and-Forget
Operacoes nao-criticas (distillation, embeddings extras) sao executadas sem await para nao bloquear a resposta ao usuario.

### Convencoes de Codigo
- TypeScript com tipos explicitos
- ESM modules (`.js` extensions nos imports)
- Async/await (sem callbacks)
- Logging estruturado via `log.info/warn/error`
- SQL raw (sem ORM)
- Funcoes puras quando possivel

---

## 17. Diagrama de Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────────┐
│                         TELEGRAM                                 │
│  Texto | Audio | Imagem | PDF | Arquivo | Comandos | Callbacks  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      v
┌─────────────────────────────────────────────────────────────────┐
│                    WEBHOOK / POLLING                              │
│  routes/telegram.ts                                              │
│  Valida secret token, extrai update type                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          v           v           v
    ┌──────────┐ ┌──────────┐ ┌──────────────┐
    │ Comando  │ │ Callback │ │   Mensagem   │
    │ /done    │ │ (botao)  │ │   Normal     │
    │ /owner   │ │          │ │              │
    │ /weekly  │ │          │ │              │
    └──────────┘ └──────────┘ └──────┬───────┘
                                     │
                         ┌───────────┼───────────┐
                         v           v           v
                   ┌──────────┐ ┌──────────┐ ┌──────────┐
                   │ Jarbas   │ │  Marta   │ │ Intake   │
                   │ (ghost)  │ │  (CoS)   │ │ Pipeline │
                   └────┬─────┘ └────┬─────┘ └────┬─────┘
                        │            │             │
          ┌─────────────┘   ┌────────┘    ┌────────┘
          v                 v             v
    ┌──────────┐    ┌──────────┐    ┌──────────────┐
    │Perplexity│    │ Claude   │    │ Extracao +   │
    │ Research │    │ (prompts)│    │ Ranking +    │
    └────┬─────┘    └────┬─────┘    │ Classificacao│
         │               │         └──────┬───────┘
         v               v                v
    ┌───────────────────────────────────────────────────┐
    │                   PERSISTENCIA                     │
    │                                                    │
    │  PostgreSQL          Filesystem          Telegram  │
    │  (schema.ts)         (storage.ts)        (resposta)│
    │                                                    │
    │  inbox_items         00_INBOX/           Confirma  │
    │  categories          10_PROJECTS/        Cobra     │
    │  projects            20_AREAS/           owner     │
    │  embeddings          80_STATUS/                    │
    │  people              50_AGENT_OUTPUTS/             │
    │  cos_outputs                                      │
    │  commitments                                      │
    │  decisions                                        │
    └───────────────────────────────────────────────────┘
                      │
                      v
    ┌───────────────────────────────────────────────────┐
    │              SISTEMA PROATIVO                      │
    │  proactive.ts (node-cron)                         │
    │                                                    │
    │  09:00  -> Check-in diario                        │
    │  08:30  -> Relatorio semanal (seg)                │
    │  *:*    -> Verificacao de lembretes               │
    │  5min   -> Sync Google Calendar                   │
    │                                                    │
    │  Envia mensagens proativas via Telegram            │
    └───────────────────────────────────────────────────┘
                      │
                      v
    ┌───────────────────────────────────────────────────┐
    │              DASHBOARD WEB                         │
    │  public/ (Express static)                         │
    │                                                    │
    │  GET /api/dashboard    -> Kanban + Stats           │
    │  GET /api/search       -> Busca semantica          │
    │  PATCH /api/actions/:id -> Editar cards            │
    │  GET /api/agent-outputs -> Outputs Jarbas          │
    │  GET /api/cos          -> Outputs Marta            │
    └───────────────────────────────────────────────────┘
```

---

## 18. Guia para Novos Desenvolvedores

### Setup Local

1. **Clone e instale dependencias:**
```bash
git clone <repo-url>
cd second-brain
npm install
```

2. **Configure o ambiente:**
```bash
cp .env.example .env
# Edite .env com suas chaves
```

3. **Suba o PostgreSQL:**
```bash
docker compose up postgres -d
```

4. **Rode em desenvolvimento:**
```bash
npm run dev
```
O servidor inicia em http://localhost:8080. O schema do banco eh criado automaticamente.

5. **Para Telegram em modo polling (dev):**
```env
TELEGRAM_MODE=polling
```

### Adicionando uma Nova Funcionalidade

#### Novo endpoint de API
1. Adicione a rota em `src/routes/api.ts`
2. Se precisar de queries, adicione-as em `src/db/schema.ts`
3. Se precisar de nova tabela, adicione o SQL em `ensureSchema()`

#### Novo tipo de processamento no intake
1. Adicione a extracao em `extractContent()` em `src/services/intake.ts`
2. Atualize os tipos em `src/types/domain.ts`

#### Novo agente
1. Crie um diretorio em `src/agents/meu-agente/`
2. Implemente o handler seguindo a interface `AgentHandler`
3. Registre em `src/agents/registry.ts`
4. Adicione regra de roteamento em `src/agents/router.ts`

#### Nova intent da Marta
1. Adicione o intent em `src/agents/chiefofstaff/intents.ts`
2. Crie o prompt em `src/agents/chiefofstaff/prompts.ts`
3. Implemente o handler em `src/agents/chiefofstaff/index.ts`

#### Nova integracao externa
1. Crie um servico em `src/services/meu-servico.ts`
2. Adicione variaveis de ambiente em `src/config/env.ts`
3. Use verificacao condicional (`if (env.MINHA_KEY)`) para degradacao graceful

### Pontos de Atencao

1. **`schema.ts` eh grande** (~43k+ linhas): contem schema + todas as queries. Considere dividir se adicionar muitas tabelas.

2. **Sem testes automatizados**: qualquer mudanca deve ser testada manualmente via Telegram e dashboard.

3. **Embeddings em JSONB**: funciona para volume atual, mas nao escala. Para crescimento, migrar para pgvector.

4. **Single-tenant**: o sistema usa `chat_id` para filtrar, mas nao ha isolamento real entre chats.

5. **Sem migrations**: schema eh criado via `IF NOT EXISTS`. Para mudancas de schema, precisa adicionar `ALTER TABLE` condicional em `ensureSchema()`.

---

*Documento gerado por analise completa do codigo-fonte em 2026-02-28.*
