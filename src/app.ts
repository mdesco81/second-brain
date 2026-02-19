import express from "express";
import path from "node:path";
import { apiRouter } from "./routes/api.js";
import { telegramRouter } from "./routes/telegram.js";
import { log } from "./utils/logger.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/telegram", telegramRouter);
  app.use("/api", apiRouter);

  const publicDir = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDir));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("Unhandled request error", { err });
    res.status(500).json({ ok: false, error: "internal_error" });
  });

  return app;
}
