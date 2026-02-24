import { Router, text as expressText } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import {
  countInboxQueue,
  deleteInboxItem,
  getAttachmentById,
  getInboxItemMetadata,
  getItemFileInfo,
  getItemForDistill,
  incrementExpandCount,
  insertDashboardItem,
  listAgentOutputs,
  listCategories,
  listInboxQueue,
  listItemAttachments,
  listOpenActionItems,
  loadAllEmbeddings,
  loadDashboardSummary,
  processInboxItem,
  searchItemsByIds,
  textSearchItems,
  updateInboxItemFields,
  updateInboxItemMetadata,
  updateInboxItemStatusById,
  updateProgressiveLayer,
  upsertCategory
} from "../db/schema.js";
import { ActionPriority, ActionStatus } from "../types/domain.js";
import { writeActionBoard } from "../services/storage.js";
import { analyzeFinalVersion, saveFinalVersion } from "../agents/ghostwriter/knowledge.js";
import { embedText, generateDistillation } from "../services/openai.js";
import { log } from "../utils/logger.js";
import { cosineSimilarity } from "../utils/math.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

apiRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const summary = await loadDashboardSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/categories", async (_req, res, next) => {
  try {
    const categories = await listCategories();
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/actions", async (_req, res, next) => {
  try {
    const actions = await listOpenActionItems(undefined, 30);
    res.json({ actions });
  } catch (error) {
    next(error);
  }
});

apiRouter.patch("/actions/:id/status", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status as ActionStatus;
    const validStatuses: ActionStatus[] = ["open", "done", "eliminated"];

    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    if (!validStatuses.includes(status)) {
      res.status(400).json({ ok: false, error: "invalid_status" });
      return;
    }

    const updated = await updateInboxItemStatusById(id, status);
    if (!updated) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    await writeActionBoard(await listOpenActionItems(undefined, 40));
    res.json({ ok: true, id, status });
  } catch (error) {
    next(error);
  }
});

apiRouter.patch("/actions/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const body = req.body ?? {};
    const validPriorities: ActionPriority[] = ["ALTA", "MEDIA", "BAIXA"];
    const fields: Parameters<typeof updateInboxItemFields>[1] = {};

    if (typeof body.summaryPtBr === "string" && body.summaryPtBr.trim()) {
      fields.summaryPtBr = body.summaryPtBr.trim();
    }
    if (typeof body.actionTitle === "string") {
      fields.actionTitle = body.actionTitle.trim() || null;
    }
    if (typeof body.priority === "string" && validPriorities.includes(body.priority)) {
      fields.priority = body.priority;
    }
    if (body.dueAt === null || (typeof body.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueAt))) {
      fields.dueAt = body.dueAt;
    }
    if (typeof body.nextStep === "string") {
      fields.nextStep = body.nextStep.trim() || null;
    }
    if (typeof body.followUpWith === "string") {
      fields.followUpWith = body.followUpWith.trim() || null;
    }
    if (typeof body.categoryName === "string" && body.categoryName.trim()) {
      fields.categoryName = body.categoryName.trim();
    }

    const updated = await updateInboxItemFields(id, fields);
    if (!updated) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    await writeActionBoard(await listOpenActionItems(undefined, 40));
    res.json({ ok: true, id });
  } catch (error) {
    next(error);
  }
});

// --- File viewer endpoint ---
const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webm": "audio/webm"
};

const textBodyParser = expressText({ type: ["text/plain", "text/markdown"], limit: "2mb" });

