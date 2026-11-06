import { Router } from "express";
import { pool } from "../db/index.js";
import { withActor } from "../db/tx.js";
import { requireEditor, requireRole } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../lib/http.js";

interface ResourceConfig {
  table: string;
  key: "id" | "repo_name";
  order: string;
  fields: readonly string[];
}

const RESOURCES = {
  events: {
    table: "events",
    key: "id",
    order: "sort_order asc, starts_at asc",
    fields: [
      "title", "group_name", "details", "starts_at", "duration_minutes",
      "stage", "link", "link_text", "sort_order",
    ],
  },
  "class-sessions": {
    table: "class_sessions",
    key: "id",
    order: "sort_order asc, weekday asc",
    fields: [
      "title", "group_name", "weekday", "start_time", "duration_minutes",
      "timezone", "link", "is_active", "sort_order",
    ],
  },
  resources: {
    table: "resources",
    key: "id",
    order: "sort_order asc",
    fields: [
      "title", "kind", "url", "summary", "group_name", "sort_order",
      "is_published",
    ],
  },
  "study-groups": {
    table: "study_groups",
    key: "id",
    order: "sort_order asc",
    fields: [
      "name", "topic", "status", "link", "link_text", "sort_order",
      "is_published",
    ],
  },
  "social-links": {
    table: "social_links",
    key: "id",
    order: "sort_order asc",
    fields: ["platform", "label", "url", "hint", "sort_order", "is_published"],
  },
  "core-members": {
    table: "core_members",
    key: "id",
    order: "sort_order asc",
    fields: [
      "name", "role", "title", "status", "group_name", "focus", "bio",
      "github_username", "photo_url", "photo_thumb_url", "linkedin_url",
      "instagram_url", "x_url", "website_url", "email", "discord_handle",
      "joined_on", "ended_on", "sort_order", "is_published",
    ],
  },
  "blog-posts": {
    table: "blog_posts",
    key: "id",
    order: "created_at desc",
    fields: [
      "title", "slug", "excerpt", "body", "cover_url", "cover_credit",
      "author_name", "authors", "status", "published_at", "icon",
      "cover_position", "font", "small_text", "full_width", "locked",
      "source_url",
    ],
  },
} as const satisfies Record<string, ResourceConfig>;

type ResourceName = keyof typeof RESOURCES;

const JSON_FIELDS = new Set(["authors", "cover_credit"]);
const RESTORABLE = new Set([
  "events", "class_sessions", "resources", "study_groups",
  "social_links", "core_members", "repo_kinds", "blog_posts",
]);

function getResource(name: string): (typeof RESOURCES)[ResourceName] {
  const resource = RESOURCES[name as ResourceName];
  if (!resource) throw new HttpError(404, "That kind of row does not exist.");
  return resource;
}

function serialize(field: string, value: unknown) {
  if (JSON_FIELDS.has(field) && value !== null && value !== undefined) {
    return JSON.stringify(value);
  }
  return value;
}

function pickFields(resource: ResourceConfig, body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  return resource.fields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
}

export const adminRouter = Router();
adminRouter.use(requireEditor);

adminRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 500);
    const result = await pool.query(
      `select id, at, actor_email, action, table_name, row_id, row_label, changed
         from activity_log
        order by at desc
        limit $1`,
      [limit],
    );
    res.json(result.rows);
  }),
);

adminRouter.get(
  "/activity/:table/:rowId",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const result = await pool.query(
      `select at, actor_id, actor_email, action, changed
         from activity_log
        where table_name = $1 and row_id = $2
        order by at desc
        limit $3`,
      [req.params.table, req.params.rowId, limit],
    );
    res.json(result.rows);
  }),
);

adminRouter.post(
  "/restore",
  asyncHandler(async (req, res) => {
    const table = String(req.body?.table || "");
    const rowId = String(req.body?.rowId || "");

    if (!RESTORABLE.has(table)) {
      throw new HttpError(400, "That kind of row cannot be restored.");
    }

    const result = await withActor(req.user!, async (client) => {
      const snapshotResult = await client.query<{ snapshot: Record<string, unknown> | null }>(
        `select snapshot
           from activity_log
          where table_name = $1 and row_id = $2 and action = 'delete'
          order by at desc
          limit 1`,
        [table, rowId],
      );

      const snapshot = snapshotResult.rows[0]?.snapshot;
      if (!snapshot) {
        throw new HttpError(404, "There is no deleted copy of that row to restore.");
      }

      const columns = Object.keys(snapshot);
      const values = Object.values(snapshot);
      const placeholders = columns.map((_, index) => `$${index + 1}`);

      const restored = await client.query(
        `insert into ${table} (${columns.join(", ")})
         values (${placeholders.join(", ")})
         returning *`,
        values,
      );

      return restored.rows[0];
    });

    res.status(201).json(result);
  }),
);

