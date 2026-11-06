import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db/index.js";
import { withActor } from "../db/tx.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError, asyncHandler, parseBody } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  createOpaqueToken,
  hashToken,
} from "../lib/tokens.js";
import { issueSession, publicUser } from "../services/auth.js";
import { isMailConfigured, sendMail } from "../services/mailer.js";
import { resetEmail } from "../email/templates.js";
import type { AuthUser } from "../types.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in a minute." },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password-reset requests. Try again later." },
});

const LoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20, "Invalid refresh token."),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(10, "The new password must be at least 10 characters."),
});

const ForgotSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

const ResetSchema = z.object({
  token: z.string().min(20, "This reset link is not valid."),
  newPassword: z.string().min(10, "The new password must be at least 10 characters."),
});

const AcceptInviteSchema = z.object({
  token: z.string().min(20, "This invite link is not valid."),
  password: z.string().min(10, "The password must be at least 10 characters."),
  displayName: z.string().trim().max(120).optional(),
});

async function findUserForLogin(email: string): Promise<AuthUser | null> {
  const result = await pool.query<AuthUser>(
    `select id, email, display_name, role, can_view_analytics,
            core_member_id, must_reset, password_hash
       from profiles
      where lower(email) = lower($1)
      limit 1`,
    [email],
  );
  return result.rows[0] || null;
}

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(LoginSchema, req.body);
    const user = await findUserForLogin(body.email);
    const valid = await verifyPassword(
      body.password,
      (user as (AuthUser & { password_hash?: string | null }) | null)?.password_hash ?? null,
    );

    if (!user || !valid) {
      throw new HttpError(401, "Email or password is incorrect.");
    }

    const session = await issueSession(user);
    res.json(session);
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = parseBody(RefreshSchema, req.body);
    const tokenHash = hashToken(refreshToken);

    const session = await withActor(null, async (client) => {
      const result = await client.query<
        AuthUser & { token_id: string }
      >(
        `select t.id as token_id,
                p.id, p.email, p.display_name, p.role, p.can_view_analytics,
                p.core_member_id, p.must_reset
           from auth_refresh_tokens t
           join profiles p on p.id = t.user_id
          where t.token_hash = $1
            and t.revoked_at is null
            and t.expires_at > now()
          for update of t`,
        [tokenHash],
      );

      const row = result.rows[0];
      if (!row) {
        throw new HttpError(401, "Your session expired. Sign in again.");
      }

      await client.query(
        "update auth_refresh_tokens set revoked_at = now() where id = $1",
        [row.token_id],
      );

      const user: AuthUser = {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        role: row.role,
        can_view_analytics: row.can_view_analytics,
        core_member_id: row.core_member_id,
        must_reset: row.must_reset,
      };

      return issueSession(user, client);
    });

    res.json(session);
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken =
      typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";

    if (refreshToken) {
      await pool.query(
        "update auth_refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null",
        [hashToken(refreshToken)],
      );
    }

    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  }),
);

authRouter.post(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(ChangePasswordSchema, req.body);
    const userId = req.user!.id;

    const current = await pool.query<{ password_hash: string | null }>(
      "select password_hash from profiles where id = $1",
      [userId],
    );

    if (!(await verifyPassword(body.currentPassword, current.rows[0]?.password_hash ?? null))) {
      throw new HttpError(400, "Your current password is incorrect.");
    }

    const passwordHash = await hashPassword(body.newPassword);

    const session = await withActor(req.user!, async (client) => {
      const result = await client.query<AuthUser>(
        `update profiles
            set password_hash = $1, must_reset = false
          where id = $2
          returning id, email, display_name, role, can_view_analytics,
                    core_member_id, must_reset`,
        [passwordHash, userId],
      );

      await client.query(
        "update auth_refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
        [userId],
      );

      return issueSession(result.rows[0], client);
    });

    res.json(session);
  }),
);

authRouter.post(
  "/forgot-password",
  resetLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(ForgotSchema, req.body);

    const result = await pool.query<{
      id: string;
      email: string;
      display_name: string | null;
    }>(
      `select id, email, display_name
         from profiles
        where lower(email) = lower($1)
        limit 1`,
      [body.email],
    );

    const user = result.rows[0];
    if (!user) {
      // Same answer whether or not the account exists.
      res.json({ ok: true });
      return;
    }

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `insert into auth_password_resets (user_id, token_hash, expires_at)
       values ($1, $2, $3)`,
      [user.id, token.hash, expiresAt],
    );

    const resetUrl = `${config.PUBLIC_SITE_URL}/admin.html#type=recovery&token=${token.raw}`;

    if (isMailConfigured()) {
      try {
        const email = resetEmail(user.display_name || user.email, resetUrl);
        await sendMail({ to: user.email, ...email });
      } catch (error) {
        console.error("Could not send the password-reset email", error);
      }
    } else {
      // Development fallback: no email credentials, so expose the link.
      console.info(`Password reset for ${body.email}: ${resetUrl}`);
    }

    if (config.isProduction) {
      res.json({ ok: true });
      return;
    }

    res.json({ ok: true, resetUrl });
  }),
);

authRouter.post(
  "/reset-password",
  resetLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(ResetSchema, req.body);
    const tokenHash = hashToken(body.token);

    const session = await withActor(null, async (client) => {
      const result = await client.query<{
        id: string;
        user_id: string;
      }>(
        `select id, user_id
           from auth_password_resets
          where token_hash = $1
            and used_at is null
            and expires_at > now()
          for update`,
        [tokenHash],
      );

      const reset = result.rows[0];
      if (!reset) {
        throw new HttpError(400, "This reset link is invalid or expired.");
      }

      const passwordHash = await hashPassword(body.newPassword);

      const userResult = await client.query<AuthUser>(
        `update profiles
            set password_hash = $1, must_reset = false
          where id = $2
          returning id, email, display_name, role, can_view_analytics,
                    core_member_id, must_reset`,
        [passwordHash, reset.user_id],
      );

      await client.query(
        "update auth_password_resets set used_at = now() where id = $1",
        [reset.id],
      );
      await client.query(
        "update auth_refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
        [reset.user_id],
      );

      return issueSession(userResult.rows[0], client);
    });

    res.json(session);
  }),
);

authRouter.post(
  "/accept-invite",
  asyncHandler(async (req, res) => {
    const body = parseBody(AcceptInviteSchema, req.body);
    const tokenHash = hashToken(body.token);

    const session = await withActor(null, async (client) => {
      const result = await client.query<{
        id: string;
        email: string;
        role: "admin" | "editor";
      }>(
        `select id, email, role
           from auth_invites
          where token_hash = $1
            and accepted_at is null
            and expires_at > now()
          for update`,
        [tokenHash],
      );

      const invite = result.rows[0];
      if (!invite) {
        throw new HttpError(400, "This invite link is invalid or expired.");
      }

      const existing = await client.query(
        "select 1 from profiles where lower(email) = lower($1)",
        [invite.email],
      );
      if (existing.rowCount) {
        throw new HttpError(409, "An account with this email already exists.");
      }

      const passwordHash = await hashPassword(body.password);
      const userResult = await client.query<AuthUser>(
        `insert into profiles (email, password_hash, display_name, role)
         values ($1, $2, $3, $4)
         returning id, email, display_name, role, can_view_analytics,
                   core_member_id, must_reset`,
        [invite.email, passwordHash, body.displayName || null, invite.role],
      );

      await client.query(
        "update auth_invites set accepted_at = now() where id = $1",
        [invite.id],
      );

      return issueSession(userResult.rows[0], client);
    });

    res.status(201).json(session);
  }),
);
