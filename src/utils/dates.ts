import { env } from "../config/env.js";

/**
 * Returns today's date string (YYYY-MM-DD) in the configured timezone (default: America/Sao_Paulo).
 */
export function todayLocal(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: env.TIMEZONE });
}

/**
 * Returns a Date object representing "now" shifted to the configured timezone.
 * Useful for getDay(), getDate() etc. that need to reflect the local calendar day.
 */
export function nowLocal(): Date {
  const nowUtc = new Date();
  // Build a locale string in the target timezone and re-parse it
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(nowUtc);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second"))
  );
}

/**
 * Format a local Date (from nowLocal) to YYYY-MM-DD.
 */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the date string for "next Friday" (or today if already Friday) in local timezone.
 */
export function nextFridayLocal(): string {
  const now = nowLocal();
  const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri
  let daysUntilFriday = 5 - dayOfWeek;
  if (daysUntilFriday < 0) {
    daysUntilFriday += 7;
  }
  if (daysUntilFriday === 0) {
    daysUntilFriday = 0; // today is Friday, "ate sexta" means today
  }
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysUntilFriday);
  return formatDateISO(friday);
}

/**
 * Returns date string offset by N days from today in local timezone.
 */
export function addDaysLocal(days: number): string {
  const now = nowLocal();
  now.setDate(now.getDate() + days);
  return formatDateISO(now);
}
