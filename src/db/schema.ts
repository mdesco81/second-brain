import { pool } from "./pool.js";
import { DashboardSummary } from "../types/domain.js";

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
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
  actionTitle?: string;
  actionDetails?: string;
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
      action_title,
      action_details,
      confidence,
      storage_path,
      metadata
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
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
      params.actionTitle ?? null,
      params.actionDetails ?? null,
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

export async function insertProactiveRun(chatId: number, messageText: string): Promise<void> {
  await pool.query(`INSERT INTO proactive_runs(chat_id, message_text) VALUES ($1, $2)`, [chatId, messageText]);
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

export async function loadDashboardSummary(): Promise<DashboardSummary> {
  const [totalItems, openActions, totalProjects, categories, recent] = await Promise.all([
    pool.query<{ total: string }>(`SELECT COUNT(*)::TEXT AS total FROM inbox_items`),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM inbox_items WHERE status = 'open' AND action <> 'NONE'`
    ),
    pool.query<{ total: string }>(`SELECT COUNT(*)::TEXT AS total FROM projects WHERE status = 'active'`),
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
      action: string;
      status: string;
    }>(
      `SELECT i.id,
              i.created_at::TEXT,
              i.input_type,
              c.name AS category_name,
              i.summary_pt_br,
              i.action,
              i.status
       FROM inbox_items i
       JOIN categories c ON c.id = i.category_id
       ORDER BY i.created_at DESC
       LIMIT 20`
    )
  ]);

  return {
    totalItems: Number(totalItems.rows[0]?.total ?? 0),
    openActions: Number(openActions.rows[0]?.total ?? 0),
    totalProjects: Number(totalProjects.rows[0]?.total ?? 0),
    categories: categories.rows.map((row) => ({ name: row.name, total: Number(row.total) })),
    recentItems: recent.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      inputType: row.input_type as DashboardSummary["recentItems"][number]["inputType"],
      categoryName: row.category_name,
      summaryPtBr: row.summary_pt_br,
      action: row.action as DashboardSummary["recentItems"][number]["action"],
      status: row.status
    }))
  };
}

export async function closePool(): Promise<void> {
  await pool.end();
}