adminRouter.patch(
  "/me/member-card",
  asyncHandler(async (req, res) => {
    const memberId = req.body?.memberId;
    if (memberId !== null && typeof memberId !== "string") {
      throw new HttpError(400, "memberId must be a UUID or null.");
    }

    const result = await withActor(req.user!, async (client) =>
      client.query(
        `update profiles
            set core_member_id = $1
          where id = $2
          returning id, email, display_name, role, can_view_analytics,
                    core_member_id, must_reset`,
        [memberId, req.user!.id],
      ),
    );

    res.json(result.rows[0]);
  }),
);

adminRouter.put(
  "/repo-kinds/:repoName",
  asyncHandler(async (req, res) => {
    const allowed = ["kind", "note", "pinned", "sort_order", "group_id"] as const;
    const fields = allowed.filter((field) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field),
    );

    if (!fields.length) {
      throw new HttpError(400, "Send at least one field to update.");
    }

    const values = fields.map((field) => req.body[field]);
    const placeholders = fields.map((_, index) => `$${index + 1}`);
    values.push(req.params.repoName);

    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        `insert into repo_kinds (repo_name, ${fields.join(", ")})
         values ($${values.length}, ${placeholders.join(", ")})
         on conflict (repo_name) do update
           set ${fields.map((field) => `${field} = excluded.${field}`).join(", ")}
         returning *`,
        values,
      );
      return result.rows[0];
    });

    res.json(row);
  }),
);

adminRouter.delete(
  "/repo-kinds/:repoName",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        "delete from repo_kinds where repo_name = $1 returning *",
        [req.params.repoName],
      );
      return result.rows[0];
    });

    if (!row) throw new HttpError(404, "That repository is not curated.");
    res.status(204).end();
  }),
);

adminRouter.get(
  "/:resource",
  asyncHandler(async (req, res) => {
    const resource = getResource(String(req.params.resource));
    const result = await pool.query(
      `select * from ${resource.table} order by ${resource.order}`,
    );
    res.json(result.rows);
  }),
);

adminRouter.post(
  "/:resource",
  asyncHandler(async (req, res) => {
    const resource = getResource(String(req.params.resource));
    const fields = pickFields(resource, req.body);

    if (!fields.length) {
      throw new HttpError(400, "Send at least one field.");
    }

    const values = fields.map((field) => serialize(field, req.body[field]));
    const placeholders = fields.map((_, index) => `$${index + 1}`);

    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        `insert into ${resource.table} (${fields.join(", ")})
         values (${placeholders.join(", ")})
         returning *`,
        values,
      );
      return result.rows[0];
    });

    res.status(201).json(row);
  }),
);

adminRouter.patch(
  "/:resource/:id",
  asyncHandler(async (req, res) => {
    const resource = getResource(String(req.params.resource));
    const fields = pickFields(resource, req.body);

    if (!fields.length) {
      throw new HttpError(400, "Send at least one field to update.");
    }

    const values = fields.map((field) => serialize(field, req.body[field]));
    values.push(req.params.id);

    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        `update ${resource.table}
            set ${fields.map((field, index) => `${field} = $${index + 1}`).join(", ")}
          where ${resource.key} = $${values.length}
          returning *`,
        values,
      );
      return result.rows[0];
    });

    if (!row) throw new HttpError(404, "That row does not exist.");
    res.json(row);
  }),
);

adminRouter.delete(
  "/:resource/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const resource = getResource(String(req.params.resource));

    const row = await withActor(req.user!, async (client) => {
      const result = await client.query(
        `delete from ${resource.table}
          where ${resource.key} = $1
          returning *`,
        [req.params.id],
      );
      return result.rows[0];
    });

    if (!row) throw new HttpError(404, "That row does not exist.");
    res.status(204).end();
  }),
);
