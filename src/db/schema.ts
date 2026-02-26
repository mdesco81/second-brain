import { pool } from "./pool.js";
import { ActionPriority, ActionStatus, DashboardSummary, ProcessingStage } from "../types/domain.js";

const DEFAULT_CATEGORIES = [
  {
    name: "Financeiro",
    description: "Fluxo de caixa, impostos, investimentos e custos"
  },
  {
    name: "Saude",
    description: "Consultas, exames, rotina fisica e bem-estar"
  },
  {
    name: "Negocios",
    description: "Clientes, vendas, operacoes e estrategia"
  },
  {
    name: "Estudos",
    description: "Aprendizado, cursos, leitura e pesquisa"
  }
];

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_subscriptions (
      chat_id BIGINT PRIMARY KEY,
      proactive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      locale TEXT NOT NULL DEFAULT 'pt-BR',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inbox_items (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      telegram_message_id BIGINT NOT NULL,
      input_type TEXT NOT NULL,
      raw_text TEXT,
      normalized_text TEXT NOT NULL,
      summary_pt_br TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      bucket TEXT NOT NULL,
      action TEXT NOT NULL,
      action_title TEXT,
      action_details TEXT,
      confidence NUMERIC(4,3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      processing_stage TEXT NOT NULL DEFAULT 'capturado',
      processing_error TEXT,
      storage_path TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      category_id INTEGER REFERENCES categories(id),
      source_item_id INTEGER REFERENCES inbox_items(id),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS proactive_runs (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      message_text TEXT NOT NULL,
      run_type TEXT NOT NULL DEFAULT 'daily',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS item_embeddings (
      item_id INTEGER PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,
      chat_id BIGINT NOT NULL,
      model TEXT NOT NULL,
      vector JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS intake_pending_decisions (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      decision_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS item_attachments (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
      storage_path TEXT NOT NULL,
      file_name TEXT,
      input_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_item_attachments_item_id
      ON item_attachments(item_id);

    -- ── Chief of Staff (Marta) tables ─────────────────────────────────

    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_variants TEXT[] DEFAULT '{}',
      role TEXT,
      relationship TEXT NOT NULL DEFAULT 'direct_report',
      email TEXT,
      one_on_one_cadence TEXT DEFAULT 'weekly',
      last_one_on_one TIMESTAMPTZ,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_people_name ON people(LOWER(name));
    CREATE INDEX IF NOT EXISTS idx_people_active ON people(active) WHERE active = TRUE;

    CREATE TABLE IF NOT EXISTS cos_outputs (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      output_type TEXT NOT NULL,
      person_id INTEGER REFERENCES people(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      parent_id INTEGER REFERENCES cos_outputs(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cos_outputs_chat ON cos_outputs(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cos_outputs_person ON cos_outputs(person_id, output_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cos_outputs_type ON cos_outputs(output_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS cos_memory (
      id SERIAL PRIMARY KEY,
      memory_type TEXT NOT NULL,
      person_id INTEGER REFERENCES people(id),
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      source_output_id INTEGER REFERENCES cos_outputs(id),
      confidence REAL DEFAULT 0.7,
      times_confirmed INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      superseded_by INTEGER REFERENCES cos_memory(id),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cos_memory_person ON cos_memory(person_id, memory_type) WHERE active = TRUE;
    CREATE INDEX IF NOT EXISTS idx_cos_memory_type ON cos_memory(memory_type) WHERE active = TRUE;

    CREATE TABLE IF NOT EXISTS cos_conversations (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      intent TEXT NOT NULL,
      person_id INTEGER REFERENCES people(id),
      state TEXT NOT NULL DEFAULT 'active',
      context JSONB DEFAULT '{}',
      messages JSONB DEFAULT '[]',
      turns INTEGER DEFAULT 0,
      max_turns INTEGER DEFAULT 2,
      output_id INTEGER REFERENCES cos_outputs(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expired_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_cos_conv_active
      ON cos_conversations(chat_id, state, created_at DESC);

    CREATE TABLE IF NOT EXISTS cos_events (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      event_type TEXT NOT NULL,
      person_id INTEGER REFERENCES people(id),
      output_id INTEGER REFERENCES cos_outputs(id),
      memory_id INTEGER REFERENCES cos_memory(id),
      conversation_id INTEGER REFERENCES cos_conversations(id),
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cos_events_chat ON cos_events(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cos_events_person ON cos_events(person_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cos_events_type ON cos_events(event_type, created_at DESC);
  `);

  // Unique partial index for cos_memory (can't be inline in CREATE TABLE)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cos_memory_unique_active
      ON cos_memory(memory_type, key) WHERE active = TRUE;
  `);

  await pool.query(`
    ALTER TABLE inbox_items
      ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'MEDIA',
      ADD COLUMN IF NOT EXISTS due_at DATE,
      ADD COLUMN IF NOT EXISTS next_step TEXT,
      ADD COLUMN IF NOT EXISTS follow_up_with TEXT,
      ADD COLUMN IF NOT EXISTS processing_stage TEXT NOT NULL DEFAULT 'capturado',
      ADD COLUMN IF NOT EXISTS processing_error TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS snoozed_until DATE;
  `);

  // Deduplication: prevent processing same Telegram message twice.
  // First, clean up any pre-existing duplicates (keep the row with the highest id).
  await pool.query(`
    DELETE FROM inbox_items
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY chat_id, telegram_message_id ORDER BY id DESC) AS rn
        FROM inbox_items
        WHERE telegram_message_id > 0
      ) sub
      WHERE sub.rn > 1
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_items_chat_message
      ON inbox_items(chat_id, telegram_message_id)
      WHERE telegram_message_id > 0;
  `);

  await pool.query(`
    ALTER TABLE proactive_runs
      ADD COLUMN IF NOT EXISTS run_type TEXT NOT NULL DEFAULT 'daily';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intake_pending_decisions_chat_status
      ON intake_pending_decisions(chat_id, status, created_at DESC);
  `);

  // Fix projects FK to allow deleting inbox_items without cascade errors
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'projects_source_item_id_fkey'
          AND table_name = 'projects'
      ) THEN
        ALTER TABLE projects DROP CONSTRAINT projects_source_item_id_fkey;
        ALTER TABLE projects ADD CONSTRAINT projects_source_item_id_fkey
          FOREIGN KEY (source_item_id) REFERENCES inbox_items(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    UPDATE inbox_items
    SET processing_stage = CASE
      WHEN status = 'done' THEN 'concluido'
      WHEN status = 'eliminated' THEN 'eliminado'
      WHEN action = 'NONE' THEN 'interpretado'
      ELSE 'planejado'
    END
    WHERE processing_stage IS NULL
       OR processing_stage = 'capturado';
  `);

  for (const category of DEFAULT_CATEGORIES) {
    await pool.query(
      `INSERT INTO categories(name, description, source)
       VALUES ($1, $2, 'seed')
       ON CONFLICT (name) DO NOTHING`,
      [category.name, category.description]
    );
  }
}

export async function upsertCategory(name: string, description: string, source: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO categories(name, description, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (name)
     DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [name, description, source]
  );

  return result.rows[0].id;
}

export async function listCategories(): Promise<Array<{ id: number; name: string; description: string }>> {
  const result = await pool.query<{ id: number; name: string; description: string }>(
    `SELECT id, name, description FROM categories ORDER BY name`
  );
  return result.rows;
}

export async function upsertChatSubscription(chatId: number): Promise<void> {
  await pool.query(
    `INSERT INTO chat_subscriptions(chat_id)
     VALUES ($1)
     ON CONFLICT (chat_id)
     DO UPDATE SET updated_at = NOW()`,
    [chatId]
  );
}

export async function insertInboxItem(params: {
  chatId: number;
  messageId: number;
  inputType: string;
  rawText: string;
  normalizedText: string;
  summaryPtBr: string;
  categoryId: number;
  bucket: string;
  action: string;
  priority: ActionPriority;
  actionTitle?: string;
  actionDetails?: string;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
  processingStage?: ProcessingStage;
  processingError?: string;
  confidence: number;
  storagePath?: string;
  metadata: Record<string, unknown>;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO inbox_items (
      chat_id,
      telegram_message_id,
      input_type,
      raw_text,
      normalized_text,
      summary_pt_br,
      category_id,
      bucket,
      action,
      priority,
      action_title,
      action_details,
      due_at,
      next_step,
      follow_up_with,
      processing_stage,
      processing_error,
      confidence,
      storage_path,
      metadata
    ) VALUES (
      $1::BIGINT,$2::BIGINT,$3::TEXT,$4::TEXT,$5::TEXT,$6::TEXT,$7::INTEGER,$8::TEXT,$9::TEXT,$10::TEXT,$11::TEXT,$12::TEXT,$13::DATE,$14::TEXT,$15::TEXT,$16::TEXT,$17::TEXT,$18::NUMERIC,$19::TEXT,$20::JSONB
    ) RETURNING id`,
    [
      params.chatId,
      params.messageId,
      params.inputType,
      params.rawText,
      params.normalizedText,
      params.summaryPtBr,
      params.categoryId,
      params.bucket,
      params.action,
      params.priority,
      params.actionTitle ?? null,
      params.actionDetails ?? null,
      params.dueAt ?? null,
      params.nextStep ?? null,
      params.followUpWith ?? null,
      params.processingStage ?? "capturado",
      params.processingError ?? null,
      params.confidence,
      params.storagePath ?? null,
      JSON.stringify(params.metadata)
    ]
  );

  return result.rows[0].id;
}

export async function updateInboxItemStoragePath(itemId: number, storagePath: string): Promise<void> {
  await pool.query(`UPDATE inbox_items SET storage_path = $2 WHERE id = $1`, [itemId, storagePath]);
}

export async function ensureProject(params: {
  title: string;
  categoryId: number;
  sourceItemId: number;
  notes?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO projects(title, category_id, source_item_id, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (title)
     DO UPDATE SET
       updated_at = NOW(),
       notes = EXCLUDED.notes`,
    [params.title, params.categoryId, params.sourceItemId, params.notes ?? null]
  );
}

function normalizePriority(value: string | null | undefined): ActionPriority {
  if (value === "ALTA" || value === "MEDIA" || value === "BAIXA") {
    return value;
  }
  return "MEDIA";
}

function normalizeProcessingStage(value: string | null | undefined): ProcessingStage {
  if (
    value === "capturado" ||
    value === "processando" ||
    value === "interpretado" ||
    value === "planejado" ||
    value === "concluido" ||
    value === "eliminado" ||
    value === "falha"
  ) {
    return value;
  }
  return "capturado";
}

function priorityRank(value: ActionPriority): number {
  if (value === "ALTA") {
    return 3;
  }
  if (value === "MEDIA") {
    return 2;
  }
  return 1;
}

export interface OpenActionItem {
  id: number;
  chatId: number;
  categoryName: string;
  summaryPtBr: string;
  action: string;
  actionTitle?: string;
  nextStep?: string;
  followUpWith?: string;
  dueAt?: string;
  createdAt: string;
  priority: ActionPriority;
}

export interface ContinuationContextItem {
  chatId: number;
  id: number;
  categoryName: string;
  categoryDescription: string;
  summaryPtBr: string;
  normalizedText: string;
  action: string;
  actionTitle?: string;
  actionDetails?: string;
  nextStep?: string;
  followUpWith?: string;
  dueAt?: string;
  priority: ActionPriority;
  createdAt: string;
  embedding?: number[];
}

export interface PendingDecision {
  id: number;
  chatId: number;
  decisionType: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

export async function insertProactiveRun(
  chatId: number,
  messageText: string,
  runType: "daily" | "afternoon" | "evening" | "weekly" | "manual" = "daily"
): Promise<void> {
  await pool.query(`INSERT INTO proactive_runs(chat_id, message_text, run_type) VALUES ($1, $2, $3)`, [
    chatId,
    messageText,
    runType
  ]);
}

export async function loadLast24hSnapshot(): Promise<{
  items: number;
  projects: number;
  categoriesUsed: number;
}> {
  const result = await pool.query<{ items: string; projects: string; categories_used: string }>(`
    SELECT
      COUNT(i.id)::TEXT AS items,
      COUNT(DISTINCT p.id)::TEXT AS projects,
      COUNT(DISTINCT i.category_id)::TEXT AS categories_used
    FROM inbox_items i
    LEFT JOIN projects p ON p.source_item_id = i.id
    WHERE i.created_at >= NOW() - INTERVAL '24 hours'
  `);

  return {
    items: Number(result.rows[0]?.items ?? 0),
    projects: Number(result.rows[0]?.projects ?? 0),
    categoriesUsed: Number(result.rows[0]?.categories_used ?? 0)
  };
}

export async function listProactiveChats(): Promise<number[]> {
  const result = await pool.query<{ chat_id: string }>(
    `SELECT chat_id::TEXT AS chat_id FROM chat_subscriptions WHERE proactive_enabled = TRUE`
  );
  return result.rows.map((row) => Number(row.chat_id));
}

export async function listOpenActionItems(chatId?: number, limit = 10): Promise<OpenActionItem[]> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    category_name: string;
    summary_pt_br: string;
    action: string;
    action_title: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    created_at: string;
    priority: string | null;
  }>(
    `SELECT i.id,
            i.chat_id::TEXT,
            c.name AS category_name,
            i.summary_pt_br,
            i.action,
            i.action_title,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.created_at::TEXT,
            i.priority
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.status = 'open'
       AND i.action <> 'NONE'
       AND (i.snoozed_until IS NULL OR i.snoozed_until <= CURRENT_DATE)
       AND ($1::BIGINT IS NULL OR i.chat_id = $1)
     ORDER BY
       CASE i.priority WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC,
       i.due_at ASC NULLS LAST,
       i.created_at DESC
     LIMIT $2`,
    [chatId ?? null, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    priority: normalizePriority(row.priority)
  }));
}

export async function loadLatestOpenItemForChat(chatId: number): Promise<ContinuationContextItem | null> {
  const result = await pool.query<{
    chat_id: string;
    id: number;
    category_name: string;
    category_description: string;
    summary_pt_br: string;
    normalized_text: string;
    action: string;
    action_title: string | null;
    action_details: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    priority: string | null;
    created_at: string;
    embedding: number[] | null;
  }>(
    `SELECT i.id,
            i.chat_id::TEXT AS chat_id,
            c.name AS category_name,
            c.description AS category_description,
            i.summary_pt_br,
            i.normalized_text,
            i.action,
            i.action_title,
            i.action_details,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.priority,
            i.created_at::TEXT,
            e.vector::jsonb AS embedding
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     LEFT JOIN item_embeddings e ON e.item_id = i.id
     WHERE i.chat_id = $1
       AND i.status = 'open'
       AND i.action <> 'NONE'
     ORDER BY i.created_at DESC
     LIMIT 1`,
    [chatId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    chatId: Number(row.chat_id),
    id: row.id,
    categoryName: row.category_name,
    categoryDescription: row.category_description,
    summaryPtBr: row.summary_pt_br,
    normalizedText: row.normalized_text,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    actionDetails: row.action_details ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    priority: normalizePriority(row.priority),
    createdAt: row.created_at,
    embedding: Array.isArray(row.embedding) ? row.embedding : undefined
  };
}

export async function listOpenContextCandidates(chatId: number, limit = 30): Promise<ContinuationContextItem[]> {
  const result = await pool.query<{
    chat_id: string;
    id: number;
    category_name: string;
    category_description: string;
    summary_pt_br: string;
    normalized_text: string;
    action: string;
    action_title: string | null;
    action_details: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    priority: string | null;
    created_at: string;
    embedding: number[] | null;
  }>(
    `SELECT i.chat_id::TEXT AS chat_id,
            i.id,
            c.name AS category_name,
            c.description AS category_description,
            i.summary_pt_br,
            i.normalized_text,
            i.action,
            i.action_title,
            i.action_details,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.priority,
            i.created_at::TEXT,
            e.vector::jsonb AS embedding
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     LEFT JOIN item_embeddings e ON e.item_id = i.id
     WHERE i.chat_id = $1
       AND i.status = 'open'
       AND i.action <> 'NONE'
     ORDER BY
       CASE i.priority WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC,
       i.due_at ASC NULLS LAST,
       i.created_at DESC
     LIMIT $2`,
    [chatId, limit]
  );

  return result.rows.map((row) => ({
    chatId: Number(row.chat_id),
    id: row.id,
    categoryName: row.category_name,
    categoryDescription: row.category_description,
    summaryPtBr: row.summary_pt_br,
    normalizedText: row.normalized_text,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    actionDetails: row.action_details ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    priority: normalizePriority(row.priority),
    createdAt: row.created_at,
    embedding: Array.isArray(row.embedding) ? row.embedding : undefined
  }));
}

export async function upsertItemEmbedding(params: {
  itemId: number;
  chatId: number;
  model: string;
  vector: number[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO item_embeddings(item_id, chat_id, model, vector, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (item_id)
     DO UPDATE SET
       chat_id = EXCLUDED.chat_id,
       model = EXCLUDED.model,
       vector = EXCLUDED.vector,
       updated_at = NOW()`,
    [params.itemId, params.chatId, params.model, JSON.stringify(params.vector)]
  );
}

export async function updateInboxItemOwnerById(itemId: number, owner: string): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items
     SET follow_up_with = $2,
         processing_error = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [itemId, owner]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function mergeIntoInboxItem(params: {
  chatId: number;
  targetItemId: number;
  categoryId: number;
  bucket: string;
  action: string;
  summaryPtBr: string;
  actionTitle?: string;
  actionDetails?: string;
  priority: ActionPriority;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
  normalizedTextAppend: string;
  rawTextAppend?: string;
}): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items
     SET category_id = $3::INTEGER,
         bucket = $4::TEXT,
         action = $5::TEXT,
         -- Summary: use AI synthesis if it's longer than existing; otherwise append to preserve content
         summary_pt_br = CASE
           WHEN LENGTH($6::TEXT) >= LENGTH(summary_pt_br) THEN $6::TEXT
           ELSE summary_pt_br || E'\n[Atualização] ' || $6::TEXT
         END,
         -- Title: only replace if new value is non-empty and substantive (>10 chars)
         action_title = CASE
           WHEN $7::TEXT IS NOT NULL AND LENGTH(TRIM($7::TEXT)) > 10 THEN $7::TEXT
           ELSE COALESCE(action_title, $7::TEXT)
         END,
         action_details = COALESCE(action_details, '') || CASE WHEN action_details IS NULL OR action_details = '' THEN '' ELSE E'\n\n' END || $8::TEXT,
         priority = $9::TEXT,
         due_at = COALESCE($10::DATE, due_at),
         next_step = COALESCE($11::TEXT, next_step),
         follow_up_with = COALESCE($12::TEXT, follow_up_with),
         normalized_text = normalized_text || E'\n\n[Complemento ' || NOW()::TEXT || E']\n' || $13::TEXT,
         raw_text = CASE
           WHEN $14::TEXT IS NOT NULL AND $14::TEXT != '' THEN raw_text || E'\n' || $14::TEXT
           ELSE raw_text
         END,
         processing_stage = 'planejado',
         processing_error = NULL,
         updated_at = NOW()
     WHERE id = $1::INTEGER
       AND chat_id = $2::BIGINT
       AND status = 'open'
     RETURNING id`,
    [
      params.targetItemId,
      params.chatId,
      params.categoryId,
      params.bucket,
      params.action,
      params.summaryPtBr,
      params.actionTitle ?? null,
      params.actionDetails ?? params.summaryPtBr,
      params.priority,
      params.dueAt ?? null,
      params.nextStep ?? null,
      params.followUpWith ?? null,
      params.normalizedTextAppend,
      params.rawTextAppend ?? null
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function createPendingDecision(params: {
  chatId: number;
  decisionType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `UPDATE intake_pending_decisions
     SET status = 'resolved',
         resolved_at = NOW()
     WHERE chat_id = $1
       AND decision_type = $2
       AND status = 'pending'`,
    [params.chatId, params.decisionType]
  );

  await pool.query(
    `INSERT INTO intake_pending_decisions(chat_id, decision_type, payload, status)
     VALUES ($1, $2, $3::jsonb, 'pending')`,
    [params.chatId, params.decisionType, JSON.stringify(params.payload)]
  );
}

export async function getPendingDecision(chatId: number, decisionType: string): Promise<PendingDecision | null> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    decision_type: string;
    payload: Record<string, unknown>;
    status: string;
    created_at: string;
  }>(
    `SELECT id,
            chat_id::TEXT AS chat_id,
            decision_type,
            payload,
            status,
            created_at::TEXT
     FROM intake_pending_decisions
     WHERE chat_id = $1
       AND decision_type = $2
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [chatId, decisionType]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    chatId: Number(row.chat_id),
    decisionType: row.decision_type,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at
  };
}

export async function resolvePendingDecision(id: number): Promise<void> {
  await pool.query(
    `UPDATE intake_pending_decisions
     SET status = 'resolved',
         resolved_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

export async function updateInboxItemStatus(chatId: number, itemId: number, status: ActionStatus): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items
     SET status = $3,
         updated_at = NOW(),
         processing_stage = CASE
           WHEN $3 = 'done' THEN 'concluido'
           WHEN $3 = 'eliminated' THEN 'eliminado'
           ELSE CASE WHEN action = 'NONE' THEN 'interpretado' ELSE 'planejado' END
         END
     WHERE id = $1
       AND chat_id = $2
     RETURNING id`,
    [itemId, chatId, status]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateInboxItemStatusById(itemId: number, status: ActionStatus): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items
     SET status = $2,
         updated_at = NOW(),
         processing_stage = CASE
           WHEN $2 = 'done' THEN 'concluido'
           WHEN $2 = 'eliminated' THEN 'eliminado'
           ELSE CASE WHEN action = 'NONE' THEN 'interpretado' ELSE 'planejado' END
         END
     WHERE id = $1
     RETURNING id`,
    [itemId, status]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function loadWeeklySummary(chatId?: number): Promise<{
  items: number;
  projectsTouched: number;
  categoriesUsed: number;
  doneActions: number;
  openActions: number;
  topCategories: Array<{ name: string; total: number }>;
  nextWeekPriorities: OpenActionItem[];
}> {
  const [totals, topCategories, openActions] = await Promise.all([
    pool.query<{
      items: string;
      projects_touched: string;
      categories_used: string;
      done_actions: string;
      open_actions: string;
    }>(
      `SELECT
          COUNT(i.id)::TEXT AS items,
          COUNT(DISTINCT p.id)::TEXT AS projects_touched,
          COUNT(DISTINCT i.category_id)::TEXT AS categories_used,
          COUNT(*) FILTER (WHERE i.status = 'done' AND i.action <> 'NONE')::TEXT AS done_actions,
          COUNT(*) FILTER (WHERE i.status = 'open' AND i.action <> 'NONE')::TEXT AS open_actions
       FROM inbox_items i
       LEFT JOIN projects p ON p.source_item_id = i.id
       WHERE i.created_at >= NOW() - INTERVAL '7 days'
         AND ($1::BIGINT IS NULL OR i.chat_id = $1)`,
      [chatId ?? null]
    ),
    pool.query<{ name: string; total: string }>(
      `SELECT c.name, COUNT(*)::TEXT AS total
       FROM inbox_items i
       JOIN categories c ON c.id = i.category_id
       WHERE i.created_at >= NOW() - INTERVAL '7 days'
         AND ($1::BIGINT IS NULL OR i.chat_id = $1)
       GROUP BY c.name
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
      [chatId ?? null]
    ),
    listOpenActionItems(chatId, 5)
  ]);

  return {
    items: Number(totals.rows[0]?.items ?? 0),
    projectsTouched: Number(totals.rows[0]?.projects_touched ?? 0),
    categoriesUsed: Number(totals.rows[0]?.categories_used ?? 0),
    doneActions: Number(totals.rows[0]?.done_actions ?? 0),
    openActions: Number(totals.rows[0]?.open_actions ?? 0),
    topCategories: topCategories.rows.map((row) => ({ name: row.name, total: Number(row.total) })),
    nextWeekPriorities: openActions.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority)).slice(0, 5)
  };
}

export async function loadDashboardSummary(): Promise<DashboardSummary> {
  const [totalItems, openActions, totalProjects, statusBreakdown, alerts, captureBreakdown, categories, recent, openQueue, weeklyDebrief] =
    await Promise.all([
      pool.query<{ total: string }>(`SELECT COUNT(*)::TEXT AS total FROM inbox_items`),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total FROM inbox_items WHERE status = 'open' AND action <> 'NONE'`
      ),
      pool.query<{ total: string }>(`SELECT COUNT(*)::TEXT AS total FROM projects WHERE status = 'active'`),
      pool.query<{
        open_total: string;
        done_total: string;
        eliminated_total: string;
        open_actionable: string;
        done_actionable: string;
        eliminated_actionable: string;
        classified_total: string;
      }>(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'open')::TEXT AS open_total,
            COUNT(*) FILTER (WHERE status = 'done')::TEXT AS done_total,
            COUNT(*) FILTER (WHERE status = 'eliminated')::TEXT AS eliminated_total,
            COUNT(*) FILTER (WHERE status = 'open' AND action <> 'NONE')::TEXT AS open_actionable,
            COUNT(*) FILTER (WHERE status = 'done' AND action <> 'NONE')::TEXT AS done_actionable,
            COUNT(*) FILTER (WHERE status = 'eliminated' AND action <> 'NONE')::TEXT AS eliminated_actionable,
            COUNT(*) FILTER (WHERE processing_stage IN ('interpretado', 'planejado', 'concluido', 'eliminado'))::TEXT AS classified_total
         FROM inbox_items`
      ),
      pool.query<{
        overdue: string;
        due_today: string;
        missing_owner: string;
      }>(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'open' AND action <> 'NONE' AND due_at < CURRENT_DATE)::TEXT AS overdue,
            COUNT(*) FILTER (WHERE status = 'open' AND action <> 'NONE' AND due_at = CURRENT_DATE)::TEXT AS due_today,
            COUNT(*) FILTER (
              WHERE status = 'open'
                AND action <> 'NONE'
                AND (
                  follow_up_with IS NULL
                  OR BTRIM(follow_up_with) = ''
                  OR lower(BTRIM(follow_up_with)) = 'responsavel interno'
                  OR lower(BTRIM(follow_up_with)) = 'pendente_dono'
                  OR lower(BTRIM(follow_up_with)) = 'definir responsavel e cobrar atualizacao'
                )
            )::TEXT AS missing_owner
         FROM inbox_items`
      ),
      pool.query<{ input_type: string; total: string }>(
        `SELECT input_type, COUNT(*)::TEXT AS total
         FROM inbox_items
         GROUP BY input_type
         ORDER BY COUNT(*) DESC`
      ),
      pool.query<{ name: string; total: string }>(
        `SELECT c.name, COUNT(*)::TEXT AS total
         FROM inbox_items i
         JOIN categories c ON c.id = i.category_id
         GROUP BY c.name
         ORDER BY COUNT(*) DESC
         LIMIT 12`
      ),
      pool.query<{
        id: number;
        created_at: string;
        input_type: string;
        category_name: string;
        summary_pt_br: string;
        raw_text: string | null;
        action_details: string | null;
        action: string;
        action_title: string | null;
        priority: string;
        status: ActionStatus;
        due_at: string | null;
        next_step: string | null;
        follow_up_with: string | null;
        processing_stage: string | null;
        processing_error: string | null;
        storage_path: string | null;
        attachment_count: number;
        metadata: Record<string, unknown>;
      }>(
        `SELECT i.id,
                i.created_at::TEXT,
                i.input_type,
                c.name AS category_name,
                i.summary_pt_br,
                i.raw_text,
                i.action_details,
                i.action,
                i.action_title,
                i.priority,
                i.status,
                i.due_at::TEXT,
                i.next_step,
                i.follow_up_with,
                i.processing_stage,
                i.processing_error,
                i.storage_path,
                i.metadata,
                (SELECT COUNT(*) FROM item_attachments WHERE item_id = i.id)::INTEGER AS attachment_count
         FROM inbox_items i
         JOIN categories c ON c.id = i.category_id
         ORDER BY i.created_at DESC
         LIMIT 100`
      ),
      listOpenActionItems(undefined, 30),
      pool.query<{ sent_at: string; message_text: string }>(
        `SELECT sent_at::TEXT, message_text
         FROM proactive_runs
         WHERE run_type = 'weekly'
         ORDER BY sent_at DESC
         LIMIT 1`
      )
    ]);

  const focusItems = openQueue.slice(0, 8);
  const todayFocus = openQueue.slice(0, 3);
  const kanbanHigh = openQueue.filter((item) => item.priority === "ALTA");
  const kanbanMedium = openQueue.filter((item) => item.priority === "MEDIA");
  const kanbanLow = openQueue.filter((item) => item.priority === "BAIXA");
  const status = statusBreakdown.rows[0];
  const alertRow = alerts.rows[0];
  const totalCaptured = Number(totalItems.rows[0]?.total ?? 0);
  const actionable =
    Number(status?.open_actionable ?? 0) + Number(status?.done_actionable ?? 0) + Number(status?.eliminated_actionable ?? 0);

  return {
    totalItems: Number(totalItems.rows[0]?.total ?? 0),
    openActions: Number(openActions.rows[0]?.total ?? 0),
    totalProjects: Number(totalProjects.rows[0]?.total ?? 0),
    statusBreakdown: {
      open: Number(status?.open_total ?? 0),
      done: Number(status?.done_total ?? 0),
      eliminated: Number(status?.eliminated_total ?? 0)
    },
    alerts: {
      overdue: Number(alertRow?.overdue ?? 0),
      dueToday: Number(alertRow?.due_today ?? 0),
      missingOwner: Number(alertRow?.missing_owner ?? 0)
    },
    captureBreakdown: captureBreakdown.rows.map((row) => ({
      inputType: row.input_type as DashboardSummary["captureBreakdown"][number]["inputType"],
      total: Number(row.total)
    })),
    workflow: {
      captured: totalCaptured,
      classified: Number(status?.classified_total ?? 0),
      actionable,
      resolved: Number(status?.done_actionable ?? 0),
      eliminated: Number(status?.eliminated_actionable ?? 0)
    },
    latestWeeklyDebrief: weeklyDebrief.rows[0]
      ? {
          sentAt: weeklyDebrief.rows[0].sent_at,
          message: weeklyDebrief.rows[0].message_text
        }
      : undefined,
    categories: categories.rows.map((row) => ({ name: row.name, total: Number(row.total) })),
    recentItems: recent.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      inputType: row.input_type as DashboardSummary["recentItems"][number]["inputType"],
      categoryName: row.category_name,
      summaryPtBr: row.summary_pt_br,
      rawText: row.raw_text ?? undefined,
      actionDetails: row.action_details ?? undefined,
      action: row.action as DashboardSummary["recentItems"][number]["action"],
      actionTitle: row.action_title ?? undefined,
      priority: normalizePriority(row.priority),
      status: row.status,
      dueAt: row.due_at ?? undefined,
      nextStep: row.next_step ?? undefined,
      followUpWith: row.follow_up_with ?? undefined,
      processingStage: normalizeProcessingStage(row.processing_stage),
      processingError: row.processing_error ?? undefined,
      hasFile: row.attachment_count > 0 || Boolean(row.storage_path && !row.storage_path.endsWith(".md")),
      attachmentCount: row.attachment_count,
      progressive: (row.metadata?.progressive as { layer2?: string[]; layer3?: string; expandCount?: number }) ?? undefined
    })),
    todayFocus: todayFocus.map((item) => ({
      id: item.id,
      categoryName: item.categoryName,
      summaryPtBr: item.summaryPtBr,
      action: item.action as DashboardSummary["todayFocus"][number]["action"],
      priority: item.priority,
      dueAt: item.dueAt,
      nextStep: item.nextStep,
      followUpWith: item.followUpWith
    })),
    focusItems: focusItems.map((item) => ({
      id: item.id,
      categoryName: item.categoryName,
      summaryPtBr: item.summaryPtBr,
      action: item.action as DashboardSummary["focusItems"][number]["action"],
      priority: item.priority,
      dueAt: item.dueAt,
      followUpWith: item.followUpWith
    })),
    kanban: {
      high: kanbanHigh.map((item) => ({
        id: item.id,
        categoryName: item.categoryName,
        summaryPtBr: item.summaryPtBr,
        action: item.action as DashboardSummary["kanban"]["high"][number]["action"],
        priority: item.priority,
        dueAt: item.dueAt,
        nextStep: item.nextStep,
        followUpWith: item.followUpWith
      })),
      medium: kanbanMedium.map((item) => ({
        id: item.id,
        categoryName: item.categoryName,
        summaryPtBr: item.summaryPtBr,
        action: item.action as DashboardSummary["kanban"]["medium"][number]["action"],
        priority: item.priority,
        dueAt: item.dueAt,
        nextStep: item.nextStep,
        followUpWith: item.followUpWith
      })),
      low: kanbanLow.map((item) => ({
        id: item.id,
        categoryName: item.categoryName,
        summaryPtBr: item.summaryPtBr,
        action: item.action as DashboardSummary["kanban"]["low"][number]["action"],
        priority: item.priority,
        dueAt: item.dueAt,
        nextStep: item.nextStep,
        followUpWith: item.followUpWith
      }))
    }
  };
}

export async function updateInboxItemFields(itemId: number, fields: {
  summaryPtBr?: string;
  categoryName?: string;
  priority?: ActionPriority;
  dueAt?: string | null;
  nextStep?: string | null;
  followUpWith?: string | null;
  actionTitle?: string | null;
}): Promise<boolean> {
  const setClauses: string[] = [];
  const params: unknown[] = [itemId];
  let paramIndex = 2;

  if (fields.summaryPtBr !== undefined) {
    setClauses.push(`summary_pt_br = $${paramIndex}`);
    params.push(fields.summaryPtBr);
    paramIndex += 1;
  }
  if (fields.priority !== undefined) {
    setClauses.push(`priority = $${paramIndex}`);
    params.push(fields.priority);
    paramIndex += 1;
  }
  if (fields.dueAt !== undefined) {
    setClauses.push(`due_at = $${paramIndex}::DATE`);
    params.push(fields.dueAt);
    paramIndex += 1;
  }
  if (fields.nextStep !== undefined) {
    setClauses.push(`next_step = $${paramIndex}`);
    params.push(fields.nextStep);
    paramIndex += 1;
  }
  if (fields.followUpWith !== undefined) {
    setClauses.push(`follow_up_with = $${paramIndex}`);
    params.push(fields.followUpWith);
    paramIndex += 1;
  }
  if (fields.actionTitle !== undefined) {
    setClauses.push(`action_title = $${paramIndex}`);
    params.push(fields.actionTitle);
    paramIndex += 1;
  }
  if (fields.categoryName !== undefined) {
    const catResult = await pool.query<{ id: number }>(
      `SELECT id FROM categories WHERE name = $1`,
      [fields.categoryName]
    );
    if (catResult.rows[0]) {
      setClauses.push(`category_id = $${paramIndex}`);
      params.push(catResult.rows[0].id);
      paramIndex += 1;
    }
  }

  if (setClauses.length === 0) {
    return false;
  }

  setClauses.push("updated_at = NOW()");

  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    params
  );
  return (result.rowCount ?? 0) > 0;
}

export async function loadDoneToday(chatId?: number): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::TEXT AS total
     FROM inbox_items
     WHERE status = 'done'
       AND action <> 'NONE'
       AND processing_stage = 'concluido'
       AND updated_at >= CURRENT_DATE
       AND ($1::BIGINT IS NULL OR chat_id = $1)`,
    [chatId ?? null]
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function listOverdueItems(chatId?: number, limit = 10): Promise<OpenActionItem[]> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    category_name: string;
    summary_pt_br: string;
    action: string;
    action_title: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    created_at: string;
    priority: string | null;
  }>(
    `SELECT i.id,
            i.chat_id::TEXT,
            c.name AS category_name,
            i.summary_pt_br,
            i.action,
            i.action_title,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.created_at::TEXT,
            i.priority
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.status = 'open'
       AND i.action <> 'NONE'
       AND i.due_at < CURRENT_DATE
       AND ($1::BIGINT IS NULL OR i.chat_id = $1)
     ORDER BY i.due_at ASC, i.priority DESC
     LIMIT $2`,
    [chatId ?? null, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    priority: normalizePriority(row.priority)
  }));
}

export async function listStaleItems(chatId?: number, staleDays = 3, limit = 10): Promise<OpenActionItem[]> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    category_name: string;
    summary_pt_br: string;
    action: string;
    action_title: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    created_at: string;
    priority: string | null;
  }>(
    `SELECT i.id,
            i.chat_id::TEXT,
            c.name AS category_name,
            i.summary_pt_br,
            i.action,
            i.action_title,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.created_at::TEXT,
            i.priority
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.status = 'open'
       AND i.action <> 'NONE'
       AND i.created_at < NOW() - INTERVAL '1 day' * $3
       AND (i.due_at IS NULL OR i.due_at >= CURRENT_DATE)
       AND ($1::BIGINT IS NULL OR i.chat_id = $1)
     ORDER BY
       CASE i.priority WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC,
       i.created_at ASC
     LIMIT $2`,
    [chatId ?? null, limit, staleDays]
  );

  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    priority: normalizePriority(row.priority)
  }));
}

export async function loadVocabularyTerms(limit = 80): Promise<string[]> {
  const result = await pool.query<{ term: string }>(
    `SELECT DISTINCT term FROM (
       SELECT DISTINCT BTRIM(follow_up_with) AS term
         FROM inbox_items
         WHERE follow_up_with IS NOT NULL
           AND BTRIM(follow_up_with) <> ''
           AND lower(BTRIM(follow_up_with)) NOT IN ('pendente_dono', 'responsavel interno', 'usuario', 'definir responsavel e cobrar atualizacao')
       UNION
       SELECT DISTINCT name AS term FROM categories
       UNION
       SELECT DISTINCT title AS term FROM projects WHERE status = 'active'
     ) sub
     WHERE term IS NOT NULL AND length(term) >= 2
     ORDER BY term
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => row.term);
}

export async function getItemFileInfo(itemId: number): Promise<{
  storagePath: string;
  inputType: string;
} | null> {
  const result = await pool.query<{
    storage_path: string | null;
    input_type: string;
  }>(
    `SELECT storage_path, input_type FROM inbox_items WHERE id = $1`,
    [itemId]
  );
  const row = result.rows[0];
  if (!row?.storage_path) return null;
  return { storagePath: row.storage_path, inputType: row.input_type };
}

export async function insertDashboardItem(params: {
  summaryPtBr: string;
  categoryId: number;
  priority: ActionPriority;
  actionTitle?: string;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO inbox_items (
      chat_id, telegram_message_id, input_type, raw_text, normalized_text,
      summary_pt_br, category_id, bucket, action, priority,
      action_title, due_at, next_step, follow_up_with,
      processing_stage, confidence, metadata
    ) VALUES (
      0, 0, 'text', $1, $1,
      $1, $2, 'AREAS', 'CREATE_TASK', $3,
      $4, $5::DATE, $6, $7,
      'planejado', 0.95, '{}'::JSONB
    ) RETURNING id`,
    [
      params.summaryPtBr,
      params.categoryId,
      params.priority,
      params.actionTitle ?? null,
      params.dueAt ?? null,
      params.nextStep ?? null,
      params.followUpWith ?? null
    ]
  );
  return result.rows[0].id;
}

// --- Item Attachments ---

export interface ItemAttachment {
  id: number;
  itemId: number;
  storagePath: string;
  fileName: string | null;
  inputType: string;
  createdAt: string;
}

export async function insertItemAttachment(params: {
  itemId: number;
  storagePath: string;
  fileName?: string;
  inputType: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO item_attachments (item_id, storage_path, file_name, input_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [params.itemId, params.storagePath, params.fileName ?? null, params.inputType]
  );
  return result.rows[0].id;
}

export async function listItemAttachments(itemId: number): Promise<ItemAttachment[]> {
  const result = await pool.query<{
    id: number;
    item_id: number;
    storage_path: string;
    file_name: string | null;
    input_type: string;
    created_at: string;
  }>(
    `SELECT id, item_id, storage_path, file_name, input_type, created_at::TEXT
     FROM item_attachments
     WHERE item_id = $1
     ORDER BY created_at ASC`,
    [itemId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    inputType: row.input_type,
    createdAt: row.created_at
  }));
}

export async function getAttachmentById(attachmentId: number): Promise<{
  storagePath: string;
  fileName: string | null;
  inputType: string;
  itemId: number;
} | null> {
  const result = await pool.query<{
    storage_path: string;
    file_name: string | null;
    input_type: string;
    item_id: number;
  }>(
    `SELECT storage_path, file_name, input_type, item_id
     FROM item_attachments WHERE id = $1`,
    [attachmentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    storagePath: row.storage_path,
    fileName: row.file_name,
    inputType: row.input_type,
    itemId: row.item_id
  };
}

export interface AgentOutputItem {
  id: number;
  createdAt: string;
  summaryPtBr: string;
  actionTitle: string | null;
  status: ActionStatus;
  storagePath: string | null;
  agentId: string | null;
  contentType: string | null;
  topic: string | null;
  draftPath: string | null;
  hasFinalVersion: boolean;
  hashtags: string[];
  hooks: Array<{ type: string; text: string; selected: boolean }>;
}

export async function listAgentOutputs(): Promise<AgentOutputItem[]> {
  const result = await pool.query<{
    id: number;
    created_at: string;
    summary_pt_br: string;
    action_title: string | null;
    status: ActionStatus;
    storage_path: string | null;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, created_at::TEXT, summary_pt_br, action_title, status, storage_path, metadata
     FROM inbox_items
     WHERE metadata->>'isAgentOutput' = 'true'
     ORDER BY created_at DESC
     LIMIT 50`
  );

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    summaryPtBr: row.summary_pt_br,
    actionTitle: row.action_title,
    status: row.status,
    storagePath: row.storage_path,
    agentId: (row.metadata?.agentId as string) ?? null,
    contentType: (row.metadata?.agentContentType as string) ?? null,
    topic: (row.metadata?.agentTopic as string) ?? null,
    draftPath: (row.metadata?.draftPath as string) ?? null,
    hasFinalVersion: Boolean(row.metadata?.hasFinalVersion),
    hashtags: Array.isArray(row.metadata?.hashtags) ? (row.metadata.hashtags as string[]) : [],
    hooks: Array.isArray(row.metadata?.hooks) ? (row.metadata.hooks as Array<{ type: string; text: string; selected: boolean }>) : []
  }));
}

export async function getInboxItemMetadata(
  itemId: number
): Promise<{ metadata: Record<string, unknown>; storagePath: string | null } | null> {
  const result = await pool.query<{
    metadata: Record<string, unknown>;
    storage_path: string | null;
  }>(
    `SELECT metadata, storage_path FROM inbox_items WHERE id = $1::INTEGER`,
    [itemId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { metadata: row.metadata ?? {}, storagePath: row.storage_path };
}

export async function updateInboxItemMetadata(
  itemId: number,
  metadata: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE inbox_items SET metadata = metadata || $2::JSONB WHERE id = $1::INTEGER`,
    [itemId, JSON.stringify(metadata)]
  );
}

export async function deleteInboxItem(itemId: number): Promise<{
  storagePath: string | null;
  attachmentPaths: string[];
} | null> {
  // Gather file paths before deleting (so we can clean up files on disk)
  const itemResult = await pool.query<{ storage_path: string | null }>(
    `SELECT storage_path FROM inbox_items WHERE id = $1::INTEGER`,
    [itemId]
  );
  if (itemResult.rows.length === 0) return null;

  const attachResult = await pool.query<{ storage_path: string }>(
    `SELECT storage_path FROM item_attachments WHERE item_id = $1::INTEGER`,
    [itemId]
  );

  const storagePath = itemResult.rows[0].storage_path;
  const attachmentPaths = attachResult.rows.map((r) => r.storage_path);

  // Nullify project FK references (projects table lacks ON DELETE CASCADE)
  await pool.query(
    `UPDATE projects SET source_item_id = NULL WHERE source_item_id = $1::INTEGER`,
    [itemId]
  );

  // Delete the item (cascades to item_attachments, item_embeddings)
  await pool.query(`DELETE FROM inbox_items WHERE id = $1::INTEGER`, [itemId]);

  return { storagePath, attachmentPaths };
}

export async function listInboxQueue(limit = 20): Promise<Array<{
  id: number;
  createdAt: string;
  inputType: string;
  categoryName: string;
  summaryPtBr: string;
  rawText: string | null;
  actionTitle: string | null;
  priority: ActionPriority;
  processingStage: string;
}>> {
  const result = await pool.query<{
    id: number;
    created_at: string;
    input_type: string;
    category_name: string;
    summary_pt_br: string;
    raw_text: string | null;
    action_title: string | null;
    priority: string;
    processing_stage: string;
  }>(
    `SELECT i.id, i.created_at::TEXT, i.input_type, c.name AS category_name,
            i.summary_pt_br, i.raw_text, i.action_title, i.priority, i.processing_stage
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.status = 'open'
       AND (
         i.processing_stage IN ('capturado', 'interpretado')
         OR (i.action_title IS NULL AND i.next_step IS NULL)
       )
     ORDER BY i.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    inputType: row.input_type,
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    rawText: row.raw_text,
    actionTitle: row.action_title,
    priority: normalizePriority(row.priority),
    processingStage: row.processing_stage
  }));
}

export async function countInboxQueue(): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::TEXT AS total
     FROM inbox_items
     WHERE status = 'open'
       AND (
         processing_stage IN ('capturado', 'interpretado')
         OR (action_title IS NULL AND next_step IS NULL)
       )`
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function processInboxItem(
  id: number,
  params: {
    mode: "actionable" | "reference" | "trash";
    priority?: ActionPriority;
    nextStep?: string;
    followUpWith?: string;
    dueAt?: string;
  }
): Promise<boolean> {
  let query: string;
  let queryParams: unknown[];

  if (params.mode === "actionable") {
    query = `UPDATE inbox_items
     SET processing_stage = 'planejado',
         action = 'CREATE_TASK',
         priority = $2,
         next_step = $3,
         follow_up_with = $4,
         due_at = $5::DATE,
         updated_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING id`;
    queryParams = [
      id,
      params.priority ?? "MEDIA",
      params.nextStep ?? null,
      params.followUpWith ?? null,
      params.dueAt ?? null
    ];
  } else if (params.mode === "reference") {
    query = `UPDATE inbox_items
     SET processing_stage = 'interpretado',
         action = 'STORE_REFERENCE',
         bucket = 'RESOURCES',
         updated_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING id`;
    queryParams = [id];
  } else {
    // trash
    query = `UPDATE inbox_items
     SET status = 'eliminated',
         processing_stage = 'eliminado',
         updated_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING id`;
    queryParams = [id];
  }

  const result = await pool.query<{ id: number }>(query, queryParams);
  return (result.rowCount ?? 0) > 0;
}

export async function getItemForDistill(id: number): Promise<{
  normalizedText: string;
  rawText: string | null;
  summaryPtBr: string;
  metadata: Record<string, unknown>;
} | null> {
  const result = await pool.query<{
    normalized_text: string;
    raw_text: string | null;
    summary_pt_br: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT normalized_text, raw_text, summary_pt_br, metadata
     FROM inbox_items WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    normalizedText: row.normalized_text,
    rawText: row.raw_text,
    summaryPtBr: row.summary_pt_br,
    metadata: row.metadata ?? {}
  };
}

export async function incrementExpandCount(id: number): Promise<number> {
  const result = await pool.query<{ metadata: Record<string, unknown> }>(
    `UPDATE inbox_items
     SET metadata = jsonb_set(
       jsonb_set(
         metadata,
         '{progressive}',
         COALESCE(metadata->'progressive', '{}'::jsonb)
       ),
       '{progressive,expandCount}',
       to_jsonb(COALESCE((metadata->'progressive'->>'expandCount')::int, 0) + 1)
     ),
     updated_at = NOW()
     WHERE id = $1
     RETURNING metadata`,
    [id]
  );
  const meta = result.rows[0]?.metadata;
  const progressive = meta?.progressive as Record<string, unknown> | undefined;
  return (progressive?.expandCount as number) ?? 1;
}

export async function updateProgressiveLayer(
  id: number,
  layer: "layer2" | "layer3",
  value: unknown,
  expandCount: number
): Promise<void> {
  const now = new Date().toISOString();

  // Build the progressive JSON object in JS instead of nesting jsonb_set with interpolated paths
  const progressiveUpdate: Record<string, unknown> = {
    [layer]: value,
    [layer === "layer2" ? "layer2At" : "layer3At"]: now,
    expandCount
  };

  await pool.query(
    `UPDATE inbox_items
     SET metadata = jsonb_set(
       metadata,
       '{progressive}',
       COALESCE(metadata->'progressive', '{}'::jsonb) || $2::jsonb
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(progressiveUpdate)]
  );
}

export async function loadAllEmbeddings(): Promise<Array<{ itemId: number; vector: number[] }>> {
  const result = await pool.query<{ item_id: number; vector: number[] }>(
    `SELECT item_id, vector::jsonb AS vector FROM item_embeddings`
  );
  return result.rows
    .filter((row) => Array.isArray(row.vector))
    .map((row) => ({ itemId: row.item_id, vector: row.vector }));
}

export async function searchItemsByIds(ids: number[]): Promise<Array<{
  id: number;
  createdAt: string;
  inputType: string;
  categoryName: string;
  summaryPtBr: string;
  rawText: string | null;
  actionTitle: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  dueAt: string | null;
  nextStep: string | null;
  followUpWith: string | null;
}>> {
  if (ids.length === 0) return [];
  const result = await pool.query<{
    id: number;
    created_at: string;
    input_type: string;
    category_name: string;
    summary_pt_br: string;
    raw_text: string | null;
    action_title: string | null;
    priority: string;
    status: string;
    due_at: string | null;
    next_step: string | null;
    follow_up_with: string | null;
  }>(
    `SELECT i.id, i.created_at::TEXT, i.input_type, c.name AS category_name,
            i.summary_pt_br, i.raw_text, i.action_title, i.priority, i.status,
            i.due_at::TEXT, i.next_step, i.follow_up_with
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.id = ANY($1::INTEGER[])`,
    [ids]
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    inputType: row.input_type,
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    rawText: row.raw_text,
    actionTitle: row.action_title,
    priority: normalizePriority(row.priority),
    status: row.status as ActionStatus,
    dueAt: row.due_at,
    nextStep: row.next_step,
    followUpWith: row.follow_up_with
  }));
}

export async function textSearchItems(query: string, limit = 10): Promise<Array<{
  id: number;
  createdAt: string;
  inputType: string;
  categoryName: string;
  summaryPtBr: string;
  rawText: string | null;
  actionTitle: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  dueAt: string | null;
  nextStep: string | null;
  followUpWith: string | null;
}>> {
  const escaped = query.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  const result = await pool.query<{
    id: number;
    created_at: string;
    input_type: string;
    category_name: string;
    summary_pt_br: string;
    raw_text: string | null;
    action_title: string | null;
    priority: string;
    status: string;
    due_at: string | null;
    next_step: string | null;
    follow_up_with: string | null;
  }>(
    `SELECT i.id, i.created_at::TEXT, i.input_type, c.name AS category_name,
            i.summary_pt_br, i.raw_text, i.action_title, i.priority, i.status,
            i.due_at::TEXT, i.next_step, i.follow_up_with
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.summary_pt_br ILIKE $1
        OR i.raw_text ILIKE $1
        OR i.action_title ILIKE $1
        OR i.normalized_text ILIKE $1
     ORDER BY i.created_at DESC
     LIMIT $2`,
    [pattern, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    inputType: row.input_type,
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    rawText: row.raw_text,
    actionTitle: row.action_title,
    priority: normalizePriority(row.priority),
    status: row.status as ActionStatus,
    dueAt: row.due_at,
    nextStep: row.next_step,
    followUpWith: row.follow_up_with
  }));
}

// ── Snooze ───────────────────────────────────────────────────────────

export async function snoozeInboxItem(chatId: number, itemId: number, untilDate: string): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items
     SET snoozed_until = $3::DATE,
         updated_at = NOW()
     WHERE id = $1
       AND chat_id = $2
       AND status = 'open'
     RETURNING id`,
    [itemId, chatId, untilDate]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Auto-escalation ──────────────────────────────────────────────────

export async function escalateOverdueItems(overdueDays: number): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `UPDATE inbox_items
     SET priority = 'ALTA',
         updated_at = NOW()
     WHERE status = 'open'
       AND action <> 'NONE'
       AND priority <> 'ALTA'
       AND due_at < CURRENT_DATE - $1::INTEGER
     RETURNING id`,
    [overdueDays]
  );
  return result.rows.map((r) => r.id);
}

// ── Auto-archive suggestions ─────────────────────────────────────────

export async function listArchiveSuggestions(chatId: number, staleDays = 30, limit = 5): Promise<OpenActionItem[]> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    category_name: string;
    summary_pt_br: string;
    action: string;
    action_title: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    created_at: string;
    priority: string | null;
  }>(
    `SELECT i.id,
            i.chat_id::TEXT,
            c.name AS category_name,
            i.summary_pt_br,
            i.action,
            i.action_title,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.created_at::TEXT,
            i.priority
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.status = 'open'
       AND i.action <> 'NONE'
       AND i.updated_at < NOW() - INTERVAL '1 day' * $2
       AND i.chat_id = $1
     ORDER BY i.updated_at ASC
     LIMIT $3`,
    [chatId, staleDays, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    priority: normalizePriority(row.priority)
  }));
}

// ── Deduplication check ──────────────────────────────────────────────

export async function isDuplicateMessage(chatId: number, messageId: number): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM inbox_items WHERE chat_id = $1 AND telegram_message_id = $2 LIMIT 1`,
    [chatId, messageId]
  );
  return result.rows.length > 0;
}

// ── Search for Telegram /busca command ───────────────────────────────

export async function textSearchItemsForChat(chatId: number, query: string, limit = 5): Promise<OpenActionItem[]> {
  const escaped = query.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;
  const result = await pool.query<{
    id: number;
    chat_id: string;
    category_name: string;
    summary_pt_br: string;
    action: string;
    action_title: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    created_at: string;
    priority: string | null;
  }>(
    `SELECT i.id,
            i.chat_id::TEXT,
            c.name AS category_name,
            i.summary_pt_br,
            i.action,
            i.action_title,
            i.next_step,
            i.follow_up_with,
            i.due_at::TEXT,
            i.created_at::TEXT,
            i.priority
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.chat_id = $1
       AND (i.summary_pt_br ILIKE $2
            OR i.raw_text ILIKE $2
            OR i.action_title ILIKE $2
            OR i.normalized_text ILIKE $2)
     ORDER BY i.created_at DESC
     LIMIT $3`,
    [chatId, pattern, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    priority: normalizePriority(row.priority)
  }));
}

// ══════════════════════════════════════════════════════════════════════
// Chief of Staff (Marta) — People, Outputs, Memory, Conversations, Events
// ══════════════════════════════════════════════════════════════════════

// ── People ────────────────────────────────────────────────────────────

export interface Person {
  id: number;
  name: string;
  nameVariants: string[];
  role: string | null;
  relationship: string;
  email: string | null;
  oneOnOneCadence: string;
  lastOneOnOne: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function upsertPerson(params: {
  name: string;
  role?: string;
  relationship?: string;
  email?: string;
}): Promise<number> {
  // Check for existing person by name (case-insensitive)
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM people WHERE LOWER(name) = LOWER($1) AND active = TRUE LIMIT 1`,
    [params.name]
  );

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE people SET
         role = COALESCE($2, role),
         relationship = COALESCE($3, relationship),
         email = COALESCE($4, email),
         updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, params.role ?? null, params.relationship ?? null, params.email ?? null]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO people (name, role, relationship, email)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [params.name, params.role ?? null, params.relationship ?? "direct_report", params.email ?? null]
  );
  return result.rows[0].id;
}

export async function listPeople(onlyActive = true): Promise<Person[]> {
  const result = await pool.query<{
    id: number;
    name: string;
    name_variants: string[];
    role: string | null;
    relationship: string;
    email: string | null;
    one_on_one_cadence: string;
    last_one_on_one: string | null;
    notes: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, name, name_variants, role, relationship, email,
            one_on_one_cadence, last_one_on_one::TEXT, notes, active,
            created_at::TEXT, updated_at::TEXT
     FROM people
     WHERE ($1::BOOLEAN = FALSE OR active = TRUE)
     ORDER BY name`,
    [onlyActive]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameVariants: row.name_variants ?? [],
    role: row.role,
    relationship: row.relationship,
    email: row.email,
    oneOnOneCadence: row.one_on_one_cadence,
    lastOneOnOne: row.last_one_on_one,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function findPersonByName(namePart: string): Promise<Person[]> {
  const pattern = `%${namePart.toLowerCase()}%`;
  const result = await pool.query<{
    id: number;
    name: string;
    name_variants: string[];
    role: string | null;
    relationship: string;
    email: string | null;
    one_on_one_cadence: string;
    last_one_on_one: string | null;
    notes: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, name, name_variants, role, relationship, email,
            one_on_one_cadence, last_one_on_one::TEXT, notes, active,
            created_at::TEXT, updated_at::TEXT
     FROM people
     WHERE active = TRUE
       AND (LOWER(name) LIKE $1 OR $2 = ANY(SELECT LOWER(unnest(name_variants))))
     ORDER BY name
     LIMIT 5`,
    [pattern, namePart.toLowerCase()]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameVariants: row.name_variants ?? [],
    role: row.role,
    relationship: row.relationship,
    email: row.email,
    oneOnOneCadence: row.one_on_one_cadence,
    lastOneOnOne: row.last_one_on_one,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function updateLastOneOnOne(personId: number): Promise<void> {
  await pool.query(
    `UPDATE people SET last_one_on_one = NOW(), updated_at = NOW() WHERE id = $1`,
    [personId]
  );
}

export async function addNameVariant(personId: number, variant: string): Promise<void> {
  await pool.query(
    `UPDATE people
     SET name_variants = array_append(name_variants, $2),
         updated_at = NOW()
     WHERE id = $1
       AND NOT ($2 = ANY(name_variants))`,
    [personId, variant.toLowerCase()]
  );
}

export async function listItemsByPerson(
  personName: string,
  statuses?: string[]
): Promise<Array<OpenActionItem & { status: string }>> {
  const validStatuses = statuses && statuses.length > 0 ? statuses : ["open", "done", "eliminated"];
  const result = await pool.query<{
    id: number;
    chat_id: string;
    category_name: string;
    summary_pt_br: string;
    action: string;
    action_title: string | null;
    next_step: string | null;
    follow_up_with: string | null;
    due_at: string | null;
    created_at: string;
    priority: string | null;
    status: string;
  }>(
    `SELECT i.id, i.chat_id::TEXT, c.name AS category_name,
            i.summary_pt_br, i.action, i.action_title,
            i.next_step, i.follow_up_with, i.due_at::TEXT,
            i.created_at::TEXT, i.priority, i.status
     FROM inbox_items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.follow_up_with ILIKE '%' || regexp_replace($1, '([%_\\\\])', '\\\\\\1', 'g') || '%'
       AND i.action <> 'NONE'
       AND i.status = ANY($2::TEXT[])
     ORDER BY
       CASE i.status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
       CASE i.priority WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC,
       i.created_at DESC
     LIMIT 50`,
    [personName, validStatuses]
  );
  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    categoryName: row.category_name,
    summaryPtBr: row.summary_pt_br,
    action: row.action,
    actionTitle: row.action_title ?? undefined,
    nextStep: row.next_step ?? undefined,
    followUpWith: row.follow_up_with ?? undefined,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    priority: normalizePriority(row.priority),
    status: row.status
  }));
}

