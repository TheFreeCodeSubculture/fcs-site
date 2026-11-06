import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/index.js";
import { withActor } from "../db/tx.js";
import { config } from "../config.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError, asyncHandler, parseBody } from "../lib/http.js";
import { createOpaqueToken } from "../lib/tokens.js";
import { isMailConfigured, sendMail } from "../services/mailer.js";
import { inviteEmail, testEmail } from "../email/templates.js";

export const adminTeamRouter = Router();
adminTeamRouter.use(requireAdmin);

const ProfileUpdateSchema = z.object({
  role: z.enum(["admin", "editor", "pending"]).optional(),
  display_name: z.string().trim().max(120).nullable().optional(),
  can_view_analytics: z.boolean().optional(),
  core_member_id: z.string().uuid().nullable().optional(),
  must_reset: z.boolean().optional(),
});

const InviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["admin", "editor"]).default("editor"),
  displayName: z.string().trim().max(120).optional(),
});

const TestEmailSchema = z.object({
  to: z.string().trim().email("Enter a valid email address.").optional(),
});

adminTeamRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `select id, email, display_name, role, can_view_analytics,
              core_member_id, must_reset, created_at
         from profiles
        where role <> 'member'
        order by created_at asc`,
    );
    res.json(result.rows);
  }),
);

adminTeamRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = parseBody(ProfileUpdateSchema, req.body);
    const targetId = req.params.id;

    if (body.role === undefined && body.display_name === undefined &&
        body.can_view_analytics === undefined && body.core_member_id === undefined &&
        body.must_reset === undefined) {
      throw new HttpError(400, "Send at least one field to update.");
    }

    const row = await withActor(req.user!, async (client) => {
      const current = await client.query<{ id: string; role: string }>(
        "select id, role from profiles where id = $1 for update",
        [targetId],
      );

      const target = current.rows[0];
      if (!target) throw new HttpError(404, "That account does not exist.");

      if (body.role && target.role === "admin" && body.role !== "admin") {
        const admins = await client.query<{ count: string }>(
          "select count(*)::text as count from profiles where role = 'admin'",
        );
        if (Number(admins.rows[0]?.count || 0) <= 1) {
          throw new HttpError(400, "There must always be at least one admin.");
        }
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      for (const [field, value] of Object.entries(body)) {
        if (value !== undefined) {
          values.push(value);
          fields.push(`${field} = $${values.length}`);
        }
      }
      values.push(targetId);

      const updated = await client.query(
        `update profiles
            set ${fields.join(", ")}
          where id = $${values.length}
          returning id, email, display_name, role, can_view_analytics,
                    core_member_id, must_reset, created_at`,
        values,
      );
      return updated.rows[0];
    });

    res.json(row);
  }),
);

adminTeamRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) {
      throw new HttpError(400, "You cannot remove your own account.");
    }

    await withActor(req.user!, async (client) => {
      const target = await client.query<{ role: string }>(
        "select role from profiles where id = $1 for update",
        [req.params.id],
      );
      const row = target.rows[0];
      if (!row) throw new HttpError(404, "That account does not exist.");

      if (row.role === "admin") {
        const admins = await client.query<{ count: string }>(
          "select count(*)::text as count from profiles where role = 'admin'",
        );
        if (Number(admins.rows[0]?.count || 0) <= 1) {
          throw new HttpError(400, "There must always be at least one admin.");
        }
      }

      await client.query("delete from profiles where id = $1", [req.params.id]);
    });

    res.status(204).end();
  }),
);

adminTeamRouter.post(
  "/invite",
  asyncHandler(async (req, res) => {
    const body = parseBody(InviteSchema, req.body);
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const existing = await pool.query(
      "select 1 from profiles where lower(email) = lower($1)",
      [body.email],
    );
    if (existing.rowCount) {
      throw new HttpError(409, "An account with this email already exists.");
    }

    await withActor(req.user!, async (client) => {
      await client.query(
        `insert into auth_invites (email, role, token_hash, invited_by, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [body.email.toLowerCase(), body.role, token.hash, req.user!.id, expiresAt],
      );
    });

    const inviteUrl = `${config.PUBLIC_SITE_URL}/admin.html#type=invite&token=${token.raw}`;
    let emailed = false;
    let emailError: string | null = null;

    if (isMailConfigured()) {
      try {
        await sendMail({
          to: body.email,
          ...inviteEmail(body.role, inviteUrl),
        });
        emailed = true;
      } catch (error) {
        emailError = error instanceof Error ? error.message : "Could not send the invite email.";
        console.error("Could not send the invite email", error);
      }
    }

    res.status(201).json({ ok: true, inviteUrl, emailed, emailError });
  }),
);

adminTeamRouter.post(
  "/email-test",
  asyncHandler(async (req, res) => {
    if (!isMailConfigured()) {
      throw new HttpError(503, "Email is not configured.");
    }

    const body = parseBody(TestEmailSchema, req.body);
    const to = body.to || req.user!.email;
    const email = testEmail(to);
    const info = await sendMail({ to, ...email });

    res.json({ ok: true, to, messageId: info.messageId });
  }),
);
