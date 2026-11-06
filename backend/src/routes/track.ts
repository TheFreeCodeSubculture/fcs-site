import { createHash } from "node:crypto";
import express, { Router } from "express";
import { config } from "../config.js";
import { pool } from "../db/index.js";
import { asyncHandler } from "../lib/http.js";

export const trackRouter = Router();

const EVENTS = new Set([
  "join", "copy", "social", "calendar", "notify", "subscribe",
  "repo", "resource", "member-link", "link", "section",
]);
const BOTS = /bot|crawl|spider|slurp|headless|preview|lighthouse|pingdom|monitor|curl|wget|python|go-http|java\//i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cut(value: unknown, length: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, length)
    : null;
}

async function visitorId(req: express.Request): Promise<string> {
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
  const ip = req.ip || "";
  const userAgent = req.headers["user-agent"] || "";

  return createHash("sha256")
    .update(`${salt}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

trackRouter.post(
  "/track",
  express.text({ type: "text/plain", limit: "4kb" }),
  asyncHandler(async (req, res) => {
    const origin = req.headers.origin || "";
    const done = () => res.status(204).end();

    if (!config.SITE_ORIGINS.includes(origin)) return done();

    const userAgent = req.headers["user-agent"] || "";
    if (!userAgent || BOTS.test(userAgent)) return done();

    let body: Record<string, unknown>;
    try {
      body = typeof req.body === "string"
        ? JSON.parse(req.body.slice(0, 4000))
        : (req.body as Record<string, unknown>);
    } catch {
      return done();
    }

    const session = cut(body.session, 64);
    if (!session) return done();

    try {
      if (body.type === "view" && typeof body.key === "string" && UUID.test(body.key)) {
        const path = cut(body.path, 200);
        if (!path || !path.startsWith("/")) return done();

        await pool.query(
          `insert into analytics_pageviews
             (view_key, path, referrer_host, utm_source, utm_medium, utm_campaign,
              visitor, session, is_new, device, timezone)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (view_key) do nothing`,
          [
            body.key,
            path,
            cut(body.ref, 100),
            cut(body.utm_source, 60),
            cut(body.utm_medium, 60),
            cut(body.utm_campaign, 60),
            await visitorId(req),
            session,
            body.is_new === true,
            ["mobile", "tablet", "desktop"].includes(String(body.device)) ? body.device : null,
            cut(body.tz, 60),
          ],
        );
      } else if (body.type === "engage" && typeof body.key === "string" && UUID.test(body.key)) {
        const ms = Math.min(Math.max(Math.round(Number(body.ms) || 0), 0), 30 * 60 * 1000);
        await pool.query(
          `update analytics_pageviews
              set engaged_ms = $1
            where view_key = $2 and session = $3
              and at >= now() - interval '1 day'`,
          [ms, body.key, session],
        );
      } else if (body.type === "event" && EVENTS.has(String(body.name))) {
        await pool.query(
          `insert into analytics_events (name, label, path, visitor, session)
           values ($1, $2, $3, $4, $5)`,
          [
            String(body.name),
            cut(body.label, 80),
            cut(body.path, 200),
            await visitorId(req),
            session,
          ],
        );
      }
    } catch (error) {
      console.error("Analytics beacon failed", error);
    }

    return done();
  }),
);
