import express from "express";
import path from "node:path";
import { apiRouter } from "./routes/api.js";
import { telegramRouter } from "./routes/telegram.js";
import { env } from "./config/env.js";
import { log } from "./utils/logger.js";

function unauthorized(res: express.Response): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="Second Brain Dashboard"');
  res.status(401).send("Authentication required");
}

function parseBasicAuth(header: string): { user: string; password: string } | null {
  if (!header.startsWith("Basic ")) {
    return null;
  }
  const encoded = header.slice(6).trim();
  if (!encoded) {
    return null;
  }
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator <= 0) {
      return null;
    }
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

export function createApp() {
  const app = express();
  const authEnabled = Boolean(env.DASHBOARD_USER && env.DASHBOARD_PASSWORD);

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/telegram", telegramRouter);

  app.use((req, res, next) => {
    if (!authEnabled) {
      next();
      return;
    }

    if (req.path === "/api/health") {
      next();
      return;
    }

    const credentials = parseBasicAuth(req.header("authorization") || "");
    if (!credentials) {
      unauthorized(res);
      return;
    }

    if (credentials.user !== env.DASHBOARD_USER || credentials.password !== env.DASHBOARD_PASSWORD) {
      unauthorized(res);
      return;
    }

    next();
  });

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
