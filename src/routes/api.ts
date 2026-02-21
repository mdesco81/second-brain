import { Router } from "express";
import {
  listCategories,
  listOpenActionItems,
  loadDashboardSummary,
  updateInboxItemFields,
  updateInboxItemStatusById
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
