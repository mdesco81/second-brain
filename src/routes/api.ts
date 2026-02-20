import { Router } from "express";
import {
  listCategories,
  listOpenActionItems,
  loadDashboardSummary,
  updateInboxItemStatusById
} from "../db/schema.js";
import { ActionStatus } from "../types/domain.js";
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
