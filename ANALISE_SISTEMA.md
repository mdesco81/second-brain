# Second Brain - Analise e Interpretacao do Sistema

**Autor:** Claude (Opus 4.6)
**Data:** 2026-02-21
**Versao analisada:** commit `8e7b0de` (feat: multi-agent context merge/split)

---

## 1. O Que Eh o Sistema

O Second Brain eh um **assistente pessoal de gestao de conhecimento e tarefas**, operado inteiramente via Telegram. O usuario envia qualquer tipo de conteudo (texto, audio, imagem, PDF, arquivo) pelo Telegram, e o sistema automaticamente:

1. **Extrai** o conteudo (transcreve audio, interpreta imagens, extrai texto de PDFs)
2. **Classifica** usando IA (categoria, prioridade, acao sugerida, responsavel, prazo)
3. **Decide** se a mensagem eh um complemento de algo ja existente ou algo novo
4. **Persiste** em banco de dados (PostgreSQL) e em arquivos Markdown (knowledge base PARA)
5. **Responde** ao usuario com confirmacao e cobra informacoes faltantes (ex: dono do card)
6. **Monitora** proativamente com check-in diario e relatorio semanal

O dashboard web serve como painel de controle visual, mas o **canal primario de interacao eh o Telegram**.

---

## 2. Arquitetura - Como as Pecas se Conectam

```
                    TELEGRAM
                       |
                       v
              +------------------+
              |  Webhook/Polling |  (routes/telegram.ts + services/polling.ts)
              +------------------+
                       |
                       v
              +------------------+
              |  INTAKE PIPELINE |  (services/intake.ts) -- cerebro do sistema
              +------------------+
                       |
                       v
              +------------------+
              |   ORQUESTRADOR   |  (agents/router.ts) — Claude Sonnet
              |   INTELIGENTE    |  Classifica TODAS as acoes da mensagem
              +------------------+
               /    |    |     \
              v     v    v      v
          Marta  Jarbas Pesquisa  Intake
          (CoS)  (Ghost) (Search)  (Captura)
              \     |    |      /
               v    v    v     v
              +------------------+
              |  DISPATCH        |  Promise.allSettled (paralelo)
              |  PARALELO        |  + fallthrough para intake
              +------------------+
                       |
            +----------+-----------+
            v          v           v
        PostgreSQL  Filesystem   Telegram
        (schema.ts) (storage.ts) (resposta)
                       |
              +------------------+
              |    PROACTIVE     |  (services/proactive.ts)
              |  Daily + Weekly  |  + pattern analysis + agent suggestions
              +------------------+
                       |
                       v
                    TELEGRAM
                  (check-in)

              +------------------+
              |    DASHBOARD     |  (client/ React + routes/api.ts)
              |   CRUD completo  |
              |   + cleanup DB   |
              +------------------+
```

---

## 3. O Pipeline de Intake - A Peca Central

O `services/intake.ts` eh o coracao do sistema. Quando uma mensagem chega do Telegram, o fluxo eh:

### 3.1 Pre-processamento
- Verifica se ha uma **decisao pendente** (usuario foi perguntado se quer merge ou novo card)
- Verifica se eh um **comando** (/start, /help, /done, /owner, /weekly, /prioridades)
- Se nenhum dos dois, entra no pipeline de processamento

### 3.2 Extracao de Conteudo
- **Texto**: usado direto
- **Audio**: download do Telegram -> transcricao via OpenAI Whisper -> combina com caption
- **Imagem**: download -> descricao via modelo de visao (gpt-4o-mini) -> combina com caption
- **PDF**: download -> extracao de texto via pdf-parse -> combina com caption
- **Arquivo generico**: download + armazenamento, sem extracao de conteudo

### 3.3 Ranking de Contexto (Multi-Agent)
1. Busca ate 30 itens abertos do mesmo chat
2. Calcula **embedding** do texto incoming (OpenAI text-embedding-3-small)
3. Para cada candidato, calcula score combinado:
   - **Lexical overlap**: palavras em comum (tokens >= 4 chars), peso 0.7x
   - **Similaridade cosseno**: embedding vs embedding
   - **Boost de continuacao**: +0.08 se texto contem marcadores como "sobre o tema anterior"
