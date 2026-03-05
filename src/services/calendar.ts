import { calendar, calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import {
  upsertCalendarEvent,
  deleteCalendarEvent,
  updateCalendarSyncToken,
  getCalendarSyncToken,
  listPeople,
  Person
} from "../db/schema.js";
import { log } from "../utils/logger.js";

// ── Configuration ────────────────────────────────────────────────────

let _oauth2Client: OAuth2Client | null = null;
let _calendarClient: calendar_v3.Calendar | null = null;

/**
 * Check if Google Calendar integration is configured.
 * All three env vars must be present.
 */
export function isCalendarEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

/**
 * Get a singleton OAuth2 client with automatic token refresh.
 */
function getOAuth2Client(): OAuth2Client {
  if (_oauth2Client) return _oauth2Client;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error("Google Calendar credentials not configured");
  }

  _oauth2Client = new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET
  );

  _oauth2Client.setCredentials({
    refresh_token: env.GOOGLE_REFRESH_TOKEN
  });

  return _oauth2Client;
}

/**
 * Get a singleton Google Calendar API client.
 */
function getCalendarClient(): calendar_v3.Calendar {
  if (_calendarClient) return _calendarClient;
  _calendarClient = calendar({ version: "v3", auth: getOAuth2Client() });
  return _calendarClient;
}

// ── Sync ─────────────────────────────────────────────────────────────

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
}

const SYNC_WINDOW_DAYS = 30;
const MAX_PAGE_SIZE = 250;
const MAX_SYNC_PAGES = 100;

/**
 * Perform an incremental sync of Google Calendar events.
 * Uses sync tokens for efficient delta updates.
 * On first run (no sync token), performs a full sync of ±30 days.
 */
