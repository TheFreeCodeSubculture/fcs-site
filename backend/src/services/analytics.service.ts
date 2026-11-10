import { createHash } from "node:crypto";
import { pool } from "../db/index.js";

const EVENTS = new Set([
  "join", "copy", "social", "calendar", "notify", "subscribe",
  "repo", "resource", "member-link", "link", "section",
]);

/*
 * Browsers sometimes report an IANA alias that PostgreSQL does not know
 * (for example Chrome reports Asia/Calcutta for India). The old SQL
 * fallback silently used UTC, which shifted every day bucket and left the
 * charts empty. Resolve aliases before calling the report function.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

const resolvedTimezones = new Map<string, string>();

async function resolveTimeZone(tz: string): Promise<string> {
  const requested = String(tz || "UTC").slice(0, 80);
  const cached = resolvedTimezones.get(requested);
  if (cached) return cached;

  const candidate = TIMEZONE_ALIASES[requested] || requested;
  const result = await pool.query(
    "select 1 from pg_timezone_names where name = $1 limit 1",
    [candidate],
  );
  const resolved = result.rowCount ? candidate : "UTC";
  resolvedTimezones.set(requested, resolved);
  return resolved;
}

async function visitorId(ip: string, userAgent: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  await pool.query(
    "insert into analytics_salts (day) values ($1) on conflict (day) do nothing",
    [day],
  );
  const saltResult = await pool.query<{ salt: string }>(
    "select salt from analytics_salts where day = $1",
    [day],
  );
  const salt = saltResult.rows[0]?.salt || "";

  return createHash("sha256")
    .update(`${salt}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

export interface PageviewInput {
  ip: string;
  userAgent: string;
  viewKey: string;
  path: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  session: string;
  isNew: boolean;
  device: string | null;
  timezone: string | null;
}

export async function recordPageview(input: PageviewInput) {
  await pool.query(
    `insert into analytics_pageviews
       (view_key, path, referrer_host, utm_source, utm_medium, utm_campaign,
        visitor, session, is_new, device, timezone)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (view_key) do nothing`,
    [
      input.viewKey,
      input.path,
      input.referrerHost,
      input.utmSource,
      input.utmMedium,
      input.utmCampaign,
      await visitorId(input.ip, input.userAgent),
      input.session,
      input.isNew,
      input.device,
      input.timezone,
    ],
  );
}

export async function recordEngagement(input: {
  viewKey: string;
  session: string;
  ms: number;
}) {
  await pool.query(
    `update analytics_pageviews
        set engaged_ms = $1
      where view_key = $2 and session = $3
        and at >= now() - interval '1 day'`,
    [input.ms, input.viewKey, input.session],
  );
}

export async function recordEvent(input: {
  ip: string;
  userAgent: string;
  name: string;
  label: string | null;
  path: string | null;
  session: string;
}) {
  if (!EVENTS.has(input.name)) return;

  await pool.query(
    `insert into analytics_events (name, label, path, visitor, session)
     values ($1, $2, $3, $4, $5)`,
    [
      input.name,
      input.label,
      input.path,
      await visitorId(input.ip, input.userAgent),
      input.session,
    ],
  );
}

export async function getReport(since: string, until: string, tz: string) {
  const zone = await resolveTimeZone(tz);
  const result = await pool.query<{ report: unknown }>(
    "select analytics_report($1::timestamptz, $2::timestamptz, $3) as report",
    [since, until, zone],
  );
  return result.rows[0]?.report ?? {};
}

export async function getBlogPostReport(
  slug: string,
  days: number,
  tz: string,
) {
  const zone = await resolveTimeZone(tz);
  const result = await pool.query<{ report: unknown }>(
    "select blog_post_analytics($1, $2, $3) as report",
    [slug, days, zone],
  );
  return result.rows[0]?.report ?? {};
}