// ── CoS Outputs ───────────────────────────────────────────────────────

export interface CosOutput {
  id: number;
  chatId: number;
  outputType: string;
  personId: number | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  status: string;
  version: number;
  parentId: number | null;
  createdAt: string;
}

export async function insertCosOutput(params: {
  chatId: number;
  outputType: string;
  personId?: number;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  status?: string;
  parentId?: number;
}): Promise<number> {
  const version = params.parentId
    ? (await pool.query<{ v: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM cos_outputs WHERE id = $1 OR parent_id = $1`,
        [params.parentId]
      )).rows[0].v
    : 1;

  const result = await pool.query<{ id: number }>(
    `INSERT INTO cos_outputs (chat_id, output_type, person_id, title, content, metadata, status, version, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7, $8, $9)
     RETURNING id`,
    [
      params.chatId,
      params.outputType,
      params.personId ?? null,
      params.title,
      params.content,
      JSON.stringify(params.metadata ?? {}),
      params.status ?? "draft",
      version,
      params.parentId ?? null
    ]
  );
  return result.rows[0].id;
}

export async function listCosOutputs(
  chatId?: number,
  filters?: { outputType?: string; personId?: number; status?: string; limit?: number }
): Promise<CosOutput[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (chatId !== undefined) {
    conditions.push(`chat_id = $${idx}`);
    params.push(chatId);
    idx++;
  }
  if (filters?.outputType) {
    conditions.push(`output_type = $${idx}`);
    params.push(filters.outputType);
    idx++;
  }
  if (filters?.personId) {
    conditions.push(`person_id = $${idx}`);
    params.push(filters.personId);
    idx++;
  }
  if (filters?.status) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ?? 50;

  const result = await pool.query<{
    id: number;
    chat_id: string;
    output_type: string;
    person_id: number | null;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    status: string;
    version: number;
    parent_id: number | null;
    created_at: string;
  }>(
    `SELECT id, chat_id::TEXT, output_type, person_id, title, content,
            metadata, status, version, parent_id, created_at::TEXT
     FROM cos_outputs
     ${where}
     ORDER BY created_at DESC
     LIMIT ${limit}`
  , params);

  return result.rows.map((row) => ({
    id: row.id,
    chatId: Number(row.chat_id),
    outputType: row.output_type,
    personId: row.person_id,
    title: row.title,
    content: row.content,
    metadata: row.metadata ?? {},
    status: row.status,
    version: row.version,
    parentId: row.parent_id,
    createdAt: row.created_at
  }));
}

export async function getCosOutput(id: number): Promise<CosOutput | null> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    output_type: string;
    person_id: number | null;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    status: string;
    version: number;
    parent_id: number | null;
    created_at: string;
  }>(
    `SELECT id, chat_id::TEXT, output_type, person_id, title, content,
            metadata, status, version, parent_id, created_at::TEXT
     FROM cos_outputs WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    outputType: row.output_type,
    personId: row.person_id,
    title: row.title,
    content: row.content,
    metadata: row.metadata ?? {},
    status: row.status,
    version: row.version,
    parentId: row.parent_id,
    createdAt: row.created_at
  };
}

export async function updateCosOutputStatus(id: number, status: string): Promise<void> {
  await pool.query(`UPDATE cos_outputs SET status = $2 WHERE id = $1`, [id, status]);
}

export async function getLatestCosOutput(personId: number, outputType: string): Promise<CosOutput | null> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    output_type: string;
    person_id: number | null;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    status: string;
    version: number;
    parent_id: number | null;
    created_at: string;
  }>(
    `SELECT id, chat_id::TEXT, output_type, person_id, title, content,
            metadata, status, version, parent_id, created_at::TEXT
     FROM cos_outputs
     WHERE person_id = $1 AND output_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [personId, outputType]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    outputType: row.output_type,
    personId: row.person_id,
    title: row.title,
    content: row.content,
    metadata: row.metadata ?? {},
    status: row.status,
    version: row.version,
    parentId: row.parent_id,
    createdAt: row.created_at
  };
}

// ── CoS Memory ────────────────────────────────────────────────────────

export interface CosMemory {
  id: number;
  memoryType: string;
  personId: number | null;
  key: string;
  content: string;
  source: string | null;
  sourceOutputId: number | null;
  confidence: number;
  timesConfirmed: number;
  timesUsed: number;
  lastUsedAt: string | null;
  active: boolean;
  createdAt: string;
}

export async function upsertCosMemory(params: {
  memoryType: string;
  personId?: number;
  key: string;
  content: string;
  source?: string;
  sourceOutputId?: number;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO cos_memory (memory_type, person_id, key, content, source, source_output_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (memory_type, key) WHERE active = TRUE
     DO UPDATE SET
       content = EXCLUDED.content,
       source = COALESCE(EXCLUDED.source, cos_memory.source),
       source_output_id = COALESCE(EXCLUDED.source_output_id, cos_memory.source_output_id),
       times_confirmed = cos_memory.times_confirmed + 1,
       confidence = LEAST(cos_memory.confidence + 0.1, 1.0),
       updated_at = NOW()
     RETURNING id`,
    [
      params.memoryType,
      params.personId ?? null,
      params.key,
      params.content,
      params.source ?? null,
      params.sourceOutputId ?? null
    ]
  );
  return result.rows[0].id;
}

