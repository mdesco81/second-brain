# Second Brain MVP (Telegram + Node.js + TypeScript)

MVP para capturar entradas via Telegram (`texto`, `audio`, `PDF`, `imagem`), classificar com agente, armazenar em estrutura de pastas legivel e expor painel web.

## Core features

- Telegram ingestion (webhook ou polling)
- Audio transcription (`gpt-4o-mini-transcribe`)
- PDF text extraction (`pdf-parse`)
- Image understanding (OpenAI vision)
- AI categorization with dynamic category creation
- Action-oriented classification with `prioridade`, `proximo passo`, `quem cobrar/procurar` and optional `prazo`
- Processing lifecycle per item (`capturado` -> `interpretado/planejado` -> `concluido/eliminado`) with failure visibility
- Multi-agent intake orchestration:
  - context retrieval over open cards
  - merge/new/split decision with confidence
  - low-confidence confirmation by user
  - actionable card planner (avoid raw transcript cards)
- Embedding-based similarity over open cards
- Postgres persistence for operational state
- Daily proactive check-in agent with focus queue
- Weekly report with summary + next-week priorities
- Web dashboard (`/`) with stage-by-stage workflow, "Foco de Hoje", risk alerts, capture map, Kanban, status controls, and latest weekly debrief
- Optional basic auth for dashboard/API (`DASHBOARD_USER` + `DASHBOARD_PASSWORD`)

## Folder structure (knowledge base)

Root definido por `STORAGE_ROOT` (padrao: `./storage/SecondBrain`).

- `00_INBOX/`: entradas brutas e anexos
- `10_PROJECTS/`: notas de itens classificados como projeto
- `20_AREAS/`: responsabilidades continuas
- `30_RESOURCES/`: referencias e materiais
- `31_RESEARCH/`: pesquisas em andamento
- `40_ARCHIVE/`: itens arquivados
- `80_STATUS/`: status de projetos e rastreio rapido
- `80_STATUS/action_board.md`: fila de acoes abertas priorizadas
- `90_SYSTEM/`: metadados operacionais

## Tech stack

- Node.js 22
- TypeScript
- Express
- Postgres
- OpenAI SDK
- Docker Compose

## Quick start

1. Copy env file:

```bash
cp .env.example .env
```

2. Preencha no `.env`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_EMBED_MODEL`
- `APP_BASE_URL` (obrigatorio no modo webhook)
- `DASHBOARD_USER` e `DASHBOARD_PASSWORD` (recomendado em producao)

3. Run with Docker Compose:

```bash
docker compose up -d --build
```

4. Open dashboard:

- `http://localhost:8080`

## Telegram mode

- `TELEGRAM_MODE=webhook` (recomendado para 24/7 em VPS)
- `TELEGRAM_MODE=polling` (fallback)

Webhook route:

- `POST /telegram/webhook`

## API endpoints

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/categories`
- `GET /api/actions`

## Daily proactive agent

Config:

- `TIMEZONE` (ex: `America/Sao_Paulo`)
- `PROACTIVE_HOUR`
- `PROACTIVE_MINUTE`
- `WEEKLY_REPORT_DAY` (`0`=domingo ... `6`=sabado)
- `WEEKLY_REPORT_HOUR`
- `WEEKLY_REPORT_MINUTE`

Todos os chats que interagem com o bot entram na lista de check-in diario automaticamente.

Comandos Telegram:

- `/prioridades`: mostra itens abertos com prioridade
- `/done <id>`: marca item como concluido
- `/owner <id> Nome`: define dono responsavel para o card
- `/weekly`: gera resumo semanal sob demanda

## Operational flow

1. Telegram message arrives.
2. Content extraction (text/transcription/pdf/image).
3. AI classification (or rules fallback).
4. Category upsert (including new categories when needed).
5. Inbox item persisted in Postgres (com prioridade, prazo e proximo passo).
6. Knowledge note written in PARA-like folders.
7. Action board atualizado em `80_STATUS/action_board.md`.
8. Action feedback sent to user in PT-BR.

## Notes

- Sem `OPENAI_API_KEY`, o sistema continua funcionando com fallback heuristico para classificacao.
- Para producao, rode atras de reverse proxy TLS (Caddy/Nginx/Traefik).
- Guia de producao no AWS Lightsail: `DEPLOY_LIGHTSAIL.md`.