apiRouter.get("/items/:id/file", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const fileInfo = await getItemFileInfo(id);
    if (!fileInfo) {
      res.status(404).json({ ok: false, error: "no_file" });
      return;
    }

    try {
      await fs.access(fileInfo.storagePath);
    } catch {
      res.status(404).json({ ok: false, error: "file_not_found" });
      return;
    }

    const ext = path.extname(fileInfo.storagePath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const fileName = path.basename(fileInfo.storagePath);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    const fileBuffer = await fs.readFile(fileInfo.storagePath);
    res.send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

// --- List attachments for a card ---
apiRouter.get("/items/:id/files", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const attachments = await listItemAttachments(id);

    // Backwards compat: if no rows in item_attachments, fall back to legacy storage_path
    if (attachments.length === 0) {
      const legacy = await getItemFileInfo(id);
      if (legacy) {
        res.json({
          ok: true,
          attachments: [{
            id: 0,
            itemId: id,
            fileName: path.basename(legacy.storagePath),
            inputType: legacy.inputType,
            url: `/api/items/${id}/file`
          }]
        });
        return;
      }
    }

    res.json({
      ok: true,
      attachments: attachments.map((a) => ({
        id: a.id,
        itemId: a.itemId,
        fileName: a.fileName || path.basename(a.storagePath),
        inputType: a.inputType,
        createdAt: a.createdAt,
        url: `/api/items/${id}/files/${a.id}`
      }))
    });
  } catch (error) {
    next(error);
  }
});

// --- Serve individual attachment by ID ---
apiRouter.get("/items/:id/files/:attachmentId", async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const attachmentId = Number(req.params.attachmentId);

    if (!Number.isInteger(itemId) || itemId <= 0 ||
        !Number.isInteger(attachmentId) || attachmentId <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const attachment = await getAttachmentById(attachmentId);
    if (!attachment || attachment.itemId !== itemId) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    try {
      await fs.access(attachment.storagePath);
    } catch {
      res.status(404).json({ ok: false, error: "file_not_found" });
      return;
    }

    const ext = path.extname(attachment.storagePath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const fileName = attachment.fileName || path.basename(attachment.storagePath);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    const fileBuffer = await fs.readFile(attachment.storagePath);
    res.send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

// --- Create new card from dashboard ---
apiRouter.post("/actions", async (req, res, next) => {
  try {
    const body = req.body ?? {};

    const summaryPtBr = typeof body.summaryPtBr === "string" ? body.summaryPtBr.trim() : "";
    if (!summaryPtBr) {
      res.status(400).json({ ok: false, error: "summary_required" });
      return;
    }

    const validPriorities: ActionPriority[] = ["ALTA", "MEDIA", "BAIXA"];
    const priority: ActionPriority = validPriorities.includes(body.priority) ? body.priority : "MEDIA";

    let categoryId: number;
    const categoryName = typeof body.categoryName === "string" ? body.categoryName.trim() : "";
    if (categoryName) {
      categoryId = await upsertCategory(categoryName, categoryName, "dashboard");
    } else {
      categoryId = await upsertCategory("Inbox Geral", "Itens adicionados manualmente", "dashboard");
    }

    const actionTitle = typeof body.actionTitle === "string" && body.actionTitle.trim()
      ? body.actionTitle.trim()
      : undefined;
    const dueAt = typeof body.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueAt)
      ? body.dueAt
      : undefined;
    const nextStep = typeof body.nextStep === "string" && body.nextStep.trim()
      ? body.nextStep.trim()
      : undefined;
    const followUpWith = typeof body.followUpWith === "string" && body.followUpWith.trim()
      ? body.followUpWith.trim()
      : undefined;

    const itemId = await insertDashboardItem({
      summaryPtBr,
      categoryId,
      priority,
      actionTitle,
      dueAt,
      nextStep,
      followUpWith
    });

    await writeActionBoard(await listOpenActionItems(undefined, 40));
    res.status(201).json({ ok: true, id: itemId });
  } catch (error) {
    next(error);
  }
});

// --- Delete card permanently ---
apiRouter.delete("/actions/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const deleted = await deleteInboxItem(id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    // Clean up files on disk (best-effort, don't fail if file missing)
    const pathsToDelete = [
      deleted.storagePath,
      ...deleted.attachmentPaths
    ].filter((p): p is string => Boolean(p));

    const uniquePaths = [...new Set(pathsToDelete)];
    for (const filePath of uniquePaths) {
      try {
        await fs.unlink(filePath);
        log.info("file:deleted", { path: filePath, itemId: id });
      } catch {
        // File may already be gone or path invalid — that's fine
      }
    }

    await writeActionBoard(await listOpenActionItems(undefined, 40));
    res.json({ ok: true, id, filesDeleted: uniquePaths.length });
  } catch (error) {
    next(error);
  }
});