export async function syncCalendarEvents(chatId: number, _isRetry = false): Promise<SyncResult> {
  if (!isCalendarEnabled()) {
    return { created: 0, updated: 0, deleted: 0 };
  }

  const calClient = getCalendarClient();
  const syncToken = await getCalendarSyncToken(chatId);
  const people = await listPeople(true);

  const stats: SyncResult = { created: 0, updated: 0, deleted: 0 };
  let pageToken: string | undefined;
  let newSyncToken: string | undefined;
  let pageCount = 0;

  try {
    do {
      if (++pageCount > MAX_SYNC_PAGES) {
        log.warn("calendar:sync_page_limit_reached", { chatId, pageCount: MAX_SYNC_PAGES });
        break;
      }

      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: "primary",
        singleEvents: true,
        maxResults: MAX_PAGE_SIZE
      };

      if (syncToken && !pageToken) {
        // Incremental sync
        params.syncToken = syncToken;
      } else if (!syncToken && !pageToken) {
        // Full sync: ±30 days
        const now = new Date();
        const timeMin = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const timeMax = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        params.timeMin = timeMin.toISOString();
        params.timeMax = timeMax.toISOString();
        params.orderBy = "startTime";
      }

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await calClient.events.list(params);
      const items = response.data.items ?? [];

      for (const event of items) {
        if (!event.id) continue;

        // Handle cancelled events
        if (event.status === "cancelled") {
          await deleteCalendarEvent(event.id);
          stats.deleted++;
          continue;
        }

        // Skip all-day events without times
        const startAt = event.start?.dateTime ?? event.start?.date;
        const endAt = event.end?.dateTime ?? event.end?.date;
        if (!startAt || !endAt) {
          // Skipping event without start/end times (all-day or malformed)
          continue;
        }

        // Parse attendees — filter out self and entries without email
        const attendees = (event.attendees ?? [])
          .filter((a) => !a.self && a.email)
          .map((a) => ({
            email: a.email!,
            name: a.displayName ?? undefined,
            responseStatus: a.responseStatus ?? undefined
          }));

        // Detect 1:1: exactly 1 non-self attendee
        const isOneOnOne = attendees.length === 1;
        const matchedPerson = isOneOnOne ? matchAttendeeToPerson(attendees[0], people) : null;

        const eventId = await upsertCalendarEvent({
          chatId,
          externalId: event.id,
          calendarId: "primary",
          title: event.summary ?? "(sem titulo)",
          description: event.description ?? undefined,
          startAt,
          endAt,
          location: event.location ?? undefined,
          attendees,
          personId: matchedPerson?.id,
          isOneOnOne,
          status: event.status ?? "confirmed",
          rawEvent: event as Record<string, unknown>
        });

        if (eventId) {
          stats.created++; // upsert — counts both create and update
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
      if (response.data.nextSyncToken) {
        newSyncToken = response.data.nextSyncToken;
      }
    } while (pageToken);

    // Save the new sync token for next incremental sync
    if (newSyncToken) {
      await updateCalendarSyncToken(chatId, newSyncToken);
    }

    log.info("calendar:sync_complete", { chatId, ...stats, pages: pageCount });
    return stats;
  } catch (error: unknown) {
    // Safely extract error code from Google API errors
    const errorCode = extractGoogleErrorCode(error);

    // Handle 410 Gone — sync token expired, need full sync (one retry only)
    if (errorCode === 410 && !_isRetry) {
      log.warn("calendar:sync_token_expired, performing full sync", { chatId });
      await updateCalendarSyncToken(chatId, ""); // Clear token
      return syncCalendarEvents(chatId, true); // Retry with full sync (once)
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("calendar:sync_failed", { chatId, errorCode, error: errorMsg });
    throw error;
  }
}

// ── Create Event ──────────────────────────────────────────────────────

export interface CreateEventParams {
  chatId: number;
  title: string;
  startAt: string; // ISO string
  endAt: string;   // ISO string
  description?: string;
  attendees?: string[]; // email addresses
  location?: string;
  reminderMinutes?: number; // override default reminder (e.g. 720 = 12 hours)
}

/**
 * Create an event on Google Calendar and persist it locally.
 * Returns the Google Calendar event ID.
 */
export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  if (!isCalendarEnabled()) {
    throw new Error("Google Calendar integration is not configured");
  }

  const calClient = getCalendarClient();

  const requestBody: calendar_v3.Schema$Event = {
    summary: params.title,
    start: { dateTime: params.startAt },
    end: { dateTime: params.endAt },
  };

  if (params.description) {
    requestBody.description = params.description;
  }

  if (params.location) {
    requestBody.location = params.location;
  }

  if (params.attendees && params.attendees.length > 0) {
    requestBody.attendees = params.attendees.map((email) => ({ email }));
  }

  if (params.reminderMinutes != null) {
    requestBody.reminders = {
      useDefault: false,
      overrides: [{ method: "popup", minutes: params.reminderMinutes }],
    };
  }

  const response = await calClient.events.insert({
    calendarId: "primary",
    requestBody,
  });

  const eventId = response.data.id;
  if (!eventId) {
    throw new Error("Google Calendar returned no event ID");
  }

  // Persist locally
  const startAt = response.data.start?.dateTime ?? params.startAt;
  const endAt = response.data.end?.dateTime ?? params.endAt;

  const attendees = (response.data.attendees ?? [])
    .filter((a) => !a.self && a.email)
    .map((a) => ({
      email: a.email!,
      name: a.displayName ?? undefined,
      responseStatus: a.responseStatus ?? undefined,
    }));

  await upsertCalendarEvent({
    chatId: params.chatId,
    externalId: eventId,
    calendarId: "primary",
    title: params.title,
    description: params.description,
    startAt,
    endAt,
    location: params.location,
    attendees,
    isOneOnOne: attendees.length === 1,
    status: "confirmed",
    rawEvent: response.data as Record<string, unknown>,
  });

  log.info("calendar:event_created", { chatId: params.chatId, eventId, title: params.title });
  return eventId;
}

/**
 * Safely extract HTTP error code from Google API errors.
 */
function extractGoogleErrorCode(error: unknown): number | null {
  if (error && typeof error === "object") {
    // googleapis wraps errors with a `code` property
    if ("code" in error && typeof (error as { code: unknown }).code === "number") {
      return (error as { code: number }).code;
    }
    // Axios-style errors
    if ("response" in error) {
      const resp = (error as { response?: { status?: number } }).response;
      if (resp?.status) return resp.status;
    }
  }
  return null;
}

// ── Person Matching ──────────────────────────────────────────────────

/**
 * Try to match a calendar attendee to a person in the people table.
 * Matches by email first, then by name.
 */
function matchAttendeeToPerson(
  attendee: { email: string; name?: string },
  people: Person[]
): Person | null {
  // Match by email (exact)
  if (attendee.email) {
    const emailMatch = people.find(
      (p) => p.email && p.email.toLowerCase() === attendee.email.toLowerCase()
    );
    if (emailMatch) return emailMatch;
  }

  // Match by display name
  if (attendee.name) {
    const nameLower = attendee.name.toLowerCase();

    // Exact name match
    const exactMatch = people.find((p) => p.name.toLowerCase() === nameLower);
    if (exactMatch) return exactMatch;

    // First name match (when display name has first+last)
    const attendeeFirstName = nameLower.split(" ")[0];
    if (attendeeFirstName.length >= 3) {
      const firstNameMatches = people.filter((p) => {
        const personFirstName = p.name.toLowerCase().split(" ")[0];
        return personFirstName === attendeeFirstName;
      });
      if (firstNameMatches.length === 1) return firstNameMatches[0];
    }

    // Name variant match
    const variantMatch = people.find(
      (p) => p.nameVariants.some((v) => v.toLowerCase() === nameLower)
    );
    if (variantMatch) return variantMatch;
  }

  return null;
}
