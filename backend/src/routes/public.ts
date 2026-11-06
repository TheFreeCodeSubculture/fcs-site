import { Router } from "express";
import { pool } from "../db/index.js";
import { HttpError, asyncHandler } from "../lib/http.js";

export const publicRouter = Router();

publicRouter.get(
  "/events",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "select * from events where stage <> 'draft' order by starts_at asc",
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/class-sessions",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "select * from class_sessions where is_active order by sort_order asc, weekday asc",
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/resources",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "select * from resources where is_published order by sort_order asc",
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/study-groups",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "select * from study_groups where is_published order by sort_order asc",
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/social-links",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "select * from social_links where is_published order by sort_order asc",
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/core-members",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "select * from core_members where is_published order by sort_order asc",
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/repo-kinds",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("select * from repo_kinds order by repo_name");
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/members",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `select id, display_name, bio, website_url, github_username, avatar_url,
              created_at
         from profiles
        where role = 'member'
          and email_verified_at is not null
          and directory_opted_in
        order by lower(coalesce(display_name, email)) asc, created_at asc
        limit 200`,
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/blog-posts",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `select * from blog_posts
        where status = 'published'
        order by published_at desc nulls last, created_at desc`,
    );
    res.json(result.rows);
  }),
);

publicRouter.get(
  "/blog-posts/:slug",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `select * from blog_posts
        where slug = $1 and status = 'published'
        limit 1`,
      [req.params.slug],
    );

    const post = result.rows[0];
    if (!post) throw new HttpError(404, "That post does not exist.");
    res.json(post);
  }),
);