// ── Progressive Summarization ────────────────────────────────────────

apiRouter.post("/items/:id/expand", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const newCount = await incrementExpandCount(id);

    // Trigger layer generation async (fire-and-forget, sequential to avoid race conditions)
    const item = await getItemForDistill(id);
    if (item) {
      const progressive = (item.metadata?.progressive as Record<string, unknown>) ?? {};
      const needsLayer2 = !progressive.layer2 && newCount >= 1;
      const needsLayer3 = !progressive.layer3 && newCount >= 3;

      if (needsLayer2 || needsLayer3) {
        (async () => {
          try {
            // Layer 2: generate on first expand
            if (needsLayer2) {
              const highlights = await generateDistillation({
                normalizedText: item.normalizedText,
                rawText: item.rawText,
                summaryPtBr: item.summaryPtBr,
                layer: 2
              });
              if (highlights && Array.isArray(highlights)) {
                await updateProgressiveLayer(id, "layer2", highlights, newCount);
              }
            }

            // Layer 3: generate after 3+ expands (sequential after layer2 to avoid race)
            if (needsLayer3) {
              const summary = await generateDistillation({
                normalizedText: item.normalizedText,
                rawText: item.rawText,
                summaryPtBr: item.summaryPtBr,
                layer: 3
              });
              if (summary && typeof summary === "string") {
                await updateProgressiveLayer(id, "layer3", summary, newCount);
              }
            }
          } catch (err) {
            log.warn("progressive:generation-failed", { id, error: String(err) });
          }
        })();
      }
    }

    res.json({ ok: true, expandCount: newCount });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/items/:id/distill", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const item = await getItemForDistill(id);
    if (!item) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    const progressive = (item.metadata?.progressive as Record<string, unknown>) ?? {};
    const updates: Record<string, unknown> = { ...progressive };

    // Generate Layer 2 if missing
    if (!progressive.layer2) {
      const highlights = await generateDistillation({
        normalizedText: item.normalizedText,
        rawText: item.rawText,
        summaryPtBr: item.summaryPtBr,
        layer: 2
      });
      if (highlights && Array.isArray(highlights)) {
        updates.layer2 = highlights;
        updates.layer2At = new Date().toISOString();
      }
    }

    // Generate Layer 3 if missing
    if (!progressive.layer3) {
      const summary = await generateDistillation({
        normalizedText: item.normalizedText,
        rawText: item.rawText,
        summaryPtBr: item.summaryPtBr,
        layer: 3
      });
      if (summary && typeof summary === "string") {
        updates.layer3 = summary;
        updates.layer3At = new Date().toISOString();
      }
    }

    await updateInboxItemMetadata(id, { progressive: updates });

    res.json({ ok: true, progressive: updates });
  } catch (error) {
    next(error);
  }
});

// ── Semantic Search ──────────────────────────────────────────────────

