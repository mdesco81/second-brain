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
  `);

  await pool.query(`
    ALTER TABLE inbox_items
      ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'MEDIA',
      ADD COLUMN IF NOT EXISTS due_at DATE,
      ADD COLUMN IF NOT EXISTS next_step TEXT,
      ADD COLUMN IF NOT EXISTS follow_up_with TEXT,
      ADD COLUMN IF NOT EXISTS processing_stage TEXT NOT NULL DEFAULT 'capturado',
      ADD COLUMN IF NOT EXISTS processing_error TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  await pool.query(`
    ALTER TABLE proactive_runs
      ADD COLUMN IF NOT EXISTS run_type TEXT NOT NULL DEFAULT 'daily';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intake_pending_decisions_chat_status
      ON intake_pending_decisions(chat_id, status, created_at DESC);
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
  runType: "daily" | "weekly" | "manual" = "daily"
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
      attachmentCount: row.attachment_count
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
    hasFinalVersion: Boolean(row.metadata?.hasFinalVersion)
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

export async function closePool(): Promise<void> {
  await pool.end();
}