export async function loadMemoriesForPerson(personId: number, limit = 20): Promise<CosMemory[]> {
  const result = await pool.query<{
    id: number;
    memory_type: string;
    person_id: number | null;
    key: string;
    content: string;
    source: string | null;
    source_output_id: number | null;
    confidence: number;
    times_confirmed: number;
    times_used: number;
    last_used_at: string | null;
    active: boolean;
    created_at: string;
  }>(
    `SELECT id, memory_type, person_id, key, content, source, source_output_id,
            confidence, times_confirmed, times_used, last_used_at::TEXT,
            active, created_at::TEXT
     FROM cos_memory
     WHERE person_id = $1 AND active = TRUE
     ORDER BY confidence DESC, updated_at DESC
     LIMIT $2`,
    [personId, limit]
  );
  return result.rows.map(mapCosMemoryRow);
}

export async function loadMemoriesByType(memoryType: string, limit = 20): Promise<CosMemory[]> {
  const result = await pool.query<{
    id: number;
    memory_type: string;
    person_id: number | null;
    key: string;
    content: string;
    source: string | null;
    source_output_id: number | null;
    confidence: number;
    times_confirmed: number;
    times_used: number;
    last_used_at: string | null;
    active: boolean;
    created_at: string;
  }>(
    `SELECT id, memory_type, person_id, key, content, source, source_output_id,
            confidence, times_confirmed, times_used, last_used_at::TEXT,
            active, created_at::TEXT
     FROM cos_memory
     WHERE memory_type = $1 AND active = TRUE
     ORDER BY confidence DESC, updated_at DESC
     LIMIT $2`,
    [memoryType, limit]
  );
  return result.rows.map(mapCosMemoryRow);
}

