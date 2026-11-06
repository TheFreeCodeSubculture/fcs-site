import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { withActor } from "../db/tx.js";
import { requireEditor } from "../middleware/auth.js";
import { HttpError, asyncHandler, parseBody } from "../lib/http.js";

export const adminBlogRouter = Router();
adminBlogRouter.use(requireEditor);

const DraftSchema = z.object({
  content: z.unknown(),
});

const VersionSchema = z.object({
  content: z.unknown(),
  kind: z.enum(["edit", "publish"]).default("edit"),
});

adminBlogRouter.get(
  "/blog-drafts/:postId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `select content, updated_at
         from blog_drafts
        where post_id = $1
        limit 1`,
      [req.params.postId],
    );
    res.json(result.rows[0] || null);
  }),
);

adminBlogRouter.put(
  "/blog-drafts/:postId",
  asyncHandler(async (req, res) => {
    const body = parseBody(DraftSchema, req.body);
    if (body.content === undefined) {
      throw new HttpError(400, "Send the draft content.");
    }

    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        `insert into blog_drafts (post_id, content, updated_at, updated_by)
         values ($1, $2::jsonb, now(), $3)
         on conflict (post_id) do update
           set content = excluded.content,
               updated_at = now(),
               updated_by = excluded.updated_by
         returning content, updated_at`,
        [req.params.postId, JSON.stringify(body.content), req.user!.id],
      );
      return result.rows[0];
    });

    res.json(row);
  }),
);

adminBlogRouter.delete(
  "/blog-drafts/:postId",
  asyncHandler(async (req, res) => {
    await pool.query("delete from blog_drafts where post_id = $1", [req.params.postId]);
    res.status(204).end();
  }),
);

adminBlogRouter.get(
  "/blog-posts/:postId/versions",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const result = await pool.query(
      `select id, content, kind, created_at, created_by
         from blog_versions
        where post_id = $1
        order by created_at desc
        limit $2`,
      [req.params.postId, limit],
    );
    res.json(result.rows);
  }),
);

adminBlogRouter.post(
  "/blog-posts/:postId/versions",
  asyncHandler(async (req, res) => {
    const body = parseBody(VersionSchema, req.body);

    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        `insert into blog_versions (post_id, content, kind, created_by)
         values ($1, $2::jsonb, $3, $4)
         returning id, created_at`,
        [req.params.postId, JSON.stringify(body.content), body.kind, req.user!.id],
      );
      return result.rows[0];
    });

    res.status(201).json(row);
  }),
);

adminBlogRouter.get(
  "/blog-authors",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `select p.id,
              coalesce(nullif(trim(p.display_name), ''), m.name, split_part(p.email, '@', 1)) as name,
              coalesce(
                m.photo_url,
                case when m.github_username is not null
                     then 'https://github.com/' || m.github_username || '.png?size=96' end
              ) as avatar,
              coalesce(
                case when m.github_username is not null
                     then 'https://github.com/' || m.github_username end,
                m.website_url,
                m.linkedin_url
              ) as url,
              p.role,
              m.id as member_id,
              p.core_member_id is not null as linked
         from profiles p
         left join lateral (
           select *
             from core_members c
            where c.id = p.core_member_id
               or (p.core_member_id is null
                   and c.email is not null
                   and lower(c.email) = lower(p.email))
            order by c.id = p.core_member_id desc nulls last,
                     c.status = 'active' desc
            limit 1
         ) m on true
        where p.role in ('admin', 'editor')
        order by 2`,
    );
    res.json(result.rows);
  }),
);
