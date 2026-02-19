export const log = {
  info: (message: string, meta?: unknown) => {
    console.log(JSON.stringify({ level: "info", message, meta, ts: new Date().toISOString() }));
  },
  warn: (message: string, meta?: unknown) => {
    console.warn(JSON.stringify({ level: "warn", message, meta, ts: new Date().toISOString() }));
  },
  error: (message: string, meta?: unknown) => {
    console.error(JSON.stringify({ level: "error", message, meta, ts: new Date().toISOString() }));
  }
};