4. Retorna top 8 candidatos rankeados

### 3.4 Planejamento com IA
O `planIntakeWithContext` envia para o modelo OpenAI:
- Categorias conhecidas
- Top 8 candidatos abertos com scores
- Texto incoming

E recebe de volta:
- **Decisao**: `merge` (complementar existente) | `new` (criar novo) | `split` (separar em multiplos)
- **Confianca**: 0-1
- **Cards**: 1 a 6 cards com classificacao completa

### 3.5 Gate de Confianca
- Se confianca >= **0.72**: executa automaticamente
- Se confianca < 0.72: cria uma **pending decision** e pergunta ao usuario
  - "Responda: `complemento` (ou `complemento #id`) ou `novo`"

### 3.6 Execucao do Plano
- **Merge**: atualiza o card existente (append de texto, update de metadata)
- **New**: cria novo card com classificacao completa
- **Split**: cria multiplos cards independentes
- Apos execucao: gera embedding, grava nota Markdown, atualiza action board, cobra owner se faltante

---

## 4. Modelo de Dados

### 4.1 Entidades Principais

| Entidade | Proposito |
|----------|-----------|
| `inbox_items` | Card principal - cada captura vira um ou mais items |
| `categories` | Categorias semanticas (Negocios, Saude, etc.) |
| `projects` | Projetos formais criados a partir de cards `CREATE_PROJECT` |
| `chat_subscriptions` | Chats que recebem mensagens proativas |
| `proactive_runs` | Historico de check-ins e relatorios enviados |
| `item_embeddings` | Cache de embeddings para busca semantica |
| `intake_pending_decisions` | Decisoes aguardando confirmacao do usuario |

### 4.2 Ciclo de Vida de um Item

```
capturado -> processando -> interpretado (action=NONE, sem acao necessaria)
                         -> planejado    (acao pendente de execucao)
                         -> falha        (erro de processamento)

planejado -> concluido   (usuario marcou /done ou botao no dashboard)
          -> eliminado   (usuario descartou)

concluido/eliminado -> open (reaberto via dashboard)
```

### 4.3 Classificacao de Cada Item

Cada item recebe:
- **Bucket** (PARA): PROJECTS, AREAS, RESOURCES, RESEARCH, ARCHIVE
- **Action**: CREATE_PROJECT, CREATE_TASK, STORE_REFERENCE, FOLLOW_UP, NONE
- **Priority**: ALTA, MEDIA, BAIXA
- **Due date**: inferido do texto ou derivado da prioridade
- **Next step**: proximo passo concreto
- **Follow-up with**: pessoa/equipe responsavel
- **Confidence**: 0.0 a 1.0

---

## 5. Inteligencia Artificial no Sistema

### 5.1 Modelos Utilizados — 3 Tiers

| Tier | Modelo | Uso |
|------|--------|-----|
| **Premium** (Opus) | `claude-opus-4-6` | Ghostwriter: draft de posts e artigos |
| **Default** (Sonnet) | `claude-sonnet-4-6` | Orquestrador, briefings Marta, notas de reuniao |
| **Fast** (Haiku) | `claude-haiku-4-5` | Classificacao de intents, hashtags, bullets, formatacao |
| **OpenAI** | `gpt-4o-mini-transcribe` | Transcricao de audio (Whisper) |
| **OpenAI** | `text-embedding-3-small` | Embeddings para busca semantica |
| **Perplexity** | `sonar` | Pesquisa externa com citacoes |

### 5.2 Camadas de IA

1. **Orquestrador** (`orchestrateMessage`): classifica a mensagem do usuario e detecta TODAS as acoes (multi-agent), com suporte a clarificacao quando ambiguo. Usa Claude Sonnet.

2. **Planner** (`planIntakeWithContext`): decide merge/new/split com contexto completo dos cards abertos para o pipeline de intake.

3. **Classifier** (`classifyWithAI`): classificador simples usado como **fallback** quando o planner falha.

