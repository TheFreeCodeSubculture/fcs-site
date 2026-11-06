/*
 * tools/events-feed.mjs
 * ------------------------------------------------------------------
 * Writes events.ics, the calendar feed people subscribe to from the
 * events section ("Add to your calendar"). Run by the deploy workflow
 * every 30 minutes, so subscribed calendars see new and changed events.
 *
 * Reads events from the public API, so it only ever sees what a visitor
 * sees (no drafts). Keeps the last 60 days and everything ahead. If the
 * API is unreachable the committed file is kept.
 *
 *   node tools/events-feed.mjs
 * ------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildICS } from "../js/lib/ics.js";

const config = readFileSync("js/config.js", "utf8");
const url =
  process.env.API_BASE_URL ||
  /apiBaseUrl:\s*"([^"]+)"/.exec(config)?.[1];

try {
  if (!url) throw new Error("The API is not configured in js/config.js");
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const res = await fetch(`${url}/api/public/events`);
  if (!res.ok) throw new Error(`events -> ${res.status}`);
  const events = (await res.json())
    .filter((event) => event.starts_at >= since)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map(({ id, title, group_name, details, starts_at, duration_minutes, link }) => ({
      id, title, group_name, details, starts_at, duration_minutes, link,
    }));
  // Ask calendar apps to check hourly (Apple and Outlook honour it; Google sets its own pace).
  const ics = buildICS(events, { calendarName: "FCS Events" }).replace(
    "X-WR-CALNAME:",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\nX-WR-CALNAME:"
  );
  writeFileSync("events.ics", ics);
  console.log(`Feed: ${events.length} events`);
} catch (err) {
  console.warn(`Feed skipped, keeping the existing events.ics: ${err.message}`);
}