export async function loadAllRelevantMemories(params?: {
  personId?: number;
  types?: string[];
  limit?: number;
}): Promise<CosMemory[]> {
  const conditions: string[] = ["active = TRUE"];
  const queryParams: unknown[] = [];
  let idx = 1;

  if (params?.personId) {
    conditions.push(`(person_id = $${idx} OR person_id IS NULL)`);
    queryParams.push(params.personId);
    idx++;
  }
  if (params?.types && params.types.length > 0) {
    conditions.push(`memory_type = ANY($${idx}::TEXT[])`);
    queryParams.push(params.types);
    idx++;
  }

  const limit = params?.limit ?? 30;

  const result = await pool.query<{
    id: number;
    memory_type: string;
    person_id: number | null;
    key: string;
    content: string;
    source: string | null;
    source_output_id: number | null;
    confidence: number;
    times_confirmed: number;
    times_used: number;
    last_used_at: string | null;
    active: boolean;
    created_at: string;
  }>(
    `SELECT id, memory_type, person_id, key, content, source, source_output_id,
            confidence, times_confirmed, times_used, last_used_at::TEXT,
            active, created_at::TEXT
     FROM cos_memory
     WHERE ${conditions.join(" AND ")}
     ORDER BY confidence DESC, updated_at DESC
     LIMIT ${limit}`,
    queryParams
  );
  return result.rows.map(mapCosMemoryRow);
}