4. **Fallback heuristico** (`fallbackClassification`): regras por keywords quando a IA esta indisponivel.

### 5.3 Orquestrador Inteligente (Novo)

O sistema agora usa um **orquestrador central** (`agents/router.ts`) que:
- Analisa cada mensagem com few-shot examples em portugues
- Detecta multiplas acoes numa unica mensagem (multi-agent dispatch)
- Mantém contexto conversacional via tabela `chat_context` (ultimas 10 mensagens, janela de 4h)
- Usa memoria persistente (`orchestrator_memory`) para aprender preferencias de roteamento
- Faz perguntas de clarificacao quando a confianca eh baixa (em vez de assumir intake)
- Despacha acoes em paralelo via `Promise.allSettled`

### 5.4 Observacao

O sistema usa providers multiplos (Anthropic para raciocinio, OpenAI para transcricao/embeddings, Perplexity para pesquisa). Cada chamada tem retry com backoff exponencial (2 tentativas). O fallback heuristico garante funcionamento basico mesmo sem IA.

---

## 6. Dashboard Web

O dashboard eh uma SPA em vanilla JS (sem framework) que consome a API REST:

- **GET /api/dashboard**: retorna todo o estado do sistema
- **PATCH /api/actions/:id/status**: atualiza status de um item

Secoes do dashboard:
- Stats globais (total, abertos, resolvidos, eliminados)
- Alertas (atrasados, vencendo hoje, sem dono)
- Pipeline de workflow (5 estagios visuais)
- Foco de hoje (top 3)
- Kanban de prioridades (ALTA/MEDIA/BAIXA)
- Capturas recentes com filtros
- Mapa de captura por tipo
- Categorias mais usadas
- Debrief semanal

Autenticacao: Basic Auth opcional (DASHBOARD_USER + DASHBOARD_PASSWORD).

---

## 7. Sistema Proativo

### 7.1 Check-in Diario (padrao: 9h)
- Resumo das ultimas 24h: itens capturados, projetos, categorias
- Top 3 prioridades abertas

### 7.2 Relatorio Semanal (padrao: segunda 8:30)
- Itens capturados na semana
- Projetos tocados
- Categorias ativas
- Acoes concluidas vs abertas
- Top 5 categorias
- Prioridades da proxima semana

### 7.3 Timezone
Configuravel via `TIMEZONE` (padrao: America/Sao_Paulo).

---

## 8. Infraestrutura e Deploy

- **Dev**: docker-compose.yml (postgres + app, porta 8080)
- **Prod**: docker-compose.prod.yml (postgres + app + caddy para HTTPS)
- **Deploy**: AWS Lightsail com scripts automatizados
- **Backup**: pg_dump + tar do storage
- **Telegram**: webhook com retry de 60s, fallback para polling

---

## 9. Pontos Fortes que Identifiquei

1. **Pipeline de intake sofisticado**: o sistema de ranking por similaridade (lexical + semantica) com threshold de confianca e pending decisions eh uma abordagem madura para lidar com ambiguidade.

2. **Structured outputs**: uso de JSON Schema mode garante resiliencia na comunicacao com a IA.

3. **Merge inteligente**: a capacidade de reconhecer que uma nova mensagem complementa um card existente eh um diferencial real - evita fragmentacao.

4. **Fallback em cascata**: Planner -> Classifier -> Heuristico por keywords. O sistema nunca "trava" por falta de IA.

5. **Orientado a acao**: cada item nao eh apenas "armazenado" - ele recebe proximo passo, responsavel e prazo. Isso transforma captura passiva em gestao ativa.

6. **Proatividade**: o sistema nao espera o usuario perguntar. Ele envia check-ins e cobra acoes.

---

## 10. Pontos de Atencao e Possiveis Fragilidades

### 10.1 ~~Dependencia Total da OpenAI~~ (Parcialmente Resolvido)
O sistema agora usa **Anthropic Claude** como provedor principal (Opus/Sonnet/Haiku) e OpenAI apenas para transcricao e embeddings. A diversificacao de providers reduz o risco de single point of failure.

