import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
  connectionString: env.POSTGRES_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (err) => {
  console.error(JSON.stringify({ level: "error", message: "Unexpected pool error", error: String(err), ts: new Date().toISOString() }));
});
