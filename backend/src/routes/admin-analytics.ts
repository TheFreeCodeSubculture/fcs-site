import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { requireAnalytics, requireAuth, requireEditor } from "../middleware/auth.js";
import { HttpError, asyncHandler, parseBody } from "../lib/http.js";

export const adminAnalyticsRouter = Router();

const RangeSchema = z.object({
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }),
  tz: z.string().max(80).default("UTC"),
});

adminAnalyticsRouter.get(
  "/analytics",
  requireAuth,
  requireAnalytics,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const parsed = parseBody(RangeSchema, {
      since: req.query.since ?? weekAgo.toISOString(),
      until: req.query.until ?? now.toISOString(),
      tz: req.query.tz ?? "UTC",
    });

    if (new Date(parsed.since) >= new Date(parsed.until)) {
      throw new HttpError(400, "The start of the range must be before the end.");
    }

    const result = await pool.query<{ report: unknown }>(
      "select analytics_report($1::timestamptz, $2::timestamptz, $3) as report",
      [parsed.since, parsed.until, parsed.tz],
    );

    res.json(result.rows[0]?.report ?? {});
  }),
);

adminAnalyticsRouter.get(
  "/blog-posts/:slug/analytics",
  requireEditor,
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 28, 1), 365);
    const tz = typeof req.query.tz === "string" ? req.query.tz.slice(0, 80) : "UTC";

    const result = await pool.query<{ report: unknown }>(
      "select blog_post_analytics($1, $2, $3) as report",
      [String(req.params.slug), days, tz],
    );

    res.json(result.rows[0]?.report ?? {});
  }),
);