### 10.2 Embeddings Armazenados como JSONB
Os vetores de embedding estao em JSONB no PostgreSQL. Isso funciona para volumes pequenos, mas busca por similaridade cosseno em JSONB nao escala - cada comparacao requer parse do JSON e calculo em aplicacao. Para volumes maiores, pgvector seria mais adequado.

### 10.3 Ausencia de Testes Automatizados
Nao encontrei nenhum arquivo de teste no projeto. Para um sistema que toma decisoes automaticas sobre dados do usuario, isso eh um risco significativo. Qualquer refatoracao pode quebrar silenciosamente o pipeline.

### 10.4 Single-Tenant por Design
O sistema usa `chat_id` para filtrar, mas a arquitetura eh fundamentalmente single-tenant. Todos os dados coexistem no mesmo banco e filesystem. Nao ha isolamento real entre chats diferentes.

### 10.5 Sem Undo/Historico de Alteracoes
Quando um card recebe merge, o conteudo anterior eh sobrescrito (summary, category, priority). Nao ha log de auditoria do que mudou - apenas o texto normalizado recebe um append com timestamp.

### 10.6 ~~Owner como Texto Livre~~ (Resolvido)
O sistema agora tem tabela `people` com nome, variantes de nome, cargo e fuzzy matching via `resolvePersonFuzzy()`. A Marta gerencia o cadastro de pessoas.

### 10.7 Dashboard Somente-Leitura para Classificacao
O dashboard permite resolver/eliminar/reabrir cards, mas nao permite editar a classificacao (mudar categoria, prioridade, proximo passo). Toda correcao de classificacao depende de interacao via Telegram.

### 10.8 Categorias Sem Hierarquia
As categorias sao flat (lista simples). Para um second brain que cresca, a ausencia de subcategorias ou tags pode limitar a organizacao.

### 10.9 Knowledge Base (Filesystem) Desconectada do Dashboard
Os arquivos Markdown gerados no filesystem (PARA structure) nao sao acessiveis pelo dashboard. Sao escritos mas nunca lidos pelo sistema - funcionam como backup offline.

### 10.10 Seguranca Basica
A autenticacao do dashboard eh Basic Auth opcional. Nao ha rate limiting nas APIs, nao ha CSRF protection, e o webhook secret do Telegram eh a unica protecao contra mensagens falsas.

---

## 11. Minha Interpretacao da Visao do Sistema

O Second Brain foi construido com uma filosofia clara: **captura sem friccao, organizacao automatica, e cobranca proativa**. O usuario nao precisa pensar em onde colocar cada informacao - ele simplesmente envia para o Telegram e o sistema cuida do resto.

A evolucao do git mostra uma trajetoria consistente:
1. Deploy inicial basico
2. Robustez de audio (principal canal de entrada, aparentemente)
3. Classificacao inteligente com prioridades e workflow
4. Dashboard kanban para visualizacao
5. Lifecycle completo com acoes (resolver/eliminar/reabrir)
6. Multi-agent com merge/split e pending decisions
7. Agentes especializados: Jarbas (ghostwriter) e Marta (chief of staff)
8. Pesquisa via Perplexity com citacoes
9. **Orquestrador inteligente com roteamento automatico** (sem keywords)
10. **3 tiers de modelo** (Haiku/Sonnet/Opus) por tipo de tarefa
11. **Memoria conversacional** (chat_context) e **aprendizado persistente** (orchestrator_memory)
12. **Analise de padroes** e sugestao de novos agentes

O sistema esta no estagio de **produto funcional com inteligencia real e roteamento autonomo**. Nao eh um simples "save to database" - ha logica sofisticada de deduplicacao, priorizacao e cobranca. Porem, ainda carrega dividas tecnicas tipicas de um MVP: sem testes, sem observabilidade alem de logs, e com pontos de fragilidade que so aparecem em escala.

A metafora que melhor descreve o sistema: eh um **assistente executivo digital** que recebe briefings por audio/texto, organiza em fichas (cards), prioriza, e cobra follow-up. O dashboard eh o "quadro da sala de reunioes" onde voce ve o status geral.

---

*Documento atualizado em 2026-03-18. Analise estatica do codigo-fonte.*