export async function markMemoryUsed(memoryId: number): Promise<void> {
  await pool.query(
    `UPDATE cos_memory
     SET times_used = times_used + 1,
         last_used_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [memoryId]
  );
}

export async function supersedMemory(oldId: number, newId: number): Promise<void> {
  await pool.query(
    `UPDATE cos_memory
     SET superseded_by = $2, active = FALSE, updated_at = NOW()
     WHERE id = $1`,
    [oldId, newId]
  );
}

export async function decayUnusedMemories(unusedDays = 60, decayAmount = 0.05): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `UPDATE cos_memory
     SET confidence = GREATEST(confidence - $3, 0.1),
         updated_at = NOW()
     WHERE active = TRUE
       AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 day' * $1)
       AND created_at < NOW() - INTERVAL '1 day' * $2
       AND confidence > 0.1
     RETURNING id`,
    [unusedDays, unusedDays, decayAmount]
  );
  return result.rowCount ?? 0;
}

function mapCosMemoryRow(row: {
  id: number;
  memory_type: string;
  person_id: number | null;
  key: string;
  content: string;
  source: string | null;
  source_output_id: number | null;
  confidence: number;
  times_confirmed: number;
  times_used: number;
  last_used_at: string | null;
  active: boolean;
  created_at: string;
}): CosMemory {
  return {
    id: row.id,
    memoryType: row.memory_type,
    personId: row.person_id,
    key: row.key,
    content: row.content,
    source: row.source,
    sourceOutputId: row.source_output_id,
    confidence: row.confidence,
    timesConfirmed: row.times_confirmed,
    timesUsed: row.times_used,
    lastUsedAt: row.last_used_at,
    active: row.active,
    createdAt: row.created_at
  };
}

// ── CoS Conversations ─────────────────────────────────────────────────

export interface CosConversation {
  id: number;
  chatId: number;
  intent: string;
  personId: number | null;
  state: string;
  context: Record<string, unknown>;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  turns: number;
  maxTurns: number;
  outputId: number | null;
  createdAt: string;
  updatedAt: string;
  expiredAt: string | null;
}

export async function createCosConversation(params: {
  chatId: number;
  intent: string;
  personId?: number;
  context?: Record<string, unknown>;
}): Promise<number> {
  // Expire any existing active conversations for this chat
  await pool.query(
    `UPDATE cos_conversations
     SET state = 'expired', expired_at = NOW(), updated_at = NOW()
     WHERE chat_id = $1 AND state IN ('active', 'clarifying')`,
    [params.chatId]
  );

  const result = await pool.query<{ id: number }>(
    `INSERT INTO cos_conversations (chat_id, intent, person_id, context)
     VALUES ($1, $2, $3, $4::JSONB)
     RETURNING id`,
    [params.chatId, params.intent, params.personId ?? null, JSON.stringify(params.context ?? {})]
  );
  return result.rows[0].id;
}

export async function getActiveCosConversation(chatId: number): Promise<CosConversation | null> {
  // Auto-expire conversations older than 30 minutes
  await pool.query(
    `UPDATE cos_conversations
     SET state = 'expired', expired_at = NOW(), updated_at = NOW()
     WHERE chat_id = $1
       AND state IN ('active', 'clarifying')
       AND updated_at < NOW() - INTERVAL '30 minutes'`,
    [chatId]
  );

  const result = await pool.query<{
    id: number;
    chat_id: string;
    intent: string;
    person_id: number | null;
    state: string;
    context: Record<string, unknown>;
    messages: Array<{ role: string; content: string; timestamp: string }>;
    turns: number;
    max_turns: number;
    output_id: number | null;
    created_at: string;
    updated_at: string;
    expired_at: string | null;
  }>(
    `SELECT id, chat_id::TEXT, intent, person_id, state, context, messages,
            turns, max_turns, output_id, created_at::TEXT, updated_at::TEXT,
            expired_at::TEXT
     FROM cos_conversations
     WHERE chat_id = $1 AND state IN ('active', 'clarifying')
     ORDER BY created_at DESC
     LIMIT 1`,
    [chatId]
  );

  const row = result.rows[0];
  if (!row) return null;
  return mapCosConversationRow(row);
}

export async function appendConversationMessage(
  convId: number,
  role: string,
  content: string
): Promise<void> {
  const message = { role, content, timestamp: new Date().toISOString() };
  await pool.query(
    `UPDATE cos_conversations
     SET messages = messages || $2::JSONB,
         turns = turns + CASE WHEN $3 = 'user' THEN 1 ELSE 0 END,
         updated_at = NOW()
     WHERE id = $1`,
    [convId, JSON.stringify([message]), role]
  );
}

export async function updateCosConversation(
  convId: number,
  updates: { state?: string; context?: Record<string, unknown>; outputId?: number }
): Promise<void> {
  const setClauses: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [convId];
  let idx = 2;

  if (updates.state) {
    setClauses.push(`state = $${idx}`);
    params.push(updates.state);
    idx++;
  }
  if (updates.context) {
    setClauses.push(`context = context || $${idx}::JSONB`);
    params.push(JSON.stringify(updates.context));
    idx++;
  }
  if (updates.outputId) {
    setClauses.push(`output_id = $${idx}`);
    params.push(updates.outputId);
    idx++;
  }

  await pool.query(
    `UPDATE cos_conversations SET ${setClauses.join(", ")} WHERE id = $1`,
    params
  );
}

export async function completeCosConversation(convId: number, outputId?: number): Promise<void> {
  await pool.query(
    `UPDATE cos_conversations
     SET state = 'completed',
         output_id = COALESCE($2, output_id),
         updated_at = NOW()
     WHERE id = $1`,
    [convId, outputId ?? null]
  );
}

export async function expireStaleConversations(): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `UPDATE cos_conversations
     SET state = 'expired', expired_at = NOW(), updated_at = NOW()
     WHERE state IN ('active', 'clarifying')
       AND updated_at < NOW() - INTERVAL '30 minutes'
     RETURNING id`
  );
  return result.rowCount ?? 0;
}

function mapCosConversationRow(row: {
  id: number;
  chat_id: string;
  intent: string;
  person_id: number | null;
  state: string;
  context: Record<string, unknown>;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  turns: number;
  max_turns: number;
  output_id: number | null;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
}): CosConversation {
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    intent: row.intent,
    personId: row.person_id,
    state: row.state,
    context: row.context ?? {},
    messages: Array.isArray(row.messages) ? row.messages : [],
    turns: row.turns,
    maxTurns: row.max_turns,
    outputId: row.output_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiredAt: row.expired_at
  };
}

// ── CoS Events ────────────────────────────────────────────────────────

export interface CosEvent {
  id: number;
  chatId: number;
  eventType: string;
  personId: number | null;
  outputId: number | null;
  memoryId: number | null;
  conversationId: number | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export async function logCosEvent(params: {
  chatId: number;
  eventType: string;
  personId?: number;
  outputId?: number;
  memoryId?: number;
  conversationId?: number;
  details?: Record<string, unknown>;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO cos_events (chat_id, event_type, person_id, output_id, memory_id, conversation_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB)
     RETURNING id`,
    [
      params.chatId,
      params.eventType,
      params.personId ?? null,
      params.outputId ?? null,
      params.memoryId ?? null,
      params.conversationId ?? null,
      JSON.stringify(params.details ?? {})
    ]
  );
  return result.rows[0].id;
}

