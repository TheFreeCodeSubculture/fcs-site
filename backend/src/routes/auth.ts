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
import { resetEmail, verificationEmail } from "../email/templates.js";
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

const signupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Try again later." },
});

const verificationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification requests. Try again later." },
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

const SignupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(10, "The password must be at least 10 characters."),
  displayName: z.string().trim().min(1, "Enter a display name.").max(80, "Keep the display name under 80 characters."),
  directoryOptIn: z.boolean().optional().default(false),
  emailUpdates: z.boolean().optional().default(true),
  company: z.string().optional(),
});

const VerifyEmailSchema = z.object({
  token: z.string().min(20, "This verification link is not valid."),
});

const ResendVerificationSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

const accountSite = config.PUBLIC_SITE_URL.replace(/\/$/, "");

type VerificationUser = Pick<AuthUser, "id" | "email" | "display_name">;

/** Create a fresh verification token and send it. Returns the link only
 * outside production, where there is no inbox to read. */
async function sendVerification(user: VerificationUser): Promise<string | undefined> {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    "update auth_email_verifications set used_at = now() where user_id = $1 and used_at is null",
    [user.id],
  );
  await pool.query(
    `insert into auth_email_verifications (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [user.id, token.hash, expiresAt],
  );

  const url = `${accountSite}/account.html#verify=${token.raw}`;

  if (!isMailConfigured()) {
    if (config.isProduction) {
      throw new HttpError(503, "Email verification is not configured yet.");
    }
    console.info(`Email verification for ${user.email}: ${url}`);
    return url;
  }

  await sendMail({
    to: user.email,
    ...verificationEmail(user.display_name || user.email, url),
  });

  return config.isProduction ? undefined : url;
}

async function findUserForLogin(email: string): Promise<AuthUser | null> {
  const result = await pool.query<AuthUser>(
    `select id, email, display_name, role, can_view_analytics,
            core_member_id, must_reset, email_verified_at, password_hash
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

    if (user.role === "member" && !user.email_verified_at) {
      throw new HttpError(403, "Verify your email address first. Check your inbox or request a new link.");
    }

    const session = await issueSession(user);
    res.json(session);
  }),
);

authRouter.post(
  "/signup",
  signupLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(SignupSchema, req.body);

    // Honeypot: a real person never fills this hidden field.
    if (body.company) {
      res.json({ ok: true });
      return;
    }

    if (config.isProduction && !isMailConfigured()) {
      throw new HttpError(503, "Member signup is not available right now.");
    }

    const email = body.email.toLowerCase();

    const existing = await pool.query<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      email_verified_at: string | null;
    }>(
      `select id, email, display_name, role, email_verified_at
         from profiles
        where lower(email) = lower($1)
        limit 1`,
      [email],
    );

    const found = existing.rows[0];
    if (found) {
      if (found.role === "member" && !found.email_verified_at) {
        const verifyUrl = await sendVerification(found);
        res.json({ ok: true, pending: true, ...(verifyUrl ? { verifyUrl } : {}) });
        return;
      }
      throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    }

    const passwordHash = await hashPassword(body.password);
    const displayName = body.displayName || email.split("@")[0];

    const created = await pool.query<AuthUser>(
      `insert into profiles
         (email, password_hash, display_name, role, directory_opted_in, email_updates)
       values ($1, $2, $3, 'member', $4, $5)
       returning id, email, display_name, role, can_view_analytics,
                 core_member_id, must_reset, email_verified_at`,
      [email, passwordHash, displayName, body.directoryOptIn, body.emailUpdates],
    );

    const user = created.rows[0];
    let verifyUrl: string | undefined;
    try {
      verifyUrl = await sendVerification(user);
    } catch (error) {
      console.error("Could not send the verification email", error);
      throw new HttpError(502, "Your account was created, but the verification email could not be sent. Request a new link from the sign-in page.");
    }

    res.status(201).json({ ok: true, ...(verifyUrl ? { verifyUrl } : {}) });
  }),
);

authRouter.post(
  "/verify-email",
  verificationLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(VerifyEmailSchema, req.body);
    const tokenHash = hashToken(body.token);

    const session = await withActor(null, async (client) => {
      const result = await client.query<{
        id: string;
        user_id: string;
        email: string;
        display_name: string | null;
        email_updates: boolean;
      }>(
        `select v.id, v.user_id, p.email, p.display_name, p.email_updates
           from auth_email_verifications v
           join profiles p on p.id = v.user_id
          where v.token_hash = $1
            and v.used_at is null
            and v.expires_at > now()
          for update of v`,
        [tokenHash],
      );

      const verification = result.rows[0];
      if (!verification) {
        throw new HttpError(400, "This verification link is invalid or expired.");
      }

      await client.query(
        "update auth_email_verifications set used_at = now() where id = $1",
        [verification.id],
      );

      const updated = await client.query<AuthUser>(
        `update profiles
            set email_verified_at = now()
          where id = $1
          returning id, email, display_name, role, can_view_analytics,
                    core_member_id, must_reset, email_verified_at`,
        [verification.user_id],
      );

      if (verification.email_updates) {
        await client.query(
          `insert into subscriptions (email, event_id, confirmed_at, added_by)
           values ($1, null, now(), $2)
           on conflict (email, event_id) do update set confirmed_at = now()`,
          [verification.email, verification.user_id],
        );
      }

      return issueSession(updated.rows[0], client);
    });

    res.json(session);
  }),
);

authRouter.post(
  "/resend-verification",
  verificationLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(ResendVerificationSchema, req.body);
    const email = body.email.toLowerCase();

    const result = await pool.query<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      email_verified_at: string | null;
    }>(
      `select id, email, display_name, role, email_verified_at
         from profiles
        where lower(email) = lower($1)
        limit 1`,
      [email],
    );

    const user = result.rows[0];
    if (!user || user.role !== "member" || user.email_verified_at) {
      // Same answer whether the address exists, is already verified, or is
      // not a member account.
      res.json({ ok: true });
      return;
    }

    let verifyUrl: string | undefined;
    try {
      verifyUrl = await sendVerification(user);
    } catch (error) {
      console.error("Could not resend the verification email", error);
      throw new HttpError(502, "Could not send the verification email. Try again in a minute.");
    }

    res.json({ ok: true, ...(verifyUrl ? { verifyUrl } : {}) });
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
                p.core_member_id, p.must_reset, p.email_verified_at
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
        email_verified_at: row.email_verified_at,
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
                    core_member_id, must_reset, email_verified_at`,
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
      role: string;
    }>(
      `select id, email, display_name, role
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

    const page = user.role === "member" ? "account.html" : "admin.html";
    const resetUrl = `${accountSite}/${page}#type=recovery&token=${token.raw}`;

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
            set password_hash = $1,
                must_reset = false,
                email_verified_at = coalesce(email_verified_at, now())
          where id = $2
          returning id, email, display_name, role, can_view_analytics,
                    core_member_id, must_reset, email_verified_at`,
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
        `insert into profiles (email, password_hash, display_name, role, email_verified_at)
         values ($1, $2, $3, $4, now())
         returning id, email, display_name, role, can_view_analytics,
                   core_member_id, must_reset, email_verified_at`,
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
