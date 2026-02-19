import { Router } from "express";
import { listCategories, loadDashboardSummary } from "../db/schema.js";

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