export async function listEventsForPerson(personId: number, limit = 20): Promise<CosEvent[]> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    event_type: string;
    person_id: number | null;
    output_id: number | null;
    memory_id: number | null;
    conversation_id: number | null;
    details: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT id, chat_id::TEXT, event_type, person_id, output_id, memory_id,
            conversation_id, details, created_at::TEXT
     FROM cos_events
     WHERE person_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [personId, limit]
  );
  return result.rows.map(mapCosEventRow);
}

export async function listRecentCosEvents(chatId: number, limit = 20): Promise<CosEvent[]> {
  const result = await pool.query<{
    id: number;
    chat_id: string;
    event_type: string;
    person_id: number | null;
    output_id: number | null;
    memory_id: number | null;
    conversation_id: number | null;
    details: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT id, chat_id::TEXT, event_type, person_id, output_id, memory_id,
            conversation_id, details, created_at::TEXT
     FROM cos_events
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [chatId, limit]
  );
  return result.rows.map(mapCosEventRow);
}

function mapCosEventRow(row: {
  id: number;
  chat_id: string;
  event_type: string;
  person_id: number | null;
  output_id: number | null;
  memory_id: number | null;
  conversation_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}): CosEvent {
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    eventType: row.event_type,
    personId: row.person_id,
    outputId: row.output_id,
    memoryId: row.memory_id,
    conversationId: row.conversation_id,
    details: row.details ?? {},
    createdAt: row.created_at
  };
}