apiRouter.get("/search", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q || q.length < 2) {
      res.json({ ok: true, results: [], mode: "none" });
      return;
    }

    // Try semantic search first
    const queryEmbedding = await embedText(q);
    if (queryEmbedding) {
      const allEmbeddings = await loadAllEmbeddings();
      if (allEmbeddings.length > 0) {
        // Compute similarity scores
        const scored = allEmbeddings
          .map((item) => ({
            itemId: item.itemId,
            score: cosineSimilarity(queryEmbedding, item.vector)
          }))
          .filter((s) => s.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        if (scored.length > 0) {
          const ids = scored.map((s) => s.itemId);
          const items = await searchItemsByIds(ids);

          // Merge items with scores and maintain order
          const scoreMap = new Map(scored.map((s) => [s.itemId, s.score]));
          const results = ids
            .map((id) => {
              const item = items.find((i) => i.id === id);
              if (!item) return null;
              return { ...item, score: scoreMap.get(id) ?? 0 };
            })
            .filter(Boolean);

          res.json({ ok: true, results, mode: "semantic" });
          return;
        }
      }
    }

    // Fallback to text search
    const textResults = await textSearchItems(q, 10);
    res.json({
      ok: true,
      results: textResults.map((item) => ({ ...item, score: null })),
      mode: "text"
    });
  } catch (error) {
    next(error);
  }
});

// ── Inbox Processing Queue ───────────────────────────────────────────

apiRouter.get("/inbox-queue", async (_req, res, next) => {
  try {
    const [items, count] = await Promise.all([
      listInboxQueue(30),
      countInboxQueue()
    ]);
    res.json({ ok: true, items, count });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/inbox-queue/:id/process", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: "invalid_id" });
      return;
    }

    const body = req.body ?? {};
    const mode = body.mode as "actionable" | "reference" | "trash";
    if (!["actionable", "reference", "trash"].includes(mode)) {
      res.status(400).json({ ok: false, error: "invalid_mode" });
      return;
    }

    const validPriorities: ActionPriority[] = ["ALTA", "MEDIA", "BAIXA"];
    const updated = await processInboxItem(id, {
      mode,
      priority: validPriorities.includes(body.priority) ? body.priority : undefined,
      nextStep: typeof body.nextStep === "string" ? body.nextStep.trim() : undefined,
      followUpWith: typeof body.followUpWith === "string" ? body.followUpWith.trim() : undefined,
      dueAt: typeof body.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueAt) ? body.dueAt : undefined
    });

    if (!updated) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    await writeActionBoard(await listOpenActionItems(undefined, 40));
    res.json({ ok: true, id, mode });
  } catch (error) {
    next(error);
  }
});

// ── Agent outputs ────────────────────────────────────────────────────

apiRouter.get("/agent-outputs", async (_req, res, next) => {
  try {
    const outputs = await listAgentOutputs();
    res.json({ ok: true, outputs });
  } catch (error) {
    next(error);
  }
});

apiRouter.post(
  "/agent-outputs/:id/final",
  textBodyParser,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ ok: false, error: "invalid_id" });
        return;
      }

      const finalContent = typeof req.body === "string" ? req.body.trim() : "";
      if (!finalContent) {
        res.status(400).json({ ok: false, error: "content_required" });
        return;
      }

      const itemData = await getInboxItemMetadata(id);
      if (!itemData) {
        res.status(404).json({ ok: false, error: "item_not_found" });
        return;
      }

      if (!itemData.metadata?.isAgentOutput) {
        res.status(400).json({ ok: false, error: "not_agent_output" });
        return;
      }

      const topic =
        (itemData.metadata.agentTopic as string) || "unknown-topic";
      const draftPath =
        (itemData.metadata.draftPath as string) || itemData.storagePath;

      // Save the final version
      const finalPath = await saveFinalVersion(topic, finalContent);

      // Analyze differences and extract style learnings
      let learningCount = 0;
      if (draftPath) {
        try {
          const learnings = await analyzeFinalVersion(draftPath, finalPath);
          learningCount = learnings.length;
        } catch (error) {
          log.warn("Style analysis failed", { id, error });
        }
      }

      // Update item metadata
      await updateInboxItemMetadata(id, {
        hasFinalVersion: true,
        finalPath,
        analysisComplete: true,
        learningCount
      });

      res.json({ ok: true, learnings: learningCount, finalPath });
    } catch (error) {
      next(error);
    }
  }
);
