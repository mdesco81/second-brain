# Second Brain - Proximos Passos e Roadmap de Evolucao

**Data:** 2026-03-18 (atualizado)
**Estado atual:** Produto funcional com orquestrador inteligente, 3 agentes (Jarbas + Marta + Pesquisa), dashboard React, 3 tiers de modelo (Haiku/Sonnet/Opus)
**Baseado em:** Revisao completa do codigo + pesquisa de melhores praticas 2025-2026

---

## Indice

1. [Bugs Corrigidos Nesta Revisao](#1-bugs-corrigidos-nesta-revisao)
2. [Quick Wins Pendentes](#2-quick-wins-pendentes)
3. [Fase 1 - Resiliencia e Qualidade (Semanas 1-3)](#3-fase-1---resiliencia-e-qualidade-semanas-1-3)
4. [Fase 2 - Busca e Conhecimento (Semanas 4-6)](#4-fase-2---busca-e-conhecimento-semanas-4-6)
5. [Fase 3 - Agentes Mais Inteligentes (Semanas 7-10)](#5-fase-3---agentes-mais-inteligentes-semanas-7-10)
6. [Fase 4 - Observabilidade e Metricas (Semanas 11-13)](#6-fase-4---observabilidade-e-metricas-semanas-11-13)
7. [Fase 5 - Experiencia do Usuario (Semanas 14-16)](#7-fase-5---experiencia-do-usuario-semanas-14-16)
8. [Fase 6 - Escala e Arquitetura (Semanas 17-20)](#8-fase-6---escala-e-arquitetura-semanas-17-20)
9. [Ideias para o Futuro (Backlog)](#9-ideias-para-o-futuro-backlog)
10. [Resumo de Prioridades](#10-resumo-de-prioridades)

---

## 1. Bugs Corrigidos Nesta Revisao

### BUG-001: Email send in-flight set nunca limpava no caso de sucesso
**Arquivo:** `src/services/callbacks.ts`
**Problema:** Apos envio bem-sucedido de email, o `emailSendsInFlight.delete(itemId)` so era chamado no `catch` (erro), nunca no caminho de sucesso. Resultado: apos primeiro envio de email, o botao ficava permanentemente bloqueado com "Email sendo enviado..." para aquele draft.
**Correcao:** Movido `emailSendsInFlight.delete(itemId)` para bloco `finally`, garantindo limpeza em qualquer cenario.

### BUG-002: Validacao inconsistente de IDs nas rotas COS
**Arquivo:** `src/routes/api.ts` (rotas `/cos/output/:id` e `/cos/output/:id/status`)
**Problema:** Usavam `parseInt() + isNaN()` enquanto todas as outras rotas usam `Number() + Number.isInteger() + <= 0`. IDs negativos passavam pela validacao.
**Correcao:** Padronizado para `Number() + Number.isInteger() + <= 0` em todas as rotas COS.

### BUG-003: Timezone sem validacao IANA
**Arquivo:** `src/config/env.ts`
**Problema:** A variavel `TIMEZONE` aceitava qualquer string, incluindo valores invalidos que causariam erros silenciosos no calculo de horarios do cron.
**Correcao:** Adicionado `.refine()` com validacao via `Intl.DateTimeFormat` para aceitar apenas timezones IANA validas.

### BUG-004: Processamento de notas/PDF nao interpretava conteudo (Marta)
**Arquivos:** `src/agents/chiefofstaff/index.ts`, `src/agents/chiefofstaff/prompts.ts`
**Problema:** Ao enviar PDF com notas de reuniao (via dashboard ou Telegram), tres falhas combinadas:
1. **JSON parsing quebrado:** Regex greedy `response.match(/\{[\s\S]*\}/)` capturava conteudo errado em PDFs grandes com chaves no texto
2. **Action items nao distribuidos:** Todos os items eram vinculados apenas a pessoa da reuniao, ignorando o campo `owner` com os donos reais de cada acao
3. **Prompt sem contexto de equipe:** O prompt nao recebia a lista de membros da equipe, impossibilitando atribuicao correta de donos
4. **Conteudo salvo como JSON bruto:** O `cos_outputs.content` armazenava a resposta JSON crua do Claude, exibindo JSON ilegivel no dashboard
**Correcoes:**
- Reescrito `safeParseJson()` com 3 estrategias: limpeza de markdown → bracket-counting → regex greedy como fallback
- `processNotesFromDashboard()` e `handleNotas()`: truncamento (12k chars), lista de membros, resolucao fuzzy de donos via `resolvePersonFuzzy`
- `buildNotesProcessingPrompt()`: recebe `teamMembers`, instrui Claude a usar nomes exatos, exige JSON puro, granularidade por pessoa
- Novo `formatNotesContent()`: converte parsed JSON em texto legivel com emojis e estrutura clara para exibicao no dashboard
- Aplicado em ambos os fluxos (Telegram e Dashboard)

---

## 1b. Implementacoes Concluidas (Marco 2026)

### IMPL-001: Orquestrador Inteligente com Roteamento Automatico
**Status:** CONCLUIDO (2026-03-18)
- Roteamento automatico sem keywords ("jarbas"/"marta" nao sao mais necessarios)
- Deteccao de multiplas acoes numa unica mensagem (multi-agent dispatch paralelo)
- Few-shot examples em portugues para alta precisao
- Agente "pesquisa" integrado ao orquestrador
- Clarificacao inteligente quando confianca baixa

### IMPL-002: 3 Tiers de Modelo
**Status:** CONCLUIDO (2026-03-18)
- Premium (Opus): draft de posts/artigos do Jarbas
- Default (Sonnet): orquestrador, briefings, notas
- Fast (Haiku): classificacao de intents, hashtags, bullets
- Configuravel via ANTHROPIC_PREMIUM_MODEL env var

### IMPL-003: Memoria Conversacional
**Status:** CONCLUIDO (2026-03-18)
- Tabela `chat_context`: ultimas mensagens com janela de 4h
- Tabela `orchestrator_memory`: preferencias de roteamento aprendidas
- Follow-up inteligente via isFollowUp do orquestrador

### IMPL-004: Analise de Padroes e Sugestao de Agentes
**Status:** CONCLUIDO (2026-03-18)
- `analyzePatterns()` em proactive.ts analisa mensagens dos ultimos 28 dias
- Detecta padroes recorrentes e sugere criacao de novos agentes
- Integrado ao relatorio semanal

### IMPL-005: Eliminacao de Redundancias
**Status:** CONCLUIDO (2026-03-18)
- Removida dupla classificacao do Jarbas (pre-classified intent do orquestrador)
- Removido duplo follow-up check no intake
- Removido research keyword short-circuit (orquestrador cuida)

---

## 2. Quick Wins Pendentes

Melhorias de baixo esforco que podem ser feitas a qualquer momento:

### QW-001: Adicionar unhandled rejection handler para IIFE de distillation
**Arquivo:** `src/routes/api.ts` (linhas 418-448)
**Esforco:** 5 min
**O que fazer:** O `(async () => { ... })()` fire-and-forget no endpoint `/items/:id/expand` nao captura rejeicoes sincrona. Trocar por:
```typescript
void (async () => {
  try { ... } catch (err) { log.warn(...); }
})();
```
O prefixo `void` indica explicitamente que o retorno da promise esta sendo ignorado intencionalmente.

### QW-002: Adicionar log em callbacks com NaN
**Arquivo:** `src/services/callbacks.ts`
**Esforco:** 10 min
**O que fazer:** Nos cases do switch que fazem `if (isNaN(itemId)) break;`, adicionar log de warning:
```typescript
if (isNaN(itemId)) {
  log.warn("callback:invalid_item_id", { action, data });
  await answerCallbackQuery(query.id, "Erro: ID invalido.");
  break;
}
```

### QW-003: Rate limiting basico na API
**Arquivo:** `src/app.ts`
**Esforco:** 15 min
**O que fazer:** Adicionar rate limiting simples com middleware in-memory para proteger contra abuso:
```typescript
// Mapa simples: IP -> {count, resetAt}
// Limite: 100 requests/minuto por IP
```
Isso protege a API sem adicionar dependencias.

### QW-004: Adicionar header Content-Security-Policy no dashboard
**Arquivo:** `src/app.ts`
**Esforco:** 5 min
**O que fazer:** Adicionar headers de seguranca basicos:
```typescript
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
```

### QW-005: Validar path traversal na rota de arquivo
**Arquivo:** `src/routes/api.ts` (rotas `/items/:id/file` e `/items/:id/files/:attachmentId`)
**Esforco:** 10 min
**O que fazer:** Validar que o `storagePath` resolvido esta dentro de `STORAGE_ROOT`:
```typescript
const resolved = path.resolve(fileInfo.storagePath);
if (!resolved.startsWith(path.resolve(env.STORAGE_ROOT))) {
  res.status(403).json({ ok: false, error: "forbidden" });
  return;
}
```

---

## 3. Fase 1 - Resiliencia e Qualidade (Semanas 1-3)

**Objetivo:** Tornar o sistema robusto para uso diario sem falhas inesperadas.

### 1.1 Gateway de LLM com Retries e Circuit Breaker
**Prioridade:** CRITICA
**Esforco:** 3-4 dias
**Impacto:** Elimina falhas silenciosas quando APIs de IA ficam fora do ar

**Situacao atual:** As chamadas a Claude e OpenAI em `src/services/openai.ts` (770+ linhas) nao tem retry, fallback entre providers, nem circuit breaker. Se a Anthropic tiver instabilidade por 30 minutos, todas as mensagens desse periodo sao processadas pelo fallback heuristico (confianca ~0.45), gerando cards de baixa qualidade.

**O que fazer:**

Criar um modulo `src/services/llm-gateway.ts` que centralize todas as chamadas de LLM com:

```
┌─────────────────────────────────────────┐
│            LLM Gateway                   │
│                                          │
│  ┌───────────┐  ┌──────────────────┐    │
│  │  Retry    │→ │ Circuit Breaker  │    │
│  │  c/ exp.  │  │  (3 falhas =     │    │
│  │  backoff  │  │   aberto 60s)    │    │
│  └───────────┘  └──────────────────┘    │
│         │                │               │
│         v                v               │
│  ┌───────────┐  ┌──────────────────┐    │
│  │  Claude   │  │  Fallback:       │    │
│  │ (primario)│  │  OpenAI GPT-4    │    │
│  └───────────┘  │  (se disponivel) │    │
│                 └──────────────────┘    │
│                                          │
│  ┌───────────────────────────────────┐  │
│  │  Metricas: latencia, tokens,      │  │
│  │  custo estimado, falhas/sucesso   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Alteracoes na arquitetura:**
- Novo arquivo: `src/services/llm-gateway.ts`
- Refatorar `src/services/openai.ts` para usar o gateway em vez de chamar APIs diretamente
- Classificar erros como TRANSIENT (rate limit, timeout → retry) vs PERMANENT (input invalido → fail fast)
- Adicionar timeout configuravel por tipo de chamada (30s padrao, 120s para geracoes longas)

**Bibliotecas sugeridas:**
- `p-retry` (npm) para retry com backoff exponencial
- `opossum` (npm) para circuit breaker
- Ou implementacao custom simples (~100 linhas)

### 1.2 Testes Automatizados para o Pipeline Critico
**Prioridade:** ALTA
**Esforco:** 5-7 dias
**Impacto:** Permite refatoracoes seguras, previne regressoes

**Situacao atual:** Zero testes automatizados. Qualquer mudanca pode quebrar silenciosamente o pipeline de intake, que eh o coracao do sistema.

**O que fazer:**

Iniciar com testes unitarios dos modulos mais criticos:

1. **Testes de classificacao** (`src/services/classifier.ts`):
   - Fallback heuristico retorna categorias corretas para keywords conhecidas
   - Confianca dentro dos ranges esperados

2. **Testes do ranking de contexto** (`src/services/intake.ts`):
   - Similaridade cosseno calcula corretamente
   - Boost de continuacao funciona
   - Top 8 candidatos retornados

3. **Testes de parsing** (`src/services/openai.ts`):
   - JSON malformado retorna null (nao crash)
   - Correcoes automaticas (split com 1 card → new, etc.)

4. **Testes da API** (`src/routes/api.ts`):
   - Validacao de parametros (IDs invalidos, campos obrigatorios)
   - Respostas corretas para cada endpoint

5. **Testes de intents da Marta** (`src/agents/chiefofstaff/intents.ts`):
   - Fuzzy name matching
   - Classificacao de intents por keyword

**Alteracoes na arquitetura:**
- Adicionar `vitest` (ou `jest`) como devDependency
- Criar pasta `tests/` na raiz
- Adicionar script `npm test` no package.json
- Para mocking de APIs: usar `msw` (Mock Service Worker) ou mocks manuais

### 1.3 Graceful Shutdown Robusto
**Prioridade:** MEDIA
**Esforco:** 1 dia
**Impacto:** Evita perda de mensagens durante deploy

**Situacao atual:** O tracking de in-flight em `src/services/intake.ts` funciona, mas nao ha hook de SIGTERM no processo principal para aguardar mensagens em voo antes de encerrar.

**O que fazer:**
- Em `src/index.ts`, adicionar handler de SIGTERM/SIGINT que:
  1. Para de aceitar novas conexoes
  2. Chama `waitForInflight(30_000)`
  3. Fecha pool do PostgreSQL
  4. Encerra processo

---

## 4. Fase 2 - Busca e Conhecimento (Semanas 4-6)

**Objetivo:** Transformar a busca de boa em excelente com busca hibrida e melhor gestao do conhecimento.

### 2.1 Migrar Embeddings de JSONB para pgvector
**Prioridade:** ALTA
**Esforco:** 3-4 dias
**Impacto:** Busca 10-50x mais rapida, preparacao para escala

**Situacao atual:** Embeddings armazenados como JSONB na tabela `item_embeddings`. A busca por similaridade eh feita na aplicacao (Node.js), carregando TODOS os embeddings do chat e calculando cosseno em loop. Funciona para ~100-200 itens, mas nao escala.

**O que fazer:**

1. Instalar extensao pgvector no PostgreSQL:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

2. Alterar a coluna de embeddings:
```sql
ALTER TABLE item_embeddings ADD COLUMN embedding vector(1536);
-- Migrar dados existentes:
UPDATE item_embeddings SET embedding = vector(vector::text) FROM (
  SELECT item_id, vector FROM item_embeddings
) sub WHERE item_embeddings.item_id = sub.item_id;
```

3. Criar indice HNSW:
```sql
CREATE INDEX idx_item_embeddings_hnsw
ON item_embeddings USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

4. A busca passa a ser uma query SQL:
```sql
SELECT item_id, 1 - (embedding <=> $1::vector) AS similarity
FROM item_embeddings
WHERE chat_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Alteracoes na arquitetura:**
- `docker-compose.yml`: trocar imagem do Postgres por uma com pgvector (`pgvector/pgvector:pg16`)
- `src/db/schema.ts`: alterar `ensureSchema()` para criar extensao e coluna vector
- `src/db/schema.ts`: alterar queries de busca por similaridade
- `src/services/intake.ts`: remover calculo de cosseno client-side
- `src/utils/math.ts`: manter para uso no ranking de contexto (que tambem usa lexical overlap)

### 2.2 Busca Hibrida (Semantica + Full-Text)
**Prioridade:** ALTA
**Esforco:** 2-3 dias (apos 2.1)
**Impacto:** Precisao de busca de ~62% para ~84% (baseado em pesquisa)

**Situacao atual:** A busca usa APENAS embeddings (semantica). Quando OpenAI esta fora ou a query eh muito especifica (nome de pessoa, numero de projeto), a busca falha. O fallback eh ILIKE que nao rankeia resultados.

**O que fazer:**

Implementar busca hibrida com Reciprocal Rank Fusion (RRF):

```
Query do usuario
       │
       ├──→ Busca Semantica (pgvector)   → rank_semantic[]
       │
       └──→ Busca Full-Text (tsvector)   → rank_text[]
              │
              v
       Reciprocal Rank Fusion (k=60)
              │
              v
       score(d) = 1/(k + rank_semantic(d)) + 1/(k + rank_text(d))
              │
              v
       Resultados rankeados finais
```

**Implementacao:**

1. Adicionar coluna tsvector nas tabelas:
```sql
ALTER TABLE inbox_items ADD COLUMN search_vector tsvector;
CREATE INDEX idx_inbox_search ON inbox_items USING GIN (search_vector);

-- Trigger para atualizar automaticamente
CREATE OR REPLACE FUNCTION update_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('portuguese',
    coalesce(NEW.normalized_text, '') || ' ' ||
    coalesce(NEW.summary_pt_br, '') || ' ' ||
    coalesce(NEW.action_title, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_search_vector
BEFORE INSERT OR UPDATE ON inbox_items
FOR EACH ROW EXECUTE FUNCTION update_search_vector();
```

2. Query hibrida combinada:
```sql
WITH semantic AS (
  SELECT ie.item_id, ROW_NUMBER() OVER (ORDER BY ie.embedding <=> $1::vector) AS rank
  FROM item_embeddings ie
  WHERE ie.chat_id = $2
  LIMIT 20
),
fulltext AS (
  SELECT i.id AS item_id, ROW_NUMBER() OVER (ORDER BY ts_rank(i.search_vector, query) DESC) AS rank
  FROM inbox_items i, plainto_tsquery('portuguese', $3) query
  WHERE i.chat_id = $2 AND i.search_vector @@ query
  LIMIT 20
)
SELECT COALESCE(s.item_id, f.item_id) AS item_id,
  COALESCE(1.0 / (60 + s.rank), 0) + COALESCE(1.0 / (60 + f.rank), 0) AS rrf_score
FROM semantic s FULL OUTER JOIN fulltext f ON s.item_id = f.item_id
ORDER BY rrf_score DESC
LIMIT 10;
```

**Alteracoes na arquitetura:**
- `src/db/schema.ts`: nova coluna + trigger + migration para dados existentes
- `src/routes/api.ts`: endpoint `/api/search` usa a query hibrida
- `src/services/intake.ts`: ranking de contexto tambem pode usar a busca hibrida

### 2.3 Sumarizacao Progressiva Automatica
**Prioridade:** MEDIA
**Esforco:** 2 dias
**Impacto:** Itens mais acessados ficam progressivamente mais uteis

**Situacao atual:** O endpoint `/items/:id/expand` gera layers 2 e 3 de sumarizacao, mas depende de acao explicita do usuario no dashboard. A maioria dos usuarios nunca vai clicar.

**O que fazer:**
- Gerar Layer 2 (frases-chave) **automaticamente** para todo item novo com prioridade ALTA ou MEDIA
- Gerar Layer 3 (resumo executivo) automaticamente quando um item eh acessado 3+ vezes OU tem mais de 500 palavras
- Adicionar **deteccao de obsolescencia**: itens nao acessados em 30+ dias recebem flag `possivelmente_obsoleto`
- No check-in semanal, listar itens obsoletos para o usuario decidir

**Alteracoes na arquitetura:**
- `src/services/intake.ts`: apos criar card, disparar Layer 2 async se prioridade alta/media
- `src/db/schema.ts`: adicionar campo `access_count` e `last_accessed_at` em inbox_items
- `src/services/proactive.ts`: adicionar secao de itens obsoletos no relatorio semanal

### 2.4 Decaimento Temporal na Relevancia
**Prioridade:** BAIXA
**Esforco:** 1 dia
**Impacto:** Busca prioriza informacoes mais recentes

**O que fazer:** Adicionar multiplicador de decaimento temporal no score de busca:
```typescript
// Itens recentes recebem boost
const daysSinceCreation = (Date.now() - item.createdAt) / (1000 * 60 * 60 * 24);
const temporalBoost = Math.exp(-daysSinceCreation / 180); // meia-vida de 6 meses
finalScore = rrf_score * (0.7 + 0.3 * temporalBoost);
```

---

## 5. Fase 3 - Agentes Mais Inteligentes (Semanas 7-10)

**Objetivo:** Elevar a qualidade dos agentes Jarbas e Marta com memoria e avaliacao.

### 3.1 Sistema de Memoria Estruturada para Agentes
**Prioridade:** ALTA
**Esforco:** 5-7 dias
**Impacto:** Agentes produzem resultados cada vez mais personalizados

**Situacao atual:** A Marta ja tem um sistema de memoria (`cos_memory`), mas eh basico: armazena fatos e preferencias com confianca. O Jarbas aprende estilo via diff de versoes finais, mas nao tem memoria persistente estruturada.

**O que fazer:**

Implementar tres tipos de memoria, seguindo as melhores praticas de 2025-2026:

```
┌──────────────────────────────────────────────────┐
│                CAMADA DE MEMORIA                  │
│                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────┐ │
│  │   SEMANTICA   │  │  EPISODICA   │  │ PROCED.│ │
│  │  (fatos)      │  │  (eventos)   │  │ (como) │ │
│  │               │  │              │  │        │ │
│  │ "Joao prefere │  │ "Na reuniao  │  │ "User  │ │
│  │  emails       │  │  de 15/02,   │  │ prefere│ │
│  │  diretos"     │  │  decidimos X"│  │ posts  │ │
│  │               │  │              │  │ curtos" │ │
│  └──────────────┘  └──────────────┘  └────────┘ │
│         │                  │              │       │
│         v                  v              v       │
│  ┌──────────────────────────────────────────────┐│
│  │        Extracao Automatica (pos-interacao)    ││
│  │   Claude analisa conversa → extrai memorias   ││
│  └──────────────────────────────────────────────┘│
│         │                                         │
│         v                                         │
│  ┌──────────────────────────────────────────────┐│
│  │         Consolidacao Periodica                ││
│  │   Merge duplicatas, resolve conflitos,        ││
│  │   atualiza confianca, remove obsoletas        ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

**Para o Jarbas:**
- **Memoria semantica:** Topicos favoritos, posicionamentos, vocabulario preferido, frases proibidas
- **Memoria episodica:** Historico de posts (tema, hook usado, feedback)
- **Memoria procedural:** Estrutura preferida, comprimento ideal, estilo de abertura, tom

**Para a Marta:**
- **Memoria semantica:** Fatos sobre cada pessoa (cargo, interesses, estilo de comunicacao)
- **Memoria episodica:** Reunioes passadas, decisoes, compromissos com contexto
- **Memoria procedural:** Preferencias do usuario (formalidade de emails, frequencia de check-ins)

**Alteracoes na arquitetura:**
- Expandir tabela `cos_memory` para incluir `memory_class` (semantic/episodic/procedural)
- Criar tabela similar para Jarbas: `ghostwriter_memory`
- Adicionar funcao `extractMemories(conversation)` que roda apos cada interacao com agente
- Adicionar job de consolidacao semanal em `src/services/proactive.ts`

### 3.2 LLM-as-Judge para Qualidade do Jarbas
**Prioridade:** ALTA
**Esforco:** 2-3 dias
**Impacto:** Elimina rascunhos de baixa qualidade antes de enviar ao usuario

**Situacao atual:** O Jarbas envia o primeiro rascunho gerado, sem avaliacao de qualidade. Se o Claude produz algo generico ou com "cara de IA", o usuario recebe e precisa rejeitar manualmente.

**O que fazer:**

Adicionar etapa de avaliacao apos a geracao do rascunho:

```
Rascunho gerado
       │
       v
  ┌──────────────────────────────────┐
  │   LLM-as-Judge (Claude Haiku)    │
  │                                   │
  │   Avalia em 5 dimensoes (1-5):   │
  │   1. Consistencia de voz         │
  │   2. Potencial de engajamento    │
  │   3. Originalidade (anti-slop)   │
  │   4. Clareza e fluidez           │
  │   5. Precisao factual            │
  │                                   │
  │   Score < 3 em qualquer dim?     │
  │   → Regera com feedback          │
  └──────────────────────────────────┘
       │
       ├── Score OK → Envia ao usuario
       │
       └── Score baixo → Regera (max 2 tentativas)
                        → Se ainda baixo, envia com aviso
```

**Deteccao anti-slop:** Adicionar lista de padroes tipicos de escrita AI para detectar e evitar:
- "No mundo acelerado de hoje..."
- "Eh fundamental que..." (sem contexto)
- Excesso de listas com marcadores
- Conclusoes genericas sem acao

**Alteracoes na arquitetura:**
- `src/agents/ghostwriter/index.ts`: adicionar funcao `evaluateDraft(draft)` entre geracao e envio
- `src/agents/ghostwriter/prompts.ts`: adicionar prompt de avaliacao com rubrica
- `src/agents/ghostwriter/knowledge/`: adicionar `anti-patterns.md` com padroes a evitar
- `src/db/schema.ts`: armazenar scores de qualidade no metadata do item

### 3.3 Perfil de Voz para o Jarbas
**Prioridade:** MEDIA
**Esforco:** 3-4 dias
**Impacto:** Posts mais naturais e alinhados com o estilo real do usuario

**Situacao atual:** O Jarbas usa `style-guide.md` e analisa diffs de versoes finais para aprender estilo. Mas nao mantem um perfil de voz estruturado e persistente.

**O que fazer:**

1. Criar um `voice-profile.json` persistente com:
```json
{
  "tom": "direto, sem floreios, levemente ironico",
  "vocabulario_favorito": ["resolver", "pragmatico", "mao na massa"],
  "vocabulario_banido": ["ecossistema", "sinergia", "disruptivo"],
  "estrutura_preferida": "hook forte → contexto pessoal → insight → CTA",
  "comprimento_ideal": { "post": "800-1200 chars", "artigo": "1500-2500 words" },
  "exemplos_aprovados": ["post_id_42", "post_id_67"],
  "padroes_detectados": [
    "Sempre usa pergunta retorica no hook",
    "Prefere dados concretos a afirmacoes genericas"
  ]
}
```

2. Apos cada versao final salva, atualizar o perfil automaticamente

3. Incluir o perfil no prompt de geracao

**Alteracoes na arquitetura:**
- `src/agents/ghostwriter/knowledge.ts`: adicionar `loadVoiceProfile()` e `updateVoiceProfile()`
- Armazenar perfil no filesystem (`50_AGENT_OUTPUTS/voice-profile.json`) ou no banco
- `src/agents/ghostwriter/prompts.ts`: incluir perfil no system prompt

### 3.4 Conversas Multi-Turno Melhoradas para Marta
**Prioridade:** MEDIA
**Esforco:** 2-3 dias
**Impacto:** Interacoes mais naturais e produtivas

**Situacao atual:** A Marta ja suporta conversas multi-turno via `cos_conversations`, mas com limite fixo de turnos e sem recuperacao de contexto de conversas passadas.

**O que fazer:**
- Aumentar contexto incluindo memorias relevantes no inicio de cada turno
- Permitir que a Marta pergunte proativamente quando detectar informacao ambigua
- Adicionar "resumo de conversa" quando o limite de turnos se aproxima
- Possibilitar retomar conversas pausadas com contexto

### 3.5 ~~Multi-Instrucao Inteligente~~ (CONCLUIDO)
**Status:** Implementado via orquestrador inteligente (2026-03-18)
O orquestrador agora detecta multiplas acoes em qualquer mensagem (texto ou audio) e despacha para agentes diferentes em paralelo. Exemplo: "faz um post sobre lideranca e prepara o briefing do Joao" → Jarbas + Marta em paralelo.

---

## 6. Fase 4 - Observabilidade e Metricas (Semanas 11-13)

**Objetivo:** Visibilidade completa do que o sistema esta fazendo e quao bem esta fazendo.

### 4.1 Metricas de Qualidade dos Agentes
**Prioridade:** ALTA
**Esforco:** 3-4 dias
**Impacto:** Detecta degradacao de qualidade antes que o usuario perceba

**O que fazer:**

Implementar tracking de metricas para cada agente:

**Jarbas:**
| Metrica | Como medir |
|---------|-----------|
| Taxa de aprovacao | % de rascunhos aprovados sem edicao |
| Edicao media | Tamanho do diff entre rascunho e versao final |
| Score LLM-as-Judge | Media dos 5 criterios por post |
| Tempo de geracao | P50, P95, P99 de latencia end-to-end |
| Custo por post | Tokens consumidos * preco |

**Marta:**
| Metrica | Como medir |
|---------|-----------|
| Utilidade do briefing | % de briefings que levam a acao |
| Compromissos cumpridos | % de commitments com status 'fulfilled' |
| Precisao de intents | % de vezes que o intent classificado eh correto |
| Cobertura de memoria | Qtd de memorias por pessoa |
| Tempo de resposta | P50, P95 |

**Intake:**
| Metrica | Como medir |
|---------|-----------|
| Classificacao correta | % de itens que usuario nao reclassifica |
| Decisoes pendentes | % de processos com confianca < 0.72 |
| Merge correto | % de merges que usuario nao desfaz |
| Tempo de processamento | P50, P95 por tipo de input |

**Alteracoes na arquitetura:**
- Nova tabela: `agent_metrics` (agent_id, metric_name, value, timestamp)
- `src/services/proactive.ts`: incluir resumo de metricas no relatorio semanal
- Dashboard: nova aba "Metricas" com graficos simples

### 4.2 Logging Estruturado com Rastreabilidade
**Prioridade:** MEDIA
**Esforco:** 2 dias
**Impacto:** Debug rapido de problemas em producao

**Situacao atual:** O sistema usa `log.info/warn/error` com dados estruturados, mas nao tem correlation ID para rastrear uma mensagem pelo pipeline inteiro.

**O que fazer:**
- Gerar `requestId` unico na entrada de cada mensagem Telegram
- Propagar `requestId` por todas as funcoes do pipeline
- Incluir `requestId` em todos os logs
- Permitir busca: "mostre tudo que aconteceu com a mensagem X"

### 4.3 Dashboard de Saude do Sistema
**Prioridade:** BAIXA
**Esforco:** 2 dias
**Impacto:** Visao rapida de status do sistema

**O que fazer:**
- Endpoint `/api/system-health` com:
  - Status de cada servico externo (Anthropic, OpenAI, Perplexity, Telegram, Google Calendar)
  - Metricas recentes (mensagens/hora, tempo medio de processamento)
  - Alertas (erros nas ultimas 24h, servicos fora)
- Widget no dashboard mostrando saude do sistema

---

## 7. Fase 5 - Experiencia do Usuario (Semanas 14-16)

**Objetivo:** Tornar a interacao mais fluida e o dashboard mais poderoso.

### 5.1 Maquina de Estados para Conversas Telegram
**Prioridade:** MEDIA
**Esforco:** 4-5 dias
**Impacto:** Fluxos multi-passo mais confiaveis e previsiveis

**Situacao atual:** As conversas multi-turno sao gerenciadas por `cos_conversations` (Marta) e flags no intake pipeline. Nao ha um framework formal de FSM (Finite State Machine).

**O que fazer:**

Implementar FSM para fluxos complexos:
```
Estados exemplo (Ghostwriter):
  IDLE → TOPIC_RECEIVED → RESEARCHING → HOOKS_PRESENTED
  → HOOK_SELECTED → GENERATING → DRAFT_PRESENTED
  → (APPROVED | REJECTED | EDITING)

Estados exemplo (Marta briefing):
  IDLE → PERSON_IDENTIFIED → BRIEFING_GENERATED
  → (APPROVED | ADJUST_REQUESTED → BRIEFING_UPDATED)
```

**Beneficios:**
- Cada estado sabe quais mensagens aceitar
- Timeout automatico para conversas abandonadas
- Possibilidade de "voltar atras" no fluxo
- Log de auditoria de transicoes

**Alteracoes na arquitetura:**
- Novo modulo: `src/services/fsm.ts`
- Cada agente define seus estados e transicoes
- Tabela `conversations` unificada (substituindo `cos_conversations` e flags ad-hoc)

### 5.2 Botoes Inline para Acoes Comuns
**Prioridade:** MEDIA
**Esforco:** 2-3 dias
**Impacto:** Reduz friccao de interacao no Telegram

**Situacao atual:** Apos processar uma mensagem, o sistema envia texto com botoes "Done" e "Snooze". Mas muitas acoes comuns ainda dependem de comandos digitados.

**O que fazer:**
- Apos criacao de card: botoes [Done] [Snooze 3d] [Editar Prioridade]
- Apos briefing da Marta: botoes [Enviar Email] [Agendar 1:1] [Ajustar]
- Apos draft do Jarbas: botoes [Aprovar] [Editar] [Regenerar] [Mudar Tom]
- No check-in diario: botoes [Concluir #X] [Adiar #X] [Ver Detalhes]

### 5.3 Dashboard Responsivo com Edicao Completa
**Prioridade:** BAIXA
**Esforco:** 3-4 dias
**Impacto:** Experiencia mobile e funcionalidades faltantes

**Situacao atual:** O dashboard eh funcional mas com limitacoes:
- Nao eh responsivo para mobile
- Nao permite criar categorias pelo dashboard
- Nao permite editar outputs do Jarbas/Marta

**O que fazer:**
- CSS responsivo (media queries para mobile/tablet)
- Formulario de criacao de categoria
- Editor de texto para versoes finais do Jarbas
- Visualizacao de relacao entre itens (quais foram merged)

---

## 8. Fase 6 - Escala e Arquitetura (Semanas 17-20)

**Objetivo:** Preparar o sistema para crescimento e uso intenso.

### 6.1 Refatoracao de Arquivos Grandes
**Prioridade:** ALTA
**Esforco:** 3-4 dias
**Impacto:** Manutenibilidade do codigo

**Situacao atual:**
- `src/db/schema.ts`: Arquivo monolitico que contem TODO o schema SQL + TODAS as queries (~40k+ linhas ao longo do tempo)
- `src/services/intake.ts`: Pipeline completo em um unico arquivo (1300+ linhas)
- `src/services/openai.ts`: Todas as chamadas de IA em um arquivo (770+ linhas)

**O que fazer:**

```
src/db/
├── pool.ts                    # Conexao (ja existe)
├── schema.ts                  # Apenas ensureSchema() + migrations
├── queries/
│   ├── inbox.ts               # Queries de inbox_items
│   ├── categories.ts          # Queries de categories
│   ├── projects.ts            # Queries de projects
│   ├── embeddings.ts          # Queries de embeddings
│   ├── people.ts              # Queries de people
│   ├── cos.ts                 # Queries de cos_outputs, cos_memory, etc.
│   ├── calendar.ts            # Queries de calendar_events
│   ├── commitments.ts         # Queries de commitments, decisions
│   └── reminders.ts           # Queries de reminders
```

```
src/services/
├── intake/
│   ├── index.ts               # Orquestrador principal
│   ├── extractor.ts           # Extracao de conteudo (audio, imagem, PDF)
│   ├── context-ranker.ts      # Ranking de contexto com embeddings
│   ├── planner.ts             # Chamada ao planner (merge/new/split)
│   ├── executor.ts            # Execucao do plano
│   └── commands.ts            # Handlers de comandos /done, /owner, etc.
```

```
src/services/
├── llm/
│   ├── gateway.ts             # Gateway com retry/fallback/circuit breaker
│   ├── claude.ts              # Wrappers Claude
│   ├── openai.ts              # Wrappers OpenAI (transcription, vision)
│   ├── embeddings.ts          # Embeddings
│   └── perplexity.ts          # Perplexity search
```

### 6.2 Sistema de Migrations para Banco de Dados
**Prioridade:** MEDIA
**Esforco:** 2 dias
**Impacto:** Mudancas de schema seguras e rastreadas

**Situacao atual:** O schema eh criado via `IF NOT EXISTS` em `ensureSchema()`. Mudancas de schema requerem `ALTER TABLE` manuais sem tracking.

**O que fazer:**
- Criar pasta `src/db/migrations/` com arquivos numerados (001_initial.sql, 002_add_pgvector.sql, etc.)
- Tabela `migrations` no banco para rastrear quais foram executadas
- No startup, rodar migrations pendentes em ordem
- Nao precisa de ferramenta externa — implementacao simples em ~50 linhas

### 6.3 Cache de Respostas de IA
**Prioridade:** BAIXA
**Esforco:** 2 dias
**Impacto:** Reducao de custo e latencia para queries repetidas

**O que fazer:**
- Cache de classificacoes: se texto similar ja foi classificado, reusar resultado
- Cache de embeddings: ja existe (item_embeddings), OK
- Cache de pesquisa Perplexity: topicos pesquisados recentemente
- TTL configuravel por tipo de cache

---

## 9. Ideias para o Futuro (Backlog)

Estas ideias nao tem prazo definido mas sao direcionais:

### Integracao com Slack/WhatsApp
Expandir canais de entrada alem do Telegram. O pipeline de intake eh agnosctico ao canal — bastaria criar novos adaptadores em `src/routes/`.

### Knowledge Graph
Adicionar grafo de conhecimento (GraphRAG) para mapear relacoes entre pessoas, projetos, decisoes e conceitos. Permitiria perguntas como "quais projetos envolvem o Joao e tem impacto financeiro?".

### Notificacoes Inteligentes
Em vez de check-in diario fixo, o sistema detecta momentos de atencao (baseado em padrao de uso) e envia notificacoes no momento ideal.

### Integracao com N8N
Criar webhooks de entrada/saida para conectar com automacoes N8N. Por exemplo: novo card criado → trigger no N8N → atualizar Notion/Trello/Jira.

### Multi-tenant Real
Adicionar isolamento real por usuario (schemas separados ou row-level security no PostgreSQL) para possibilitar SaaS.

### App Mobile (PWA)
Transformar o dashboard em PWA com notificacoes push, para funcionar como app mobile sem desenvolver nativo.

### Agente de Financas
Novo agente especializado em gestao financeira pessoal: tracking de despesas, analise de orcamento, alertas de vencimento.

### Voice Interface
Integracao com assistentes de voz (Alexa, Google Home) para captura e consulta por comando de voz.

---

## 10. Resumo de Prioridades

### Sequencia Recomendada

```
SEMANA   ITEM                                    ESFORCO  IMPACTO
──────   ─────                                   ───────  ───────
 1       Quick Wins pendentes (QW-001 a QW-005)  1 dia    MEDIO
 1-2     1.1 Gateway de LLM                      3-4 dias CRITICO
 2-3     1.2 Testes automatizados (inicio)        5 dias   ALTO
 3       1.3 Graceful shutdown                    1 dia    MEDIO
 4-5     2.1 pgvector                             3-4 dias ALTO
 5-6     2.2 Busca hibrida                        2-3 dias ALTO
 6       2.3 Sumarizacao progressiva auto         2 dias   MEDIO
 7-8     3.1 Memoria estruturada                  5-7 dias ALTO
 8-9     3.2 LLM-as-Judge                         2-3 dias ALTO
 9-10    3.3 Perfil de voz Jarbas                 3-4 dias MEDIO
 11-12   4.1 Metricas de qualidade                3-4 dias ALTO
 12-13   4.2 Logging com rastreabilidade           2 dias   MEDIO
 14-15   5.1 FSM para conversas                   4-5 dias MEDIO
 15-16   5.2 Botoes inline                         2-3 dias MEDIO
 17-18   6.1 Refatoracao de arquivos               3-4 dias ALTO
 18-19   6.2 Migrations                           2 dias   MEDIO
```

### Top 5 Acoes de Maior Impacto

1. **Gateway de LLM com retry/fallback** — Elimina a principal causa de falhas em producao
2. **pgvector + busca hibrida** — Melhora drastica na qualidade da busca e do contexto
3. **Sistema de memoria para agentes** — Personalizacao cumulativa, agentes ficam melhores a cada uso
4. **LLM-as-Judge para Jarbas** — Qualidade minima garantida em cada rascunho
5. **Refatoracao de arquivos grandes** — Viabiliza desenvolvimento paralelo e manutenibilidade

---

*Documento gerado em 2026-03-01 baseado em revisao completa do codigo-fonte e pesquisa de melhores praticas.*