// ── People with Items (for Dashboard Kanban) ──────────────────────────

export async function listPeopleWithItems(): Promise<Array<Person & {
  items: { open: (OpenActionItem & { status: string })[]; done: (OpenActionItem & { status: string })[]; eliminated: (OpenActionItem & { status: string })[] };
  stats: { totalOpen: number; totalOverdue: number; totalDone: number; daysSinceLastOneOnOne: number | null };
}>> {
  const people = await listPeople(true);
  if (people.length === 0) return [];

  // Fetch all items for all people in parallel (3 queries per person, all concurrent)
  const itemPromises = people.map((person) =>
    Promise.all([
      listItemsByPerson(person.name, ["open"]),
      listItemsByPerson(person.name, ["done"]),
      listItemsByPerson(person.name, ["eliminated"])
    ])
  );
  const allItems = await Promise.all(itemPromises);

  return people.map((person, idx) => {
    const [openItems, doneItems, eliminatedItems] = allItems[idx];
    const overdueCount = openItems.filter((item) => item.dueAt && new Date(item.dueAt) < new Date()).length;
    const daysSince = person.lastOneOnOne
      ? Math.floor((Date.now() - new Date(person.lastOneOnOne).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      ...person,
      items: { open: openItems, done: doneItems.slice(0, 20), eliminated: eliminatedItems.slice(0, 10) },
      stats: {
        totalOpen: openItems.length,
        totalOverdue: overdueCount,
        totalDone: doneItems.length,
        daysSinceLastOneOnOne: daysSince
      }
    };
  });
}

export async function closePool(): Promise<void> {
  await pool.end();
}
