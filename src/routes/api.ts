import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getAttachmentById,
  getItemFileInfo,
  insertDashboardItem,
  listCategories,
  listItemAttachments,
  listOpenActionItems,
  loadDashboardSummary,
  updateInboxItemFields,
  updateInboxItemStatusById,
  upsertCategory
} from "../db/schema.js";
import { ActionPriority, ActionStatus } from "../types/domain.js";
import { writeActionBoard } from "../services/storage.js";

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
